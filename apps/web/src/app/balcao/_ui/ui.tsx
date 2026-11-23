'use client';
/**
 * Kit de componentes do Balcão Virtual — acessível (eMAG/WCAG 2.1 AA): foco visível, rótulos associados,
 * erros anunciados (aria-live), diálogo com foco preso e Esc, tabelas semânticas. Use SEMPRE estes
 * componentes em vez de reimplementar. Tokens em ../balcao.css (classes `bv-*` do Tailwind).
 */
import React, { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';

export const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

// ── Botão ────────────────────────────────────────────────────────────────────
type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
const BTN: Record<BtnVariant, string> = {
  primary: 'bg-bv-primary text-bv-primary-fg hover:opacity-90',
  secondary: 'bg-bv-surface text-bv-text border border-bv-border hover:bg-bv-subtle',
  danger: 'bg-bv-danger text-white hover:opacity-90',
  ghost: 'bg-transparent text-bv-primary hover:bg-bv-primary-soft',
};
export const Button = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; loading?: boolean; size?: 'sm' | 'md' }>(
  ({ variant = 'primary', loading, size = 'md', className, children, disabled, type = 'button', ...p }, ref) => (
    <button ref={ref} type={type} disabled={disabled || loading} aria-busy={loading || undefined}
      className={cx('inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
        size === 'sm' ? 'min-h-[32px] px-3 text-sm' : 'min-h-[40px] px-4 text-base', BTN[variant], className)} {...p}>
      {loading && <Spinner size={14} label="" />}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';

export function IconButton({ label, children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label}
      className="inline-flex h-10 w-10 items-center justify-center rounded-md text-bv-text hover:bg-bv-subtle disabled:opacity-50" {...p}>
      {children}
    </button>
  );
}

// ── Campos ───────────────────────────────────────────────────────────────────
interface FieldWrap { label: string; hint?: string; error?: string | null; required?: boolean; id?: string }
function FieldShell({ label, hint, error, required, id, children }: FieldWrap & { children: (a: { id: string; describedBy?: string; invalid: boolean }) => React.ReactNode }) {
  const auto = useId();
  const fid = id ?? auto;
  const hid = hint ? `${fid}-hint` : undefined;
  const eid = error ? `${fid}-err` : undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={fid} className="text-sm font-medium text-bv-text">
        {label}{required && <span aria-hidden="true" className="text-bv-danger"> *</span>}
        {required && <span className="bv-sr-only"> (obrigatório)</span>}
      </label>
      {children({ id: fid, describedBy: [hid, eid].filter(Boolean).join(' ') || undefined, invalid: !!error })}
      {hint && <p id={hid} className="text-xs text-bv-muted">{hint}</p>}
      {error && <p id={eid} role="alert" className="text-sm text-bv-danger">{error}</p>}
    </div>
  );
}
const INPUT = 'w-full min-h-[40px] rounded-md border border-bv-border bg-bv-surface px-3 py-2 text-bv-text placeholder:text-bv-muted disabled:opacity-60 aria-[invalid=true]:border-bv-danger';

export function TextField({ label, hint, error, required, id, className, ...p }: FieldWrap & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'id'>) {
  return <FieldShell {...{ label, hint, error, required, id }}>{(a) => <input id={a.id} required={required} aria-invalid={a.invalid || undefined} aria-describedby={a.describedBy} className={cx(INPUT, className)} {...p} />}</FieldShell>;
}
export function TextArea({ label, hint, error, required, id, className, ...p }: FieldWrap & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'>) {
  return <FieldShell {...{ label, hint, error, required, id }}>{(a) => <textarea id={a.id} required={required} aria-invalid={a.invalid || undefined} aria-describedby={a.describedBy} className={cx(INPUT, 'min-h-[88px]', className)} {...p} />}</FieldShell>;
}
export function Select({ label, hint, error, required, id, className, children, ...p }: FieldWrap & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'id'>) {
  return <FieldShell {...{ label, hint, error, required, id }}>{(a) => <select id={a.id} required={required} aria-invalid={a.invalid || undefined} aria-describedby={a.describedBy} className={cx(INPUT, className)} {...p}>{children}</select>}</FieldShell>;
}
export function Checkbox({ label, hint, className, ...p }: { label: string; hint?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const id = useId();
  return (
    <div className={cx('flex items-start gap-2', className)}>
      <input id={id} type="checkbox" className="mt-1 h-5 w-5 accent-[rgb(var(--bv-primary))]" aria-describedby={hint ? `${id}-h` : undefined} {...p} />
      <label htmlFor={id} className="text-sm">{label}{hint && <span id={`${id}-h`} className="block text-xs text-bv-muted">{hint}</span>}</label>
    </div>
  );
}

// ── Estrutura ────────────────────────────────────────────────────────────────
export function Card({ title, actions, children, className, as: As = 'section' }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; as?: 'section' | 'div' | 'article' }) {
  const hid = useId();
  return (
    <As aria-labelledby={title ? hid : undefined} className={cx('rounded-lg border border-bv-border bg-bv-surface p-4', className)}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 id={hid} className="text-base font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </As>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold" tabIndex={-1} data-bv-page-title>{title}</h1>
        {subtitle && <p className="text-sm text-bv-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';
const TONE: Record<Tone, string> = {
  neutral: 'bg-bv-subtle text-bv-text border border-bv-border',
  primary: 'bg-bv-primary-soft text-bv-primary border border-bv-primary',
  success: 'bg-bv-success-soft text-bv-success border border-bv-success',
  warning: 'bg-bv-warning-soft text-bv-warning border border-bv-warning',
  danger: 'bg-bv-danger-soft text-bv-danger border border-bv-danger',
};
/** Selo de status — NUNCA depender só da cor: sempre há texto. */
export const Badge = ({ tone = 'neutral', children }: { tone?: Tone; children: React.ReactNode }) =>
  <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', TONE[tone])}>{children}</span>;

export function Banner({ tone = 'primary', title, children }: { tone?: Exclude<Tone, 'neutral'>; title?: string; children?: React.ReactNode }) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cx('rounded-md px-3 py-2 text-sm', TONE[tone])}>
      {title && <strong className="block">{title}</strong>}{children}
    </div>
  );
}

export function Spinner({ size = 20, label = 'Carregando' }: { size?: number; label?: string }) {
  return (
    <span role={label ? 'status' : undefined} className="inline-flex items-center">
      <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" opacity=".25" /><path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" fill="none" /></svg>
      {label && <span className="bv-sr-only">{label}</span>}
    </span>
  );
}

export const EmptyState = ({ title, children }: { title: string; children?: React.ReactNode }) => (
  <div className="rounded-lg border border-dashed border-bv-border p-8 text-center"><p className="font-medium">{title}</p>{children && <div className="mt-1 text-sm text-bv-muted">{children}</div>}</div>
);

export function StatCard({ label, value, hint, tone = 'neutral' }: { label: string; value: React.ReactNode; hint?: string; tone?: Tone }) {
  return (
    <div className="rounded-lg border border-bv-border bg-bv-surface p-4">
      <p className="text-sm text-bv-muted">{label}</p>
      <p className={cx('mt-1 text-2xl font-semibold', tone === 'danger' && 'text-bv-danger', tone === 'warning' && 'text-bv-warning', tone === 'success' && 'text-bv-success')}>{value}</p>
      {hint && <p className="mt-1 text-xs text-bv-muted">{hint}</p>}
    </div>
  );
}

// ── Tabela ───────────────────────────────────────────────────────────────────
export interface Column<T> { key: string; header: string; render: (row: T) => React.ReactNode; className?: string }
export function DataTable<T>({ caption, columns, rows, rowKey, onRowClick, empty = 'Nenhum registro.' }: { caption: string; columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string; onRowClick?: (r: T) => void; empty?: string }) {
  if (!rows.length) return <EmptyState title={empty} />;
  return (
    <div className="overflow-x-auto rounded-lg border border-bv-border">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="bv-sr-only">{caption}</caption>
        <thead className="bg-bv-subtle"><tr>{columns.map((c) => <th key={c.key} scope="col" className={cx('px-3 py-2 font-semibold', c.className)}>{c.header}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} className={cx('border-t border-bv-border', onRowClick && 'cursor-pointer hover:bg-bv-subtle')}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(r); } : undefined} tabIndex={onRowClick ? 0 : undefined}>
              {columns.map((c) => <td key={c.key} className={cx('px-3 py-2 align-top', c.className)}>{c.render(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Abas (WAI-ARIA tabs) ─────────────────────────────────────────────────────
export function Tabs({ tabs, label }: { tabs: Array<{ id: string; title: string; content: React.ReactNode }>; label: string }) {
  const [active, setActive] = useState(tabs[0]?.id);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = tabs[(i + d + tabs.length) % tabs.length];
    setActive(n.id); refs.current[n.id]?.focus();
  };
  return (
    <div>
      <div role="tablist" aria-label={label} className="flex flex-wrap gap-1 border-b border-bv-border">
        {tabs.map((t, i) => (
          <button key={t.id} ref={(el) => { refs.current[t.id] = el; }} role="tab" id={`tab-${t.id}`} type="button" aria-selected={active === t.id} aria-controls={`panel-${t.id}`}
            tabIndex={active === t.id ? 0 : -1} onClick={() => setActive(t.id)} onKeyDown={(e) => onKey(e, i)}
            className={cx('min-h-[40px] px-4 text-sm font-medium', active === t.id ? 'border-b-2 border-bv-primary text-bv-primary' : 'text-bv-muted hover:text-bv-text')}>{t.title}</button>
        ))}
      </div>
      {tabs.map((t) => <div key={t.id} role="tabpanel" id={`panel-${t.id}`} aria-labelledby={`tab-${t.id}`} hidden={active !== t.id} className="pt-4">{active === t.id && t.content}</div>)}
    </div>
  );
}

// ── Diálogo (foco preso, Esc fecha, devolve foco) ────────────────────────────
export function Dialog({ open, onClose, title, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode; size?: 'sm' | 'md' | 'lg' }) {
  const ref = useRef<HTMLDivElement>(null);
  const tid = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const node = ref.current!;
    const focusables = () => Array.from(node.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'));
    (focusables()[0] ?? node).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key !== 'Tab') return;
      const f = focusables(); if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    node.addEventListener('keydown', onKey);
    return () => { node.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={tid} tabIndex={-1}
        className={cx('max-h-[90vh] w-full overflow-y-auto rounded-lg border border-bv-border bg-bv-surface p-5 shadow-xl', size === 'sm' ? 'max-w-sm' : size === 'lg' ? 'max-w-3xl' : 'max-w-xl')}>
        <h2 id={tid} className="mb-3 text-lg font-semibold">{title}</h2>
        <div>{children}</div>
        {footer && <div className="mt-4 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirmar', danger, onConfirm, onClose }: { open: boolean; title: string; message: React.ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void | Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onClose={onClose} title={title} size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={async () => { setBusy(true); try { await onConfirm(); onClose(); } finally { setBusy(false); } }}>{confirmLabel}</Button></>}>
      <p className="text-sm">{message}</p>
    </Dialog>
  );
}

// ── Toasts (região aria-live) ────────────────────────────────────────────────
interface ToastItem { id: number; tone: 'success' | 'danger' | 'primary'; text: string }
const ToastCtx = createContext<(tone: ToastItem['tone'], text: string) => void>(() => undefined);
export const useToast = () => {
  const push = useContext(ToastCtx);
  return useMemo(() => ({ success: (t: string) => push('success', t), error: (t: string) => push('danger', t), info: (t: string) => push('primary', t) }), [push]);
};
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((tone: ToastItem['tone'], text: string) => {
    const id = Date.now() + Math.random();
    setItems((l) => [...l.slice(-3), { id, tone, text }]);
    setTimeout(() => setItems((l) => l.filter((x) => x.id !== id)), 6000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" aria-atomic="false" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 max-w-[90vw] flex-col gap-2">
        {items.map((t) => <div key={t.id} role={t.tone === 'danger' ? 'alert' : 'status'} className={cx('pointer-events-auto rounded-md px-3 py-2 text-sm shadow-lg', TONE[t.tone === 'danger' ? 'danger' : t.tone === 'success' ? 'success' : 'primary'])}>{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

// ── Paginação por cursor ─────────────────────────────────────────────────────
export function LoadMore({ hasMore, loading, onClick }: { hasMore: boolean; loading: boolean; onClick: () => void }) {
  if (!hasMore) return null;
  return <div className="mt-3 text-center"><Button variant="secondary" loading={loading} onClick={onClick}>Carregar mais</Button></div>;
}

/** Texto só para leitores de tela. */
export const SrOnly = ({ children }: { children: React.ReactNode }) => <span className="bv-sr-only">{children}</span>;
