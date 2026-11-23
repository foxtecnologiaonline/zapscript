import type { FastifyInstance } from 'fastify';
import adminRoutes from './admin';
import authRoutes from './auth';

/**
 * Frente IAM — registrada em balcao/index.ts com prefixo '/'. Rotas finais: /balcao/auth/* e /balcao/admin/*.
 * Doc: docs/balcao/api-iam.md.
 */
export default async function plugin(app: FastifyInstance): Promise<void> {
  await app.register(authRoutes);
  await app.register(adminRoutes);
}
