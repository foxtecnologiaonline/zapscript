import { FastifyInstance, FastifyRequest } from 'fastify';
import { redis } from '../services/queue';

/**
 * Escudo cibernético leve (WAF-lite + fail2ban-lite), 100% em Redis — sem
 * dependência nova. Roda como onRequest hook, antes de CORS/parsing/rotas:
 *   1) Bloqueia paths de sondagem automatizada (scanners/bots) com 403 rápido.
 *   2) Bane IPs que acumulam tentativas suspeitas (probe, 401, 429) numa janela.
 * Falha aberta: se o Redis estiver fora do ar, o tráfego legítimo não é afetado.
 */

const PROBE_PATTERNS: RegExp[] = [
  /^\/\.env/i,
  /^\/\.git/i,
  /^\/\.aws/i,
  /^\/\.ssh/i,
  /^\/wp-(admin|login|content|includes|json)/i,
  /^\/(phpmyadmin|adminer|xmlrpc\.php)/i,
  /^\/(config|backup|dump)\.(json|sql|zip|tar\.gz|gz)$/i,
  /^\/vendor\/(phpunit|bin)/i,
  /^\/\.well-known\/(?!acme-challenge)/i, // permite ACME (Let's Encrypt); bloqueia o resto
  /\.(env|htaccess|htpasswd|bak|swp)$/i,
  /^\/(server-status|server-info|actuator)/i,
];

const STRIKE_THRESHOLD  = 20;        // tentativas suspeitas na janela até banir
const STRIKE_WINDOW_SEC = 5 * 60;    // janela de 5 minutos
const BAN_DURATION_SEC  = 60 * 60;   // banimento de 1 hora

function clientIp(req: FastifyRequest): string {
  return (req.headers['cf-connecting-ip'] as string) || req.ip || 'unknown';
}

export function isProbePath(url: string): boolean {
  const path = url.split('?')[0];
  return PROBE_PATTERNS.some((re) => re.test(path));
}

async function isBanned(ip: string): Promise<boolean> {
  if (ip === 'unknown') return false;
  return (await redis.exists(`shield:ban:${ip}`)) === 1;
}

async function registerStrike(ip: string): Promise<void> {
  if (ip === 'unknown') return;
  const key = `shield:strikes:${ip}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, STRIKE_WINDOW_SEC);
  if (count >= STRIKE_THRESHOLD) {
    await redis.set(`shield:ban:${ip}`, '1', 'EX', BAN_DURATION_SEC);
  }
}

export function registerSecurityShield(app: FastifyInstance) {
  app.addHook('onRequest', async (req, reply) => {
    const ip = clientIp(req);

    try {
      if (await isBanned(ip)) {
        reply.code(403).send({ error: 'Acesso temporariamente bloqueado' });
        return reply;
      }
    } catch {
      // Redis indisponível — não bloqueia tráfego legítimo por falha do shield
    }

    if (isProbePath(req.url)) {
      registerStrike(ip).catch(() => {});
      reply.code(403).send({ error: 'Not found' });
      return reply;
    }
  });

  // Reforça o contador também em respostas de auth negada/rate-limit estourado
  app.addHook('onResponse', async (req, reply) => {
    if (reply.statusCode === 401 || reply.statusCode === 429) {
      registerStrike(clientIp(req)).catch(() => {});
    }
  });
}
