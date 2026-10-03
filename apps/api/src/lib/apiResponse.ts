import type { FastifyReply } from 'fastify';
import { ApiError, isApiError, errorDocUrl, type ErrorCode } from './apiErrors';

/**
 * Resposta de erro das rotas da plataforma — item 6 do escopo ZapScript × Twilio,
 * portado SEM quebrar o contrato já publicado da API pública v1.
 *
 * A v1 (docs/API_PUBLICA_V1.md) devolve `{ error: "<frase>" }`, e há integração
 * em produção lendo esse campo como string. Trocar por um objeto aninhado
 * quebraria todas elas de uma vez. Então o código do catálogo entra AO LADO,
 * aditivo:
 *
 *   {
 *     "error": "Template não encontrado no WABA deste número.",
 *     "code":  "template.not_found",
 *     "docUrl": "https://zapscript.me/docs/erros/template.not_found",
 *     "retryable": false
 *   }
 *
 * Quem já lê `error` continua funcionando; quem quiser programar passa a ter
 * `code`, que é estável (a frase não é — muda com qualquer revisão de texto).
 */

export interface ErrorResponseBody {
  error: string;
  code: string;
  docUrl: string;
  retryable: boolean;
  details?: unknown;
}

export function errorBody(err: ApiError): ErrorResponseBody {
  return {
    error:     err.message,
    code:      err.code,
    docUrl:    errorDocUrl(err.code),
    retryable: err.retryable,
    ...(err.details !== undefined ? { details: err.details } : {}),
  };
}

/** Responde com o status do catálogo e o corpo acima. */
export function sendError(
  reply: FastifyReply,
  codeOrError: ErrorCode | ApiError,
  opts: { message?: string; details?: unknown } = {},
): FastifyReply {
  const err = isApiError(codeOrError)
    ? (codeOrError as ApiError)
    : new ApiError(codeOrError as ErrorCode, { message: opts.message, details: opts.details });
  return reply.code(err.status).send(errorBody(err));
}
