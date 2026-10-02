import type { FastifyInstance, FastifyReply } from 'fastify';
import { ApiError, isApiError, type ErrorCode } from './apiErrors';

/**
 * Cola entre o catálogo de erros (lib/apiErrors.ts, puro) e o Fastify.
 * Vive separado porque o worker importa o catálogo e não tem Fastify.
 */

/**
 * Responde no envelope público. Aceita um código do catálogo ou um ApiError já
 * construído. `req` entra só para carimbar o request_id (Fastify já gera um por
 * requisição) — é o que o suporte pede para achar a linha no log.
 */
export function sendApiError(
  reply: FastifyReply,
  codeOrError: ErrorCode | ApiError,
  opts: { message?: string; details?: unknown; requestId?: string } = {},
): FastifyReply {
  const err = isApiError(codeOrError)
    ? codeOrError
    : new ApiError(codeOrError, { message: opts.message, details: opts.details });
  const requestId = opts.requestId ?? (reply.request as any)?.id;
  return reply.code(err.status).send(err.toEnvelope(requestId));
}

/**
 * Handler de erro para as rotas da API pública: qualquer ApiError que escape de
 * um handler sai no envelope público em vez do `{ statusCode, error, message }`
 * padrão do Fastify. Registrado por plugin (scope do Fastify), para não mudar
 * o formato de erro das rotas antigas do painel.
 */
export function registerPublicErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err, req, reply) => {
    if (isApiError(err)) {
      return reply.code((err as ApiError).status).send((err as ApiError).toEnvelope(req.id));
    }

    // Erros do próprio Fastify que já carregam status (rate limit, payload
    // grande, JSON malformado) são traduzidos para o catálogo — o integrador
    // continua vendo sempre a mesma forma de erro.
    const status = (err as any)?.statusCode;
    if (status === 429) {
      return reply.code(429).send(new ApiError('request.rate_limited').toEnvelope(req.id));
    }
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return reply.code(status).send(
        new ApiError('request.invalid', { message: (err as Error).message }).toEnvelope(req.id),
      );
    }

    req.log.error({ err }, '[PublicAPI] erro não tratado');
    return reply.code(500).send(new ApiError('internal.error').toEnvelope(req.id));
  });
}
