import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { sendEmail } from '../lib/mailer';
import { decryptStr } from '../services/encryption';

/** Escapa HTML para evitar injeção em templates de e-mail (C1) */
function escHtml(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
import { calculateProration } from '../lib/proration';
import { validateRequest, billingCheckoutSchema, billingUpgradeSchema, moduleSubscribeSchema } from '../lib/validation';
import { invalidatePlanCache } from '../lib/planGate';
import { attributeAffiliateCommission, clawbackAffiliateCommissionOnCancel } from '../lib/affiliate';
import { invalidateModuleCache } from '../lib/moduleGate';

/* ─────────────────────────────────────────────────────────
   ASAAS v3 — Billing Routes (Checkout Transparente)
   Docs:  https://docs.asaas.com
   Auth:  access_token header  ($aas_live_xxxxx)
   Prod:  https://api.asaas.com/api/v3
   Sand:  https://sandbox.asaas.com/api/v3
   ───────────────────────────────────────────────────────── */

// Cliente Asaas compartilhado (lib/asaas.ts) — usado também pelo admin.
import { asaas } from '../lib/asaas';

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

/* ── Preços ──
   profissional/empresas: "aluguel" = mensal (PLAN_PRICES), "compra" = anual
   (PLAN_PRICES_YEARLY) — sistemática inicial de preços, definida em
   conversa de negócio (2026-07-29). */
export const PLAN_PRICES:        Record<string, number> = { pro: 37,  executive: 67,  profissional: 49,  empresas: 99  };
export const PLAN_PRICES_YEARLY: Record<string, number> = { pro: 355, executive: 643, profissional: 295, empresas: 595 };
const PLAN_LABELS:        Record<string, string> = { pro: 'Pro',  executive: 'Executive', profissional: 'Profissional', empresas: 'Empresas' };

/* ── Tiers ZapScript 2.0 (revisão): "tiers absorvem os módulos" — cada tier
   paga empacota um conjunto fixo de módulos já existentes na suíte.
   Core (free) = transcrição + resumo, sem módulo algum.
   Profissional = Core + Atende (1 usuário/1 conexão).
   Empresas = Core + Atende + CRM + Tarefas (até 5 usuários).
   Sincronizado em activatePlan() via Entitlement(source='bundle'), nunca
   mexendo em módulos comprados avulso (source='paid'). Ver MODULOS_ARQUITETURA.md. ── */
const TIER_MODULE_BUNDLES: Record<string, string[]> = {
  profissional: ['atende'],
  empresas:     ['atende', 'crm', 'tarefas'],
};

/* ── Combo (Core + módulos disponíveis): % fixo sobre a soma do valor agregado ── */
const COMBO_DISCOUNT_PCT = 0.20;

/* ── Oferta permanente: 1º mês de assinatura mensal Pro com 50% off (R$18) ── */
const JUNE_PROMO_PRICE = 18;
function isJunePromoActive(): boolean {
  return true;
}

/* ── Pacotes de minutos avulsos (valem 60 dias) ── */
export const MINUTE_PACKAGES = [
  { id: 'pkg_50',  minutes: 50,  priceBrl: 11, label: '50 minutos',  desc: 'Mais econômico' },
  { id: 'pkg_100', minutes: 100, priceBrl: 19, label: '100 minutos', desc: 'Melhor valor' },
] as const;

/* ── Validade do saldo extra (minutos avulsos / indicação) ── */
const EXTRA_MINUTES_VALIDITY_DAYS = 60;
export function extraMinutesExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + EXTRA_MINUTES_VALIDITY_DAYS * 24 * 60 * 60 * 1000);
}

/* ── Creditar minutos extras (bucket de 60 dias) ──
   Incrementa extraMinutes e renova a validade para now+60d. Não toca no pool do plano.
   Idempotente do ponto de vista de saldo apenas se chamado uma vez por evento (proteção via processedWebhook). */
export async function creditExtraMinutes(userId: string, minutes: number): Promise<void> {
  if (!minutes || minutes <= 0) return;
  const now    = new Date();
  const expiry = extraMinutesExpiry(now);
  await prisma.minuteBalance.upsert({
    where:  { userId },
    create: { userId, availableMinutes: 0, extraMinutes: minutes, extraExpiresAt: expiry, resetAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) },
    update: { extraMinutes: { increment: minutes }, extraExpiresAt: expiry },
  });
}

/* ── Data de hoje no formato Asaas (YYYY-MM-DD) ── */
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/* ── Prazo de 3h para expiração do QR PIX ── */
function threeHoursFromNow(): string {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
}

/* ── externalReference encoding ──
   Formato:  "<userId>|<planName>"              — assinatura normal
             "<userId>|<planName>|upgrade"      — cobrança de proration upgrade
             "<userId>|pkg_minutes|<N>"         — pacote de minutos avulso (N = minutos)
*/
function encodeRef(userId: string, planName: string, type?: 'upgrade' | 'yearly' | string): string {
  return type ? `${userId}|${planName}|${type}` : `${userId}|${planName}`;
}
function decodeRef(ref: string | undefined): { userId: string; planName: string; type?: string } | null {
  if (!ref) return null;
  const parts = ref.split('|');
  if (parts.length < 2) return null;
  return { userId: parts[0], planName: parts[1], type: parts[2] };
}
function encodeMinutePackageRef(userId: string, minutes: number): string {
  return `${userId}|pkg_minutes|${minutes}`;
}

/* ── externalReference de contratação de módulo ──
   Formato: "<userId>|module|<productKey>" — cobrança de ativação/proration de módulo.
   Checado ANTES de decodeRef() no webhook (planName nunca é literalmente "module"). */
function encodeModuleRef(userId: string, productKey: string): string {
  return `${userId}|module|${productKey}`;
}
function decodeModuleRef(ref: string | undefined): { userId: string; productKey: string } | null {
  if (!ref) return null;
  const parts = ref.split('|');
  if (parts.length < 3 || parts[1] !== 'module') return null;
  return { userId: parts[0], productKey: parts[2] };
}

/* ── externalReference de contratação do Combo (Core + módulos disponíveis) ──
   Formato: "<userId>|combo|<corePlanName>" — carrega o plano-núcleo resolvido no
   momento da cobrança (mantém o tier atual do usuário ou default 'pro'), para o
   webhook não precisar recalcular. Checado ANTES de decodeRef() — um ref de plano
   comum nunca tem "combo" como planName. */
function encodeComboRef(userId: string, corePlanName: string): string {
  return `${userId}|combo|${corePlanName}`;
}
function decodeComboRef(ref: string | undefined): { userId: string; corePlanName: string } | null {
  if (!ref) return null;
  const parts = ref.split('|');
  if (parts.length < 3 || parts[1] !== 'combo') return null;
  return { userId: parts[0], corePlanName: parts[2] };
}

/* ── Módulos contratáveis (ga/beta, exceto core) que o usuário ainda não possui ativo —
   base dinâmica do Combo: cresce sozinha quando um novo módulo sai de "planned". ── */
async function resolveComboModules(userId: string): Promise<Array<{ key: string; name: string; priceMonthly: number }>> {
  const [products, owned] = await Promise.all([
    prisma.product.findMany({
      where:  { status: { in: ['ga', 'beta'] }, key: { not: 'core' } },
      select: { key: true, name: true, priceMonthly: true },
    }),
    prisma.entitlement.findMany({
      where:  { userId, status: 'active' },
      select: { productKey: true },
    }),
  ]);
  const ownedKeys = new Set(owned.map((e: { productKey: string }) => e.productKey));
  return products.filter((p: { key: string }) => !ownedKeys.has(p.key));
}

/* ── Buscar ou criar cliente no Asaas ── */
async function getOrCreateCustomer(user: {
  id: string; name: string | null; email: string; document?: string | null; phone?: string | null;
}): Promise<string> {
  const searchRes = await asaas(`/customers?email=${encodeURIComponent(user.email)}&limit=1`);
  const searchData = await searchRes.json() as any;
  const existing = searchData?.data?.[0];
  if (existing?.id) return existing.id as string;

  // C2: decriptar CPF/CNPJ (AES-256-GCM) antes de enviar ao Asaas
  const doc = decryptStr(user.document)?.replace(/\D/g, '') || undefined;
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
  yearly?:              boolean;
  comboDiscountPct?:    number | null; // setar (Combo) ou limpar (null) o desconto agregado
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
  const cycleDays  = opts.yearly ? 365 : 30;
  const nextPeriod = new Date(base.getTime() + cycleDays * 24 * 60 * 60 * 1000);

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
        comboDiscountPct:     opts.comboDiscountPct ?? null,
      },
      update: {
        planId:               plan.id,
        asaasSubscriptionId:  opts.asaasSubscriptionId ?? undefined,
        asaasCustomerId:      opts.asaasCustomerId ?? undefined,
        paymentMethod:        opts.paymentMethod ?? undefined,
        status:               'active',
        currentPeriodEnd:     nextPeriod,
        comboDiscountPct:     opts.comboDiscountPct !== undefined ? opts.comboDiscountPct : undefined,
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

  // ── Tiers ZapScript 2.0: sincroniza os módulos inclusos no pacote, com o
  // mesmo período de cobrança do tier (mensal ou anual). Ativa os do bundle
  // novo E revoga os que só existiam por causa de um tier anterior (migração
  // entre tiers, ex.: empresas → atende perde campanhas/cobrança). Módulos
  // comprados avulso (source='paid') nunca são afetados.
  const bundleKeys = TIER_MODULE_BUNDLES[planName] ?? [];
  for (const key of bundleKeys) {
    await activateModuleEntitlement(userId, key, { periodDays: cycleDays, source: 'bundle' });
  }
  await prisma.entitlement.updateMany({
    where: {
      userId, source: 'bundle', status: { in: ['active', 'trialing'] },
      ...(bundleKeys.length ? { productKey: { notIn: bundleKeys } } : {}),
    },
    data: { status: 'canceled', canceledAt: new Date() },
  });
  invalidateModuleCache(userId).catch(() => null);
}

/* ── Valor agregado atual: core pago (se houver) + módulos pagos ativos ──
   Fonte única da verdade da premissa "1 transação, valor total somado". Lê sempre
   do banco (Subscription+Plan, Entitlement+Product) — nunca do catálogo estático.
   Se houver comboDiscountPct (contratação via Combo), aplica sobre o total somado. */
async function computeAggregateValue(userId: string): Promise<number> {
  const [sub, entitlements] = await Promise.all([
    prisma.subscription.findUnique({ where: { userId }, include: { plan: true } }),
    prisma.entitlement.findMany({
      where:  { userId, status: 'active', source: 'paid' },
      select: { productKey: true },
    }),
  ]);
  const corePart = sub?.plan && sub.plan.name !== 'free' ? sub.plan.priceBrl : 0;
  const discount = sub?.comboDiscountPct ?? 0;
  if (entitlements.length === 0) return Math.round(corePart * (1 - discount) * 100) / 100;

  const products = await prisma.product.findMany({
    where:  { key: { in: entitlements.map((e: { productKey: string }) => e.productKey) } },
    select: { priceMonthly: true },
  });
  const modulesPart = products.reduce((sum: number, p: { priceMonthly: number }) => sum + p.priceMonthly, 0);
  return Math.round((corePart + modulesPart) * (1 - discount) * 100) / 100;
}

/* ── Recriar a assinatura Asaas agregada num novo valor total ──
   Mesma proteção do /billing/upgrade: cria a nova ANTES de cancelar a antiga. */
async function reissueAggregateSubscription(opts: {
  userId: string;
  asaasCustomerId: string;
  newValue: number;
  paymentMethod?: string | null;
  oldAsaasSubscriptionId?: string | null;
  description: string;
}): Promise<string | null> {
  const newSubRes = await asaas('/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      customer:          opts.asaasCustomerId,
      billingType:       toAsaasBillingType(opts.paymentMethod ?? undefined),
      value:             opts.newValue,
      nextDueDate:       todayStr(),
      cycle:             'MONTHLY',
      description:       opts.description,
      externalReference: opts.userId,
    }),
  }).then(r => r.json()).catch(() => null) as any;

  if (!newSubRes?.id) return null;

  if (opts.oldAsaasSubscriptionId) {
    await asaas(`/subscriptions/${opts.oldAsaasSubscriptionId}`, { method: 'DELETE' }).catch(() => null);
  }
  return newSubRes.id as string;
}

/* ── Ativar entitlement de módulo no banco (upsert) ──
   'pending' (PIX aguardando confirmação) nunca concede acesso — ver moduleGate.ts ACTIVE_STATUSES. */
async function activateModuleEntitlement(userId: string, productKey: string, opts: {
  paymentId?:  string;
  periodDays?: number; // padrão 30 (módulo avulso mensal); tiers passam o ciclo do Plan (30 ou 365)
  source?:     string; // padrão 'paid' (avulso); tiers passam 'bundle'
} = {}): Promise<void> {
  const periodDays = opts.periodDays ?? 30;
  const source      = opts.source ?? 'paid';
  const nextPeriod = new Date(Date.now() + periodDays * 24 * 60 * 60 * 1000);
  await prisma.entitlement.upsert({
    where:  { userId_productKey: { userId, productKey } },
    create: { userId, productKey, status: 'active', source, currentPeriodEnd: nextPeriod },
    update: { status: 'active', source, currentPeriodEnd: nextPeriod, canceledAt: null },
  });
  if (opts.paymentId) await markProcessed(opts.paymentId);
  invalidateModuleCache(userId).catch(() => null);
}

/* ── Ativar o Combo no banco: sobe o plano-núcleo (mantém tier atual ou 'pro') +
   ativa todos os módulos contratáveis que o usuário ainda não possui, com o
   desconto agregado. Reaproveitado pelos 3 caminhos de confirmação (sem cobrança
   adicional, cartão aprovado na hora, PIX confirmado via webhook). ── */
async function activateCombo(userId: string, corePlanName: string, opts: {
  asaasSubscriptionId?: string | null;
  asaasCustomerId?:     string | null;
  paymentMethod?:       string | null;
  paymentId?:           string;
} = {}): Promise<{ modules: Array<{ key: string; name: string; priceMonthly: number }> }> {
  const modules = await resolveComboModules(userId);
  await activatePlan(userId, corePlanName, {
    asaasSubscriptionId: opts.asaasSubscriptionId ?? null,
    asaasCustomerId:     opts.asaasCustomerId ?? null,
    paymentMethod:       opts.paymentMethod ?? null,
    paymentId:           opts.paymentId,
    comboDiscountPct:    COMBO_DISCOUNT_PCT,
  });
  for (const m of modules) {
    await activateModuleEntitlement(userId, m.key);
  }
  return { modules };
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
      expiresAt: threeHoursFromNow(),
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
    cpfCnpj:       decryptStr(user.document)?.replace(/\D/g, '') || undefined,
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

      const { planName, paymentMethod, card, billingAddress, billingCycle } = v.data;
      const userId  = req.user.sub;
      const isYearly = billingCycle === 'yearly';

      if (isCardMethod(paymentMethod) && !card) {
        return reply.code(400).send({ error: 'Dados do cartão são obrigatórios.' });
      }

      const price = isYearly ? PLAN_PRICES_YEARLY[planName] : PLAN_PRICES[planName];
      if (!price) return reply.code(400).send({ error: 'Plano inválido' });

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) return reply.code(401).send({ error: 'Usuário não encontrado' });

      // ── Gate da assinatura (Opção A): e-mail verificado + CPF/CNPJ ──
      if (!user.emailVerified) {
        return reply.code(403).send({
          code:  'EMAIL_NOT_VERIFIED',
          error: 'Confirme seu e-mail antes de assinar um plano.',
        });
      }
      if (!user.document) {
        return reply.code(400).send({
          code:  'DOCUMENT_REQUIRED',
          error: 'Informe seu CPF/CNPJ para assinar um plano.',
        });
      }

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
      }).catch((e: any) => app.log.warn({ err: e.message, userId }, '[Checkout] M2: Falha ao salvar subscription pendente — estado pode ficar inconsistente'));

// ── Promoção de lançamento (Junho/2026): 1º mês a R$18 em assinaturas MENSAIS Pro ──
      // Estratégia Asaas: cobrança avulsa do 1º mês no valor promocional + assinatura recorrente
      // no valor cheio com 1º vencimento em +30 dias (a partir do 2º mês cobra o valor normal).
      const promoActive = isJunePromoActive() && !isYearly && planName === 'pro';
      if (promoActive) {
        const nextDue  = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const remoteIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '0.0.0.0';
        const cardObj  = card ? {
          holderName:  card.holderName.toUpperCase(),
          number:      card.number.replace(/\s/g, ''),
          expiryMonth: card.expiryMonth,
          expiryYear:  card.expiryYear.length === 2 ? `20${card.expiryYear}` : card.expiryYear,
          ccv:         card.ccv,
        } : null;

        if (isCardMethod(paymentMethod) && cardObj) {
          // 1) Cobrança avulsa do 1º mês (valor promocional) no cartão
          const firstCharge = await asaas('/payments', {
            method: 'POST',
            body: JSON.stringify({
              customer:             asaasCustomerId,
              billingType:          toAsaasBillingType(paymentMethod),
              value:                JUNE_PROMO_PRICE,
              dueDate:              todayStr(),
              description:          `ZapScript ${PLAN_LABELS[planName]} — 1º mês promocional`,
              externalReference:    encodeRef(userId, planName),
              creditCard:           cardObj,
              creditCardHolderInfo: buildHolderInfo(user, billingAddress),
              remoteIp,
            }),
          }).then(r => r.json()) as any;

          if (firstCharge?.errors?.length) {
            return reply.code(402).send({ status: 'declined', error: firstCharge.errors[0]?.description || 'Cartão recusado.' });
          }
          if (firstCharge?.status !== 'CONFIRMED' && firstCharge?.status !== 'RECEIVED') {
            return reply.code(402).send({ status: 'declined', error: 'Cartão não aprovado. Verifique os dados e tente novamente.' });
          }

          // 2) Assinatura recorrente no valor cheio, 1ª recorrência em +30 dias (reutiliza o cartão tokenizado)
          const ccToken = firstCharge?.creditCard?.creditCardToken;
          const subRes = await asaas('/subscriptions', {
            method: 'POST',
            body: JSON.stringify({
              customer:          asaasCustomerId,
              billingType:       toAsaasBillingType(paymentMethod),
              value:             PLAN_PRICES[planName],
              nextDueDate:       nextDue,
              cycle:             'MONTHLY',
              description:       `ZapScript ${PLAN_LABELS[planName]} — Assinatura mensal`,
              externalReference: encodeRef(userId, planName),
              ...(ccToken
                ? { creditCardToken: ccToken }
                : { creditCard: cardObj, creditCardHolderInfo: buildHolderInfo(user, billingAddress), remoteIp }),
            }),
          }).then(r => r.json()) as any;

          await prisma.subscription.update({
            where: { userId }, data: { asaasSubscriptionId: subRes?.id ?? null },
          }).catch(() => null);

          await activatePlan(userId, planName, {
            asaasSubscriptionId: subRes?.id ?? null,
            asaasCustomerId,
            paymentMethod,
          });
          await markProcessed(firstCharge.id);
          app.log.info(`Checkout 1º mês 50% off (cartão): userId=${userId} 1ºmês=${JUNE_PROMO_PRICE} recorrência=${PLAN_PRICES[planName]}`);
          return { status: 'active', planName, promo: true };
        }

        // ── PIX promocional ──
        // 1) Assinatura recorrente no valor cheio com 1º vencimento em +30 dias
        const subRes = await asaas('/subscriptions', {
          method: 'POST',
          body: JSON.stringify({
            customer:          asaasCustomerId,
            billingType:       'PIX',
            value:             PLAN_PRICES[planName],
            nextDueDate:       nextDue,
            cycle:             'MONTHLY',
            description:       `ZapScript ${PLAN_LABELS[planName]} — Assinatura mensal`,
            externalReference: encodeRef(userId, planName),
          }),
        }).then(r => r.json()) as any;
        if (!subRes?.id) {
          const errMsg = subRes?.errors?.[0]?.description || subRes?.message || 'Erro ao criar assinatura.';
          app.log.error({ subRes }, 'Asaas subscription error (promo PIX)');
          return reply.code(400).send({ error: errMsg });
        }
        await prisma.subscription.update({
          where: { userId }, data: { asaasSubscriptionId: subRes.id },
        }).catch(() => null);

        // 2) Cobrança PIX avulsa do 1º mês promocional
        const firstPix = await asaas('/payments', {
          method: 'POST',
          body: JSON.stringify({
            customer:          asaasCustomerId,
            billingType:       'PIX',
            value:             JUNE_PROMO_PRICE,
            dueDate:           todayStr(),
            description:       `ZapScript ${PLAN_LABELS[planName]} — 1º mês promocional`,
            externalReference: encodeRef(userId, planName),
          }),
        }).then(r => r.json()) as any;
        if (firstPix?.errors?.length || !firstPix?.id) {
          return reply.code(400).send({ error: firstPix?.errors?.[0]?.description || 'Erro ao gerar PIX.' });
        }
        const qrData = await asaas(`/payments/${firstPix.id}/pixQrCode`).then(r => r.json()) as any;
        app.log.info(`Checkout 1º mês 50% off (PIX): userId=${userId} 1ºmês=${JUNE_PROMO_PRICE} recorrência=${PLAN_PRICES[planName]}`);
        return {
          status:         'pending_pix',
          subscriptionId: subRes.id,
          paymentId:      firstPix.id,
          qrCode:         qrData?.payload      || null,
          qrCodeUrl:      qrData?.encodedImage ? `data:image/png;base64,${qrData.encodedImage}` : null,
          expiresAt:      threeHoursFromNow(),
          planName,
          amount:         JUNE_PROMO_PRICE,
          promo:          true,
        };
      }

      // ── Montar body da assinatura ──
      const subBody: Record<string, any> = {
        customer:          asaasCustomerId,
        billingType:       toAsaasBillingType(paymentMethod),
        value:             price,
        nextDueDate:       todayStr(),
        cycle:             isYearly ? 'YEARLY' : 'MONTHLY',
        description:       `ZapScript ${PLAN_LABELS[planName]} — Assinatura ${isYearly ? 'anual' : 'mensal'}`,
        externalReference: isYearly ? encodeRef(userId, planName, 'yearly') : encodeRef(userId, planName),
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
            yearly: isYearly,
          });
          app.log.info(`Checkout cartão aprovado: userId=${userId} plan=${planName} method=${paymentMethod} cycle=${isYearly ? 'yearly' : 'monthly'}`);
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
  app.get<{ Querystring: { targetPlan: string; billingCycle?: string } }>(
    '/upgrade-preview',
    auth,
    async (req: any, reply) => {
      const { targetPlan } = req.query;
      const isYearly = req.query.billingCycle === 'yearly';
      const userId  = req.user.sub;
      const newPrice = isYearly ? PLAN_PRICES_YEARLY[targetPlan] : PLAN_PRICES[targetPlan];
      if (!newPrice) return reply.code(400).send({ error: 'Plano inválido' });

      const sub = await prisma.subscription.findUnique({
        where: { userId }, include: { plan: true },
      });
      if (!sub?.plan || sub.plan.priceBrl === 0) {
        return reply.code(400).send({ error: 'Use /billing/checkout para sair do plano gratuito.' });
      }
      const currentPrice = sub.plan.priceBrl;

      // Migração livre entre planos pagos — pode ser mais caro (upgrade, cobra
      // proration) ou mais barato (downgrade, troca sem custo adicional, ver
      // calculateProration: diferença negativa vira 0).
      const proration = calculateProration(currentPrice, newPrice, sub.currentPeriodEnd);
      return {
        currentPlanName:  sub.plan.name,
        currentPlanLabel: sub.plan.label,
        currentPlanPrice: currentPrice,
        targetPlanName:   targetPlan,
        targetPlanPrice:  newPrice,
        billingCycle:     isYearly ? 'yearly' : 'monthly',
        remainingDays:    proration.remainingDays,
        totalDays:        proration.totalDays,
        proratedAmount:   proration.proratedAmount,
        shouldCharge:     proration.shouldCharge,
        nextCycleDate:    sub.currentPeriodEnd ?? null,
      };
    }
  );

  // ── POST /billing/upgrade ─────────────────────────────
  // Migração entre planos pagos (qualquer direção — upgrade cobra proration,
  // downgrade troca sem custo adicional na hora, ver calculateProration).
  app.post<{ Body: any }>(
    '/upgrade',
    { ...auth, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req: any, reply) => {
      const v = validateRequest(billingUpgradeSchema)(req.body);
      if (!v.valid) return reply.code(400).send({ error: v.error });

      const { targetPlan, paymentMethod, card, billingAddress, billingCycle } = v.data;
      const isYearly = billingCycle === 'yearly';
      const userId = req.user.sub;

      if (isCardMethod(paymentMethod) && !card) {
        return reply.code(400).send({ error: 'Dados do cartão são obrigatórios.' });
      }

      const newPrice = isYearly ? PLAN_PRICES_YEARLY[targetPlan] : PLAN_PRICES[targetPlan];
      if (!newPrice) return reply.code(400).send({ error: 'Plano inválido' });

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) return reply.code(401).send({ error: 'Usuário não encontrado' });

      const sub = await prisma.subscription.findUnique({
        where: { userId }, include: { plan: true },
      });
      if (!sub?.plan || sub.plan.priceBrl === 0) {
        return reply.code(400).send({ error: 'Use /billing/checkout para sair do plano gratuito.' });
      }
      if (sub.plan.name === targetPlan) {
        return reply.code(400).send({ error: 'Você já está neste plano.' });
      }

      const currentPrice = sub.plan.priceBrl;
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
            cycle:             isYearly ? 'YEARLY' : 'MONTHLY',
            description:       `ZapScript ${PLAN_LABELS[targetPlan]} — Assinatura ${isYearly ? 'anual' : 'mensal'}`,
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
          yearly: isYearly,
        });
        return { switched: true, status: 'active', planName: targetPlan, message: 'Plano atualizado sem custo adicional.' };
      }

      // ── Criar cobrança avulsa de proration ──
      const chargeBody: Record<string, any> = {
        customer:          asaasCustomerId,
        billingType:       toAsaasBillingType(paymentMethod),
        value:             proration.proratedAmount,
        dueDate:           todayStr(),
        description:       `Migração ZapScript: ${sub.plan.label} → ${PLAN_LABELS[targetPlan]}`,
        externalReference: encodeRef(userId, targetPlan, isYearly ? 'upgrade_yearly' : 'upgrade'),
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
              cycle:             isYearly ? 'YEARLY' : 'MONTHLY',
              description:       `ZapScript ${PLAN_LABELS[targetPlan]} — Assinatura ${isYearly ? 'anual' : 'mensal'}`,
              externalReference: encodeRef(userId, targetPlan),
            }),
          }).then(r => r.json()).catch(() => null) as any;

          await activatePlan(userId, targetPlan, {
            asaasSubscriptionId: newSubRes?.id ?? null,
            asaasCustomerId,
            paymentMethod,
            paymentId: charge.id,
            yearly: isYearly,
          });
          app.log.info(`Migração de plano (cartão) aprovada: userId=${userId} plan=${targetPlan} method=${paymentMethod} cycle=${isYearly ? 'yearly' : 'monthly'}`);
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
        expiresAt = threeHoursFromNow();
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
        data:  { planId: freePlan.id, status: 'canceled', asaasSubscriptionId: null, currentPeriodEnd: null, comboDiscountPct: null },
      }),
      prisma.minuteBalance.update({
        where: { userId },
        data:  { availableMinutes: freePlan.minutesPerMonth, resetAt: nextReset, lastAlertSent: null },
      }),
      // Tiers ZapScript 2.0: cancelar o tier revoga os módulos que vieram no
      // pacote (source='bundle'). Módulos comprados avulso (source='paid')
      // continuam ativos — cancelamento deles é feito à parte, por módulo.
      prisma.entitlement.updateMany({
        where: { userId, source: 'bundle', status: { in: ['active', 'trialing'] } },
        data:  { status: 'canceled', canceledAt: new Date() },
      }),
    ]);
    invalidateModuleCache(userId).catch(() => null);

    // Programa de afiliados: cancelamento nos primeiros 30 dias zera comissões pendentes
    clawbackAffiliateCommissionOnCancel(userId).catch(() => null);

    return { canceled: true, message: 'Assinatura cancelada. Você voltou para o plano gratuito.' };
  });

  // ── POST /billing/modules/:key/subscribe ──────────────────
  // Contrata um módulo da suíte. Cobra a diferença proporcional (proration) sobre o
  // valor agregado (premissa: 1 transação cobra o total somado). Cartão libera na hora;
  // PIX libera após confirmação do webhook (entitlement fica "pending" até lá).
  app.post<{ Params: { key: string }; Body: any }>(
    '/modules/:key/subscribe',
    { ...auth, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req: any, reply) => {
      const { key } = req.params;
      const userId  = req.user.sub;

      const v = validateRequest(moduleSubscribeSchema)(req.body);
      if (!v.valid) return reply.code(400).send({ error: v.error });
      const { paymentMethod, card, billingAddress } = v.data;

      if (isCardMethod(paymentMethod) && !card) {
        return reply.code(400).send({ error: 'Dados do cartão são obrigatórios.' });
      }

      const [user, product, existing] = await Promise.all([
        prisma.user.findUnique({ where: { id: userId } }),
        prisma.product.findUnique({ where: { key } }),
        prisma.entitlement.findUnique({ where: { userId_productKey: { userId, productKey: key } } }),
      ]);
      if (!user) return reply.code(401).send({ error: 'Usuário não encontrado' });
      if (!product || product.status === 'planned' || product.status === 'discovery') {
        return reply.code(400).send({ error: 'Módulo indisponível para contratação.' });
      }
      if (product.status === 'bundled') {
        return reply.code(400).send({ error: 'Este módulo não é vendido avulso — ele já vem incluso no plano Profissional/Empresas. Veja /dashboard/plano.' });
      }
      if (existing?.status === 'active') {
        return reply.code(400).send({ error: 'Você já tem este módulo ativo.' });
      }

      // Dependência dura (ex.: atende-qualidade requer atende)
      if (product.dependsOn?.length) {
        const owned = new Set((await prisma.entitlement.findMany({
          where:  { userId, status: { in: ['active', 'trialing'] } },
          select: { productKey: true },
        })).map((e: { productKey: string }) => e.productKey));
        const missing = product.dependsOn.find((d: string) => !owned.has(d));
        if (missing) {
          return reply.code(400).send({ error: `Este módulo requer o módulo "${missing}" ativo.`, moduleRequired: missing });
        }
      }

      if (!user.emailVerified) {
        return reply.code(403).send({ code: 'EMAIL_NOT_VERIFIED', error: 'Confirme seu e-mail antes de contratar um módulo.' });
      }
      if (!user.document) {
        return reply.code(400).send({ code: 'DOCUMENT_REQUIRED', error: 'Informe seu CPF/CNPJ para contratar um módulo.' });
      }

      let asaasCustomerId: string;
      try {
        asaasCustomerId = await getOrCreateCustomer(user);
      } catch (err: any) {
        app.log.error({ err }, 'Asaas customer error (module subscribe)');
        return reply.code(503).send({ error: 'Serviço de pagamento indisponível. Tente novamente.' });
      }

      const sub          = await prisma.subscription.findUnique({ where: { userId } });
      const currentTotal = await computeAggregateValue(userId);
      const newTotal      = Math.round((currentTotal + product.priceMonthly) * 100) / 100;
      const proration     = calculateProration(currentTotal, newTotal, sub?.currentPeriodEnd ?? null);
      const freePlan      = await prisma.plan.findUnique({ where: { name: 'free' } });

      // ── Sem cobrança adicional (módulo gratuito ou ciclo já no fim) ──
      if (!proration.shouldCharge) {
        const newSubId = await reissueAggregateSubscription({
          userId, asaasCustomerId, newValue: newTotal, paymentMethod,
          oldAsaasSubscriptionId: sub?.asaasSubscriptionId ?? null,
          description: 'ZapScript — Assinatura mensal',
        });
        await prisma.subscription.upsert({
          where:  { userId },
          create: { userId, planId: freePlan?.id ?? '', asaasSubscriptionId: newSubId, asaasCustomerId, paymentMethod, status: 'active' },
          update: { asaasSubscriptionId: newSubId, asaasCustomerId, paymentMethod },
        }).catch(() => null);
        await activateModuleEntitlement(userId, key);
        app.log.info(`Módulo ativado (sem custo adicional): userId=${userId} module=${key} total=${newTotal}`);
        return { status: 'active', moduleKey: key, newTotal, message: 'Módulo ativado sem custo adicional.' };
      }

      // ── Cobrar proration do módulo ──
      const chargeBody: Record<string, any> = {
        customer:          asaasCustomerId,
        billingType:       toAsaasBillingType(paymentMethod),
        value:             proration.proratedAmount,
        dueDate:           todayStr(),
        description:       `ZapScript — Ativação do módulo ${product.name}`,
        externalReference: encodeModuleRef(userId, key),
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
        chargeBody.remoteIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '0.0.0.0';
      }

      const chargeRes = await asaas('/payments', { method: 'POST', body: JSON.stringify(chargeBody) });
      const charge    = await chargeRes.json() as any;
      if (!charge?.id) {
        app.log.error({ charge }, 'Asaas: erro ao criar cobrança de ativação de módulo');
        return reply.code(500).send({ error: 'Erro ao criar cobrança. Tente novamente.' });
      }

      // ── Cartão: aprovação imediata ──
      if (isCardMethod(paymentMethod)) {
        if (charge.errors?.length > 0) {
          return reply.code(402).send({ status: 'declined', error: charge.errors[0]?.description || 'Cartão recusado.' });
        }
        if (charge.status === 'CONFIRMED' || charge.status === 'RECEIVED') {
          const newSubId = await reissueAggregateSubscription({
            userId, asaasCustomerId, newValue: newTotal, paymentMethod,
            oldAsaasSubscriptionId: sub?.asaasSubscriptionId ?? null,
            description: 'ZapScript — Assinatura mensal',
          });
          await prisma.subscription.upsert({
            where:  { userId },
            create: { userId, planId: freePlan?.id ?? '', asaasSubscriptionId: newSubId, asaasCustomerId, paymentMethod, status: 'active' },
            update: { asaasSubscriptionId: newSubId, asaasCustomerId, paymentMethod },
          }).catch(() => null);
          await activateModuleEntitlement(userId, key, { paymentId: charge.id });
          app.log.info(`Módulo ativado (cartão): userId=${userId} module=${key} total=${newTotal}`);
          return { status: 'active', moduleKey: key, newTotal };
        }
        return reply.code(402).send({ status: 'declined', error: 'Cartão não aprovado. Verifique os dados e tente novamente.' });
      }

      // ── PIX: entitlement fica "pending" até o webhook confirmar (não concede acesso) ──
      await prisma.entitlement.upsert({
        where:  { userId_productKey: { userId, productKey: key } },
        create: { userId, productKey: key, status: 'pending', source: 'paid' },
        update: { status: 'pending' },
      });
      let qrCode = null as string | null, qrCodeUrl = null as string | null;
      try {
        const qrData = await asaas(`/payments/${charge.id}/pixQrCode`).then(r => r.json()) as any;
        qrCode    = qrData?.payload      || null;
        qrCodeUrl = qrData?.encodedImage ? `data:image/png;base64,${qrData.encodedImage}` : null;
      } catch { /* QR não crítico */ }

      return {
        status: 'pending_pix', chargeId: charge.id, qrCode, qrCodeUrl,
        expiresAt: threeHoursFromNow(), proratedAmount: proration.proratedAmount, newTotal,
      };
    }
  );

  // ── POST /billing/modules/:key/cancel ──────────────────────
  // Cancela um módulo pago. Recalcula o valor agregado e reemite a assinatura Asaas
  // no novo total (ou cancela de vez se não sobrar nada a cobrar). Sem reembolso
  // proporcional — mesma política do resto do sistema (sem precedente de down-charge).
  app.post<{ Params: { key: string } }>('/modules/:key/cancel', auth, async (req: any, reply) => {
    const { key } = req.params;
    const userId  = req.user.sub;

    const [entitlement, sub, product] = await Promise.all([
      prisma.entitlement.findUnique({ where: { userId_productKey: { userId, productKey: key } } }),
      prisma.subscription.findUnique({ where: { userId }, include: { plan: true } }),
      prisma.product.findUnique({ where: { key } }),
    ]);
    if (!entitlement || entitlement.status !== 'active') {
      return reply.code(400).send({ error: 'Você não tem este módulo ativo.' });
    }

    if (entitlement.source !== 'paid') {
      // Cortesia/trial/bundle — apenas revoga, sem impacto de cobrança.
      await prisma.entitlement.update({
        where: { userId_productKey: { userId, productKey: key } },
        data:  { status: 'canceled', canceledAt: new Date() },
      });
      invalidateModuleCache(userId).catch(() => null);
      return { canceled: true, moduleKey: key };
    }

    // ── Combo ativo: cancelar QUALQUER módulo já quebra "todos os contratáveis" —
    //    desconto cai e o total volta a ser a soma bruta (sem desconto) do que resta.
    //    (Subtrair o preço bruto de um total já descontado dobraria o desconto.) ──
    const hadCombo = !!sub?.comboDiscountPct;
    let newTotal: number;
    if (hadCombo) {
      const remaining = await prisma.entitlement.findMany({
        where:  { userId, status: 'active', source: 'paid', productKey: { not: key } },
        select: { productKey: true },
      });
      const remainingProducts = remaining.length
        ? await prisma.product.findMany({
            where:  { key: { in: remaining.map((e: { productKey: string }) => e.productKey) } },
            select: { priceMonthly: true },
          })
        : [];
      const corePart    = sub?.plan && sub.plan.name !== 'free' ? sub.plan.priceBrl : 0;
      const modulesPart = remainingProducts.reduce((s: number, p: { priceMonthly: number }) => s + p.priceMonthly, 0);
      newTotal = Math.round((corePart + modulesPart) * 100) / 100;
    } else {
      const currentTotal = await computeAggregateValue(userId);
      newTotal = Math.max(0, Math.round((currentTotal - (product?.priceMonthly ?? 0)) * 100) / 100);
    }

    if (sub?.asaasSubscriptionId && sub.asaasCustomerId) {
      if (newTotal <= 0) {
        await asaas(`/subscriptions/${sub.asaasSubscriptionId}`, { method: 'DELETE' })
          .catch(err => app.log.warn({ err }, 'Asaas: falha ao cancelar assinatura agregada'));
        await prisma.subscription.update({ where: { userId }, data: { asaasSubscriptionId: null, comboDiscountPct: hadCombo ? null : undefined } }).catch(() => null);
      } else {
        const newSubId = await reissueAggregateSubscription({
          userId, asaasCustomerId: sub.asaasCustomerId, newValue: newTotal,
          paymentMethod: sub.paymentMethod ?? undefined,
          oldAsaasSubscriptionId: sub.asaasSubscriptionId,
          description: 'ZapScript — Assinatura mensal',
        });
        await prisma.subscription.update({ where: { userId }, data: { asaasSubscriptionId: newSubId, comboDiscountPct: hadCombo ? null : undefined } }).catch(() => null);
      }
    } else if (hadCombo) {
      await prisma.subscription.update({ where: { userId }, data: { comboDiscountPct: null } }).catch(() => null);
    }

    await prisma.entitlement.update({
      where: { userId_productKey: { userId, productKey: key } },
      data:  { status: 'canceled', canceledAt: new Date() },
    });
    invalidateModuleCache(userId).catch(() => null);
    app.log.info(`Módulo cancelado: userId=${userId} module=${key} novoTotal=${newTotal}`);
    return { canceled: true, moduleKey: key, newTotal };
  });

  // ── GET /billing/combo/preview ──────────────────────────────
  // Prévia do Combo antes da confirmação: módulos que faltam, total bruto,
  // total com desconto e o percentual em si — front nunca hardcoda
  // COMBO_DISCOUNT_PCT, só exibe o que a API calcular.
  app.get('/combo/preview', auth, async (req: any) => {
    const userId = req.user.sub;
    const sub = await prisma.subscription.findUnique({ where: { userId }, include: { plan: true } });

    const corePlanName  = sub?.plan?.name === 'executive' ? 'executive' : 'pro';
    const modules        = await resolveComboModules(userId);
    const alreadyOnCore  = !!sub?.plan && sub.plan.name !== 'free';
    if (modules.length === 0 && alreadyOnCore) {
      return { available: false, reason: 'complete' };
    }

    const rawTotal = Math.round((PLAN_PRICES[corePlanName] + modules.reduce((s: number, m: { priceMonthly: number }) => s + m.priceMonthly, 0)) * 100) / 100;
    const newTotal = Math.round(rawTotal * (1 - COMBO_DISCOUNT_PCT) * 100) / 100;

    return {
      available:     true,
      corePlanName,
      corePlanLabel: PLAN_LABELS[corePlanName],
      modules:       modules.map((m: { key: string; name: string; priceMonthly: number }) => ({ key: m.key, name: m.name, priceMonthly: m.priceMonthly })),
      discountPct:   COMBO_DISCOUNT_PCT,
      rawTotal,
      newTotal,
    };
  });

  // ── POST /billing/combo/subscribe ──────────────────────────
  // Contrata o Combo (Core + todos os módulos disponíveis) com desconto fixo
  // sobre a soma. Núcleo mantém o tier atual do usuário (pro/executive) ou assume
  // 'pro' se ele estiver no free; módulos são resolvidos dinamicamente (ga/beta,
  // exceto core, ainda não possuídos) — cresce sozinho quando um módulo novo sai
  // de "planned". Mesma mecânica de proration/cartão/PIX do /modules/:key/subscribe.
  app.post<{ Body: any }>(
    '/combo/subscribe',
    { ...auth, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req: any, reply) => {
      const userId = req.user.sub;

      const v = validateRequest(moduleSubscribeSchema)(req.body);
      if (!v.valid) return reply.code(400).send({ error: v.error });
      const { paymentMethod, card, billingAddress } = v.data;

      if (isCardMethod(paymentMethod) && !card) {
        return reply.code(400).send({ error: 'Dados do cartão são obrigatórios.' });
      }

      const [user, sub] = await Promise.all([
        prisma.user.findUnique({ where: { id: userId } }),
        prisma.subscription.findUnique({ where: { userId }, include: { plan: true } }),
      ]);
      if (!user) return reply.code(401).send({ error: 'Usuário não encontrado' });

      const corePlanName = sub?.plan?.name === 'executive' ? 'executive' : 'pro';
      const modules       = await resolveComboModules(userId);
      const alreadyOnCore = !!sub?.plan && sub.plan.name !== 'free';
      if (modules.length === 0 && alreadyOnCore) {
        return reply.code(400).send({ error: 'Você já tem o Combo completo (todos os módulos disponíveis).' });
      }

      if (!user.emailVerified) {
        return reply.code(403).send({ code: 'EMAIL_NOT_VERIFIED', error: 'Confirme seu e-mail antes de contratar o Combo.' });
      }
      if (!user.document) {
        return reply.code(400).send({ code: 'DOCUMENT_REQUIRED', error: 'Informe seu CPF/CNPJ para contratar o Combo.' });
      }

      let asaasCustomerId: string;
      try {
        asaasCustomerId = await getOrCreateCustomer(user);
      } catch (err: any) {
        app.log.error({ err }, 'Asaas customer error (combo subscribe)');
        return reply.code(503).send({ error: 'Serviço de pagamento indisponível. Tente novamente.' });
      }

      const currentTotal = await computeAggregateValue(userId);
      const rawTotal      = Math.round((PLAN_PRICES[corePlanName] + modules.reduce((s: number, m: { priceMonthly: number }) => s + m.priceMonthly, 0)) * 100) / 100;
      const newTotal       = Math.round(rawTotal * (1 - COMBO_DISCOUNT_PCT) * 100) / 100;
      const proration      = calculateProration(currentTotal, newTotal, sub?.currentPeriodEnd ?? null);

      // ── Sem cobrança adicional (ciclo já no fim, ou total do Combo é menor que o atual) ──
      if (!proration.shouldCharge) {
        const newSubId = await reissueAggregateSubscription({
          userId, asaasCustomerId, newValue: newTotal, paymentMethod,
          oldAsaasSubscriptionId: sub?.asaasSubscriptionId ?? null,
          description: 'ZapScript — Assinatura mensal (Combo)',
        });
        const { modules: activated } = await activateCombo(userId, corePlanName, { asaasSubscriptionId: newSubId, asaasCustomerId, paymentMethod });
        app.log.info(`Combo ativado (sem custo adicional): userId=${userId} plano=${corePlanName} total=${newTotal}`);
        return {
          status: 'active', corePlanName, newTotal, discountPct: COMBO_DISCOUNT_PCT,
          modulesActivated: activated.map((m: { key: string }) => m.key),
          message: 'Combo ativado sem custo adicional.',
        };
      }

      // ── Cobrar proration do Combo ──
      const chargeBody: Record<string, any> = {
        customer:          asaasCustomerId,
        billingType:       toAsaasBillingType(paymentMethod),
        value:             proration.proratedAmount,
        dueDate:           todayStr(),
        description:       `ZapScript — Combo (${PLAN_LABELS[corePlanName]} + módulos)`,
        externalReference: encodeComboRef(userId, corePlanName),
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
        chargeBody.remoteIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '0.0.0.0';
      }

      const chargeRes = await asaas('/payments', { method: 'POST', body: JSON.stringify(chargeBody) });
      const charge    = await chargeRes.json() as any;
      if (!charge?.id) {
        app.log.error({ charge }, 'Asaas: erro ao criar cobrança do Combo');
        return reply.code(500).send({ error: 'Erro ao criar cobrança. Tente novamente.' });
      }

      // ── Cartão: aprovação imediata ──
      if (isCardMethod(paymentMethod)) {
        if (charge.errors?.length > 0) {
          return reply.code(402).send({ status: 'declined', error: charge.errors[0]?.description || 'Cartão recusado.' });
        }
        if (charge.status === 'CONFIRMED' || charge.status === 'RECEIVED') {
          const newSubId = await reissueAggregateSubscription({
            userId, asaasCustomerId, newValue: newTotal, paymentMethod,
            oldAsaasSubscriptionId: sub?.asaasSubscriptionId ?? null,
            description: 'ZapScript — Assinatura mensal (Combo)',
          });
          const { modules: activated } = await activateCombo(userId, corePlanName, { asaasSubscriptionId: newSubId, asaasCustomerId, paymentMethod, paymentId: charge.id });
          app.log.info(`Combo ativado (cartão): userId=${userId} plano=${corePlanName} total=${newTotal}`);
          return {
            status: 'active', corePlanName, newTotal, discountPct: COMBO_DISCOUNT_PCT,
            modulesActivated: activated.map((m: { key: string }) => m.key),
          };
        }
        return reply.code(402).send({ status: 'declined', error: 'Cartão não aprovado. Verifique os dados e tente novamente.' });
      }

      // ── PIX: módulos ficam "pending" até o webhook confirmar; plano só sobe na confirmação ──
      for (const m of modules) {
        await prisma.entitlement.upsert({
          where:  { userId_productKey: { userId, productKey: m.key } },
          create: { userId, productKey: m.key, status: 'pending', source: 'paid' },
          update: { status: 'pending' },
        });
      }
      let qrCode = null as string | null, qrCodeUrl = null as string | null;
      try {
        const qrData = await asaas(`/payments/${charge.id}/pixQrCode`).then(r => r.json()) as any;
        qrCode    = qrData?.payload      || null;
        qrCodeUrl = qrData?.encodedImage ? `data:image/png;base64,${qrData.encodedImage}` : null;
      } catch { /* QR não crítico */ }

      return {
        status: 'pending_pix', chargeId: charge.id, qrCode, qrCodeUrl,
        expiresAt: threeHoursFromNow(), proratedAmount: proration.proratedAmount,
        newTotal, discountPct: COMBO_DISCOUNT_PCT, corePlanName,
        modulesPending: modules.map((m: { key: string }) => m.key),
      };
    }
  );

  // ── GET /billing/invoices ─────────────────────────────
  app.get('/invoices', auth, async (req: any) => {
    const userId = req.user.sub;
    const [sub, user] = await Promise.all([
      prisma.subscription.findUnique({ where: { userId }, include: { plan: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { isTester: true, createdAt: true } }),
    ]);

    // Tester sem assinatura Asaas → gerar histórico sintético de renovações isentas
    if (user?.isTester && !sub?.asaasCustomerId) {
      const renewalsUsed = sub?.testerRenewalsUsed ?? 0;
      const createdAt    = user.createdAt;
      const invoices     = [];

      for (let i = 0; i < renewalsUsed; i++) {
        const renewDate = new Date(createdAt);
        renewDate.setDate(renewDate.getDate() + (i + 1) * 30);
        invoices.push({
          id:          `tester-renewal-${i + 1}`,
          value:       0,
          status:      'TESTER_EXEMPT',
          statusLabel: 'Isenção Tester',
          statusColor: 'text-emerald-400',
          dueDate:     renewDate.toISOString().slice(0, 10),
          paymentDate: renewDate.toISOString().slice(0, 10),
          invoiceUrl:  null,
          billingType: 'TESTER',
          description: `ZapScript Pro — Renovação ${i + 1}/12 (Isenção Tester)`,
          isTesterExempt: true,
        });
      }

      // Próximas renovações futuras (até completar 12)
      const remaining = 12 - renewalsUsed;
      if (remaining > 0) {
        const nextRenewDate = new Date(createdAt);
        nextRenewDate.setDate(nextRenewDate.getDate() + (renewalsUsed + 1) * 30);
        invoices.push({
          id:          `tester-next-renewal`,
          value:       0,
          status:      'TESTER_UPCOMING',
          statusLabel: `Isenta (${remaining} restante${remaining !== 1 ? 's' : ''})`,
          statusColor: 'text-brand-muted',
          dueDate:     nextRenewDate.toISOString().slice(0, 10),
          paymentDate: null,
          invoiceUrl:  null,
          billingType: 'TESTER',
          description: `ZapScript Pro — Próxima renovação (Isenção Tester ${renewalsUsed + 1}/12)`,
          isTesterExempt: true,
          isUpcoming:  true,
        });
      }

      return {
        invoices: invoices.reverse(), // mais recente primeiro
        isTester: true,
        testerRenewalsUsed:  renewalsUsed,
        testerRenewalsTotal: 12,
      };
    }

    if (!sub?.asaasCustomerId) return { invoices: [], isTester: false };

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

      return { invoices, isTester: false };
    } catch (err) {
      app.log.error({ err }, 'Erro ao buscar faturas Asaas');
      return { invoices: [], isTester: false };
    }
  });

  // ── GET /billing/sync ─────────────────────────────────
  // Fallback: verifica status no Asaas e ativa se pago
  // H3: Rate limit dedicado — evita polling abusivo de status de pagamento
  app.get('/sync', { ...auth, config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (req: any) => {
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

      // ── Ativação de módulo (proration) confirmada — checar ANTES do decodeRef genérico ──
      const moduleRef = decodeModuleRef(payment.externalReference);
      if (moduleRef) {
        const { userId, productKey } = moduleRef;
        const subInDb = await prisma.subscription.findUnique({ where: { userId } }).catch(() => null);
        const asaasCustomerId = subInDb?.asaasCustomerId || payment.customer;
        const product   = await prisma.product.findUnique({ where: { key: productKey } });
        const currentTotal = await computeAggregateValue(userId);
        const newTotal  = Math.round((currentTotal + (product?.priceMonthly ?? 0)) * 100) / 100;

        const newSubId = await reissueAggregateSubscription({
          userId, asaasCustomerId, newValue: newTotal,
          paymentMethod: payment.billingType === 'CREDIT_CARD' ? 'credit_card' : payment.billingType === 'DEBIT_CARD' ? 'debit_card' : 'pix',
          oldAsaasSubscriptionId: subInDb?.asaasSubscriptionId ?? null,
          description: 'ZapScript — Assinatura mensal',
        });
        const freePlan = await prisma.plan.findUnique({ where: { name: 'free' } });
        await prisma.subscription.upsert({
          where:  { userId },
          create: { userId, planId: freePlan?.id ?? '', asaasSubscriptionId: newSubId, asaasCustomerId, status: 'active' },
          update: { asaasSubscriptionId: newSubId, asaasCustomerId },
        }).catch(() => null);
        await activateModuleEntitlement(userId, productKey, { paymentId: payment.id });
        app.log.info(`Módulo ativado via webhook: userId=${userId} module=${productKey} total=${newTotal}`);
        return reply.send({ received: true });
      }

      // ── Ativação do Combo (Core + módulos) confirmada — checar ANTES do decodeRef genérico ──
      const comboRef = decodeComboRef(payment.externalReference);
      if (comboRef) {
        const { userId, corePlanName } = comboRef;
        const subInDb = await prisma.subscription.findUnique({ where: { userId } }).catch(() => null);
        const asaasCustomerId = subInDb?.asaasCustomerId || payment.customer;
        const modules   = await resolveComboModules(userId);
        const rawTotal  = Math.round((PLAN_PRICES[corePlanName] + modules.reduce((s: number, m: { priceMonthly: number }) => s + m.priceMonthly, 0)) * 100) / 100;
        const newTotal  = Math.round(rawTotal * (1 - COMBO_DISCOUNT_PCT) * 100) / 100;

        const newSubId = await reissueAggregateSubscription({
          userId, asaasCustomerId, newValue: newTotal,
          paymentMethod: payment.billingType === 'CREDIT_CARD' ? 'credit_card' : payment.billingType === 'DEBIT_CARD' ? 'debit_card' : 'pix',
          oldAsaasSubscriptionId: subInDb?.asaasSubscriptionId ?? null,
          description: 'ZapScript — Assinatura mensal (Combo)',
        });
        await activateCombo(userId, corePlanName, {
          asaasSubscriptionId: newSubId, asaasCustomerId,
          paymentMethod: payment.billingType === 'CREDIT_CARD' ? 'credit_card' : payment.billingType === 'DEBIT_CARD' ? 'debit_card' : 'pix',
          paymentId: payment.id,
        });
        app.log.info(`Combo ativado via webhook: userId=${userId} plano=${corePlanName} total=${newTotal}`);
        return reply.send({ received: true });
      }

      const decoded = decodeRef(payment.externalReference);
      if (!decoded?.userId || !decoded?.planName) {
        app.log.error({ ref: payment.externalReference }, `Webhook ${eventType}: externalReference inválido`);
        return reply.send({ received: true });
      }

      const { userId, planName, type } = decoded;

      // ── Pacote de minutos avulso ──────────────────────────────────────────
      if (planName === 'pkg_minutes') {
        const minutes = parseInt(type || '0', 10);
        if (!minutes || isNaN(minutes)) {
          app.log.error({ ref: payment.externalReference }, 'pkg_minutes: quantidade inválida');
          return reply.send({ received: true });
        }
        await creditExtraMinutes(userId, minutes);
        await markProcessed(payment.id);
        app.log.info(`Pacote de minutos creditado (extra/60d): userId=${userId} +${minutes}min`);
        return reply.send({ received: true });
      }

      if (type === 'upgrade' || type === 'upgrade_yearly') {
        // ── Cobrança de proration da migração de plano aprovada ──
        const isYearlyUpgrade = type === 'upgrade_yearly';
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
            value:             (isYearlyUpgrade ? PLAN_PRICES_YEARLY[planName] : PLAN_PRICES[planName]) ?? 0,
            nextDueDate:       todayStr(),
            cycle:             isYearlyUpgrade ? 'YEARLY' : 'MONTHLY',
            description:       `ZapScript ${PLAN_LABELS[planName]} — Assinatura ${isYearlyUpgrade ? 'anual' : 'mensal'}`,
            externalReference: encodeRef(userId, planName),
          }),
        }).then(r => r.json()).catch(() => null) as any;

        await activatePlan(userId, planName, {
          asaasSubscriptionId: newSubRes?.id ?? null,
          asaasCustomerId,
          paymentMethod:       payment.billingType === 'CREDIT_CARD' ? 'credit_card' : payment.billingType === 'DEBIT_CARD' ? 'debit_card' : 'pix',
          paymentId:           payment.id,
          yearly:              isYearlyUpgrade,
        });
        app.log.info(`Migração de plano via webhook: userId=${userId} plan=${planName} cycle=${isYearlyUpgrade ? 'yearly' : 'monthly'}`);

      } else {
        // ── Pagamento de assinatura normal (mensal ou anual) ──
        const subInDb = await prisma.subscription.findUnique({ where: { userId } }).catch(() => null);
        const asaasSubId = payment.subscription || subInDb?.asaasSubscriptionId || null;
        const isYearlyWebhook = type === 'yearly';

        await activatePlan(userId, planName, {
          asaasSubscriptionId: asaasSubId,
          asaasCustomerId:     payment.customer || subInDb?.asaasCustomerId || null,
          paymentMethod:       payment.billingType === 'CREDIT_CARD' ? 'credit_card' : payment.billingType === 'DEBIT_CARD' ? 'debit_card' : 'pix',
          paymentId:           payment.id,
          yearly:              isYearlyWebhook,
        });
        app.log.info(`Pagamento confirmado: userId=${userId} plan=${planName} cycle=${isYearlyWebhook ? 'yearly' : 'monthly'}`);

        // ── Programa de afiliados: atribuir comissão da venda (idempotente) ──
        await attributeAffiliateCommission(userId, payment.id, payment.value ?? 0, isYearlyWebhook);
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
          const firstName = escHtml(failedUser.name?.split(' ')[0] || 'você');
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

    // ── Assinatura cancelada/expirada no lado do Asaas (ex.: falha de pagamento
    //    após as tentativas de retry) — downgrade para free, espelhando /billing/cancel ──
    if (eventType === 'SUBSCRIPTION_DELETED') {
      const decoded = decodeRef(body?.subscription?.externalReference);
      const userId  = decoded?.userId;
      if (userId) {
        const freePlan = await prisma.plan.findUnique({ where: { name: 'free' } });
        if (freePlan) {
          const nextReset = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
          await prisma.$transaction([
            prisma.subscription.update({
              where: { userId },
              data:  { planId: freePlan.id, status: 'canceled', asaasSubscriptionId: null, currentPeriodEnd: null, comboDiscountPct: null },
            }),
            prisma.minuteBalance.update({
              where: { userId },
              data:  { availableMinutes: freePlan.minutesPerMonth, resetAt: nextReset, lastAlertSent: null },
            }),
          ]).catch((err: any) => app.log.error({ err }, 'Erro ao processar downgrade de SUBSCRIPTION_DELETED'));
          invalidatePlanCache(userId).catch(() => null);
          // Programa de afiliados: cancelamento nos primeiros 30 dias zera comissões pendentes
          clawbackAffiliateCommissionOnCancel(userId).catch(() => null);
          app.log.info(`Assinatura removida no Asaas — downgrade para free: userId=${userId}`);
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

  // ── GET /billing/minute-packages — lista pacotes disponíveis ─────────────
  app.get('/minute-packages', async (_req, reply) => {
    return reply.send({ packages: MINUTE_PACKAGES });
  });

  // ── POST /billing/buy-minutes — compra pacote de minutos avulso ──────────
  app.post<{ Body: { packageId: string; paymentMethod: string; card?: any; billingAddress?: any } }>(
    '/buy-minutes',
    { ...auth, config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (req: any, reply) => {
      const userId = req.user.sub;
      const { packageId, paymentMethod, card, billingAddress } = req.body as any;

      const pkg = MINUTE_PACKAGES.find(p => p.id === packageId);
      if (!pkg) return reply.code(400).send({ error: 'Pacote inválido. Use pkg_50 ou pkg_100.' });

      // Buscar ou criar cliente Asaas
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, name: true },
      });
      if (!user) return reply.code(404).send({ error: 'Usuário não encontrado.' });

      let asaasCustomerId: string;
      const sub = await prisma.subscription.findUnique({ where: { userId } });
      if (sub?.asaasCustomerId) {
        asaasCustomerId = sub.asaasCustomerId;
      } else {
        const custRes = await asaas('/customers', {
          method: 'POST',
          body:   JSON.stringify({ name: user.name || user.email, email: user.email, externalReference: userId }),
        }).then(r => r.json()) as any;
        asaasCustomerId = custRes.id;
      }

      // Criar cobrança única (não assinatura)
      const exRef  = encodeMinutePackageRef(userId, pkg.minutes);
      const desc   = `ZapScript — ${pkg.label} (pacote avulso)`;

      if (paymentMethod === 'pix') {
        const pix = await asaas('/payments', {
          method: 'POST',
          body: JSON.stringify({
            customer: asaasCustomerId, billingType: 'PIX',
            value: pkg.priceBrl, dueDate: todayStr(),
            description: desc, externalReference: exRef,
          }),
        }).then(r => r.json()) as any;
        if (pix.errors?.length) return reply.code(400).send({ error: pix.errors[0]?.description || 'Erro ao criar cobrança PIX.' });
        const pixKey = await asaas(`/payments/${pix.id}/pixQrCode`).then(r => r.json()) as any;
        return { status: 'pending', paymentId: pix.id, qrCode: pixKey?.encodedImage || null, copyPaste: pixKey?.payload || null };

      } else if (paymentMethod === 'credit_card') {
        const charge = await asaas('/payments', {
          method: 'POST',
          body: JSON.stringify({
            customer: asaasCustomerId, billingType: 'CREDIT_CARD',
            value: pkg.priceBrl, dueDate: todayStr(),
            description: desc, externalReference: exRef,
            creditCard: card, creditCardHolderInfo: billingAddress,
          }),
        }).then(r => r.json()) as any;
        if (charge.errors?.length) return reply.code(400).send({ error: charge.errors[0]?.description || 'Erro no cartão.' });

        if (charge.status === 'CONFIRMED' || charge.status === 'RECEIVED') {
          await creditExtraMinutes(userId, pkg.minutes);
          await markProcessed(charge.id); // evita crédito duplicado quando o webhook chegar
          return { status: 'active', minutes: pkg.minutes, paymentId: charge.id };
        }
        return { status: charge.status.toLowerCase(), paymentId: charge.id };

      } else {
        return reply.code(400).send({ error: 'Método de pagamento não suportado. Use pix ou credit_card.' });
      }
    },
  );
}
