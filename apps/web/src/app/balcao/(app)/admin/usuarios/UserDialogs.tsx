'use client';
import React, { useState } from 'react';
import { bv, errMsg } from '@/lib/balcao/api';
import { ROLE_LABEL } from '@/lib/balcao/format';
import { Banner, Button, Dialog, Select, TextField, useToast } from '../../../_ui/ui';
import { copyText, fieldErrors, hasCode } from './_shared';

export interface Sector { id: string; name: string; email: string | null; active: boolean }
export interface AdminUser {
  id: string; email: string; name: string; role: 'ATENDENTE' | 'SUPERVISOR' | 'ADMIN' | 'FISCAL'; active: boolean; sectorId: string | null;
  skills: string[]; maxConcurrent: number; presence: string; sipExtension: string | null; totpEnabled: boolean; mustChangePassword: boolean;
  lastLoginAt: string | null; lockedUntil: string | null; createdAt: string;
}
export const ROLE_OPTIONS = ['ATENDENTE', 'SUPERVISOR', 'ADMIN', 'FISCAL'] as const;

/** Senha temporária: exibida uma única vez, com botão de copiar. */
export function TempPasswordDialog({ open, onClose, email, password, title = 'Senha temporária' }: { open: boolean; onClose: () => void; email: string; password: string; title?: string }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const copy = async () => { const ok = await copyText(password); setCopied(ok); if (ok) toast.success('Senha copiada.'); else toast.error('Não foi possível copiar. Selecione o texto e copie manualmente.'); };
  return (
    <Dialog open={open} onClose={onClose} title={title} footer={<Button onClick={onClose}>Já guardei a senha, fechar</Button>}>
      <div className="flex flex-col gap-3">
        <Banner tone="warning" title="Esta senha é exibida apenas uma vez">
          Ela não poderá ser consultada depois. Repasse ao usuário por um canal seguro; ele será obrigado a trocá-la no primeiro acesso.
        </Banner>
        <p className="text-sm">Usuário: <strong>{email}</strong></p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="select-all rounded-md border border-bv-border bg-bv-subtle px-3 py-2 font-mono text-lg tracking-wide" aria-label="Senha temporária">{password}</code>
          <Button variant="secondary" onClick={copy}>Copiar senha</Button>
          <span role="status" className="text-sm text-bv-success">{copied ? 'Senha copiada.' : ''}</span>
        </div>
      </div>
    </Dialog>
  );
}

/** Criar / editar usuário. O estado do formulário vive aqui (o Dialog não deve ser remontado a cada tecla). */
export function UserFormDialog({ open, onClose, user, sectors, isSelf, onSaved }: {
  open: boolean; onClose: () => void; user: AdminUser | null; sectors: Sector[]; isSelf: boolean;
  onSaved: (r: { user: AdminUser; temporaryPassword?: string }) => void;
}) {
  const toast = useToast();
  const editing = !!user;
  const [email, setEmail] = useState(user?.email ?? '');
  const [name, setName] = useState(user?.name ?? '');
  const [role, setRole] = useState<AdminUser['role']>(user?.role ?? 'ATENDENTE');
  const [skills, setSkills] = useState((user?.skills ?? []).join(', '));
  const [maxConcurrent, setMax] = useState(String(user?.maxConcurrent ?? 3));
  const [sectorId, setSectorId] = useState(user?.sectorId ?? '');
  const [sip, setSip] = useState(user?.sipExtension ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formErr, setFormErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formId = 'form-usuario';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!editing && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errs.email = 'Informe um e-mail válido.';
    if (name.trim().length < 2) errs.name = 'Informe o nome (mínimo de 2 caracteres).';
    const mc = Number(maxConcurrent);
    if (!Number.isInteger(mc) || mc < 1 || mc > 20) errs.maxConcurrent = 'Informe um número inteiro de 1 a 20.';
    if (sip.trim() && !/^[0-9A-Za-z_.-]{2,20}$/.test(sip.trim())) errs.sipExtension = 'Ramal inválido (2 a 20 caracteres alfanuméricos).';
    setErrors(errs); setFormErr(null);
    if (Object.keys(errs).length) { setFormErr('Corrija os campos destacados.'); return; }
    const skillList = [...new Set(skills.split(',').map((s) => s.trim()).filter(Boolean))];
    setBusy(true);
    try {
      if (editing) {
        const u = await bv.patch<AdminUser>(`/admin/users/${user!.id}`, { name: name.trim(), role, skills: skillList, maxConcurrent: mc, sectorId: sectorId || null, sipExtension: sip.trim() || null });
        toast.success('Usuário atualizado.'); onSaved({ user: u });
      } else {
        const r = await bv.post<{ user: AdminUser; temporaryPassword: string }>('/admin/users', { email: email.trim(), name: name.trim(), role, skills: skillList, maxConcurrent: mc, ...(sectorId ? { sectorId } : {}), ...(sip.trim() ? { sipExtension: sip.trim() } : {}) });
        toast.success('Usuário criado.'); onSaved(r);
      }
      onClose();
    } catch (err) {
      const fe = fieldErrors(err);
      const mapped: Record<string, string> = {};
      for (const [k, v] of Object.entries(fe)) mapped[k] = v;
      if (hasCode(err, 'user.email_taken')) mapped.email = errMsg(err);
      if (hasCode(err, 'user.sip_taken')) mapped.sipExtension = errMsg(err);
      setErrors(mapped);
      setFormErr(Object.keys(mapped).length ? 'Corrija os campos destacados.' : errMsg(err));
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onClose={onClose} title={editing ? `Editar usuário` : 'Novo usuário'} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form={formId} loading={busy}>{editing ? 'Salvar' : 'Criar usuário'}</Button></>}>
      <form id={formId} onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-2">
        {formErr && <div className="sm:col-span-2"><Banner tone="danger">{formErr}</Banner></div>}
        <TextField label="E-mail" type="email" required autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} disabled={editing} error={errors.email}
          hint={editing ? 'O e-mail não pode ser alterado.' : undefined} />
        <TextField label="Nome completo" required value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
        <Select label="Perfil" required value={role} onChange={(e) => setRole(e.target.value as AdminUser['role'])} disabled={editing && isSelf} error={errors.role}
          hint={editing && isSelf ? 'Você não pode alterar o seu próprio perfil.' : undefined}>
          {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </Select>
        <Select label="Setor" value={sectorId} onChange={(e) => setSectorId(e.target.value)} error={errors.sectorId}>
          <option value="">Sem setor</option>
          {sectors.filter((s) => s.active || s.id === user?.sectorId).map((s) => <option key={s.id} value={s.id}>{s.name}{s.active ? '' : ' (inativo)'}</option>)}
        </Select>
        <TextField label="Habilidades" value={skills} onChange={(e) => setSkills(e.target.value)} error={errors.skills} hint="Separe por vírgula. Usadas pelas filas para escolher o atendente." />
        <TextField label="Capacidade simultânea" type="number" min={1} max={20} required value={maxConcurrent} onChange={(e) => setMax(e.target.value)} error={errors.maxConcurrent}
          hint="Conversas ao mesmo tempo (1 a 20)." />
        <TextField label="Ramal SIP" value={sip} onChange={(e) => setSip(e.target.value)} error={errors.sipExtension} hint="Opcional. Necessário para atender chamadas de voz." />
      </form>
    </Dialog>
  );
}
