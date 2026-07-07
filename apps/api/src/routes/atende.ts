import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { sendAtendeReply } from '../services/atende-send';
import { rewriteDraft } from '../services/atende-agent';

/**
 * Painel do ZapScript Atende — rotas do ASSINANTE (não do admin fundador).
 * Tudo é escopado a req.user.sub (o dono da conta). A fila aqui é a do próprio
 * assinante: mensagens dos clientes DELE, classificadas e com rascunho.
 */
export default async function atendeRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any).authenticate] };

  // Carrega a mensagem garantindo que pertence ao assinante autenticado.
  async function loadOwnedMensagem(mensagemId: string, userId: string) {
    const msg = await prisma.atendeMensagem.findUnique({
      where:   { id: mensagemId },
      include: { conversa: true },
    });
    if (!msg || msg.conversa.userId !== userId) return null;
    return msg;
  }

  async function tenantConfig(userId: string) {
    return prisma.atendeConfig.findUnique({ where: { userId } });
  }

  // ── GET /atende/config ──────────────────────────────────────────────────
  app.get('/config', auth, async (req: any) => {
    const userId = req.user.sub;
    const cfg = await tenantConfig(userId);
    // Fase 1: `ativo` é gate manual do admin; o assinante não o liga sozinho.
    return {
      habilitado:          !!cfg?.ativo,
      autoEnvioAtivo:      cfg?.autoEnvioAtivo ?? false,
      categoriasSensiveis: cfg?.categoriasSensiveis ?? [],
      toneOverride:        cfg?.toneOverride ?? null,
      negocioDescricao:    cfg?.negocioDescricao ?? null,
    };
  });

  // ── PUT /atende/config ──────────────────────────────────────────────────
  // Kill switch (autoEnvioAtivo) + categorias sensíveis + tom + descrição.
  // NÃO permite ligar `ativo` (gate do admin na Fase 1).
  app.put<{ Body: { autoEnvioAtivo?: boolean; categoriasSensiveis?: string[]; toneOverride?: string | null; negocioDescricao?: string | null } }>(
    '/config',
    auth,
    async (req: any, reply) => {
      const userId = req.user.sub;
      const cfg = await tenantConfig(userId);
      if (!cfg || !cfg.ativo) {
        return reply.code(403).send({ error: 'Atende não está habilitado nesta conta.' });
      }
      const b = req.body || {};
      const categorias = Array.isArray(b.categoriasSensiveis)
        ? b.categoriasSensiveis.map((s: any) => String(s).trim()).filter(Boolean).slice(0, 50)
        : undefined;

      const updated = await prisma.atendeConfig.update({
        where: { userId },
        data: {
          autoEnvioAtivo:      typeof b.autoEnvioAtivo === 'boolean' ? b.autoEnvioAtivo : undefined,
          categoriasSensiveis: categorias,
          toneOverride:        b.toneOverride === undefined ? undefined : (b.toneOverride || null),
          negocioDescricao:    b.negocioDescricao === undefined ? undefined : (b.negocioDescricao || null),
        },
      });
      return {
        autoEnvioAtivo:      updated.autoEnvioAtivo,
        categoriasSensiveis: updated.categoriasSensiveis,
        toneOverride:        updated.toneOverride,
        negocioDescricao:    updated.negocioDescricao,
      };
    }
  );

  // ── GET /atende/queue ───────────────────────────────────────────────────
  // Conversas com mensagens pendentes de aprovação (fila do assinante).
  app.get<{ Querystring: { status?: string } }>('/queue', auth, async (req: any) => {
    const userId = req.user.sub;
    const statusFilter = req.query.status || 'pending_approval';

    const mensagens = await prisma.atendeMensagem.findMany({
      where:   { status: statusFilter, conversa: { userId } },
      orderBy: { criadoEm: 'desc' },
      take:    100,
      include: { conversa: { select: { id: true, remoteJid: true, contatoNome: true, resumoAtual: true } } },
    });

    return {
      total: mensagens.length,
      mensagens: mensagens.map(m => ({
        id:                m.id,
        conversaId:        m.conversaId,
        contatoNome:       m.conversa.contatoNome,
        remoteJid:         m.conversa.remoteJid,
        resumoConversa:    m.conversa.resumoAtual,
        categoria:         m.categoria,
        prioridade:        m.prioridade,
        confiancaResposta: m.confiancaResposta,
        requerEscalacao:   m.requerEscalacao,
        categoriaSensivel: m.categoriaSensivel,
        rascunho:          m.rascunho,
        criadoEm:          m.criadoEm,
      })),
    };
  });

  // ── GET /atende/conversa/:id ────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/conversa/:id', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const conversa = await prisma.atendeConversa.findUnique({
      where:   { id: req.params.id },
      include: {
        pendencias: { where: { resolvida: false }, orderBy: { criadoEm: 'desc' } },
        mensagens:  { orderBy: { criadoEm: 'desc' }, take: 50 },
      },
    });
    if (!conversa || conversa.userId !== userId) {
      return reply.code(404).send({ error: 'Conversa não encontrada.' });
    }
    return conversa;
  });

  // ── POST /atende/mensagem/:id/approve ───────────────────────────────────
  // Aprova e envia o rascunho (opcionalmente editado) ao cliente.
  app.post<{ Params: { id: string }; Body: { texto?: string } }>(
    '/mensagem/:id/approve',
    auth,
    async (req: any, reply) => {
      const userId = req.user.sub;
      const msg = await loadOwnedMensagem(req.params.id, userId);
      if (!msg) return reply.code(404).send({ error: 'Mensagem não encontrada.' });
      if (msg.status === 'sent') return reply.code(409).send({ error: 'Mensagem já enviada.' });

      const texto = (req.body?.texto ?? msg.rascunho ?? '').trim();
      if (!texto) return reply.code(400).send({ error: 'Sem texto para enviar.' });

      try {
        await sendAtendeReply(msg.conversa.numberId, msg.conversa.remoteJid, texto);
      } catch (err: any) {
        app.log.error({ err: err.message }, '[Atende] Falha ao enviar aprovação');
        return reply.code(502).send({ error: `Falha ao enviar: ${err.message}` });
      }

      const updated = await prisma.atendeMensagem.update({
        where: { id: msg.id },
        data:  { status: 'sent', respostaFinal: texto, enviadoEm: new Date() },
      });
      return { sent: true, id: updated.id };
    }
  );

  // ── POST /atende/mensagem/:id/regenerate ────────────────────────────────
  // Reescreve o rascunho segundo uma instrução (não reenvia).
  app.post<{ Params: { id: string }; Body: { instrucao?: string } }>(
    '/mensagem/:id/regenerate',
    auth,
    async (req: any, reply) => {
      const userId = req.user.sub;
      const msg = await loadOwnedMensagem(req.params.id, userId);
      if (!msg) return reply.code(404).send({ error: 'Mensagem não encontrada.' });
      const instrucao = (req.body?.instrucao ?? 'Deixe mais claro e cordial.').trim();

      const cfg = await tenantConfig(userId);
      const novo = await rewriteDraft(msg.rascunho ?? '', instrucao, {
        toneOverride:        cfg?.toneOverride,
        negocioDescricao:    cfg?.negocioDescricao,
        categoriasSensiveis: cfg?.categoriasSensiveis,
      });
      const updated = await prisma.atendeMensagem.update({
        where: { id: msg.id },
        data:  { rascunho: novo },
      });
      return { id: updated.id, rascunho: novo };
    }
  );

  // ── POST /atende/mensagem/:id/escalate ──────────────────────────────────
  // Marca como escalado (fica com o humano; nunca auto-enviado).
  app.post<{ Params: { id: string } }>('/mensagem/:id/escalate', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const msg = await loadOwnedMensagem(req.params.id, userId);
    if (!msg) return reply.code(404).send({ error: 'Mensagem não encontrada.' });
    const updated = await prisma.atendeMensagem.update({
      where: { id: msg.id },
      data:  { status: 'escalated', requerEscalacao: true },
    });
    return { id: updated.id, status: updated.status };
  });

  // ── POST /atende/mensagem/:id/spam ──────────────────────────────────────
  app.post<{ Params: { id: string } }>('/mensagem/:id/spam', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const msg = await loadOwnedMensagem(req.params.id, userId);
    if (!msg) return reply.code(404).send({ error: 'Mensagem não encontrada.' });
    const updated = await prisma.atendeMensagem.update({ where: { id: msg.id }, data: { status: 'spam' } });
    return { id: updated.id, status: updated.status };
  });

  // ── POST /atende/pendencia/:id/resolve ──────────────────────────────────
  app.post<{ Params: { id: string } }>('/pendencia/:id/resolve', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const pend = await prisma.atendePendencia.findUnique({
      where: { id: req.params.id }, include: { conversa: { select: { userId: true } } },
    });
    if (!pend || pend.conversa.userId !== userId) return reply.code(404).send({ error: 'Pendência não encontrada.' });
    await prisma.atendePendencia.update({ where: { id: pend.id }, data: { resolvida: true } });
    return { id: pend.id, resolvida: true };
  });
}
