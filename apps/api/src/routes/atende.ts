import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { requireModuleShared, requireTeamRole } from '../lib/teamScope';
import {
  validateRequest,
  atendeConfigSchema,
  atendeKbCreateSchema,
  atendeKbUpdateSchema,
  avisoCreateSchema,
} from '../lib/validation';
import {
  transcribeVoiceSetup,
  extractTextFromImage,
  structureWithClaude,
  AiInputError,
} from '../services/ai-input';
import { sendText } from '../services/evolution';

const DEFAULT_FALLBACK = 'Recebemos sua mensagem! Já já alguém te responde por aqui.';

const BUSINESS_CONTEXT_PROMPT = `Você recebe a transcrição de um áudio (ou a leitura de uma foto) em que o dono de um negócio descreve, com as próprias palavras, do que se trata o negócio: produtos, serviços, diferenciais, horário de funcionamento, políticas, forma de atendimento etc.

Reescreva isso em um parágrafo único, claro e objetivo, em português brasileiro, para servir como o "contexto do negócio" de um atendente virtual de WhatsApp — a única fonte de verdade que ele vai usar para responder clientes. NÃO invente nenhuma informação que não foi dita. NÃO adicione saudação, comentário ou explicação fora do parágrafo.

Responda SOMENTE com um objeto JSON válido, sem markdown, no formato:
{ "businessContext": "texto do contexto, pronto para uso" }`;

const KB_IMPORT_PROMPT = `Você recebe um texto (transcrição de áudio, ou leitura de uma foto de cardápio/tabela/anotação) em que o dono de um negócio fala ou mostra informações que clientes costumam perguntar: preços, produtos, serviços, horários, formas de pagamento, políticas etc.

Extraia isso como uma lista de perguntas e respostas (FAQ) para servir de base de conhecimento de um atendente virtual de WhatsApp. Cada item deve ter uma pergunta objetiva (como um cliente perguntaria de verdade) e uma resposta completa, baseada SOMENTE no que foi dito/mostrado. NÃO invente informação. Gere quantos itens fizerem sentido (normalmente entre 3 e 15).

Responda SOMENTE com um array JSON válido, sem markdown, no formato:
[{ "question": "...", "answer": "..." }]`;

const FROM_HISTORY_PROMPT = `Você recebe uma lista de pares reais de pergunta-resposta extraídos do histórico de conversas de WhatsApp de um negócio: a pergunta de um cliente de verdade, seguida da resposta que o DONO do negócio (uma pessoa, não uma IA) deu de próprio punho ao assumir a conversa.

Sua tarefa é aprender com esses pares reais e gerar duas coisas:
1. "businessContextSuggestion": um parágrafo com informações novas ou mais precisas que ficaram evidentes nessas respostas (preços, políticas, diferenciais, forma de atender). Se os pares não revelarem nada de genuinamente novo além do óbvio, retorne null.
2. "kbSuggestions": uma lista para a base de conhecimento — reescreva os pares como um FAQ genérico e reutilizável (a pergunta como um cliente normalmente perguntaria, a resposta completa baseada SOMENTE no que o dono respondeu de verdade). Agrupe/mescle perguntas parecidas num único item. NÃO invente nenhuma informação que não esteja nos pares.

Responda SOMENTE com um objeto JSON válido, sem markdown, no formato:
{ "businessContextSuggestion": "texto ou null", "kbSuggestions": [{ "question": "...", "answer": "..." }] }`;

const KB_STOPWORDS = new Set(['a','o','as','os','de','do','da','dos','das','um','uma','e','ou','que','pra','para','com','sem','em','no','na','por','se']);
function kbTokenize(text: string): Set<string> {
  return new Set(
    text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().match(/[a-z0-9]+/g)
      ?.filter((w) => w.length > 2 && !KB_STOPWORDS.has(w)) ?? [],
  );
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Marca itens sugeridos de importação de KB que parecem duplicar uma pergunta
 * já cadastrada (similaridade de palavras >= 0.6), em vez de descartar — quem
 * decide se é de fato duplicata é o dono, confirmando ou ignorando no front.
 */
async function markPossibleDuplicates(userId: string, items: { question: string; answer: string }[]) {
  if (items.length === 0) return [];
  const existing = await prisma.atendeKnowledgeBase.findMany({ where: { userId }, select: { question: true } });
  const existingTokens = existing.map((e: any) => ({ question: e.question, tokens: kbTokenize(e.question) }));

  return items.map((it) => {
    const itTokens = kbTokenize(it.question);
    let best: { question: string; score: number } | null = null;
    for (const e of existingTokens) {
      const score = jaccard(itTokens, e.tokens);
      if (score >= 0.6 && (!best || score > best.score)) best = { question: e.question, score };
    }
    return { ...it, possibleDuplicateOf: best?.question ?? null };
  });
}

/** Extrai o texto bruto de um único arquivo (áudio ou imagem) enviado via multipart. */
async function readSingleUpload(req: any): Promise<{ buffer: Buffer; mimetype: string } | null> {
  for await (const part of req.parts()) {
    if (part.type === 'file') {
      const chunks: Buffer[] = [];
      for await (const chunk of part.file) chunks.push(chunk);
      return { buffer: Buffer.concat(chunks), mimetype: part.mimetype };
    }
  }
  return null;
}

/**
 * Rotas do módulo ZapScript Atende (resposta automática por IA no WhatsApp).
 * Todas exigem entitlement ativo do DONO dos dados — ver requireModuleShared()
 * (teamScope.ts), que resolve o compartilhamento de time: membros do time do
 * dono (Empresas) enxergam/atuam nos mesmos dados, não numa conta separada.
 *
 * `auth`       — qualquer papel do time (agent+): ver/responder conversas.
 * `authManage` — manager+: configurar o bot e a base de conhecimento.
 */
export default async function atendeRoutes(app: FastifyInstance) {
  const auth       = { preHandler: [(app as any).authenticate, requireModuleShared('atende')] };
  const authManage = { preHandler: [(app as any).authenticate, requireModuleShared('atende'), requireTeamRole('manager')] };

  // ── GET /atende/config/:numberId ─────────────────────────────────────────
  app.get<{ Params: { numberId: string } }>('/config/:numberId', authManage, async (req: any, reply) => {
    const { ownerId } = req.teamScope;
    const { numberId } = req.params;

    const number = await prisma.whatsappNumber.findFirst({ where: { id: numberId, userId: ownerId } });
    if (!number) return reply.code(404).send({ error: 'Número não encontrado' });

    const config = await prisma.atendeConfig.findUnique({ where: { numberId } });
    // Sem config ainda é estado normal (número nunca configurou o Atende) — devolve
    // o shape default em vez de 404, pra UI renderizar o form sem tratamento especial.
    return config ?? {
      numberId,
      userId: ownerId,
      enabled: false,
      businessContext: null,
      tone: 'profissional-amigavel',
      fallbackMessage: DEFAULT_FALLBACK,
      escalationPhone: null,
      confidenceLevel: 'equilibrado',
      digestFrequency: 'off',
    };
  });

  // ── PUT /atende/config/:numberId ─────────────────────────────────────────
  app.put<{ Params: { numberId: string }; Body: any }>('/config/:numberId', authManage, async (req: any, reply) => {
    const { ownerId } = req.teamScope;
    const { numberId } = req.params;

    const v = validateRequest(atendeConfigSchema)(req.body);
    if (!v.valid) return reply.code(400).send({ error: v.error });

    const number = await prisma.whatsappNumber.findFirst({ where: { id: numberId, userId: ownerId } });
    if (!number) return reply.code(404).send({ error: 'Número não encontrado' });

    const data = v.data;

    // Mesma convenção de numbers.ts: números guardados com DDI 55 — é o formato
    // que sendMessageViaEvolution/WhatsApp esperam.
    let escalationPhone: string | null | undefined = undefined;
    if (data.escalationPhone !== undefined) {
      if (data.escalationPhone === null) {
        escalationPhone = null;
      } else {
        const digits = data.escalationPhone.replace(/\D/g, '');
        escalationPhone = digits.startsWith('55') ? digits : `55${digits}`;
      }
    }

    const config = await prisma.atendeConfig.upsert({
      where: { numberId },
      update: { ...data, ...(escalationPhone !== undefined ? { escalationPhone } : {}) },
      create: {
        numberId,
        userId: ownerId,
        enabled: data.enabled ?? false,
        businessContext: data.businessContext,
        tone: data.tone ?? 'profissional-amigavel',
        fallbackMessage: data.fallbackMessage ?? DEFAULT_FALLBACK,
        escalationPhone: escalationPhone ?? null,
        confidenceLevel: data.confidenceLevel ?? 'equilibrado',
        digestFrequency: data.digestFrequency ?? 'off',
      },
    });

    return config;
  });

  // ── POST /atende/setup/voice-context ─────────────────────────────────────
  // Feature 1: dono grava um áudio curto descrevendo o negócio → devolve uma
  // SUGESTÃO de businessContext (texto), pronta para revisão no SuggestionReview.
  // Não salva nada — o front confirma via PUT /config/:numberId normalmente.
  app.post('/setup/voice-context', {
    ...authManage,
    config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
  }, async (req: any, reply) => {
    try {
      const upload = await readSingleUpload(req);
      if (!upload) return reply.code(400).send({ error: 'Envie um arquivo de áudio.' });

      const { ownerId } = req.teamScope;
      const transcript = await transcribeVoiceSetup(upload.buffer, upload.mimetype);
      const { businessContext } = await structureWithClaude<{ businessContext: string }>(
        transcript, BUSINESS_CONTEXT_PROMPT, { userId: ownerId, feature: 'atende_setup_voice' },
      );
      return { transcript, businessContext };
    } catch (err: any) {
      if (err instanceof AiInputError) return reply.code(422).send({ error: err.message });
      req.log.error({ err: err.message }, '[Atende] Falha no setup por voz');
      return reply.code(500).send({ error: 'Falha ao processar o áudio. Tente novamente.' });
    }
  });

  // ── POST /atende/setup/kb-import ─────────────────────────────────────────
  // Feature 2: importação em massa da KB por voz OU foto (cardápio, tabela de
  // preços, anotação). Detecta o tipo pelo mimetype do upload. Devolve uma lista
  // de sugestões — nada é salvo até o front confirmar via POST /kb (um por item).
  app.post('/setup/kb-import', {
    ...authManage,
    config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
  }, async (req: any, reply) => {
    try {
      const { ownerId } = req.teamScope;
      const upload = await readSingleUpload(req);
      if (!upload) return reply.code(400).send({ error: 'Envie um áudio ou uma foto.' });

      const isImage = upload.mimetype.startsWith('image/');
      const rawText = isImage
        ? await extractTextFromImage(upload.buffer, upload.mimetype, { userId: ownerId, feature: 'atende_setup_kb_import' })
        : await transcribeVoiceSetup(upload.buffer, upload.mimetype);

      const parsed = await structureWithClaude<any>(rawText, KB_IMPORT_PROMPT, { userId: ownerId, feature: 'atende_setup_kb_import' });
      const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : [];

      const clean = items
        .filter((it: any) => it?.question && it?.answer)
        .map((it: any) => ({ question: String(it.question), answer: String(it.answer) }));

      return { rawText, items: await markPossibleDuplicates(ownerId, clean) };
    } catch (err: any) {
      if (err instanceof AiInputError) return reply.code(422).send({ error: err.message });
      req.log.error({ err: err.message }, '[Atende] Falha na importação de KB');
      return reply.code(500).send({ error: 'Falha ao processar o arquivo. Tente novamente.' });
    }
  });

  // ── POST /atende/setup/from-history ──────────────────────────────────────
  // Feature 5: gera sugestões de businessContext + KB a partir de respostas
  // REAIS que o dono já deu (humanAuthored=true, capturadas via fromMe no
  // webhook durante takeover — ver evolution-webhook.ts). Sem histórico
  // suficiente, devolve pairs=0 sem chamar a IA (nada a estruturar).
  app.post('/setup/from-history', {
    ...authManage,
    config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
  }, async (req: any, reply) => {
    try {
      const { ownerId } = req.teamScope;

      const humanReplies = await prisma.atendeMessage.findMany({
        where: { humanAuthored: true, conversation: { userId: ownerId } },
        orderBy: { createdAt: 'desc' },
        take: 60,
        select: { conversationId: true },
      });
      if (humanReplies.length === 0) {
        return { pairs: 0, businessContextSuggestion: null, kbSuggestions: [] };
      }

      const conversationIds = [...new Set(humanReplies.map((r: any) => r.conversationId))];
      const allMessages = await prisma.atendeMessage.findMany({
        where: { conversationId: { in: conversationIds } },
        orderBy: { createdAt: 'asc' },
        select: { conversationId: true, direction: true, content: true, humanAuthored: true },
      });

      // Cada resposta humana pareada com a pergunta do cliente imediatamente
      // anterior na mesma conversa — o par real "cliente perguntou, dono respondeu".
      const byConversation = new Map<string, typeof allMessages>();
      for (const m of allMessages) {
        const list = byConversation.get(m.conversationId) ?? [];
        list.push(m);
        byConversation.set(m.conversationId, list);
      }
      const pairs: { question: string; answer: string }[] = [];
      for (const msgs of byConversation.values()) {
        let lastIn: string | null = null;
        for (const m of msgs) {
          if (m.direction === 'in') {
            lastIn = m.content;
          } else if (m.humanAuthored && lastIn) {
            pairs.push({ question: lastIn, answer: m.content });
            lastIn = null;
          }
        }
      }
      if (pairs.length === 0) {
        return { pairs: 0, businessContextSuggestion: null, kbSuggestions: [] };
      }

      const transcript = pairs
        .slice(0, 40)
        .map((p, i) => `${i + 1}. Cliente: ${p.question}\nDono: ${p.answer}`)
        .join('\n\n');
      const result = await structureWithClaude<{
        businessContextSuggestion: string | null;
        kbSuggestions: { question: string; answer: string }[];
      }>(transcript, FROM_HISTORY_PROMPT, { userId: ownerId, feature: 'atende_setup_from_history' });

      const kbClean = Array.isArray(result.kbSuggestions)
        ? result.kbSuggestions
            .filter((it: any) => it?.question && it?.answer)
            .map((it: any) => ({ question: String(it.question), answer: String(it.answer) }))
        : [];

      return {
        pairs: pairs.length,
        businessContextSuggestion: result.businessContextSuggestion || null,
        kbSuggestions: await markPossibleDuplicates(ownerId, kbClean),
      };
    } catch (err: any) {
      if (err instanceof AiInputError) return reply.code(422).send({ error: err.message });
      req.log.error({ err: err.message }, '[Atende] Falha ao gerar sugestões do histórico');
      return reply.code(500).send({ error: 'Falha ao analisar o histórico. Tente novamente.' });
    }
  });

  // ── GET /atende/kb ────────────────────────────────────────────────────────
  app.get('/kb', authManage, async (req: any) => {
    return prisma.atendeKnowledgeBase.findMany({
      where:   { userId: req.teamScope.ownerId },
      orderBy: { createdAt: 'desc' },
    });
  });

  // ── POST /atende/kb ───────────────────────────────────────────────────────
  app.post<{ Body: { question: string; answer: string } }>('/kb', authManage, async (req: any, reply) => {
    const v = validateRequest(atendeKbCreateSchema)(req.body);
    if (!v.valid) return reply.code(400).send({ error: v.error });

    const entry = await prisma.atendeKnowledgeBase.create({
      data: {
        userId:   req.teamScope.ownerId,
        question: v.data.question.trim(),
        answer:   v.data.answer.trim(),
      },
    });
    return reply.code(201).send(entry);
  });

  // ── PUT /atende/kb/:id ────────────────────────────────────────────────────
  app.put<{ Params: { id: string }; Body: any }>('/kb/:id', authManage, async (req: any, reply) => {
    const { ownerId } = req.teamScope;
    const { id } = req.params;

    const existing = await prisma.atendeKnowledgeBase.findFirst({ where: { id, userId: ownerId } });
    if (!existing) return reply.code(404).send({ error: 'Item não encontrado' });

    const v = validateRequest(atendeKbUpdateSchema)(req.body);
    if (!v.valid) return reply.code(400).send({ error: v.error });

    if (Object.keys(v.data).length === 0) {
      return reply.code(400).send({ error: 'Nenhum campo para atualizar.' });
    }

    const data: any = { ...v.data };
    if (data.question) data.question = data.question.trim();
    if (data.answer)   data.answer   = data.answer.trim();

    return prisma.atendeKnowledgeBase.update({ where: { id }, data });
  });

  // ── DELETE /atende/kb/:id ─────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/kb/:id', authManage, async (req: any, reply) => {
    const { ownerId } = req.teamScope;
    const { id } = req.params;

    const existing = await prisma.atendeKnowledgeBase.findFirst({ where: { id, userId: ownerId } });
    if (!existing) return reply.code(404).send({ error: 'Item não encontrado' });

    await prisma.atendeKnowledgeBase.delete({ where: { id } });
    return reply.code(204).send();
  });

  // ── GET /atende/conversations ─────────────────────────────────────────────
  app.get('/conversations', auth, async (req: any) => {
    const conversations = await prisma.atendeConversation.findMany({
      where:   { userId: req.teamScope.ownerId },
      orderBy: { lastMessageAt: 'desc' },
      take:    100,
      include: {
        number:   { select: { id: true, displayName: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    return conversations.map((c: any) => ({
      id:            c.id,
      contactPhone:  c.contactPhone,
      contactName:   c.contactName,
      status:        c.status,
      humanTakeover: c.humanTakeover,
      lastMessageAt: c.lastMessageAt,
      number:        c.number,
      lastMessage:   c.messages[0] ?? null,
    }));
  });

  // ── GET /atende/conversations/:id/messages ────────────────────────────────
  app.get<{ Params: { id: string } }>('/conversations/:id/messages', auth, async (req: any, reply) => {
    const { ownerId } = req.teamScope;
    const { id } = req.params;

    const conversation = await prisma.atendeConversation.findFirst({ where: { id, userId: ownerId } });
    if (!conversation) return reply.code(404).send({ error: 'Conversa não encontrada' });

    const messages = await prisma.atendeMessage.findMany({
      where:   { conversationId: id },
      orderBy: { createdAt: 'asc' },
      take:    200,
    });

    return { conversation, messages };
  });

  // ── POST /atende/conversations/:id/takeover ───────────────────────────────
  // Dono assume a conversa manualmente — desliga a resposta automática só aqui.
  app.post<{ Params: { id: string } }>('/conversations/:id/takeover', auth, async (req: any, reply) => {
    const { ownerId } = req.teamScope;
    const { id } = req.params;

    const conversation = await prisma.atendeConversation.findFirst({ where: { id, userId: ownerId } });
    if (!conversation) return reply.code(404).send({ error: 'Conversa não encontrada' });

    return prisma.atendeConversation.update({ where: { id }, data: { humanTakeover: true } });
  });

  // ── POST /atende/conversations/:id/reply ──────────────────────────────────
  // Feature 6: dono responde direto pelo inbox do ZapScript (sem abrir o
  // WhatsApp), enquanto a conversa está sob takeover — reaproveita sendText()
  // (mesmo helper de convites/campanhas/health-monitor) e grava a mensagem
  // como humanAuthored=true, alimentando também a Feature 5.
  app.post<{ Params: { id: string }; Body: { message?: string } }>('/conversations/:id/reply', auth, async (req: any, reply) => {
    const { ownerId } = req.teamScope;
    const { id } = req.params;
    const message = (req.body?.message || '').trim();
    if (!message) return reply.code(400).send({ error: 'Mensagem vazia.' });

    const conversation = await prisma.atendeConversation.findFirst({
      where: { id, userId: ownerId },
      include: { number: { select: { zapiInstanceId: true } } },
    });
    if (!conversation) return reply.code(404).send({ error: 'Conversa não encontrada' });
    if (!conversation.humanTakeover) {
      return reply.code(409).send({ error: 'Assuma a conversa antes de responder manualmente.' });
    }
    if (!conversation.number?.zapiInstanceId) {
      return reply.code(422).send({ error: 'Número não está conectado.' });
    }

    try {
      await sendText(conversation.number.zapiInstanceId, conversation.contactPhone, message);
    } catch (err: any) {
      req.log.error({ err: err.message }, '[Atende] Falha ao enviar resposta manual');
      return reply.code(502).send({ error: 'Falha ao enviar a mensagem pelo WhatsApp.' });
    }

    const saved = await prisma.atendeMessage.create({
      data: { conversationId: id, direction: 'out', content: message, humanAuthored: true },
    });
    await prisma.atendeConversation.update({ where: { id }, data: { lastMessageAt: new Date() } });

    return saved;
  });

  // ── POST /atende/conversations/:id/release ────────────────────────────────
  // Devolve a conversa para o bot (contrapartida do takeover).
  app.post<{ Params: { id: string } }>('/conversations/:id/release', auth, async (req: any, reply) => {
    const { ownerId } = req.teamScope;
    const { id } = req.params;

    const conversation = await prisma.atendeConversation.findFirst({ where: { id, userId: ownerId } });
    if (!conversation) return reply.code(404).send({ error: 'Conversa não encontrada' });

    return prisma.atendeConversation.update({ where: { id }, data: { humanTakeover: false } });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Avisos (tier Profissional) — disparo manual de mensagem pro cliente do
  // usuário (ex.: "pagamento hoje", "mercadoria pronta pra retirada").
  // Categorias fixas no MVP. Qualquer papel do time pode enviar (agent+),
  // igual à permissão de responder conversas.
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/avisos', auth, async (req: any) => {
    return prisma.aviso.findMany({
      where:   { userId: req.teamScope.ownerId },
      orderBy: { createdAt: 'desc' },
      take:    100,
    });
  });

  app.post<{ Body: any }>('/avisos', auth, async (req: any, reply) => {
    const { ownerId } = req.teamScope;
    const v = validateRequest(avisoCreateSchema)(req.body);
    if (!v.valid) return reply.code(400).send({ error: v.error });

    const number = await prisma.whatsappNumber.findFirst({ where: { id: v.data.numberId, userId: ownerId } });
    if (!number) return reply.code(404).send({ error: 'Número não encontrado' });
    if (!number.zapiInstanceId) return reply.code(422).send({ error: 'Número não está conectado.' });

    try {
      await sendText(number.zapiInstanceId, v.data.contactPhone, v.data.message);
    } catch (err: any) {
      req.log.error({ err: err.message }, '[Atende] Falha ao enviar aviso');
      return reply.code(502).send({ error: 'Falha ao enviar a mensagem pelo WhatsApp.' });
    }

    const aviso = await prisma.aviso.create({
      data: {
        userId:       ownerId,
        numberId:     v.data.numberId,
        contactPhone: v.data.contactPhone,
        contactName:  v.data.contactName,
        category:     v.data.category,
        message:      v.data.message,
      },
    });
    return reply.code(201).send(aviso);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Dashboard — métricas simples de atendimento e efetividade (tier
  // Profissional). Lê só dados já existentes (AtendeConversation/Message).
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/dashboard', auth, async (req: any) => {
    const { ownerId } = req.teamScope;
    const days  = Math.min(365, Math.max(1, parseInt((req.query as any)?.days, 10) || 30));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

    // 3 buckets mutuamente exclusivos (antes só existia "sem takeover" vs "com
    // takeover", que misturava conversa de fato resolvida com conversa ainda
    // aberta aguardando o cliente): resolvida automaticamente (bot atendeu e
    // não escalou), escalada (bot pediu ajuda e ninguém assumiu ainda) e sob
    // takeover (dono/equipe assumiu manualmente).
    const [conversasNoPeriodo, conversasHoje, resolvidasAuto, escaladasPendentes, sobTakeover, mensagensEnviadas, mensagensRecebidas] = await Promise.all([
      prisma.atendeConversation.count({ where: { userId: ownerId, createdAt: { gte: since } } }),
      prisma.atendeConversation.count({ where: { userId: ownerId, createdAt: { gte: todayStart } } }),
      prisma.atendeConversation.count({ where: { userId: ownerId, createdAt: { gte: since }, humanTakeover: false, status: { not: 'escalated' } } }),
      prisma.atendeConversation.count({ where: { userId: ownerId, createdAt: { gte: since }, humanTakeover: false, status: 'escalated' } }),
      prisma.atendeConversation.count({ where: { userId: ownerId, createdAt: { gte: since }, humanTakeover: true } }),
      prisma.atendeMessage.count({ where: { direction: 'out', createdAt: { gte: since }, conversation: { userId: ownerId } } }),
      prisma.atendeMessage.count({ where: { direction: 'in', createdAt: { gte: since }, conversation: { userId: ownerId } } }),
    ]);

    const taxaResolucaoAutomatica = conversasNoPeriodo > 0
      ? Math.round((resolvidasAuto / conversasNoPeriodo) * 100)
      : 0;

    return {
      periodDays: days,
      conversasNoPeriodo,
      conversasHoje,
      conversasResolvidasAuto: resolvidasAuto,
      conversasEscaladas: escaladasPendentes,
      conversasSobTakeover: sobTakeover,
      taxaResolucaoAutomatica,
      mensagensEnviadas,
      mensagensRecebidas,
    };
  });
}
