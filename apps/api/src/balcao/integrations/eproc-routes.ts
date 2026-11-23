import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditReq } from '../core/audit';
import { guard, parse, sendError } from '../core/http';
import { IntegrationError } from './http-client';
import type { Deps } from './common';
import { consultarProcesso, eprocHttpStatus, eprocUserMessage, maskCnj, normalizeCnj } from './eproc';

const params = z.object({ numero: z.string().min(10).max(40) });
const query = z.object({ movimentos: z.enum(['true', 'false']).default('true') });

export function registerEprocRoutes(app: FastifyInstance, deps: Deps = {}): void {
  app.get('/eproc/processo/:numero', { preHandler: guard('conversation:read') }, async (req, reply) => {
    const p = parse(params, req.params, reply);
    const q = p && parse(query, req.query, reply);
    if (!p || !q) return;
    const cnj = normalizeCnj(p.numero);
    const masked = cnj ? maskCnj(cnj) : 'inválido';
    try {
      const { processo } = await consultarProcesso(req.bv!.orgId, p.numero, { movimentos: q.movimentos === 'true' }, deps);
      await auditReq(req, 'eproc.consulta', { entityType: 'processo', entityId: masked, meta: { numero: masked, ok: true } });
      return { processo };
    } catch (err) {
      await auditReq(req, 'eproc.consulta', { entityType: 'processo', entityId: masked, meta: { numero: masked, ok: false, code: err instanceof IntegrationError ? err.code : 'error' } });
      return sendError(reply, eprocHttpStatus(err), err instanceof IntegrationError ? err.code : 'eproc.error', eprocUserMessage(err));
    }
  });
}
