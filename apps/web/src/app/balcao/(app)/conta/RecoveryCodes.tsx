'use client';
import React, { useRef, useState } from 'react';
import { bv, errMsg } from '@/lib/balcao/api';
import { Badge, Banner, Button, Dialog, TextField, useToast } from '../../_ui/ui';

/** Alerta de poucos códigos restantes (≤ 2). */
export const LOW_RECOVERY = 2;

export function recoveryText(codes: string[]): string {
  return ['Balcão Virtual — códigos de recuperação do segundo fator', `Gerados em ${new Date().toLocaleString('pt-BR')}`, 'Cada código vale uma única vez. Guarde em local seguro e não compartilhe.', '', ...codes, ''].join('\n');
}

/** Estado dos códigos restantes (texto + selo; nunca só cor). */
export function RecoveryStatus({ remaining }: { remaining: number }) {
  const low = remaining <= LOW_RECOVERY;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">
        Códigos de recuperação restantes: <strong>{remaining}</strong>{' '}
        <Badge tone={remaining === 0 ? 'danger' : low ? 'warning' : 'success'}>{remaining === 0 ? 'Nenhum restante' : low ? 'Poucos restantes' : 'Suficientes'}</Badge>
      </p>
      {low && <Banner tone={remaining === 0 ? 'danger' : 'warning'} title="Gere novos códigos de recuperação">
        {remaining === 0 ? 'Seus códigos acabaram. Se perder o aplicativo autenticador, você não conseguirá entrar sem ajuda de um administrador.' : 'Restam poucos códigos. Gere um novo conjunto antes que acabem.'}
      </Banner>}
    </div>
  );
}

/** Mostra os códigos UMA vez. Só fecha depois de "Guardei meus códigos". */
export function RecoveryCodesDialog({ codes, onClose, title = 'Seus códigos de recuperação' }: { codes: string[]; onClose: () => void; title?: string }) {
  const toast = useToast();
  const [hint, setHint] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  const copy = async () => {
    const text = codes.join('\n');
    try { await navigator.clipboard.writeText(text); toast.success('Códigos copiados. Cole em um local seguro.'); }
    catch {
      // sem permissão da área de transferência: seleciona o texto para copiar manualmente
      const el = listRef.current; if (el) { const r = document.createRange(); r.selectNodeContents(el); const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(r); }
      toast.error('Não foi possível copiar automaticamente. Os códigos foram selecionados: use Ctrl+C.');
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([recoveryText(codes)], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'balcao-codigos-de-recuperacao.txt'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  return (
    <Dialog open title={title} onClose={() => setHint(true)}
      footer={<Button onClick={onClose}>Guardei meus códigos</Button>}>
      <div className="flex flex-col gap-3">
        <Banner tone="warning" title="Guarde estes códigos agora">
          Eles não serão mostrados novamente. Cada código funciona uma única vez e substitui o aplicativo autenticador caso você o perca. Guarde-os em local seguro (gerenciador de senhas ou impresso), longe do computador de trabalho.
        </Banner>
        <ul ref={listRef} aria-label="Códigos de recuperação" className="grid grid-cols-2 gap-2 rounded-md border border-bv-border bg-bv-subtle p-3 font-mono text-base">
          {codes.map((c) => <li key={c} className="select-all">{c}</li>)}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void copy()}>Copiar</Button>
          <Button variant="secondary" onClick={download}>Baixar .txt</Button>
        </div>
        {hint && <p role="alert" className="text-sm text-bv-danger">Para fechar, confirme que guardou os códigos usando o botão “Guardei meus códigos”.</p>}
      </div>
    </Dialog>
  );
}

/** Regenera os códigos (senha + código atual do aplicativo). Invalida o conjunto anterior. */
export function RegenerateDialog({ onClose, onDone }: { onClose: () => void; onDone: (codes: string[], remaining: number) => void }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const r = await bv.post<{ recoveryCodes: string[]; recoveryCodesRemaining: number }>('/auth/mfa/recovery-codes/regenerate', { password, code });
      onDone(r.recoveryCodes, r.recoveryCodesRemaining);
    } catch (err) { setError(errMsg(err, 'Não foi possível gerar novos códigos.')); setCode(''); } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} title="Gerar novos códigos de recuperação" size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="bv-regen-form" loading={busy}>Gerar novos códigos</Button></>}>
      <form id="bv-regen-form" onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <p className="text-sm">Os códigos atuais, inclusive os não usados, deixarão de valer. Confirme com sua senha e o código atual do aplicativo autenticador.</p>
        <TextField label="Senha" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <TextField label="Código atual do aplicativo" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
        {error && <Banner tone="danger">{error}</Banner>}
      </form>
    </Dialog>
  );
}
