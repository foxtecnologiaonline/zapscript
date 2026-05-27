import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { sendEmail } from '../lib/mailer';
import { calculateProration } from '../lib/proration';

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

/* ── Busca fatura pendente de uma assinatura Asaas ── */
async function findPendingSubscriptionInvoice(subscriptionId: string): Promise<string | null> {
  try {
    for (const status of ['PENDING', 'OVERDUE']) {
      const res  = await asaas(`/subscriptions/${subscriptionId}/payments?status=${status}&limit=1`);
      const data = await res.json() as any;
      const p    = data?.data?.[0];
      if (p?.id) return p.invoiceUrl || `https://www.asaas.com/c/${p.id}`;
    }
  } catch { /* ignora — seguirá criando nova */ }
  return null;
}

/* ── Busca cobrança avulsa pendente por externalReference ── */
async function findPendingCharge(externalReference: string): Promise<{ id: string; url: string } | null> {
  try {
    for (const status of ['PENDING', 'OVERDUE']) {
      const res  = await asaas(`/payments?externalReference=${encodeURIComponent(externalReference)}&status=${status}&limit=1`);
      const data = await res.json() as any;
      const p    = data?.data?.[0];
      if (p?.id) return { id: p.id, url: p.invoiceUrl || `https://www.asaas.com/c/${p.id}` };
    }
  } catch { /* ignora */ }
  return null;
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
  pro:       29.90,
  ultra:     59.90,
  executive: 89.90,
};

export default async function billingRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any).authenticate] };

  // ── POST /billing/checkout ────────────────────────────
  // Cria assinatura no Asaas e retorna URL da fatura para redirect
  app.post<{ Body: { planName: 'pro' | 'ultra' | 'executive'; billingType?: string } }>(
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

      // ── Verificar fatura pendente existente ──────────────────────────────────
      // Se já existe assinatura pending para o mesmo plano, reusar a fatura.
      const existingSub = await prisma.subscription.findUnique({ where: { userId } });
      if (
        existingSub?.asaasSubscriptionId &&
        existingSub?.status === 'pending'
      ) {
        // Verificar se a assinatura pendente corresponde ao mesmo plano solicitado
        const asaasSubRes  = await asaas(`/subscriptions/${existingSub.asaasSubscriptionId}`).then(r => r.json()).catch(() => null) as any;
        const subExtRef    = asaasSubRes?.externalReference ?? '';
        const subPlanMatch = subExtRef === `${userId}|${planName}`;

        if (subPlanMatch) {
          const existingUrl = await findPendingSubscriptionInvoice(existingSub.asaasSubscriptionId);
          if (existingUrl) {
            app.log.info(`Checkout: reutilizando fatura pendente userId=${userId} plan=${planName}`);
            return { url: existingUrl, subscriptionId: existingSub.asaasSubscriptionId, reused: true };
          }
        }
      }
      // ────────────────────────────────────────────────────────────────────────

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
          billingType:       billingType.toUpperCase(),
          cycle:             'MONTHLY',
          value:             price,
          nextDueDate:       today,
          description:       `ZapScript ${planName === 'pro' ? 'Pro' : planName === 'ultra' ? 'Ultra' : 'Executive'}`,
          externalReference: `${userId}|${planName}`,
          callback: {
            successUrl:   `${process.env.APP_URL}/payment/success?plan=${planName}`,
            autoRedirect: true,
          },
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

  // ── GET /billing/upgrade-preview ─────────────────────
  // Simula a proration sem criar cobranças — usado pelo modal do frontend
  app.get<{ Querystring: { targetPlan: string } }>(
    '/upgrade-preview',
    auth,
    async (req: any, reply) => {
      const { targetPlan } = req.query;
      const userId         = req.user.sub;

      const newPrice = PLAN_PRICES[targetPlan];
      if (!newPrice) return reply.code(400).send({ error: 'Plano inválido' });

      const sub = await prisma.subscription.findUnique({
        where:   { userId },
        include: { plan: true },
      });

      if (!sub || !sub.plan || sub.plan.priceBrl === 0) {
        return reply.code(400).send({ error: 'Use /billing/checkout para sair do plano gratuito.' });
      }

      const currentPrice = sub.plan.priceBrl;
      if (newPrice <= currentPrice) {
        return reply.code(400).send({ error: 'Plano destino deve ser mais caro que o atual.' });
      }

      const proration = calculateProration(currentPrice, newPrice, sub.currentPeriodEnd);

      return {
        currentPlanName:  sub.plan.name,
        currentPlanLabel: sub.plan.label,
        currentPlanPrice: currentPrice,
        targetPlanName:   targetPlan,
        targetPlanPrice:  newPrice,
        remainingDays:    proration.remainingDays,
        totalDays:        proration.totalDays,
        proratedAmount:   proration.proratedAmount,
        shouldCharge:     proration.shouldCharge,
        nextCycleDate:    sub.currentPeriodEnd ?? null,
      };
    }
  );

  // ── POST /billing/upgrade ─────────────────────────────
  // Upgrade de plano pago → pago: cobra apenas a diferença proporcional
  app.post<{ Body: { targetPlan: string; billingType?: string } }>(
    '/upgrade',
    { ...auth, config: { rateLimit: { max: 3, timeWindow: '1 minute' } } },
    async (req: any, reply) => {
      const { targetPlan, billingType = 'UNDEFINED' } = req.body;
      const userId = req.user.sub;

      const newPrice = PLAN_PRICES[targetPlan];
      if (!newPrice) return reply.code(400).send({ error: 'Plano inválido' });

      const newPlan = await prisma.plan.findUnique({ where: { name: targetPlan } });
      if (!newPlan) return reply.code(400).send({ error: 'Plano não encontrado no banco' });

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) return reply.code(401).send({ error: 'Usuário não encontrado' });

      const sub = await prisma.subscription.findUnique({
        where:   { userId },
        include: { plan: true },
      });

      if (!sub || !sub.plan || sub.plan.priceBrl === 0) {
        return reply.code(400).send({ error: 'Use /billing/checkout para sair do plano gratuito.' });
      }

      const currentPrice = sub.plan.priceBrl;
      if (newPrice <= currentPrice) {
        return reply.code(400).send({ error: 'Plano destino deve ser mais caro que o atual.' });
      }

      const proration = calculateProration(currentPrice, newPrice, sub.currentPeriodEnd);

      // ── Verificar cobrança de upgrade pendente existente ─────────────────────
      // Se o usuário já iniciou o upgrade (status=pending) e a cobrança ainda
      // está em aberto no Asaas, redirecionar para a fatura existente.
      if (sub.status === 'pending') {
        const existingCharge = await findPendingCharge(`${userId}|${targetPlan}|upgrade`);
        if (existingCharge) {
          app.log.info(`Upgrade: reutilizando cobrança pendente userId=${userId} plan=${targetPlan}`);
          return {
            proratedAmount: proration.proratedAmount,
            remainingDays:  proration.remainingDays,
            url:            existingCharge.url,
            chargeId:       existingCharge.id,
            reused:         true,
          };
        }
      }
      // ────────────────────────────────────────────────────────────────────────

      // ── Proration irrisória: troca imediata sem nova cobrança ──
      if (!proration.shouldCharge) {
        const nextPeriod = sub.currentPeriodEnd ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await prisma.$transaction([
          prisma.subscription.update({
            where: { userId },
            data:  { planId: newPlan.id, status: 'active', currentPeriodEnd: nextPeriod },
          }),
          prisma.minuteBalance.update({
            where: { userId },
            data:  { availableMinutes: newPlan.minutesPerMonth, lastAlertSent: null },
          }),
        ]);
        return { switched: true, message: 'Plano atualizado imediatamente (sem custo adicional).' };
      }

      // ── Obter/criar cliente Asaas ──
      let asaasCustomerId: string;
      try {
        asaasCustomerId = await getOrCreateCustomer({
          id: user.id, name: user.name ?? 'Usuário', email: user.email, document: user.document,
        });
      } catch (err) {
        app.log.error({ err }, 'Asaas customer error (upgrade)');
        return reply.code(503).send({ error: 'Serviço de pagamento indisponível. Tente novamente.' });
      }

      // ── 1. Marcar como 'pending' ANTES de cancelar no Asaas ──
      // (evita race condition: SUBSCRIPTION_DELETED chegar antes do update local)
      await prisma.subscription.update({
        where: { userId },
        data:  { asaasCustomerId, asaasSubscriptionId: null, status: 'pending' },
      }).catch(() => null);

      // ── 2. Cancelar assinatura recorrente atual no Asaas ──
      if (sub.asaasSubscriptionId) {
        try {
          await asaas(`/subscriptions/${sub.asaasSubscriptionId}`, { method: 'DELETE' });
        } catch (err) {
          app.log.warn({ err }, 'Asaas: falha ao cancelar assinatura antiga no upgrade');
        }
      }

      // ── 3. Criar cobrança avulsa pelo valor proporcional ──
      const today     = new Date().toISOString().split('T')[0];
      const chargeRes = await asaas('/payments', {
        method: 'POST',
        body:   JSON.stringify({
          customer:          asaasCustomerId,
          billingType:       billingType.toUpperCase(),
          dueDate:           today,
          value:             proration.proratedAmount,
          description:       `ZapScript — Upgrade para ${newPlan.label} (${proration.remainingDays} dias restantes do ciclo atual)`,
          externalReference: `${userId}|${targetPlan}|upgrade`,
          callback: {
            successUrl:   `${process.env.APP_URL}/payment/success?plan=${targetPlan}`,
            autoRedirect: true,
          },
        }),
      });

      const charge = await chargeRes.json() as any;
      if (!charge?.id) {
        app.log.error({ charge }, 'Asaas: erro ao criar cobrança proporcional');
        return reply.code(500).send({ error: 'Erro ao criar cobrança. Tente novamente.' });
      }

      const paymentUrl = charge.invoiceUrl || `https://www.asaas.com/c/${charge.id}`;

      app.log.info(`Upgrade iniciado: userId=${userId} de ${sub.plan.name} para ${targetPlan} — proration R$${proration.proratedAmount}`);

      return {
        proratedAmount: proration.proratedAmount,
        remainingDays:  proration.remainingDays,
        url:            paymentUrl,
        chargeId:       charge.id,
      };
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
        data:  {
          availableMinutes: freePlan.minutesPerMonth,
          resetAt:          new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          lastAlertSent:    null,
        },
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
        const paymentId   = payment?.id as string | undefined;
        const externalRef = payment?.externalReference
          || payment?.subscription?.externalReference
          || '';

        const parts      = externalRef.split('|');
        const userId     = parts[0];
        const planName   = parts[1];
        const upgradeTag = parts[2]; // 'upgrade' se for cobrança proporcional

        if (!userId || !planName) {
          app.log.error(`Webhook ${eventType}: externalReference malformado: "${externalRef}" (paymentId: ${paymentId})`);
          break;
        }

        // Idempotência
        if (paymentId && await isPaymentProcessed(paymentId)) {
          app.log.info(`Webhook duplicado ignorado: paymentId=${paymentId}`);
          break;
        }

        const plan = await prisma.plan.findUnique({ where: { name: planName } });
        if (!plan) {
          app.log.error(`Webhook ${eventType}: plano "${planName}" não encontrado`);
          break;
        }

        const asaasSubId  = payment?.subscription?.id || null;
        const asaasCustId = payment?.customer?.id || payment?.customerId || null;

        // Próximo período: 30 dias a partir de hoje
        const nextPeriod = new Date();
        nextPeriod.setDate(nextPeriod.getDate() + 30);

        // ── Pagamento de proration (upgrade pago → pago) ──
        if (upgradeTag === 'upgrade') {
          // 1. Atualizar plano no banco imediatamente
          await prisma.$transaction([
            prisma.subscription.upsert({
              where:  { userId },
              create: {
                userId,
                planId:           plan.id,
                asaasCustomerId:  asaasCustId,
                status:           'active',
                currentPeriodEnd: nextPeriod,
              },
              update: {
                planId:           plan.id,
                asaasCustomerId:  asaasCustId || undefined,
                status:           'active',
                currentPeriodEnd: nextPeriod,
              },
            }),
            prisma.minuteBalance.upsert({
              where:  { userId },
              create: { userId, availableMinutes: plan.minutesPerMonth, resetAt: nextPeriod, lastAlertSent: null },
              update: { availableMinutes: plan.minutesPerMonth, resetAt: nextPeriod, lastAlertSent: null },
            }),
          ]);

          // 2. Criar nova assinatura recorrente no Asaas (cobranças futuras)
          try {
            const nextDueDate = nextPeriod.toISOString().split('T')[0];
            const newSubRes   = await asaas('/subscriptions', {
              method: 'POST',
              body:   JSON.stringify({
                customer:          asaasCustId,
                billingType:       payment?.billingType || 'UNDEFINED',
                cycle:             'MONTHLY',
                value:             PLAN_PRICES[planName] ?? plan.priceBrl,
                nextDueDate,
                description:       `ZapScript ${plan.label}`,
                externalReference: `${userId}|${planName}`,
              }),
            });
            const newSub = await newSubRes.json() as any;
            if (newSub?.id) {
              await prisma.subscription.update({
                where: { userId },
                data:  { asaasSubscriptionId: newSub.id },
              });
              app.log.info(`Upgrade concluído: userId=${userId} plano=${planName} nova sub=${newSub.id}`);
            } else {
              app.log.error({ newSub }, `Asaas: falha ao criar assinatura recorrente pós-upgrade userId=${userId}`);
            }
          } catch (err) {
            app.log.error({ err }, `Asaas: exceção ao criar assinatura recorrente pós-upgrade userId=${userId}`);
          }

          if (paymentId) await markPaymentProcessed(paymentId);
          break;
        }

        // ── Pagamento de assinatura normal (checkout inicial ou renovação) ──
        await prisma.$transaction([
          prisma.subscription.upsert({
            where:  { userId },
            create: {
              userId,
              planId:              plan.id,
              asaasSubscriptionId: asaasSubId,
              asaasCustomerId:     asaasCustId,
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
            update: { availableMinutes: plan.minutesPerMonth, resetAt: nextPeriod, lastAlertSent: null },
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

        // Notificar usuário por e-mail sobre pagamento pendente
        const overdueUser = await prisma.user.findUnique({
          where: { id: userId },
          select: { email: true, name: true },
        }).catch(() => null);

        if (overdueUser?.email) {
          const APP_URL = process.env.APP_URL || 'https://zapscript.me';
          const firstName = overdueUser.name?.split(' ')[0] || 'você';
          const html = `
            <div style="font-family:sans-serif;max-width:540px;margin:0 auto;background:#050a07;color:#d1fae5;padding:32px;border-radius:12px">
              <div style="font-size:22px;font-weight:bold;margin-bottom:16px">⚠️ Pagamento não realizado</div>
              <div style="font-size:14px;line-height:1.7;color:#a7f3d0">
                Olá, <strong>${firstName}</strong>!<br><br>
                Identificamos que o pagamento da sua assinatura <strong>ZapScript</strong> não foi processado com sucesso.<br><br>
                Para manter seu acesso e evitar a interrupção das transcrições, efetue o pagamento em até <strong>24 horas</strong>.
                Após esse prazo, sua conta será movida automaticamente para o plano gratuito.<br><br>
                Para regularizar, acesse o portal de pagamento:
              </div>
              <div style="margin:24px 0;text-align:center">
                <a href="${APP_URL}/dashboard/plano" style="background:#f59e0b;color:#1c1204;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:15px">Regularizar pagamento →</a>
              </div>
              <div style="font-size:13px;color:#a7f3d0;margin-top:16px">
                Você também pode acessar suas faturas em <a href="${APP_URL}/dashboard/plano" style="color:#10b981">Dashboard → Plano</a>.
              </div>
              <div style="font-size:11px;color:#6ee7b7;opacity:0.5;margin-top:24px">ZapScript · zapscript.me</div>
            </div>
          `;
          sendEmail(overdueUser.email, '⚠️ ZapScript — Pagamento não realizado — ação necessária', html)
            .catch(err => app.log.error({ err }, 'Erro ao enviar e-mail de pagamento pendente'));
        }
        break;
      }

      // ── Assinatura cancelada ──
      case 'SUBSCRIPTION_DELETED': {
        const externalRef = subEvent?.externalReference
          || payment?.subscription?.externalReference
          || '';

        const [userId] = externalRef.split('|');
        if (!userId) {
          app.log.error(`Webhook SUBSCRIPTION_DELETED: externalReference malformado: "${externalRef}"`);
          break;
        }

        // Guard: se status for 'pending', esse DELETE foi disparado pelo nosso próprio
        // fluxo de upgrade — não fazer downgrade para free.
        const currentSub = await prisma.subscription.findUnique({ where: { userId }, select: { status: true } });
        if (currentSub?.status === 'pending') {
          app.log.info(`SUBSCRIPTION_DELETED ignorado (upgrade em andamento): userId=${userId}`);
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
            update: { availableMinutes: freePlan.minutesPerMonth, resetAt: nextReset, lastAlertSent: null },
          }),
        ]);
        app.log.info(`Assinatura cancelada (downgrade para free): userId=${userId}`);
        break;
      }

      case 'PAYMENT_REFUNDED': {
        const externalRef = payment?.subscription?.externalReference
          || payment?.externalReference
          || '';

        const [userId] = externalRef.split('|');
        if (!userId) {
          app.log.error(`Webhook PAYMENT_REFUNDED: externalReference malformado: "${externalRef}"`);
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
            update: { availableMinutes: freePlan.minutesPerMonth, resetAt: nextReset, lastAlertSent: null },
          }),
        ]);
        break;
      }
    }

    return reply.send({ received: true });
  });
}
