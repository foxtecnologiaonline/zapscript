'use client';
import React, { useState } from 'react';
import QRCode from 'qrcode';
import { bv, errMsg } from '@/lib/balcao/api';
import { useBvSession } from '@/lib/balcao/session';
import { ROLE_LABEL } from '@/lib/balcao/format';
import { Banner, Button, Card, PageHeader, TextField, useToast } from '../../_ui/ui';
import { RecoveryCodesDialog, RecoveryStatus, RegenerateDialog } from './RecoveryCodes';

export default function ContaPage() {
  const { me, reload } = useBvSession();
  const toast = useToast();
  const [cur, setCur] = useState(''); const [next, setNext] = useState(''); const [next2, setNext2] = useState('');
  const [pwErr, setPwErr] = useState<string | null>(null); const [pwBusy, setPwBusy] = useState(false);
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState(''); const [mfaErr, setMfaErr] = useState<string | null>(null); const [mfaBusy, setMfaBusy] = useState(false);
  const [offPw, setOffPw] = useState(''); const [offCode, setOffCode] = useState('');
  const [codes, setCodes] = useState<{ list: string[]; title: string } | null>(null);
  const [regen, setRegen] = useState(false);
  if (!me) return null;
  const remaining = (me as { recoveryCodesRemaining?: number }).recoveryCodesRemaining ?? null;

  const changePw = async (e: React.FormEvent) => {
    e.preventDefault(); setPwErr(null);
    if (next !== next2) { setPwErr('A confirmação não confere com a nova senha.'); return; }
    setPwBusy(true);
    try { await bv.post('/auth/password', { currentPassword: cur, newPassword: next }); toast.success('Senha alterada. Suas outras sessões foram encerradas.'); setCur(''); setNext(''); setNext2(''); await reload(); }
    catch (err) { setPwErr(errMsg(err)); } finally { setPwBusy(false); }
  };
  const startMfa = async () => {
    setMfaErr(null);
    try { const r = await bv.post<{ secret: string; otpauthUrl: string }>('/auth/mfa/setup'); setSetup({ secret: r.secret, qr: await QRCode.toDataURL(r.otpauthUrl, { margin: 1, width: 192 }) }); }
    catch (err) { setMfaErr(errMsg(err)); }
  };
  const enableMfa = async (e: React.FormEvent) => {
    e.preventDefault(); setMfaBusy(true); setMfaErr(null);
    try {
      const r = await bv.post<{ recoveryCodes?: string[] }>('/auth/mfa/enable', { code });
      toast.success('Verificação em duas etapas ativada.'); setSetup(null); setCode('');
      if (r?.recoveryCodes?.length) setCodes({ list: r.recoveryCodes, title: 'Guarde seus códigos de recuperação' });
      await reload();
    }
    catch (err) { setMfaErr(errMsg(err)); } finally { setMfaBusy(false); }
  };
  const disableMfa = async (e: React.FormEvent) => {
    e.preventDefault(); setMfaBusy(true); setMfaErr(null);
    try { await bv.post('/auth/mfa/disable', { password: offPw, code: offCode }); toast.success('Verificação em duas etapas desativada.'); setOffPw(''); setOffCode(''); await reload(); }
    catch (err) { setMfaErr(errMsg(err)); } finally { setMfaBusy(false); }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Minha conta" subtitle={`${me.user.name} · ${ROLE_LABEL[me.user.role]} · ${me.user.email}`} />
      {me.mustChangePassword && <div className="mb-3"><Banner tone="warning" title="Troque a senha temporária">Por segurança, o acesso às demais telas fica bloqueado até você definir uma nova senha.</Banner></div>}
      {me.mfaSetupRequired && <div className="mb-3"><Banner tone="warning" title="Ative a verificação em duas etapas">Seu perfil exige um aplicativo autenticador. As demais telas ficam bloqueadas até você ativar.</Banner></div>}
      <div className="flex flex-col gap-4">
        <Card title="Alterar senha">
          <form onSubmit={changePw} className="flex flex-col gap-3">
            <TextField label="Senha atual" type="password" autoComplete="current-password" required value={cur} onChange={(e) => setCur(e.target.value)} />
            <TextField label="Nova senha" type="password" autoComplete="new-password" hint="Mínimo de 12 caracteres, com letras e números." required value={next} onChange={(e) => setNext(e.target.value)} />
            <TextField label="Confirmar nova senha" type="password" autoComplete="new-password" required value={next2} onChange={(e) => setNext2(e.target.value)} />
            {pwErr && <Banner tone="danger">{pwErr}</Banner>}
            <div><Button type="submit" loading={pwBusy}>Alterar senha</Button></div>
          </form>
        </Card>
        <Card title="Verificação em duas etapas (TOTP)">
          {me.totpEnabled ? (
            <form onSubmit={disableMfa} className="flex flex-col gap-3">
              <Banner tone="success">Ativada.</Banner>
              {remaining != null && <RecoveryStatus remaining={remaining} />}
              <div><Button variant="secondary" onClick={() => setRegen(true)}>Gerar novos códigos de recuperação</Button></div>
              <TextField label="Senha" type="password" required value={offPw} onChange={(e) => setOffPw(e.target.value)} />
              <TextField label="Código atual do aplicativo" inputMode="numeric" maxLength={6} required value={offCode} onChange={(e) => setOffCode(e.target.value.replace(/\D/g, ''))} />
              {mfaErr && <Banner tone="danger">{mfaErr}</Banner>}
              <div><Button type="submit" variant="danger" loading={mfaBusy}>Desativar</Button></div>
            </form>
          ) : !setup ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm">Proteja seu acesso com um aplicativo autenticador (Google Authenticator, Authy, Microsoft Authenticator).</p>
              {mfaErr && <Banner tone="danger">{mfaErr}</Banner>}
              <div><Button onClick={startMfa}>Configurar</Button></div>
            </div>
          ) : (
            <form onSubmit={enableMfa} className="flex flex-col gap-3">
              <p className="text-sm">1. Leia o QR code no aplicativo, ou digite a chave manualmente. 2. Informe o código de 6 dígitos gerado.</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={setup.qr} width={192} height={192} alt="QR code para configurar o aplicativo autenticador" />
              <p className="text-sm">Chave manual: <code className="select-all break-all font-mono">{setup.secret}</code></p>
              <TextField label="Código de 6 dígitos" inputMode="numeric" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              {mfaErr && <Banner tone="danger">{mfaErr}</Banner>}
              <div className="flex gap-2"><Button type="submit" loading={mfaBusy}>Ativar</Button><Button variant="secondary" onClick={() => setSetup(null)}>Cancelar</Button></div>
            </form>
          )}
        </Card>
      </div>
      {codes && <RecoveryCodesDialog codes={codes.list} title={codes.title} onClose={() => setCodes(null)} />}
      {regen && <RegenerateDialog onClose={() => setRegen(false)} onDone={(list) => { setRegen(false); setCodes({ list, title: 'Novos códigos de recuperação' }); void reload(); }} />}
    </div>
  );
}
