'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

const PAYOUT_MIN = 50;

/* ─────────────────────────────────────────────────────────
   Painel do Afiliado — EXCLUSIVO de afiliados aprovados.
   A solicitação do código fica em Configurações; quem não tem a
   marcação aprovada é redirecionado pra lá. Pagamento via Pix manual.
   ───────────────────────────────────────────────────────── */

interface Affiliate {
  id: string;
  code: string;
  status: 'pending' | 'approved' | 'rejected' | 'suspended';
  commissionType: 'onetime' | 'recurring';
  pixKey: string | null;
  pixKeyType: string | null;
  payoutName: string | null;
  rejectedReason: string | null;
  appliedAt: string;
  approvedAt: string | null;
}
interface Stats {
  referrals: number; converted: number; totalCommissions: number;
  pendingAmount: number; paidAmount: number;
}
interface Rates { monthlyRate: number; yearlyRate: number; payoutDays: number[]; }
interface Commission {
  id: string; saleAmount: number; commissionAmount: number;
  commissionType: string; monthIndex: number;
  status: 'pending' | 'paid' | 'canceled';
  paidAt: string | null; createdAt: string;
}

const PIX_TYPES = [
  { v: 'cpf',    l: 'CPF' },
  { v: 'cnpj',   l: 'CNPJ' },
  { v: 'email',  l: 'E-mail' },
  { v: 'phone',  l: 'Celular' },
  { v: 'random', l: 'Chave aleatória' },
];

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = (s: string) => new Date(s).toLocaleDateString('pt-BR');

export default function AfiliadoPage() {
  const router = useRouter();
  const [loading, setLoading]         = useState(true);
  const [affiliate, setAffiliate]     = useState<Affiliate | null>(null);
  const [stats, setStats]             = useState<Stats | null>(null);
  const [rates, setRates]             = useState<Rates | null>(null);
  const [commissions, setCommissions] = useState<Commission[]>([]);

  async function load() {
    try {
      const data = await api.get<{ affiliate: Affiliate | null; stats?: Stats; rates?: Rates }>('/affiliates/me');
      // Página exclusiva de aprovados — demais voltam para Configurações (onde solicitam/acompanham).
      if (data.affiliate?.status !== 'approved') {
        router.replace('/dashboard/configuracoes');
        return;
      }
      setAffiliate(data.affiliate);
      setStats(data.stats || null);
      setRates(data.rates || null);
      try {
        const c = await api.get<{ commissions: Commission[] }>('/affiliates/commissions');
        setCommissions(c.commissions || []);
      } catch { /* sem comissões ainda */ }
    } catch {
      /* não autenticado tratado pelo layout */
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  if (loading || !affiliate) {
    return (
      <div className="p-6 sm:p-8">
        <div className="text-brand-primary text-sm animate-pulse">Carregando...</div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-brand-text flex items-center gap-2">
          <span>🤝</span> Programa de Afiliados
        </h1>
        <p className="text-sm text-brand-muted mt-1">
          Compartilhe seu link e ganhe comissão sobre cada assinatura paga.
        </p>
      </div>

      <ApprovedPanel
        affiliate={affiliate} stats={stats} rates={rates}
        commissions={commissions} onUpdated={load}
      />
    </div>
  );
}

/* ── Painel do afiliado aprovado ── */
function ApprovedPanel({ affiliate, stats, rates, commissions, onUpdated }: {
  affiliate: Affiliate; stats: Stats | null; rates: Rates | null;
  commissions: Commission[]; onUpdated: () => void;
}) {
  const [copied, setCopied]           = useState(false);
  const [kitMsg, setKitMsg]           = useState<string | null>(null);
  const [payoutLoading, setPayoutLoading] = useState(false);
  const [payoutMsg, setPayoutMsg]     = useState('');
  const [origin, setOrigin]           = useState('');
  useEffect(() => { setOrigin(window.location.origin); }, []);
  const link = `${origin}/?aff=${affiliate.code}`;

  function copy() {
    navigator.clipboard?.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function copyKit(text: string, key: string) {
    navigator.clipboard?.writeText(text).then(() => {
      setKitMsg(key);
      setTimeout(() => setKitMsg(null), 2000);
    });
  }

  async function requestPayout() {
    setPayoutLoading(true); setPayoutMsg('');
    try {
      const res = await api.post<{ ok: boolean; message: string }>('/affiliates/me/payout-request', {});
      setPayoutMsg(res.message);
    } catch (e: any) {
      setPayoutMsg(e.message || 'Erro ao solicitar saque.');
    } finally {
      setPayoutLoading(false);
    }
  }

  const pendingAmount   = stats?.pendingAmount ?? 0;
  const canRequestPayout = pendingAmount >= PAYOUT_MIN && !!affiliate.pixKey;

  const pendingCount = commissions.filter(c => c.status === 'pending').length;
  const paidCount    = commissions.filter(c => c.status === 'paid').length;

  const kitMessages = [
    {
      key: 'whatsapp',
      label: 'WhatsApp (direto)',
      text: `Oi! Criei um app que transforma áudio do WhatsApp em texto + resumo em segundos 🎧➡️📝\nTesta grátis, sem cadastro 👉 ${link} 🚀\n(20 min grátis/mês 🆓 · Pro R$19,90 em junho 🔥)`,
    },
    {
      key: 'grupo',
      label: 'Grupo de WhatsApp',
      text: `Pessoal! 👋 Criei o *ZapScript* 🎧➡️📝 — transforma *áudio do WhatsApp em texto + resumo* em segundos. Aquele áudio de 5 min que chega na pior hora? Lido em 10 segundos 🙌\nTesta grátis, sem cadastro 👉 ${link} 🚀 (20 min grátis/mês 🆓 · Pro R$19,90 em junho 🔥)`,
    },
    {
      key: 'linkedin',
      label: 'LinkedIn (post)',
      text: `Áudio de WhatsApp é ladrão de tempo. ⏱️\n\nO ZapScript transforma áudio em texto + resumo automático 🎧➡️📝\nVocê lê em segundos o que levaria minutos ouvindo.\n\n🆓 20 min grátis/mês · 🔥 Pro R$19,90 só em junho\nDemo sem cadastro 👉 ${link}\n\n#produtividade #IA #whatsapp`,
    },
  ];

  return (
    <div className="space-y-5">
      {/* Link de indicação */}
      <div className="rounded-2xl p-5" style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgba(var(--color-primary)/.12)' }}>
        <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
          <span className="text-xs font-mono uppercase tracking-widest text-brand-muted">Seu link de indicação</span>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-brand-primary/10 text-brand-primary font-semibold">50% mensal · 20% anual</span>
        </div>
        <div className="flex gap-2 flex-wrap">
          <input readOnly value={link} className="field-input flex-1 min-w-[200px] font-mono text-xs" onFocus={e => e.target.select()} />
          <button onClick={copy} className="btn-primary px-4 py-2 text-sm whitespace-nowrap">
            {copied ? '✓ Copiado' : 'Copiar'}
          </button>
        </div>
        <p className="text-[11px] text-brand-muted mt-2">
          Código: <strong className="text-brand-text">{affiliate.code}</strong> · Compartilhe o link; toda assinatura paga via ele gera comissão.
        </p>
      </div>

      {/* Estatísticas */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatBox
          label="Indicações"
          value={String(stats?.referrals ?? 0)}
          sub="cadastros pelo seu link"
        />
        <StatBox
          label="Assinantes"
          value={String(stats?.converted ?? 0)}
          sub={`de ${stats?.referrals ?? 0} indicados`}
        />
        <StatBox
          label="A receber"
          value={brl(stats?.pendingAmount ?? 0)}
          sub={`${pendingCount} comissão${pendingCount !== 1 ? 'ões' : ''} pendente${pendingCount !== 1 ? 's' : ''}`}
          accent
        />
        <StatBox
          label="Já pago"
          value={brl(stats?.paidAmount ?? 0)}
          sub={`${paidCount} comissão${paidCount !== 1 ? 'ões' : ''} paga${paidCount !== 1 ? 's' : ''}`}
        />
      </div>

      {/* Solicitar saque */}
      <div className="rounded-2xl p-5" style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgba(var(--color-primary)/.12)' }}>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h3 className="text-sm font-bold text-brand-text">Solicitar saque via Pix</h3>
            <p className="text-xs text-brand-muted mt-0.5">
              Pagamentos via Pix nos dias 10 e 25 · Mínimo R${PAYOUT_MIN.toFixed(2)}
            </p>
          </div>
          <button
            onClick={requestPayout}
            disabled={!canRequestPayout || payoutLoading}
            className="btn-primary px-4 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {payoutLoading ? 'Enviando...' : `Solicitar saque ${brl(pendingAmount)}`}
          </button>
        </div>
        {!affiliate.pixKey && (
          <p className="text-xs text-amber-400 mt-2">⚠ Cadastre sua chave Pix abaixo para habilitar o saque.</p>
        )}
        {pendingAmount < PAYOUT_MIN && pendingAmount > 0 && (
          <p className="text-xs text-brand-muted mt-2">Faltam {brl(PAYOUT_MIN - pendingAmount)} para atingir o mínimo de saque.</p>
        )}
        {payoutMsg && (
          <p className={`text-xs mt-2 ${payoutMsg.startsWith('Solicitação') ? 'text-brand-primary' : 'text-red-400'}`}>{payoutMsg}</p>
        )}
      </div>

      {/* Dados de pagamento */}
      <PayoutEditor affiliate={affiliate} onUpdated={onUpdated} />

      {/* Kit do Afiliado */}
      <div className="rounded-2xl overflow-hidden" style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgba(var(--color-primary)/.12)' }}>
        <div className="px-5 py-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <h3 className="text-sm font-bold text-brand-text">📦 Kit de divulgação</h3>
          <p className="text-xs text-brand-muted mt-0.5">Mensagens prontas com seu link. Copie e cole direto no WhatsApp ou LinkedIn.</p>
        </div>
        <div className="p-4 space-y-3">
          {kitMessages.map(m => (
            <div key={m.key} className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-semibold text-brand-muted uppercase tracking-wider">{m.label}</span>
                <button
                  onClick={() => copyKit(m.text, m.key)}
                  className="text-[11px] px-2 py-0.5 rounded-full font-semibold transition-colors"
                  style={{ background: kitMsg === m.key ? 'rgba(16,185,129,.2)' : 'rgba(255,255,255,.06)', color: kitMsg === m.key ? '#10b981' : 'var(--color-muted)' }}
                >
                  {kitMsg === m.key ? '✓ Copiado' : 'Copiar'}
                </button>
              </div>
              <p className="text-xs text-brand-text-secondary leading-relaxed whitespace-pre-line">{m.text}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Extrato de comissões */}
      <div className="rounded-2xl overflow-hidden" style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgba(var(--color-primary)/.12)' }}>
        <div className="px-5 py-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <h3 className="text-sm font-bold text-brand-text">Extrato de comissões</h3>
        </div>
        {commissions.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-brand-muted">
            Ainda não há comissões. Compartilhe seu link para começar.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-brand-muted">
                  <th className="px-4 py-2 font-medium">Data</th>
                  <th className="px-4 py-2 font-medium">Venda</th>
                  <th className="px-4 py-2 font-medium">Comissão</th>
                  <th className="px-4 py-2 font-medium">Tipo</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {commissions.map(c => (
                  <tr key={c.id} className="border-t" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                    <td className="px-4 py-2.5 text-brand-text-secondary">{fmtDate(c.createdAt)}</td>
                    <td className="px-4 py-2.5 text-brand-text-secondary">{brl(c.saleAmount)}</td>
                    <td className="px-4 py-2.5 font-semibold text-brand-text">{brl(c.commissionAmount)}</td>
                    <td className="px-4 py-2.5 text-brand-muted text-xs">
                      {c.commissionType === 'annual' ? 'Anual (20%)' : c.commissionType === 'monthly' ? 'Mensal (50%)' : 'Única'}
                    </td>
                    <td className="px-4 py-2.5"><CommStatus status={c.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatBox({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="text-[10px] uppercase tracking-widest text-brand-muted">{label}</div>
      <div className={`text-lg font-black mt-0.5 leading-tight ${accent ? 'text-brand-primary' : 'text-brand-text'}`}>{value}</div>
      {sub && <div className="text-[10px] text-brand-muted mt-0.5 leading-snug">{sub}</div>}
    </div>
  );
}

function CommStatus({ status }: { status: string }) {
  const map: Record<string, { l: string; c: string; b: string }> = {
    pending:  { l: 'A receber', c: '#fbbf24', b: 'rgba(251,191,36,.12)' },
    paid:     { l: 'Pago',      c: '#10b981', b: 'rgba(16,185,129,.12)' },
    canceled: { l: 'Cancelada', c: '#9ca3af', b: 'rgba(156,163,175,.12)' },
  };
  const s = map[status] || map.pending;
  return <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ color: s.c, background: s.b }}>{s.l}</span>;
}

/* ── Editor de dados de pagamento ── */
function PayoutEditor({ affiliate, onUpdated }: { affiliate: Affiliate; onUpdated: () => void }) {
  const [open, setOpen]             = useState(false);
  const [pixKeyType, setPixKeyType] = useState(affiliate.pixKeyType || '');
  const [pixKey, setPixKey]         = useState(affiliate.pixKey || '');
  const [payoutName, setPayoutName] = useState(affiliate.payoutName || '');
  const [saving, setSaving]         = useState(false);
  const [msg, setMsg]               = useState('');

  async function save() {
    setSaving(true); setMsg('');
    try {
      await api.put('/affiliates/me', { pixKey, pixKeyType: pixKeyType || undefined, payoutName });
      setMsg('Dados atualizados.');
      onUpdated();
      setTimeout(() => { setOpen(false); setMsg(''); }, 1200);
    } catch (e: any) {
      setMsg(e.message || 'Erro ao salvar.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl p-5" style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgba(var(--color-primary)/.12)' }}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-bold text-brand-text">Dados de pagamento (Pix)</h3>
          <p className="text-xs text-brand-muted mt-0.5">
            {affiliate.pixKey
              ? <>Chave: <strong className="text-brand-text-secondary">{affiliate.pixKey}</strong>{affiliate.payoutName ? ` · ${affiliate.payoutName}` : ''}</>
              : 'Cadastre sua chave Pix para receber as comissões.'}
          </p>
        </div>
        <button onClick={() => setOpen(o => !o)} className="text-sm text-brand-primary font-semibold hover:underline">
          {open ? 'Fechar' : 'Editar'}
        </button>
      </div>

      {open && (
        <div className="mt-4 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-brand-text-secondary mb-1">Tipo de chave</label>
              <select className="field-input" value={pixKeyType} onChange={e => setPixKeyType(e.target.value)}>
                <option value="">Selecione</option>
                {PIX_TYPES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-brand-text-secondary mb-1">Chave Pix</label>
              <input className="field-input" value={pixKey} onChange={e => setPixKey(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-brand-text-secondary mb-1">Nome do titular</label>
            <input className="field-input" value={payoutName} onChange={e => setPayoutName(e.target.value)} />
          </div>
          {msg && <p className="text-xs text-brand-primary">{msg}</p>}
          <button onClick={save} disabled={saving} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      )}
    </div>
  );
}
