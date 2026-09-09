'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Balance {
  unlimited: boolean;
  renewalDate: string | null;
  freeMessages: number;
  freeResetAt: string | null;
  paidMessages: number;
  paidExpiresAt: string | null;
  totalAvailable: number | null;
}

interface Package {
  id: string;
  messages: number;
  priceBrl: number;
  label: string;
  desc: string;
  validityDays: number;
}

interface Packages {
  freeMessagesPerMonth: number;
  packages: Package[];
  monthly: { unlimited: boolean; priceBrl: number };
}

interface Pix {
  copyPaste: string | null;
  qrCodeUrl: string | null;
  label: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
}

/**
 * Saldo de mensagens do módulo Campanhas (30 grátis/mês + pré-pago + Mensal
 * Ilimitado — decisão de produto, 2026-09-09, ver CAMPANHAS_ARQUITETURA.md
 * §17). Compra é sempre Pix (mesmo backend usado pelo Chatbot Campanhas via
 * WhatsApp — POST /billing/buy-campanha-messages e /campanha-subscribe).
 */
export default function BalanceCard({ highlight }: { highlight?: boolean }) {
  const [balance, setBalance] = useState<Balance | null>(null);
  const [packages, setPackages] = useState<Packages | null>(null);
  const [pix, setPix] = useState<Pix | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function reload() {
    try {
      const [b, p] = await Promise.all([
        api.get<Balance>('/billing/campanha-balance'),
        api.get<Packages>('/billing/campanha-packages'),
      ]);
      setBalance(b);
      setPackages(p);
    } catch {
      /* saldo é informativo — não trava a tela se falhar */
    }
  }

  useEffect(() => { reload(); }, []);

  async function buyPackage(pkg: Package) {
    setBuying(pkg.id);
    setError(null);
    try {
      const res = await api.post<{ copyPaste: string | null; qrCodeUrl: string | null }>('/billing/buy-campanha-messages', { packageId: pkg.id });
      setPix({ copyPaste: res.copyPaste, qrCodeUrl: res.qrCodeUrl, label: pkg.label });
    } catch (err: any) {
      setError(err?.message || 'Não foi possível gerar o Pix.');
    } finally {
      setBuying(null);
    }
  }

  async function subscribeMonthly() {
    setBuying('monthly');
    setError(null);
    try {
      const res = await api.post<{ copyPaste: string | null; qrCodeUrl: string | null }>('/billing/campanha-subscribe', {});
      setPix({ copyPaste: res.copyPaste, qrCodeUrl: res.qrCodeUrl, label: 'Plano Mensal Ilimitado' });
    } catch (err: any) {
      setError(err?.message || 'Não foi possível criar a assinatura.');
    } finally {
      setBuying(null);
    }
  }

  if (!balance || !packages) return null;

  return (
    <div className={`rounded-xl border p-4 mb-6 ${highlight ? 'border-amber-400/50 bg-amber-400/5' : 'border-brand-border bg-brand-elevated'}`}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          {balance.unlimited ? (
            <div className="text-brand-text font-medium">💳 Mensal Ilimitado ativo — mensagens sem limite (renova {formatDate(balance.renewalDate)})</div>
          ) : (
            <div className="text-brand-text font-medium">
              💬 {balance.totalAvailable} mensagens disponíveis
              <span className="text-brand-muted font-normal"> ({balance.freeMessages} grátis do mês + {balance.paidMessages} pagas)</span>
            </div>
          )}
          {!balance.unlimited && balance.paidMessages > 0 && (
            <div className="text-xs text-brand-muted mt-0.5">Saldo pago válido até {formatDate(balance.paidExpiresAt)}</div>
          )}
        </div>
      </div>

      {!balance.unlimited && (
        <div className="mt-3 flex flex-wrap gap-2">
          {packages.packages.map((pkg) => (
            <button
              key={pkg.id}
              onClick={() => buyPackage(pkg)}
              disabled={buying !== null}
              className="btn-secondary text-sm px-3 py-1.5 disabled:opacity-50"
            >
              {buying === pkg.id ? 'Gerando Pix…' : `${pkg.label} — R$${pkg.priceBrl} (${pkg.desc}, ${pkg.validityDays}d)`}
            </button>
          ))}
          <button
            onClick={subscribeMonthly}
            disabled={buying !== null}
            className="btn-primary text-sm px-3 py-1.5 disabled:opacity-50"
          >
            {buying === 'monthly' ? 'Gerando Pix…' : `Mensal Ilimitado — R$${packages.monthly.priceBrl}/mês`}
          </button>
        </div>
      )}

      {error && <div className="mt-2 text-sm text-red-500">{error}</div>}

      {pix && (
        <div className="mt-4 rounded-lg border border-brand-border p-4 flex items-center gap-4 flex-wrap">
          {pix.qrCodeUrl && <img src={pix.qrCodeUrl} alt="QR Code Pix" width={140} height={140} />}
          <div className="flex-1 min-w-[200px]">
            <div className="text-sm text-brand-text font-medium mb-1">Pix — {pix.label}</div>
            <div className="text-xs text-brand-muted mb-2">Pague com o QR ou copie o código abaixo. O crédito cai automaticamente após a confirmação.</div>
            <div className="flex gap-2">
              <button
                onClick={() => { if (pix.copyPaste) { navigator.clipboard.writeText(pix.copyPaste); setCopied(true); setTimeout(() => setCopied(false), 2000); } }}
                className="btn-secondary text-xs px-2 py-1"
              >
                {copied ? 'Copiado!' : 'Copiar código Pix'}
              </button>
              <button onClick={() => { setPix(null); reload(); }} className="text-xs text-brand-muted hover:text-brand-text">
                Já paguei / fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
