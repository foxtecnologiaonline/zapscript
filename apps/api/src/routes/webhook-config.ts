import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { getUserPlan, requirePlan } from '../lib/planGate';
import { encryptStr, decryptStr } from '../services/encryption';
import crypto from 'crypto';
import { isSafeWebhookUrl } from '../lib/url-safety';
import { invalidateListenerCache } from '../services/events';

const PLAN_WEBHOOK = ['executive'];

/**
 * Webhook "clássico" — UMA URL por conta, sem seleção de evento e sem
 * histórico. Mantido no ar porque há integração de cliente apontada para cá;
 * o substituto é /webhook-endpoints (item 2 do escopo ZapScript × Twilio).
 *
 * Duas mudanças desta leva:
 *   • a validação anti-SSRF saiu daqui para lib/url-safety.ts, compartilhada
 *     com as rotas novas (uma checagem, dois consumidores);
 *   • toda alteração aqui é ESPELHADA no WebhookEndpoint legado do usuário.
 *     Sem isso, quem editasse a URL nesta tela continuaria recebendo os
 *     eventos novos no endereço antigo — o pior dos dois mundos.
 */

/**
 * Mantém o endpoint legado (signatureScheme='legacy') em sincronia com o
 * WebhookConfig. Há no máximo um por usuário, criado na primeira emissão de
 * evento (ensureLegacyEndpointMigrated, services/events.ts).
 */
async function syncLegacyEndpoint(
  userId: string,
  data: { url?: string; secret?: string; active?: boolean },
): Promise<void> {
  const endpoint = await prisma.webhookEndpoint.findFirst({
    where: { userId, signatureScheme: 'legacy' },
  }).catch(() => null);
  if (!endpoint) return; // ainda não migrado — nasce já com os dados novos

  await prisma.webhookEndpoint.update({
    where: { id: endpoint.id },
    data: {
      ...(data.url    !== undefined ? { url: data.url } : {}),
      ...(data.secret !== undefined ? { secret: data.secret } : {}),
      ...(data.active !== undefined
        ? data.active
          ? { active: true, consecutiveFailures: 0, disabledAt: null, disabledReason: null }
          : { active: false, disabledAt: new Date(), disabledReason: 'Desativado em /webhook-config' }
        : {}),
    },
  }).catch(() => null);
  await invalidateListenerCache(userId);
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
      secret:    decryptStr(config.secret),
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
    if (!url) return reply.code(400).send({ error: 'URL é obrigatória.' });

    const safe = await isSafeWebhookUrl(url);
    if (!safe.ok) return reply.code(400).send({ error: safe.error });

    const existing = await (prisma as any).webhookConfig.findUnique({ where: { userId } });

    if (existing) {
      // Atualiza URL, mantém secret existente, reativa se estava inativo
      const updated = await (prisma as any).webhookConfig.update({
        where: { userId },
        data:  { url, active: true, updatedAt: new Date() },
      });
      await syncLegacyEndpoint(userId, { url, active: true });
      return updated;
    }

    // Cria nova configuração com secret gerado automaticamente (criptografado em repouso)
    const rawSecret = crypto.randomBytes(32).toString('hex');
    const config = await (prisma as any).webhookConfig.create({
      data: { userId, url, secret: encryptStr(rawSecret), active: true },
    });
    // Invalida o cache de "tem ouvinte?" (services/events.ts) — sem isso, os
    // eventos dos próximos 60s seriam descartados por acharem que não há
    // webhook configurado, justamente logo depois de o cliente configurar um.
    await invalidateListenerCache(userId);
    return reply.code(201).send({ ...config, secret: rawSecret });
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
    await syncLegacyEndpoint(userId, { active: false });
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

    // Re-valida a URL salva antes de fazer fetch (defesa em profundidade)
    const safe = await isSafeWebhookUrl(config.url);
    if (!safe.ok) {
      return reply.code(400).send({ error: `URL inválida: ${safe.error}` });
    }

    const payload = {
      event:     'test',
      timestamp: new Date().toISOString(),
      userId,
      data:      { message: 'Este é um payload de teste do ZapScript Webhook.' },
    };

    const body      = JSON.stringify(payload);
    const signature = 'sha256=' + crypto.createHmac('sha256', decryptStr(config.secret)).update(body).digest('hex');

    try {
      const res = await fetch(config.url, {
        method:  'POST',
        headers: {
          'Content-Type':          'application/json',
          'X-ZapScript-Signature': signature,
          'X-ZapScript-Event':     'test',
        },
        body,
        signal: AbortSignal.timeout(8_000),
      });

      return {
        ok:      res.ok,
        status:  res.status,
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
