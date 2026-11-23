import type { FastifyReply, FastifyRequest } from 'fastify';
import { bvAuth, sendError } from '../core/http';
import { can, type Permission } from '../core/permissions';
import { IamError } from './service';

/** preHandler que exige QUALQUER uma das permissões (OR). Token de API só passa com o escopo explícito. */
export function guardAny(...perms: Permission[]) {
  return [bvAuth, async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = req.bv;
    if (!ctx) return sendError(reply, 401, 'auth.missing_token', 'Autenticação necessária');
    const ok = ctx.via === 'api-token'
      ? perms.some((p) => (ctx.scopes ?? []).includes(p)) && !perms.some((p) => p === 'user:manage' || p === 'security:manage' || p === 'org:manage')
      : perms.some((p) => can(ctx.role, p));
    if (!ok) return sendError(reply, 403, 'auth.forbidden', 'Sem permissão para esta ação');
  }];
}

type Handler = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

/** Converte IamError (regras de negócio) em resposta HTTP padronizada; outros erros seguem para o handler global. */
export function route(h: Handler): Handler {
  return async (req, reply) => {
    try {
      return await h(req, reply);
    } catch (e) {
      if (e instanceof IamError) return sendError(reply, e.status, e.code, e.message, e.details);
      throw e;
    }
  };
}

/** Escapa uma célula de CSV (aspas) e neutraliza injeção de fórmula em planilhas (= + - @). */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const csvRow = (cells: unknown[]) => cells.map(csvCell).join(',');
