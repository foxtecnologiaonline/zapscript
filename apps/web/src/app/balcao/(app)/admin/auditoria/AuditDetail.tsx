'use client';
import React from 'react';
import { fmtDateTime } from '@/lib/balcao/format';
import { Badge, Button, DataTable, Dialog, type Column } from '../../../_ui/ui';

export interface AuditEntry {
  id: string; createdAt: string; actorType: string; actorId: string | null; actorName: string | null; action: string;
  entityType: string | null; entityId: string | null; before: unknown; after: unknown; meta: unknown; ip: string | null; userAgent: string | null;
}

const SECRET = /(pass(word)?|senha|secret|token|hash|authorization|api[-_]?key|cookie|otp|totp)/i;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Achata um JSON em pares "caminho → valor" (arrays de primitivos viram texto; segredos são ocultados). */
export function flatten(v: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (isObj(v)) {
    const keys = Object.keys(v);
    if (!keys.length && prefix) out[prefix] = '{}';
    for (const k of keys) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (SECRET.test(k)) out[p] = '••• (oculto)'; else flatten(v[k], p, out);
    }
  } else if (Array.isArray(v)) {
    if (v.every((x) => x === null || typeof x !== 'object')) out[prefix || '(valor)'] = v.length ? v.map((x) => String(x)).join(', ') : '(vazio)';
    else v.forEach((x, i) => flatten(x, `${prefix}[${i}]`, out));
  } else out[prefix || '(valor)'] = v === null || v === undefined ? '(vazio)' : typeof v === 'string' ? (v === '' ? '(texto vazio)' : v) : String(v);
  return out;
}

interface Diff { path: string; kind: 'changed' | 'added' | 'removed' | 'same'; before: string; after: string }
export function diff(before: unknown, after: unknown): Diff[] {
  const a = before == null ? {} : flatten(before); const b = after == null ? {} : flatten(after);
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  return keys.map((path) => {
    const x = a[path]; const y = b[path];
    const kind: Diff['kind'] = x === undefined ? 'added' : y === undefined ? 'removed' : x === y ? 'same' : 'changed';
    return { path, kind, before: x ?? '—', after: y ?? '—' };
  });
}

const KIND: Record<Diff['kind'], { label: string; tone: 'primary' | 'success' | 'danger' | 'neutral' }> = {
  changed: { label: 'Alterado', tone: 'primary' }, added: { label: 'Adicionado', tone: 'success' }, removed: { label: 'Removido', tone: 'danger' }, same: { label: 'Sem mudança', tone: 'neutral' },
};

export default function AuditDetail({ entry, onClose }: { entry: AuditEntry; onClose: () => void }) {
  const rows = diff(entry.before, entry.after);
  const changed = rows.filter((r) => r.kind !== 'same');
  const hasBA = entry.before != null || entry.after != null;
  const meta = entry.meta == null ? null : flatten(entry.meta);
  const cols: Column<Diff>[] = [
    { key: 'p', header: 'Campo', render: (r) => <code className="break-all text-xs">{r.path}</code> },
    { key: 'k', header: 'Tipo', render: (r) => <Badge tone={KIND[r.kind].tone}>{KIND[r.kind].label}</Badge> },
    { key: 'b', header: 'Antes', render: (r) => <span className="break-words">{r.before}</span> },
    { key: 'a', header: 'Depois', render: (r) => <span className="break-words">{r.after}</span> },
  ];
  return (
    <Dialog open onClose={onClose} title="Detalhe do registro de auditoria" size="lg" footer={<Button onClick={onClose}>Fechar</Button>}>
      <div className="flex flex-col gap-4">
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-bv-muted">Data e hora</dt><dd>{fmtDateTime(entry.createdAt)}</dd></div>
          <div><dt className="text-bv-muted">Ação</dt><dd><code>{entry.action}</code></dd></div>
          <div><dt className="text-bv-muted">Ator</dt><dd>{entry.actorName ?? (entry.actorType === 'SYSTEM' ? 'Sistema' : entry.actorId ?? '—')} <span className="text-xs text-bv-muted">({entry.actorType})</span></dd></div>
          <div><dt className="text-bv-muted">Entidade</dt><dd>{entry.entityType ?? '—'}{entry.entityId ? ` · ${entry.entityId}` : ''}</dd></div>
          <div><dt className="text-bv-muted">Endereço IP</dt><dd>{entry.ip ?? '—'}</dd></div>
          <div><dt className="text-bv-muted">Navegador</dt><dd className="break-words text-xs">{entry.userAgent ?? '—'}</dd></div>
        </dl>
        {hasBA ? (
          <section aria-label="Alterações">
            <h3 className="mb-2 font-semibold">Antes e depois ({changed.length} campo(s) com mudança)</h3>
            <DataTable caption="Comparação entre o estado anterior e o posterior" columns={cols} rows={rows} rowKey={(r) => r.path} empty="Sem dados de antes/depois." />
          </section>
        ) : <p className="text-sm text-bv-muted">Este registro não guarda estado anterior/posterior.</p>}
        {meta && (
          <section aria-label="Metadados">
            <h3 className="mb-2 font-semibold">Metadados</h3>
            <dl className="grid gap-1 text-sm">{Object.entries(meta).map(([k, v]) => <div key={k} className="flex flex-wrap gap-2"><dt className="font-mono text-xs text-bv-muted">{k}</dt><dd className="break-words">{v}</dd></div>)}</dl>
          </section>
        )}
        <p className="text-xs text-bv-muted">Campos que parecem conter segredos (senha, token, chave) são sempre ocultados nesta tela.</p>
      </div>
    </Dialog>
  );
}
