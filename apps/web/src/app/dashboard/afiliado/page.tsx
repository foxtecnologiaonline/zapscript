'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/* ─────────────────────────────────────────────────────────
   Painel do Afiliado — solicitar afiliação, link de indicação,
   estatísticas e extrato de comissões. Pagamento via Pix manual.
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
interface Rates { onetimeRate: number; recurringRate: number; recurringMaxMonths: number; }
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
  const [loading, setLoading]       = useState(true);
  const [affiliate, setAffiliate]   = useState<Affiliate | null>(null);
  const [stats, setStats]           = useState<Stats | null>(null);
  const [rates, setRates]           = useState<Rates | null>(null);
  const [commissions, setCommissions] = useState<Commission[]>([]);

  async function load() {
    try {
      const data = await api.get<{ affiliate: Affiliate | null; stats?: Stats; rates?: Rates }>('/affiliates/me');
      setAffiliate(data.affiliate);
      setStats(data.stats || null);
      setRates(data.rates || null);
      if (data.affiliate?.status === 'approved') {
        try {
          const c = await api.get<{ commissions: Commission[] }>('/affiliates/commissions');
          setCommissions(c.commissions || []);
        } catch { /* sem comissões ainda */ }
      }
    } catch {
      /* não autenticado tratado pelo layout */
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  if (loading) {
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
          Indique o ZapScript e ganhe comissão sobre cada assinatura paga.
        </p>
      </div>

      {!affiliate && <ApplyForm rates={rates} onApplied={load} />}
      {affiliate?.status === 'pending'  && <PendingCard affiliate={affiliate} />}
      {affiliate?.status === 'rejected' && <RejectedCard affiliate={affiliate} />}
      {affiliate?.status === 'suspended' && <SuspendedCard />}
      {affiliate?.status === 'approved' && (
        <ApprovedPanel
          affiliate={affiliate} stats={stats} rates={rates}
          commissions={commissions} onUpdated={load}
        />
      )}
    </div>
  );
}

/* ── Cartão informativo de modelos de comissão ── */
function CommissionInfo({ rates }: { rates: Rates | null }) {
  const oneRate = rates ? Math.round(rates.onetimeRate * 100) : 30;
  const recRate = rates ? Math.round(rates.recurringRate * 100) : 5;
  const months  = rates?.recurringMaxMonths ?? 12;
  return (
    <div className="grid sm:grid-cols-2 gap-3 mb-5">
      <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="text-xs font-mono uppercase tracking-widest text-brand-muted mb-1">Modelo A</div>
        <div className="text-2xl font-black text-brand-primary">{oneRate}%</div>
        <p className="text-xs text-brand-text-secondary mt-1">comissão <strong>única</strong> sobre o primeiro pagamento de cada indicado.</p>
      </div>
      <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="text-xs font-mono uppercase tracking-widest text-brand-muted mb-1">Modelo B</div>
        <div className="text-2xl font-black text-brand-primary">{recRate}%/mês</div>
        <p className="text-xs text-brand-text-secondary mt-1">comissão <strong>recorrente</strong> nos primeiros {months} meses de cada assinatura ativa.</p>
      </div>
    </div>
  );
}

/* ── Formulário de solicitação ── */
function ApplyForm({ rates, onApplied }: { rates: Rates | null; onApplied: () => void }) {
  const [commissionType, setCommissionType] = useState<'onetime' | 'recurring'>('recurring');
  const [pixKeyType, setPixKeyType] = useState('');
  const [pixKey, setPixKey]         = useState('');
  const [payoutName, setPayoutName] = useState('');
  const [audience, setAudience]     = useState('');
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      await api.post('/affiliates/apply', {
        commissionType,
        pixKey:     pixKey || undefined,
        pixKeyType: pixKeyType || undefined,
        payoutName: payoutName || undefined,
        audience:   audience || undefined,
      });
      onApplied();
    } catch (err: any) {
      setError(err.message || 'Erro ao enviar cadastro.');
      setLoading(false);
    }
  }

  return (
    <div>
      <CommissionInfo rates={rates} />
      <form onSubmit={submit} className="rounded-2xl p-5 sm:p-6 space-y-4"
        style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgba(var(--color-primary)/.12)' }}>
        <div>
          <label className="block text-xs font-semibold text-brand-text-secondary mb-2">Escolha seu modelo de comissão</label>
          <div className="grid sm:grid-cols-2 gap-2">
            {([
              { v: 'recurring', t: 'Recorrente (5%/mês)', d: 'Renda passiva por até 12 meses' },
              { v: 'onetime',   t: 'Única (30%)',         d: 'Comissão maior no 1º pagamento' },
            ] as const).map(o => (
              <button type="button" key={o.v} onClick={() => setCommissionType(o.v)}
                className={`text-left rounded-xl p-3 border transition-all ${
                  commissionType === o.v
                    ? 'border-brand-primary bg-brand-primary/10'
                    : 'border-white/10 hover:border-white/20'
                }`}>
                <div className="text-sm font-bold text-brand-text">{o.t}</div>
                <div className="text-[11px] text-brand-muted">{o.d}</div>
              </button>
            ))}
          </div>
          <p className="text-[10px] text-brand-muted/60 mt-1">O modelo só pode ser alterado antes da sua primeira comissão.</p>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-brand-text-secondary mb-1">Tipo de chave Pix <span className="font-normal text-brand-muted">(opcional)</span></label>
            <select className="field-input" value={pixKeyType} onChange={e => setPixKeyType(e.target.value)}>
              <option value="">Selecione</option>
              {PIX_TYPES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-brand-text-secondary mb-1">Chave Pix</label>
            <input className="field-input" value={pixKey} onChange={e => setPixKey(e.target.value)} placeholder="Para receber suas comissões" />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-brand-text-secondary mb-1">Nome do titular da chave <span className="font-normal text-brand-muted">(opcional)</span></label>
          <input className="field-input" value={payoutName} onChange={e => setPayoutName(e.target.value)} placeholder="Nome completo / razão social" />
        </div>

        <div>
          <label className="block text-xs font-semibold text-brand-text-secondary mb-1">Como você pretende divulgar? <span className="font-normal text-brand-muted">(opcional)</span></label>
          <textarea className="field-input min-h-[72px]" value={audience} onChange={e => setAudience(e.target.value)}
            placeholder="Ex.: Instagram com 5k seguidores de profissionais liberais; grupo de WhatsApp de contadores..." />
          <p className="text-[10px] text-brand-muted/60 mt-1">Isso ajuda nossa equipe a aprovar seu cadastro mais rápido.</p>
        </div>

        {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>}

        <button type="submit" disabled={loading} className="btn-primary w-full py-3 text-sm disabled:opacity-50">
          {loading ? 'Enviando...' : 'Quero ser afiliado →'}
        </button>
        <p className="text-center text-[11px] text-brand-muted">Seu cadastro passa por aprovação da nossa equipe.</p>
      </form>
    </div>
  );
}

/* ── Estados de status ── */
function StatusShell({ icon, bg, border, title, children }: any) {
  return (
    <div className="rounded-2xl p-6 text-center" style={{ background: bg, border: `1px solid ${border}` }}>
      <div className="text-4xl mb-2">{icon}</div>
      <h2 className="text-lg font-bold text-brand-text mb-1">{title}</h2>
      <div className="text-sm text-brand-text-secondary">{children}</div>
    </div>
  );
}
function PendingCard({ affiliate }: { affiliate: Affiliate }) {
  return (
    <StatusShell icon="⏳" bg="rgba(251,191,36,.08)" border="rgba(251,191,36,.25)" title="Cadastro em análise">
      Recebemos sua solicitação em <strong>{fmtDate(affiliate.appliedAt)}</strong>.<br />
      Você receberá um e-mail assim que for aprovado e poderá começar a indicar.
    </StatusShell>
  );
}
function RejectedCard({ affiliate }: { affiliate: Affiliate }) {
  return (
    <StatusShell icon="🚫" bg="rgba(239,68,68,.08)" border="rgba(239,68,68,.25)" title="Cadastro não aprovado">
      {affiliate.rejectedReason
        ? <>Motivo: <strong>{affiliate.rejectedReason}</strong></>
        : 'Seu cadastro não foi aprovado no momento.'}
      <br />Dúvidas? Fale com o suporte.
    </StatusShell>
  );
}
function SuspendedCard() {
  return (
    <StatusShell icon="⚠️" bg="rgba(239,68,68,.08)" border="rgba(239,68,68,.25)" title="Afiliação suspensa">
      Sua conta de afiliado está suspensa. Entre em contato com o suporte para regularizar.
    </StatusShell>
  );
}

/* ── Painel do afiliado aprovado ── */
function ApprovedPanel({ affiliate, stats, rates, commissions, onUpdated }: {
  affiliate: Affiliate; stats: Stats | null; rates: Rates | null;
  commissions: Commission[]; onUpdated: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState('');
  useEffect(() => { setOrigin(window.location.origin); }, []);
  const link = `${origin}/?aff=${affiliate.code}`;

  function copy() {
    navigator.clipboard?.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const modelLabel = affiliate.commissionType === 'onetime'
    ? `Única ${rates ? Math.round(rates.onetimeRate * 100) : 30}%`
    : `Recorrente ${rates ? Math.round(rates.recurringRate * 100) : 5}%/mês`;

  return (
    <div className="space-y-5">
      {/* Link de indicação */}
      <div className="rounded-2xl p-5" style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgba(var(--color-primary)/.12)' }}>
        <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
          <span className="text-xs font-mono uppercase tracking-widest text-brand-muted">Seu link de indicação</span>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-brand-primary/10 text-brand-primary font-semibold">{modelLabel}</span>
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
        <StatBox label="Indicações"  value={String(stats?.referrals ?? 0)} />
        <StatBox label="Converteram" value={String(stats?.converted ?? 0)} />
        <StatBox label="A receber"   value={brl(stats?.pendingAmount ?? 0)} accent />
        <StatBox label="Já pago"     value={brl(stats?.paidAmount ?? 0)} />
      </div>

      {/* Dados de pagamento */}
      <PayoutEditor affiliate={affiliate} onUpdated={onUpdated} />

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
                      {c.commissionType === 'onetime' ? 'Única' : `Recorrente ${c.monthIndex}/12`}
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

function StatBox({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="text-[10px] uppercase tracking-widest text-brand-muted">{label}</div>
      <div className={`text-lg font-black mt-0.5 ${accent ? 'text-brand-primary' : 'text-brand-text'}`}>{value}</div>
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
