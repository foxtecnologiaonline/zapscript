import crypto from 'crypto';
import { FastifyReply } from 'fastify';
import { prisma } from './prisma';
import { sendApiError } from './httpErrors';

/**
 * API pública ZapScript 2.0 (tier Empresas) — autenticação por chave (não usa
 * o JWT de sessão). O valor real do token só existe no momento da criação;
 * dali em diante só o hash (SHA-256) fica no banco — ver ApiKey no schema.
 */

/**
 * Escopos da API pública. Leitura e escrita são escopos SEPARADOS de propósito:
 * uma chave de automação que só lê conversas nunca deve poder disparar
 * mensagem no WhatsApp dos contatos do cliente.
 */
export const ALLOWED_SCOPES = [
  'conversations:read',
  'contacts:read',
  // ── Plataforma (escopo ZapScript × Twilio) ──
  'messages:read',   // log de mensagens (item 5)
  'messages:write',  // envio por API (item 1)
  'templates:read',  // listar templates do WABA (item 4)
  'templates:write', // criar/apagar templates (item 4)
  'events:read',     // histórico de eventos (item 2)
  'webhooks:read',   // listar endpoints e entregas (item 2)
  'webhooks:write',  // criar/alterar endpoints (item 2)
  'metrics:read',    // métricas agregadas (item 7)
] as const;
export type ApiScope = typeof ALLOWED_SCOPES[number];

const TOKEN_PREFIX = 'zsk_live_';

/** Gera um novo token (mostrado 1x ao dono) + seu hash e prefixo para persistir. */
export function generateApiKey(): { token: string; keyHash: string; keyPrefix: string } {
  const token = TOKEN_PREFIX + crypto.randomBytes(24).toString('hex');
  return { token, keyHash: hashApiKey(token), keyPrefix: token.slice(0, TOKEN_PREFIX.length + 8) };
}

export function hashApiKey(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * preHandler factory: exige uma API key válida (header `X-Api-Key`), não
 * revogada, com todos os `scopes` pedidos. Em sucesso, grava req.apiKeyUserId
 * (dono do tier Empresas dono da chave) e atualiza lastUsedAt (fire-and-forget).
 *
 * Os erros saem no envelope público com código do catálogo
 * (`auth.key_missing` / `auth.key_invalid` / `auth.scope_missing`) — ver
 * lib/apiErrors.ts. Antes era `{ error: '<frase>' }`, que não dava para
 * programar: o cliente não conseguia distinguir "chave revogada" de "falta
 * escopo" sem comparar texto em português.
 */
export function requireApiKey(scopes: ApiScope[]) {
  return async (req: any, reply: FastifyReply) => {
    const header = req.headers['x-api-key'];
    const token = typeof header === 'string' ? header.trim() : '';
    if (!token) {
      sendApiError(reply, 'auth.key_missing');
      return reply;
    }

    const key = await prisma.apiKey.findUnique({ where: { keyHash: hashApiKey(token) } });
    if (!key || key.revokedAt) {
      sendApiError(reply, 'auth.key_invalid');
      return reply;
    }

    const missing = scopes.find((s) => !key.scopes.includes(s));
    if (missing) {
      sendApiError(reply, 'auth.scope_missing', {
        message: `Esta chave não tem o escopo "${missing}".`,
        details: { required: scopes, missing, granted: key.scopes },
      });
      return reply;
    }

    req.apiKeyId = key.id;

    req.apiKeyUserId = key.userId;
    prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => null);
  };
}
