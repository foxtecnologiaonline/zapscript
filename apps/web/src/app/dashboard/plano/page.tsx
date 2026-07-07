'use client';
import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import CheckoutInline from '@/components/CheckoutInline';
import { isJunePromoActive } from '@/lib/promo';

interface Stats {
  minutesUsed: number; minutesAvailable: number;
  minutesTotal: number; minutesPct: number;
  extraMinutes?: number;            // saldo avulso/indicação válido (60 dias)
  extraExpiresAt?: string | null;   // validade do saldo extra
  planName: string;   // slug: 'free' | 'pro' | 'ultra' | 'executive'
  planLabel: string;  // exibível: 'Grátis' | 'Pro' | 'Ultra' | 'Executive'
  planStatus: string;
  renewAt: string | null;
  isTester: boolean;
  testerCreatedAt: string | null;
  testerRenewalsUsed: number;
  testerRenewalsTotal: number;
  // ── Métrica primária: áudios ──
  audiosUsed: number;
  audiosQuota: number;
  audiosUnlimited: boolean;
  audiosPct: number;
  effectivePlan: 'pro' | 'free';
  // ── Trial freemium ──
  isTrial: boolean;
  trialEndsAt: string | null;
  trialDaysLeft: number | null;
  cardOnFile: boolean;   // cartão já garantido para a cobrança em D+7
}

interface User {
  id: string;
  name: string | null;
  email: string;
  document: string | null;
  emailVerified: boolean;
}

/* ── Planos ── */
const PLANS = [
  {
    name:  'free',
    label: 'Free',
    price: 'R$0',
    per:   '/mês',
    desc:  'Para experimentar',
    feats: [
      '15 áudios/mês',
      '1 número WhatsApp',
      '🎙️ Conversão automática',
      '✨ Resumo com IA',
      '📋 Histórico de conversões',
      '📅 Filtros por data e contato',
      '🔍 Busca por conversão',
    ],
    excl:  [],
    pop:   false,
    accent: null as string | null,
  },
  {
    name:  'pro',
    label: 'Pro',
    price: 'R$39,90',
    per:   '/mês',
    desc:  'Para profissionais',
    feats: [
      'Áudios ilimitados',
      'Áudios de até 10 min',
      '2 números WhatsApp',
      '🎙️ Conversão automática',
      '✨ Resumo com IA',
      '📋 Histórico de conversões',
      '📅 Filtros por data e contato',
      '🔍 Busca por conversão',
      '📤 Exportar áudios em PDF, Docx, Csv e Excel',
      '📄 Conversão Profissional (PDF com marcação temporal)',
      '🔒 Modo Privado automático',
    ],
    excl:  [],
    pop:   true,
    accent: null as string | null,
  },
  {
    name:  'executive',
    label: 'Executive',
    price: 'R$49,90',
    per:   '/mês',
    desc:  'Para uso profissional e privacidade total',
    feats: [
      'Áudios ilimitados',
      '3 números WhatsApp',
      '🎙️ Conversão automática',
      '✨ Resumo com IA',
      '📋 Histórico de conversões',
      '📅 Filtros por data e contato',
      '🔍 Busca por conversão',
      '📤 Exportação PDF · DOCX · CSV · XLS',
      '🔒 Modo Privado automático',
    ],
    excl:  [],
    pop:   true,
    accent: null as string | null,
  },
];

/* ── Preços anuais (x12 com 20% off) ── */
const PLAN_PRICES_YEARLY: Record<string, { monthlyDisplay: string; annualDisplay: string }> = {
  pro:       { monthlyDisplay: 'R$31,92', annualDisplay: 'R$383,04' },
  executive: { monthlyDisplay: 'R$39,92', annualDisplay: 'R$479,04' },
};

type CmpVal = string | boolean;
const TABLE_ROWS: { feature: string; vals: CmpVal[] }[] = [
  { feature: 'Áudios/mês',                         vals: ['15', 'Ilimitado'] },
  { feature: 'Números WhatsApp',                   vals: ['1', '2'] },
  { feature: '🎙️ Conversão automática',           vals: [true, true] },
  { feature: '✨ Resumo com IA',                    vals: [true, true] },
  { feature: '📋 Histórico de conversões',        vals: [true, true] },
  { feature: '📅 Filtros por data e contato',       vals: [true, true] },
  { feature: '🔍 Busca por conversão',             vals: [true, true] },
  { feature: '📤 Exportar áudios (PDF/Docx/Csv/Excel)', vals: [false, true] },
  { feature: '📄 Conversão Profissional (PDF)',    vals: [false, true] },
  { feature: '🔒 Modo Privado automático',       vals: [false, true] },
];

// Billing type sempre UNDEFINED — Asaas oferece as opções ao usuário na página de pagamento
interface MinutePkg { id: string; minutes: number; priceBrl: number; label: string; desc: string }

// Pacotes hardcoded como fallback (se API falhar, a seção ainda aparece)
const DEFAULT_MINUTE_PKGS: MinutePkg[] = [
  { id: 'pkg_50',  minutes: 50,  priceBrl: 11.90, label: '50 minutos',  desc: 'Mais econômico' },
  { id: 'pkg_100', minutes: 100, priceBrl: 19.90, label: '100 minutos', desc: 'Melhor valor' },
];

function formatDocument(val: string): string {
  const n = val.replace(/\D/g, '').slice(0, 14);
  if (n.length <= 11) {
    if (n.length <= 3)  return n;
    if (n.length <= 6)  return `${n.slice(0,3)}.${n.slice(3)}`;
    if (n.length <= 9)  return `${n.slice(0,3)}.${n.slice(3,6)}.${n.slice(6)}`;
    return `${n.slice(0,3)}.${n.slice(3,6)}.${n.slice(6,9)}-${n.slice(9)}`;
  }
  if (n.length <= 12) return `${n.slice(0,2)}.${n.slice(2,5)}.${n.slice(5,8)}/${n.slice(8)}`;
  return `${n.slice(0,2)}.${n.slice(2,5)}.${n.slice(5,8)}/${n.slice(8,12)}-${n.slice(12)}`;
}

/* ── Modal de upgrade com proration ── */
interface UpgradePreview {
  currentPlanLabel: string;
  currentPlanPrice: number;
  targetPlanName:   string;
  targetPlanPrice:  number;
  proratedAmount:   number;
  remainingDays:    number;
  totalDays:        number;
  shouldCharge:     boolean;
  nextCycleDate:    string | null;
}

function UpgradeModal({
  preview,
  loading,
  onConfirm,
  onCancel,
}: {
  preview: UpgradePreview;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const targetPlan  = PLANS.find(p => p.name === preview.targetPlanName);
  const targetLabel = targetPlan?.label ?? preview.targetPlanName;
  const nextDate    = preview.nextCycleDate
    ? new Date(preview.nextCycleDate).toLocaleDateString('pt-BR')
    : null;

  // Sem proration real: plano cancelado ou primeiro ciclo completo
  const isFullPrice = preview.proratedAmount >= preview.targetPlanPrice * 0.99;
  // Features exclusivas do plano destino = o que o plano atual NÃO tem
  const currentPlanFeats = new Set(PLANS.find(p => p.label === preview.currentPlanLabel)?.feats ?? []);
  const newFeats = (targetPlan?.feats ?? []).filter(f => !currentPlanFeats.has(f));

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onCancel}>
      <div className="w-full max-w-sm rounded-2xl p-6"
        style={{ background: 'rgb(var(--color-surface-elevated))', border: '1px solid rgba(var(--color-primary)/.25)' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="text-center mb-5">
          <div className="w-12 h-12 rounded-full bg-brand-primary/10 flex items-center justify-center mx-auto mb-3 text-2xl">
            ⭐
          </div>
          <h3 className="font-bold text-base" style={{ color: 'rgb(var(--color-text))' }}>
            Upgrade para {targetLabel}
          </h3>
          <p className="text-xs mt-1" style={{ color: 'rgb(var(--color-text-muted))' }}>
            {preview.currentPlanLabel} → {targetLabel}
          </p>
        </div>

        {/* Features desbloqueadas */}
        {newFeats.length > 0 && (
          <div className="rounded-xl p-3 mb-4 space-y-1.5"
            style={{ background: 'rgba(var(--color-primary)/.05)', border: '1px solid rgba(var(--color-primary)/.12)' }}>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'rgb(var(--color-primary))' }}>
              Você vai desbloquear
            </p>
            {newFeats.map((f, i) => (
              <div key={i} className="flex items-center gap-2 text-xs" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                <span className="text-green-400 flex-shrink-0">✓</span>
                <span>{f}</span>
              </div>
            ))}
          </div>
        )}

        {/* Breakdown de valor */}
        <div className="rounded-xl p-4 mb-4 space-y-3"
          style={{ background: 'rgba(var(--color-primary)/.06)', border: '1px solid rgba(var(--color-primary)/.15)' }}>

          {preview.shouldCharge ? (
            <>
              <div className="flex justify-between items-baseline">
                <span className="text-xs" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                  {isFullPrice ? 'Valor da assinatura' : (
                    <>Paga agora <span className="text-[10px] opacity-70">({preview.remainingDays} dias restantes)</span></>
                  )}
                </span>
                <span className="font-black text-xl" style={{ color: 'rgb(var(--color-primary))' }}>
                  {brl(preview.proratedAmount)}
                </span>
              </div>
              {!isFullPrice && nextDate && (
                <>
                  <div className="h-px" style={{ background: 'rgba(var(--color-primary)/.12)' }} />
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs" style={{ color: 'rgb(var(--color-text-muted))' }}>
                      A partir de {nextDate}
                    </span>
                    <span className="font-bold text-sm" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                      {brl(preview.targetPlanPrice)}<span className="font-normal text-xs">/mês</span>
                    </span>
                  </div>
                </>
              )}
              {isFullPrice && (
                <>
                  <div className="h-px" style={{ background: 'rgba(var(--color-primary)/.12)' }} />
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs" style={{ color: 'rgb(var(--color-text-muted))' }}>Renovação mensal</span>
                    <span className="font-semibold text-xs" style={{ color: 'rgb(var(--color-text-muted))' }}>automática</span>
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="text-center py-1">
              <div className="font-black text-xl mb-1" style={{ color: 'rgb(var(--color-primary))' }}>
                Sem custo adicional
              </div>
              <div className="text-xs" style={{ color: 'rgb(var(--color-text-muted))' }}>
                A diferença é menor que R$1,00. Troca imediata!
              </div>
            </div>
          )}
        </div>

        {/* Cálculo detalhado (apenas quando há proration real) */}
        {preview.shouldCharge && !isFullPrice && (
          <details className="mb-4 group">
            <summary className="text-[10px] cursor-pointer select-none flex items-center gap-1"
              style={{ color: 'rgb(var(--color-text-muted))' }}>
              <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
              Como calculamos?
            </summary>
            <div className="mt-2 rounded-lg p-3 text-[10px] space-y-1"
              style={{ background: 'rgb(var(--color-surface))', color: 'rgb(var(--color-text-muted))' }}>
              <div>Diferença mensal: {brl(preview.targetPlanPrice)} − {brl(preview.currentPlanPrice)} = {brl(preview.targetPlanPrice - preview.currentPlanPrice)}</div>
              <div>Dias restantes no ciclo: {preview.remainingDays} / {preview.totalDays}</div>
              <div className="font-semibold" style={{ color: 'rgb(var(--color-primary))' }}>
                Total: {brl(preview.targetPlanPrice - preview.currentPlanPrice)} × {preview.remainingDays}/{preview.totalDays} = {brl(preview.proratedAmount)}
              </div>
            </div>
          </details>
        )}

        {/* Botões */}
        <button onClick={onConfirm} disabled={loading}
          className="w-full btn-primary py-3 text-sm font-bold disabled:opacity-50 mb-2">
          {loading
            ? 'Aguarde...'
            : preview.shouldCharge
            ? `Pagar ${brl(preview.proratedAmount)} →`
            : 'Confirmar upgrade →'}
        </button>
        <button onClick={onCancel} disabled={loading}
          className="w-full py-2 text-xs transition-colors disabled:opacity-50"
          style={{ color: 'rgb(var(--color-text-muted))' }}>
          Cancelar
        </button>

        <p className="text-center text-[10px] mt-2" style={{ color: 'rgba(var(--color-text-muted)/.5)' }}>
          🔒 Pagamento seguro via Asaas · Cancele a qualquer momento
        </p>
      </div>
    </div>
  );
}

/* ── Modal de CPF/CNPJ ── */
function DocumentModal({
  planLabel,
  onConfirm,
  onCancel,
}: {
  planLabel: string;
  onConfirm: (document: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [doc, setDoc]       = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const clean = doc.replace(/\D/g, '');
    if (clean.length !== 11 && clean.length !== 14) {
      setErr('Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.');
      return;
    }
    setSaving(true);
    setErr('');
    try {
      await onConfirm(doc);
    } catch (e: any) {
      setErr(e.message || 'Erro ao salvar. Tente novamente.');
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onCancel}>
      <div className="w-full max-w-sm rounded-2xl p-6"
        style={{ background: 'rgb(var(--color-surface-elevated))', border: '1px solid rgba(var(--color-primary)/.2)' }}
        onClick={e => e.stopPropagation()}>

        <div className="text-center mb-5">
          <div className="w-12 h-12 rounded-full bg-brand-primary/10 flex items-center justify-center mx-auto mb-3">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" style={{ color: 'rgb(var(--color-primary))' }}>
              <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 8h10M7 12h6M7 16h4"/>
            </svg>
          </div>
          <h3 className="font-bold text-base" style={{ color: 'rgb(var(--color-text))' }}>
            Dados de cobrança
          </h3>
          <p className="text-xs mt-1" style={{ color: 'rgb(var(--color-text-muted))' }}>
            Necessário para assinar o plano <strong style={{ color: 'rgb(var(--color-primary))' }}>{planLabel}</strong>
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'rgb(var(--color-text-secondary))' }}>
              CPF ou CNPJ
            </label>
            <input
              className="field-input"
              placeholder="000.000.000-00 ou 00.000.000/0001-00"
              value={doc}
              onChange={e => setDoc(formatDocument(e.target.value))}
              maxLength={18}
              required
              autoFocus
            />
            <p className="text-[10px] mt-1.5" style={{ color: 'rgb(var(--color-text-muted))' }}>
              Usado apenas para emissão de cobranças. Não será compartilhado.
            </p>
          </div>

          {err && (
            <div className="text-xs px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)', color: '#f87171' }}>
              {err}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onCancel}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all"
              style={{ border: '1.5px solid rgb(var(--color-border))', color: 'rgb(var(--color-text-muted))' }}>
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 btn-primary py-2.5 text-sm disabled:opacity-50">
              {saving ? 'Salvando...' : 'Continuar →'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Modal de verificação de e-mail (gate da assinatura) ── */
function VerifyEmailModal({
  email,
  onCancel,
}: {
  email: string;
  onCancel: () => void;
}) {
  const [sending, setSending] = useState(false);
  const [sent, setSent]       = useState(false);
  const [err, setErr]         = useState('');

  async function resend() {
    setSending(true);
    setErr('');
    try {
      await api.post('/auth/resend-verification', {});
      setSent(true);
    } catch (e: any) {
      setErr(e.message || 'Erro ao reenviar. Tente novamente em instantes.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onCancel}>
      <div className="w-full max-w-sm rounded-2xl p-6 text-center"
        style={{ background: 'rgb(var(--color-surface-elevated))', border: '1px solid rgba(var(--color-primary)/.2)' }}
        onClick={e => e.stopPropagation()}>

        <div className="w-12 h-12 rounded-full bg-brand-primary/10 flex items-center justify-center mx-auto mb-3 text-2xl">
          📧
        </div>
        <h3 className="font-bold text-base" style={{ color: 'rgb(var(--color-text))' }}>
          Confirme seu e-mail para assinar
        </h3>
        <p className="text-xs mt-2 leading-relaxed" style={{ color: 'rgb(var(--color-text-muted))' }}>
          Para sua segurança, antes de assinar um plano precisamos confirmar que{' '}
          <strong style={{ color: 'rgb(var(--color-text-secondary))' }}>{email}</strong> é seu.
          Enviamos um link de confirmação — abra-o e clique em <strong>Confirmar meu e-mail</strong>.
        </p>

        {err && (
          <div className="text-xs px-3 py-2 rounded-lg mt-4" style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)', color: '#f87171' }}>
            {err}
          </div>
        )}

        {sent ? (
          <div className="text-xs px-3 py-2 rounded-lg mt-4" style={{ background: 'rgba(34,197,94,.1)', border: '1px solid rgba(34,197,94,.2)', color: '#4ade80' }}>
            ✓ Link reenviado! Verifique sua caixa de entrada (e o spam).
          </div>
        ) : (
          <button onClick={resend} disabled={sending}
            className="w-full btn-primary py-3 text-sm mt-5 disabled:opacity-50">
            {sending ? 'Enviando...' : 'Reenviar link de confirmação'}
          </button>
        )}

        <button onClick={onCancel}
          className="w-full py-2 text-xs mt-2 transition-colors"
          style={{ color: 'rgb(var(--color-text-muted))' }}>
          Fechar
        </button>

        <p className="text-[10px] mt-3" style={{ color: 'rgba(var(--color-text-muted)/.6)' }}>
          Já confirmou? Recarregue esta página e tente novamente.
        </p>
      </div>
    </div>
  );
}

function PlanoContent() {
  const searchParams = useSearchParams();
  const [stats, setStats]             = useState<Stats | null>(null);
  const [user, setUser]               = useState<User | null>(null);
  const [loading, setLoading]         = useState(true);
  const [checkoutPlan, setCheckoutPlan]     = useState<string | null>(null);  // plano com checkout inline aberto
  const [trialCardMode, setTrialCardMode]   = useState(false);                // checkout em modo "garantir cartão do trial"
  const [docModal, setDocModal]             = useState<string | null>(null);
  const [verifyModal, setVerifyModal]       = useState(false);
  const [showTable, setShowTable]           = useState(false);
  const [upgradePreview, setUpgradePreview] = useState<UpgradePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [invoices, setInvoices]               = useState<any[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [invoicesMeta, setInvoicesMeta]       = useState<{ isTester?: boolean; testerRenewalsUsed?: number; testerRenewalsTotal?: number }>({});
  const justUpgraded = searchParams.get('upgrade') === 'success';
  const justCanceled = searchParams.get('canceled') === '1';
  const trialCardSet = searchParams.get('trialcardset') === '1';

  /* — Minute packages — */
  const [minutePkgs, setMinutePkgs]             = useState<MinutePkg[]>(DEFAULT_MINUTE_PKGS);
  const [pkgModal, setPkgModal]                 = useState<MinutePkg | null>(null);
  const [pkgMethod, setPkgMethod]               = useState<'pix' | 'credit_card'>('pix');
  const [pkgLoading, setPkgLoading]             = useState(false);
  const [pkgPixData, setPkgPixData]             = useState<{ qrCode: string | null; copyPaste: string | null } | null>(null);
  const [pkgCopied, setPkgCopied]               = useState(false);
  const [pkgSuccess, setPkgSuccess]             = useState(false);
  const [cancelModal, setCancelModal]           = useState(false);
  const [canceling, setCanceling]               = useState(false);
  const [cancelError, setCancelError]           = useState('');

  async function handleCancel() {
    setCanceling(true);
    setCancelError('');
    try {
      await api.post('/billing/cancel', {});
      setCancelModal(false);
      window.location.href = '/dashboard/plano?canceled=1';
    } catch (e: any) {
      setCancelError(e?.message || 'Não foi possível cancelar agora. Tente novamente.');
    } finally {
      setCanceling(false);
    }
  }

  useEffect(() => {
    // Se veio da página de sucesso, sincroniza com Asaas antes de carregar
    const doLoad = () => Promise.all([
      api.get<Stats>('/dashboard/stats'),
      api.get<User>('/auth/me'),
    ]).then(([s, u]) => {
      setStats(s);
      setUser(u);
      // Sempre tenta carregar faturas (plano pode ter sido ativado por webhook recente)
      setInvoicesLoading(true);
      api.get<{ invoices: any[]; isTester?: boolean; testerRenewalsUsed?: number; testerRenewalsTotal?: number }>('/billing/invoices')
        .then(r => {
          setInvoices(r.invoices || []);
          setInvoicesMeta({ isTester: r.isTester, testerRenewalsUsed: r.testerRenewalsUsed, testerRenewalsTotal: r.testerRenewalsTotal });
        })
        .catch(() => null)
        .finally(() => setInvoicesLoading(false));
    }).finally(() => setLoading(false));

    if (justUpgraded) {
      // Chama sync para garantir ativação mesmo se webhook não chegou
      api.get('/billing/sync').catch(() => null).finally(doLoad);
    } else {
      doLoad();
    }
    // Pacotes de minutos avulsos descontinuados no modelo por áudios
    // (Free = 15 áudios/mês, Pro = áudios ilimitados). Seção não é mais carregada.
    setMinutePkgs([]);
  }, []);

  // ── Trial com cartão: abre o checkout em modo "garantir cartão" (D+7) ──
  // Reaproveita o gate de e-mail verificado + CPF antes de tokenizar o cartão.
  function startTrialCard() {
    setTrialCardMode(true);
    if (!user?.emailVerified) { setVerifyModal(true); return; }
    if (!user?.document)      { setDocModal('pro');   return; }
    setUpgradePreview(null);
    setCheckoutPlan('pro');
  }

  // Dispara o fluxo de cartão do trial quando vier de ?trialcard=1 (CTA do banner).
  const trialcardParam = searchParams.get('trialcard') === '1';
  useEffect(() => {
    if (!trialcardParam || !stats || !user) return;
    if (!stats.isTrial || stats.cardOnFile) return;
    if (trialCardMode || checkoutPlan || verifyModal || docModal) return;
    startTrialCard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trialcardParam, stats, user]);

  // Abre o checkout inline para o plano
  function doCheckout(planName: string) {
    setCheckoutPlan(planName);
    setUpgradePreview(null);
  }

  async function upgrade(planName: string) {
    setTrialCardMode(false);  // fluxo normal de assinatura/upgrade (não é cartão de trial)
    // Opção A: gate de assinatura — e-mail verificado vem antes do CPF/checkout.
    if (!user?.emailVerified) {
      setVerifyModal(true);
      return;
    }
    if (!user?.document) {
      setDocModal(planName);
      return;
    }
    // Usuário já em plano pago → mostrar simulação de proration antes
    if (currentPlan !== 'free') {
      setPreviewLoading(true);
      try {
        const preview = await api.get<UpgradePreview>(`/billing/upgrade-preview?targetPlan=${planName}`);
        setUpgradePreview(preview);
      } catch (err: any) {
        alert(err.message || 'Erro ao calcular upgrade. Tente novamente.');
      } finally {
        setPreviewLoading(false);
      }
      return;
    }
    doCheckout(planName);
  }

  function handleCheckoutSuccess(planName: string) {
    setCheckoutPlan(null);
    setUpgradePreview(null);
    // Trial: nada foi cobrado agora — só recarrega para refletir cardOnFile.
    if (trialCardMode) {
      setTrialCardMode(false);
      window.location.href = `/dashboard/plano?trialcardset=1`;
      return;
    }
    window.location.href = `/dashboard/plano?upgrade=success`;
  }

  // doUpgrade: fecha o modal de proration e abre o checkout inline
  async function doUpgrade() {
    if (!upgradePreview) return;
    const planName = upgradePreview.targetPlanName;
    setUpgradePreview(null);
    setCheckoutPlan(planName);
  }

  async function handleDocumentConfirm(document: string) {
    // Salvar CPF/CNPJ e prosseguir para checkout
    await api.put('/auth/profile', { document });
    setUser(u => u ? { ...u, document: document.replace(/\D/g, '') } : u);
    const plan = docModal!;
    setDocModal(null);
    await doCheckout(plan);
  }

  if (loading) return (
    <div className="p-8 text-center text-brand-muted text-sm pt-20">Carregando...</div>
  );

  // planName já vem como slug ('free'|'pro'|'executive') — sem precisar de toLowerCase
  const currentPlan = stats?.planName || 'free';
  // Oferta permanente: 1º mês do Pro a R$19,90 (50% off) em novas assinaturas mensais
  const junePromo = isJunePromoActive() && currentPlan === 'free';
  const PLAN_ORDER: Record<string, number> = { free: 0, pro: 1, executive: 2 };
  const currentPlanOrder = PLAN_ORDER[currentPlan] ?? 0;
  // Exibir apenas Free e Pro — Executive continua suportado para usuários existentes
  const displayedPlans = PLANS.filter(p => p.name !== 'executive');

  return (
    <div className="p-4 sm:p-8 max-w-3xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold">Plano & Cobrança</h1>
        <p className="text-sm font-light mt-0.5" style={{ color: 'rgb(var(--color-text-secondary))' }}>
          Gerencie seu plano e uso de áudios
        </p>
      </div>

      {/* Upgrade success banner */}
      {justUpgraded && (
        <div className="rounded-xl px-5 py-3.5 mb-5 flex items-center gap-3"
          style={{ background: 'rgba(var(--color-primary)/.1)', border: '1px solid rgba(var(--color-primary)/.3)' }}>
          <span className="text-xl">🎉</span>
          <div>
            <div className="font-bold text-sm" style={{ color: 'rgb(var(--color-primary))' }}>Upgrade realizado com sucesso!</div>
            <div className="text-xs font-light" style={{ color: 'rgb(var(--color-text-secondary))' }}>Seu plano foi atualizado.</div>
          </div>
        </div>
      )}

      {/* Cartão do trial garantido */}
      {trialCardSet && (
        <div className="rounded-xl px-5 py-3.5 mb-5 flex items-center gap-3"
          style={{ background: 'rgba(var(--color-primary)/.1)', border: '1px solid rgba(var(--color-primary)/.3)' }}>
          <span className="text-xl">🔒</span>
          <div>
            <div className="font-bold text-sm" style={{ color: 'rgb(var(--color-primary))' }}>Pro garantido!</div>
            <div className="text-xs font-light" style={{ color: 'rgb(var(--color-text-secondary))' }}>
              Seu cartão foi cadastrado. Nada foi cobrado agora — a 1ª cobrança será só ao fim do teste. Cancele antes e não paga nada.
            </div>
          </div>
        </div>
      )}

      {/* Cancelamento confirmado */}
      {justCanceled && (
        <div className="rounded-xl px-5 py-3.5 mb-5 flex items-center gap-3"
          style={{ background: 'rgb(var(--color-surface-elevated))', border: '1px solid rgb(var(--color-border))' }}>
          <span className="text-xl">✅</span>
          <div>
            <div className="font-bold text-sm">Assinatura cancelada</div>
            <div className="text-xs font-light" style={{ color: 'rgb(var(--color-text-secondary))' }}>
              Você voltou para o plano Free. Pode reativar quando quiser.
            </div>
          </div>
        </div>
      )}

      {/* Current usage */}
      {stats && (
        <div className="card rounded-2xl p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <span className="font-bold">Plano atual: </span>
              <span className="font-bold" style={{ color: 'rgb(var(--color-primary))' }}>{stats.planLabel ?? stats.planName}</span>
            </div>
            <span className={`text-xs font-bold px-3 py-1 rounded-full border ${
              stats.planStatus === 'active'   ? 'text-emerald-400 border-emerald-400/20 bg-emerald-400/10' :
              stats.planStatus === 'past_due' ? 'text-amber-400 border-amber-400/20 bg-amber-400/10' :
              'text-red-400 border-red-400/20 bg-red-400/10'
            }`}>
              {stats.planStatus === 'active' ? '● Ativo' :
               stats.planStatus === 'past_due' ? '⚠ Pagamento pendente' :
               '✕ Cancelado'}
            </span>
          </div>

          {/* Data de renovação + dias restantes */}
          {stats.renewAt && stats.planName !== 'free' && (() => {
            const _today = new Date(); _today.setHours(0,0,0,0);
            const _renew = new Date(stats.renewAt); _renew.setHours(0,0,0,0);
            const daysLeft = Math.round((_renew.getTime() - _today.getTime()) / (1000 * 60 * 60 * 24));
            const urgent   = daysLeft <= 7;
            return (
              <div className="flex items-center gap-1.5 text-xs mb-4"
                style={{ color: 'rgb(var(--color-text-muted))' }}>
                <span>🔄</span>
                <span>
                  Renova em{' '}
                  <strong style={{ color: 'rgb(var(--color-text-secondary))' }}>
                    {new Date(stats.renewAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
                  </strong>
                  {' · '}
                  <span style={{ color: urgent ? '#f87171' : 'rgb(var(--color-text-muted))' }}>
                    {daysLeft > 0
                      ? `${daysLeft} dia${daysLeft !== 1 ? 's' : ''} restante${daysLeft !== 1 ? 's' : ''}`
                      : 'Vence hoje'}
                  </span>
                </span>
              </div>
            );
          })()}

          <div className="flex justify-between text-xs mb-2" style={{ color: 'rgb(var(--color-text-secondary))' }}>
            <span>Áudios lidos este mês</span>
            <span className="font-bold" style={{ color: 'rgb(var(--color-primary))' }}>
              {stats.audiosUnlimited ? `${stats.audiosUsed} · ilimitado` : `${stats.audiosUsed} / ${stats.audiosQuota}`}
            </span>
          </div>
          {!stats.audiosUnlimited && (
            <>
              <div className="h-2 rounded-full overflow-hidden mb-1" style={{ background: 'rgb(var(--color-surface-elevated))' }}>
                <div className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(stats.audiosPct, 100)}%`,
                    background: stats.audiosPct >= 90
                      ? 'linear-gradient(90deg, #f87171, #ef4444)'
                      : stats.audiosPct >= 70
                        ? 'linear-gradient(90deg, #fbbf24, #f59e0b)'
                        : 'linear-gradient(90deg, rgb(var(--color-primary-light)), rgb(var(--color-primary)))',
                  }} />
              </div>
              <div className="flex justify-between text-xs" style={{ color: 'rgb(var(--color-text-muted))' }}>
                <span>{stats.audiosPct}% utilizado</span>
                <span>{Math.max(0, stats.audiosQuota - stats.audiosUsed)} restantes</span>
              </div>
            </>
          )}

          {/* Saldo extra em minutos descontinuado no modelo por áudios — bloco removido. */}

        </div>
      )}

      {/* ── Planos — Spotlight Pro Layout ── */}
      {currentPlan === 'free' && (
        <h2 className="font-display font-bold text-base mb-4">Fazer upgrade</h2>
      )}
      {currentPlan === 'pro' && (
        <h2 className="font-display font-bold text-base mb-4">Seu plano</h2>
      )}

      {currentPlan === 'executive' ? (
        /* Usuários Executive: manter plano existente, mostrar status */
        <div className="rounded-2xl p-4 mb-4 text-sm"
          style={{ background: 'rgba(var(--color-primary)/.06)', border: '1px solid rgba(var(--color-primary)/.2)', color: 'rgb(var(--color-text-secondary))' }}>
          <span className="font-bold" style={{ color: 'rgb(var(--color-primary))' }}>Plano Executive ativo.</span>{' '}
          Você tem acesso completo a todos os recursos. Em breve, novos planos serão apresentados.
        </div>
      ) : currentPlan === 'pro' ? (
        /* Usuários Pro: card de plano atual compacto */
        <div className="relative rounded-2xl p-5 mb-0" style={{
          background: 'rgb(var(--color-surface-elevated))',
          border: '1.5px solid rgb(var(--color-primary))',
          boxShadow: '0 0 0 1px rgba(var(--color-primary)/.15), var(--shadow-glow)',
        }}>
          <span className="absolute -top-3 right-4 text-[10px] font-bold px-3 py-0.5 rounded-full"
            style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgba(var(--color-primary)/.4)', color: 'rgb(var(--color-primary))' }}>
            Plano atual
          </span>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-display font-bold text-base">Pro</div>
              <div className="text-xs font-light mt-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>Para profissionais</div>
            </div>
            <div className="text-right">
              <span className="font-display font-bold text-2xl tracking-tight" style={{ color: 'rgb(var(--color-primary))' }}>R$39,90</span>
              <span className="text-xs font-light ml-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>/mês</span>
            </div>
          </div>
          <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5">
            {PLANS.find(p => p.name === 'pro')!.feats.map(f => (
              <li key={f} className="flex items-center gap-1.5 text-xs" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                <span style={{ color: 'rgb(var(--color-primary))' }}>✓</span>{f}
              </li>
            ))}
          </ul>

          {/* Cancelamento — em 1 clique, sem ligação, sem fidelidade */}
          <div className="mt-4 pt-3 flex items-center justify-between gap-3"
            style={{ borderTop: '1px solid rgb(var(--color-border))' }}>
            <span className="text-[11px] font-light" style={{ color: 'rgb(var(--color-text-muted))' }}>
              Cancele em 1 clique, sem ligação e sem fidelidade.
            </span>
            <button
              type="button"
              onClick={() => { setCancelError(''); setCancelModal(true); }}
              className="text-xs font-medium whitespace-nowrap transition-colors hover:underline"
              style={{ color: 'rgb(var(--color-text-muted))' }}
            >
              Cancelar assinatura
            </button>
          </div>
        </div>
      ) : (
        /* Usuários Free: comparativo rápido + Pro como herói */
        <div className="space-y-3">

          {/* Free — card compacto de contexto */}
          <div className="rounded-xl px-4 py-3 flex items-center justify-between"
            style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgb(var(--color-border))' }}>
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(var(--color-primary)/.1)', color: 'rgb(var(--color-primary))' }}>
                Atual
              </span>
              <div>
                <span className="text-sm font-bold">Free</span>
                <span className="text-xs ml-2" style={{ color: 'rgb(var(--color-text-muted))' }}>15 áudios · 1 número · básico</span>
              </div>
            </div>
            <span className="font-bold text-sm" style={{ color: 'rgb(var(--color-text-muted))' }}>R$0</span>
          </div>

          {/* Pro — card herói */}
          <div className="relative rounded-2xl p-5 pt-7"
            style={{
              background: 'rgb(var(--color-surface-elevated))',
              border: '2px solid rgb(var(--color-primary))',
              boxShadow: '0 0 0 1px rgba(var(--color-primary)/.15), var(--shadow-glow)',
            }}>
            <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 text-[11px] font-black px-4 py-1 rounded-full uppercase tracking-wider"
              style={{ background: 'rgb(var(--color-primary))', color: '#030d06' }}>
              {junePromo ? '🔥 50% OFF no 1º mês' : '⭐ Mais completo'}
            </span>

            {/* Preço + nome */}
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="font-display font-bold text-xl">Pro</div>
                <div className="text-xs mt-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>Para profissionais que precisam de mais</div>
              </div>
              <div className="text-right">
                {junePromo ? (
                  <>
                    <div className="text-xs line-through" style={{ color: 'rgb(var(--color-text-muted))' }}>R$39,90</div>
                    <div className="font-display font-black text-3xl tracking-tight leading-none" style={{ color: 'rgb(var(--color-primary))' }}>
                      R$19,90
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>1º mês · depois R$39,90/mês</div>
                  </>
                ) : (
                  <>
                    <div className="font-display font-black text-3xl tracking-tight leading-none" style={{ color: 'rgb(var(--color-primary))' }}>
                      R$39,90
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>/mês · cancele quando quiser</div>
                  </>
                )}
                <div className="text-[11px] font-medium mt-1.5" style={{ color: 'rgb(var(--color-primary))' }}>24h trabalhando por você, por apenas R$1,33 ao dia</div>
              </div>
            </div>

            {/* Stats rápidos */}
            <div className="grid grid-cols-2 gap-2 mb-4">
              {[
                { val: '∞', label: 'áudios/mês', icon: '⏱' },
                { val: '2', label: 'números WhatsApp', icon: '📱' },
              ].map(s => (
                <div key={s.label} className="rounded-xl p-3 text-center"
                  style={{ background: 'rgba(var(--color-primary)/.06)', border: '1px solid rgba(var(--color-primary)/.15)' }}>
                  <div className="font-black text-2xl" style={{ color: 'rgb(var(--color-primary))' }}>{s.val}</div>
                  <div className="text-[11px] mt-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Features: o que você ganha */}
            <div className="mb-1">
              <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'rgb(var(--color-text-muted))' }}>
                Tudo do Free, mais:
              </p>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-y-1.5 gap-x-4">
                {[
                  '📋 Histórico de conversões',
                  '📅 Filtros por data e contato',
                  '🔍 Busca por conversão',
                  '🔒 Modo Privado automático',
                  '📄 Conversão profissional PDF',
                ].map(f => (
                  <li key={f} className="flex items-center gap-2 text-xs" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                    <span style={{ color: 'rgb(var(--color-primary))' }}>✓</span>{f}
                  </li>
                ))}
              </ul>
            </div>

            {/* CTA */}
            <button
              disabled={previewLoading}
              onClick={() => upgrade('pro')}
              className="w-full mt-5 py-3.5 rounded-xl text-sm font-black tracking-wide transition-all disabled:opacity-50"
              style={{
                background: 'rgb(var(--color-primary))',
                color: '#030d06',
                boxShadow: 'rgba(var(--color-primary)/.35) 0 6px 20px',
              }}>
              {previewLoading
                ? 'Calculando...'
                : junePromo
                  ? 'Assinar Pro por R$19,90 no 1º mês →'
                  : 'Assinar Pro por R$39,90/mês →'}
            </button>

            <p className="text-center text-[10px] mt-2" style={{ color: 'rgba(var(--color-text-muted)/.6)' }}>
              {junePromo
                ? '🔥 50% OFF no 1º mês: R$19,90, depois R$39,90/mês · Cancele quando quiser'
                : '🔒 Pix ou cartão · Cancele a qualquer momento'}
            </p>
          </div>
        </div>
      )}

      {/* Toggle comparativo — apenas para usuários Free */}
      {currentPlan === 'free' && (
        <>
          <button
            onClick={() => setShowTable(v => !v)}
            className="w-full mt-4 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-2"
            style={{ border: '1.5px solid rgb(var(--color-border))', color: 'rgb(var(--color-text-muted))', background: 'transparent' }}>
            {showTable ? 'Ocultar comparativo ↑' : 'Ver comparativo completo ↓'}
          </button>

          {showTable && (
            <div className="mt-3 rounded-2xl overflow-hidden" style={{ border: '1px solid rgb(var(--color-border))' }}>
              <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'rgb(var(--color-surface-elevated))' }}>
                    <th className="text-left px-4 py-2.5 font-semibold" style={{ color: 'rgb(var(--color-text-muted))' }}>Recurso</th>
                    <th className="px-3 py-2.5 font-bold text-center w-16" style={{ color: 'rgb(var(--color-text-muted))' }}>Free</th>
                    <th className="px-3 py-2.5 font-bold text-center w-16" style={{ color: 'rgb(var(--color-primary))' }}>Pro</th>
                  </tr>
                </thead>
                <tbody>
                  {TABLE_ROWS.map((row, ri) => (
                    <tr key={ri} style={{ borderTop: '1px solid rgb(var(--color-border-light))' }}>
                      <td className="px-4 py-2.5 font-medium" style={{ color: 'rgb(var(--color-text-secondary))' }}>{row.feature}</td>
                      {row.vals.slice(0, 2).map((v, vi) => (
                        <td key={vi} className="px-3 py-2.5 text-center">
                          {typeof v === 'boolean' ? (
                            v ? <span style={{ color: 'rgb(var(--color-primary))' }}>✓</span>
                              : <span style={{ color: 'rgb(var(--color-text-muted))', opacity: .4 }}>✗</span>
                          ) : (
                            <span className="font-mono font-bold" style={{ color: vi === 1 ? 'rgb(var(--color-primary))' : 'rgb(var(--color-text))' }}>{v}</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {currentPlan !== 'free' && (
        <p className="text-xs text-center mt-4" style={{ color: 'rgb(var(--color-text-muted))' }}>
          Pagamentos processados com segurança pela Asaas. Cancele a qualquer momento.
        </p>
      )}

      {/* ── Faturas / Histórico de renovações ── */}
      {stats && currentPlan !== 'free' && (
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-bold text-base">Histórico de Renovações</h2>
            {/* Badge de isenções Tester restantes */}
            {invoicesMeta.isTester && invoicesMeta.testerRenewalsTotal != null && (
              <div className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-semibold"
                style={{ background: 'rgba(var(--color-primary)/.1)', border: '1px solid rgba(var(--color-primary)/.2)', color: 'rgb(var(--color-primary))' }}>
                🎁 {(invoicesMeta.testerRenewalsTotal ?? 12) - (invoicesMeta.testerRenewalsUsed ?? 0)} isenções restantes
              </div>
            )}
          </div>
          <div className="card rounded-2xl overflow-hidden">
            {invoicesLoading ? (
              <div className="py-8 text-center text-sm text-brand-muted">Carregando renovações…</div>
            ) : invoices.length === 0 ? (
              <div className="py-6 px-5">
                {/* Assinatura ativa (ativada pelo admin ou via webhook ainda não processado) */}
                <div className="flex items-start gap-3 p-4 rounded-xl mb-4"
                  style={{ background: 'rgba(var(--color-primary)/.06)', border: '1px solid rgba(var(--color-primary)/.15)' }}>
                  <span className="text-xl">✅</span>
                  <div>
                    <p className="text-sm font-semibold text-brand-text">
                      Plano {stats.planLabel} ativo
                    </p>
                    {stats.renewAt && (() => {
                      const _today = new Date(); _today.setHours(0,0,0,0);
                      const _renew = new Date(stats.renewAt); _renew.setHours(0,0,0,0);
                      const daysLeft = Math.round((_renew.getTime() - _today.getTime()) / (1000 * 60 * 60 * 24));
                      const renewStr = new Date(stats.renewAt + 'T12:00:00').toLocaleDateString('pt-BR');
                      return (
                        <p className="text-xs text-brand-muted mt-0.5">
                          {daysLeft > 0 ? `Renova em ${daysLeft} dia${daysLeft !== 1 ? 's' : ''} — ${renewStr}` : `Renovou em ${renewStr}`}
                        </p>
                      );
                    })()}
                  </div>
                </div>
                <p className="text-xs text-brand-muted text-center">
                  Renovações aparecerão aqui conforme os ciclos mensais forem completados.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-brand-border/30">
                {invoices.map((inv: any) => {
                  const statusMap: Record<string, { label: string; color: string }> = {
                    RECEIVED:             { label: 'Pago',          color: 'text-emerald-400' },
                    CONFIRMED:            { label: 'Pago',          color: 'text-emerald-400' },
                    DUNNING_RECEIVED:     { label: 'Regularizado',  color: 'text-emerald-400' },
                    PENDING:              { label: 'Pendente',      color: 'text-amber-400'   },
                    AWAITING_RISK_ANALYSIS: { label: 'Em análise', color: 'text-amber-400'   },
                    DUNNING_REQUESTED:    { label: 'Em cobrança',   color: 'text-amber-400'   },
                    OVERDUE:              { label: 'Atrasado',      color: 'text-red-400'     },
                    CHARGEBACK_REQUESTED: { label: 'Chargeback',    color: 'text-red-400'     },
                    REFUNDED:             { label: 'Reembolsado',   color: 'text-brand-muted' },
                    PARTIALLY_REFUNDED:   { label: 'Reemb. parcial',color: 'text-brand-muted' },
                    CANCELED:             { label: 'Cancelado',     color: 'text-brand-muted' },
                    TESTER_EXEMPT:        { label: 'Isenção Tester', color: 'text-emerald-400' },
                    TESTER_UPCOMING:      { label: 'Isenta',         color: 'text-brand-muted' },
                  };
                  const st = statusMap[inv.status] || { label: inv.statusLabel || inv.status, color: inv.statusColor || 'text-brand-muted' };
                  const date = inv.paymentDate || inv.dueDate;
                  const dateStr = date
                    ? new Date(date + 'T12:00:00').toLocaleDateString('pt-BR')
                    : '—';
                  const brl = (v: number) => v != null ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—';
                  return (
                    <div key={inv.id} className={`flex items-center justify-between px-5 py-3.5 gap-4 ${inv.isUpcoming ? 'opacity-60' : ''}`}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-medium text-brand-text truncate">
                            {inv.description || 'Assinatura ZapScript'}
                          </div>
                          {inv.isTesterExempt && !inv.isUpcoming && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                              style={{ background: 'rgba(var(--color-primary)/.12)', color: 'rgb(var(--color-primary))' }}>
                              🎁 Tester
                            </span>
                          )}
                          {inv.isUpcoming && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                              style={{ background: 'rgba(148,163,184,.1)', color: 'rgb(var(--color-text-muted))' }}>
                              Próxima
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-brand-muted mt-0.5">{dateStr}</div>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span className={`text-xs font-semibold ${st.color}`}>{st.label}</span>
                        <span className="text-sm font-bold" style={{ color: 'rgb(var(--color-text))' }}>
                          {inv.isTesterExempt ? (
                            <span style={{ color: 'rgb(var(--color-primary))' }}>Grátis</span>
                          ) : (
                            brl(inv.value)
                          )}
                        </span>
                        {inv.invoiceUrl && (
                          <a
                            href={inv.invoiceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] px-2.5 py-1 rounded-lg transition-colors"
                            style={{ background: 'rgba(var(--color-primary)/.1)', color: 'rgb(var(--color-primary))' }}>
                            Ver →
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Pacotes de minutos avulsos ────────────────────────────────────── */}
      {minutePkgs.length > 0 && (
        <div className="mt-6">
          <div className="mb-3">
            <h2 className="font-bold text-sm" style={{ color: 'rgb(var(--color-text))' }}>⏱️ Comprar minutos avulsos</h2>
            <p className="text-xs mt-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>
              Créditos extras sem alterar seu plano. Válidos por 60 dias e não somem no reset mensal.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {minutePkgs.map(pkg => (
              <button
                key={pkg.id}
                type="button"
                onClick={() => { setPkgModal(pkg); setPkgPixData(null); setPkgSuccess(false); setPkgMethod('pix'); }}
                className="text-left rounded-2xl p-4 border transition-all hover:border-brand-primary/40"
                style={{ background: 'rgb(var(--color-surface))', borderColor: 'rgb(var(--color-border))' }}>
                <div className="font-display font-bold text-lg" style={{ color: 'rgb(var(--color-text))' }}>
                  {pkg.minutes}<span className="text-xs font-normal ml-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>min</span>
                </div>
                <div className="text-xs mt-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>{pkg.desc}</div>
                <div className="font-bold text-sm mt-2" style={{ color: 'rgb(var(--color-primary))' }}>
                  {pkg.priceBrl.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Modal de compra de pacote */}
      {pkgModal && !pkgSuccess && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setPkgModal(null)}>
          <div className="w-full max-w-sm rounded-2xl p-6"
            style={{ background: 'rgb(var(--color-surface-elevated))', border: '1px solid rgba(var(--color-border)/.6)' }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="font-bold text-base">Comprar {pkgModal.label}</h3>
                <p className="text-xs mt-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>{pkgModal.desc}</p>
              </div>
              <span className="font-bold text-xl" style={{ color: 'rgb(var(--color-primary))' }}>
                {pkgModal.priceBrl.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </span>
            </div>

            {/* Método de pagamento */}
            {!pkgPixData && (
              <>
                <div className="flex gap-2 mb-5">
                  {(['pix', 'credit_card'] as const).map(m => (
                    <button key={m} type="button"
                      onClick={() => setPkgMethod(m)}
                      className="flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all"
                      style={{
                        background:   pkgMethod === m ? 'rgba(var(--color-primary)/.1)' : 'transparent',
                        borderColor:  pkgMethod === m ? 'rgb(var(--color-primary))' : 'rgb(var(--color-border))',
                        color:        pkgMethod === m ? 'rgb(var(--color-primary))' : 'rgb(var(--color-text-muted))',
                      }}>
                      {m === 'pix' ? '⚡ PIX' : '💳 Cartão'}
                    </button>
                  ))}
                </div>
                {pkgMethod === 'credit_card' && (
                  <p className="text-xs text-center mb-4" style={{ color: 'rgb(var(--color-text-muted))' }}>
                    Pagamento com cartão: entre em contato via suporte para finalizar.
                  </p>
                )}
                <button
                  type="button"
                  disabled={pkgLoading}
                  onClick={async () => {
                    if (pkgMethod === 'credit_card') { alert('Para pagamento no cartão, acione o suporte.'); return; }
                    setPkgLoading(true);
                    try {
                      const res = await api.post<any>('/billing/buy-minutes', { packageId: pkgModal.id, paymentMethod: 'pix' });
                      if (res.qrCode || res.copyPaste) {
                        setPkgPixData({ qrCode: res.qrCode, copyPaste: res.copyPaste });
                      } else if (res.status === 'active') {
                        setPkgSuccess(true);
                      }
                    } catch (err: any) {
                      alert(err.message || 'Erro ao gerar cobrança. Tente novamente.');
                    } finally {
                      setPkgLoading(false);
                    }
                  }}
                  className="w-full py-3 rounded-2xl text-sm font-bold text-white transition-all disabled:opacity-50"
                  style={{ background: 'rgb(var(--color-primary))' }}>
                  {pkgLoading ? 'Gerando cobrança…' : pkgMethod === 'pix' ? '⚡ Pagar com PIX' : '💳 Pagar com Cartão'}
                </button>
              </>
            )}

            {/* PIX QR Code */}
            {pkgPixData && (
              <div className="text-center">
                <p className="text-sm font-semibold mb-3" style={{ color: 'rgb(var(--color-text))' }}>
                  PIX gerado! Escaneie ou copie o código:
                </p>
                {pkgPixData.qrCode && (
                  <img src={`data:image/png;base64,${pkgPixData.qrCode}`} alt="QR Code PIX"
                    className="w-40 h-40 mx-auto rounded-xl mb-3 border"
                    style={{ borderColor: 'rgb(var(--color-border))' }} />
                )}
                {pkgPixData.copyPaste && (
                  <div className="rounded-xl p-3 mb-3 text-left break-all text-xs font-mono"
                    style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgb(var(--color-border))' }}>
                    {pkgPixData.copyPaste.slice(0, 60)}…
                  </div>
                )}
                <button type="button"
                  onClick={() => { navigator.clipboard.writeText(pkgPixData.copyPaste || ''); setPkgCopied(true); setTimeout(() => setPkgCopied(false), 2000); }}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold mb-2 transition-all"
                  style={{ background: 'rgba(var(--color-primary)/.1)', color: 'rgb(var(--color-primary))' }}>
                  {pkgCopied ? '✓ Copiado!' : '📋 Copiar código PIX'}
                </button>
                <p className="text-xs" style={{ color: 'rgb(var(--color-text-muted))' }}>
                  Após o pagamento, os minutos serão creditados automaticamente em até 1 minuto.
                </p>
              </div>
            )}

            <button type="button" onClick={() => setPkgModal(null)}
              className="w-full mt-3 py-2 text-xs text-center transition-colors"
              style={{ color: 'rgb(var(--color-text-muted))' }}>
              Fechar
            </button>
          </div>
        </div>
      )}

      {/* Modal de sucesso do pacote */}
      {pkgModal && pkgSuccess && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => { setPkgModal(null); setPkgSuccess(false); }}>
          <div className="w-full max-w-xs rounded-2xl p-8 text-center"
            style={{ background: 'rgb(var(--color-surface-elevated))', border: '1px solid rgba(var(--color-primary)/.3)' }}
            onClick={e => e.stopPropagation()}>
            <div className="text-4xl mb-4">🎉</div>
            <h3 className="font-bold text-base mb-1" style={{ color: 'rgb(var(--color-text))' }}>
              +{pkgModal.minutes} minutos creditados!
            </h3>
            <p className="text-xs mb-5" style={{ color: 'rgb(var(--color-text-muted))' }}>
              Seu saldo foi atualizado. Use à vontade!
            </p>
            <button type="button" onClick={() => { setPkgModal(null); setPkgSuccess(false); window.location.reload(); }}
              className="btn-primary w-full py-2.5 text-sm font-semibold">
              Fechar
            </button>
          </div>
        </div>
      )}

      {/* Empresas — Em breve teaser */}
      <div className="mt-6 rounded-2xl p-4 flex items-center gap-4"
        style={{ background: 'rgb(var(--color-surface))', border: '1px dashed rgba(var(--color-border)/.6)' }}>
        <div className="text-2xl flex-shrink-0">🏢</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-bold">Plano Empresas</span>
            <span className="text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider"
              style={{ background: 'rgba(var(--color-primary)/.1)', color: 'rgb(var(--color-primary))' }}>
              Em breve
            </span>
          </div>
          <p className="text-xs" style={{ color: 'rgb(var(--color-text-muted))' }}>
            Multi-usuário · Webhook personalizado · Integrações avançadas · Para times e agências
          </p>
        </div>
      </div>

      {/* ── Checkout inline Asaas ── */}
      {checkoutPlan && checkoutPlan !== 'free' && (() => {
        const plan = PLANS.find(p => p.name === checkoutPlan) ?? { label: checkoutPlan, price: '', per: '/mês', feats: [] as string[] };
        return (
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 overflow-y-auto"
            onClick={() => { setCheckoutPlan(null); setTrialCardMode(false); }}
          >
            <div className="min-h-full flex items-start justify-center py-8 px-4">
              <div
                className="w-full max-w-lg rounded-2xl p-6"
                style={{ background: 'rgb(var(--color-surface-elevated))', border: '1px solid rgba(var(--color-primary)/.3)' }}
                onClick={e => e.stopPropagation()}
              >
                <div className="mb-5">
                  <h3 className="font-bold text-base" style={{ color: 'rgb(var(--color-text))' }}>
                    {trialCardMode
                      ? 'Garanta seu Pro sem interrupção'
                      : currentPlan !== 'free' ? `Upgrade para ${plan.label}` : `Assinar plano ${plan.label}`}
                  </h3>
                  <p className="text-xs mt-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>
                    {trialCardMode
                      ? 'Nada é cobrado agora · 1ª cobrança só ao fim do teste · Cancele quando quiser'
                      : junePromo && checkoutPlan === 'pro'
                        ? '🔥 50% OFF no 1º mês: R$19,90 · depois R$39,90/mês'
                        : 'Escolha mensal ou anual · Cancele a qualquer momento'}
                  </p>
                </div>
                <CheckoutInline
                  planName={checkoutPlan as 'pro' | 'executive'}
                  planLabel={plan.label}
                  planPrice={trialCardMode ? plan.price : (junePromo && checkoutPlan === 'pro' ? 'R$19,90' : plan.price)}
                  planFeats={plan.feats}
                  isUpgrade={!trialCardMode && currentPlan !== 'free'}
                  trialMode={trialCardMode}
                  trialChargeDate={trialCardMode ? (stats?.trialEndsAt ?? undefined) : undefined}
                  onSuccess={handleCheckoutSuccess}
                  onCancel={() => { setCheckoutPlan(null); setTrialCardMode(false); }}
                />
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal de verificação de e-mail (gate da assinatura) */}
      {verifyModal && user && (
        <VerifyEmailModal email={user.email} onCancel={() => setVerifyModal(false)} />
      )}

      {/* Modal de CPF/CNPJ */}
      {docModal && (
        <DocumentModal
          planLabel={PLANS.find(p => p.name === docModal)?.label || docModal}
          onConfirm={handleDocumentConfirm}
          onCancel={() => setDocModal(null)}
        />
      )}

      {/* Modal de upgrade com proration */}
      {upgradePreview && (
        <UpgradeModal
          preview={upgradePreview}
          loading={!!checkoutPlan}
          onConfirm={doUpgrade}
          onCancel={() => setUpgradePreview(null)}
        />
      )}

      {/* Modal de cancelamento */}
      {cancelModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => !canceling && setCancelModal(false)}>
          <div className="card rounded-2xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="text-2xl mb-2">😔</div>
            <h3 className="font-display font-bold text-lg mb-1">Cancelar assinatura?</h3>
            <p className="text-sm font-light mb-4" style={{ color: 'rgb(var(--color-text-secondary))' }}>
              Você volta para o plano <strong>Free</strong> (15 áudios/mês). Continua com acesso até o fim do período já pago e pode reativar quando quiser — sem fidelidade.
            </p>
            {cancelError && (
              <p className="text-xs mb-3 px-3 py-2 rounded-lg" style={{ background: 'rgba(248,113,113,.1)', color: '#f87171' }}>
                {cancelError}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setCancelModal(false)}
                disabled={canceling}
                className="btn-primary flex-1 text-sm py-2.5 disabled:opacity-50">
                Manter meu plano
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={canceling}
                className="flex-1 text-sm py-2.5 rounded-xl font-medium transition-colors disabled:opacity-50"
                style={{ border: '1px solid rgb(var(--color-border))', color: 'rgb(var(--color-text-muted))' }}>
                {canceling ? 'Cancelando…' : 'Sim, cancelar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PlanoPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm pt-20">Carregando...</div>}>
      <PlanoContent />
    </Suspense>
  );
}
