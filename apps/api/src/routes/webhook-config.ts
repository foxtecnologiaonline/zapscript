import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { getUserPlan } from '../lib/planGate';
import { requireIntegrationPlan } from '../lib/integrationGate';
import { encryptStr, decryptStr } from '../services/encryption';
import { isSafeWebhookUrl } from '../lib/webhook-url-guard';
import { buildWebhookHeaders } from '../lib/webhook-signature';
import { ALL_WEBHOOK_EVENTS, WEBHOOK_EVENTS, WebhookEvent } from '../lib/webhook-events';
import crypto from 'crypto';

/**
 * Configuração do webhook de saída (API pública v1).
 *
 * Mudanças em relação à versão anterior:
 *  - gate: era só o plano 'executive'; agora passa pelo integrationGate (ver o
 *    porquê em lib/integrationGate.ts — o gate antigo tornava impossível ter
 *    webhook e envio de mensagem no mesmo plano);
 *  - `events`: a config passou a declarar QUAIS eventos assina. Config sem
 *    `events` (criada antes da migration) vale como ['transcription.completed'],
 *    então ninguém começa a receber evento novo sem pedir;
 *  - a guarda anti-SSRF e a assinatura HMAC saíram daqui para libs
 *    compartilhadas, porque o worker precisa das duas no momento do disparo.
 */

/** Normaliza e valida a lista de eventos vinda do body. */
function parseEvents(input: unknown): { ok: true; events: WebhookEvent[] } | { ok: false; error: string } {
  if (input === undefined) return { ok: true, events: [WEBHOOK_EVENTS.TRANSCRIPTION_COMPLETED] };
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, error: 'events deve ser um array com ao menos 1 evento.' };
  }
  const unknown = input.filter((e) => !ALL_WEBHOOK_EVENTS.includes(e as WebhookEvent));
  if (unknown.length) {
    return { ok: false, error: `Evento(s) desconhecido(s): ${unknown.join(', ')}. Válidos: ${ALL_WEBHOOK_EVENTS.join(', ')}.` };
  }
  return { ok: true, events: Array.from(new Set(input as WebhookEvent[])) };
}

export default async function webhookConfigRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any).authenticate] };

  // ── GET /webhook-config ───────────────────────────────
  app.get('/', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const plan   = await getUserPlan(userId);
    if (!requireIntegrationPlan(plan, reply)) return;

    const config = await (prisma as any).webhookConfig.findUnique({ where: { userId } });
    if (!config) {
      return reply.code(404).send({ configured: false, availableEvents: ALL_WEBHOOK_EVENTS });
    }
    return {
      id:        config.id,
      url:       config.url,
      secret:    decryptStr(config.secret),
      events:    config.events?.length ? config.events : [WEBHOOK_EVENTS.TRANSCRIPTION_COMPLETED],
      active:    config.active,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
      availableEvents: ALL_WEBHOOK_EVENTS,
    };
  });

  // ── POST /webhook-config ──────────────────────────────
  // Cria ou atualiza a configuração (URL e/ou eventos assinados).
  app.post<{ Body: { url: string; events?: string[] } }>('/', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const plan   = await getUserPlan(userId);
    if (!requireIntegrationPlan(plan, reply)) return;

    const { url } = req.body ?? {};
    if (!url) return reply.code(400).send({ error: 'URL é obrigatória.' });

    const safe = await isSafeWebhookUrl(url);
    if (!safe.ok) return reply.code(400).send({ error: safe.error });

    const parsed = parseEvents(req.body?.events);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });

    const existing = await (prisma as any).webhookConfig.findUnique({ where: { userId } });

    if (existing) {
      // Mantém o secret (o integrador já o guardou do outro lado) e reativa se
      // estava inativo. `events` só muda se vier explicitamente no body —
      // atualizar só a URL não pode zerar a assinatura de eventos.
      const updated = await (prisma as any).webhookConfig.update({
        where: { userId },
        data: {
          url,
          active:    true,
          updatedAt: new Date(),
          ...(req.body?.events !== undefined ? { events: parsed.events } : {}),
        },
      });
      // Shape explícito: o código anterior devolvia a linha do Prisma inteira,
      // o que vazava `userId` e o `secret` AINDA CRIPTOGRAFADO (inútil para
      // quem fosse validar). Aqui o secret vai em claro, igual ao GET — quem
      // chama já é o dono autenticado da conta.
      return {
        id:        updated.id,
        url:       updated.url,
        events:    updated.events,
        active:    updated.active,
        secret:    decryptStr(updated.secret),
        updatedAt: updated.updatedAt,
      };
    }

    const rawSecret = crypto.randomBytes(32).toString('hex');
    const config = await (prisma as any).webhookConfig.create({
      data: { userId, url, secret: encryptStr(rawSecret), events: parsed.events, active: true },
    });
    // Único momento em que o secret em claro é devolvido — o integrador precisa
    // copiar agora para validar a assinatura do outro lado.
    return reply.code(201).send({
      id:        config.id,
      url:       config.url,
      events:    config.events,
      active:    config.active,
      secret:    rawSecret,
      createdAt: config.createdAt,
    });
  });

  // ── PATCH /webhook-config/events ──────────────────────
  // Troca só a lista de eventos assinados, sem mexer na URL nem no secret.
  app.patch<{ Body: { events: string[] } }>('/events', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const plan   = await getUserPlan(userId);
    if (!requireIntegrationPlan(plan, reply)) return;

    const existing = await (prisma as any).webhookConfig.findUnique({ where: { userId } });
    if (!existing) return reply.code(404).send({ error: 'Webhook não configurado.' });

    const parsed = parseEvents(req.body?.events);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });

    const updated = await (prisma as any).webhookConfig.update({
      where: { userId },
      data:  { events: parsed.events, updatedAt: new Date() },
    });
    return { id: updated.id, events: updated.events, active: updated.active };
  });

  // ── DELETE /webhook-config ────────────────────────────
  // Desativa webhook (soft delete — mantém config)
  app.delete('/', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const plan   = await getUserPlan(userId);
    if (!requireIntegrationPlan(plan, reply)) return;

    const existing = await (prisma as any).webhookConfig.findUnique({ where: { userId } });
    if (!existing) return reply.code(404).send({ error: 'Webhook não configurado.' });

    await (prisma as any).webhookConfig.update({
      where: { userId },
      data:  { active: false, updatedAt: new Date() },
    });
    return reply.code(200).send({ active: false });
  });

  // ── GET /webhook-config/deliveries ────────────────────
  // Últimas tentativas de entrega — o integrador consegue depurar sozinho
  // ("o evento saiu? que status a minha URL devolveu?") sem abrir suporte.
  app.get<{ Querystring: { limit?: string } }>('/deliveries', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const plan   = await getUserPlan(userId);
    if (!requireIntegrationPlan(plan, reply)) return;

    const limit = Math.min(100, Math.max(1, parseInt(req.query?.limit ?? '', 10) || 25));
    const deliveries = await (prisma as any).webhookDelivery.findMany({
      where:   { userId },
      orderBy: { createdAt: 'desc' },
      take:    limit,
      select:  { id: true, event: true, url: true, success: true, httpStatus: true, attempt: true, error: true, createdAt: true },
    });
    return { data: deliveries };
  });

  // ── POST /webhook-config/test ─────────────────────────
  // Dispara payload de teste para a URL configurada. Síncrono de propósito: o
  // dono clicou "testar" e quer o status HTTP na hora, então aqui NÃO passa
  // pela fila. Usa a mesma função de assinatura do disparo real
  // (lib/webhook-signature.ts) — era justamente a divergência entre o teste e
  // o disparo real que esconder o bug do secret criptografado.
  app.post('/test', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const plan   = await getUserPlan(userId);
    if (!requireIntegrationPlan(plan, reply)) return;

    const config = await (prisma as any).webhookConfig.findUnique({ where: { userId, active: true } });
    if (!config) {
      return reply.code(400).send({ error: 'Webhook não configurado ou inativo.' });
    }

    // Re-valida a URL salva antes de fazer fetch (defesa em profundidade)
    const safe = await isSafeWebhookUrl(config.url);
    if (!safe.ok) {
      return reply.code(400).send({ error: `URL inválida: ${safe.error}` });
    }

    const timestamp = new Date().toISOString();
    const payload = {
      event:     'test',
      timestamp,
      userId,
      data:      { message: 'Este é um payload de teste do ZapScript Webhook.' },
    };

    const rawBody = JSON.stringify(payload);
    const headers = buildWebhookHeaders({
      secretPlain: decryptStr(config.secret),
      rawBody,
      event:       'test',
      deliveryId:  crypto.randomUUID(),
      timestamp,
    });

    try {
      const res = await fetch(config.url, {
        method: 'POST',
        headers,
        body:   rawBody,
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
