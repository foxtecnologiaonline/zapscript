process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-12345678901234567890';

import crypto from 'crypto';
import Fastify from 'fastify';
import { prisma } from '../../../lib/prisma';
import { ingestInbound } from '../../core/conversations';
import { createArticle } from '../kb';
import type { LlmClient, LlmRequest, LlmResult } from '../llm';

/** LLM falso: fila de respostas (texto ou função) + resposta padrão. Nenhuma rede. */
export class FakeLlm implements LlmClient {
  calls: LlmRequest[] = [];
  queue: Array<string | ((req: LlmRequest) => string) | Error> = [];
  fallback: (req: LlmRequest) => string = (req) => groundedBot(req);
  async complete(req: LlmRequest): Promise<LlmResult> {
    this.calls.push(req);
    const r = this.queue.shift() ?? this.fallback;
    if (r instanceof Error) throw r;
    const text = typeof r === 'function' ? r(req) : r;
    return { text, model: `fake-${req.tier}`, inputTokens: 120, outputTokens: 30 };
  }
  reset() { this.calls = []; this.queue = []; this.fallback = (req) => groundedBot(req); }
}

export const articleIds = (req: LlmRequest) => [...req.user.matchAll(/\[ID: ([^\]]+)\]/g)].map((m) => m[1]);

/** Resposta ancorada típica: usa o 1º artigo recuperado; sem artigo → needsHuman. */
export function groundedBot(req: LlmRequest, over: Record<string, unknown> = {}): string {
  const ids = articleIds(req);
  if (req.label !== 'bv.bot') {
    if (req.label === 'bv.assist') return JSON.stringify({ suggestion: 'Olá! Segue a orientação do artigo.', confidence: 0.8, usedArticleIds: ids.slice(0, 1) });
    if (req.label === 'bv.summary') return JSON.stringify({ summary: 'Cidadão pede segunda via de certidão.', intent: 'segunda_via_certidao', pending: ['enviar link'], keyFacts: ['certidão de nascimento'] });
    if (req.label === 'bv.curation') {
      const q = req.user.match(/1\. (.+)/)?.[1] ?? 'pergunta';
      return JSON.stringify({ title: `Artigo: ${q.slice(0, 60)}`, question: q, answer: 'Resposta consolidada a partir do que os atendentes informaram; revisar antes de publicar.', category: 'curadoria', tags: ['curadoria'] });
    }
  }
  if (!ids.length) return JSON.stringify({ answer: '', confidence: 0.2, intent: 'assunto_desconhecido', category: null, needsHuman: true, usedArticleIds: [], toolCall: null, ...over });
  return JSON.stringify({ answer: 'Para a segunda via, acesse o portal do órgão e informe os dados. O prazo é de 5 dias úteis.', confidence: 0.92, intent: 'segunda_via_certidao', category: 'certidoes', needsHuman: false, usedArticleIds: [ids[0]], toolCall: null, ...over });
}

export async function seedApproved(orgId: string, a: { title: string; question: string; answer: string; tags?: string[]; category?: string }) {
  const art = await createArticle(orgId, null, { ...a, category: a.category ?? 'certidoes' });
  return prisma.bvKbArticle.update({ where: { id: art.id }, data: { status: 'APPROVED', approvedAt: new Date() } });
}

export const CERTIDAO = {
  title: 'Como emitir a segunda via da certidão de nascimento',
  question: 'Como solicitar a segunda via da certidão de nascimento?',
  answer: 'Acesse o portal do órgão, informe os dados do registro e pague a taxa. O prazo é de 5 dias úteis.',
};

export const ref = () => `v-${crypto.randomBytes(4).toString('hex')}`;

export async function say(orgId: string, channelRef: string, body: string, extra: { metadata?: Record<string, unknown> } = {}) {
  const r = await ingestInbound({ orgId, channel: 'WEBCHAT', channelRef, externalId: channelRef, name: 'Cidadão', message: { body }, metadata: extra.metadata });
  return { conversationId: r.conversation.id, payload: { orgId, conversationId: r.conversation.id, messageId: r.message!.id, channel: 'WEBCHAT', status: r.conversation.status } };
}

export const getConv = (id: string) => prisma.bvConversation.findUniqueOrThrow({ where: { id } });

/** App Fastify só com a frente de IA sob /balcao (isola dos demais plugins do Balcão). */
export async function buildAiApp() {
  const app = Fastify({ logger: false });
  const { default: ai } = await import('../index');
  await app.register(ai, { prefix: '/balcao' });
  await app.ready();
  return app;
}
