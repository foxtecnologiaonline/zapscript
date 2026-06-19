import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';

/* ─────────────────────────────────────────────────────────
   Analytics first-party — coleta de visitas e cliques do site
   - SEM autenticação de usuário (tráfego anônimo do site público)
   - Chamado pelo route handler /api/track do Next (que injeta geo da Vercel)
   - Rate-limit por IP e validação de payload para conter abuso
   - Resiliente a drift: se a tabela SiteEvent ainda não existir, apenas
     descarta o evento (nunca quebra a coleta nem retorna 500)
   ───────────────────────────────────────────────────────── */

const VALID_TYPES = ['pageview', 'click'];

function clampStr(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  return s.slice(0, max);
}

interface IncomingEvent {
  type?: string;
  path?: string;
  name?: string;
  visitorId?: string;
  referrer?: string;
  device?: string;
  country?: string;
  region?: string;
  city?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
}

export default async function analyticsRoutes(app: FastifyInstance) {
  // ── POST /analytics/collect — ingestão de eventos (lote pequeno) ──────────
  app.post<{ Body: { events?: IncomingEvent[] } }>(
    '/collect',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (req, reply) => {
      // Se INTERNAL_API_SECRET estiver configurado, exige-o (o /api/track do
      // Next envia). Sem ele configurado, aceita aberto (geo só do que vier).
      const secret = process.env.INTERNAL_API_SECRET;
      if (secret) {
        const sent = req.headers['x-internal-secret'];
        if (sent !== secret) return reply.code(401).send({ error: 'unauthorized' });
      }

      const events = Array.isArray(req.body?.events) ? req.body!.events!.slice(0, 50) : [];
      if (events.length === 0) return { ok: true, stored: 0 };

      const rows = events
        .filter(e => e && VALID_TYPES.includes(e.type as string) && typeof e.path === 'string')
        .map(e => ({
          type:        e.type as string,
          path:        clampStr(e.path, 300) || '/',
          name:        clampStr(e.name, 120),
          visitorId:   clampStr(e.visitorId, 64),
          referrer:    clampStr(e.referrer, 300),
          device:      e.device === 'mobile' || e.device === 'desktop' ? e.device : null,
          country:     clampStr(e.country, 80),
          region:      clampStr(e.region, 120),
          city:        clampStr(e.city, 120),
          utmSource:   clampStr(e.utmSource, 120),
          utmMedium:   clampStr(e.utmMedium, 120),
          utmCampaign: clampStr(e.utmCampaign, 120),
        }));

      if (rows.length === 0) return { ok: true, stored: 0 };

      try {
        await prisma.siteEvent.createMany({ data: rows });
        return { ok: true, stored: rows.length };
      } catch (err: any) {
        // Tabela ausente (drift) ou qualquer falha de gravação: não quebrar a coleta
        app.log.warn({ err: err?.message }, '[Analytics] coleta indisponível — evento descartado');
        return { ok: true, stored: 0 };
      }
    }
  );
}
