'use client';
import React, { useState } from 'react';
import { Banner, Button, Dialog, TextField } from '../../../_ui/ui';
import { errFull } from '../usuarios/_shared';

/**
 * Confirmação forte para ações irreversíveis: exige digitar uma palavra e bloqueia o botão até conferir.
 * `children` permite campos extras (ex.: justificativa) dentro do mesmo formulário.
 */
export default function StrongConfirm({ title, warning, phrase, confirmLabel, onConfirm, onClose, canSubmit = true, children, danger = true }: {
  title: string; warning: React.ReactNode; phrase: string; confirmLabel: string; onConfirm: () => Promise<void>; onClose: () => void; canSubmit?: boolean; children?: React.ReactNode; danger?: boolean;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ok = typed.trim().toUpperCase() === phrase.toUpperCase();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok || !canSubmit) return;
    setBusy(true); setErr(null);
    try { await onConfirm(); onClose(); } catch (e2) { setErr(errFull(e2)); } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} title={title}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="form-strong" variant={danger ? 'danger' : 'primary'} loading={busy} disabled={!ok || !canSubmit}>{confirmLabel}</Button></>}>
      <form id="form-strong" onSubmit={submit} noValidate className="flex flex-col gap-3">
        <Banner tone="danger" title="Atenção">{warning}</Banner>
        {children}
        {err && <Banner tone="danger">{err}</Banner>}
        <TextField label={`Para confirmar, digite ${phrase}`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false}
          hint="A confirmação evita ações acidentais." />
      </form>
    </Dialog>
  );
}
