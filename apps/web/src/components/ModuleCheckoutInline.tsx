'use client';
import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';

/* ─────────────────────────────────────────────────────────
   ModuleCheckoutInline — Checkout Transparente Asaas p/ módulos da suíte
   Mirror leve de CheckoutInline.tsx (que é tipado só para 'pro'|'executive').
   Métodos: PIX · Crédito. Chama POST /billing/modules/:key/subscribe.
   ───────────────────────────────────────────────────────── */

interface Props {
  moduleKey:   string;
  moduleName:  string;
  /** Preço mensal já formatado, ex.: "R$49,90" */
  priceLabel:  string;
  onSuccess:   (moduleKey: string) => void;
  onCancel:    () => void;
}

type Method = 'pix' | 'credit_card';

interface PixData {
  qrCode:    string | null;
  qrCodeUrl: string | null;
  expiresAt: string | null;
  amount:    number;
}

/* ── Formatação (mesmas regras do CheckoutInline) ── */
function formatCardNumber(v: string) { return v.replace(/\D/g,'').slice(0,16).replace(/(.{4})/g,'$1 ').trim(); }
function formatExpiry(v: string) { const n = v.replace(/\D/g,'').slice(0,4); return n.length > 2 ? `${n.slice(0,2)} / ${n.slice(2)}` : n; }
function formatPostalCode(v: string) { const n = v.replace(/\D/g,'').slice(0,8); return n.length > 5 ? `${n.slice(0,5)}-${n.slice(5)}` : n; }

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

/* ── Normalizar mensagens de erro da API ── */
function normalizeApiError(err: any): string {
  if (err?.moduleRequired) return `Este módulo requer o módulo "${err.moduleRequired}" ativo primeiro.`;
  const msg: string = err?.message || err?.error || String(err || '');
  if (!msg || msg === 'undefined') return 'Erro inesperado. Tente novamente.';

  const lower = msg.toLowerCase();
  if (lower.includes('indisponível') || lower.includes('503') || lower.includes('unavailable') || lower.includes('network') || lower.includes('fetch'))
    return 'O serviço de pagamento está temporariamente indisponível. Aguarde alguns instantes e tente novamente.';
  if (lower.includes('recusado') || lower.includes('declined') || lower.includes('refused'))
    return 'Cartão não aprovado. Verifique os dados ou tente outro cartão.';
  if (lower.includes('inválid') || lower.includes('invalid') || lower.includes('400'))
    return 'Dados de pagamento inválidos. Verifique as informações e tente novamente.';
  if (lower.includes('timeout') || lower.includes('time out'))
    return 'A requisição demorou muito. Verifique sua conexão e tente novamente.';

  return msg.length > 120 ? msg.slice(0, 120) + '…' : msg;
}

/* ── Formulário de cartão de crédito ── */
function CardForm({ onSubmit, loading, error, submitLabel }: {
  onSubmit: (card: { holderName: string; number: string; expiryMonth: string; expiryYear: string; ccv: string; postalCode: string; addressNumber: string }) => void;
  loading:     boolean;
  error:       string;
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

/* ── Display QR Code PIX ── */
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

/* ── Área de geração PIX (antes do QR) ── */
function PixGenerateArea({ loading, error, onGenerate, priceLabel }: {
  loading:    boolean;
  error:      string;
  onGenerate: () => void;
  priceLabel: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ background: 'rgba(var(--color-primary)/.06)', border: '1px solid rgba(var(--color-primary)/.2)', borderRadius: 10, padding: '12px 14px', fontSize: 12, color: 'rgb(var(--color-text-secondary))' }}>
        Gere um QR code PIX para contratar agora. A cobrança é proporcional ao período restante do seu ciclo atual.
      </div>
      {error && (
        <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#f87171' }}>
          {error}
        </div>
      )}
      <button onClick={onGenerate} disabled={loading} style={{
        background: loading ? 'rgba(var(--color-primary)/.3)' : 'linear-gradient(135deg, rgb(var(--color-primary)), #059669)',
        color: '#fff', border: 'none', borderRadius: 10, padding: '13px',
        fontSize: 14, fontWeight: 700, cursor: loading ? 'default' : 'pointer',
      }}>
        {loading ? 'Gerando...' : `⚡ Gerar QR Code PIX — ${priceLabel}`}
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Componente principal
   ══════════════════════════════════════════════════════ */
export default function ModuleCheckoutInline({ moduleKey, moduleName, priceLabel, onSuccess, onCancel }: Props) {
  const [method,  setMethod]  = useState<Method>('pix');
  const [step,    setStep]    = useState<2 | 3>(2);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [pixData, setPixData] = useState<PixData | null>(null);
  const [successMsg, setSuccessMsg] = useState('');

  function handleMethodChange(m: Method) {
    setMethod(m);
    setPixData(null);
    setError('');
  }

  async function handleCardSubmit(card: {
    holderName: string; number: string; expiryMonth: string; expiryYear: string;
    ccv: string; postalCode: string; addressNumber: string;
  }) {
    setLoading(true); setError('');
    try {
      const cardPayload = {
        holderName:  card.holderName,
        number:      card.number.replace(/\s/g, ''),
        expiryMonth: card.expiryMonth,
        expiryYear:  card.expiryYear,
        ccv:         card.ccv,
      };
      const billingAddress = {
        postalCode:    card.postalCode?.replace(/\D/g, '') || undefined,
        addressNumber: card.addressNumber || undefined,
      };
      const res = await api.post<any>(`/billing/modules/${moduleKey}/subscribe`, {
        paymentMethod: 'credit_card',
        card: cardPayload,
        billingAddress,
      });
      if (res.status === 'active') {
        setSuccessMsg(res.message || '');
        setStep(3);
        setTimeout(() => onSuccess(moduleKey), 1500);
      } else {
        setError(normalizeApiError(res.error || 'Cartão não aprovado. Verifique os dados e tente novamente.'));
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
        setSuccessMsg(res.message || '');
        setStep(3);
        setTimeout(() => onSuccess(moduleKey), 1500);
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
        setError(normalizeApiError(res.error || 'Erro ao gerar PIX. Tente novamente.'));
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
        setStep(3);
        setTimeout(() => onSuccess(moduleKey), 1500);
      } else {
        setError('Pagamento ainda não confirmado. Aguarde alguns segundos e tente novamente.');
      }
    } catch (err: any) {
      setError(normalizeApiError(err));
    } finally {
      setLoading(false);
    }
  }

  if (step === 3) {
    return (
      <div style={{ padding: '32px 24px', textAlign: 'center', background: 'rgba(var(--color-primary)/.05)', borderRadius: 14, border: '1px solid rgba(var(--color-primary)/.2)' }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(var(--color-primary)/.15)', border: '2px solid rgba(var(--color-primary)/.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px', fontSize: 24 }}>
          ✓
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, color: 'rgb(var(--color-primary))', marginBottom: 6 }}>
          Módulo ativado!
        </div>
        <div style={{ fontSize: 13, color: 'rgb(var(--color-text-secondary))' }}>
          {successMsg || <>O módulo <strong>{moduleName}</strong> está ativo. Redirecionando...</>}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Resumo do módulo */}
      <div style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgba(var(--color-primary)/.15)', borderRadius: '12px 12px 0 0', padding: '12px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: 'none' }}>
        <div>
          <div style={{ fontSize: 10, color: 'rgb(var(--color-text-muted))' }}>Contratando módulo</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'rgb(var(--color-text))' }}>{moduleName}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'rgb(var(--color-text-secondary))' }}>{priceLabel}</span>
            <span style={{ fontSize: 11, color: 'rgb(var(--color-text-muted))' }}>/mês</span>
          </div>
        </div>
      </div>

      {/* Corpo do checkout */}
      <div style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgba(var(--color-primary)/.2)', borderTop: 'none', borderRadius: '0 0 14px 14px', overflow: 'hidden' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, padding: '13px 15px', background: 'rgb(var(--color-bg))', borderBottom: '1px solid rgb(var(--color-border))' }}>
          {([
            { id: 'pix' as const,         label: 'PIX',     icon: '⚡', sub: 'QR code — ativa na confirmação' },
            { id: 'credit_card' as const, label: 'Crédito', icon: '💳', sub: 'Cobrança aprovada na hora' },
          ]).map(m => {
            const active = method === m.id;
            return (
              <button
                key={m.id}
                onClick={() => handleMethodChange(m.id)}
                style={{
                  position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                  padding: '9px 8px', minWidth: 68,
                  borderRadius: 10, cursor: 'pointer',
                  border: `1.5px solid ${active ? 'rgb(var(--color-primary))' : 'rgba(var(--color-primary)/.2)'}`,
                  background: active ? 'rgba(var(--color-primary)/.1)' : 'transparent',
                  color: active ? 'rgb(var(--color-primary))' : 'rgb(var(--color-text-muted))',
                  boxShadow: active ? '0 0 0 2px rgba(var(--color-primary)/.15)' : 'none',
                  transition: 'all 0.15s',
                }}
              >
                <span style={{ height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>{m.icon}</span>
                <span style={{ fontSize: 9, fontWeight: active ? 700 : 400, textAlign: 'center', lineHeight: 1.2, whiteSpace: 'nowrap' }}>{m.label}</span>
              </button>
            );
          })}
        </div>

        <div style={{ padding: '20px 18px', minHeight: 260, display: 'flex', flexDirection: 'column' }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'rgb(var(--color-text))' }}>
              {method === 'pix' ? 'PIX' : 'Crédito'}
            </div>
            <div style={{ fontSize: 11, color: 'rgb(var(--color-text-muted))', marginTop: 2 }}>
              {method === 'pix' ? 'QR code — ativa na confirmação' : 'Cobrança aprovada na hora'}
            </div>
          </div>

          {method === 'credit_card' && (
            <CardForm
              onSubmit={handleCardSubmit}
              loading={loading}
              error={error}
              submitLabel={`Contratar — ${priceLabel}/mês`}
            />
          )}

          {method === 'pix' && !pixData && (
            <PixGenerateArea loading={loading} error={error} onGenerate={handlePixSubmit} priceLabel={priceLabel} />
          )}

          {method === 'pix' && pixData && (
            <PixDisplay data={pixData} onPaid={handlePixPaid} onExpire={() => setPixData(null)} loading={loading} />
          )}
        </div>
      </div>

      {/* Rodapé */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, padding: '0 4px' }}>
        <span style={{ fontSize: 10, color: 'rgb(var(--color-text-muted))', display: 'flex', alignItems: 'center', gap: 5 }}>
          🔒 PCI DSS · SSL 256-bit · Asaas
        </span>
        <button onClick={onCancel} style={{ background: 'none', border: 'none', fontSize: 11, color: 'rgb(var(--color-text-muted))', cursor: 'pointer' }}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
