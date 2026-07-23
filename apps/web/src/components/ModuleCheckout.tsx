'use client';
import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';

/* ─────────────────────────────────────────────────────────
   ModuleCheckout — Checkout Transparente Asaas para módulos
   da suíte (assinatura à la carte via POST /billing/modules/:key/subscribe).
   Métodos: PIX · Crédito · Débito.
   Inclui os gates de e-mail verificado e CPF/CNPJ antes do pagamento.
   ───────────────────────────────────────────────────────── */

export interface CheckoutUser {
  email: string;
  emailVerified: boolean;
  document?: string | null;
}

interface Props {
  moduleKey:   string;
  moduleLabel: string;
  moduleIcon?: string;
  priceLabel:  string;   // ex: "R$39/mês"
  features?:   string[];
  user:        CheckoutUser;
  /** Chamado após salvar CPF/CNPJ, para o chamador sincronizar o estado local do usuário. */
  onDocumentSaved?: (document: string) => void;
  onSuccess:   () => void;
  onClose:     () => void;
}

type Method = 'pix' | 'credit_card' | 'debit_card';
type Stage  = 'verify' | 'document' | 'checkout' | 'success';

interface PixData {
  qrCode:    string | null;
  qrCodeUrl: string | null;
  expiresAt: string | null;
  amount:    number;
}

/* ── Formatação ── */
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
function formatCardNumber(v: string) { return v.replace(/\D/g,'').slice(0,16).replace(/(.{4})/g,'$1 ').trim(); }
function formatExpiry(v: string) { const n = v.replace(/\D/g,'').slice(0,4); return n.length > 2 ? `${n.slice(0,2)} / ${n.slice(2)}` : n; }
function formatPostalCode(v: string) { const n = v.replace(/\D/g,'').slice(0,8); return n.length > 5 ? `${n.slice(0,5)}-${n.slice(5)}` : n; }

/* ── Normalizar mensagens de erro da API ── */
function normalizeApiError(err: any): string {
  const msg: string = err?.message || err?.error || String(err || '');
  if (!msg || msg === 'undefined') return 'Erro inesperado. Tente novamente.';
  const lower = msg.toLowerCase();
  if (lower.includes('indisponível') || lower.includes('503') || lower.includes('unavailable') || lower.includes('network') || lower.includes('fetch'))
    return 'O serviço de pagamento está temporariamente indisponível. Aguarde alguns instantes e tente novamente.';
  if (lower.includes('recusado') || lower.includes('declined') || lower.includes('refused'))
    return 'Cartão não aprovado. Verifique os dados ou tente outro cartão.';
  if (lower.includes('inválid') || lower.includes('invalid') || lower.includes('400'))
    return msg.length > 120 ? msg.slice(0, 120) + '…' : msg;
  if (lower.includes('timeout') || lower.includes('time out'))
    return 'A requisição demorou muito. Verifique sua conexão e tente novamente.';
  return msg.length > 120 ? msg.slice(0, 120) + '…' : msg;
}

const fieldStyle: React.CSSProperties = {
  width: '100%', background: 'rgb(var(--color-bg))',
  border: '1px solid rgba(var(--color-primary)/.25)',
  borderRadius: 8, padding: '10px 14px',
  color: 'rgb(var(--color-text))', fontSize: 13,
  outline: 'none', fontFamily: 'inherit',
};
const labelStyle: React.CSSProperties = {
  fontSize: 10, color: 'rgb(var(--color-text-muted))',
  fontWeight: 700, letterSpacing: '0.08em', display: 'block', marginBottom: 5,
};

/* ── Overlay genérico ── */
function Overlay({ onClick, children, wide }: { onClick: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 overflow-y-auto" onClick={onClick}>
      <div className="min-h-full flex items-start justify-center py-8 px-4">
        <div
          className={wide ? 'w-full max-w-lg rounded-2xl p-6' : 'w-full max-w-sm rounded-2xl p-6'}
          style={{ background: 'rgb(var(--color-surface-elevated))', border: '1px solid rgba(var(--color-primary)/.3)' }}
          onClick={e => e.stopPropagation()}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/* ── Modal: e-mail não verificado ── */
function VerifyEmailModal({ email, onCancel }: { email: string; onCancel: () => void }) {
  const [sending, setSending] = useState(false);
  const [sent,    setSent]    = useState(false);
  const [err,     setErr]     = useState('');

  async function resend() {
    setSending(true); setErr('');
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
    <Overlay onClick={onCancel}>
      <div className="text-center">
        <div className="w-12 h-12 rounded-full bg-brand-primary/10 flex items-center justify-center mx-auto mb-3 text-2xl">📧</div>
        <h3 className="font-bold text-base" style={{ color: 'rgb(var(--color-text))' }}>
          Confirme seu e-mail para contratar
        </h3>
        <p className="text-xs mt-2 leading-relaxed" style={{ color: 'rgb(var(--color-text-muted))' }}>
          Para sua segurança, antes de contratar um módulo precisamos confirmar que{' '}
          <strong style={{ color: 'rgb(var(--color-text-secondary))' }}>{email}</strong> é seu.
          Enviamos um link de confirmação — abra-o e clique em <strong>Confirmar meu e-mail</strong>.
        </p>
        {err && (
          <div className="text-xs px-3 py-2 rounded-lg mt-4" style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)', color: '#f87171' }}>
            {err}
          </div>
        )}
        {sent && !err && (
          <div className="text-xs px-3 py-2 rounded-lg mt-4" style={{ background: 'rgba(var(--color-primary)/.1)', border: '1px solid rgba(var(--color-primary)/.25)', color: 'rgb(var(--color-primary))' }}>
            ✓ E-mail reenviado. Confira sua caixa de entrada (e o spam).
          </div>
        )}
        <div className="flex gap-2 pt-5">
          <button type="button" onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all"
            style={{ border: '1.5px solid rgb(var(--color-border))', color: 'rgb(var(--color-text-muted))' }}>
            Fechar
          </button>
          <button type="button" onClick={resend} disabled={sending}
            className="flex-1 btn-primary py-2.5 text-sm disabled:opacity-50">
            {sending ? 'Enviando...' : sent ? 'Reenviar de novo' : 'Reenviar e-mail'}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

/* ── Modal: CPF/CNPJ obrigatório ── */
function DocumentModal({ contextLabel, onConfirm, onCancel }: {
  contextLabel: string;
  onConfirm: (document: string) => Promise<void>;
  onCancel:  () => void;
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
    setSaving(true); setErr('');
    try {
      await onConfirm(doc);
    } catch (e: any) {
      setErr(e.message || 'Erro ao salvar. Tente novamente.');
      setSaving(false);
    }
  }

  return (
    <Overlay onClick={onCancel}>
      <div className="text-center mb-5">
        <div className="w-12 h-12 rounded-full bg-brand-primary/10 flex items-center justify-center mx-auto mb-3">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" style={{ color: 'rgb(var(--color-primary))' }}>
            <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 8h10M7 12h6M7 16h4"/>
          </svg>
        </div>
        <h3 className="font-bold text-base" style={{ color: 'rgb(var(--color-text))' }}>Dados de cobrança</h3>
        <p className="text-xs mt-1" style={{ color: 'rgb(var(--color-text-muted))' }}>
          Necessário para contratar o módulo <strong style={{ color: 'rgb(var(--color-primary))' }}>{contextLabel}</strong>
        </p>
      </div>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold mb-1.5" style={{ color: 'rgb(var(--color-text-secondary))' }}>CPF ou CNPJ</label>
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
          <button type="submit" disabled={saving} className="flex-1 btn-primary py-2.5 text-sm disabled:opacity-50">
            {saving ? 'Salvando...' : 'Continuar →'}
          </button>
        </div>
      </form>
    </Overlay>
  );
}

/* ── Formulário de cartão ── */
function CardForm({ onSubmit, loading, error, submitLabel }: {
  onSubmit: (card: { holderName: string; number: string; expiryMonth: string; expiryYear: string; ccv: string; postalCode: string; addressNumber: string }) => void;
  loading: boolean;
  error: string;
  submitLabel: string;
}) {
  const [number,        setNumber]        = useState('');
  const [holderName,    setHolderName]    = useState('');
  const [expiry,        setExpiry]        = useState('');
  const [ccv,           setCcv]           = useState('');
  const [postalCode,    setPostalCode]    = useState('');
  const [addressNumber, setAddressNumber] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const [expMonth, expYear] = expiry.replace(/\s/g, '').split('/');
    onSubmit({ holderName, number, expiryMonth: expMonth?.trim() ?? '', expiryYear: expYear?.trim() ?? '', ccv, postalCode, addressNumber });
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <label style={labelStyle}>NÚMERO DO CARTÃO</label>
        <input style={fieldStyle} placeholder="0000  0000  0000  0000" value={number}
          onChange={e => setNumber(formatCardNumber(e.target.value))} maxLength={19} required autoComplete="cc-number" />
      </div>
      <div>
        <label style={labelStyle}>NOME NO CARTÃO</label>
        <input style={fieldStyle} placeholder="Como está no cartão" value={holderName}
          onChange={e => setHolderName(e.target.value.toUpperCase())} maxLength={64} required autoComplete="cc-name" />
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>VALIDADE</label>
          <input style={fieldStyle} placeholder="MM / AA" value={expiry}
            onChange={e => setExpiry(formatExpiry(e.target.value))} maxLength={7} required autoComplete="cc-exp" />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>CVV</label>
          <input style={fieldStyle} placeholder="•••" value={ccv}
            onChange={e => setCcv(e.target.value.replace(/\D/g,'').slice(0,4))} maxLength={4} required type="password" autoComplete="cc-csc" />
        </div>
      </div>
      <div style={{ borderTop: '1px solid rgba(var(--color-primary)/.12)', paddingTop: 10, marginTop: 2 }}>
        <div style={{ fontSize: 10, color: 'rgb(var(--color-text-muted))', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 8 }}>
          ENDEREÇO DE COBRANÇA
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 2 }}>
            <label style={labelStyle}>CEP</label>
            <input style={fieldStyle} placeholder="00000-000" value={postalCode}
              onChange={e => setPostalCode(formatPostalCode(e.target.value))} maxLength={9} autoComplete="postal-code" />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Nº</label>
            <input style={fieldStyle} placeholder="123" value={addressNumber}
              onChange={e => setAddressNumber(e.target.value.slice(0,20))} maxLength={20} />
          </div>
        </div>
      </div>
      {error && (
        <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#f87171' }}>
          {error}
        </div>
      )}
      <button type="submit" disabled={loading} style={{
        marginTop: 4, width: '100%',
        background: loading ? 'rgba(var(--color-primary)/.4)' : 'linear-gradient(135deg, rgb(var(--color-primary)), #059669)',
        color: '#fff', border: 'none', borderRadius: 10, padding: '13px',
        fontSize: 14, fontWeight: 700, cursor: loading ? 'default' : 'pointer',
        boxShadow: loading ? 'none' : '0 4px 20px rgba(var(--color-primary)/.3)',
      }}>
        {loading ? 'Processando...' : submitLabel}
      </button>
    </form>
  );
}

/* ── Exibição do QR Code PIX ── */
function PixDisplay({ data, onPaid, onExpire, loading }: { data: PixData; onPaid: () => void; onExpire: () => void; loading: boolean }) {
  const [copied,   setCopied]   = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const intervalRef             = useRef<any>(null);

  useEffect(() => {
    if (data.expiresAt) {
      const update = () => {
        const diff = Math.floor((new Date(data.expiresAt!).getTime() - Date.now()) / 1000);
        setTimeLeft(Math.max(0, diff));
        if (diff <= 0) clearInterval(intervalRef.current);
      };
      update();
      intervalRef.current = setInterval(update, 1000);
    }
    return () => clearInterval(intervalRef.current);
  }, [data.expiresAt]);

  function fmt(s: number) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}min`;
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  const expired = timeLeft !== null && timeLeft === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ background: 'rgba(var(--color-primary)/.06)', border: '1px solid rgba(var(--color-primary)/.2)', borderRadius: 10, padding: '12px 14px', fontSize: 12, color: 'rgb(var(--color-text-secondary))' }}>
        ⚡ Escaneie o QR code com o app do seu banco ou copie o código PIX.
        O módulo é <strong>ativado automaticamente</strong> após a confirmação.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
        {expired ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '24px 0' }}>
            <div style={{ fontSize: 13, color: '#f87171', fontWeight: 700 }}>⏱ QR Code expirado</div>
            <div style={{ fontSize: 11, color: 'rgb(var(--color-text-muted))', textAlign: 'center' }}>O prazo de 3 horas para pagamento encerrou.</div>
            <button onClick={onExpire} style={{ background: 'rgba(var(--color-primary)/.12)', border: '1px solid rgba(var(--color-primary)/.3)', borderRadius: 8, padding: '8px 20px', fontSize: 12, color: 'rgb(var(--color-primary))', cursor: 'pointer', fontWeight: 700 }}>
              🔄 Gerar novo PIX
            </button>
          </div>
        ) : (
          <>
            {data.qrCodeUrl ? (
              <img src={data.qrCodeUrl} alt="QR Code PIX" width={160} height={160}
                style={{ borderRadius: 10, border: '2px solid rgba(var(--color-primary)/.3)', background: 'white', padding: 4 }} />
            ) : (
              <div style={{ width: 160, height: 160, background: 'rgba(var(--color-primary)/.05)', border: '1px dashed rgba(var(--color-primary)/.3)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'rgb(var(--color-text-muted))' }}>
                Gerando QR Code...
              </div>
            )}
            {timeLeft !== null && (
              <div style={{ fontSize: 12, color: timeLeft < 300 ? '#f87171' : 'rgb(var(--color-text-muted))' }}>
                Válido por <strong style={{ color: timeLeft < 300 ? '#f87171' : 'rgb(var(--color-primary))' }}>{fmt(timeLeft)}</strong>
              </div>
            )}
          </>
        )}
      </div>
      {data.qrCode && (
        <div>
          <div style={{ fontSize: 10, color: 'rgb(var(--color-text-muted))', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 6 }}>
            CÓDIGO PIX (COPIA E COLA)
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ flex: 1, background: 'rgb(var(--color-bg))', border: '1px solid rgba(var(--color-primary)/.2)', borderRadius: 8, padding: '8px 12px', fontSize: 10, color: 'rgb(var(--color-text-muted))', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontFamily: 'monospace' }}>
              {data.qrCode}
            </div>
            <button
              onClick={() => { navigator.clipboard.writeText(data.qrCode!); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
              style={{ background: copied ? 'rgba(var(--color-primary)/.2)' : 'rgba(var(--color-primary)/.08)', border: '1px solid rgba(var(--color-primary)/.25)', borderRadius: 8, padding: '8px 12px', fontSize: 11, color: 'rgb(var(--color-primary))', cursor: 'pointer', fontWeight: 700, whiteSpace: 'nowrap' }}
            >
              {copied ? '✓ Copiado' : 'Copiar'}
            </button>
          </div>
        </div>
      )}
      <div style={{ fontSize: 10, color: 'rgb(var(--color-text-muted))', textAlign: 'center' }}>
        Valor: <strong style={{ color: 'rgb(var(--color-primary))' }}>R$ {data.amount.toFixed(2).replace('.', ',')}</strong>
      </div>
      <button onClick={onPaid} disabled={loading} style={{
        background: loading ? 'rgba(var(--color-primary)/.3)' : 'linear-gradient(135deg, rgb(var(--color-primary)), #059669)',
        color: '#fff', border: 'none', borderRadius: 10, padding: '12px',
        fontSize: 13, fontWeight: 700, cursor: loading ? 'default' : 'pointer',
      }}>
        {loading ? 'Verificando...' : '✓ Já paguei — verificar'}
      </button>
    </div>
  );
}

const METHODS: { id: Method; label: string; icon: string; sub: string }[] = [
  { id: 'pix',         label: 'PIX',     icon: '⚡', sub: 'QR code — ativação imediata após confirmação' },
  { id: 'credit_card', label: 'Crédito', icon: '💳', sub: 'Cobrança mensal automática' },
  { id: 'debit_card',  label: 'Débito',  icon: '🏦', sub: 'Débito no cartão' },
];

/* ── Corpo do checkout (após os gates) ── */
function CheckoutBody({ moduleKey, moduleLabel, priceLabel, onSuccess }: {
  moduleKey: string; moduleLabel: string; priceLabel: string; onSuccess: () => void;
}) {
  const [method,  setMethod]  = useState<Method>('pix');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [pixData, setPixData] = useState<PixData | null>(null);
  const [done,    setDone]    = useState(false);

  function handleMethodChange(m: Method) {
    setMethod(m); setPixData(null); setError('');
  }

  async function handleCardSubmit(card: {
    holderName: string; number: string; expiryMonth: string; expiryYear: string;
    ccv: string; postalCode: string; addressNumber: string;
  }) {
    setLoading(true); setError('');
    try {
      const res = await api.post<any>(`/billing/modules/${moduleKey}/subscribe`, {
        paymentMethod: method,
        card: {
          holderName:  card.holderName,
          number:      card.number.replace(/\s/g, ''),
          expiryMonth: card.expiryMonth,
          expiryYear:  card.expiryYear,
          ccv:         card.ccv,
        },
        billingAddress: {
          postalCode:    card.postalCode?.replace(/\D/g, '') || undefined,
          addressNumber: card.addressNumber || undefined,
        },
      });
      if (res.status === 'active') {
        setDone(true);
        setTimeout(onSuccess, 1500);
      } else {
        setError('Cartão não aprovado. Verifique os dados e tente novamente.');
      }
    } catch (err: any) {
      setError(normalizeApiError(err));
    } finally {
      setLoading(false);
    }
  }

  async function handlePixSubmit() {
    setLoading(true); setError('');
    try {
      const res = await api.post<any>(`/billing/modules/${moduleKey}/subscribe`, { paymentMethod: 'pix' });
      if (res.status === 'active') {
        setDone(true);
        setTimeout(onSuccess, 1500);
        return;
      }
      if (res.status === 'pending_pix') {
        setPixData({
          qrCode:    res.qrCode    || null,
          qrCodeUrl: res.qrCodeUrl || null,
          expiresAt: res.expiresAt || null,
          amount:    res.proratedAmount || 0,
        });
      } else {
        setError('Erro ao gerar PIX. Tente novamente.');
      }
    } catch (err: any) {
      setError(normalizeApiError(err));
    } finally {
      setLoading(false);
    }
  }

  async function handlePixPaid() {
    setLoading(true);
    try {
      const res = await api.get<any>('/billing/sync');
      if (res.synced) {
        setDone(true);
        setTimeout(onSuccess, 1500);
      } else {
        setError('Pagamento ainda não confirmado. Aguarde alguns segundos e tente novamente.');
      }
    } catch (err: any) {
      setError(normalizeApiError(err));
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div style={{ padding: '32px 24px', textAlign: 'center', background: 'rgba(var(--color-primary)/.05)', borderRadius: 14, border: '1px solid rgba(var(--color-primary)/.2)' }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(var(--color-primary)/.15)', border: '2px solid rgba(var(--color-primary)/.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px', fontSize: 24 }}>✓</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: 'rgb(var(--color-primary))', marginBottom: 6 }}>Módulo ativado!</div>
        <div style={{ fontSize: 13, color: 'rgb(var(--color-text-secondary))' }}>
          <strong>{moduleLabel}</strong> está ativo na sua conta. Redirecionando...
        </div>
      </div>
    );
  }

  const activeMethod = METHODS.find(m => m.id === method)!;

  return (
    <div>
      <div style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgba(var(--color-primary)/.15)', borderRadius: '12px 12px 0 0', padding: '12px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: 'none' }}>
        <div>
          <div style={{ fontSize: 10, color: 'rgb(var(--color-text-muted))' }}>Contratando</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'rgb(var(--color-text))' }}>{moduleLabel}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'rgb(var(--color-text-secondary))' }}>{priceLabel}</span>
        </div>
      </div>

      <div style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgba(var(--color-primary)/.2)', borderTop: 'none', borderRadius: '0 0 14px 14px', overflow: 'hidden' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, padding: '13px 15px', background: 'rgb(var(--color-bg))', borderBottom: '1px solid rgb(var(--color-border))' }}>
          {METHODS.map(m => {
            const active = method === m.id;
            return (
              <button
                key={m.id}
                onClick={() => handleMethodChange(m.id)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                  padding: '9px 8px', minWidth: 68,
                  borderRadius: 10, cursor: 'pointer',
                  border: `1.5px solid ${active ? 'rgb(var(--color-primary))' : 'rgba(var(--color-primary)/.2)'}`,
                  background: active ? 'rgba(var(--color-primary)/.1)' : 'transparent',
                  color: active ? 'rgb(var(--color-primary))' : 'rgb(var(--color-text-muted))',
                  boxShadow: active ? '0 0 0 2px rgba(var(--color-primary)/.15)' : 'none',
                  transition: 'all 0.15s',
                }}
              >
                <span style={{ fontSize: 16 }}>{m.icon}</span>
                <span style={{ fontSize: 9, fontWeight: active ? 700 : 400 }}>{m.label}</span>
              </button>
            );
          })}
        </div>

        <div style={{ padding: '20px 18px', minHeight: 260, display: 'flex', flexDirection: 'column' }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'rgb(var(--color-text))' }}>{activeMethod.label}</div>
            <div style={{ fontSize: 11, color: 'rgb(var(--color-text-muted))', marginTop: 2 }}>{activeMethod.sub}</div>
          </div>

          {(method === 'credit_card' || method === 'debit_card') && (
            <CardForm
              onSubmit={handleCardSubmit}
              loading={loading}
              error={error}
              submitLabel={`Assinar — ${priceLabel}`}
            />
          )}

          {method === 'pix' && !pixData && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ background: 'rgba(var(--color-primary)/.06)', border: '1px solid rgba(var(--color-primary)/.2)', borderRadius: 10, padding: '12px 14px', fontSize: 12, color: 'rgb(var(--color-text-secondary))' }}>
                Gere um QR code PIX para contratar agora. Um novo código será gerado mensalmente para renovação.
              </div>
              {error && (
                <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#f87171' }}>
                  {error}
                </div>
              )}
              <button onClick={handlePixSubmit} disabled={loading} style={{
                background: loading ? 'rgba(var(--color-primary)/.3)' : 'linear-gradient(135deg, rgb(var(--color-primary)), #059669)',
                color: '#fff', border: 'none', borderRadius: 10, padding: '13px',
                fontSize: 14, fontWeight: 700, cursor: loading ? 'default' : 'pointer',
              }}>
                {loading ? 'Gerando...' : `⚡ Gerar QR Code PIX — ${priceLabel}`}
              </button>
            </div>
          )}

          {method === 'pix' && pixData && (
            <PixDisplay data={pixData} onPaid={handlePixPaid} onExpire={() => setPixData(null)} loading={loading} />
          )}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10, padding: '0 4px' }}>
        <span style={{ fontSize: 10, color: 'rgb(var(--color-text-muted))', display: 'flex', alignItems: 'center', gap: 5 }}>
          🔒 PCI DSS · SSL 256-bit · Asaas
        </span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Componente principal — orquestra os gates + checkout
   ══════════════════════════════════════════════════════ */
export default function ModuleCheckout({
  moduleKey, moduleLabel, moduleIcon, priceLabel, features = [],
  user, onDocumentSaved, onSuccess, onClose,
}: Props) {
  const [stage, setStage] = useState<Stage>(
    !user.emailVerified ? 'verify' : !user.document ? 'document' : 'checkout',
  );

  async function handleDocumentConfirm(document: string) {
    await api.put('/auth/profile', { document });
    onDocumentSaved?.(document);
    setStage('checkout');
  }

  if (stage === 'verify') {
    return <VerifyEmailModal email={user.email} onCancel={onClose} />;
  }

  if (stage === 'document') {
    return (
      <DocumentModal
        contextLabel={moduleLabel}
        onConfirm={handleDocumentConfirm}
        onCancel={onClose}
      />
    );
  }

  return (
    <Overlay onClick={onClose} wide>
      <div className="mb-5">
        <h3 className="font-bold text-base flex items-center gap-2" style={{ color: 'rgb(var(--color-text))' }}>
          {moduleIcon && <span>{moduleIcon}</span>} Contratar {moduleLabel}
        </h3>
        {features.length > 0 && (
          <p className="text-xs mt-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>
            {features.join(' · ')}
          </p>
        )}
      </div>
      <CheckoutBody moduleKey={moduleKey} moduleLabel={moduleLabel} priceLabel={priceLabel} onSuccess={onSuccess} />
    </Overlay>
  );
}
