'use client';
import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';

/* ─────────────────────────────────────────────────────────
   CheckoutInline — Checkout Transparente Asaas
   Métodos: PIX · PIX Automático · Crédito · Débito ·
            Google Pay · Apple Pay · PayPal (em breve)
   ───────────────────────────────────────────────────────── */

interface Props {
  planName:   'pro' | 'executive';
  planLabel:  string;
  planPrice:  string;
  planFeats:  string[];
  isUpgrade?: boolean;
  onSuccess:  (planName: string) => void;
  onCancel:   () => void;
}

/* ── Preços anuais (20% off — 12× com desconto) ── */
const CHECKOUT_YEARLY: Record<string, { annual: string; monthlyEq: string; annualNum: number }> = {
  pro:       { annual: 'R$383,04', monthlyEq: 'R$31,92/mês', annualNum: 383.04 },
  executive: { annual: 'R$479,04', monthlyEq: 'R$39,92/mês', annualNum: 479.04 },
};

type Method = 'pix' | 'pix_auto' | 'credit_card' | 'debit_card' | 'google_pay' | 'apple_pay' | 'paypal';

interface PixData {
  qrCode:    string | null;
  qrCodeUrl: string | null;
  expiresAt: string | null;
  amount:    number;
}

/* ── SVG Icons ── */
const GooglePaySvg = () => (
  <svg viewBox="0 0 41 17" height="13" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M19.526 2.635v4.083h2.518c.6 0 1.096-.202 1.488-.605.403-.402.605-.882.605-1.437 0-.544-.202-1.018-.605-1.422-.392-.413-.888-.62-1.488-.62h-2.518zm0 5.52v4.736h-1.504V1.198h3.99c1.013 0 1.873.337 2.582 1.012.72.675 1.08 1.497 1.08 2.466 0 .99-.36 1.818-1.08 2.482-.699.665-1.559.997-2.582.997h-2.486z" fill="#4285F4"/>
    <path d="M28.873 4.488c1.002 0 1.79.268 2.365.803.576.536.864 1.27.864 2.203v4.397h-1.437v-.99h-.057c-.556.816-1.296 1.224-2.22 1.224-.789 0-1.449-.234-1.98-.702-.53-.469-.796-1.056-.796-1.76 0-.744.281-1.337.844-1.779.562-.451 1.313-.677 2.253-.677.901 0 1.642.165 2.22.496v-.347c0-.521-.204-.964-.61-1.327a2.132 2.132 0 0 0-1.456-.547c-.844 0-1.51.357-2.001 1.07l-1.323-.835c.728-1.045 1.81-1.229 2.334-1.229zm-2.792 5.177c0 .352.149.648.445.888.297.24.651.36 1.063.36.576 0 1.09-.213 1.543-.64.452-.428.678-.931.678-1.51-.428-.34-1.023-.51-1.787-.51-.556 0-1.02.134-1.391.403-.372.268-.551.6-.551.997v.012z" fill="#EA4335"/>
    <path d="M38.673 4.722l-5.01 11.52h-1.551l1.856-4.02-3.292-7.5h1.637l2.375 5.729h.034l2.309-5.73h1.642z" fill="#4285F4"/>
    <path d="M13.448 7.134c0-.463-.04-.909-.117-1.34H6.894v2.538h3.681a3.146 3.146 0 0 1-1.363 2.066v1.713h2.205c1.29-1.187 2.031-2.935 2.031-4.977z" fill="#4285F4"/>
    <path d="M6.894 13.67c1.846 0 3.396-.61 4.527-1.659l-2.205-1.713c-.612.41-1.395.65-2.322.65-1.785 0-3.297-1.205-3.838-2.824H.794v1.768A6.843 6.843 0 0 0 6.894 13.67z" fill="#34A853"/>
    <path d="M3.056 8.124a4.11 4.11 0 0 1 0-2.63V3.726H.794a6.845 6.845 0 0 0 0 6.166l2.262-1.768z" fill="#FBBC05"/>
    <path d="M6.894 2.67c1.005 0 1.908.346 2.617 1.024l1.959-1.96C10.285.605 8.74 0 6.894 0A6.843 6.843 0 0 0 .794 3.726l2.262 1.768c.541-1.619 2.053-2.824 3.838-2.824z" fill="#EA4335"/>
  </svg>
);

const ApplePaySvg = () => (
  <svg viewBox="0 0 50 20" height="13" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M9.552 2.821c-.53.637-1.384 1.133-2.237 1.063-.106-.853.313-1.76.8-2.32C8.644.927 9.558.466 10.305.43c.088.889-.248 1.755-.753 2.391zm.744 1.185c-1.237-.07-2.29.7-2.879.7-.597 0-1.499-.668-2.483-.65-1.28.018-2.464.743-3.115 1.89-1.337 2.297-.35 5.697.946 7.571.633.923 1.39 1.942 2.39 1.907.946-.035 1.311-.613 2.457-.613 1.148 0 1.479.613 2.49.595 1.035-.018 1.68-.925 2.314-1.847.723-1.055 1.019-2.08 1.036-2.133-.018-.018-1.994-.77-2.012-3.049-.018-1.908 1.557-2.82 1.628-2.872-.893-1.318-2.27-1.464-2.772-1.499zm7.026-2.54v13.373h2.074V10.74h2.876c2.63 0 4.477-1.805 4.477-4.44 0-2.633-1.81-4.42-4.404-4.42l-5.023-.014zm2.074 1.75h2.394c1.806 0 2.836.963 2.836 2.671 0 1.709-1.03 2.68-2.845 2.68h-2.385V3.216zm11.018 11.69c1.305 0 2.515-.66 3.06-1.709h.044v1.604h1.917V7.994c0-1.928-1.543-3.17-3.912-3.17-2.204 0-3.83 1.26-3.891 2.99h1.864c.157-.824.918-1.365 1.97-1.365 1.27 0 1.978.596 1.978 1.691v.742l-2.589.157c-2.405.145-3.707 1.13-3.707 2.847 0 1.734 1.341 2.89 3.266 2.89zm.558-1.594c-1.107 0-1.813-.532-1.813-1.347 0-.843.68-1.33 1.979-1.409l2.301-.14v.76c0 1.233-1.047 2.136-2.467 2.136zm8.175 5.233c2.023 0 2.975-.77 3.804-3.1l3.643-10.221h-2.126l-2.44 7.895h-.044l-2.44-7.895h-2.178l3.522 9.75-.19.588c-.315.997-.83 1.382-1.75 1.382-.165 0-.486-.018-.617-.035v1.6c.122.026.583.036.816.036z"/>
  </svg>
);

const PayPalSvg = ({ size = 15 }: { size?: number }) => (
  <svg viewBox="0 0 24 28" height={size} fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M19.5 6C19.5 10.142 16.142 13.5 12 13.5H7.5L6 22.5H2L5 4.5H12C16.142 4.5 19.5 2.358 19.5 6Z" fill="#003087"/>
    <path d="M21.5 9.5C21.5 13.642 18.142 17 14 17H9.5L8 26H4L7 8.5H14C18.142 8.5 21.5 6.358 21.5 9.5Z" fill="#009cde" opacity="0.9"/>
  </svg>
);

/* ── Classificações de método ── */
function toBackendMethod(m: Method): string {
  if (m === 'google_pay' || m === 'apple_pay') return 'pix';
  return m; // pix, pix_auto, credit_card, debit_card — passam diretamente
}
const isCardMethod = (m: Method) => m === 'credit_card' || m === 'debit_card';
const isPixMethod  = (m: Method) => m === 'pix' || m === 'pix_auto' || m === 'google_pay' || m === 'apple_pay';

/* ── Definições de métodos ── */
// Usar referências de componente (não instâncias JSX) para evitar problemas de hidratação SSR
type MethodDef = {
  id:           Method;
  label:        string;
  Icon:         React.ComponentType | string; // componente ou emoji
  sub:          string;
  comingSoon?:  boolean;
};
const METHODS: MethodDef[] = [
  { id: 'pix',         label: 'PIX',         Icon: '⚡',        sub: 'QR code por ciclo mensal' },
  { id: 'pix_auto',   label: 'PIX Auto',     Icon: '🔄',        sub: 'Débito automático via PIX' },
  { id: 'credit_card', label: 'Crédito',     Icon: '💳',        sub: 'Cobrança mensal automática' },
  { id: 'debit_card',  label: 'Débito',      Icon: '🏦',        sub: 'Débito no cartão' },
  { id: 'google_pay',  label: 'Google Pay',  Icon: GooglePaySvg, sub: 'Pague com Google Pay' },
  { id: 'apple_pay',   label: 'Apple Pay',   Icon: ApplePaySvg,  sub: 'Pague com Apple Pay' },
  { id: 'paypal',      label: 'PayPal',      Icon: PayPalSvg,    sub: 'Em breve', comingSoon: true },
];

/* ── Formatação ── */
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

/* ── Formulário de Cartão (Crédito ou Débito) ── */
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
        A assinatura é <strong>ativada automaticamente</strong> após a confirmação.
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
function PixGenerateArea({ method, hasApplePay, loading, error, onGenerate, planPrice, isUpgrade }: {
  method:      Method;
  hasApplePay: boolean;
  loading:     boolean;
  error:       string;
  onGenerate:  () => void;
  planPrice:   string;
  isUpgrade:   boolean;
}) {
  if (method === 'apple_pay' && !hasApplePay) {
    return (
      <div style={{ textAlign: 'center', padding: '28px 16px' }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>🍎</div>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Apple Pay não disponível</div>
        <div style={{ fontSize: 11, color: 'rgb(var(--color-text-muted))', lineHeight: 1.6 }}>
          Use Safari no iPhone ou Mac com Apple Pay configurado.
        </div>
      </div>
    );
  }

  const descs: Partial<Record<Method, string>> = {
    pix:        isUpgrade
                  ? 'Gere o PIX para pagar a diferença proporcional do upgrade. A assinatura é atualizada após confirmação.'
                  : 'Gere um QR code PIX para assinar agora. Um novo código será gerado mensalmente para renovação.',
    pix_auto:   'O PIX Automático autoriza débitos mensais recorrentes. Escaneie o QR e autorize no app do seu banco — você não precisará pagar manualmente nos meses seguintes.',
    google_pay: 'Gere o QR code PIX e escaneie com o app Google Pay para concluir o pagamento.',
    apple_pay:  'Gere o QR code PIX e escaneie com a câmera do iPhone ou Apple Wallet para concluir o pagamento.',
  };

  const btnLabels: Partial<Record<Method, string>> = {
    pix:        `⚡ Gerar QR Code PIX — ${planPrice}`,
    pix_auto:   `🔄 Ativar PIX Automático — ${planPrice}/mês`,
    google_pay: '⚡ Gerar QR Code PIX',
    apple_pay:  '⚡ Gerar QR Code PIX',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ background: 'rgba(var(--color-primary)/.06)', border: '1px solid rgba(var(--color-primary)/.2)', borderRadius: 10, padding: '12px 14px', fontSize: 12, color: 'rgb(var(--color-text-secondary))' }}>
        {descs[method]}
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
        {loading ? 'Gerando...' : (btnLabels[method] || 'Gerar PIX')}
      </button>
    </div>
  );
}

/* ── Banner de instrução carteira digital ── */
function WalletBanner({ method }: { method: 'google_pay' | 'apple_pay' }) {
  const info = {
    google_pay: { icon: <GooglePaySvg />, text: 'Abra o Google Pay → Pagar → Escanear QR Code ou Cole o código' },
    apple_pay:  { icon: <ApplePaySvg />, text: 'Aponte a câmera do iPhone para o QR, ou use o Apple Wallet → PIX' },
  };
  const { icon, text } = info[method];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(var(--color-primary)/.07)', border: '1px solid rgba(var(--color-primary)/.2)', borderRadius: 10, padding: '10px 14px', marginBottom: 12 }}>
      <span style={{ display: 'flex', alignItems: 'center', height: 20, flexShrink: 0 }}>{icon}</span>
      <span style={{ fontSize: 11, color: 'rgb(var(--color-text-secondary))' }}>{text}</span>
    </div>
  );
}

/* ── Banner PIX Automático ── */
function PixAutoBanner() {
  return (
    <div style={{ background: 'rgba(var(--color-primary)/.07)', border: '1px solid rgba(var(--color-primary)/.2)', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 11, color: 'rgb(var(--color-text-secondary))' }}>
      🔄 <strong>Após pagar</strong>, autorize os débitos automáticos no app do seu banco. Você não precisará pagar manualmente nos ciclos seguintes.
    </div>
  );
}

/* ── PayPal — Em breve ── */
function PayPalSection() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '32px 16px', textAlign: 'center' }}>
      <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(0,48,135,.08)', border: '2px solid rgba(0,48,135,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <PayPalSvg size={24} />
      </div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'rgb(var(--color-text))', marginBottom: 6 }}>
          PayPal — Em breve
        </div>
        <div style={{ fontSize: 12, color: 'rgb(var(--color-text-muted))', lineHeight: 1.7 }}>
          O pagamento via PayPal estará disponível em breve.<br />
          Por enquanto use PIX, PIX Automático ou cartão.
        </div>
      </div>
    </div>
  );
}

/* ── Normalizar mensagens de erro da API ── */
function normalizeApiError(err: any): string {
  const msg: string = err?.message || err?.error || String(err || '');
  if (!msg || msg === 'undefined') return 'Erro inesperado. Tente novamente.';

  const lower = msg.toLowerCase();
  // Erros de serviço / infraestrutura
  if (lower.includes('indisponível') || lower.includes('503') || lower.includes('unavailable') || lower.includes('network') || lower.includes('fetch'))
    return 'O serviço de pagamento está temporariamente indisponível. Aguarde alguns instantes e tente novamente.';
  // Cartão recusado
  if (lower.includes('recusado') || lower.includes('declined') || lower.includes('refused'))
    return 'Cartão não aprovado. Verifique os dados ou tente outro cartão.';
  // Dados inválidos
  if (lower.includes('inválid') || lower.includes('invalid') || lower.includes('400'))
    return 'Dados de pagamento inválidos. Verifique as informações e tente novamente.';
  // Timeout
  if (lower.includes('timeout') || lower.includes('time out'))
    return 'A requisição demorou muito. Verifique sua conexão e tente novamente.';

  // Mensagem original se não encaixou em nenhum padrão
  return msg.length > 120 ? msg.slice(0, 120) + '…' : msg;
}

/* ═══════════════════════════════════════════════════════
   Componente principal
   ══════════════════════════════════════════════════════ */
export default function CheckoutInline({
  planName, planLabel, planPrice, planFeats, isUpgrade = false, onSuccess, onCancel,
}: Props) {
  const [method,        setMethod]        = useState<Method>('pix');
  const [step,          setStep]          = useState<1|2|3>(2);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState('');
  const [pixData,       setPixData]       = useState<PixData | null>(null);
  const [hasApplePay,   setHasApplePay]   = useState(false);
  const [billingCycle,  setBillingCycle]  = useState<'monthly' | 'yearly'>('monthly');

  const isYearly    = billingCycle === 'yearly';
  const yearlyInfo  = CHECKOUT_YEARLY[planName];
  const displayPrice = isYearly ? yearlyInfo?.annual ?? planPrice : planPrice;

  useEffect(() => {
    if (typeof window !== 'undefined' && 'ApplePaySession' in window) {
      try { setHasApplePay((window as any).ApplePaySession.canMakePayments()); } catch {}
    }
  }, []);

  function handleMethodChange(m: Method) {
    setMethod(m);
    setPixData(null);
    setError('');
  }

  /* ── Submeter cartão (crédito ou débito) ── */
  async function handleCardSubmit(card: {
    holderName: string; number: string; expiryMonth: string; expiryYear: string;
    ccv: string; postalCode: string; addressNumber: string;
  }) {
    setLoading(true); setError('');
    try {
      const endpoint = isUpgrade ? '/billing/upgrade' : '/billing/checkout';
      const res = await api.post<any>(endpoint, {
        [isUpgrade ? 'targetPlan' : 'planName']: planName,
        paymentMethod: method, // 'credit_card' ou 'debit_card'
        billingCycle,
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
      if (res.status === 'active' || res.switched) {
        setStep(3);
        setTimeout(() => onSuccess(planName), 1500);
      } else {
        setError(normalizeApiError(res.error || 'Cartão não aprovado. Verifique os dados e tente novamente.'));
      }
    } catch (err: any) {
      setError(normalizeApiError(err));
    } finally {
      setLoading(false);
    }
  }

  /* ── Gerar PIX (pix, pix_auto, google_pay, apple_pay) ── */
  async function handlePixSubmit() {
    setLoading(true); setError('');
    try {
      const endpoint      = isUpgrade ? '/billing/upgrade' : '/billing/checkout';
      const backendMethod = toBackendMethod(method);
      const res = await api.post<any>(endpoint, {
        [isUpgrade ? 'targetPlan' : 'planName']: planName,
        paymentMethod: backendMethod,
        billingCycle,
      });
      if (res.switched || res.status === 'active') {
        setStep(3);
        setTimeout(() => onSuccess(planName), 1500);
        return;
      }
      if (res.status === 'pending_pix') {
        setPixData({
          qrCode:    res.qrCode    || null,
          qrCodeUrl: res.qrCodeUrl || null,
          expiresAt: res.expiresAt || null,
          amount:    res.amount || res.proratedAmount || 0,
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

  /* ── "Já paguei" ── */
  async function handlePixPaid() {
    setLoading(true);
    try {
      const res = await api.get<any>('/billing/sync');
      if (res.synced) {
        setStep(3);
        setTimeout(() => onSuccess(planName), 1500);
      } else {
        setError('Pagamento ainda não confirmado. Aguarde alguns segundos e tente novamente.');
      }
    } catch (err: any) {
      setError(normalizeApiError(err));
    } finally {
      setLoading(false);
    }
  }

  /* ── Step 3: Sucesso ── */
  if (step === 3) {
    return (
      <div style={{ padding: '32px 24px', textAlign: 'center', background: 'rgba(var(--color-primary)/.05)', borderRadius: 14, border: '1px solid rgba(var(--color-primary)/.2)' }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(var(--color-primary)/.15)', border: '2px solid rgba(var(--color-primary)/.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px', fontSize: 24 }}>
          ✓
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, color: 'rgb(var(--color-primary))', marginBottom: 6 }}>Plano ativado!</div>
        <div style={{ fontSize: 13, color: 'rgb(var(--color-text-secondary))' }}>
          Seu plano <strong>{planLabel}</strong> está ativo. Redirecionando...
        </div>
      </div>
    );
  }

  const STEP_LABELS  = ['Plano', 'Pagamento', 'Confirmação'];
  const activeMethod = METHODS.find(m => m.id === method)!;

  return (
    <div>
      {/* Steps */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20, padding: '0 4px' }}>
        {STEP_LABELS.map((s, i) => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', flex: i < 2 ? 1 : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{
                width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                background:  i < 1 ? 'rgb(var(--color-primary))' : i === 1 ? 'rgba(var(--color-primary)/.15)' : 'rgba(var(--color-primary)/.05)',
                border:      `2px solid ${i <= 1 ? 'rgb(var(--color-primary))' : 'rgb(var(--color-border))'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 700,
                color: i < 1 ? '#fff' : i === 1 ? 'rgb(var(--color-primary))' : 'rgb(var(--color-text-muted))',
              }}>
                {i < 1 ? '✓' : i + 1}
              </div>
              <span style={{ fontSize: 11, fontWeight: i === 1 ? 700 : 400, color: i === 1 ? 'rgb(var(--color-text))' : 'rgb(var(--color-text-muted))' }}>
                {s}
              </span>
            </div>
            {i < 2 && <div style={{ flex: 1, height: 1, background: i < 1 ? 'rgb(var(--color-primary))' : 'rgb(var(--color-border))', margin: '0 8px' }} />}
          </div>
        ))}
      </div>

      {/* Plan summary bar */}
      <div style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgba(var(--color-primary)/.15)', borderRadius: '12px 12px 0 0', padding: '12px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: 'none' }}>
        <div>
          <div style={{ fontSize: 10, color: 'rgb(var(--color-text-muted))' }}>
            {isUpgrade ? 'Fazendo upgrade para' : 'Plano selecionado'}
          </div>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'rgb(var(--color-text))' }}>
            {planLabel}
            <span style={{ color: 'rgb(var(--color-text-muted))', fontSize: 11, fontWeight: 400 }}>
              {' · '}{planFeats[0]}
            </span>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'rgb(var(--color-text-secondary))' }}>{displayPrice}</span>
            <span style={{ fontSize: 11, color: 'rgb(var(--color-text-muted))' }}>
              {isYearly ? '/ano' : '/mês'}
            </span>
          </div>
          {isYearly && yearlyInfo && (
            <div style={{ fontSize: 9, color: 'rgb(var(--color-primary))', fontWeight: 700 }}>
              {yearlyInfo.monthlyEq} · 20% off
            </div>
          )}
        </div>
      </div>

      {/* Checkout body */}
      <div style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgba(var(--color-primary)/.2)', borderTop: 'none', borderRadius: '0 0 14px 14px', overflow: 'hidden' }}>

        {/* ── Toggle Mensal / Anual ── */}
        <div style={{ padding: '14px 16px', background: 'rgba(var(--color-primary)/.04)', borderBottom: '1px solid rgba(var(--color-primary)/.12)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'rgb(var(--color-text-muted))', marginBottom: 8 }}>
            CICLO DE COBRANÇA
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['monthly', 'yearly'] as const).map(cycle => {
              const active = billingCycle === cycle;
              return (
                <button
                  key={cycle}
                  onClick={() => { setBillingCycle(cycle); setPixData(null); setError(''); }}
                  style={{
                    flex: 1, padding: '9px 12px', borderRadius: 10, cursor: 'pointer',
                    border: `1.5px solid ${active ? 'rgb(var(--color-primary))' : 'rgba(var(--color-primary)/.2)'}`,
                    background: active ? 'rgba(var(--color-primary)/.12)' : 'transparent',
                    color: active ? 'rgb(var(--color-primary))' : 'rgb(var(--color-text-muted))',
                    boxShadow: active ? '0 0 0 2px rgba(var(--color-primary)/.15)' : 'none',
                    transition: 'all 0.15s',
                    textAlign: 'left' as const,
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700 }}>
                    {cycle === 'monthly' ? '📅 Mensal' : '📆 Anual'}
                    {cycle === 'yearly' && (
                      <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 800, background: 'rgb(var(--color-primary))', color: '#fff', borderRadius: 4, padding: '1px 5px', verticalAlign: 'middle' }}>
                        20% OFF
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: active ? 'rgba(var(--color-primary)/.8)' : 'rgb(var(--color-text-muted))', marginTop: 2 }}>
                    {cycle === 'monthly'
                      ? planPrice + '/mês'
                      : yearlyInfo
                        ? `${yearlyInfo.monthlyEq} · ${yearlyInfo.annual}/ano`
                        : planPrice + '/mês'}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Seletor de método ── */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, padding: '13px 15px', background: 'rgb(var(--color-bg))', borderBottom: '1px solid rgb(var(--color-border))' }}>
          {METHODS.map(m => {
            const active   = method === m.id;
            const disabled = !!m.comingSoon;
            return (
              <button
                key={m.id}
                onClick={() => !disabled && handleMethodChange(m.id)}
                disabled={disabled}
                style={{
                  position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                  padding: '9px 8px', minWidth: 68,
                  borderRadius: 10, cursor: disabled ? 'default' : 'pointer',
                  border: `1.5px solid ${active ? 'rgb(var(--color-primary))' : 'rgba(var(--color-primary)/.2)'}`,
                  background: active ? 'rgba(var(--color-primary)/.1)' : 'transparent',
                  color: active ? 'rgb(var(--color-primary))' : 'rgb(var(--color-text-muted))',
                  opacity: disabled ? 0.45 : 1,
                  boxShadow: active ? '0 0 0 2px rgba(var(--color-primary)/.15)' : 'none',
                  transition: 'all 0.15s',
                }}
              >
                {m.comingSoon && (
                  <span style={{ position: 'absolute', top: -7, right: -2, background: '#6b7280', color: '#fff', fontSize: 7, fontWeight: 700, borderRadius: 4, padding: '1px 4px', letterSpacing: '0.03em' }}>
                    EM BREVE
                  </span>
                )}
                <span style={{ height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {typeof m.Icon === 'string'
                    ? <span style={{ fontSize: 16 }}>{m.Icon}</span>
                    : <m.Icon />}
                </span>
                <span style={{ fontSize: 9, fontWeight: active ? 700 : 400, textAlign: 'center', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                  {m.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* ── Área do formulário ── */}
        <div style={{ padding: '20px 18px', minHeight: 300, display: 'flex', flexDirection: 'column' }}>

          {/* Cabeçalho do método ativo */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'rgb(var(--color-text))' }}>
              {activeMethod.label}
            </div>
            <div style={{ fontSize: 11, color: 'rgb(var(--color-text-muted))', marginTop: 2 }}>
              {activeMethod.sub}
            </div>
          </div>

          {/* Cartão de crédito / débito */}
          {isCardMethod(method) && (
            <CardForm
              onSubmit={handleCardSubmit}
              loading={loading}
              error={error}
              submitLabel={`${isUpgrade ? 'Confirmar upgrade' : 'Assinar'} — ${planPrice}/${billingCycle === 'yearly' ? 'ano' : 'mês'}`}
            />
          )}

          {/* PIX-based: tela de geração */}
          {isPixMethod(method) && !pixData && (
            <PixGenerateArea
              method={method}
              hasApplePay={hasApplePay}
              loading={loading}
              error={error}
              onGenerate={handlePixSubmit}
              planPrice={planPrice}
              isUpgrade={isUpgrade}
            />
          )}

          {/* PIX-based: QR code gerado */}
          {isPixMethod(method) && pixData && (
            <>
              {(method === 'google_pay' || method === 'apple_pay') && (
                <WalletBanner method={method as 'google_pay' | 'apple_pay'} />
              )}
              {method === 'pix_auto' && <PixAutoBanner />}
              <PixDisplay data={pixData} onPaid={handlePixPaid} onExpire={() => setPixData(null)} loading={loading} />
            </>
          )}

          {/* PayPal — em breve */}
          {method === 'paypal' && <PayPalSection />}
        </div>
      </div>

      {/* Footer */}
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
