import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { ConversationError } from '../core/conversations';
import { sendError } from '../core/http';
import { registerRoutingHandlers } from './handlers';
import { registerRoutingJobs } from './sweep';
import { agentRoutes } from './routes/agents';
import { cannedRoutes } from './routes/canned';
import { contactRoutes } from './routes/contacts';
import { conversationRoutes } from './routes/conversations';
import { queueRoutes } from './routes/queues';
import { ruleRoutes } from './routes/rules';
import { supervisorRoutes } from './routes/supervisor';

/**
 * Frente routing — roteamento (ACD), caixa de entrada, filas, supervisão, contatos e respostas prontas.
 * Rotas: /conversations, /queues, /routing-rules, /supervisor, /contacts, /agents, /canned-responses
 * (sob /balcao). Documentação: docs/balcao/api-routing.md.
 */
export default async function plugin(app: FastifyInstance): Promise<void> {
  registerRoutingHandlers();
  registerRoutingJobs();

  // O app de produção já registra @fastify/multipart (teto 15 MB); o app de teste não.
  if (!app.hasRequestDecorator('isMultipart')) await app.register(multipart, { limits: { fileSize: 15 * 1024 * 1024, files: 1 } });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    if (err instanceof ConversationError) return sendError(reply, err.status, err.code, err.message);
    if (err.code === 'FST_REQ_FILE_TOO_LARGE') return sendError(reply, 413, 'attachment.too_large', 'Arquivo acima de 15 MB');
    if (err.statusCode && err.statusCode < 500) return sendError(reply, err.statusCode, err.code?.toLowerCase().replace(/^fst_err_/, 'request.') ?? 'request.invalid', 'Requisição inválida');
    req.log.error({ err: err.message }, '[balcao/routing] erro não tratado');
    return sendError(reply, 500, 'internal', 'Erro interno');
  });

  await conversationRoutes(app);
  await queueRoutes(app);
  await ruleRoutes(app);
  await agentRoutes(app);
  await supervisorRoutes(app);
  await contactRoutes(app);
  await cannedRoutes(app);
}
