import type { FastifyInstance } from 'fastify';
import adminOrgRoutes from './adminOrg';
import adminSecurityRoutes from './adminSecurity';
import adminUsersRoutes from './adminUsers';

/** Rotas /admin/*: órgão, setores, feriados (adminOrg), usuários (adminUsers), tokens de API e auditoria (adminSecurity). */
export default async function adminRoutes(app: FastifyInstance): Promise<void> {
  await app.register(adminOrgRoutes);
  await app.register(adminUsersRoutes);
  await app.register(adminSecurityRoutes);
}
