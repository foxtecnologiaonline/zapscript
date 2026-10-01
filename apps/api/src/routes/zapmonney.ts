import { FastifyInstance } from 'fastify';
import { createHash, randomInt } from 'crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { redis } from '../services/queue';
import { sendText } from '../services/evolution';
import { safeCompare } from '../lib/safeCompare';
import { logger } from '../lib/logger';

/**
 * API do ZapMonney para o MonneyHub (interface gráfica) — ver
 * `docs/06-monneyhub-hub-visual.md` no repo foxtecnologiaonline/monneyhub.
 *
 * Outro espaço de identidade, não o do painel B2B: aqui o sujeito é `ZmUser`
 * (qualquer pessoa com um telefone), não `User` (conta paga). Por isso sessão
 * própria, com `aud: 'zm'` no token, e guarda própria — `app.authenticate`
 * carrega `User` e não serve aqui.
 *
 * O dado é o MESMO que a conversa no WhatsApp lê e escreve. Não há
 * sincronização entre app e chat porque não há duas fontes: as duas pontas
 * batem na mesma linha do mesmo Postgres.
 */

// ── Sessão ───────────────────────────────────────────────────────────────────

const JWT_AUDIENCE = 'zm';

// 7 dias: não existe rotação de refresh para ZmUser como existe para User, e
// renovar custa uma ida ao WhatsApp. Prazo mais longo seria tolerância grande
// demais para token em localStorage; mais curto transformaria uso semanal em
// pedir código toda vez.
const SESSION_TTL = process.env.ZAPMONNEY_SESSION_TTL || '7d';

// ── OTP ──────────────────────────────────────────────────────────────────────

const OTP_TTL_SEC      = 300;   // 5 min
const OTP_MAX_ATTEMPTS = 5;
const OTP_COOLDOWN_SEC = 60;    // entre pedidos do mesmo telefone
const OTP_DAY_CAP      = 10;    // pedidos por telefone por dia
const OTP_IP_DAY_CAP   = 30;    // pedidos por IP por dia

function otpKey(phone: string)      { return `zm:otp:${phone}`; }
function otpTriesKey(phone: string) { return `zm:otp:tries:${phone}`; }
function otpCooldownKey(phone: string) { return `zm:otp:cd:${phone}`; }

/** Dia em São Paulo (UTC-3 fixo) — mesma convenção do rate limit do router. */
function dayKey(): string {
  return new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10).replace(/-/g, '');
}

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

function onlyDigits(raw: string): string {
  return (raw || '').replace(/\D/g, '');
}

// ── Datas, gêmeas de apps/worker/src/services/zapmonney-executor.ts ─────────
// Duplicadas porque API e worker são imagens Docker separadas e não compartilham
// código de aplicação (mesmo motivo de services/ai-fallback.ts existir nos dois).
// Divergir aqui faria o app mostrar um mês diferente do que a conversa responde,
// então `tests/zapmonney-dates.test.ts` usa as MESMAS fixtures do teste do
// worker — se uma cópia mudar, o outro lado quebra.

const BRT_OFFSET_HOURS = 3;

const MONTH_NAMES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

function brtParts(now: Date): { y: number; m: number; d: number } {
  const shifted = new Date(now.getTime() - BRT_OFFSET_HOURS * 3_600_000);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth(), d: shifted.getUTCDate() };
}

export function todayBrt(now = new Date()): string {
  const { y, m, d } = brtParts(now);
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Instante UTC de 12:00 BRT da data — ver o porquê do meio-dia no worker. */
export function occurredAtFrom(dateStr: string | undefined, now = new Date()): Date {
  const today = todayBrt(now);
  const match = /^\d{4}-\d{2}-\d{2}$/.exec((dateStr ?? '').trim());
  const day = !match || match[0] > today ? today : match[0];
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12 + BRT_OFFSET_HOURS));
}

/** `month` em 'YYYY-MM'; ausente = mês corrente em São Paulo. */
export function monthRange(month?: string, now = new Date()): { start: Date; end: Date; label: string } {
  const match = /^(\d{4})-(\d{2})$/.exec((month ?? '').trim());
  const { y, m } = brtParts(now);
  const year  = match ? Number(match[1]) : y;
  const index = match ? Number(match[2]) - 1 : m;

  // 00:00 BRT = 03:00 UTC. Date.UTC normaliza virada de ano sozinho.
  const start = new Date(Date.UTC(year, index, 1, BRT_OFFSET_HOURS));
  const end   = new Date(Date.UTC(year, index + 1, 1, BRT_OFFSET_HOURS));
  const ref   = new Date(Date.UTC(year, index, 1));
  return { start, end, label: `${MONTH_NAMES[ref.getUTCMonth()]} de ${ref.getUTCFullYear()}` };
}

// ── Serialização ─────────────────────────────────────────────────────────────

/** Decimal do Prisma não é JSON-serializável de forma previsível: vira string. */
function serializeTx(tx: any) {
  return {
    id:          tx.id,
    type:        tx.type,
    amount:      tx.amount.toString(),
    category:    tx.category,
    description: tx.description,
    occurredAt:  tx.occurredAt.toISOString(),
    status:      tx.status,
    createdAt:   tx.createdAt.toISOString(),
  };
}

const CATEGORIES = [
  'Alimentação', 'Transporte', 'Moradia', 'Saúde', 'Educação',
  'Lazer', 'Compras', 'Serviços', 'Receita', 'Outros',
] as const;

export default async function zapmonneyRoutes(app: FastifyInstance) {

  /**
   * Guarda de sessão do ZapMonney. Não reaproveita `app.authenticate`: aquele
   * carrega `User` e devolveria 401 aqui de qualquer forma, mas depender desse
   * acidente seria frágil. A checagem de `aud` é explícita para um token do
   * painel B2B nunca ser aceito como token de ZmUser, e vice-versa.
   */
  const authenticateZm = async (req: any, reply: any) => {
    try {
      await req.jwtVerify({ allowedAud: JWT_AUDIENCE });
    } catch {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const zmUser = await prisma.zmUser
      .findUnique({ where: { id: req.user.sub }, select: { id: true, name: true, phone: true, stage: true } })
      .catch(() => null);

    if (!zmUser || zmUser.stage === 'blocked') {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    req.zmUser = zmUser;
  };

  const auth = { preHandler: [authenticateZm] };

  // ── Auth: pedir código ────────────────────────────────────────────────────

  app.post('/auth/request-code', async (req: any, reply) => {
    const parsed = z.object({ phone: z.string().min(8).max(20) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Telefone inválido' });

    const phone = onlyDigits(parsed.data.phone);
    if (phone.length < 10 || phone.length > 15) {
      return reply.code(400).send({ error: 'Telefone inválido' });
    }

    const instance = process.env.ZAPMONNEY_INSTANCE;
    if (!instance) {
      logger.error('[ZapMonney/API] ZAPMONNEY_INSTANCE não configurada — login indisponível');
      return reply.code(503).send({ error: 'Login temporariamente indisponível' });
    }

    // Resposta SEMPRE igual, exista conta ou não: senão este endpoint vira um
    // oráculo de "este telefone usa o ZapMonney", que é dado de terceiro.
    const genericOk = {
      ok: true,
      message: 'Se este número já conversa com o ZapMonney, o código chegou no WhatsApp.',
    };

    const ip = req.ip || 'sem-ip';
    try {
      const [cooldown, dayCount, ipCount] = await Promise.all([
        redis.exists(otpCooldownKey(phone)),
        redis.incr(`zm:otp:day:${phone}:${dayKey()}`),
        redis.incr(`zm:otp:ip:${ip}:${dayKey()}`),
      ]);
      await Promise.all([
        redis.expire(`zm:otp:day:${phone}:${dayKey()}`, 36 * 3_600),
        redis.expire(`zm:otp:ip:${ip}:${dayKey()}`, 36 * 3_600),
      ]);

      if (cooldown || dayCount > OTP_DAY_CAP || ipCount > OTP_IP_DAY_CAP) {
        logger.warn(`[ZapMonney/API] 🚦 Pedido de código barrado (${phone}, ip=${ip})`);
        return reply.send(genericOk);
      }
    } catch (err: any) {
      // Redis fora do ar não pode trancar o login de todo mundo.
      logger.warn(`[ZapMonney/API] Rate limit de OTP indisponível: ${err.message}`);
    }

    const zmUser = await prisma.zmUser
      .findUnique({ where: { phone }, select: { id: true, stage: true } })
      .catch(() => null);

    // Conta nasce na conversa, com consentimento — nunca pela web. Quem ainda
    // não usa precisa mandar a primeira mensagem para o número.
    if (!zmUser || zmUser.stage !== 'active') return reply.send(genericOk);

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');

    try {
      await redis.set(otpKey(phone), hashCode(code), 'EX', OTP_TTL_SEC);
      await redis.set(otpTriesKey(phone), '0', 'EX', OTP_TTL_SEC);
      await redis.set(otpCooldownKey(phone), '1', 'EX', OTP_COOLDOWN_SEC);
    } catch (err: any) {
      logger.error(`[ZapMonney/API] Falha ao guardar OTP: ${err.message}`);
      return reply.code(503).send({ error: 'Login temporariamente indisponível' });
    }

    await sendText(
      instance, phone,
      `🔐 Seu código de acesso ao MonneyHub é *${code}*\n\n` +
      'Ele vale por 5 minutos. Se não foi você que pediu, ignore esta mensagem.',
    ).catch((err: any) => logger.error(`[ZapMonney/API] Falha ao enviar OTP: ${err.message}`));

    return reply.send(genericOk);
  });

  // ── Auth: verificar código ────────────────────────────────────────────────

  app.post('/auth/verify', async (req: any, reply) => {
    const parsed = z.object({
      phone: z.string().min(8).max(20),
      code:  z.string().length(6),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Dados inválidos' });

    const phone = onlyDigits(parsed.data.phone);
    const invalid = { error: 'Código inválido ou expirado' };

    let stored: string | null = null;
    let tries  = 0;
    try {
      stored = await redis.get(otpKey(phone));
      tries  = Number(await redis.get(otpTriesKey(phone)) ?? 0);
    } catch (err: any) {
      logger.error(`[ZapMonney/API] Redis indisponível na verificação: ${err.message}`);
      return reply.code(503).send({ error: 'Login temporariamente indisponível' });
    }

    if (!stored) return reply.code(401).send(invalid);

    // Força bruta num espaço de 6 dígitos só é inviável com teto de tentativas:
    // sem isso, 1 milhão de chutes cabe folgado nos 5 minutos de validade.
    if (tries >= OTP_MAX_ATTEMPTS) {
      await redis.del(otpKey(phone)).catch(() => null);
      return reply.code(429).send({ error: 'Muitas tentativas. Peça um código novo.' });
    }

    if (!safeCompare(hashCode(parsed.data.code), stored)) {
      await redis.incr(otpTriesKey(phone)).catch(() => null);
      return reply.code(401).send(invalid);
    }

    const zmUser = await prisma.zmUser.findUnique({
      where:  { phone },
      select: { id: true, name: true, phone: true, stage: true },
    });
    if (!zmUser || zmUser.stage !== 'active') return reply.code(401).send(invalid);

    await Promise.all([
      redis.del(otpKey(phone)).catch(() => null),
      redis.del(otpTriesKey(phone)).catch(() => null),
    ]);

    const token = app.jwt.sign(
      { sub: zmUser.id },
      { expiresIn: SESSION_TTL, aud: JWT_AUDIENCE },
    );

    logger.info(`[ZapMonney/API] ✅ Sessão criada para ZmUser ${zmUser.id}`);
    return reply.send({ token, user: { id: zmUser.id, name: zmUser.name, phone: zmUser.phone } });
  });

  // ── Perfil ────────────────────────────────────────────────────────────────

  app.get('/me', auth, async (req: any) => ({
    id:    req.zmUser.id,
    name:  req.zmUser.name,
    phone: req.zmUser.phone,
  }));

  // ── Lançamentos ───────────────────────────────────────────────────────────

  app.get('/transactions', auth, async (req: any, reply) => {
    const parsed = z.object({
      month:    z.string().regex(/^\d{4}-\d{2}$/).optional(),
      type:     z.enum(['expense', 'income']).optional(),
      category: z.enum(CATEGORIES).optional(),
      status:   z.enum(['confirmed', 'pending']).default('confirmed'),
      cursor:   z.string().optional(),
      limit:    z.coerce.number().int().min(1).max(100).default(50),
    }).safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Filtro inválido' });

    const { month, type, category, status, cursor, limit } = parsed.data;
    const { start, end, label } = monthRange(month);

    const rows = await prisma.zmTransaction.findMany({
      where: {
        zmUserId:   req.zmUser.id,
        status,
        occurredAt: { gte: start, lt: end },
        ...(type ? { type } : {}),
        ...(category ? { category } : {}),
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take:    limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const page    = hasMore ? rows.slice(0, limit) : rows;

    return reply.send({
      month: month ?? todayBrt().slice(0, 7),
      label,
      transactions: page.map(serializeTx),
      nextCursor:   hasMore ? page[page.length - 1].id : null,
    });
  });

  app.post('/transactions', auth, async (req: any, reply) => {
    const parsed = z.object({
      type:        z.enum(['expense', 'income']),
      amount:      z.coerce.number().positive().max(99_999_999),
      category:    z.enum(CATEGORIES),
      description: z.string().trim().max(200).optional(),
      occurredAt:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Lançamento inválido' });

    const { type, amount, category, description, occurredAt } = parsed.data;

    // Criado pela interface já nasce confirmado: a confirmação existe para
    // conferir extração de IA, e aqui a pessoa digitou os campos ela mesma.
    const tx = await prisma.zmTransaction.create({
      data: {
        zmUserId:    req.zmUser.id,
        type,
        amount:      amount.toFixed(2),
        category:    type === 'income' ? 'Receita' : category,
        description: description || null,
        occurredAt:  occurredAtFrom(occurredAt),
        status:      'confirmed',
        rawText:     '[hub] lançamento manual',
      },
    });

    return reply.code(201).send(serializeTx(tx));
  });

  app.patch('/transactions/:id', auth, async (req: any, reply) => {
    const parsed = z.object({
      amount:      z.coerce.number().positive().max(99_999_999).optional(),
      category:    z.enum(CATEGORIES).optional(),
      description: z.string().trim().max(200).nullable().optional(),
      occurredAt:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Alteração inválida' });

    const data: Record<string, unknown> = {};
    if (parsed.data.amount !== undefined)      data.amount      = parsed.data.amount.toFixed(2);
    if (parsed.data.category !== undefined)    data.category    = parsed.data.category;
    if (parsed.data.description !== undefined) data.description = parsed.data.description || null;
    if (parsed.data.occurredAt !== undefined)  data.occurredAt  = occurredAtFrom(parsed.data.occurredAt);

    if (Object.keys(data).length === 0) return reply.code(400).send({ error: 'Nada para alterar' });

    // updateMany com zmUserId no WHERE, não update por id: garante no próprio
    // SQL que ninguém altera lançamento de outra pessoa, mesmo sabendo o id.
    const { count } = await prisma.zmTransaction.updateMany({
      where: { id: req.params.id, zmUserId: req.zmUser.id, status: { in: ['confirmed', 'pending'] } },
      data,
    });
    if (count === 0) return reply.code(404).send({ error: 'Lançamento não encontrado' });

    const tx = await prisma.zmTransaction.findUnique({ where: { id: req.params.id } });
    return reply.send(serializeTx(tx));
  });

  app.delete('/transactions/:id', auth, async (req: any, reply) => {
    const { count } = await prisma.zmTransaction.updateMany({
      where: { id: req.params.id, zmUserId: req.zmUser.id, status: { in: ['confirmed', 'pending'] } },
      data:  { status: 'deleted' },
    });
    if (count === 0) return reply.code(404).send({ error: 'Lançamento não encontrado' });
    return reply.send({ ok: true });
  });

  app.post('/transactions/:id/confirm', auth, async (req: any, reply) => {
    const { count } = await prisma.zmTransaction.updateMany({
      where: { id: req.params.id, zmUserId: req.zmUser.id, status: 'pending' },
      data:  { status: 'confirmed' },
    });
    if (count === 0) return reply.code(404).send({ error: 'Lançamento pendente não encontrado' });
    return reply.send({ ok: true });
  });

  // ── Resumo do mês ─────────────────────────────────────────────────────────

  app.get('/summary', auth, async (req: any, reply) => {
    const parsed = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }).safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Mês inválido' });

    const { start, end, label } = monthRange(parsed.data.month);
    const base = { zmUserId: req.zmUser.id, status: 'confirmed', occurredAt: { gte: start, lt: end } };

    const [byType, byCategory, pendingCount] = await Promise.all([
      prisma.zmTransaction.groupBy({ by: ['type'], where: base, _sum: { amount: true } }),
      prisma.zmTransaction.groupBy({
        by:     ['category'],
        where:  { ...base, type: 'expense' },
        _sum:   { amount: true },
        _count: { _all: true },
      }),
      prisma.zmTransaction.count({ where: { zmUserId: req.zmUser.id, status: 'pending' } }),
    ]);

    const income  = Number(byType.find((g) => g.type === 'income')?._sum.amount ?? 0);
    const expense = Number(byType.find((g) => g.type === 'expense')?._sum.amount ?? 0);

    return reply.send({
      month: parsed.data.month ?? todayBrt().slice(0, 7),
      label,
      income:  income.toFixed(2),
      expense: expense.toFixed(2),
      balance: (income - expense).toFixed(2),
      pendingCount,
      byCategory: byCategory
        .map((c) => ({
          category: c.category,
          total:    Number(c._sum.amount ?? 0).toFixed(2),
          count:    c._count._all,
        }))
        .sort((a, b) => Number(b.total) - Number(a.total)),
    });
  });

  // ── Exclusão de conta (LGPD) ──────────────────────────────────────────────

  app.delete('/account', auth, async (req: any, reply) => {
    // Cascade em ZmTransaction — mesmo efeito do "APAGAR TUDO" na conversa.
    await prisma.zmUser.delete({ where: { id: req.zmUser.id } });
    logger.info(`[ZapMonney/API] 🗑️ Conta ${req.zmUser.id} apagada a pedido (LGPD)`);
    return reply.send({ ok: true });
  });
}
