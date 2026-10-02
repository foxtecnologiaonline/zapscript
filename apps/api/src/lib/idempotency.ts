import crypto from 'crypto';
import { prisma } from './prisma';
import { logger } from './logger';
import { ApiError, isApiError } from './apiErrors';

/**
 * Idempotência das escritas da API pública (item 3 do escopo ZapScript × Twilio).
 *
 * O problema concreto: Zapier, Make e qualquer cliente HTTP decente retentam
 * sozinhos em timeout e 5xx. Se o POST que envia WhatsApp chegou e o ACK se
 * perdeu na volta, o retry manda a MESMA mensagem de novo — e o contato final
 * recebe duas. Não é um registro duplicado no banco: é dano visível ao cliente
 * do nosso cliente.
 *
 * Semântica (a do Stripe, por ser a que os integradores já conhecem):
 *
 *   • `Idempotency-Key` presente → a 1ª chamada executa e GRAVA a resposta;
 *     repetições da mesma chave devolvem a resposta gravada (replay), com o
 *     header `X-Idempotent-Replay: true`. Nada é reexecutado.
 *   • mesma chave + corpo diferente → 422 `idempotency.request_mismatch`.
 *     Reusar chave por descuido é bug do cliente; falhar alto é melhor que
 *     devolver a resposta de outra requisição.
 *   • chave em execução → 409 `idempotency.in_progress` (retryable), em vez de
 *     deixar duas execuções simultâneas passarem.
 *   • `Idempotency-Key` AUSENTE → derivamos uma chave do próprio corpo, válida
 *     por uma janela curta (IDEMPOTENCY_AUTO_WINDOW_SECONDS, default 10s). Isso
 *     absorve o retry automático de rede (que acontece em segundos) sem engolir
 *     um reenvio deliberado do usuário minutos depois. Quem quer garantia
 *     exata manda a chave; quem esquece ainda fica protegido do caso comum.
 *     Ponha 0 para desligar a rede de segurança.
 *
 * O registro vale 24h por padrão (IDEMPOTENCY_TTL_HOURS) e é purgado por
 * `purgeExpiredIdempotencyRecords()`, chamado no sweep periódico da API.
 */

const TTL_HOURS = Math.max(1, Number(process.env.IDEMPOTENCY_TTL_HOURS || 24));
const AUTO_WINDOW_SECONDS = (() => {
  const raw = process.env.IDEMPOTENCY_AUTO_WINDOW_SECONDS;
  if (raw === undefined || raw === '') return 10;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 10;
})();

const KEY_MIN = 8;
const KEY_MAX = 255;
/** Chave do cliente: ASCII imprimível, sem espaços — evita header quebrado. */
const KEY_RE = /^[\x21-\x7e]{8,255}$/;

export interface IdempotentResult<T> {
  statusCode: number;
  body: T;
  /** true = resposta devolvida do registro, sem reexecutar nada. */
  replayed: boolean;
  key: string;
  /** true = a chave foi derivada por nós (o cliente não mandou header). */
  autoDerived: boolean;
}

/**
 * JSON canônico: mesmas chaves em ordem estável, para que `{a:1,b:2}` e
 * `{b:2,a:1}` produzam o mesmo hash. Sem isso, a ordem com que o cliente
 * monta o objeto mudaria o requestHash e um replay legítimo viraria 422.
 */
export function canonicalJson(value: unknown): string {
  const seen = new WeakSet<object>();
  const walk = (v: any): any => {
    if (v === null || typeof v !== 'object') return v === undefined ? null : v;
    if (seen.has(v)) return null; // ciclo: payload de API não deveria ter, mas não travamos por isso
    seen.add(v);
    if (Array.isArray(v)) return v.map(walk);
    const out: Record<string, any> = {};
    for (const k of Object.keys(v).sort()) {
      if (v[k] === undefined) continue;
      out[k] = walk(v[k]);
    }
    return out;
  };
  return JSON.stringify(walk(value));
}

export function hashPayload(scope: string, payload: unknown): string {
  return crypto.createHash('sha256').update(`${scope}\n${canonicalJson(payload)}`).digest('hex');
}

/** Lê e valida o header. Retorna null quando ausente (não é erro). */
export function readIdempotencyKey(headers: Record<string, any>): string | null {
  const raw = headers['idempotency-key'] ?? headers['x-idempotency-key'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const key = String(value).trim();
  if (!KEY_RE.test(key)) {
    throw new ApiError('idempotency.key_invalid', {
      details: { min: KEY_MIN, max: KEY_MAX, received_length: key.length },
    });
  }
  return key;
}

interface StoredResponse {
  statusCode: number;
  body: unknown;
}

/**
 * Executa `run` no máximo uma vez por (userId, scope, chave).
 *
 * `run` recebe um callback `setResourceId` para registrar o id do recurso
 * criado (ex.: MessageLog.id) — serve para o suporte achar depois "que
 * mensagem esta chave criou".
 */
export async function withIdempotency<T>(args: {
  userId: string;
  scope: string;
  headers: Record<string, any>;
  payload: unknown;
  run: (ctx: { setResourceId: (id: string) => void }) => Promise<{ statusCode: number; body: T }>;
}): Promise<IdempotentResult<T>> {
  const clientKey = readIdempotencyKey(args.headers);
  const requestHash = hashPayload(args.scope, args.payload);

  // Sem chave do cliente e rede de segurança desligada: executa direto.
  if (!clientKey && AUTO_WINDOW_SECONDS === 0) {
    const out = await args.run({ setResourceId: () => undefined });
    return { ...out, replayed: false, key: '', autoDerived: true };
  }

  const autoDerived = !clientKey;
  const key = clientKey ?? `auto:${requestHash.slice(0, 48)}`;
  const ttlMs = autoDerived ? AUTO_WINDOW_SECONDS * 1000 : TTL_HOURS * 3_600_000;
  const expiresAt = new Date(Date.now() + ttlMs);

  const claim = await claimRecord({
    userId: args.userId, scope: args.scope, key, requestHash, expiresAt, autoDerived,
  });

  if (claim.kind === 'replay') {
    return {
      statusCode: claim.response.statusCode,
      body:       claim.response.body as T,
      replayed:   true,
      key,
      autoDerived,
    };
  }

  let resourceId: string | undefined;
  try {
    const out = await args.run({ setResourceId: (id) => { resourceId = id; } });
    await prisma.idempotencyRecord.update({
      where: { id: claim.recordId },
      data: {
        status:       'completed',
        statusCode:   out.statusCode,
        responseBody: out.body as any,
        resourceId:   resourceId ?? null,
        completedAt:  new Date(),
      },
    }).catch((err: any) => {
      // Gravar o registro não pode derrubar uma mensagem já enviada. O custo é
      // perder a garantia de replay desta chave — menor que o de uma 500.
      logger.warn({ err: err?.message, key, scope: args.scope }, '[Idempotency] falha ao gravar resposta');
    });
    return { ...out, replayed: false, key, autoDerived };
  } catch (err) {
    // Erro definitivo do cliente (4xx não-retryable): grava, para que o retry
    // receba o MESMO erro em vez de tentar executar de novo.
    const apiErr = isApiError(err) ? (err as ApiError) : null;
    const persistAsFinal = apiErr && apiErr.status < 500 && !apiErr.retryable;

    if (persistAsFinal) {
      await prisma.idempotencyRecord.update({
        where: { id: claim.recordId },
        data: {
          status:       'completed',
          statusCode:   apiErr!.status,
          responseBody: apiErr!.toEnvelope() as any,
          completedAt:  new Date(),
        },
      }).catch(() => null);
    } else {
      // Falha transitória (5xx, timeout, indisponibilidade): libera a chave,
      // senão o cliente fica travado em `in_progress`/erro gravado e NÃO
      // consegue reenviar o que nunca saiu.
      await prisma.idempotencyRecord.delete({ where: { id: claim.recordId } }).catch(() => null);
    }
    throw err;
  }
}

type Claim =
  | { kind: 'claimed'; recordId: string }
  | { kind: 'replay'; response: StoredResponse };

async function claimRecord(args: {
  userId: string; scope: string; key: string; requestHash: string;
  expiresAt: Date; autoDerived: boolean;
}): Promise<Claim> {
  const where = { userId_scope_key: { userId: args.userId, scope: args.scope, key: args.key } };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const created = await prisma.idempotencyRecord.create({
        data: {
          userId:      args.userId,
          scope:       args.scope,
          key:         args.key,
          requestHash: args.requestHash,
          autoDerived: args.autoDerived,
          expiresAt:   args.expiresAt,
        },
      });
      return { kind: 'claimed', recordId: created.id };
    } catch (err: any) {
      if (err?.code !== 'P2002') throw err;

      const existing = await prisma.idempotencyRecord.findUnique({ where });
      if (!existing) continue; // corrida: alguém purgou entre o create e o read

      // Registro vencido: some com ele e tenta de novo (uma vez).
      if (existing.expiresAt.getTime() <= Date.now()) {
        await prisma.idempotencyRecord.delete({ where: { id: existing.id } }).catch(() => null);
        continue;
      }

      if (existing.requestHash !== args.requestHash) {
        throw new ApiError('idempotency.request_mismatch', {
          details: { key: args.key, scope: args.scope },
        });
      }

      if (existing.status === 'completed' && existing.statusCode !== null) {
        return {
          kind: 'replay',
          response: { statusCode: existing.statusCode, body: existing.responseBody },
        };
      }

      // Ainda rodando (ou morreu sem concluir): o cliente deve tentar de novo.
      throw new ApiError('idempotency.in_progress', { details: { key: args.key } });
    }
  }

  throw new ApiError('idempotency.in_progress', { details: { key: args.key } });
}

/** Remove registros vencidos. Chamado no sweep periódico da API. */
export async function purgeExpiredIdempotencyRecords(): Promise<number> {
  const { count } = await prisma.idempotencyRecord.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  if (count > 0) logger.info(`[Idempotency] ${count} registro(s) vencido(s) purgado(s)`);
  return count;
}
