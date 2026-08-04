'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/* ─────────────────────────────────────────────────────────
   Carteira de Crédito — Regulamento v4 (REGULAMENTO_AFILIADOS.md)
   Disponível automaticamente para QUALQUER usuário, sem aplicação nem
   aprovação (Art. 2º). Taxa única de 20% sobre cada pagamento de quem você
   indicou, sem tier/bônus/residual (Art. 3º); crédito liberado 30 dias após
   a confirmação do pagamento do indicado (Art. 4º); saldo usável em 3
   trilhos (Art. 5º): abater fatura, comprar créditos avulsos, sacar em Pix.

   Usuários que ainda têm cadastro no programa antigo (Affiliate aprovado,
   com histórico de comissão em 30/40/5%) continuam vendo o extrato legado
   numa seção separada, abaixo — nada é apagado, só deixa de ser o caminho
   de entrada para quem chega agora.
   ───────────────────────────────────────────────────────── */

interface WalletData {
  balance: number;
  pendingAmount: number;
  pendingCount: number;
  minCashout: number;
  pixKey: string | null;
  pixKeyType: string | null;
  payoutName: string | null;
  refCode: string;
  transactions: Transaction[];
  payouts: Payout[];
}
interface Transaction {
  id: string; type: string; amount: number; balanceAfter: number;
  note: string | null; createdAt: string;
}
interface Payout {
  id: string; amount: number; status: 'requested' | 'paid'; requestedAt: string; paidAt: string | null;
}
interface Rates {
  rate: number; releaseDays: number; minCashout: number; expiryMonths: number; addonMinutePrice: number;
}
interface LegacyAffiliate {
  status: 'pending' | 'approved' | 'rejected' | 'suspended';
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

const TYPE_LABEL: Record<string, string> = {
  earn_referral:   'Indicação',
  redeem_invoice:  'Abatido na fatura',
  redeem_addon:    'Convertido em avulso',
  redeem_cashout:  'Saque solicitado',
  expire:          'Expirado',
  adjustment:      'Ajuste',
};

export default function CarteiraPage() {
  const [loading, setLoading] = useState(true);
  const [wallet, setWallet]   = useState<WalletData | null>(null);
  const [rates, setRates]     = useState<Rates | null>(null);
  const [legacy, setLegacy]   = useState<LegacyAffiliate | null>(null);
  const [origin, setOrigin]   = useState('');

  async function load() {
    try {
      const [w, r] = await Promise.all([
        api.get<WalletData>('/wallet/me'),
        api.get<Rates>('/wallet/rates'),
      ]);
      setWallet(w);
      setRates(r);
    } catch { /* não autenticado tratado pelo layout */ }
    try {
      const legacyData = await api.get<{ affiliate: LegacyAffiliate | null }>('/affiliates/me');
      if (legacyData.affiliate?.status === 'approved') setLegacy(legacyData.affiliate);
    } catch { /* sem cadastro no programa antigo — nada a fazer */ }
    finally { setLoading(false); }
  }
  useEffect(() => {
    load();
    setOrigin(window.location.origin);
  }, []);

  if (loading || !wallet) {
    return (
      <div className="p-6 sm:p-8">
        <div className="text-brand-primary text-sm animate-pulse">Carregando...</div>
      </div>
    );
  }

  const link = `${origin}/cadastro?ref=${wallet.refCode}`;
  const ratePct = rates ? Math.round(rates.rate * 100) : 20;

  return (
    <div className="p-4 sm:p-8 max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-brand-text flex items-center gap-2">
          <span>💰</span> Carteira ZapScript
        </h1>
        <p className="text-sm text-brand-muted mt-1">
          Indique o ZapScript e ganhe {ratePct}% de crédito sobre cada assinatura paga por quem você indicou —
          automático, sem precisar solicitar nada.
        </p>
      </div>

      <ReferralLink link={link} ratePct={ratePct} />
      <Balance wallet={wallet} rates={rates} />
      <RedeemPanel wallet={wallet} rates={rates} onUpdated={load} />
      <PixEditor wallet={wallet} onUpdated={load} />
      <Statement transactions={wallet.transactions} />
      {wallet.payouts.length > 0 && <PayoutHistory payouts={wallet.payouts} />}
      {legacy && <LegacyNote />}
    </div>
  );
}

/* ── Link de indicação ── */
function ReferralLink({ link, ratePct }: { link: string; ratePct: number }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard?.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <div className="rounded-2xl p-5" style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgba(var(--color-primary)/.12)' }}>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <span className="text-xs font-mono uppercase tracking-widest text-brand-muted">Seu link de indicação</span>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-brand-primary/10 text-brand-primary font-semibold">
          {ratePct}% recorrente
        </span>
      </div>
      <div className="flex gap-2 flex-wrap">
        <input readOnly value={link} className="field-input flex-1 min-w-[200px] font-mono text-xs" onFocus={e => e.target.select()} />
        <button onClick={copy} className="btn-primary px-4 py-2 text-sm whitespace-nowrap">
          {copied ? '✓ Copiado' : 'Copiar'}
        </button>
      </div>
      <p className="text-[11px] text-brand-muted mt-2">
        Toda pessoa que se cadastrar por esse link e assinar um plano pago gera crédito automático pra você.
      </p>
    </div>
  );
}

/* ── Saldo ── */
function Balance({ wallet, rates }: { wallet: WalletData; rates: Rates | null }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      <StatBox label="Disponível" value={brl(wallet.balance)} sub="pronto pra usar" accent />
      <StatBox
        label="Em validação"
        value={brl(wallet.pendingAmount)}
        sub={rates ? `libera D+${rates.releaseDays} do pagamento do indicado` : undefined}
      />
      <StatBox label="Saque mínimo" value={brl(wallet.minCashout)} sub="só no trilho de dinheiro" />
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

/* ── Os 3 trilhos de uso do saldo (Art. 5º) ── */
function RedeemPanel({ wallet, rates, onUpdated }: { wallet: WalletData; rates: Rates | null; onUpdated: () => void }) {
  const [tab, setTab] = useState<'invoice' | 'addon' | 'cashout'>('invoice');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const tabs: { key: typeof tab; label: string; icon: string }[] = [
    { key: 'invoice', label: 'Abater fatura', icon: '✓' },
    { key: 'addon',   label: 'Comprar avulso', icon: '+' },
    { key: 'cashout', label: 'Sacar em dinheiro', icon: 'R$' },
  ];

  async function submit() {
    const value = Number(amount.replace(',', '.'));
    if (!value || value <= 0) { setMsg({ ok: false, text: 'Informe um valor válido.' }); return; }
    if (value > wallet.balance) { setMsg({ ok: false, text: 'Valor maior que o saldo disponível.' }); return; }
    if (tab === 'cashout' && !wallet.pixKey) {
      setMsg({ ok: false, text: 'Cadastre sua chave Pix abaixo antes de sacar.' });
      return;
    }
    setLoading(true); setMsg(null);
    try {
      const path = tab === 'invoice' ? '/wallet/redeem/invoice' : tab === 'addon' ? '/wallet/redeem/addon' : '/wallet/redeem/cashout';
      const res = await api.post<{ message?: string; minutesGranted?: number }>(path, { amount: value });
      setMsg({
        ok: true,
        text: res.message
          || (res.minutesGranted ? `${res.minutesGranted.toFixed(0)} minutos avulsos creditados na sua conta.` : 'Resgate concluído.'),
      });
      setAmount('');
      onUpdated();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message || 'Erro ao processar o resgate.' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgba(var(--color-primary)/.12)' }}>
      <div className="px-5 py-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <h3 className="text-sm font-bold text-brand-text">Usar o saldo</h3>
        <p className="text-xs text-brand-muted mt-0.5">1 crédito = R$ 1,00, sempre. Escolha como usar.</p>
      </div>
      <div className="flex gap-1.5 p-3 flex-wrap">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setMsg(null); }}
            className="text-xs px-3 py-1.5 rounded-full font-semibold transition-colors"
            style={{
              color:      tab === t.key ? '#04130c' : 'var(--color-muted)',
              background: tab === t.key ? 'rgb(var(--color-primary))' : 'rgba(255,255,255,.06)',
            }}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>
      <div className="px-5 pb-5">
        {tab === 'invoice' && (
          <p className="text-xs text-brand-muted mb-3">O valor é descontado do seu saldo agora e aplicado como desconto na sua próxima fatura.</p>
        )}
        {tab === 'addon' && (
          <p className="text-xs text-brand-muted mb-3">
            Convertido em minutos extras na hora (câmbio: R$ {rates?.addonMinutePrice.toFixed(2) ?? '0,19'}/minuto).
          </p>
        )}
        {tab === 'cashout' && (
          <p className="text-xs text-brand-muted mb-3">Valor mínimo R$ {wallet.minCashout} · pago via Pix pela equipe, sem prazo fixo.</p>
        )}
        <div className="flex gap-2 flex-wrap">
          <input
            className="field-input flex-1 min-w-[140px]"
            placeholder="Valor (R$)"
            inputMode="decimal"
            value={amount}
            onChange={e => setAmount(e.target.value)}
          />
          <button onClick={submit} disabled={loading} className="btn-primary px-4 py-2 text-sm disabled:opacity-50 whitespace-nowrap">
            {loading ? 'Enviando...' : 'Confirmar'}
          </button>
        </div>
        {msg && <p className={`text-xs mt-2 ${msg.ok ? 'text-brand-primary' : 'text-red-400'}`}>{msg.text}</p>}
      </div>
    </div>
  );
}

/* ── Dados de Pix (usados no saque) ── */
function PixEditor({ wallet, onUpdated }: { wallet: WalletData; onUpdated: () => void }) {
  const [open, setOpen]             = useState(!wallet.pixKey);
  const [pixKeyType, setPixKeyType] = useState(wallet.pixKeyType || '');
  const [pixKey, setPixKey]         = useState(wallet.pixKey || '');
  const [payoutName, setPayoutName] = useState(wallet.payoutName || '');
  const [saving, setSaving]         = useState(false);
  const [msg, setMsg]               = useState('');

  async function save() {
    setSaving(true); setMsg('');
    try {
      await api.put('/wallet/me', { pixKey, pixKeyType: pixKeyType || undefined, payoutName });
      setMsg('Dados atualizados.');
      onUpdated();
      setTimeout(() => setMsg(''), 1500);
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
          <h3 className="text-sm font-bold text-brand-text">Chave Pix (para saque em dinheiro)</h3>
          <p className="text-xs text-brand-muted mt-0.5">
            {wallet.pixKey
              ? <>Chave: <strong className="text-brand-text-secondary">{wallet.pixKey}</strong>{wallet.payoutName ? ` · ${wallet.payoutName}` : ''}</>
              : 'Sem chave cadastrada ainda.'}
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

/* ── Extrato ── */
function Statement({ transactions }: { transactions: Transaction[] }) {
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgba(var(--color-primary)/.12)' }}>
      <div className="px-5 py-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <h3 className="text-sm font-bold text-brand-text">Extrato</h3>
      </div>
      {transactions.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-brand-muted">
          Ainda não há lançamentos. Compartilhe seu link para começar.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-brand-muted">
                <th className="px-4 py-2 font-medium">Data</th>
                <th className="px-4 py-2 font-medium">Tipo</th>
                <th className="px-4 py-2 font-medium">Valor</th>
                <th className="px-4 py-2 font-medium">Saldo após</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map(t => (
                <tr key={t.id} className="border-t" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                  <td className="px-4 py-2.5 text-brand-text-secondary">{fmtDate(t.createdAt)}</td>
                  <td className="px-4 py-2.5 text-brand-text-secondary">{TYPE_LABEL[t.type] || t.type}</td>
                  <td className={`px-4 py-2.5 font-semibold ${t.amount >= 0 ? 'text-brand-primary' : 'text-brand-text'}`}>
                    {t.amount >= 0 ? '+' : ''}{brl(t.amount)}
                  </td>
                  <td className="px-4 py-2.5 text-brand-muted">{brl(t.balanceAfter)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── Histórico de saques ── */
function PayoutHistory({ payouts }: { payouts: Payout[] }) {
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgba(var(--color-primary)/.12)' }}>
      <div className="px-5 py-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <h3 className="text-sm font-bold text-brand-text">Saques solicitados</h3>
      </div>
      <div className="p-4 space-y-2">
        {payouts.map(p => (
          <div key={p.id} className="flex items-center justify-between text-sm">
            <span className="text-brand-text-secondary">{fmtDate(p.requestedAt)} · {brl(p.amount)}</span>
            <span
              className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
              style={p.status === 'paid'
                ? { color: '#10b981', background: 'rgba(16,185,129,.12)' }
                : { color: '#fbbf24', background: 'rgba(251,191,36,.12)' }}
            >
              {p.status === 'paid' ? 'Pago' : 'Solicitado'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Nota para quem ainda tem cadastro no programa antigo ── */
function LegacyNote() {
  return (
    <div className="rounded-xl px-4 py-3 text-xs text-brand-muted" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
      Você também tem um cadastro aprovado no programa de afiliados anterior (comissão em dinheiro, 30%/12 meses + 5%
      residual). Esse extrato continua ativo — fale com o suporte se quiser detalhes sobre ele.
    </div>
  );
}
