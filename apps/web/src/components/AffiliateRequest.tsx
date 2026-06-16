'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

/* ─────────────────────────────────────────────────────────
   Seção "Programa de Afiliados" — usada na página Configurações.
   Fluxo: botão "Gerar Afiliação" → valida e-mail verificado +
   CPF/CNPJ cadastrado → exibe formulário com dados pré-preenchidos.
   ───────────────────────────────────────────────────────── */

interface UserData {
  name?: string;
  document?: string;
  emailVerified?: boolean;
}
interface Affiliate {
  status: 'pending' | 'approved' | 'rejected' | 'suspended';
  appliedAt: string;
  rejectedReason: string | null;
}

const PIX_TYPES = [
  { v: 'cpf',    l: 'CPF' },
  { v: 'cnpj',   l: 'CNPJ' },
  { v: 'email',  l: 'E-mail' },
  { v: 'phone',  l: 'Celular' },
  { v: 'random', l: 'Chave aleatória' },
];

const fmtDate = (s: string) => new Date(s).toLocaleDateString('pt-BR');

export default function AffiliateRequest({ user }: { user: UserData | null }) {
  const [loading, setLoading]     = useState(true);
  const [affiliate, setAffiliate] = useState<Affiliate | null>(null);
  const [showForm, setShowForm]   = useState(false);
  const [blockMsg, setBlockMsg]   = useState('');

  async function load() {
    try {
      const data = await api.get<{ affiliate: Affiliate | null }>('/affiliates/me');
      setAffiliate(data.affiliate);
    } catch { /* não autenticado tratado pelo layout */ }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function handleOpen() {
    if (!user?.emailVerified) {
      setBlockMsg('Confirme seu e-mail antes de solicitar a afiliação. Verifique sua caixa de entrada.');
      return;
    }
    if (!user?.document) {
      setBlockMsg('Informe seu CPF/CNPJ na seção "Dados da Conta" acima antes de solicitar a afiliação.');
      return;
    }
    setBlockMsg('');
    setShowForm(true);
  }

  return (
    <div className="card rounded-2xl p-6 mb-5">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base">🤝</span>
        <h2 className="font-bold text-sm text-brand-text">Programa de Afiliados</h2>
      </div>
      <p className="text-xs text-brand-muted mb-4">
        Indique o ZapScript e ganhe comissão sobre cada assinatura paga pelo seu link.
      </p>

      {loading ? (
        <div className="text-xs text-brand-muted animate-pulse">Carregando...</div>
      ) : (
        <>
          {/* Nenhuma solicitação ainda → botão de entrada */}
          {!affiliate && !showForm && (
            <>
              <CommissionInfo />
              {blockMsg && (
                <div className="mb-3 rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs text-amber-400">
                  ⚠️ {blockMsg}
                </div>
              )}
              <button onClick={handleOpen} className="btn-primary w-full py-3 text-sm">
                Gerar Afiliação →
              </button>
            </>
          )}

          {/* Formulário de solicitação */}
          {!affiliate && showForm && (
            <ApplyForm user={user} onApplied={load} onCancel={() => setShowForm(false)} />
          )}

          {/* Estados pós-solicitação */}
          {affiliate?.status === 'pending'   && <PendingNote affiliate={affiliate} />}
          {affiliate?.status === 'rejected'  && <RejectedNote affiliate={affiliate} />}
          {affiliate?.status === 'suspended' && <SuspendedNote />}
          {affiliate?.status === 'approved'  && <ApprovedNote />}
        </>
      )}
    </div>
  );
}

/* ── Resumo de comissões (novo modelo fixo) ── */
function CommissionInfo() {
  return (
    <div className="grid sm:grid-cols-2 gap-3 mb-4">
      <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="text-[10px] font-mono uppercase tracking-widest text-brand-muted mb-1">Plano Mensal</div>
        <div className="text-xl font-black text-brand-primary">50%</div>
        <p className="text-[11px] text-brand-text-secondary mt-1">do 1º pagamento do indicado que assinar o plano mensal.</p>
      </div>
      <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="text-[10px] font-mono uppercase tracking-widest text-brand-muted mb-1">Plano Anual</div>
        <div className="text-xl font-black text-brand-primary">20%</div>
        <p className="text-[11px] text-brand-text-secondary mt-1">do valor pago pelo indicado que assinar o plano anual.</p>
      </div>
      <div className="sm:col-span-2 rounded-xl px-3 py-2 text-[11px] text-brand-muted" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
        💳 Pagamentos via Pix nos dias <strong className="text-brand-text">10 e 25</strong> de cada mês, contemplando as conversões do período.
      </div>
    </div>
  );
}

/* ── Formulário de solicitação ── */
function ApplyForm({ user, onApplied, onCancel }: {
  user: UserData | null;
  onApplied: () => void;
  onCancel: () => void;
}) {
  const [pixKeyType, setPixKeyType] = useState('');
  const [pixKey, setPixKey]         = useState('');
  const [audience, setAudience]     = useState('');
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!pixKeyType || !pixKey.trim()) {
      setError('Informe sua chave Pix para continuar.');
      return;
    }
    setError(''); setLoading(true);
    try {
      await api.post('/affiliates/apply', {
        pixKey:     pixKey.trim(),
        pixKeyType,
        payoutName: user?.name || undefined,
        audience:   audience || undefined,
      });
      onApplied();
    } catch (err: any) {
      setError(err.message || 'Erro ao enviar solicitação.');
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {/* Dados pré-preenchidos (somente leitura) */}
      <div className="rounded-xl p-3 space-y-2" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <p className="text-[10px] font-mono uppercase tracking-widest text-brand-muted mb-2">Seus dados cadastrais</p>
        <div className="grid sm:grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-semibold text-brand-text-secondary mb-1">Nome completo</label>
            <input className="field-input" readOnly disabled value={user?.name || ''} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-brand-text-secondary mb-1">CPF / CNPJ</label>
            <input className="field-input" readOnly disabled value={user?.document || ''} />
          </div>
        </div>
        <p className="text-[10px] text-brand-muted/70">O pagamento será realizado <strong className="text-brand-muted">exclusivamente</strong> para conta de titularidade do CPF/CNPJ acima.</p>
      </div>

      {/* Chave Pix (obrigatória) */}
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-brand-text-secondary mb-1">
            Tipo de chave Pix <span className="text-red-400">*</span>
          </label>
          <select className="field-input" value={pixKeyType} onChange={e => setPixKeyType(e.target.value)} required>
            <option value="">Selecione</option>
            {PIX_TYPES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-brand-text-secondary mb-1">
            Chave Pix <span className="text-red-400">*</span>
          </label>
          <input
            className="field-input"
            value={pixKey}
            onChange={e => setPixKey(e.target.value)}
            placeholder="Sua chave Pix"
            required
          />
        </div>
      </div>

      {/* Como pretende divulgar */}
      <div>
        <label className="block text-xs font-semibold text-brand-text-secondary mb-1">
          Como você pretende divulgar? <span className="font-normal text-brand-muted">(opcional)</span>
        </label>
        <textarea
          className="field-input min-h-[64px]"
          value={audience}
          onChange={e => setAudience(e.target.value)}
          placeholder="Ex.: grupo de WhatsApp de contadores, Instagram com profissionais de saúde..."
        />
        <p className="text-[10px] text-brand-muted/60 mt-1">Ajuda nossa equipe a aprovar seu cadastro mais rápido.</p>
      </div>

      {error && (
        <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</div>
      )}

      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="flex-1 py-2.5 text-sm rounded-xl border border-white/10 text-brand-muted hover:border-white/20 transition-colors">
          Cancelar
        </button>
        <button type="submit" disabled={loading} className="btn-primary flex-1 py-2.5 text-sm disabled:opacity-50">
          {loading ? 'Enviando...' : 'Solicitar afiliação →'}
        </button>
      </div>
      <p className="text-center text-[11px] text-brand-muted">Sua solicitação passa por aprovação da nossa equipe.</p>
    </form>
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
      Você receberá um aviso por e-mail assim que for aprovado.
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
      no menu para ver seu link, estatísticas e solicitar saque.
    </NoteShell>
  );
}
