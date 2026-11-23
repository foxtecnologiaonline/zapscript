import type { FastifyReply, FastifyRequest } from 'fastify';
import { bvAuth, sendError } from '../core/http';
import { can, type Permission } from '../core/permissions';

/**
 * Autoriza se o usuário (JWT) tiver QUALQUER uma das permissões (o `guard` do core exige todas).
 * Tokens de API nunca passam: nada nesta frente é de BI.
 */
export function guardAny(...perms: Permission[]) {
  const check = async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = req.bv;
    if (!ctx) return sendError(reply, 401, 'auth.missing_token', 'Autenticação necessária');
    if (ctx.via !== 'jwt' || !perms.some((p) => can(ctx.role, p))) return sendError(reply, 403, 'auth.forbidden', 'Sem permissão para esta ação');
  };
  return [bvAuth, check];
}
