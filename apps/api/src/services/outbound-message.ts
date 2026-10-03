import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { sendTextWithRetry } from './send-with-retry';
import { enqueueWebhook, WEBHOOK_EVENTS } from '../lib/webhook-events';
import { mapProviderError } from '../lib/apiErrors';

/**
 * Envio de mensagem pela API pública v1 — o recurso "Messages", análogo ao da
 * Twilio.
 *
 * Por que não reaproveitar `POST /atende/avisos` como estava: aquele endpoint
 * grava um `Aviso` e devolve 201 ANTES de o envio acontecer (o
 * sendTextWithRetry é fire-and-forget), e `Aviso` não tem campo de status. Na
 * prática o integrador recebia "201 Created" mesmo quando as 3 tentativas de
 * envio falhavam, e não tinha como descobrir depois. Para uma integração
 * servidor-a-servidor isso é inaceitável: o contrato da Twilio é justamente
 * devolver um recurso com `status` consultável.
 *
 * Aqui o registro é durável (`OutboundMessage`), o status reflete o resultado
 * real do envio (`queued` → `sent` | `failed`) e a mudança de status também vai
 * por webhook (`message.status`), então o integrador escolhe entre poll
 * (GET /public/v1/messages/:id) e push.
 *
 * `/atende/avisos` continua intacto para o dashboard — nenhuma mudança de
 * contrato lá.
 */

export type OutboundSendResult =
  | { kind: 'created'; message: any }
  | { kind: 'replayed'; message: any }
  | { kind: 'error'; code: number; error: string };

export interface SendOutboundArgs {
  userId: string;
  numberId: string;
  to: string;
  body: string;
  idempotencyKey?: string | null;
  source?: string;
}

/**
 * Cria o registro de envio e dispara. Resolve DEPOIS de o envio ter sido
 * tentado, para que a resposta HTTP já carregue o status real — um integrador
 * que recebe `sent` sabe que saiu, e um que recebe `failed` pode reagir na
 * hora em vez de descobrir por acaso.
 */
export async function sendOutboundMessage(args: SendOutboundArgs): Promise<OutboundSendResult> {
  const { userId, numberId, to, body } = args;
  const idempotencyKey = args.idempotencyKey?.trim() || null;

  const number = await prisma.whatsappNumber.findFirst({ where: { id: numberId, userId } });
  if (!number) return { kind: 'error', code: 404, error: 'Número não encontrado.' };
  if (!number.zapiInstanceId) {
    return { kind: 'error', code: 422, error: 'Número não está conectado ao WhatsApp.' };
  }

  // ── Idempotência ──────────────────────────────────────────────────────────
  // Um POST repetido com a mesma chave (timeout do lado do integrador,
  // redeploy no meio da requisição, retry automático de biblioteca HTTP) não
  // pode mandar a mesma mensagem duas vezes pro WhatsApp do cliente final:
  // devolve o registro original. A corrida entre dois POSTs simultâneos é
  // resolvida pelo unique (userId, idempotencyKey) no catch do create.
  if (idempotencyKey) {
    const existing = await (prisma as any).outboundMessage.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
    }).catch(() => null);
    if (existing) return { kind: 'replayed', message: existing };
  }

  let record: any;
  try {
    record = await (prisma as any).outboundMessage.create({
      data: {
        userId, numberId, to, body,
        status:  'queued',
        source:  args.source ?? 'public_api',
        idempotencyKey,
      },
    });
  } catch (err: any) {
    // P2002 = violação de unique: outro request com a mesma chave ganhou a
    // corrida. O resultado correto é o registro dele, não um erro.
    if (err?.code === 'P2002' && idempotencyKey) {
      const winner = await (prisma as any).outboundMessage.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey } },
      }).catch(() => null);
      if (winner) return { kind: 'replayed', message: winner };
    }
    throw err;
  }

  const result = await sendTextWithRetry(number.zapiInstanceId, to, body);

  // Item 6 do escopo ZapScript × Twilio: além da frase crua do provedor
  // (failureReason), grava o CÓDIGO do catálogo. A frase da Evolution muda sem
  // aviso e não dá para programar contra; `errorCode` é estável, então o
  // integrador consegue distinguir "número inválido" de "instância
  // desconectada" com um `if`, e as métricas conseguem agrupar por motivo.
  const apiErr = result.success ? null : mapProviderError(result.lastError, { provider: 'evolution' });

  const updated = await (prisma as any).outboundMessage.update({
    where: { id: record.id },
    data: {
      status:        result.success ? 'sent' : 'failed',
      attempts:      result.attempts,
      sentAt:        result.success ? new Date() : null,
      failureReason: result.success ? null : (result.lastError?.message ?? 'unknown_error').slice(0, 500),
      errorCode:     apiErr?.code ?? null,
    },
  }).catch((err: any) => {
    // O envio já aconteceu; não conseguir gravar o status não desfaz isso.
    logger.error({ err: err?.message, id: record.id }, '[OutboundMessage] Falha ao gravar status do envio');
    return record;
  });

  enqueueWebhook(userId, WEBHOOK_EVENTS.MESSAGE_STATUS, {
    id:            updated.id,
    numberId,
    to,
    status:        updated.status,
    attempts:      updated.attempts,
    failureReason: updated.failureReason ?? null,
    // Aditivo no payload do evento: quem já lia failureReason segue igual, e
    // quem quiser reagir programaticamente passa a ter o código estável.
    errorCode:     updated.errorCode ?? null,
  }).catch(() => null);

  return { kind: 'created', message: updated };
}

/** Serialização pública (não expõe userId nem colunas internas). */
export function serializeOutboundMessage(m: any) {
  return {
    id:             m.id,
    status:         m.status,
    to:             m.to,
    body:           m.body,
    numberId:       m.numberId,
    attempts:       m.attempts,
    failureReason:  m.failureReason ?? null,
    // `errorCode` é o campo estável (item 6); `failureReason` continua ali para
    // não quebrar quem já lê — acréscimo, nunca troca.
    errorCode:      m.errorCode ?? null,
    idempotencyKey: m.idempotencyKey ?? null,
    sentAt:         m.sentAt ?? null,
    createdAt:      m.createdAt,
  };
}
