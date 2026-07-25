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
  cobrancaConfigSchema,
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

type Tom = 'cordial' | 'formal' | 'direto';
type MsgKind = 'vence_hoje' | 'venceu' | 'manual';
type MsgOpts = { primeiroNome: string; descricao: string; valorFmt: string; dataFmt: string };

// #3 Tom de mensagem (1 clique) — 1 config por dono, aplicada a lembretes e reenvio manual.
const TEMPLATES: Record<Tom, Record<MsgKind, (o: MsgOpts) => string>> = {
  cordial: {
    vence_hoje: (o) => `Olá, ${o.primeiroNome}! Passando para lembrar que *${o.descricao}* no valor de *${o.valorFmt}* vence hoje (${o.dataFmt}). Qualquer dúvida, é só responder por aqui. 🙂`,
    venceu: (o) => `Olá, ${o.primeiroNome}! *${o.descricao}* no valor de *${o.valorFmt}* venceu em ${o.dataFmt} e ainda consta em aberto. Se já pagou, pode desconsiderar esta mensagem — qualquer dúvida, é só responder por aqui.`,
    manual: (o) => `Olá, ${o.primeiroNome}! Passando para lembrar sobre *${o.descricao}*, no valor de *${o.valorFmt}*, com vencimento em ${o.dataFmt}. Qualquer dúvida, é só responder por aqui. 🙂`,
  },
  formal: {
    vence_hoje: (o) => `Prezado(a) ${o.primeiroNome}, informamos que *${o.descricao}*, no valor de *${o.valorFmt}*, vence hoje (${o.dataFmt}). Permanecemos à disposição para qualquer esclarecimento.`,
    venceu: (o) => `Prezado(a) ${o.primeiroNome}, *${o.descricao}*, no valor de *${o.valorFmt}*, venceu em ${o.dataFmt} e permanece em aberto até o momento. Caso o pagamento já tenha sido efetuado, favor desconsiderar. Permanecemos à disposição.`,
    manual: (o) => `Prezado(a) ${o.primeiroNome}, informamos sobre *${o.descricao}*, no valor de *${o.valorFmt}*, com vencimento em ${o.dataFmt}. Permanecemos à disposição para qualquer esclarecimento.`,
  },
  direto: {
    vence_hoje: (o) => `${o.primeiroNome}, *${o.descricao}* (*${o.valorFmt}*) vence hoje (${o.dataFmt}).`,
    venceu: (o) => `${o.primeiroNome}, *${o.descricao}* (*${o.valorFmt}*) venceu em ${o.dataFmt} e segue em aberto. Se já pagou, desconsidere.`,
    manual: (o) => `${o.primeiroNome}, lembrete de *${o.descricao}* (*${o.valorFmt}*), vencimento em ${o.dataFmt}.`,
  },
};

// #9 Chave Pix nas mensagens — anexada quando o dono configura.
function pixSuffix(pixKey?: string | null): string {
  return pixKey ? `\n\nPix para pagamento: *${pixKey}*` : '';
}

function buildCobrancaMessage(
  kind: MsgKind,
  opts: { nomeCliente: string; descricao: string; valor: number; vencimento: Date; tom?: string | null; pixKey?: string | null },
): string {
  const tom: Tom = opts.tom === 'formal' || opts.tom === 'direto' ? opts.tom : 'cordial';
  const primeiroNome = opts.nomeCliente.trim().split(' ')[0] || opts.nomeCliente;
  const base = TEMPLATES[tom][kind]({
    primeiroNome,
    descricao: opts.descricao,
    valorFmt: formatBRL(opts.valor),
    dataFmt: formatDateBR(opts.vencimento),
  });
  return base + pixSuffix(opts.pixKey);
}

const DEFAULT_COBRANCA_CONFIG = {
  tom: 'cordial' as const,
  escalarTom: true,
  diasAntes: [1],
  diasDepois: [1, 3, 7],
  pixKey: null as string | null,
  pixKeyType: null as string | null,
  resumoDiario: false,
  resumoHora: 8,
  onboardingDone: false,
};

/** Config do dono (tom/régua/Pix/resumo). Cria com defaults no 1º acesso. */
async function getOrCreateCobrancaConfig(userId: string) {
  const existing = await prisma.cobrancaConfig.findUnique({ where: { userId } });
  if (existing) return existing;
  return prisma.cobrancaConfig.create({ data: { userId, ...DEFAULT_COBRANCA_CONFIG } });
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
  app.post<{ Body: { clienteId: string; descricao: string; valor: number; vencimento: string; recorrente?: boolean; recorrenciaMeses?: number } }>(
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

      const recorrente = !!v.data.recorrente;
      const cobranca = await prisma.cobrancaCobranca.create({
        data: {
          userId,
          clienteId: v.data.clienteId,
          descricao: v.data.descricao.trim(),
          valor: v.data.valor,
          vencimento: dateOnly(v.data.vencimento),
          recorrente,
          recorrenciaMeses: recorrente ? (v.data.recorrenciaMeses || 1) : null,
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
    if (v.data.recorrente !== undefined) data.recorrente = v.data.recorrente;
    if (v.data.recorrenciaMeses !== undefined) data.recorrenciaMeses = v.data.recorrenciaMeses;
    if (v.data.status !== undefined) {
      data.status = v.data.status;
      data.pagoEm = v.data.status === 'paga' ? new Date() : null;
    }

    if (Object.keys(data).length === 0) {
      return reply.code(400).send({ error: 'Nenhum campo para atualizar.' });
    }

    const updated = await prisma.cobrancaCobranca.update({ where: { id }, data });

    // #5 Recorrência: 1ª transição para "paga" numa cobrança recorrente gera a próxima ocorrência.
    if (existing.status !== 'paga' && updated.status === 'paga' && updated.recorrente) {
      const meses = updated.recorrenciaMeses || 1;
      const proximoVencimento = new Date(updated.vencimento);
      proximoVencimento.setUTCMonth(proximoVencimento.getUTCMonth() + meses);
      await prisma.cobrancaCobranca.create({
        data: {
          userId,
          clienteId: updated.clienteId,
          descricao: updated.descricao,
          valor: updated.valor,
          vencimento: proximoVencimento,
          recorrente: true,
          recorrenciaMeses: meses,
        },
      }).catch((err: any) => app.log.error({ err: err.message, cobrancaId: id }, '[Cobrança] Erro ao gerar próxima ocorrência recorrente'));
    }

    return updated;
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

    const config = await getOrCreateCobrancaConfig(userId);
    const message = buildCobrancaMessage('manual', {
      nomeCliente: cobranca.cliente.nome,
      descricao: cobranca.descricao,
      valor: cobranca.valor,
      vencimento: cobranca.vencimento,
      tom: config.tom,
      pixKey: config.pixKey,
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

  // ── GET /cobranca/config ──────────────────────────────────────────────────
  // #2/#3/#4/#8/#9/#10: preferências do dono. Cria com defaults no 1º acesso.
  app.get('/config', auth, async (req: any) => {
    return getOrCreateCobrancaConfig(req.user.sub);
  });

  // ── PUT /cobranca/config ──────────────────────────────────────────────────
  app.put('/config', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const v = validateRequest(cobrancaConfigSchema)(req.body);
    if (!v.valid) return reply.code(400).send({ error: v.error });

    await getOrCreateCobrancaConfig(userId); // garante linha existente

    const data: any = {};
    if (v.data.tom !== undefined) data.tom = v.data.tom;
    if (v.data.escalarTom !== undefined) data.escalarTom = v.data.escalarTom;
    if (v.data.diasAntes !== undefined) data.diasAntes = v.data.diasAntes;
    if (v.data.diasDepois !== undefined) data.diasDepois = v.data.diasDepois;
    if (v.data.pixKey !== undefined) data.pixKey = v.data.pixKey.trim() || null;
    if (v.data.pixKeyType !== undefined) data.pixKeyType = v.data.pixKeyType || null;
    if (v.data.resumoDiario !== undefined) data.resumoDiario = v.data.resumoDiario;
    if (v.data.resumoHora !== undefined) data.resumoHora = v.data.resumoHora;
    if (v.data.onboardingDone !== undefined) data.onboardingDone = v.data.onboardingDone;

    if (Object.keys(data).length === 0) {
      return reply.code(400).send({ error: 'Nenhum campo para atualizar.' });
    }

    return prisma.cobrancaConfig.update({ where: { userId }, data });
  });
}
