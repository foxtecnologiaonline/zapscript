'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

/* ─────────────────────────────────────────────────────────
   Seção "Programa de Afiliados" — usada na página Configurações.
   É o ponto de entrada do fluxo: o usuário SOLICITA o código aqui;
   após a aprovação do admin (marcação "afiliado"), o item de menu
   e a página /dashboard/afiliado passam a aparecer.
   ───────────────────────────────────────────────────────── */

interface Affiliate {
  status: 'pending' | 'approved' | 'rejected' | 'suspended';
  appliedAt: string;
  rejectedReason: string | null;
}
interface Rates { onetimeRate: number; recurringRate: number; recurringMaxMonths: number; }

const PIX_TYPES = [
  { v: 'cpf',    l: 'CPF' },
  { v: 'cnpj',   l: 'CNPJ' },
  { v: 'email',  l: 'E-mail' },
  { v: 'phone',  l: 'Celular' },
  { v: 'random', l: 'Chave aleatória' },
];

const fmtDate = (s: string) => new Date(s).toLocaleDateString('pt-BR');

export default function AffiliateRequest() {
  const [loading, setLoading]     = useState(true);
  const [affiliate, setAffiliate] = useState<Affiliate | null>(null);
  const [rates, setRates]         = useState<Rates | null>(null);

  async function load() {
    try {
      const data = await api.get<{ affiliate: Affiliate | null; rates?: Rates }>('/affiliates/me');
      setAffiliate(data.affiliate);
      setRates(data.rates || null);
    } catch {
      /* não autenticado é tratado pelo layout */
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  return (
    <div className="card rounded-2xl p-6 mb-5">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base">🤝</span>
        <h2 className="font-bold text-sm text-brand-text">Programa de Afiliados</h2>
      </div>
      <p className="text-xs text-brand-muted mb-4">
        Indique o ZapScript e ganhe comissão sobre cada assinatura paga. Solicite seu código abaixo.
      </p>

      {loading
        ? <div className="text-xs text-brand-muted animate-pulse">Carregando...</div>
        : <>
            {!affiliate                    && <ApplyForm rates={rates} onApplied={load} />}
            {affiliate?.status === 'pending'   && <PendingNote affiliate={affiliate} />}
            {affiliate?.status === 'rejected'  && <RejectedNote affiliate={affiliate} />}
            {affiliate?.status === 'suspended' && <SuspendedNote />}
            {affiliate?.status === 'approved'  && <ApprovedNote />}
          </>}
    </div>
  );
}

/* ── Resumo dos modelos de comissão ── */
function CommissionInfo({ rates }: { rates: Rates | null }) {
  const oneRate = rates ? Math.round(rates.onetimeRate * 100) : 30;
  const recRate = rates ? Math.round(rates.recurringRate * 100) : 5;
  const months  = rates?.recurringMaxMonths ?? 12;
  return (
    <div className="grid sm:grid-cols-2 gap-3 mb-4">
      <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="text-[10px] font-mono uppercase tracking-widest text-brand-muted mb-1">Modelo A</div>
        <div className="text-xl font-black text-brand-primary">{oneRate}%</div>
        <p className="text-[11px] text-brand-text-secondary mt-1">comissão <strong>única</strong> sobre o 1º pagamento de cada indicado.</p>
      </div>
      <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="text-[10px] font-mono uppercase tracking-widest text-brand-muted mb-1">Modelo B</div>
        <div className="text-xl font-black text-brand-primary">{recRate}%/mês</div>
        <p className="text-[11px] text-brand-text-secondary mt-1">comissão <strong>recorrente</strong> nos primeiros {months} meses de cada assinatura ativa.</p>
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
      setError(err.message || 'Erro ao enviar solicitação.');
      setLoading(false);
    }
  }

  return (
    <div>
      <CommissionInfo rates={rates} />
      <form onSubmit={submit} className="space-y-4">
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
          {loading ? 'Enviando...' : 'Solicitar código de afiliado →'}
        </button>
        <p className="text-center text-[11px] text-brand-muted">Sua solicitação passa por aprovação da nossa equipe.</p>
      </form>
    </div>
  );
}

/* ── Estados pós-solicitação ── */
function NoteShell({ bg, border, children }: { bg: string; border: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-4 text-sm text-brand-text-secondary" style={{ background: bg, border: `1px solid ${border}` }}>
      {children}
    </div>
  );
}
function PendingNote({ affiliate }: { affiliate: Affiliate }) {
  return (
    <NoteShell bg="rgba(251,191,36,.08)" border="rgba(251,191,36,.25)">
      <strong className="text-brand-text">⏳ Solicitação em análise.</strong> Recebida em {fmtDate(affiliate.appliedAt)}.
      Você receberá um aviso assim que for aprovado — então a página <strong>Afiliados</strong> aparecerá no seu menu.
    </NoteShell>
  );
}
function RejectedNote({ affiliate }: { affiliate: Affiliate }) {
  return (
    <NoteShell bg="rgba(239,68,68,.08)" border="rgba(239,68,68,.25)">
      <strong className="text-brand-text">🚫 Solicitação não aprovada.</strong>{' '}
      {affiliate.rejectedReason ? <>Motivo: {affiliate.rejectedReason}.</> : 'No momento, não foi aprovada.'}{' '}
      Dúvidas? Fale com o suporte.
    </NoteShell>
  );
}
function SuspendedNote() {
  return (
    <NoteShell bg="rgba(239,68,68,.08)" border="rgba(239,68,68,.25)">
      <strong className="text-brand-text">⚠️ Afiliação suspensa.</strong> Entre em contato com o suporte para regularizar.
    </NoteShell>
  );
}
function ApprovedNote() {
  return (
    <NoteShell bg="rgba(16,185,129,.08)" border="rgba(16,185,129,.25)">
      <strong className="text-brand-text">✅ Você é um afiliado aprovado!</strong>{' '}
      Acesse a página{' '}
      <Link href="/dashboard/afiliado" className="text-brand-primary font-semibold hover:underline">Afiliados</Link>{' '}
      no menu para ver seu link de indicação, estatísticas e comissões.
    </NoteShell>
  );
}
