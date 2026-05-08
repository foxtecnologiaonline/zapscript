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

/* ── Planos conforme o manifesto ── */
const PLANS = [
  {
    name:  'free',
    label: 'Grátis',
    price: 'R$0',
    per:   '/mês',
    desc:  'Para experimentar',
    feats: ['10 min/mês', '1 número WhatsApp', 'Painel simples', 'Resumos e transcrições'],
  },
  {
    name:  'pro',
    label: 'Pro',
    price: 'R$29,90',
    per:   '/mês',
    desc:  'Para profissionais',
    feats: ['200 min/mês', '2 números WhatsApp', 'Painel avançado', 'Resumos e transcrições', 'Alertas de consumo'],
    pop:   true,
  },
  {
    name:  'ultra',
    label: 'Ultra',
    price: 'R$59,90',
    per:   '/mês',
    desc:  'Para equipes',
    feats: ['500 min/mês', '3+ números WhatsApp', 'Painel avançado', 'Marcação de prioridade', 'Resumos e transcrições', 'Alertas de consumo', 'Suporte prioritário'],
  },
];

/* ── Métodos de pagamento disponíveis no Asaas ── */
const BILLING_TYPES = [
  { value: 'UNDEFINED',    label: '💳 Escolher na hora',    desc: 'PIX, cartão ou boleto' },
  { value: 'PIX',          label: '⚡ PIX',                 desc: 'R$0,80 por cobrança' },
  { value: 'CREDIT_CARD',  label: '💳 Cartão de crédito',  desc: '3,5% + R$0,60' },
  { value: 'BOLETO',       label: '📄 Boleto bancário',     desc: 'Vence em 3 dias úteis' },
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
  const [checkoutPlan, setCheckoutPlan] = useState<string | null>(null);
  const [billingType, setBillingType] = useState('UNDEFINED');
  const [docModal, setDocModal]       = useState<string | null>(null); // planName awaiting document
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
        { planName, billingType }
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
    // Se o usuário não tem CPF/CNPJ, solicitar antes do checkout
    if (!user?.document) {
      setDocModal(planName);
      return;
    }
    await doCheckout(planName);
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

      {/* Payment method selector */}
      {currentPlan === 'free' && (
        <div className="card rounded-2xl p-4 mb-5">
          <p className="text-xs font-semibold mb-3" style={{ color: 'rgb(var(--color-text-secondary))' }}>
            Forma de pagamento
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {BILLING_TYPES.map(bt => (
              <button key={bt.value} onClick={() => setBillingType(bt.value)}
                className="text-left p-3 rounded-xl border transition-all"
                style={{
                  borderColor: billingType === bt.value ? 'rgb(var(--color-primary))' : 'rgb(var(--color-border))',
                  background: billingType === bt.value ? 'rgba(var(--color-primary)/.08)' : 'transparent',
                }}>
                <div className="font-semibold text-xs">{bt.label}</div>
                <div className="text-xs font-light mt-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>{bt.desc}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Plans */}
      <h2 className="font-display font-bold text-base mb-4">
        {currentPlan === 'free' ? 'Fazer upgrade' : 'Mudar plano'}
      </h2>
      <div className="flex flex-col gap-4">
        {PLANS.map(plan => {
          const isCurrent = currentPlan === plan.name;
          return (
            <div key={plan.name} className="relative rounded-2xl p-5 border transition-all"
              style={{
                background:   plan.pop ? 'rgb(var(--color-surface-elevated))' : 'rgb(var(--color-surface))',
                borderColor:  plan.pop ? 'rgb(var(--color-primary))' : 'rgb(var(--color-border))',
                boxShadow:    plan.pop ? '0 0 0 1px rgba(var(--color-primary)/.2), var(--shadow-glow)' : 'var(--shadow-sm)',
              }}>
              {plan.pop && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-white text-[10px] font-black px-3 py-0.5 rounded-full uppercase tracking-wider"
                  style={{ background: 'rgb(var(--color-primary))' }}>
                  Mais popular
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
                  <span className="font-display font-bold text-2xl tracking-tight"
                    style={{ color: plan.pop ? 'rgb(var(--color-primary))' : 'rgb(var(--color-text))' }}>
                    {plan.price}
                  </span>
                  <span className="text-xs font-light ml-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>{plan.per}</span>
                </div>
              </div>

              <ul className="space-y-1.5 mb-4">
                {plan.feats.map(f => (
                  <li key={f} className="flex items-center gap-2 text-xs" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                    <span style={{ color: 'rgb(var(--color-primary))' }}>✓</span>{f}
                  </li>
                ))}
              </ul>

              <button
                disabled={isCurrent || plan.name === 'free' || checkoutPlan === plan.name}
                onClick={() => upgrade(plan.name)}
                className="w-full py-2.5 rounded-xl text-sm font-bold transition-all"
                style={{
                  background:   isCurrent || plan.name === 'free'
                    ? 'rgba(var(--color-surface-elevated))'
                    : plan.pop
                    ? 'rgb(var(--color-primary))'
                    : 'transparent',
                  color:        isCurrent || plan.name === 'free'
                    ? 'rgb(var(--color-text-muted))'
                    : plan.pop
                    ? '#030d06'
                    : 'rgb(var(--color-primary))',
                  border:       plan.pop ? 'none' : '1.5px solid rgb(var(--color-border))',
                  cursor:       isCurrent || plan.name === 'free' ? 'not-allowed' : 'pointer',
                  boxShadow:    plan.pop && !isCurrent ? 'rgba(var(--color-primary)/.25) 0 4px 14px' : 'none',
                }}
              >
                {isCurrent          ? 'Plano atual'       :
                 plan.name === 'free' ? 'Gratuito'          :
                 checkoutPlan === plan.name ? 'Redirecionando...' :
                 'Assinar agora'}
              </button>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-center mt-5" style={{ color: 'rgb(var(--color-text-muted))' }}>
        Pagamentos processados com segurança pelo Asaas. Cancele a qualquer momento.
      </p>

      {/* Modal de CPF/CNPJ */}
      {docModal && (
        <DocumentModal
          planLabel={PLANS.find(p => p.name === docModal)?.label || docModal}
          onConfirm={handleDocumentConfirm}
          onCancel={() => setDocModal(null)}
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
