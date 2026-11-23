import Fastify, { type FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { hashPassword } from './passwords';
import { signJwt } from './jwt';
import type { Role } from './types';

/** Helpers de teste (só importar de __tests__). Cada teste cria seu PRÓPRIO órgão — nunca trunque tabelas. */
export async function makeOrg(settings: Record<string, unknown> = {}) {
  const slug = `t-${crypto.randomBytes(5).toString('hex')}`;
  return prisma.bvOrg.create({ data: { name: `Org ${slug}`, slug, settings: settings as any } });
}

export async function makeUser(orgId: string, role: Role = 'ATENDENTE', over: Partial<{ email: string; name: string; password: string; skills: string[]; maxConcurrent: number; presence: string; sectorId: string }> = {}) {
  const n = crypto.randomBytes(4).toString('hex');
  return prisma.bvUser.create({
    data: {
      orgId, role, email: over.email ?? `u${n}@teste.local`, name: over.name ?? `User ${n}`,
      passwordHash: hashPassword(over.password ?? 'SenhaForte12345'), skills: over.skills ?? [], maxConcurrent: over.maxConcurrent ?? 3,
      presence: over.presence ?? 'OFFLINE', sectorId: over.sectorId,
    },
  });
}

/** Cabeçalho Authorization válido para o usuário (sem criar sessão). */
export function authHeader(user: { id: string; orgId: string; role: string }): { authorization: string } {
  return { authorization: `Bearer ${signJwt({ sub: user.id, org: user.orgId, role: user.role, typ: 'access' }, 3600)}` };
}

/** App Fastify mínimo com o plugin do Balcão sob /balcao (+ rawBody para webhooks assinados). */
export async function buildBalcaoTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, trustProxy: true });
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    try { (req as any).rawBody = body; const s = body.toString().trim(); done(null, s ? JSON.parse(s) : {}); } catch (e: any) { done(e); }
  });
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body.toString())));
  });
  const { default: balcao } = await import('../index');
  await app.register(balcao, { prefix: '/balcao' });
  await app.ready();
  return app;
}
