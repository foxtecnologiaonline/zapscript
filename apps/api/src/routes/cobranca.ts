import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { requireModule } from '../lib/moduleGate';
import { sendText } from '../services/evolution';
import {
  validateRequest,
  cobrancaClienteSchema,
  cobrancaClienteUpdateSchema,
  cobrancaCobrancaSchema,
  cobrancaCobrancaUpdateSchema,
} from '../lib/validation';

// ── Helpers ────────────────────────────────────────────────────────────────────

function cleanPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('55') ? digits : `55${digits}`;
}

function todayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function dateOnly(d: Date): Date {
  const x = new Date(d);
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
}

type DisplayStatus = 'pendente' | 'vence_hoje' | 'vencida' | 'paga' | 'cancelada';

/** 'vencida'/'vence_hoje' nunca são persistidos — derivados de status+vencimento na leitura. */
function computeDisplayStatus(status: string, vencimento: Date): DisplayStatus {
  if (status !== 'pendente') return status as DisplayStatus;
  const today = todayUTC().getTime();
  const due = dateOnly(vencimento).getTime();
  if (due === today) return 'vence_hoje';
  if (due < today) return 'vencida';
  return 'pendente';
}

function formatBRL(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDateBR(d: Date): string {
  return new Date(d).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

function buildCobrancaMessage(
  kind: 'vence_hoje' | 'venceu' | 'manual',
  opts: { nomeCliente: string; descricao: string; valor: number; vencimento: Date },
): string {
  const valorFmt = formatBRL(opts.valor);
  const dataFmt = formatDateBR(opts.vencimento);
  const primeiroNome = opts.nomeCliente.trim().split(' ')[0] || opts.nomeCliente;

  if (kind === 'vence_hoje') {
    return `Olá, ${primeiroNome}! Passando para lembrar que *${opts.descricao}* no valor de *${valorFmt}* vence hoje (${dataFmt}). Qualquer dúvida, é só responder por aqui. 🙂`;
  }
  if (kind === 'venceu') {
    return `Olá, ${primeiroNome}! *${opts.descricao}* no valor de *${valorFmt}* venceu em ${dataFmt} e ainda consta em aberto. Se já pagou, pode desconsiderar esta mensagem — qualquer dúvida, é só responder por aqui.`;
  }
  return `Olá, ${primeiroNome}! Passando para lembrar sobre *${opts.descricao}*, no valor de *${valorFmt}*, com vencimento em ${dataFmt}. Qualquer dúvida, é só responder por aqui. 🙂`;
}

/** Instância WhatsApp conectada mais recente do usuário — usada para enviar o lembrete. */
async function findConnectedInstance(userId: string) {
  return prisma.whatsappNumber.findFirst({
    where: { userId, status: 'connected', zapiInstanceId: { not: null } },
    orderBy: { connectedAt: 'desc' },
  });
}

// ── Rotas ──────────────────────────────────────────────────────────────────────
export default async function cobrancaRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any).authenticate, requireModule('cobranca')] };

  // ── GET /cobranca/clientes ────────────────────────────────────────────────
  app.get('/clientes', auth, async (req: any) => {
    return prisma.cobrancaCliente.findMany({
      where: { userId: req.user.sub, deletedAt: null },
      orderBy: { nome: 'asc' },
    });
  });

  // ── POST /cobranca/clientes ───────────────────────────────────────────────
  app.post<{ Body: { nome: string; telefone: string; documento?: string; email?: string; notas?: string } }>(
    '/clientes',
    auth,
    async (req: any, reply) => {
      const v = validateRequest(cobrancaClienteSchema)(req.body);
      if (!v.valid) return reply.code(400).send({ error: v.error });

      const cliente = await prisma.cobrancaCliente.create({
        data: {
          userId: req.user.sub,
          nome: v.data.nome.trim(),
          telefone: cleanPhone(v.data.telefone),
          documento: v.data.documento?.trim() || null,
          email: v.data.email?.trim() || null,
          notas: v.data.notas?.trim() || null,
        },
      });
      return reply.code(201).send(cliente);
    },
  );

  // ── PATCH /cobranca/clientes/:id ──────────────────────────────────────────
  app.patch<{ Params: { id: string } }>('/clientes/:id', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { id } = req.params;

    const existing = await prisma.cobrancaCliente.findFirst({ where: { id, userId, deletedAt: null } });
    if (!existing) return reply.code(404).send({ error: 'Cliente não encontrado.' });

    const v = validateRequest(cobrancaClienteUpdateSchema)(req.body);
    if (!v.valid) return reply.code(400).send({ error: v.error });

    const data: any = {};
    if (v.data.nome !== undefined) data.nome = v.data.nome.trim();
    if (v.data.telefone !== undefined) data.telefone = cleanPhone(v.data.telefone);
    if (v.data.documento !== undefined) data.documento = v.data.documento?.trim() || null;
    if (v.data.email !== undefined) data.email = v.data.email?.trim() || null;
    if (v.data.notas !== undefined) data.notas = v.data.notas?.trim() || null;

    if (Object.keys(data).length === 0) {
      return reply.code(400).send({ error: 'Nenhum campo para atualizar.' });
    }

    return prisma.cobrancaCliente.update({ where: { id }, data });
  });

  // ── DELETE /cobranca/clientes/:id ─────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/clientes/:id', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { id } = req.params;

    const existing = await prisma.cobrancaCliente.findFirst({ where: { id, userId, deletedAt: null } });
    if (!existing) return reply.code(404).send({ error: 'Cliente não encontrado.' });

    await prisma.cobrancaCliente.update({ where: { id }, data: { deletedAt: new Date() } });
    return reply.code(204).send();
  });

  // ── GET /cobranca/cobrancas ───────────────────────────────────────────────
  app.get('/cobrancas', auth, async (req: any) => {
    const cobrancas = await prisma.cobrancaCobranca.findMany({
      where: { userId: req.user.sub, deletedAt: null },
      include: { cliente: { select: { id: true, nome: true, telefone: true } } },
      orderBy: { vencimento: 'asc' },
    });

    return cobrancas.map((c: any) => ({
      ...c,
      displayStatus: computeDisplayStatus(c.status, c.vencimento),
    }));
  });

  // ── POST /cobranca/cobrancas ──────────────────────────────────────────────
  app.post<{ Body: { clienteId: string; descricao: string; valor: number; vencimento: string } }>(
    '/cobrancas',
    auth,
    async (req: any, reply) => {
      const userId = req.user.sub;
      const v = validateRequest(cobrancaCobrancaSchema)(req.body);
      if (!v.valid) return reply.code(400).send({ error: v.error });

      const cliente = await prisma.cobrancaCliente.findFirst({
        where: { id: v.data.clienteId, userId, deletedAt: null },
      });
      if (!cliente) return reply.code(404).send({ error: 'Cliente não encontrado.' });

      const cobranca = await prisma.cobrancaCobranca.create({
        data: {
          userId,
          clienteId: v.data.clienteId,
          descricao: v.data.descricao.trim(),
          valor: v.data.valor,
          vencimento: dateOnly(v.data.vencimento),
        },
      });
      return reply.code(201).send(cobranca);
    },
  );

  // ── PATCH /cobranca/cobrancas/:id ─────────────────────────────────────────
  app.patch<{ Params: { id: string } }>('/cobrancas/:id', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { id } = req.params;

    const existing = await prisma.cobrancaCobranca.findFirst({ where: { id, userId, deletedAt: null } });
    if (!existing) return reply.code(404).send({ error: 'Cobrança não encontrada.' });

    const v = validateRequest(cobrancaCobrancaUpdateSchema)(req.body);
    if (!v.valid) return reply.code(400).send({ error: v.error });

    const data: any = {};
    if (v.data.descricao !== undefined) data.descricao = v.data.descricao.trim();
    if (v.data.valor !== undefined) data.valor = v.data.valor;
    if (v.data.vencimento !== undefined) data.vencimento = dateOnly(v.data.vencimento);
    if (v.data.status !== undefined) {
      data.status = v.data.status;
      data.pagoEm = v.data.status === 'paga' ? new Date() : null;
    }

    if (Object.keys(data).length === 0) {
      return reply.code(400).send({ error: 'Nenhum campo para atualizar.' });
    }

    return prisma.cobrancaCobranca.update({ where: { id }, data });
  });

  // ── DELETE /cobranca/cobrancas/:id ────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/cobrancas/:id', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { id } = req.params;

    const existing = await prisma.cobrancaCobranca.findFirst({ where: { id, userId, deletedAt: null } });
    if (!existing) return reply.code(404).send({ error: 'Cobrança não encontrada.' });

    await prisma.cobrancaCobranca.update({ where: { id }, data: { deletedAt: new Date() } });
    return reply.code(204).send();
  });

  // ── POST /cobranca/cobrancas/:id/reenviar ─────────────────────────────────
  // Reenvio manual — síncrono, direto pela API (não passa pelo worker/fila).
  app.post<{ Params: { id: string } }>('/cobrancas/:id/reenviar', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { id } = req.params;

    const cobranca = await prisma.cobrancaCobranca.findFirst({
      where: { id, userId, deletedAt: null },
      include: { cliente: true },
    });
    if (!cobranca) return reply.code(404).send({ error: 'Cobrança não encontrada.' });
    if (cobranca.status !== 'pendente') {
      return reply.code(400).send({ error: 'Só é possível reenviar lembrete de cobrança pendente.' });
    }

    const instance = await findConnectedInstance(userId);
    if (!instance?.zapiInstanceId) {
      return reply.code(400).send({ error: 'Nenhum número WhatsApp conectado. Conecte um número primeiro.' });
    }

    const message = buildCobrancaMessage('manual', {
      nomeCliente: cobranca.cliente.nome,
      descricao: cobranca.descricao,
      valor: cobranca.valor,
      vencimento: cobranca.vencimento,
    });

    try {
      await sendText(instance.zapiInstanceId, cobranca.cliente.telefone, message);
      await prisma.cobrancaEnvio.create({ data: { cobrancaId: cobranca.id, tipo: 'manual', sucesso: true } });
      return { ok: true };
    } catch (err: any) {
      app.log.error({ err: err.message, cobrancaId: id }, '[Cobrança] Erro ao reenviar lembrete');
      await prisma.cobrancaEnvio
        .create({ data: { cobrancaId: cobranca.id, tipo: 'manual', sucesso: false, erro: String(err.message || err) } })
        .catch(() => null);
      return reply.code(502).send({ error: `Erro ao enviar WhatsApp: ${err.message}` });
    }
  });
}
