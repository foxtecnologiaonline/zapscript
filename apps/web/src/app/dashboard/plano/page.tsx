'use client';
import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';

interface Stats {
  minutesUsed: number; minutesAvailable: number;
  minutesTotal: number; minutesPct: number;
  planName: string; planStatus: string;
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
      '✨ Resumo com pontos-chave IA',
      '📤 Exportar PDF · DOCX · CSV · XLS',
      '📅 Filtros por data e contato',
      '📋 Histórico de transcrições',
    ],
    excl:  ['🔍 Busca full-text', '🏷️ Tags & IA Documentos', '🌐 Tradução automática', '🔒 Modo privado & Webhook'],
    pop:   false,
    accent: null as string | null,
  },
  {
    name:  'pro',
    label: 'Pro',
    price: 'R$29,90',
    per:   '/mês',
    desc:  'Para profissionais',
    feats: [
      '150 min/mês',
      '2 números WhatsApp',
      '🔍 Busca full-text no histórico',
      '🏷️ Tags & Categorias',
      '💬 Respostas sugeridas por IA',
      '📝 Gerar ata · briefing · e-mail com IA',
      '📤 Exportação em múltiplos formatos',
    ],
    excl:  ['🌐 Tradução automática dos resumos', '🗣️ Filtro por idioma', '🔗 Webhook & Modo privado'],
    pop:   false,
    accent: '#3b82f6' as string | null,
  },
  {
    name:  'ultra',
    label: 'Ultra',
    price: 'R$59,90',
    per:   '/mês',
    desc:  'Para profissionais avançados',
    feats: [
      '300 min/mês',
      '3 números WhatsApp',
      '🌐 Tradução automática dos resumos',
      '🗣️ Filtro por idioma de transcrição',
      '🎙️ Notas pessoais de voz',
      '🔍 Busca full-text + todos os filtros',
      '🏷️ Tags · IA Docs · Respostas (Pro incluído)',
    ],
    excl:  ['🔗 Webhook personalizado', '🔒 Modo privado'],
    pop:   true,
    accent: null as string | null,
  },
  {
    name:  'executive',
    label: 'Executive',
    price: 'R$89,90',
    per:   '/mês',
    desc:  'Para líderes e executivos',
    feats: [
      '500 min/mês',
      '5 números WhatsApp',
      '🔗 Webhook personalizado com assinatura HMAC',
      '🔒 Modo privado (transcrição só para você)',
      '🌐 Multi-idioma completo',
      '🏷️ Tags · IA Docs · Respostas',
      '⭐ Tudo do Ultra incluído',
    ],
    excl:  [],
    pop:   false,
    accent: '#f59e0b' as string | null,
  },
];

type CmpVal = string | boolean;
const TABLE_ROWS: { feature: string; vals: CmpVal[] }[] = [
  { feature: 'Minutos/mês',                       vals: ['20', '150', '300', '500'] },
  { feature: 'Números WhatsApp',                   vals: ['1', '2', '3', '5'] },
  { feature: '🎙️ Transcrição automática',          vals: [true, true, true, true] },
  { feature: '✨ Resumo pontos-chave IA',           vals: [true, true, true, true] },
  { feature: '📤 Exportar PDF · DOCX · CSV · XLS', vals: [true, true, true, true] },
  { feature: '🔍 Busca full-text',                 vals: [false, true, true, true] },
  { feature: '🏷️ Tags & Categorias',              vals: [false, true, true, true] },
  { feature: '💬 Respostas sugeridas por IA',      vals: [false, true, true, true] },
  { feature: '📝 Gerar documentos com IA',         vals: [false, true, true, true] },
  { feature: '🌐 Tradução automática',             vals: [false, false, true, true] },
  { feature: '🗣️ Filtro por idioma',              vals: [false, false, true, true] },
  { feature: '🔗 Webhook personalizado',           vals: [false, false, false, true] },
  { feature: '🔒 Modo privado',                    vals: [false, false, false, true] },
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
  // Apenas features exclusivas do plano destino (não herdadas dos anteriores)
  const newFeats = (targetPlan?.feats ?? []).slice(2, 5); // pula minutos/números, pega até 3 diferenciais

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
  const [checkoutPlan, setCheckoutPlan]     = useState<string | null>(null);
  const [docModal, setDocModal]             = useState<string | null>(null);
  const [showTable, setShowTable]           = useState(false);
  const [upgradePreview, setUpgradePreview] = useState<UpgradePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [empresasForm, setEmpresasForm] = useState({ whatsappNumbers: '', audiosPerMonth: '', integrations: '', email: '' });
  const [empresasLoading, setEmpresasLoading] = useState(false);
  const [empresasSent, setEmpresasSent]       = useState(false);
  const [empresasErr, setEmpresasErr]         = useState('');
  const justUpgraded = searchParams.get('upgrade') === 'success';

  useEffect(() => {
    Promise.all([
      api.get<Stats>('/dashboard/stats'),
      api.get<User>('/auth/me'),
    ]).then(([s, u]) => {
      setStats(s);
      setUser(u);
    }).finally(() => setLoading(false));
  }, []);

  async function doCheckout(planName: string) {
    setCheckoutPlan(planName);
    try {
      const res = await api.post<{ url: string; subscriptionId: string }>(
        '/billing/checkout',
        { planName, billingType: 'UNDEFINED' }
      );
      if (res.url) {
        window.location.href = res.url;
      } else {
        alert('Não foi possível abrir o checkout. Tente novamente.');
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setCheckoutPlan(null);
    }
  }

  async function upgrade(planName: string) {
    if (!user?.document) {
      setDocModal(planName);
      return;
    }
    // Usuário já em plano pago → mostrar simulação de proration
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
    await doCheckout(planName);
  }

  async function doUpgrade() {
    if (!upgradePreview) return;
    const planName = upgradePreview.targetPlanName;
    setCheckoutPlan(planName);
    try {
      const res = await api.post<any>('/billing/upgrade', { targetPlan: planName, billingType: 'UNDEFINED' });
      if (res.switched) {
        window.location.href = '/dashboard/plano?upgrade=success';
        return;
      }
      if (res.url) {
        window.location.href = res.url;
      } else {
        alert('Não foi possível abrir o checkout. Tente novamente.');
      }
    } catch (err: any) {
      alert(err.message || 'Erro ao processar upgrade.');
    } finally {
      setCheckoutPlan(null);
      setUpgradePreview(null);
    }
  }

  async function handleDocumentConfirm(document: string) {
    // Salvar CPF/CNPJ e prosseguir para checkout
    await api.put('/auth/profile', { document });
    setUser(u => u ? { ...u, document: document.replace(/\D/g, '') } : u);
    const plan = docModal!;
    setDocModal(null);
    await doCheckout(plan);
  }

  async function openPortal() {
    try {
      const res = await api.get<{ url: string }>('/billing/portal');
      if (res.url) window.location.href = res.url;
    } catch (err: any) {
      alert(err.message);
    }
  }

  async function handleEmpresasSubmit(e: React.FormEvent) {
    e.preventDefault();
    setEmpresasLoading(true);
    setEmpresasErr('');
    try {
      const res = await api.post<{ ok: boolean }>('/support/enterprise-contact', empresasForm);
      if (res.ok) setEmpresasSent(true);
    } catch (err: any) {
      setEmpresasErr(err.message || 'Erro ao enviar. Tente novamente.');
    } finally {
      setEmpresasLoading(false);
    }
  }

  if (loading) return (
    <div className="p-8 text-center text-brand-muted text-sm pt-20">Carregando...</div>
  );

  const currentPlan = stats?.planName?.toLowerCase() || 'free';

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
              <span className="font-bold" style={{ color: 'rgb(var(--color-primary))' }}>{stats.planName}</span>
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

          {currentPlan !== 'free' && (
            <button onClick={openPortal}
              className="text-xs mt-4 w-full py-2 rounded-xl transition-all"
              style={{ background: 'rgba(var(--color-surface-elevated))', border: '1px solid rgb(var(--color-border))', color: 'rgb(var(--color-text-secondary))' }}>
              ⚙️ Gerenciar assinatura (cancelar / trocar cartão)
            </button>
          )}
        </div>
      )}

      {/* Nota: forma de pagamento (PIX, cartão, boleto) é escolhida na página segura da Asaas */}

      {/* ── Planos — Opção 3 Híbrido ── */}
      <h2 className="font-display font-bold text-base mb-4">
        {currentPlan === 'free' ? 'Fazer upgrade' : 'Mudar plano'}
      </h2>

      <div className="flex flex-col gap-4">
        {PLANS.map(plan => {
          const isCurrent  = currentPlan === plan.name;
          const borderCol  = plan.pop
            ? 'rgb(var(--color-primary))'
            : isCurrent
            ? 'rgba(var(--color-primary)/.4)'
            : plan.accent ? plan.accent + '55' : 'rgb(var(--color-border))';
          const priceCol = plan.pop
            ? 'rgb(var(--color-primary))'
            : plan.accent || 'rgb(var(--color-text))';

          return (
            <div key={plan.name} className="relative rounded-2xl p-5 border transition-all"
              style={{
                background:  plan.pop ? 'rgb(var(--color-surface-elevated))' : 'rgb(var(--color-surface))',
                borderColor: borderCol,
                boxShadow:   plan.pop ? '0 0 0 1px rgba(var(--color-primary)/.2), var(--shadow-glow)' : 'var(--shadow-sm)',
              }}>
              {plan.pop && (
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
                    <span style={{ color: plan.pop ? 'rgb(var(--color-primary))' : plan.accent || 'rgb(var(--color-primary))' }}>✓</span>{f}
                  </li>
                ))}
                {plan.excl.map(f => (
                  <li key={f} className="flex items-center gap-2 text-xs" style={{ color: 'rgb(var(--color-text-muted))', opacity: .35 }}>
                    <span>✗</span>{f}
                  </li>
                ))}
              </ul>

              <button
                disabled={isCurrent || plan.name === 'free' || checkoutPlan === plan.name || previewLoading}
                onClick={() => upgrade(plan.name)}
                className="w-full mt-4 py-2.5 rounded-xl text-sm font-bold transition-all"
                style={{
                  background: isCurrent || plan.name === 'free'
                    ? 'rgba(var(--color-surface-elevated))'
                    : plan.pop ? 'rgb(var(--color-primary))'
                    : plan.accent || 'transparent',
                  color: isCurrent || plan.name === 'free'
                    ? 'rgb(var(--color-text-muted))'
                    : plan.pop ? '#030d06'
                    : plan.accent ? '#fff' : 'rgb(var(--color-primary))',
                  border: plan.pop || plan.accent ? 'none' : '1.5px solid rgb(var(--color-border))',
                  cursor: isCurrent || plan.name === 'free' ? 'not-allowed' : 'pointer',
                  boxShadow: plan.pop && !isCurrent ? 'rgba(var(--color-primary)/.25) 0 4px 14px' : 'none',
                }}>
                {isCurrent         ? 'Plano atual' :
                 plan.name === 'free' ? 'Gratuito' :
                 checkoutPlan === plan.name || (previewLoading) ? 'Calculando...' :
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
                  {PLANS.map(p => (
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
                    {row.vals.map((v, vi) => (
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
        Pagamentos processados com segurança pelo Asaas. Cancele a qualquer momento.
      </p>

      {/* Para Empresas */}
      <div className="mt-8 rounded-2xl p-5" style={{ background: 'rgb(var(--color-surface-elevated))', border: '1px solid rgba(245,158,11,.25)' }}>
        <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full text-[11px] font-bold mb-4"
          style={{ background: 'rgba(245,158,11,.1)', color: '#f59e0b', border: '1px solid rgba(245,158,11,.2)' }}>
          🏢 PARA EMPRESAS
        </div>
        <h3 className="font-display font-bold text-lg leading-snug mb-1">
          Precisa de mais? Monte seu plano.
        </h3>
        <p className="text-xs font-light mb-3" style={{ color: 'rgb(var(--color-text-secondary))' }}>
          Times maiores, volumes customizados, integrações específicas — propomos algo no tamanho certo.
        </p>
        <div className="flex flex-col gap-1.5 mb-5 text-xs">
          {['Múltiplos Usuários', 'Múltiplos Números', 'Volume Ajustável de Minutos', 'Integrações customizadas (CRM, ERP, Outlook, Google Calendar)'].map((f, i) => (
            <div key={i} className="flex items-center gap-2" style={{ color: 'rgb(var(--color-text-secondary))' }}>
              <span style={{ color: '#f59e0b' }}>✓</span> {f}
            </div>
          ))}
        </div>

        {empresasSent ? (
          <div className="rounded-xl py-6 text-center" style={{ background: 'rgba(16,185,129,.05)', border: '1px solid rgba(16,185,129,.15)' }}>
            <div className="text-2xl mb-1">✅</div>
            <div className="font-bold text-sm" style={{ color: 'rgb(var(--color-primary))' }}>Proposta solicitada!</div>
            <div className="text-xs mt-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>Respondemos em até 24h</div>
          </div>
        ) : (
          <form onSubmit={handleEmpresasSubmit} className="flex flex-col gap-3">
            {([
              { key: 'whatsappNumbers', label: 'Números de WhatsApp', placeholder: 'Quantos números você precisa?', type: 'text' },
              { key: 'audiosPerMonth',  label: 'Recebe em média quantos áudios por mês?', placeholder: 'Ex: 500 áudios por mês', type: 'text' },
              { key: 'integrations',   label: 'Precisa de integração com algum sistema?', placeholder: 'Ex: Google Calendar, Salesforce, ERP...', type: 'text' },
              { key: 'email',          label: 'E-mail corporativo', placeholder: 'voce@empresa.com.br', type: 'email' },
            ] as { key: keyof typeof empresasForm; label: string; placeholder: string; type: string }[]).map(field => (
              <div key={field.key}>
                <label className="block text-xs font-semibold mb-1" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                  {field.label}
                </label>
                <input
                  type={field.type}
                  placeholder={field.placeholder}
                  value={empresasForm[field.key]}
                  onChange={e => setEmpresasForm(f => ({ ...f, [field.key]: e.target.value }))}
                  className="field-input text-sm"
                  required={field.key === 'email'}
                />
              </div>
            ))}
            {empresasErr && (
              <p className="text-xs px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,.1)', color: '#f87171' }}>{empresasErr}</p>
            )}
            <button type="submit" disabled={empresasLoading}
              className="w-full py-2.5 rounded-xl font-bold text-sm transition-all disabled:opacity-60 mt-1"
              style={{ background: '#f59e0b', color: '#1c1204' }}>
              {empresasLoading ? 'Enviando...' : 'Receber proposta comercial →'}
            </button>
            <p className="text-center text-[11px]" style={{ color: 'rgb(var(--color-text-muted))' }}>
              Respondemos em até 24h · Sem compromisso
            </p>
          </form>
        )}
      </div>

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
