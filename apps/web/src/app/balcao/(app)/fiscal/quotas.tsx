'use client';
/** Gestão de cotas (perm quota:manage), formulário com confirmação de BLOQUEAR e log de alterações (auditoria). */
import React, { useCallback, useEffect, useState } from 'react';
import { bv, errMsg } from '@/lib/balcao/api';
import { useBvSession } from '@/lib/balcao/session';
import { fmtDateTime, fmtNumber } from '@/lib/balcao/format';
import { Badge, Banner, Button, Card, ConfirmDialog, DataTable, Dialog, EmptyState, LoadMore, Select, Spinner, TextField, useToast } from '../../_ui/ui';
import { StateGate } from '../relatorios/lib';
import { ACTION_LABEL, GB, ITEM_FALLBACK, QPERIOD_LABEL, QuotaMeter, fmtQty, levelOf } from './parts';

export interface ItemOpt { item: string; label: string; trItem: string | null }
const nameOf = (opts: ItemOpt[], item: string) => { const o = opts.find((x) => x.item === item); return o ? (o.trItem ? `Item ${o.trItem} — ${o.label}` : o.label) : ITEM_FALLBACK[item] ?? item; };

const UNIT_HINT: Record<string, string> = {
  STORAGE_BYTES: 'em GB (1 GB = 10⁹ bytes; 1 TB = 1.000 GB)', VOICE_MINUTES: 'em minutos', VOICE_PEAK_CHANNELS: 'em canais simultâneos', AI_TOKENS: 'em tokens', AI_CALLS: 'em chamadas',
  EMAIL_IN: 'em e-mails', EMAIL_OUT: 'em e-mails', WEBCHAT_MSG: 'em mensagens', WA_SERVICE: 'em conversas', WA_UTILITY: 'em conversas', WA_MARKETING: 'em conversas',
};

interface FormState { item: string; period: 'DAY' | 'MONTH'; limit: string; action: 'ALERT' | 'BLOCK'; alertAtPct: string }

function QuotaDialog({ open, editing, items, quotas, onClose, onSaved }: { open: boolean; editing: any | null; items: ItemOpt[]; quotas: any[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<FormState>({ item: 'WA_SERVICE', period: 'MONTH', limit: '', action: 'ALERT', alertAtPct: '80' });
  const [step, setStep] = useState<'form' | 'confirm'>('form');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [apiErr, setApiErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setStep('form'); setErrs({}); setApiErr(null);
    setF(editing
      ? { item: editing.item, period: editing.period, limit: String(editing.item === 'STORAGE_BYTES' ? editing.limit / GB : editing.limit), action: editing.action, alertAtPct: String(editing.alertAtPct) }
      : { item: items[0]?.item ?? 'WA_SERVICE', period: 'MONTH', limit: '', action: 'ALERT', alertAtPct: '80' });
  }, [open, editing, items]);

  const storage = f.item === 'STORAGE_BYTES';
  const existing = !editing ? quotas.find((q) => q.item === f.item && q.period === f.period) : null;
  const validate = () => {
    const e: Record<string, string> = {};
    const raw = Number(f.limit.replace(',', '.'));
    const lim = storage ? Math.round(raw * GB) : raw;
    if (!f.limit.trim() || !isFinite(raw) || raw <= 0) e.limit = 'Informe um limite maior que zero.';
    else if (!storage && !Number.isInteger(raw)) e.limit = 'Informe um número inteiro.';
    else if (lim > Number.MAX_SAFE_INTEGER) e.limit = 'Valor muito grande.';
    const pct = Number(f.alertAtPct);
    if (!Number.isInteger(pct) || pct < 1 || pct > 100) e.alertAtPct = 'Informe um percentual inteiro de 1 a 100.';
    setErrs(e);
    return Object.keys(e).length ? null : { lim, pct };
  };
  const save = async () => {
    const v = validate(); if (!v) { setStep('form'); return; }
    setBusy(true); setApiErr(null);
    try {
      if (editing) await bv.put(`/fiscal/quotas/${editing.id}`, { limit: v.lim, action: f.action, alertAtPct: v.pct });
      else await bv.post('/fiscal/quotas', { item: f.item, period: f.period, limit: v.lim, action: f.action, alertAtPct: v.pct });
      toast.success(editing || existing ? 'Cota atualizada.' : 'Cota criada.');
      onSaved(); onClose();
    } catch (x) { setApiErr(errMsg(x)); setStep('form'); } finally { setBusy(false); }
  };
  const submit = (e: React.FormEvent) => { e.preventDefault(); if (!validate()) return; if (f.action === 'BLOCK') setStep('confirm'); else void save(); };

  return (
    <Dialog open={open} onClose={onClose} title={step === 'confirm' ? 'Confirmar bloqueio ao atingir a cota' : editing ? 'Editar cota' : 'Nova cota'}
      footer={step === 'confirm'
        ? <><Button variant="secondary" onClick={() => setStep('form')}>Voltar</Button><Button variant="danger" loading={busy} onClick={() => void save()}>Sim, definir como BLOQUEAR</Button></>
        : <><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="bv-quota-form" loading={busy}>Salvar cota</Button></>}>
      {step === 'confirm' ? (
        <div className="flex flex-col gap-3">
          <Banner tone="danger" title="Esta ação pode interromper o atendimento">Com a ação BLOQUEAR, quando o consumo de “{nameOf(items, f.item)}” atingir {fmtQty(f.item, storage ? Math.round(Number(f.limit.replace(',', '.')) * GB) : Number(f.limit))} ({QPERIOD_LABEL[f.period].toLowerCase()}), novos usos desse recurso poderão ser recusados pelos canais que verificam a cota.</Banner>
          <p className="text-sm">Confirme apenas se esta é a decisão do contrato. A alteração será registrada no log com seu nome.</p>
        </div>
      ) : (
        <form id="bv-quota-form" onSubmit={submit} className="flex flex-col gap-3" noValidate>
          {apiErr && <Banner tone="danger">{apiErr}</Banner>}
          <Select label="Item" required value={f.item} disabled={!!editing} onChange={(e) => setF({ ...f, item: e.target.value })}>{items.map((o) => <option key={o.item} value={o.item}>{nameOf(items, o.item)}</option>)}</Select>
          <Select label="Período da cota" required value={f.period} disabled={!!editing} onChange={(e) => setF({ ...f, period: e.target.value as any })}><option value="MONTH">Mensal</option><option value="DAY">Diária</option></Select>
          {existing && <Banner tone="warning">Já existe uma cota {QPERIOD_LABEL[f.period].toLowerCase()} para este item (limite atual: {fmtQty(f.item, existing.limit)}). Salvar irá atualizá-la.</Banner>}
          <TextField label="Limite" required inputMode="decimal" value={f.limit} error={errs.limit} hint={UNIT_HINT[f.item]} onChange={(e) => setF({ ...f, limit: e.target.value })} />
          <Select label="Ação ao atingir o limite" required value={f.action} onChange={(e) => setF({ ...f, action: e.target.value as any })} hint={f.action === 'BLOCK' ? 'BLOQUEAR pede confirmação ao salvar.' : 'ALERTAR só notifica o fiscal e administradores.'}><option value="ALERT">Alertar (notificar)</option><option value="BLOCK">Bloquear (recusar novos usos)</option></Select>
          <TextField label="Percentual de alerta (%)" required type="number" min={1} max={100} step={1} value={f.alertAtPct} error={errs.alertAtPct} hint="O fiscal é avisado ao atingir este percentual e novamente ao chegar a 100%." onChange={(e) => setF({ ...f, alertAtPct: e.target.value })} />
        </form>
      )}
    </Dialog>
  );
}

// ── Log de alterações ────────────────────────────────────────────────────────
const AUDIT_LABEL: Record<string, string> = { 'quota.create': 'Cota criada', 'quota.update': 'Cota alterada', 'quota.delete': 'Cota excluída' };
function describeChange(a: any, items: ItemOpt[]): string {
  const b = a.before ?? {}, n = a.after ?? {}; const item = n.item ?? b.item ?? '';
  const q = (v: number | undefined) => (v == null ? '—' : fmtQty(item, v));
  if (a.action === 'quota.create') return `Limite ${q(n.limit)}, ação ${ACTION_LABEL[n.action] ?? n.action}, alerta em ${n.alertAtPct}%.`;
  if (a.action === 'quota.delete') return `Limite que existia: ${q(b.limit)}.`;
  const ch: string[] = [];
  if (b.limit !== n.limit) ch.push(`limite ${q(b.limit)} → ${q(n.limit)}`);
  if (b.action !== n.action) ch.push(`ação ${ACTION_LABEL[b.action] ?? b.action} → ${ACTION_LABEL[n.action] ?? n.action}`);
  if (b.alertAtPct !== n.alertAtPct) ch.push(`alerta ${b.alertAtPct}% → ${n.alertAtPct}%`);
  void items;
  return ch.length ? `${ch.join('; ')}.` : 'Sem mudança de valores.';
}

export function QuotaLog({ items, version }: { items: ItemOpt[]; version: number }) {
  const { can } = useBvSession();
  const [rows, setRows] = useState<any[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (next?: string | null) => {
    if (next) setMore(true); else setLoading(true);
    try {
      const r = await bv.get<{ items: any[]; nextCursor: string | null }>('/admin/audit', { action: 'quota.*', limit: 25, cursor: next ?? undefined });
      setRows((p) => (next ? [...p, ...r.items] : r.items)); setCursor(r.nextCursor); setError(null);
    } catch (e) { setError(errMsg(e)); } finally { setLoading(false); setMore(false); }
  }, []);
  useEffect(() => { if (can('audit:read')) void load(); else setLoading(false); }, [load, version, can]);
  if (!can('audit:read')) return <Banner tone="warning">Seu perfil não tem permissão para consultar o log de alterações (audit:read).</Banner>;
  if (loading) return <div className="flex justify-center p-6"><Spinner size={24} /></div>;
  if (error && !rows.length) return <Banner tone="danger" title="Não foi possível carregar o log">{error}</Banner>;
  return (
    <>
      <DataTable caption="Log de alterações de cotas" rows={rows} rowKey={(r) => r.id} empty="Nenhuma alteração de cota registrada." columns={[
        { key: 'd', header: 'Data e hora', render: (r) => fmtDateTime(r.createdAt) },
        { key: 'u', header: 'Responsável', render: (r) => r.actorName ?? 'Sistema' },
        { key: 'a', header: 'Ação', render: (r) => <Badge tone={r.action === 'quota.delete' ? 'danger' : 'primary'}>{AUDIT_LABEL[r.action] ?? r.action}</Badge> },
        { key: 'i', header: 'Item e período', render: (r) => { const x = r.after ?? r.before ?? {}; return `${nameOf(items, x.item)} — ${QPERIOD_LABEL[x.period] ?? x.period ?? ''}`; } },
        { key: 'c', header: 'Alteração', render: (r) => describeChange(r, items) },
      ]} />
      <LoadMore hasMore={!!cursor} loading={more} onClick={() => void load(cursor)} />
    </>
  );
}

// ── Aba de cotas ─────────────────────────────────────────────────────────────
export function QuotasTab({ items, quotas, loading, error, reload, onChanged, version }: { items: ItemOpt[]; quotas: any[] | null; loading: boolean; error: string | null; reload: () => void; onChanged: () => void; version: number }) {
  const { can } = useBvSession();
  const toast = useToast();
  const manage = can('quota:manage');
  const [dlg, setDlg] = useState<{ open: boolean; editing: any | null }>({ open: false, editing: null });
  const [del, setDel] = useState<any | null>(null);
  const closeDlg = useCallback(() => setDlg((d) => ({ ...d, open: false })), []);
  const closeDel = useCallback(() => setDel(null), []);
  return (
    <div className="flex flex-col gap-4">
      <Card title="Cotas definidas" actions={manage ? <Button size="sm" onClick={() => setDlg({ open: true, editing: null })}>Nova cota</Button> : undefined}>
        {!manage && <div className="mb-3"><Banner tone="primary">Você pode consultar as cotas, mas não alterá-las (perfil sem a permissão quota:manage).</Banner></div>}
        <StateGate loading={loading} error={error} data={quotas} onRetry={reload}>
          {quotas && (quotas.length === 0 ? <EmptyState title="Nenhuma cota definida.">{manage ? 'Use “Nova cota” para definir limites por item e período.' : 'Um usuário com permissão de gestão de cotas pode defini-las.'}</EmptyState> : (
            <DataTable caption="Cotas por item e período" rows={quotas} rowKey={(q) => q.id} columns={[
              { key: 'i', header: 'Item', render: (q) => nameOf(items, q.item) },
              { key: 'p', header: 'Período', render: (q) => QPERIOD_LABEL[q.period] },
              { key: 'l', header: 'Limite', render: (q) => <span className="tabular-nums">{fmtQty(q.item, q.limit)}</span> },
              { key: 'u', header: 'Consumo atual', className: 'min-w-[14rem]', render: (q) => (q.status ? <QuotaMeter label={`${fmtNumber(q.status.pct)}% usado`} used={q.status.used} limit={q.limit} alertAtPct={q.alertAtPct} fmt={(n) => fmtQty(q.item, n)} /> : '—') },
              { key: 'a', header: 'Ação / alerta', render: (q) => <><Badge tone={q.action === 'BLOCK' ? 'danger' : 'neutral'}>{ACTION_LABEL[q.action]}</Badge><span className="block text-xs text-bv-muted">alerta em {q.alertAtPct}%{q.status && levelOf(q.status.pct, q.alertAtPct) !== 'ok' ? ' · atingido' : ''}</span></> },
              { key: 'm', header: 'Atualizada em', render: (q) => fmtDateTime(q.updatedAt) },
              ...(manage ? [{ key: 'x', header: 'Ações', render: (q: any) => (
                <div className="flex gap-1">
                  <Button size="sm" variant="secondary" onClick={() => setDlg({ open: true, editing: q })}>Editar<span className="bv-sr-only"> cota {QPERIOD_LABEL[q.period].toLowerCase()} de {nameOf(items, q.item)}</span></Button>
                  <Button size="sm" variant="danger" onClick={() => setDel(q)}>Excluir<span className="bv-sr-only"> cota {QPERIOD_LABEL[q.period].toLowerCase()} de {nameOf(items, q.item)}</span></Button>
                </div>) }] : []),
            ]} />
          ))}
        </StateGate>
      </Card>
      <Card title="Log de alterações de cotas"><QuotaLog items={items} version={version} /></Card>
      <QuotaDialog open={dlg.open} editing={dlg.editing} items={items} quotas={quotas ?? []} onClose={closeDlg} onSaved={onChanged} />
      <ConfirmDialog open={!!del} danger title="Excluir cota" confirmLabel="Excluir" onClose={closeDel}
        message={<>Excluir a cota {del ? QPERIOD_LABEL[del.period].toLowerCase() : ''} de “{del ? nameOf(items, del.item) : ''}”? {del?.action === 'BLOCK' ? 'O bloqueio configurado deixará de valer. ' : ''}A exclusão é registrada no log.</>}
        onConfirm={async () => { try { await bv.del(`/fiscal/quotas/${del.id}`); toast.success('Cota excluída.'); onChanged(); } catch (x) { toast.error(errMsg(x)); } }} />
    </div>
  );
}
