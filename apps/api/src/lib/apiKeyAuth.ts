import crypto from 'crypto';
import { FastifyReply } from 'fastify';
import { prisma } from './prisma';

/**
 * API pública ZapScript 2.0 (tier Empresas) — autenticação por chave (não usa
 * o JWT de sessão). O valor real do token só existe no momento da criação;
 * dali em diante só o hash (SHA-256) fica no banco — ver ApiKey no schema.
 */

export const ALLOWED_SCOPES = ['conversations:read', 'contacts:read'] as const;
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
 */
export function requireApiKey(scopes: ApiScope[]) {
  return async (req: any, reply: FastifyReply) => {
    const header = req.headers['x-api-key'];
    const token = typeof header === 'string' ? header.trim() : '';
    if (!token) {
      reply.code(401).send({ error: 'Envie a chave no header X-Api-Key.' });
      return reply;
    }

    const key = await prisma.apiKey.findUnique({ where: { keyHash: hashApiKey(token) } });
    if (!key || key.revokedAt) {
      reply.code(401).send({ error: 'Chave inválida ou revogada.' });
      return reply;
    }

    const missing = scopes.find((s) => !key.scopes.includes(s));
    if (missing) {
      reply.code(403).send({ error: `Esta chave não tem o escopo "${missing}".` });
      return reply;
    }

    req.apiKeyUserId = key.userId;
    prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => null);
  };
}
