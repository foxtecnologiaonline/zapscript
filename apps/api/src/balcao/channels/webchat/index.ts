import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { prisma } from '../../../lib/prisma';
import { logger } from '../../../lib/logger';
import { sha256Hex } from '../../core/crypto';
import { getIo } from '../../core/realtime';
import { onBalcaoStart, registerJob } from '../../core/scheduler';
import { env } from './config';
import { demoHtml, SLUG_RE } from './demo';
import { wireWebchatDelivery } from './delivery';
import { registerAgentCaptionRoutes } from './captions';
import { registerPublicRoutes } from './public';
import { attachVisitorNamespace } from './socket';
import { WIDGET_JS } from './widgetSource';

export { attachVisitorNamespace } from './socket';
export { WIDGET_JS } from './widgetSource';

/**
 * Frente webchat — prefixo /balcao/webchat (definido em balcao/index.ts).
 *   GET  /widget.js        script embarcável (CORP cross-site, cache com ETag)
 *   GET  /demo             página de demonstração
 *   *    /public/*         API do visitante (CORS aberto no index.ts; origem validada por órgão)
 *   POST /conversations/:id/caption   legenda do atendente → visitante (relé efêmero; ver captions.ts)
 *   WS   /bv-visitor       namespace Socket.IO do visitante (attachVisitorNamespace)
 */
const WIDGET_ETAG = `"${sha256Hex(WIDGET_JS).slice(0, 32)}"`;

let startHooked = false;

export default async function plugin(app: FastifyInstance): Promise<void> {
  // O index.ts raiz já registra o multipart; em testes (app mínimo) registramos aqui.
  if (!app.hasRequestDecorator('file')) await app.register(multipart, { limits: { fileSize: env.maxAttachmentBytes(), files: 1 } });

  wireWebchatDelivery();

  if (!startHooked) {
    startHooked = true;
    // Conexões longas: o servidor Socket.IO só existe no processo principal — tenta com pequeno backoff.
    onBalcaoStart(() => {
      let attempt = 0;
      const tick = () => {
        const io = getIo();
        if (io) { attachVisitorNamespace(io); logger.info('[webchat] namespace /bv-visitor ativo'); return; }
        if (++attempt <= 10) setTimeout(tick, 500 * attempt).unref();
        else logger.error('[webchat] Socket.IO indisponível — visitantes usarão apenas polling HTTP');
      };
      tick();
    });
    // Sessões antigas guardam IP/user-agent: remove as inativas há mais de 30 dias.
    registerJob('webchat.purge-sessions', { intervalMs: 6 * 3600_000, lockTtlSec: 300 }, async () => {
      const r = await prisma.bvWebchatSession.deleteMany({ where: { lastSeenAt: { lt: new Date(Date.now() - 30 * 86400_000) } } });
      if (r.count) logger.info({ removed: r.count }, '[webchat] sessões antigas removidas');
    });
  }

  app.get('/widget.js', async (req, reply) => {
    reply
      .header('Content-Type', 'application/javascript; charset=utf-8')
      .header('Cross-Origin-Resource-Policy', 'cross-site')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400')
      .header('ETag', WIDGET_ETAG);
    if (req.headers['if-none-match'] === WIDGET_ETAG) return reply.code(304).send();
    return reply.send(WIDGET_JS);
  });

  app.get('/demo', async (req, reply) => {
    if (!env.demoEnabled()) return reply.code(404).send({ error: { code: 'webchat.demo_disabled', message: 'Página de demonstração desativada.' } });
    const q = req.query as Record<string, unknown>;
    const org = typeof q.org === 'string' && SLUG_RE.test(q.org) ? q.org : null;
    const prefix = req.url.split('?')[0].replace(/\/demo\/?$/, '');
    const html = demoHtml({
      org, vlibras: q.vlibras === '1' || q.vlibras === 'true', position: q.position === 'left' ? 'left' : 'right', widgetPath: `${prefix}/widget.js`,
    });
    return reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .header('Cache-Control', 'no-store')
      // O CSP global é restritivo (sem inline); a demo precisa de estilo inline, ws do socket e do VLibras (gov.br).
      .header('Content-Security-Policy', "default-src 'self'; script-src 'self' https://vlibras.gov.br; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' ws: wss: https://vlibras.gov.br; font-src 'self' data: https:; frame-src https://meet.jit.si https://vlibras.gov.br; frame-ancestors 'none'; base-uri 'none'")
      .send(html);
  });

  registerPublicRoutes(app);
  registerAgentCaptionRoutes(app);
}
