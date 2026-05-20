'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface Invoice {
  id:          string;
  value:       number;
  netValue:    number;
  status:      string;
  dueDate:     string;
  paymentDate: string | null;
  invoiceUrl:  string;
  billingType: string;
  description: string;
}

function statusLabel(s: string) {
  const map: Record<string, { label: string; cls: string }> = {
    CONFIRMED:  { label: '✓ Pago',       cls: 'text-green-400 bg-green-400/10 border-green-400/20' },
    RECEIVED:   { label: '✓ Recebido',   cls: 'text-green-400 bg-green-400/10 border-green-400/20' },
    PENDING:    { label: '⏳ Pendente',   cls: 'text-amber-400 bg-amber-400/10 border-amber-400/20' },
    OVERDUE:    { label: '⚠ Em atraso',  cls: 'text-red-400 bg-red-400/10 border-red-400/20' },
    REFUNDED:   { label: '↩ Estornado',  cls: 'text-brand-muted bg-brand-elevated border-brand-border' },
    CANCELED:   { label: '✕ Cancelado',  cls: 'text-brand-muted bg-brand-elevated border-brand-border' },
  };
  return map[s] || { label: s, cls: 'text-brand-muted bg-brand-elevated border-brand-border' };
}

function billingLabel(type: string) {
  const map: Record<string, string> = {
    CREDIT_CARD: '💳 Cartão',
    PIX:         '⚡ PIX',
    BOLETO:      '📄 Boleto',
    UNDEFINED:   '—',
  };
  return map[type] || type;
}

function fmtDate(d: string | null) {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

function fmtBRL(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');

  useEffect(() => {
    api.get<{ invoices: Invoice[] }>('/billing/invoices')
      .then(r => setInvoices(r.invoices || []))
      .catch(e => setError(e.message || 'Erro ao carregar faturas'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-4 sm:p-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-brand-text">Faturas</h1>
        <p className="text-sm text-brand-text-secondary font-light mt-0.5">
          Histórico de pagamentos da sua assinatura
        </p>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16 text-brand-muted text-sm gap-2">
          <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round"/>
          </svg>
          Carregando...
        </div>
      )}

      {!loading && error && (
        <div className="card p-6 text-center border-red-400/20">
          <div className="text-3xl mb-2">⚠️</div>
          <p className="text-sm text-red-400 font-semibold">{error}</p>
        </div>
      )}

      {!loading && !error && invoices.length === 0 && (
        <div className="card p-12 text-center">
          <div className="text-4xl mb-3">🧾</div>
          <p className="text-sm text-brand-muted mb-1">Nenhuma fatura encontrada.</p>
          <p className="text-xs text-brand-muted">As faturas aparecem aqui após a primeira cobrança da assinatura.</p>
          <Link href="/dashboard/plano" className="btn-primary inline-block mt-5 px-6 py-2 text-sm">
            Ver planos
          </Link>
        </div>
      )}

      {!loading && !error && invoices.length > 0 && (
        <div className="space-y-3">
          {invoices.map(inv => {
            const st = statusLabel(inv.status);
            return (
              <div key={inv.id} className="card p-4 sm:p-5 hover:border-brand-primary/20 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-brand-primary">{fmtBRL(inv.value)}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${st.cls}`}>
                        {st.label}
                      </span>
                    </div>
                    <div className="text-xs text-brand-muted mt-1 flex items-center gap-3 flex-wrap">
                      <span>Vencimento: <strong className="text-brand-text-secondary">{fmtDate(inv.dueDate)}</strong></span>
                      {inv.paymentDate && (
                        <span>Pago em: <strong className="text-brand-text-secondary">{fmtDate(inv.paymentDate)}</strong></span>
                      )}
                      <span>{billingLabel(inv.billingType)}</span>
                    </div>
                    {inv.description && (
                      <p className="text-[10px] text-brand-muted mt-1 truncate">{inv.description}</p>
                    )}
                  </div>
                  <a
                    href={inv.invoiceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-ghost text-xs px-3 py-1.5 flex-shrink-0"
                  >
                    Ver fatura ↗
                  </a>
                </div>
              </div>
            );
          })}
          <p className="text-[10px] text-brand-muted text-center pt-2">
            Exibindo as últimas {invoices.length} faturas · Processado pelo Asaas
          </p>
        </div>
      )}
    </div>
  );
}
