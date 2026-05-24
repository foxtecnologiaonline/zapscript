import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { getUserPlan, requirePlan } from '../lib/planGate';
import crypto from 'crypto';

const PLAN_WEBHOOK = ['executive'];

function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch { return false; }
}

export default async function webhookConfigRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any).authenticate] };

  // ── GET /webhook-config ───────────────────────────────
  app.get('/', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const plan   = await getUserPlan(userId);
    if (!requirePlan(plan, PLAN_WEBHOOK, reply)) return;

    const config = await (prisma as any).webhookConfig.findUnique({ where: { userId } });
    if (!config) return reply.code(404).send({ configured: false });
    return {
      id:        config.id,
      url:       config.url,
      secret:    config.secret,
      active:    config.active,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    };
  });

  // ── POST /webhook-config ──────────────────────────────
  // Cria ou atualiza configuração de webhook
  app.post<{ Body: { url: string } }>('/', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const plan   = await getUserPlan(userId);
    if (!requirePlan(plan, PLAN_WEBHOOK, reply)) return;

    const { url } = req.body;
    if (!url || !isValidUrl(url)) {
      return reply.code(400).send({ error: 'URL inválida. Use uma URL válida com http:// ou https://.' });
    }

    const existing = await (prisma as any).webhookConfig.findUnique({ where: { userId } });

    if (existing) {
      // Atualiza URL, mantém secret existente, reativa se estava inativo
      const updated = await (prisma as any).webhookConfig.update({
        where: { userId },
        data:  { url, active: true, updatedAt: new Date() },
      });
      return updated;
    }

    // Cria nova configuração com secret gerado automaticamente
    const secret = crypto.randomBytes(32).toString('hex');
    const config = await (prisma as any).webhookConfig.create({
      data: { userId, url, secret, active: true },
    });
    return reply.code(201).send(config);
  });

  // ── DELETE /webhook-config ────────────────────────────
  // Desativa webhook (soft delete — mantém config)
  app.delete('/', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const plan   = await getUserPlan(userId);
    if (!requirePlan(plan, PLAN_WEBHOOK, reply)) return;

    const existing = await (prisma as any).webhookConfig.findUnique({ where: { userId } });
    if (!existing) return reply.code(404).send({ error: 'Webhook não configurado.' });

    await (prisma as any).webhookConfig.update({
      where: { userId },
      data:  { active: false, updatedAt: new Date() },
    });
    return reply.code(200).send({ active: false });
  });

  // ── POST /webhook-config/test ─────────────────────────
  // Dispara payload de teste para a URL configurada
  app.post('/test', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const plan   = await getUserPlan(userId);
    if (!requirePlan(plan, PLAN_WEBHOOK, reply)) return;

    const config = await (prisma as any).webhookConfig.findUnique({ where: { userId, active: true } });
    if (!config) {
      return reply.code(400).send({ error: 'Webhook não configurado ou inativo.' });
    }

    const payload = {
      event:     'test',
      timestamp: new Date().toISOString(),
      userId,
      data:      { message: 'Este é um payload de teste do ZapScript Webhook.' },
    };

    const body      = JSON.stringify(payload);
    const signature = 'sha256=' + crypto.createHmac('sha256', config.secret).update(body).digest('hex');

    try {
      const res = await fetch(config.url, {
        method:  'POST',
        headers: {
          'Content-Type':         'application/json',
          'X-ZapScript-Signature': signature,
          'X-ZapScript-Event':    'test',
        },
        body,
        signal: AbortSignal.timeout(8_000),
      });

      return {
        ok:     res.ok,
        status: res.status,
        message: res.ok ? 'Teste enviado com sucesso!' : `URL retornou status ${res.status}`,
      };
    } catch (err: any) {
      return reply.code(502).send({
        ok:      false,
        message: `Falha ao alcançar URL: ${err.message}`,
      });
    }
  });
}
