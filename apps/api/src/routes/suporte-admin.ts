import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { sendOnChannel } from '../services/support-send';
import { runSupportAgent, Canal } from '../services/support-agent';
import { io } from '../index';

/**
 * Painel admin — Fila de aprovação do Agente de Suporte (MÓDULO 3 + 5 + 7).
 * Montado sob /sys/g5r8t2/suporte. Autenticação por x-admin-token (ADMIN_TOKEN).
 */

function safeCompare(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

const adminAuth = async (req: any, reply: any) => {
  const token = req.headers['x-admin-token'] as string | undefined;
  if (!safeCompare(token, process.env.ADMIN_TOKEN)) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
};

export default async function suporteAdminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', adminAuth);

  // ── Fila de aprovação ─────────────────────────────────────────────────────
  app.get<{ Querystring: { status?: string; canal?: string; limit?: string; offset?: string } }>(
    '/queue',
    async (req) => {
      const { status, canal } = req.query;
      const limit = Math.min(parseInt(req.query.limit || '50', 10), 100);
      const offset = parseInt(req.query.offset || '0', 10);

      const where: any = {};
      where.status = status || 'pending_approval';
      if (canal) where.canal = canal;

      const [items, total] = await Promise.all([
        prisma.supportAtendimento.findMany({
          where,
          orderBy: [{ prioridade: 'asc' }, { criadoEm: 'asc' }], // urgentes/antigos primeiro
          take: limit,
          skip: offset,
        }),
        prisma.supportAtendimento.count({ where }),
      ]);

      // contagem rápida para o cabeçalho da fila
      const urgentes = await prisma.supportAtendimento.count({
        where: { status: 'pending_approval', prioridade: 'urgente' },
      });

      return { items, total, urgentes };
    }
  );

  // ── Atendimento individual ────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/atendimento/:id', async (req, reply) => {
    const at = await prisma.supportAtendimento.findUnique({ where: { id: req.params.id } });
    if (!at) return reply.code(404).send({ error: 'Atendimento não encontrado' });
    return at;
  });

  // ── Aprovar e enviar (opcionalmente com texto editado) ───────────────────
  app.post<{ Params: { id: string }; Body: { resposta?: string } }>(
    '/atendimento/:id/approve',
    async (req, reply) => {
      const at = await prisma.supportAtendimento.findUnique({ where: { id: req.params.id } });
      if (!at) return reply.code(404).send({ error: 'Atendimento não encontrado' });
      if (at.status === 'sent' || at.status === 'resolved') {
        return reply.code(409).send({ error: 'Atendimento já foi respondido' });
      }

      const edited = typeof req.body?.resposta === 'string' && req.body.resposta.trim().length > 0;
      const texto = (edited ? req.body!.resposta! : at.respostaFinal || at.rascunhoAgente || '').trim();
      if (!texto) return reply.code(400).send({ error: 'Sem texto de resposta para enviar' });

      try {
        await sendOnChannel(at, texto);
      } catch (err: any) {
        app.log.error({ err: err.message }, '[Suporte] Falha ao enviar resposta');
        return reply.code(502).send({ error: `Falha ao enviar: ${err.message}` });
      }

      const now = new Date();
      const updated = await prisma.supportAtendimento.update({
        where: { id: at.id },
        data: {
          respostaFinal: texto,
          editadoPeloAdmin: edited || at.editadoPeloAdmin,
          status: 'sent',
          aprovadoEm: now,
          enviadoEm: now,
          resolvidoEm: now,
        },
      });
      io.to('admin:suporte').emit('suporte:atualizado', { id: at.id, status: 'sent' });
      return { ok: true, atendimento: updated };
    }
  );

  // ── Salvar edição do rascunho sem enviar ──────────────────────────────────
  app.post<{ Params: { id: string }; Body: { resposta: string } }>(
    '/atendimento/:id/edit',
    async (req, reply) => {
      const texto = (req.body?.resposta || '').trim();
      if (!texto) return reply.code(400).send({ error: 'resposta obrigatória' });
      const updated = await prisma.supportAtendimento.update({
        where: { id: req.params.id },
        data: { respostaFinal: texto, editadoPeloAdmin: true },
      }).catch(() => null);
      if (!updated) return reply.code(404).send({ error: 'Atendimento não encontrado' });
      return { ok: true, atendimento: updated };
    }
  );

  // ── Pedir nova versão ao agente (com instrução) ───────────────────────────
  app.post<{ Params: { id: string }; Body: { instrucao?: string } }>(
    '/atendimento/:id/regenerate',
    async (req, reply) => {
      const at = await prisma.supportAtendimento.findUnique({ where: { id: req.params.id } });
      if (!at) return reply.code(404).send({ error: 'Atendimento não encontrado' });

      try {
        const result = await runSupportAgent({
          message: at.mensagemOriginal,
          canal: at.canal as Canal,
          clienteNome: at.clienteNome,
          instrucaoRevisao: req.body?.instrucao || null,
        });
        const updated = await prisma.supportAtendimento.update({
          where: { id: at.id },
          data: {
            rascunhoAgente: result.rascunho,
            respostaFinal: null,
            editadoPeloAdmin: false,
            instrucaoRevisao: req.body?.instrucao || null,
            confiancaResposta: result.classificacao.confianca_resposta,
            contextoUsado: result.contextoUsado,
          },
        });
        return { ok: true, atendimento: updated };
      } catch (err: any) {
        return reply.code(502).send({ error: `Falha ao gerar nova versão: ${err.message}` });
      }
    }
  );

  // ── Escalar para humano ───────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/atendimento/:id/escalate', async (req, reply) => {
    const updated = await prisma.supportAtendimento.update({
      where: { id: req.params.id },
      data: { status: 'escalated', requerEscalacao: true },
    }).catch(() => null);
    if (!updated) return reply.code(404).send({ error: 'Atendimento não encontrado' });
    io.to('admin:suporte').emit('suporte:atualizado', { id: req.params.id, status: 'escalated' });
    return { ok: true };
  });

  // ── Marcar como spam ──────────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/atendimento/:id/spam', async (req, reply) => {
    const updated = await prisma.supportAtendimento.update({
      where: { id: req.params.id },
      data: { status: 'spam' },
    }).catch(() => null);
    if (!updated) return reply.code(404).send({ error: 'Atendimento não encontrado' });
    return { ok: true };
  });

  // ── Métricas (MÓDULO 7) ───────────────────────────────────────────────────
  app.get('/metrics', async () => {
    const [porStatus, porCanal, porCategoria, total, editados, escalados] = await Promise.all([
      prisma.supportAtendimento.groupBy({ by: ['status'], _count: true }),
      prisma.supportAtendimento.groupBy({ by: ['canal'], _count: true }),
      prisma.supportAtendimento.groupBy({ by: ['categoria'], _count: true }),
      prisma.supportAtendimento.count(),
      prisma.supportAtendimento.count({ where: { editadoPeloAdmin: true, status: 'sent' } }),
      prisma.supportAtendimento.count({ where: { status: 'escalated' } }),
    ]);
    const enviados = porStatus.find((s: any) => s.status === 'sent')?._count ?? 0;
    return {
      total,
      porStatus,
      porCanal,
      porCategoria,
      taxaEdicao: enviados ? Math.round((editados / enviados) * 100) : 0,
      taxaEscalacao: total ? Math.round((escalados / total) * 100) : 0,
    };
  });

  // ── Base de conhecimento ──────────────────────────────────────────────────
  app.get('/knowledge', async () => {
    return prisma.knowledgeBase.findMany({ orderBy: { atualizadoEm: 'desc' } });
  });

  app.post<{ Body: { titulo: string; conteudo: string; categoria?: string; tags?: string[] } }>(
    '/knowledge',
    async (req, reply) => {
      const { titulo, conteudo, categoria, tags } = req.body || ({} as any);
      if (!titulo || !conteudo) return reply.code(400).send({ error: 'titulo e conteudo obrigatórios' });
      const kb = await prisma.knowledgeBase.create({
        data: { titulo, conteudo, categoria: categoria || null, tags: Array.isArray(tags) ? tags : [] },
      });
      return { ok: true, knowledge: kb };
    }
  );

  app.delete<{ Params: { id: string } }>('/knowledge/:id', async (req) => {
    await prisma.knowledgeBase.delete({ where: { id: req.params.id } }).catch(() => null);
    return { ok: true };
  });

  // ── Sugestões de FAQ (MÓDULO 5) ───────────────────────────────────────────
  app.get<{ Querystring: { status?: string } }>('/faq-suggestions', async (req) => {
    return prisma.faqSuggestion.findMany({
      where: { status: req.query.status || 'pending' },
      orderBy: { criadoEm: 'desc' },
    });
  });

  // Aprovar sugestão → vira tópico na base de conhecimento
  app.post<{ Params: { id: string }; Body: { titulo?: string; conteudo?: string; categoria?: string } }>(
    '/faq-suggestions/:id/approve',
    async (req, reply) => {
      const sug = await prisma.faqSuggestion.findUnique({ where: { id: req.params.id } });
      if (!sug) return reply.code(404).send({ error: 'Sugestão não encontrada' });

      const kb = await prisma.knowledgeBase.create({
        data: {
          titulo: req.body?.titulo || sug.tituloSugerido,
          conteudo: req.body?.conteudo || sug.conteudoSugerido,
          categoria: req.body?.categoria || sug.categoria,
          canalOrigem: 'faq_suggestion',
          atendimentoOrigemId: sug.atendimentoOrigemId,
          aprovadoPorAdmin: true,
        },
      });
      await prisma.faqSuggestion.update({
        where: { id: sug.id },
        data: { status: 'approved', revisadoEm: new Date() },
      });
      return { ok: true, knowledge: kb };
    }
  );

  app.post<{ Params: { id: string } }>('/faq-suggestions/:id/ignore', async (req) => {
    await prisma.faqSuggestion.update({
      where: { id: req.params.id },
      data: { status: 'ignored', revisadoEm: new Date() },
    }).catch(() => null);
    return { ok: true };
  });
}
