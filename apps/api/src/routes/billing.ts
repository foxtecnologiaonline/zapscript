import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { sendEmail } from '../lib/mailer';
import { calculateProration } from '../lib/proration';
import { validateRequest, billingCheckoutSchema, billingUpgradeSchema } from '../lib/validation';
import { invalidatePlanCache } from '../lib/planGate';

/* ─────────────────────────────────────────────────────────
   ASAAS v3 — Billing Routes (Checkout Transparente)
   Docs:  https://docs.asaas.com
   Auth:  access_token header  ($aas_live_xxxxx)
   Prod:  https://api.asaas.com/api/v3
   Sand:  https://sandbox.asaas.com/api/v3
   ───────────────────────────────────────────────────────── */

const IS_PROD    = process.env.NODE_ENV === 'production';
// Prioridade: ASAAS_BASE_URL (env explícita) → fallback por NODE_ENV
const ASAAS_BASE = process.env.ASAAS_BASE_URL?.replace(/\/$/, '')
  || (IS_PROD ? 'https://api.asaas.com/api/v3' : 'https://sandbox.asaas.com/api/v3');
const ASAAS_API_KEY = process.env.ASAAS_API_KEY!;

function asaas(path: string, options: RequestInit = {}) {
  return fetch(`${ASAAS_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'access_token': ASAAS_API_KEY,
      ...(options.headers ?? {}),
    },
  });
}

/* ── Timing-safe compare ── */
function safeCompare(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/* ── Idempotência webhook ── */
async function isProcessed(paymentId: string): Promise<boolean> {
  return !!(await prisma.processedWebhook.findUnique({ where: { paymentId } }));
}
async function markProcessed(paymentId: string): Promise<void> {
  await prisma.processedWebhook.upsert({
    where: { paymentId }, create: { paymentId }, update: {},
  });
}

/* ── Preços ── */
const PLAN_PRICES: Record<string, number> = { pro: 39.90, ultra: 69.90, executive: 69.90 };
const PLAN_LABELS: Record<string, string>  = { pro: 'Pro', ultra: 'Ultra', executive: 'Executive' };

/* ── Data de hoje no formato Asaas (YYYY-MM-DD) ── */
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/* ── externalReference encoding ──
   Formato:  "<userId>|<planName>"           — assinatura normal
             "<userId>|<planName>|upgrade"   — cobrança de proration upgrade
*/
function encodeRef(userId: string, planName: string, type?: 'upgrade'): string {
  return type ? `${userId}|${planName}|${type}` : `${userId}|${planName}`;
}
function decodeRef(ref: string | undefined): { userId: string; planName: string; type?: string } | null {
  if (!ref) return null;
  const parts = ref.split('|');
  if (parts.length < 2) return null;
  return { userId: parts[0], planName: parts[1], type: parts[2] };
}

/* ── Buscar ou criar cliente no Asaas ── */
async function getOrCreateCustomer(user: {
  id: string; name: string | null; email: string; document?: string | null; phone?: string | null;
}): Promise<string> {
  const searchRes = await asaas(`/customers?email=${encodeURIComponent(user.email)}&limit=1`);
  const searchData = await searchRes.json() as any;
  const existing = searchData?.data?.[0];
  if (existing?.id) return existing.id as string;

  const doc = user.document?.replace(/\D/g, '') || undefined;
  const createRes = await asaas('/customers', {
    method: 'POST',
    body: JSON.stringify({
      name:                 user.name || 'Usuário',
      email:                user.email,
      cpfCnpj:              doc,
      mobilePhone:          user.phone?.replace(/\D/g, '') || undefined,
      externalReference:    user.id,
      notificationDisabled: false,
    }),
  });
  const customer = await createRes.json() as any;
  if (!customer?.id) {
    const err = customer?.errors?.[0]?.description || JSON.stringify(customer);
    throw new Error(`Erro ao criar cliente Asaas: ${err}`);
  }
  return customer.id as string;
}

/* ── Ativar plano no banco ── */
async function activatePlan(userId: string, planName: string, opts: {
  asaasSubscriptionId?: string | null;
  asaasCustomerId?:     string | null;
  paymentMethod?:       string | null;
  paymentId?:           string;
}): Promise<void> {
  // A6: Buscar plano e sub existente em paralelo para evitar drift de ciclo de cobrança
  const [plan, existingSub] = await Promise.all([
    prisma.plan.findUnique({ where: { name: planName } }),
    prisma.subscription.findUnique({ where: { userId }, select: { currentPeriodEnd: true } }),
  ]);
  if (!plan) throw new Error(`Plano "${planName}" não encontrado no banco`);

  // A6: Ancoragem do ciclo — se houver período ativo, extender a partir dele (não de now)
  // Evita drift progressivo quando o webhook chega depois da data de vencimento
  const now  = new Date();
  const base = existingSub?.currentPeriodEnd && existingSub.currentPeriodEnd > now
    ? existingSub.currentPeriodEnd
    : now;
  const nextPeriod = new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000);

  await prisma.$transaction([
    prisma.subscription.upsert({
      where:  { userId },
      create: {
        userId,
        planId:               plan.id,
        asaasSubscriptionId:  opts.asaasSubscriptionId ?? null,
        asaasCustomerId:      opts.asaasCustomerId ?? null,
        paymentMethod:        opts.paymentMethod ?? null,
        status:               'active',
        currentPeriodEnd:     nextPeriod,
      },
      update: {
        planId:               plan.id,
        asaasSubscriptionId:  opts.asaasSubscriptionId ?? undefined,
        asaasCustomerId:      opts.asaasCustomerId ?? undefined,
        paymentMethod:        opts.paymentMethod ?? undefined,
        status:               'active',
        currentPeriodEnd:     nextPeriod,
      },
    }),
    prisma.minuteBalance.upsert({
      where:  { userId },
      create: { userId, availableMinutes: plan.minutesPerMonth, resetAt: nextPeriod, lastAlertSent: null },
      update: { availableMinutes: plan.minutesPerMonth, resetAt: nextPeriod, lastAlertSent: null },
    }),
  ]);

  if (opts.paymentId) await markProcessed(opts.paymentId);

  // M6: Invalidar cache de plano após mudança de subscription
  invalidatePlanCache(userId).catch(() => null);
}

/* ── Buscar QR code PIX da primeira cobrança de uma assinatura ── */
async function getPixQrForSubscription(subscriptionId: string): Promise<{
  qrCode:    string | null;
  qrCodeUrl: string | null;
  expiresAt: string | null;
  paymentId: string | null;
  amount:    number;
}> {
  try {
    // Buscar primeiro pagamento da assinatura
    const pRes  = await asaas(`/subscriptions/${subscriptionId}/payments?limit=1&offset=0`);
    const pData = await pRes.json() as any;
    const firstPayment = pData?.data?.[0];
    if (!firstPayment?.id) return { qrCode: null, qrCodeUrl: null, expiresAt: null, paymentId: null, amount: 0 };

    // Buscar QR code PIX do pagamento
    const qrRes  = await asaas(`/payments/${firstPayment.id}/pixQrCode`);
    const qrData = await qrRes.json() as any;

    return {
      qrCode:    qrData?.payload       || null,
      qrCodeUrl: qrData?.encodedImage  ? `data:image/png;base64,${qrData.encodedImage}` : null,
      expiresAt: qrData?.expirationDate || null,
      paymentId: firstPayment.id,
      amount:    firstPayment.value ?? 0,
    };
  } catch {
    return { qrCode: null, qrCodeUrl: null, expiresAt: null, paymentId: null, amount: 0 };
  }
}

/* ── Mapear método frontend → billingType Asaas ── */
function toAsaasBillingType(method: string | undefined): string {
  if (method === 'credit_card') return 'CREDIT_CARD';
  if (method === 'debit_card')  return 'DEBIT_CARD';
  return 'PIX'; // pix, pix_auto, google_pay, apple_pay (+ undefined → default PIX)
}

function isCardMethod(method: string | undefined): boolean {
  return method === 'credit_card' || method === 'debit_card';
}

/* ── Montar body de creditCardHolderInfo ── */
function buildHolderInfo(user: any, billingAddress?: any) {
  return {
    name:          user.name || 'Usuário',
    email:         user.email,
    cpfCnpj:       user.document?.replace(/\D/g, '') || undefined,
    postalCode:    billingAddress?.postalCode?.replace(/\D/g, '') || undefined,
    addressNumber: billingAddress?.addressNumber || undefined,
    mobilePhone:   user.phone?.replace(/\D/g, '') || undefined,
  };
}

/* ═══════════════════════════════════════════════════════ */
export default async function billingRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any).authenticate] };

  // ── POST /billing/checkout ──────────────────────────────
  // Cria assinatura Asaas com checkout transparente.
  // Cartão: aprovado imediatamente (status: 'active')
  // PIX: retorna QR code inline para exibição
  app.post<{ Body: any }>(
    '/checkout',
    { ...auth, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req: any, reply) => {
      const v = validateRequest(billingCheckoutSchema)(req.body);
      if (!v.valid) return reply.code(400).send({ error: v.error });

      const { planName, paymentMethod, card, billingAddress } = v.data;
      const userId = req.user.sub;

      if (isCardMethod(paymentMethod) && !card) {
        return reply.code(400).send({ error: 'Dados do cartão são obrigatórios.' });
      }

      const price = PLAN_PRICES[planName];
      if (!price) return reply.code(400).send({ error: 'Plano inválido' });

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) return reply.code(401).send({ error: 'Usuário não encontrado' });

      // ── Criar/buscar cliente no Asaas ──
      let asaasCustomerId: string;
      try {
        asaasCustomerId = await getOrCreateCustomer(user);
      } catch (err: any) {
        app.log.error({ err }, 'Asaas customer error');
        return reply.code(503).send({ error: 'Serviço de pagamento indisponível. Tente novamente.' });
      }

      // ── Salvar IDs como pending antes de chamar Asaas ──
      const freePlan = await prisma.plan.findUnique({ where: { name: 'free' } });
      await prisma.subscription.upsert({
        where:  { userId },
        create: { userId, planId: freePlan?.id ?? '', asaasCustomerId, paymentMethod, status: 'pending' },
        update: { asaasCustomerId, paymentMethod, status: 'pending' },
      }).catch(e => app.log.warn({ err: e.message, userId }, '[Checkout] M2: Falha ao salvar subscription pendente — estado pode ficar inconsistente'));

      // ── Montar body da assinatura ──
      const subBody: Record<string, any> = {
        customer:          asaasCustomerId,
        billingType:       toAsaasBillingType(paymentMethod),
        value:             price,
        nextDueDate:       todayStr(),
        cycle:             'MONTHLY',
        description:       `ZapScript ${PLAN_LABELS[planName]} — Assinatura mensal`,
        externalReference: encodeRef(userId, planName),
      };

      if (isCardMethod(paymentMethod) && card) {
        subBody.creditCard = {
          holderName:  card.holderName.toUpperCase(),
          number:      card.number.replace(/\s/g, ''),
          expiryMonth: card.expiryMonth,
          expiryYear:  card.expiryYear.length === 2 ? `20${card.expiryYear}` : card.expiryYear,
          ccv:         card.ccv,
        };
        subBody.creditCardHolderInfo = buildHolderInfo(user, billingAddress);
        subBody.remoteIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
                         || req.ip
                         || '0.0.0.0';
      }

      // ── Criar assinatura no Asaas ──
      const subRes = await asaas('/subscriptions', {
        method: 'POST',
        body:   JSON.stringify(subBody),
      });
      const sub = await subRes.json() as any;

      if (!sub?.id) {
        const errMsg = sub?.errors?.[0]?.description || sub?.message || 'Erro ao criar assinatura.';
        app.log.error({ sub }, 'Asaas subscription error');
        return reply.code(400).send({ error: errMsg });
      }

      // Persistir subscription ID
      await prisma.subscription.update({
        where: { userId },
        data:  { asaasSubscriptionId: sub.id },
      }).catch(() => null);

      // ── Cartão (crédito/débito): verificar aprovação imediata ──
      if (isCardMethod(paymentMethod)) {
        if (sub.errors?.length > 0) {
          const errMsg = sub.errors[0]?.description || 'Cartão recusado.';
          return reply.code(402).send({ status: 'declined', error: errMsg });
        }
        if (sub.status === 'ACTIVE') {
          await activatePlan(userId, planName, {
            asaasSubscriptionId: sub.id,
            asaasCustomerId,
            paymentMethod,
          });
          app.log.info(`Checkout cartão aprovado: userId=${userId} plan=${planName} method=${paymentMethod}`);
          return { status: 'active', planName };
        }
        return reply.code(402).send({ status: 'declined', error: 'Cartão não aprovado. Verifique os dados e tente novamente.' });
      }

      // ── PIX: buscar QR code da primeira cobrança ──
      const qr = await getPixQrForSubscription(sub.id);
      return {
        status:         'pending_pix',
        subscriptionId: sub.id,
        paymentId:      qr.paymentId,
        qrCode:         qr.qrCode,
        qrCodeUrl:      qr.qrCodeUrl,
        expiresAt:      qr.expiresAt,
        planName,
        amount:         price,
      };
    }
  );

  // ── GET /billing/upgrade-preview ─────────────────────
  app.get<{ Querystring: { targetPlan: string } }>(
    '/upgrade-preview',
    auth,
    async (req: any, reply) => {
      const { targetPlan } = req.query;
      const userId  = req.user.sub;
      const newPrice = PLAN_PRICES[targetPlan];
      if (!newPrice) return reply.code(400).send({ error: 'Plano inválido' });

      const sub = await prisma.subscription.findUnique({
        where: { userId }, include: { plan: true },
      });
      if (!sub?.plan || sub.plan.priceBrl === 0) {
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
  // Upgrade de plano pago → pago (cobra proration + cria nova assinatura)
  app.post<{ Body: any }>(
    '/upgrade',
    { ...auth, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req: any, reply) => {
      const v = validateRequest(billingUpgradeSchema)(req.body);
      if (!v.valid) return reply.code(400).send({ error: v.error });

      const { targetPlan, paymentMethod, card, billingAddress } = v.data;
      const userId = req.user.sub;

      if (isCardMethod(paymentMethod) && !card) {
        return reply.code(400).send({ error: 'Dados do cartão são obrigatórios.' });
      }

      const newPrice = PLAN_PRICES[targetPlan];
      if (!newPrice) return reply.code(400).send({ error: 'Plano inválido' });

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) return reply.code(401).send({ error: 'Usuário não encontrado' });

      const sub = await prisma.subscription.findUnique({
        where: { userId }, include: { plan: true },
      });
      if (!sub?.plan || sub.plan.priceBrl === 0) {
        return reply.code(400).send({ error: 'Use /billing/checkout para sair do plano gratuito.' });
      }

      const currentPrice = sub.plan.priceBrl;
      if (newPrice <= currentPrice) {
        return reply.code(400).send({ error: 'Plano destino deve ser mais caro que o atual.' });
      }

      const proration = calculateProration(currentPrice, newPrice, sub.currentPeriodEnd);

      // Buscar/criar customer
      let asaasCustomerId: string;
      try {
        asaasCustomerId = sub.asaasCustomerId || await getOrCreateCustomer(user);
      } catch (err: any) {
        app.log.error({ err }, 'Asaas customer error (upgrade)');
        return reply.code(503).send({ error: 'Serviço de pagamento indisponível.' });
      }

      // ── Sem cobrança adicional (troca imediata) ──
      if (!proration.shouldCharge) {
        // C5: Criar nova assinatura PRIMEIRO — só cancelar a antiga após confirmação
        const newSubRes = await asaas('/subscriptions', {
          method: 'POST',
          body: JSON.stringify({
            customer:          asaasCustomerId,
            billingType:       toAsaasBillingType(paymentMethod),
            value:             newPrice,
            nextDueDate:       todayStr(),
            cycle:             'MONTHLY',
            description:       `ZapScript ${PLAN_LABELS[targetPlan]} — Assinatura mensal`,
            externalReference: encodeRef(userId, targetPlan),
          }),
        }).then(r => r.json()).catch(() => null) as any;

        if (!newSubRes?.id) {
          app.log.error({ newSubRes }, '[Upgrade] Falha ao criar nova assinatura — assinatura atual mantida');
          return reply.code(503).send({ error: 'Erro ao criar nova assinatura. Tente novamente.' });
        }

        // Nova assinatura confirmada — cancelar a antiga com segurança
        if (sub.asaasSubscriptionId) {
          await asaas(`/subscriptions/${sub.asaasSubscriptionId}`, { method: 'DELETE' })
            .catch(err => app.log.warn({ err }, 'Asaas: falha ao cancelar sub antiga'));
        }

        await activatePlan(userId, targetPlan, {
          asaasSubscriptionId: newSubRes.id,
          asaasCustomerId,
          paymentMethod,
        });
        return { switched: true, status: 'active', planName: targetPlan, message: 'Plano atualizado sem custo adicional.' };
      }

      // ── Criar cobrança avulsa de proration ──
      const chargeBody: Record<string, any> = {
        customer:          asaasCustomerId,
        billingType:       toAsaasBillingType(paymentMethod),
        value:             proration.proratedAmount,
        dueDate:           todayStr(),
        description:       `Upgrade ZapScript: ${sub.plan.label} → ${PLAN_LABELS[targetPlan]}`,
        externalReference: encodeRef(userId, targetPlan, 'upgrade'),
      };

      if (isCardMethod(paymentMethod) && card) {
        chargeBody.creditCard = {
          holderName:  card.holderName.toUpperCase(),
          number:      card.number.replace(/\s/g, ''),
          expiryMonth: card.expiryMonth,
          expiryYear:  card.expiryYear.length === 2 ? `20${card.expiryYear}` : card.expiryYear,
          ccv:         card.ccv,
        };
        chargeBody.creditCardHolderInfo = buildHolderInfo(user, billingAddress);
        chargeBody.remoteIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
                             || req.ip || '0.0.0.0';
      }

      const chargeRes = await asaas('/payments', {
        method: 'POST',
        body:   JSON.stringify(chargeBody),
      });
      const charge = await chargeRes.json() as any;

      if (!charge?.id) {
        app.log.error({ charge }, 'Asaas: erro ao criar cobrança de upgrade');
        return reply.code(500).send({ error: 'Erro ao criar cobrança. Tente novamente.' });
      }

      // ── Cartão (crédito/débito): aprovação imediata no upgrade ──
      if (isCardMethod(paymentMethod)) {
        if (charge.errors?.length > 0) {
          const errMsg = charge.errors[0]?.description || 'Cartão recusado.';
          return reply.code(402).send({ status: 'declined', error: errMsg });
        }
        if (charge.status === 'CONFIRMED' || charge.status === 'RECEIVED') {
          // Cancelar sub antiga + criar nova + ativar
          if (sub.asaasSubscriptionId) {
            await asaas(`/subscriptions/${sub.asaasSubscriptionId}`, { method: 'DELETE' })
              .catch(err => app.log.warn({ err }, 'Asaas: falha ao cancelar sub antiga (upgrade)'));
          }
          const newSubRes = await asaas('/subscriptions', {
            method: 'POST',
            body: JSON.stringify({
              customer:          asaasCustomerId,
              billingType:       toAsaasBillingType(paymentMethod),
              value:             newPrice,
              nextDueDate:       todayStr(),
              cycle:             'MONTHLY',
              description:       `ZapScript ${PLAN_LABELS[targetPlan]} — Assinatura mensal`,
              externalReference: encodeRef(userId, targetPlan),
            }),
          }).then(r => r.json()).catch(() => null) as any;

          await activatePlan(userId, targetPlan, {
            asaasSubscriptionId: newSubRes?.id ?? null,
            asaasCustomerId,
            paymentMethod,
            paymentId: charge.id,
          });
          app.log.info(`Upgrade cartão aprovado: userId=${userId} plan=${targetPlan} method=${paymentMethod}`);
          return { status: 'active', switched: true, planName: targetPlan };
        }
        return reply.code(402).send({ status: 'declined', error: 'Pagamento não aprovado.' });
      }

      // ── PIX: retornar QR code para pagar proration ──
      let qrCode    = null as string | null;
      let qrCodeUrl = null as string | null;
      let expiresAt = null as string | null;
      try {
        const qrRes  = await asaas(`/payments/${charge.id}/pixQrCode`);
        const qrData = await qrRes.json() as any;
        qrCode    = qrData?.payload       || null;
        qrCodeUrl = qrData?.encodedImage  ? `data:image/png;base64,${qrData.encodedImage}` : null;
        expiresAt = qrData?.expirationDate || null;
      } catch { /* QR não crítico */ }

      return {
        status:         'pending_pix',
        chargeId:       charge.id,
        qrCode,
        qrCodeUrl,
        expiresAt,
        proratedAmount: proration.proratedAmount,
        remainingDays:  proration.remainingDays,
      };
    }
  );

  // ── POST /billing/cancel ──────────────────────────────
  app.post('/cancel', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const sub = await prisma.subscription.findUnique({
      where: { userId }, include: { plan: true },
    });
    if (!sub || sub.plan.name === 'free') {
      return reply.code(400).send({ error: 'Nenhuma assinatura paga ativa para cancelar.' });
    }

    if (sub.asaasSubscriptionId) {
      await asaas(`/subscriptions/${sub.asaasSubscriptionId}`, { method: 'DELETE' })
        .catch(err => app.log.warn({ err }, 'Asaas: falha ao cancelar assinatura'));
    }

    const freePlan = await prisma.plan.findUnique({ where: { name: 'free' } });
    if (!freePlan) return reply.code(500).send({ error: 'Plano free não encontrado.' });

    const nextReset = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await prisma.$transaction([
      prisma.subscription.update({
        where: { userId },
        data:  { planId: freePlan.id, status: 'canceled', asaasSubscriptionId: null, currentPeriodEnd: null },
      }),
      prisma.minuteBalance.update({
        where: { userId },
        data:  { availableMinutes: freePlan.minutesPerMonth, resetAt: nextReset, lastAlertSent: null },
      }),
    ]);

    return { canceled: true, message: 'Assinatura cancelada. Você voltou para o plano gratuito.' };
  });

  // ── GET /billing/invoices ─────────────────────────────
  app.get('/invoices', auth, async (req: any) => {
    const userId = req.user.sub;
    const sub = await prisma.subscription.findUnique({ where: { userId } });
    if (!sub?.asaasCustomerId) return { invoices: [] };

    try {
      const res  = await asaas(`/payments?customer=${sub.asaasCustomerId}&limit=12&offset=0`);
      const data = await res.json() as any;

      // Mapear status Asaas → UI
      const statusMap: Record<string, { label: string; color: string }> = {
        RECEIVED:         { label: 'Pago',        color: 'text-emerald-400' },
        CONFIRMED:        { label: 'Pago',        color: 'text-emerald-400' },
        PENDING:          { label: 'Pendente',    color: 'text-amber-400'   },
        AWAITING_RISK_ANALYSIS: { label: 'Em análise', color: 'text-amber-400' },
        OVERDUE:          { label: 'Atrasado',    color: 'text-red-400'     },
        REFUNDED:         { label: 'Reembolsado', color: 'text-brand-muted' },
        PARTIALLY_REFUNDED: { label: 'Parcialmente reembolsado', color: 'text-brand-muted' },
        CHARGEBACK_REQUESTED: { label: 'Chargeback', color: 'text-red-400' },
        DUNNING_REQUESTED:    { label: 'Em cobrança', color: 'text-amber-400' },
        DUNNING_RECEIVED:     { label: 'Regularizado', color: 'text-emerald-400' },
        CANCELED:         { label: 'Cancelado',   color: 'text-brand-muted' },
      };

      const invoices = (data?.data || []).map((p: any) => {
        const st = statusMap[p.status] || { label: p.status, color: 'text-brand-muted' };
        return {
          id:          p.id,
          value:       p.value,
          status:      p.status,
          statusLabel: st.label,
          statusColor: st.color,
          dueDate:     p.dueDate,
          paymentDate: p.paymentDate || p.clientPaymentDate,
          invoiceUrl:  p.invoiceUrl || null,
          billingType: p.billingType,
          description: p.description || 'Assinatura ZapScript',
        };
      });

      return { invoices };
    } catch (err) {
      app.log.error({ err }, 'Erro ao buscar faturas Asaas');
      return { invoices: [] };
    }
  });

  // ── GET /billing/sync ─────────────────────────────────
  // Fallback: verifica status no Asaas e ativa se pago
  app.get('/sync', auth, async (req: any) => {
    const userId = req.user.sub;
    const sub = await prisma.subscription.findUnique({
      where: { userId }, include: { plan: true },
    });

    if (!sub) return { synced: false, reason: 'no_subscription' };
    if (sub.status === 'active' && sub.plan.name !== 'free') {
      return { synced: true, reason: 'already_active', planName: sub.plan.name };
    }

    try {
      // Verificar via assinatura Asaas
      if (sub.asaasSubscriptionId) {
        const res  = await asaas(`/subscriptions/${sub.asaasSubscriptionId}`);
        const data = await res.json() as any;
        if (data?.status === 'ACTIVE') {
          const decoded = decodeRef(data.externalReference);
          const planName = decoded?.planName || null;
          if (planName) {
            await activatePlan(userId, planName, {
              asaasSubscriptionId: sub.asaasSubscriptionId,
              asaasCustomerId:     sub.asaasCustomerId,
              paymentMethod:       sub.paymentMethod,
            });
            app.log.info(`[Sync] Plano ativado: userId=${userId} plan=${planName}`);
            return { synced: true, planName };
          }
        }
      }

      // Verificar via pagamentos recebidos do cliente
      if (sub.asaasCustomerId) {
        const res  = await asaas(`/payments?customer=${sub.asaasCustomerId}&status=RECEIVED&limit=1`);
        const data = await res.json() as any;
        const payment = data?.data?.[0];
        if (payment?.id) {
          const decoded = decodeRef(payment.externalReference);
          const planName = decoded?.planName || null;
          if (planName && !(await isProcessed(payment.id))) {
            await activatePlan(userId, planName, {
              asaasSubscriptionId: sub.asaasSubscriptionId,
              asaasCustomerId:     sub.asaasCustomerId,
              paymentMethod:       sub.paymentMethod,
              paymentId:           payment.id,
            });
            return { synced: true, planName };
          }
        }
      }

      return { synced: false, reason: 'no_confirmed_payment' };
    } catch (err: any) {
      app.log.error({ err }, 'Erro no billing/sync');
      return { synced: false, reason: 'error', message: err.message };
    }
  });

  // ── GET /billing/portal ───────────────────────────────
  // Asaas não tem portal do assinante — retorna link para dashboard
  app.get('/portal', auth, async (_req: any) => {
    const APP_URL = process.env.APP_URL || 'https://zapscript.me';
    return { url: `${APP_URL}/dashboard/plano` };
  });

  // ── POST /billing/webhook ─────────────────────────────
  // Asaas envia eventos via POST (configurar endpoint no painel Asaas)
  // Validação: header "asaas-access-token" deve bater com ASAAS_WEBHOOK_TOKEN
  app.post('/webhook', async (req: any, reply) => {
    const webhookToken = process.env.ASAAS_WEBHOOK_TOKEN;
    if (webhookToken) {
      const headerToken = req.headers['asaas-access-token'] as string | undefined;
      if (!safeCompare(headerToken, webhookToken)) {
        app.log.error('Asaas webhook: token inválido');
        return reply.code(401).send({ error: 'Unauthorized' });
      }
    }

    const body      = req.body as any;
    const eventType = body?.event as string;

    app.log.info(`Asaas webhook: ${eventType}`);

    // ── Pagamento confirmado (cartão ou PIX) ──
    if (eventType === 'PAYMENT_RECEIVED' || eventType === 'PAYMENT_CONFIRMED') {
      const payment = body?.payment;
      if (!payment?.id) return reply.send({ received: true });

      if (await isProcessed(payment.id)) {
        app.log.info(`Webhook duplicado ignorado: paymentId=${payment.id}`);
        return reply.send({ received: true });
      }

      const decoded = decodeRef(payment.externalReference);
      if (!decoded?.userId || !decoded?.planName) {
        app.log.error({ ref: payment.externalReference }, `Webhook ${eventType}: externalReference inválido`);
        return reply.send({ received: true });
      }

      const { userId, planName, type } = decoded;

      if (type === 'upgrade') {
        // ── Cobrança de proration do upgrade aprovada ──
        const sub = await prisma.subscription.findUnique({ where: { userId } }).catch(() => null);
        const asaasCustomerId = sub?.asaasCustomerId || payment?.customer;

        // Cancelar assinatura antiga
        if (sub?.asaasSubscriptionId) {
          await asaas(`/subscriptions/${sub.asaasSubscriptionId}`, { method: 'DELETE' })
            .catch(err => app.log.warn({ err }, 'Asaas: falha ao cancelar sub antiga (webhook upgrade)'));
        }
        // Criar nova assinatura
        const newSubRes = await asaas('/subscriptions', {
          method: 'POST',
          body: JSON.stringify({
            customer:          asaasCustomerId,
            billingType:       payment.billingType || 'PIX',
            value:             PLAN_PRICES[planName] ?? 0,
            nextDueDate:       todayStr(),
            cycle:             'MONTHLY',
            description:       `ZapScript ${PLAN_LABELS[planName]} — Assinatura mensal`,
            externalReference: encodeRef(userId, planName),
          }),
        }).then(r => r.json()).catch(() => null) as any;

        await activatePlan(userId, planName, {
          asaasSubscriptionId: newSubRes?.id ?? null,
          asaasCustomerId,
          paymentMethod:       payment.billingType === 'CREDIT_CARD' ? 'credit_card' : payment.billingType === 'DEBIT_CARD' ? 'debit_card' : 'pix',
          paymentId:           payment.id,
        });
        app.log.info(`Upgrade via webhook: userId=${userId} plan=${planName}`);

      } else {
        // ── Pagamento de assinatura normal ──
        // Buscar asaasSubscriptionId da sub no banco (para garantir que está salvo)
        const subInDb = await prisma.subscription.findUnique({ where: { userId } }).catch(() => null);
        const asaasSubId = payment.subscription || subInDb?.asaasSubscriptionId || null;

        await activatePlan(userId, planName, {
          asaasSubscriptionId: asaasSubId,
          asaasCustomerId:     payment.customer || subInDb?.asaasCustomerId || null,
          paymentMethod:       payment.billingType === 'CREDIT_CARD' ? 'credit_card' : payment.billingType === 'DEBIT_CARD' ? 'debit_card' : 'pix',
          paymentId:           payment.id,
        });
        app.log.info(`Pagamento confirmado: userId=${userId} plan=${planName}`);
      }

      return reply.send({ received: true });
    }

    // ── Pagamento atrasado ──
    if (eventType === 'PAYMENT_OVERDUE') {
      const payment = body?.payment;
      const decoded = decodeRef(payment?.externalReference);
      const userId  = decoded?.userId;
      if (userId) {
        await prisma.subscription.update({
          where: { userId },
          data:  { status: 'past_due' },
        }).catch(() => null);

        const failedUser = await prisma.user.findUnique({
          where: { id: userId }, select: { email: true, name: true },
        }).catch(() => null);

        if (failedUser?.email) {
          const APP_URL   = process.env.APP_URL || 'https://zapscript.me';
          const firstName = failedUser.name?.split(' ')[0] || 'você';
          const html = `
            <div style="font-family:sans-serif;max-width:540px;margin:0 auto;background:#050a07;color:#d1fae5;padding:32px;border-radius:12px">
              <div style="font-size:22px;font-weight:bold;margin-bottom:16px">⚠️ Pagamento pendente</div>
              <div style="font-size:14px;line-height:1.7;color:#a7f3d0">
                Olá, <strong>${firstName}</strong>!<br><br>
                O pagamento da sua assinatura <strong>ZapScript</strong> está em atraso.<br><br>
                Regularize em até <strong>3 dias</strong> para manter seu acesso ao plano atual.
              </div>
              <div style="margin:24px 0;text-align:center">
                <a href="${APP_URL}/dashboard/plano" style="background:#f59e0b;color:#1c1204;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:15px">Regularizar pagamento →</a>
              </div>
              <div style="font-size:11px;color:#6ee7b7;opacity:0.5;margin-top:24px">ZapScript · zapscript.me</div>
            </div>
          `;
          sendEmail(failedUser.email, '⚠️ ZapScript — Pagamento pendente', html)
            .catch(err => app.log.error({ err }, 'Erro ao enviar e-mail de cobrança'));
        }
      }
      return reply.send({ received: true });
    }

    // ── Assinatura removida pelo Asaas (cancelamento) ──
    if (eventType === 'PAYMENT_DELETED') {
      // Apenas log — cancelamento real é tratado via /billing/cancel
      app.log.info(`Pagamento deletado no Asaas: ${JSON.stringify(body?.payment?.id)}`);
      return reply.send({ received: true });
    }

    // Outros eventos — aceitar sem processar
    app.log.info(`Asaas webhook ignorado: ${eventType}`);
    return reply.send({ received: true });
  });
}
