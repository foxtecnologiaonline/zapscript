import type { FastifyInstance } from 'fastify';
import { registerAdminRoutes } from './admin';
import { registerEprocRoutes } from './eproc-routes';
import { registerEprocTool } from './eproc';
import { registerGovbrRoutes, registerGovbrTool } from './govbr';
import { registerGoogleRoutes } from './google';
import { registerJiraRoutes, subscribeJiraEvents } from './jira';
import { registerOidcRoutes } from './oidc';

export { buildGovbrLoginUrl } from './govbr';
export { consultarProcesso } from './eproc';

/**
 * Integrações (e-Proc/MNI, GOV.BR, IdP do TJTO, Google Workspace, Jira) — prefixo /balcao/integrations.
 * Rotas públicas (cidadão/IdP/webhook): /govbr/*, /oidc/*, /jira/webhook. As demais exigem JWT do Balcão + permissão.
 */
export default async function plugin(app: FastifyInstance): Promise<void> {
  registerAdminRoutes(app);
  registerEprocRoutes(app);
  registerGovbrRoutes(app);
  registerOidcRoutes(app);
  registerGoogleRoutes(app);
  registerJiraRoutes(app);
  registerEprocTool();
  registerGovbrTool();
  subscribeJiraEvents();
}
