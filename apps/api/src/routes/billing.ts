import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';

/* ─────────────────────────────────────────────────────────
   ASAAS  — Billing Routes
   Docs: https://docs.asaas.com
   ────────────────────────────────────────────────────────
   Substituição do Stripe pelo Asaas.
   Asaas não usa "price IDs" pré-criados — o valor é passado
   diretamente na criação da assinatura.
   ───────────────────────────────────────────────────────── */

const ASAAS_BASE = process.env.NODE_ENV === 'production'
  ? 'https://api.asaas.com/v3'
  : 'https://sandbox.asaas.com/api/v3';

const ASAAS_KEY = process.env.ASAAS_API_KEY!;

function asaas(path: string, options: RequestInit = {}) {
  return fetch(`${ASAAS_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'access_token': ASAAS_KEY,
      ...(options.headers ?? {}),
    },
  });
}

/* ── Comparação timing-safe de tokens ── */
function safeTokenCompare(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/* ── Validação de assinatura HMAC-SHA256 ── */
function verifyAsaasSignature(body: string, signature: string | undefined): boolean {
  if (!signature || !process.env.ASAAS_WEBHOOK_TOKEN) {
    return false;
  }
  const hash = crypto
    .createHmac('sha256', process.env.ASAAS_WEBHOOK_TOKEN)
    .update(body)
    .digest('hex');
  return safeTokenCompare(hash, signature);
}

/* ── Idempotência de webhooks persistida no banco ── */
async function isPaymentProcessed(paymentId: string): Promise<boolean> {
  const record = await prisma.processedWebhook.findUnique({ where: { paymentId } });
  return !!record;
}

async function markPaymentProcessed(paymentId: string): Promise<void> {
  await prisma.processedWebhook.upsert({
    where:  { paymentId },
    create: { paymentId },
    update: {},
  });
}

/* ── Busca ou cria cliente no Asaas ── */
async function getOrCreateCustomer(user: { id: string; name: string; email: string; document?: string | null }) {
  // Buscar por email primeiro
  const search = await asaas(`/customers?email=${encodeURIComponent(user.email)}&limit=1`);
  const searchData = await search.json() as any;

  if (searchData?.data?.length > 0) {
    return searchData.data[0].id as string;
  }

  // Criar novo cliente
  const create = await asaas('/customers', {
    method: 'POST',
    body: JSON.stringify({
      name:      user.name,
      email:     user.email,
      cpfCnpj:   user.document?.replace(/\D/g, '') || undefined,
      externalReference: user.id,
    }),
  });

  const customer = await create.json() as any;
  if (!customer?.id) throw new Error(`Erro ao criar cliente no Asaas: ${JSON.stringify(customer)}`);
  return customer.id as string;
}

/* ── Valores dos planos ── */
const PLAN_PRICES: Record<string, number> = {
  pro:   29.90,
  ultra: 59.90,
};

export default async function billingRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any).authenticate] };

  // ── POST /billing/checkout ────────────────────────────
  // Cria assinatura no Asaas e retorna URL da fatura para redirect
  app.post<{ Body: { planName: 'pro' | 'ultra'; billingType?: string } }>(
    '/checkout',
    { ...auth, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req: any, reply) => {
      const { planName, billingType = 'UNDEFINED' } = req.body;
      const userId = req.user.sub;

      const price = PLAN_PRICES[planName];
      if (!price) return reply.code(400).send({ error: 'Plano inválido' });

      const plan = await prisma.plan.findUnique({ where: { name: planName } });
      if (!plan) return reply.code(400).send({ error: 'Plano não encontrado no banco' });

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) return reply.code(401).send({ error: 'Usuário não encontrado' });

      // 1. Obter ou criar cliente no Asaas
      let asaasCustomerId: string;
      try {
        asaasCustomerId = await getOrCreateCustomer({
          id:       user.id,
          name:     user.name ?? 'Usuário',
          email:    user.email,
          document: user.document,
        });
      } catch (err) {
        app.log.error({ err }, 'Asaas customer error');
        return reply.code(503).send({ error: 'Serviço de pagamento indisponível. Tente novamente em alguns minutos.' });
      }

      // 2. Criar assinatura
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

      const subRes = await asaas('/subscriptions', {
        method: 'POST',
        body: JSON.stringify({
          customer:          asaasCustomerId,
          billingType:       billingType.toUpperCase(), // CREDIT_CARD | PIX | BOLETO | UNDEFINED
          cycle:             'MONTHLY',
          value:             price,
          nextDueDate:       today,
          description:       `ZapScript ${planName === 'pro' ? 'Pro' : 'Ultra'}`,
          externalReference: `${userId}|${planName}`,
          // Redireciona após pagamento
          successPage:       `${process.env.APP_URL}/payment/success?plan=${planName}`,
          failurePage:       `${process.env.APP_URL}/payment/failed?plan=${planName}`,
        }),
      });

      const sub = await subRes.json() as any;

      if (!sub?.id) {
        app.log.error({ sub }, 'Asaas subscription error');
        return reply.code(500).send({ error: 'Erro ao criar assinatura. Tente novamente.' });
      }

      // 3. Obter a URL de pagamento da primeira fatura
      const paymentsRes = await asaas(`/subscriptions/${sub.id}/payments?limit=1`);
      const payments = await paymentsRes.json() as any;
      const firstPayment = payments?.data?.[0];

      const paymentUrl = firstPayment?.invoiceUrl
        || `https://www.asaas.com/c/${firstPayment?.id}`
        || null;

      // Salvar IDs no banco (já para o webhook ter contexto)
      await prisma.subscription.update({
        where: { userId },
        data: {
          asaasSubscriptionId: sub.id,
          asaasCustomerId,
          status: 'pending',
        },
      }).catch(() => null); // não falhar se não existir ainda

      return { url: paymentUrl, subscriptionId: sub.id };
    }
  );

  // ── POST /billing/cancel ──────────────────────────────
  // Cancela a assinatura no Asaas e faz downgrade para o plano free
  app.post('/cancel', auth, async (req: any, reply) => {
    const userId = req.user.sub;

    const sub = await prisma.subscription.findUnique({
      where:   { userId },
      include: { plan: true },
    });

    if (!sub || sub.plan.name === 'free') {
      return reply.code(400).send({ error: 'Nenhuma assinatura paga ativa para cancelar.' });
    }

    if (sub.asaasSubscriptionId) {
      try {
        const res = await asaas(`/subscriptions/${sub.asaasSubscriptionId}`, { method: 'DELETE' });
        if (!res.ok) {
          const err = await res.json() as any;
          app.log.warn({ err }, 'Asaas: erro ao cancelar assinatura');
        }
      } catch (err) {
        app.log.warn({ err }, 'Asaas: falha na chamada de cancelamento');
      }
    }

    const freePlan = await prisma.plan.findUnique({ where: { name: 'free' } });
    if (!freePlan) return reply.code(500).send({ error: 'Plano free não encontrado.' });

    await prisma.$transaction([
      prisma.subscription.update({
        where: { userId },
        data: {
          planId:              freePlan.id,
          status:              'canceled',
          asaasSubscriptionId: null,
          currentPeriodEnd:    null,
        },
      }),
      prisma.minuteBalance.update({
        where: { userId },
        data:  { availableMinutes: freePlan.minutesPerMonth, lastAlertSent: null },
      }),
    ]);

    return { canceled: true, message: 'Assinatura cancelada. Você foi movido para o plano gratuito.' };
  });

  // ── GET /billing/invoices ─────────────────────────────
  // Lista as últimas 12 faturas da assinatura no Asaas
  app.get('/invoices', auth, async (req: any) => {
    const userId = req.user.sub;
    const sub = await prisma.subscription.findUnique({ where: { userId } });

    if (!sub?.asaasSubscriptionId) {
      return { invoices: [] };
    }

    try {
      const res  = await asaas(`/subscriptions/${sub.asaasSubscriptionId}/payments?limit=12&offset=0`);
      const data = await res.json() as any;
      const invoices = (data?.data || []).map((p: any) => ({
        id:          p.id,
        value:       p.value,
        netValue:    p.netValue,
        status:      p.status,
        dueDate:     p.dueDate,
        paymentDate: p.paymentDate,
        invoiceUrl:  p.invoiceUrl || `https://www.asaas.com/c/${p.id}`,
        billingType: p.billingType,
        description: p.description,
      }));
      return { invoices };
    } catch (err) {
      app.log.error({ err }, 'Erro ao buscar faturas Asaas');
      return { invoices: [] };
    }
  });

  // ── GET /billing/portal ───────────────────────────────
  // Redireciona para a área do assinante no Asaas
  app.get('/portal', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const sub = await prisma.subscription.findUnique({ where: { userId } });

    if (!sub?.asaasCustomerId) {
      return reply.code(400).send({ error: 'Sem assinatura ativa' });
    }

    // Asaas tem portal do assinante em:
    const portalUrl = `https://www.asaas.com/area-do-assinante?customerId=${sub.asaasCustomerId}`;
    return { url: portalUrl };
  });

  // ── POST /billing/webhook ─────────────────────────────
  // Asaas envia eventos via POST com token de autenticação
  app.post('/webhook', async (req: any, reply) => {
    // Asaas envia o authToken no header 'asaas-access-token'
    const token          = req.headers['asaas-access-token'] as string | undefined;
    const signature      = req.headers['x-asaas-signature'] as string | undefined;
    const expectedToken  = process.env.ASAAS_WEBHOOK_TOKEN;

    const tokenValid = safeTokenCompare(token, expectedToken);

    if (!tokenValid) {
      app.log.warn({ tokenProvided: !!token, tokenConfigured: !!expectedToken }, 'Asaas webhook token inválido');
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    // Validação adicional: HMAC-SHA256 signature (se disponível)
    const rawBody = req.rawBody || JSON.stringify(req.body);
    if (signature && !verifyAsaasSignature(rawBody, signature)) {
      app.log.error('Asaas webhook signature verification failed');
      return reply.code(401).send({ error: 'Invalid signature' });
    }

    const event = req.body as any;
    const { event: eventType, payment, subscription: subEvent } = event;

    app.log.info(`Asaas webhook: ${eventType}`);

    switch (eventType) {

      // ── Pagamento confirmado (PIX, cartão, boleto) ──
      case 'PAYMENT_CONFIRMED':
      case 'PAYMENT_RECEIVED': {
        const paymentId  = payment?.id as string | undefined;
        // payment.subscription é string (ID), não objeto — usar payment.externalReference diretamente
        const externalRef = payment?.externalReference
          || payment?.subscription?.externalReference
          || '';

        const [userId, planName] = externalRef.split('|');
        if (!userId || !planName) {
          app.log.error(`Webhook ${eventType}: externalReference malformado: "${externalRef}" (paymentId: ${paymentId})`);
          break;
        }

        // Idempotência: ignorar webhooks duplicados
        if (paymentId && await isPaymentProcessed(paymentId)) {
          app.log.info(`Webhook duplicado ignorado: paymentId=${paymentId}`);
          break;
        }

        const plan = await prisma.plan.findUnique({ where: { name: planName } });
        if (!plan) {
          app.log.error(`Webhook ${eventType}: plano "${planName}" não encontrado`);
          break;
        }

        const asaasSubId  = payment?.subscription?.id;
        const asaasCustId = payment?.customer?.id || payment?.customerId;

        // Calcular próximo período (30 dias)
        const nextPeriod = new Date();
        nextPeriod.setDate(nextPeriod.getDate() + 30);

        await prisma.$transaction([
          prisma.subscription.upsert({
            where:  { userId },
            create: {
              userId,
              planId:              plan.id,
              asaasSubscriptionId: asaasSubId || null,
              asaasCustomerId:     asaasCustId || null,
              status:              'active',
              currentPeriodEnd:    nextPeriod,
            },
            update: {
              planId:              plan.id,
              asaasSubscriptionId: asaasSubId || undefined,
              asaasCustomerId:     asaasCustId || undefined,
              status:              'active',
              currentPeriodEnd:    nextPeriod,
            },
          }),
          prisma.minuteBalance.upsert({
            where:  { userId },
            create: { userId, availableMinutes: plan.minutesPerMonth, resetAt: nextPeriod, lastAlertSent: null },
            update: { availableMinutes: plan.minutesPerMonth, lastAlertSent: null },
          }),
        ]);

        if (paymentId) await markPaymentProcessed(paymentId);
        app.log.info(`Pagamento processado: userId=${userId} plano=${planName}`);
        break;
      }

      // ── Renovação mensal atrasada ──
      case 'PAYMENT_OVERDUE': {
        const externalRef = payment?.externalReference || payment?.subscription?.externalReference || '';
        const [userId] = externalRef.split('|');
        if (!userId) {
          app.log.error(`Webhook PAYMENT_OVERDUE: externalReference malformado: "${externalRef}"`);
          break;
        }

        await prisma.subscription.update({
          where: { userId },
          data:  { status: 'past_due' },
        }).catch(() => null);
        break;
      }

      // ── Assinatura cancelada ──
      case 'SUBSCRIPTION_DELETED':
      case 'PAYMENT_REFUNDED': {
        const externalRef = subEvent?.externalReference
          || payment?.subscription?.externalReference
          || '';

        const [userId] = externalRef.split('|');
        if (!userId) {
          app.log.error(`Webhook ${eventType}: externalReference malformado: "${externalRef}"`);
          break;
        }

        const freePlan = await prisma.plan.findUnique({ where: { name: 'free' } });
        if (!freePlan) break;

        const nextReset = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await prisma.$transaction([
          prisma.subscription.upsert({
            where:  { userId },
            create: { userId, planId: freePlan.id, status: 'canceled' },
            update: { planId: freePlan.id, status: 'canceled', asaasSubscriptionId: null, currentPeriodEnd: null },
          }),
          prisma.minuteBalance.upsert({
            where:  { userId },
            create: { userId, availableMinutes: freePlan.minutesPerMonth, resetAt: nextReset, lastAlertSent: null },
            update: { availableMinutes: freePlan.minutesPerMonth, lastAlertSent: null },
          }),
        ]);
        break;
      }
    }

    return reply.send({ received: true });
  });
}
