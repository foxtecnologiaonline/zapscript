'use client';
import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import CheckoutInline from '@/components/CheckoutInline';

interface Stats {
  minutesUsed: number; minutesAvailable: number;
  minutesTotal: number; minutesPct: number;
  planName: string;   // slug: 'free' | 'pro' | 'ultra' | 'executive'
  planLabel: string;  // exibível: 'Grátis' | 'Pro' | 'Ultra' | 'Executive'
  planStatus: string;
}

interface User {
  id: string;
  name: string | null;
  email: string;
  document: string | null;
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
      '20 min/mês',
      '1 número WhatsApp',
      '🎙️ Transcrição automática',
      '🖥️ Transcrição de áudios no site',
      '✨ Resumo com IA',
    ],
    excl:  [
      '📋 Histórico de transcrições',
      '📅 Filtros por data e contato',
      '🔍 Busca por transcrição',
    ],
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
      '100 min/mês',
      '2 números WhatsApp',
      '🎙️ Transcrição automática',
      '🖥️ Transcrição de áudios no site',
      '✨ Resumo com IA',
      '📋 Histórico de transcrições',
      '📅 Filtros por data e contato',
      '🔍 Busca por transcrição',
    ],
    excl:  [],
    pop:   false,
    accent: '#3b82f6' as string | null,
  },
  {
    name:  'executive',
    label: 'Executive',
    price: 'R$69,90',
    per:   '/mês',
    desc:  'Para uso profissional e privacidade total',
    feats: [
      '500 min/mês',
      '3 números WhatsApp',
      '🎙️ Transcrição automática',
      '🖥️ Transcrição de áudios no site',
      '✨ Resumo com IA',
      '📋 Histórico de transcrições',
      '📅 Filtros por data e contato',
      '🔍 Busca por transcrição',
      '📤 Exportação PDF · DOCX · CSV · XLS',
      '🎤 Notas Pessoais de Voz',
      '🔒 Modo Privado de transcrição',
    ],
    excl:  [],
    pop:   true,
    accent: null as string | null,
  },
];

type CmpVal = string | boolean;
const TABLE_ROWS: { feature: string; vals: CmpVal[] }[] = [
  { feature: 'Minutos/mês',                        vals: ['20', '100', '500'] },
  { feature: 'Números WhatsApp',                   vals: ['1', '2', '3'] },
  { feature: '🎙️ Transcrição automática',           vals: [true, true, true] },
  { feature: '🖥️ Transcrição no site (upload)',     vals: [true, true, true] },
  { feature: '✨ Resumo com IA',                    vals: [true, true, true] },
  { feature: '📋 Histórico de transcrições',        vals: [false, true, true] },
  { feature: '📅 Filtros por data e contato',       vals: [false, true, true] },
  { feature: '🔍 Busca por transcrição',             vals: [false, true, true] },
  { feature: '📤 Exportação PDF/DOCX/CSV/XLS',      vals: [false, false, true] },
  { feature: '🎤 Notas Pessoais de Voz',             vals: [false, false, true] },
  { feature: '🔒 Modo Privado de transcrição',       vals: [false, false, true] },
];

// Billing type sempre UNDEFINED — Asaas oferece as opções ao usuário na página de pagamento

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

function PlanoContent() {
  const searchParams = useSearchParams();
  const [stats, setStats]             = useState<Stats | null>(null);
  const [user, setUser]               = useState<User | null>(null);
  const [loading, setLoading]         = useState(true);
  const [checkoutPlan, setCheckoutPlan]     = useState<string | null>(null);  // plano com checkout inline aberto
  const [docModal, setDocModal]             = useState<string | null>(null);
  const [showTable, setShowTable]           = useState(false);
  const [upgradePreview, setUpgradePreview] = useState<UpgradePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [invoices, setInvoices]               = useState<any[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const justUpgraded = searchParams.get('upgrade') === 'success';

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
      api.get<{ invoices: any[] }>('/billing/invoices')
        .then(r => setInvoices(r.invoices || []))
        .catch(() => null)
        .finally(() => setInvoicesLoading(false));
    }).finally(() => setLoading(false));

    if (justUpgraded) {
      // Chama sync para garantir ativação mesmo se webhook não chegou
      api.get('/billing/sync').catch(() => null).finally(doLoad);
    } else {
      doLoad();
    }
  }, []);

  // Abre o checkout inline para o plano
  function doCheckout(planName: string) {
    setCheckoutPlan(planName);
    setUpgradePreview(null);
  }

  async function upgrade(planName: string) {
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

  // planName já vem como slug ('free'|'pro'|'ultra'|'executive') — sem precisar de toLowerCase
  const currentPlan = stats?.planName || 'free';
  const PLAN_ORDER: Record<string, number> = { free: 0, pro: 1, ultra: 2, executive: 3 };
  const currentPlanOrder = PLAN_ORDER[currentPlan] ?? 0;
  const displayedPlans = PLANS; // Free · Pro · Executive — sempre visíveis

  return (
    <div className="p-4 sm:p-8 max-w-3xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold">Plano & Cobrança</h1>
        <p className="text-sm font-light mt-0.5" style={{ color: 'rgb(var(--color-text-secondary))' }}>
          Gerencie seu plano e uso de minutos
        </p>
      </div>

      {/* Upgrade success banner */}
      {justUpgraded && (
        <div className="rounded-xl px-5 py-3.5 mb-5 flex items-center gap-3"
          style={{ background: 'rgba(var(--color-primary)/.1)', border: '1px solid rgba(var(--color-primary)/.3)' }}>
          <span className="text-xl">🎉</span>
          <div>
            <div className="font-bold text-sm" style={{ color: 'rgb(var(--color-primary))' }}>Upgrade realizado com sucesso!</div>
            <div className="text-xs font-light" style={{ color: 'rgb(var(--color-text-secondary))' }}>Seus minutos foram atualizados.</div>
          </div>
        </div>
      )}

      {/* Current usage */}
      {stats && (
        <div className="card rounded-2xl p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
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

          <div className="flex justify-between text-xs mb-2" style={{ color: 'rgb(var(--color-text-secondary))' }}>
            <span>Minutos usados este mês</span>
            <span className="font-bold" style={{ color: 'rgb(var(--color-primary))' }}>
              {stats.minutesUsed} / {stats.minutesTotal} min
            </span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden mb-1" style={{ background: 'rgb(var(--color-surface-elevated))' }}>
            <div className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(stats.minutesPct, 100)}%`,
                background: 'linear-gradient(90deg, rgb(var(--color-primary-light)), rgb(var(--color-primary)))',
              }} />
          </div>
          <div className="flex justify-between text-xs" style={{ color: 'rgb(var(--color-text-muted))' }}>
            <span>{stats.minutesPct}% utilizado</span>
            <span>{stats.minutesAvailable.toFixed(1)} min restantes</span>
          </div>

        </div>
      )}

      {/* ── Planos ── */}
      <h2 className="font-display font-bold text-base mb-4">
        {currentPlan === 'free' ? 'Fazer upgrade' : 'Mudar plano'}
      </h2>

      <div className="flex flex-col gap-4">
        {displayedPlans.map(plan => {
          const isCurrent    = currentPlan === plan.name;
          const planOrder    = PLAN_ORDER[plan.name] ?? 0;
          const isInferior   = planOrder < currentPlanOrder;
          const isFree       = plan.name === 'free';
          const isDisabled   = isCurrent || isInferior || isFree;
          const borderCol    = plan.pop
            ? 'rgb(var(--color-primary))'
            : isCurrent
            ? 'rgba(var(--color-primary)/.4)'
            : isInferior ? 'rgba(var(--color-border)/.3)'
            : plan.accent ? plan.accent + '55' : 'rgb(var(--color-border))';
          const priceCol = isInferior
            ? 'rgb(var(--color-text-muted))'
            : plan.pop
            ? 'rgb(var(--color-primary))'
            : plan.accent || 'rgb(var(--color-text))';

          return (
            <div key={plan.name} className={`relative rounded-2xl p-5 border transition-all ${isInferior ? 'opacity-50' : ''}`}
              style={{
                background:  plan.pop && !isInferior ? 'rgb(var(--color-surface-elevated))' : 'rgb(var(--color-surface))',
                borderColor: borderCol,
                boxShadow:   plan.pop && !isInferior ? '0 0 0 1px rgba(var(--color-primary)/.2), var(--shadow-glow)' : 'var(--shadow-sm)',
              }}>
              {plan.pop && !isInferior && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-white text-[10px] font-black px-3 py-0.5 rounded-full uppercase tracking-wider"
                  style={{ background: 'rgb(var(--color-primary))' }}>
                  ⭐ Mais popular
                </span>
              )}
              {isCurrent && (
                <span className="absolute -top-3 right-4 text-[10px] font-bold px-3 py-0.5 rounded-full"
                  style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgba(var(--color-primary)/.4)', color: 'rgb(var(--color-primary))' }}>
                  Plano atual
                </span>
              )}

              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="font-display font-bold text-base">{plan.label}</div>
                  <div className="text-xs font-light mt-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>{plan.desc}</div>
                </div>
                <div className="text-right">
                  <span className="font-display font-bold text-2xl tracking-tight" style={{ color: priceCol }}>
                    {plan.price}
                  </span>
                  <span className="text-xs font-light ml-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>{plan.per}</span>
                </div>
              </div>

              <ul className="space-y-1.5 mb-1">
                {plan.feats.map(f => (
                  <li key={f} className="flex items-center gap-2 text-xs" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                    <span style={{ color: plan.pop && !isInferior ? 'rgb(var(--color-primary))' : plan.accent || 'rgb(var(--color-primary))' }}>✓</span>{f}
                  </li>
                ))}
                {plan.excl.map(f => (
                  <li key={f} className="flex items-center gap-2 text-xs" style={{ color: 'rgb(var(--color-text-muted))', opacity: .35 }}>
                    <span>✗</span>{f}
                  </li>
                ))}
              </ul>

              <button
                disabled={isDisabled || previewLoading}
                onClick={!isDisabled ? () => upgrade(plan.name) : undefined}
                className="w-full mt-4 py-2.5 rounded-xl text-sm font-bold transition-all"
                style={{
                  background: isDisabled
                    ? 'rgba(var(--color-surface-elevated))'
                    : plan.pop ? 'rgb(var(--color-primary))'
                    : plan.accent || 'transparent',
                  color: isDisabled
                    ? 'rgb(var(--color-text-muted))'
                    : plan.pop ? '#030d06'
                    : plan.accent ? '#fff' : 'rgb(var(--color-primary))',
                  border: (plan.pop || plan.accent) && !isDisabled ? 'none' : '1.5px solid rgb(var(--color-border))',
                  cursor: isDisabled ? 'not-allowed' : 'pointer',
                  boxShadow: plan.pop && !isDisabled ? 'rgba(var(--color-primary)/.25) 0 4px 14px' : 'none',
                  opacity: isDisabled && !isCurrent && !isInferior ? 0.7 : 1,
                }}>
                {isCurrent         ? 'Plano atual' :
                 isFree            ? 'Gratuito' :
                 isInferior        ? 'Plano inferior' :
                 previewLoading    ? 'Calculando...' :
                 currentPlan !== 'free' ? '↑ Fazer upgrade' :
                 'Assinar agora'}
              </button>
            </div>
          );
        })}
      </div>

      {/* Toggle comparativo */}
      <button
        onClick={() => setShowTable(v => !v)}
        className="w-full mt-4 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-2"
        style={{ border: '1.5px solid rgb(var(--color-border))', color: 'rgb(var(--color-text-muted))', background: 'transparent' }}>
        {showTable ? 'Ocultar comparativo ↑' : 'Comparar todos os recursos ↓'}
      </button>

      {showTable && (
        <div className="mt-3 rounded-2xl overflow-hidden" style={{ border: '1px solid rgb(var(--color-border))' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[380px]" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'rgb(var(--color-surface-elevated))' }}>
                  <th className="text-left px-4 py-2.5 font-semibold" style={{ color: 'rgb(var(--color-text-muted))' }}>Recurso</th>
                  {displayedPlans.map(p => (
                    <th key={p.name} className="px-2 py-2.5 font-bold text-center"
                      style={{ color: p.pop ? 'rgb(var(--color-primary))' : p.accent || 'rgb(var(--color-text-secondary))' }}>
                      {p.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TABLE_ROWS.map((row, ri) => (
                  <tr key={ri} style={{ borderTop: '1px solid rgb(var(--color-border-light))' }}>
                    <td className="px-4 py-2.5 font-medium" style={{ color: 'rgb(var(--color-text-secondary))' }}>{row.feature}</td>
                    {row.vals.slice(0, displayedPlans.length).map((v, vi) => (
                      <td key={vi} className="px-2 py-2.5 text-center">
                        {typeof v === 'boolean' ? (
                          v ? <span style={{ color: 'rgb(var(--color-primary))' }}>✓</span>
                            : <span style={{ color: 'rgb(var(--color-text-muted))', opacity: .4 }}>✗</span>
                        ) : (
                          <span className="font-mono font-bold" style={{ color: 'rgb(var(--color-text))' }}>{v}</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-xs text-center mt-4" style={{ color: 'rgb(var(--color-text-muted))' }}>
        Pagamentos processados com segurança pela Asaas. Cancele a qualquer momento.
      </p>

      {/* ── Faturas / Histórico de pagamentos ── */}
      {currentPlan !== 'free' && (
        <div className="mt-8">
          <h2 className="font-display font-bold text-base mb-4">Histórico de Pagamentos</h2>
          <div className="card rounded-2xl overflow-hidden">
            {invoicesLoading ? (
              <div className="py-8 text-center text-sm text-brand-muted">Carregando faturas…</div>
            ) : invoices.length === 0 ? (
              <div className="py-8 text-center text-sm text-brand-muted">
                Nenhuma fatura encontrada. Os pagamentos aparecerão aqui após confirmação.
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
                  };
                  const st = statusMap[inv.status] || { label: inv.statusLabel || inv.status, color: inv.statusColor || 'text-brand-muted' };
                  const date = inv.paymentDate || inv.dueDate;
                  const dateStr = date
                    ? new Date(date + 'T12:00:00').toLocaleDateString('pt-BR')
                    : '—';
                  const brl = (v: number) => v?.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                  return (
                    <div key={inv.id} className="flex items-center justify-between px-5 py-3.5 gap-4">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-brand-text truncate">
                          {inv.description || 'Assinatura ZapScript'}
                        </div>
                        <div className="text-xs text-brand-muted mt-0.5">{dateStr}</div>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span className={`text-xs font-semibold ${st.color}`}>{st.label}</span>
                        <span className="text-sm font-bold" style={{ color: 'rgb(var(--color-text))' }}>
                          {brl(inv.value)}
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

      {/* Em breve */}
      <div className="mt-8 rounded-2xl p-5" style={{ background: 'rgb(var(--color-surface-elevated))', border: '1px solid rgba(16,185,129,.15)' }}>
        <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full text-[11px] font-bold mb-4"
          style={{ background: 'rgba(16,185,129,.08)', color: 'rgb(var(--color-primary))', border: '1px solid rgba(16,185,129,.2)' }}>
          🚀 EM BREVE
        </div>
        <h3 className="font-display font-bold text-base leading-snug mb-1">
          Integrações chegando em breve
        </h3>
        <p className="text-xs font-light mb-4" style={{ color: 'rgb(var(--color-text-secondary))' }}>
          Conecte o ZapScript às ferramentas que você já usa no dia a dia.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { icon: '📅', label: 'Integração com Planner' },
            { icon: '🗓️', label: 'Integração com Calendário' },
            { icon: '🔗', label: 'Integração com ERP/CRM' },
          ].map((f, i) => (
            <div key={i} className="flex items-center gap-2 text-xs rounded-xl px-3 py-2.5"
              style={{ background: 'rgb(var(--color-surface))', color: 'rgb(var(--color-text-muted))' }}>
              <span>{f.icon}</span>
              <span>{f.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Checkout inline Asaas ── */}
      {checkoutPlan && checkoutPlan !== 'free' && (() => {
        const plan = PLANS.find(p => p.name === checkoutPlan) ?? { label: checkoutPlan, price: '', feats: [] as string[] };
        return (
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 overflow-y-auto"
            onClick={() => setCheckoutPlan(null)}
          >
            <div className="min-h-full flex items-start justify-center py-8 px-4">
              <div
                className="w-full max-w-lg rounded-2xl p-6"
                style={{ background: 'rgb(var(--color-surface-elevated))', border: '1px solid rgba(var(--color-primary)/.3)' }}
                onClick={e => e.stopPropagation()}
              >
                <div className="mb-5">
                  <h3 className="font-bold text-base" style={{ color: 'rgb(var(--color-text))' }}>
                    {currentPlan !== 'free' ? `Upgrade para ${plan.label}` : `Assinar plano ${plan.label}`}
                  </h3>
                  <p className="text-xs mt-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>
                    {plan.price}/mês · Cancele a qualquer momento
                  </p>
                </div>
                <CheckoutInline
                  planName={checkoutPlan as 'pro' | 'ultra' | 'executive'}
                  planLabel={plan.label}
                  planPrice={plan.price}
                  planFeats={plan.feats}
                  isUpgrade={currentPlan !== 'free'}
                  onSuccess={handleCheckoutSuccess}
                  onCancel={() => setCheckoutPlan(null)}
                />
              </div>
            </div>
          </div>
        );
      })()}

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
