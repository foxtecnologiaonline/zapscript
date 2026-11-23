import type { FastifyInstance } from 'fastify';

/**
 * Balcão Virtual — plugin raiz. Cada frente é um plugin independente com prefixo próprio:
 *   /balcao/auth, /balcao/admin            iam         (login, MFA, usuários, setores, configurações do órgão)
 *   /balcao/conversations|queues|supervisor|contacts  routing  (inbox, filas, ACD, monitoramento)
 *   /balcao/whatsapp                       channels/whatsapp  (broker oficial Meta + webhook)
 *   /balcao/webchat                        channels/webchat   (widget + API do visitante)
 *   /balcao/email                          channels/email     (IMAP/SMTP)
 *   /balcao/voice                          channels/voice     (SIP/URA/gravação)
 *   /balcao/ai | /balcao/kb                ai          (chatbot, base de conhecimento, curadoria)
 *   /balcao/tasks                          tasks       (tarefas internas / service desk)
 *   /balcao/integrations                   integrations (e-Proc, GOV.BR, OIDC, Google, Jira, URA 0800)
 *   /balcao/reports | /balcao/fiscal       reports     (dashboards, KPIs, consumo/cotas, exportações)
 *   /balcao/security                       security    (LGPD, retenção, backup)
 */
export default async function balcaoPlugin(app: FastifyInstance): Promise<void> {
  await app.register(import('./iam'), { prefix: '/' });
  await app.register(import('./routing'), { prefix: '/' });
  await app.register(import('./channels/whatsapp'), { prefix: '/whatsapp' });
  await app.register(import('./channels/webchat'), { prefix: '/webchat' });
  await app.register(import('./channels/email'), { prefix: '/email' });
  await app.register(import('./channels/voice'), { prefix: '/voice' });
  await app.register(import('./ai'), { prefix: '/' });
  await app.register(import('./tasks'), { prefix: '/tasks' });
  await app.register(import('./integrations'), { prefix: '/integrations' });
  await app.register(import('./reports'), { prefix: '/' });
  await app.register(import('./security'), { prefix: '/security' });

  app.get('/health', async () => ({ status: 'ok', module: 'balcao' }));
}
