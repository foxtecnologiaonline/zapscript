import { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma';
import { requireModule } from '../../lib/moduleGate';
import { validateRequest, createCampanhaSchema, scheduleCampanhaSchema } from '../../lib/validation';
import { decryptStr } from '../../services/encryption';
import { listTemplates } from '../../services/whatsapp-campaigns';
import { campanhasQueue } from '../../services/queue';

/**
 * ZapScript Campanhas — disparo em massa via WhatsApp API oficial (Meta Cloud API).
 * Toda rota exige o módulo 'campanhas' contratado (requireModule → 402 se não).
 * Credenciais Meta vêm do WhatsappNumber do próprio usuário (provider='meta'),
 * nunca de env global — ver services/whatsapp-campaigns.ts.
 */

const PHONE_LIKE = /^\+?\d[\d\s()-]{7,}$/;

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.startsWith('55') ? digits : `55${digits}`;
}

/** Palavras-chave de opt-out (convenção SMS/WhatsApp) — igualdade exata após trim+uppercase. */
export const OPT_OUT_KEYWORDS = new Set(['PARAR', 'SAIR', 'STOP', 'CANCELAR', 'UNSUBSCRIBE']);

/**
 * Registra opt-out de campanhas (upsert + marca CampanhaContato pendentes como
 * 'optout'). Compartilhado pelos dois webhooks de entrada — Meta oficial
 * (routes/whatsapp-webhook.ts) e Evolution (routes/evolution-webhook.ts) — pra não
 * duplicar essa lógica; cada webhook manda a mensagem de confirmação com seu
 * próprio cliente de envio (Meta ou sendText do Evolution) depois de chamar isto.
 */
export async function registerCampanhaOptOut(userId: string, rawPhone: string, keyword: string): Promise<string> {
  const phone = normalizePhone(rawPhone);
  await prisma.campanhaOptOut.upsert({
    where:  { userId_phone: { userId, phone } },
    create: { userId, phone, reason: keyword },
    update: { reason: keyword },
  });
  await prisma.campanhaContato.updateMany({
    where: { phone, status: 'pending', campanha: { userId } },
    data:  { status: 'optout' },
  });
  return phone;
}

/**
 * Audiência "quente" pra campanhas via Evolution (channel='evolution'): união dos
 * telefones que já trocaram mensagem com este número, via transcrição (core),
 * Atende ou Copiloto — nunca CSV livre. É o guardrail central do canal Evolution
 * (ver CAMPANHAS_ARQUITETURA.md §8): só quem já tem relação com o número, reduzindo
 * o padrão de "spam pra desconhecido" que o WhatsApp mais penaliza.
 */
async function warmContactsForNumber(numberId: string): Promise<Map<string, string | null>> {
  const [transcricoes, atende, copiloto] = await Promise.all([
    prisma.transcription.findMany({
      where: { numberId, source: 'whatsapp' },
      select: { contactPhone: true, contactName: true },
    }),
    prisma.atendeConversation.findMany({
      where: { numberId },
      select: { contactPhone: true, contactName: true },
    }),
    prisma.copilotoConversation.findMany({
      where: { numberId },
      select: { contactPhone: true, contactName: true },
    }),
  ]);

  const byPhone = new Map<string, string | null>();
  for (const row of [...transcricoes, ...atende, ...copiloto]) {
    const phone = normalizePhone(row.contactPhone);
    if (!byPhone.has(phone) || (!byPhone.get(phone) && row.contactName)) {
      byPhone.set(phone, row.contactName ?? null);
    }
  }
  return byPhone;
}

function detectDelimiter(sample: string): string {
  const firstLine = sample.split(/\r?\n/, 1)[0] || '';
  const commas = (firstLine.match(/,/g) || []).length;
  const semis  = (firstLine.match(/;/g) || []).length;
  return semis > commas ? ';' : ',';
}

/** Parser CSV minimalista com suporte a campos entre aspas (sem dependência externa). */
function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else if (c === '\r') {
      // ignorado — \n fecha a linha
    } else {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c.length > 0));
}

async function ownedCampanha(userId: string, id: string) {
  return prisma.campanha.findFirst({ where: { id, userId } });
}

/** Conexão válida pra disparar, nos dois canais (Meta exige token; Evolution exige instância). */
function numberReadyToSend(whatsappNumber: { status: string; metaAccessTokenEnc: string | null; zapiInstanceId: string | null } | null, channel: string): boolean {
  if (!whatsappNumber || whatsappNumber.status !== 'connected') return false;
  // 'meta' é o default histórico (linhas antigas da migration não têm channel setado
  // explicitamente) — só trata como evolution quando for exatamente isso.
  return channel === 'evolution' ? !!whatsappNumber.zapiInstanceId : !!whatsappNumber.metaAccessTokenEnc;
}

const EVOLUTION_DAILY_LIMIT = parseInt(process.env.CAMPANHAS_EVOLUTION_DAILY_LIMIT || '40', 10);

/**
 * Espaçamento entre envios do canal Evolution — ritmo bem mais lento e "humano"
 * que o teto de segurança do Meta (10 msg/s), pra reduzir o risco de o WhatsApp
 * detectar padrão de disparo automatizado no número do próprio usuário (ver
 * CAMPANHAS_ARQUITETURA.md §8). Sem contador vivo em Redis: o intervalo médio já
 * é calculado pra manter o total dentro do limite diário (index 0 sai quase na
 * hora; os demais espaçados por ~24h / limite diário, com jitter de ±30%).
 * Duplicada de propósito em apps/worker/src/campanhas-scheduler.ts — api e
 * worker não compartilham código entre si neste monorepo.
 */
export function evolutionSendDelayMs(index: number, dailyLimit: number = EVOLUTION_DAILY_LIMIT): number {
  if (index <= 0) return 0;
  const baseIntervalMs = (24 * 60 * 60 * 1000) / Math.max(dailyLimit, 1);
  const jitter = (Math.random() * 0.6 - 0.3) * baseIntervalMs; // ±30%
  return Math.max(0, Math.round(index * baseIntervalMs + jitter));
}

/**
 * Confirmação de consentimento/risco antes do 1º agendamento ou início de uma
 * campanha — em AMBOS os canais, com texto diferente por canal:
 * - 'meta': consentimento de marketing (opt-in) sobre a lista importada — LGPD e
 *   política de mensageria da Meta (ver CAMPANHAS_ARQUITETURA.md §3.4/§5.4).
 * - 'evolution': risco de banimento do próprio número pelo WhatsApp (mesmo número
 *   que serve core/atende/copiloto) — ver CAMPANHAS_ARQUITETURA.md §8.
 * Uma vez confirmado, fica salvo na campanha (consentConfirmedAt/Ip) — não pede
 * de novo em pause/resume, só na primeira vez que ela é agendada ou iniciada.
 */
function requireConsentAcknowledgement(campanha: { channel: string; consentConfirmedAt: Date | null }, body: any): string | null {
  if (campanha.consentConfirmedAt) return null;
  if (body?.confirmConsent === true) return null;
  return campanha.channel === 'evolution'
    ? 'Confirme que entende o risco de banimento do seu número pelo WhatsApp ao usar o canal Evolution (confirmConsent: true).'
    : 'Confirme que tem consentimento (opt-in) destes contatos para campanhas de marketing, conforme LGPD e política da Meta (confirmConsent: true).';
}

export default async function campanhasRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any).authenticate, requireModule('campanhas')] };

  // ── GET / — lista campanhas do usuário ───────────────────────────────────
  app.get('/', auth, async (req: any) => {
    const userId = req.user.sub;
    const campanhas = await prisma.campanha.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, status: true, channel: true, templateName: true,
        audienceCount: true, sentCount: true,
        startedAt: true, completedAt: true, createdAt: true,
        whatsappNumber: { select: { id: true, phoneNumber: true, displayName: true } },
      },
    });
    if (campanhas.length === 0) return { campanhas: [] };

    const grouped = await prisma.campanhaContato.groupBy({
      by: ['campanhaId', 'status'],
      where: { campanhaId: { in: campanhas.map((c: any) => c.id) } },
      _count: true,
    });
    const statsByCampanha = new Map<string, Record<string, number>>();
    for (const g of grouped) {
      const m = statsByCampanha.get(g.campanhaId) || {};
      m[g.status] = g._count;
      statsByCampanha.set(g.campanhaId, m);
    }

    return { campanhas: campanhas.map((c: any) => ({ ...c, stats: statsByCampanha.get(c.id) || {} })) };
  });

  // ── GET /templates — templates aprovados do WABA conectado ──────────────
  app.get('/templates', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const numberId = (req.query as any)?.whatsappNumberId as string | undefined;

    const whatsappNumber = numberId
      ? await prisma.whatsappNumber.findFirst({ where: { id: numberId, userId, provider: 'meta' } })
      : await prisma.whatsappNumber.findFirst({ where: { userId, provider: 'meta' } });

    if (!whatsappNumber || !whatsappNumber.metaAccessTokenEnc || !whatsappNumber.metaWabaId) {
      return reply.code(400).send({
        error: 'Nenhum WhatsApp oficial (Meta) conectado.',
        message: 'Conecte um número via API oficial da Meta em /dashboard/numeros antes de criar uma campanha.',
      });
    }

    try {
      const token = decryptStr(whatsappNumber.metaAccessTokenEnc);
      const templates = await listTemplates(token, whatsappNumber.metaWabaId);
      return { templates: templates.filter((t) => t.status === 'APPROVED') };
    } catch (err: any) {
      return reply.code(502).send({ error: err.message || 'Falha ao buscar templates da Meta.' });
    }
  });

  // ── GET /optouts — lista de opt-out do usuário ───────────────────────────
  app.get('/optouts', auth, async (req: any) => {
    const userId = req.user.sub;
    const optOuts = await prisma.campanhaOptOut.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return { optOuts };
  });

  // ── GET /numeros-evolution — números Evolution conectados do usuário ────
  // Só o que o canal 'evolution' precisa pra listar (id/nome/telefone) — endpoint
  // próprio pra não mexer em routes/numbers.ts (usado por telas fora de Campanhas).
  app.get('/numeros-evolution', auth, async (req: any) => {
    const userId = req.user.sub;
    const numeros = await prisma.whatsappNumber.findMany({
      where: { userId, provider: 'evolution', status: 'connected', isPublic: false },
      orderBy: { createdAt: 'desc' },
      select: { id: true, phoneNumber: true, displayName: true },
    });
    return { numeros };
  });

  // ── POST / — cria campanha (rascunho) ────────────────────────────────────
  app.post('/', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const v = validateRequest(createCampanhaSchema)(req.body);
    if (!v.valid) return reply.code(400).send({ error: v.error });
    const { name, whatsappNumberId, channel, templateName, templateLanguage, templateComponents, messageBody } = v.data;

    const whatsappNumber = await prisma.whatsappNumber.findFirst({
      where: { id: whatsappNumberId, userId, provider: channel },
    });
    if (!whatsappNumber) {
      return reply.code(400).send({
        error: channel === 'meta'
          ? 'Número Meta inválido ou não pertence a este usuário.'
          : 'Número Evolution inválido ou não pertence a este usuário.',
      });
    }

    const campanha = await prisma.campanha.create({
      data: {
        userId, whatsappNumberId, name, channel,
        templateName:     channel === 'meta' ? templateName : null,
        templateLanguage,
        templateComponents: channel === 'meta' ? templateComponents : undefined,
        messageBody:      channel === 'evolution' ? messageBody : null,
      },
    });

    return reply.code(201).send({ campanha });
  });

  // ── GET /:id — detalhe da campanha ───────────────────────────────────────
  app.get('/:id', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { id } = req.params;

    const campanha = await prisma.campanha.findFirst({
      where: { id, userId },
      include: { whatsappNumber: { select: { id: true, phoneNumber: true, displayName: true } } },
    });
    if (!campanha) return reply.code(404).send({ error: 'Campanha não encontrada.' });

    const grouped = await prisma.campanhaContato.groupBy({
      by: ['status'],
      where: { campanhaId: id },
      _count: true,
    });
    const stats: Record<string, number> = {};
    for (const g of grouped) stats[g.status] = g._count;

    return { campanha, stats };
  });

  // ── GET /:id/contatos — lista contatos (paginado, filtro por status) ────
  app.get('/:id/contatos', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { id } = req.params;
    const campanha = await ownedCampanha(userId, id);
    if (!campanha) return reply.code(404).send({ error: 'Campanha não encontrada.' });

    const query = req.query as any;
    const limit  = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(query.offset, 10) || 0, 0);
    const where = { campanhaId: id, ...(query.status ? { status: String(query.status) } : {}) };

    const [contatos, total] = await Promise.all([
      prisma.campanhaContato.findMany({ where, orderBy: { createdAt: 'asc' }, skip: offset, take: limit }),
      prisma.campanhaContato.count({ where }),
    ]);

    return { contatos, total, limit, offset };
  });

  // ── DELETE /:id — remove campanha em rascunho ────────────────────────────
  app.delete('/:id', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { id } = req.params;
    const campanha = await ownedCampanha(userId, id);
    if (!campanha) return reply.code(404).send({ error: 'Campanha não encontrada.' });
    if (!['draft', 'scheduled'].includes(campanha.status)) {
      return reply.code(400).send({ error: 'Só é possível excluir campanhas em rascunho ou agendadas.' });
    }
    await prisma.campanha.delete({ where: { id } });
    return reply.send({ ok: true });
  });

  // ── POST /:id/contatos/from-conversas — audiência "quente" (canal evolution) ─
  // Único jeito de popular contatos de uma campanha evolution — nunca CSV livre
  // (guardrail server-side, não só de UI, ver CAMPANHAS_ARQUITETURA.md §8).
  app.post('/:id/contatos/from-conversas', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { id } = req.params;
    const campanha = await ownedCampanha(userId, id);
    if (!campanha) return reply.code(404).send({ error: 'Campanha não encontrada.' });
    if (campanha.channel !== 'evolution') {
      return reply.code(400).send({ error: 'Este endpoint é só para campanhas do canal Evolution.' });
    }
    if (campanha.status !== 'draft') {
      return reply.code(400).send({ error: 'Só é possível adicionar contatos a campanhas em rascunho.' });
    }

    const [warmContacts, optOuts, existing] = await Promise.all([
      warmContactsForNumber(campanha.whatsappNumberId),
      prisma.campanhaOptOut.findMany({ where: { userId }, select: { phone: true } }),
      prisma.campanhaContato.findMany({ where: { campanhaId: id }, select: { phone: true } }),
    ]);
    const optOutSet   = new Set(optOuts.map((o: any) => o.phone));
    const existingSet = new Set(existing.map((e: any) => e.phone));

    let skippedOptOut = 0;
    let skippedDuplicate = 0;
    const toCreate: { campanhaId: string; phone: string; name: string | null }[] = [];
    for (const [phone, name] of warmContacts) {
      if (optOutSet.has(phone)) { skippedOptOut++; continue; }
      if (existingSet.has(phone)) { skippedDuplicate++; continue; }
      toCreate.push({ campanhaId: id, phone, name });
    }

    if (toCreate.length > 0) {
      await prisma.campanhaContato.createMany({ data: toCreate });
      await prisma.campanha.update({
        where: { id },
        data: { audienceCount: { increment: toCreate.length } },
      });
    }

    return reply.send({ imported: toCreate.length, skippedOptOut, skippedDuplicate, elegiveis: warmContacts.size });
  });

  // ── POST /:id/contatos — upload de CSV (telefone,nome,var1,var2,...) ────
  // Só para campanhas do canal 'meta' — evolution usa /from-conversas (guardrail).
  app.post('/:id/contatos', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { id } = req.params;
    const campanha = await ownedCampanha(userId, id);
    if (!campanha) return reply.code(404).send({ error: 'Campanha não encontrada.' });
    if (campanha.channel === 'evolution') {
      return reply.code(400).send({
        error: 'Campanhas via Evolution só aceitam contatos que já conversaram com o número — use "Importar contatos que já falaram com você".',
      });
    }
    if (campanha.status !== 'draft') {
      return reply.code(400).send({ error: 'Só é possível adicionar contatos a campanhas em rascunho.' });
    }

    let csvText: string | null = null;
    for await (const part of req.parts()) {
      if (part.type === 'file' && part.fieldname === 'file') {
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) chunks.push(chunk);
        const buffer = Buffer.concat(chunks);
        if (buffer.length > 5 * 1024 * 1024) {
          return reply.code(400).send({ error: 'Arquivo muito grande (máx 5MB).' });
        }
        csvText = buffer.toString('utf-8');
      }
    }
    if (!csvText) return reply.code(400).send({ error: 'Envie um arquivo CSV no campo "file".' });

    const delimiter = detectDelimiter(csvText);
    const rows = parseCsv(csvText, delimiter);
    if (rows.length === 0) return reply.code(400).send({ error: 'CSV vazio.' });

    // Pula cabeçalho se a 1ª célula da 1ª linha não parecer telefone
    const dataRows = PHONE_LIKE.test(rows[0][0] || '') ? rows : rows.slice(1);
    if (dataRows.length === 0) return reply.code(400).send({ error: 'Nenhum contato encontrado no CSV.' });

    const [optOuts, existing] = await Promise.all([
      prisma.campanhaOptOut.findMany({ where: { userId }, select: { phone: true } }),
      prisma.campanhaContato.findMany({ where: { campanhaId: id }, select: { phone: true } }),
    ]);
    const optOutSet   = new Set(optOuts.map((o: any) => o.phone));
    const existingSet = new Set(existing.map((e: any) => e.phone));

    const seen = new Set<string>();
    let skippedOptOut = 0;
    let skippedInvalid = 0;
    let skippedDuplicate = 0;
    const toCreate: { campanhaId: string; phone: string; name: string | null; variables: string[] | undefined }[] = [];

    for (const row of dataRows) {
      const rawPhone = row[0] || '';
      if (!PHONE_LIKE.test(rawPhone)) { skippedInvalid++; continue; }
      const phone = normalizePhone(rawPhone);
      if (phone.length < 12 || phone.length > 15) { skippedInvalid++; continue; }
      if (optOutSet.has(phone)) { skippedOptOut++; continue; }
      if (existingSet.has(phone) || seen.has(phone)) { skippedDuplicate++; continue; }
      seen.add(phone);

      const name = row[1]?.trim() || null;
      const vars = row.slice(2).filter((v) => v.length > 0);

      toCreate.push({ campanhaId: id, phone, name, variables: vars.length ? vars : undefined });
    }

    if (toCreate.length > 0) {
      await prisma.campanhaContato.createMany({ data: toCreate });
      await prisma.campanha.update({
        where: { id },
        data: { audienceCount: { increment: toCreate.length } },
      });
    }

    return reply.send({ imported: toCreate.length, skippedOptOut, skippedInvalid, skippedDuplicate });
  });

  // ── POST /:id/schedule — agenda o início automático do disparo ──────────
  app.post('/:id/schedule', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { id } = req.params;
    const campanha = await ownedCampanha(userId, id);
    if (!campanha) return reply.code(404).send({ error: 'Campanha não encontrada.' });
    if (!['draft', 'scheduled'].includes(campanha.status)) {
      return reply.code(400).send({ error: `Campanha em status "${campanha.status}" não pode ser agendada.` });
    }
    if (campanha.audienceCount === 0) {
      return reply.code(400).send({ error: 'Adicione contatos antes de agendar a campanha.' });
    }

    const v = validateRequest(scheduleCampanhaSchema)(req.body);
    if (!v.valid) return reply.code(400).send({ error: v.error });
    const { scheduledAt } = v.data;
    if (scheduledAt.getTime() <= Date.now()) {
      return reply.code(400).send({ error: 'A data agendada precisa estar no futuro.' });
    }

    const consentError = requireConsentAcknowledgement(campanha, req.body);
    if (consentError) return reply.code(400).send({ error: consentError });

    const whatsappNumber = await prisma.whatsappNumber.findUnique({ where: { id: campanha.whatsappNumberId } });
    if (!numberReadyToSend(whatsappNumber, campanha.channel)) {
      return reply.code(400).send({
        error: campanha.channel === 'evolution'
          ? 'Número Evolution desconectado. Reconecte em /dashboard/numeros.'
          : 'Número Meta desconectado. Reconecte em /dashboard/numeros.',
      });
    }

    const updated = await prisma.campanha.update({
      where: { id },
      data: {
        status: 'scheduled', scheduledAt,
        ...(!campanha.consentConfirmedAt
          ? { consentConfirmedAt: new Date(), consentConfirmedIp: req.ip }
          : {}),
      },
    });
    return reply.send({ campanha: updated });
  });

  // ── POST /:id/unschedule — cancela o agendamento, volta a rascunho ──────
  app.post('/:id/unschedule', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { id } = req.params;
    const campanha = await ownedCampanha(userId, id);
    if (!campanha) return reply.code(404).send({ error: 'Campanha não encontrada.' });
    if (campanha.status !== 'scheduled') {
      return reply.code(400).send({ error: 'Só é possível cancelar o agendamento de campanhas agendadas.' });
    }
    const updated = await prisma.campanha.update({
      where: { id },
      data: { status: 'draft', scheduledAt: null },
    });
    return reply.send({ campanha: updated });
  });

  // ── POST /:id/start — inicia (ou retoma após pausa/agendamento) o disparo ─
  app.post('/:id/start', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { id } = req.params;
    const campanha = await ownedCampanha(userId, id);
    if (!campanha) return reply.code(404).send({ error: 'Campanha não encontrada.' });
    if (!['draft', 'paused', 'scheduled'].includes(campanha.status)) {
      return reply.code(400).send({ error: `Campanha em status "${campanha.status}" não pode ser iniciada.` });
    }
    if (campanha.audienceCount === 0) {
      return reply.code(400).send({ error: 'Adicione contatos antes de iniciar a campanha.' });
    }

    const consentError = requireConsentAcknowledgement(campanha, req.body);
    if (consentError) return reply.code(400).send({ error: consentError });

    const whatsappNumber = await prisma.whatsappNumber.findUnique({ where: { id: campanha.whatsappNumberId } });
    if (!numberReadyToSend(whatsappNumber, campanha.channel)) {
      return reply.code(400).send({
        error: campanha.channel === 'evolution'
          ? 'Número Evolution desconectado. Reconecte em /dashboard/numeros.'
          : 'Número Meta desconectado. Reconecte em /dashboard/numeros.',
      });
    }

    const pendentes = await prisma.campanhaContato.findMany({
      where: { campanhaId: id, status: 'pending' },
      select: { id: true },
    });
    if (pendentes.length === 0) {
      return reply.code(400).send({ error: 'Nenhum contato pendente de envio nesta campanha.' });
    }

    await prisma.campanha.update({
      where: { id },
      data: {
        status: 'running', startedAt: campanha.startedAt ?? new Date(),
        ...(!campanha.consentConfirmedAt
          ? { consentConfirmedAt: new Date(), consentConfirmedIp: req.ip }
          : {}),
      },
    });

    // jobId determinístico (campanhaId:contatoId) — reenviar /start não duplica jobs em voo.
    // Canal evolution: delay crescente + jitter (evolutionSendDelayMs) — ritmo lento
    // e "humano" em vez do disparo imediato em lote do canal Meta.
    await campanhasQueue.addBulk(
      pendentes.map((p: any, i: number) => ({
        name: 'send',
        data: { campanhaId: id, contatoId: p.id },
        opts: {
          jobId: `${id}:${p.id}`,
          ...(campanha.channel === 'evolution' ? { delay: evolutionSendDelayMs(i) } : {}),
        },
      })),
    );

    return reply.send({ ok: true, enqueued: pendentes.length });
  });

  // ── POST /:id/pause — pausa campanha em execução ─────────────────────────
  // Jobs já na fila continuam sendo consumidos, mas o worker reconfere o status
  // antes de enviar e não age (contato permanece 'pending'); /start reenfileira.
  app.post('/:id/pause', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { id } = req.params;
    const campanha = await ownedCampanha(userId, id);
    if (!campanha) return reply.code(404).send({ error: 'Campanha não encontrada.' });
    if (campanha.status !== 'running') {
      return reply.code(400).send({ error: 'Só é possível pausar campanhas em execução.' });
    }
    await prisma.campanha.update({ where: { id }, data: { status: 'paused' } });
    return reply.send({ ok: true });
  });

  // ── POST /:id/cancel — cancela definitivamente ───────────────────────────
  app.post('/:id/cancel', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { id } = req.params;
    const campanha = await ownedCampanha(userId, id);
    if (!campanha) return reply.code(404).send({ error: 'Campanha não encontrada.' });
    if (!['running', 'paused', 'draft'].includes(campanha.status)) {
      return reply.code(400).send({ error: 'Campanha já finalizada.' });
    }
    await prisma.campanha.update({ where: { id }, data: { status: 'canceled', completedAt: new Date() } });
    return reply.send({ ok: true });
  });
}
