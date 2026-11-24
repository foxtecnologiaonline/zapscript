'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { API_ORIGIN, bv, errMsg } from '@/lib/balcao/api';
import { fmtDateTime } from '@/lib/balcao/format';
import { Badge, Banner, Button, Card, Checkbox, ConfirmDialog, DataTable, Spinner, Tabs, TextArea, TextField, useToast } from '../../../_ui/ui';
import { CopyField, fieldErrors, LogsPanel, SECRET_MASK, SecretField, StatusBadge, TestButton } from './_shared';

interface Conn { host?: string; port?: number; secure?: boolean; user?: string; pass?: string; accessToken?: string }
interface EmailView {
  configured: boolean; enabled: boolean; status: string; lastError: string | null; lastCheckAt: string | null;
  config: { imap?: Conn; smtp?: Conn; from?: { name?: string; address?: string }; mailbox?: string; autoReply?: { enabled: boolean; text: string }; pollIntervalSec?: number; inboundSecret?: string } | null;
  webhook: { path: string; secretConfigured: boolean };
}
interface Mailbox { id: string; address: string; folder: string; enabled: boolean; uidValidity: string | null; lastUid: string | null; lastPolledAt: string | null; lastError: string | null }
interface PollResult { polled: number; fetched: number; ingested: number; duplicates: number; ignored: number; failed: number; uidValidityReset?: boolean; error?: string }

export function EmailPanel({ onChanged }: { onChanged: () => void }) {
  return (
    <Tabs label="E-mail" tabs={[
      { id: 'em-conexao', title: 'Conexão', content: <Connection onChanged={onChanged} /> },
      { id: 'em-caixas', title: 'Caixas e coleta', content: <Mailboxes /> },
      { id: 'em-logs', title: 'Registros de chamadas', content: <LogsPanel type="EMAIL_IMAP" /> },
    ]} />
  );
}

function Connection({ onChanged }: { onChanged: () => void }) {
  const [v, setV] = useState<EmailView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  const load = useCallback(async () => {
    setError(null);
    try { setV(await bv.get<EmailView>('/email/config')); } catch (e) { setError(errMsg(e, 'Não foi possível carregar a configuração de e-mail.')); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (error) return <Banner tone="danger" title="Indisponível">{error}</Banner>;
  if (!v) return <div className="p-6 text-center"><Spinner /></div>;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2"><StatusBadge s={v} />{v.lastCheckAt && <span className="text-sm text-bv-muted">Última verificação: {fmtDateTime(v.lastCheckAt)}</span>}</div>
      {v.lastError && <Banner tone="danger" title="Último erro">{v.lastError}</Banner>}
      <EmailForm key={rev} v={v} onSaved={async () => { setRev((r) => r + 1); await load(); onChanged(); }} />
      <Card title="Testar conexão">
        <p className="mb-2 text-sm text-bv-muted">{v.configured ? 'Testa o servidor de entrada (IMAP) e o de saída (SMTP) com a configuração salva.' : 'Salve a configuração antes de testar.'}</p>
        <TestButton disabled={!v.configured} onDone={() => { void load(); onChanged(); }}
          run={async () => {
            const r = await bv.post<{ ok: boolean; imap: { ok: boolean; error?: string }; smtp: { ok: boolean; error?: string } }>('/email/config/test');
            return { ok: r.ok, message: r.ok ? 'Entrada (IMAP) e saída (SMTP) responderam.' : 'Verifique host, porta, usuário e senha de app.', details: [{ label: 'Entrada (IMAP)', ok: r.imap.ok, text: r.imap.error ?? '' }, { label: 'Saída (SMTP)', ok: r.smtp.ok, text: r.smtp.error ?? '' }] };
          }} />
      </Card>
    </div>
  );
}

function ConnFields({ id, title, c, s, set, errs }: { id: 'imap' | 'smtp'; title: string; c: Conn; s: { host: string; port: string; secure: boolean; user: string; pass: string; token: string }; set: (k: string, v: unknown) => void; errs: Record<string, string> }) {
  const p = (k: string) => `${id}.${k}`;
  return (
    <fieldset className="rounded-md border border-bv-border p-3">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      <div className="grid gap-3 md:grid-cols-2">
        <TextField label="Servidor (host)" required value={s.host} onChange={(e) => set(p('host'), e.target.value)} error={errs[p('host')]} placeholder={id === 'imap' ? 'imap.exemplo.gov.br' : 'smtp.exemplo.gov.br'} />
        <TextField label="Porta" required type="number" min={1} max={65535} value={s.port} onChange={(e) => set(p('port'), e.target.value)} error={errs[p('port')]} hint={id === 'imap' ? 'Geralmente 993 (TLS).' : '465 (TLS) ou 587 (STARTTLS).'} />
        <TextField label="Usuário" required value={s.user} onChange={(e) => set(p('user'), e.target.value)} error={errs[p('user')]} autoComplete="off" />
        <SecretField label="Senha (senha de app)" value={s.pass} onChange={(x) => set(p('pass'), x)} isSet={c.pass === SECRET_MASK} error={errs[p('pass')]} hint="Se mudar o usuário, informe a senha novamente." />
      </div>
      <div className="mt-2"><Checkbox label="Conexão segura direta (SSL/TLS)" hint={id === 'imap' ? 'Marque para a porta 993.' : 'Marque para a porta 465; desmarque para 587 (STARTTLS).'} checked={s.secure} onChange={(e) => set(p('secure'), e.target.checked)} /></div>
      <details className="mt-2"><summary className="cursor-pointer text-sm">OAuth2 (avançado)</summary>
        <div className="mt-2"><SecretField label="Token OAuth2 (access token)" value={s.token} onChange={(x) => set(p('token'), x)} isSet={c.accessToken === SECRET_MASK} hint="Expira em cerca de 1 hora e não é renovado automaticamente: use só para testes." /></div>
      </details>
    </fieldset>
  );
}

function EmailForm({ v, onSaved }: { v: EmailView; onSaved: () => void | Promise<void> }) {
  const toast = useToast();
  const c = v.config ?? {};
  const init = (x?: Conn, port = 993) => ({ host: x?.host ?? '', port: String(x?.port ?? port), secure: x?.secure ?? true, user: x?.user ?? '', pass: '', token: '' });
  const [imap, setImap] = useState(init(c.imap, 993)); const [smtp, setSmtp] = useState(init(c.smtp, 465));
  const [fromName, setFromName] = useState(c.from?.name ?? ''); const [fromAddr, setFromAddr] = useState(c.from?.address ?? '');
  const [mailbox, setMailbox] = useState(c.mailbox ?? 'INBOX'); const [poll, setPoll] = useState(String(c.pollIntervalSec ?? 30));
  const [arOn, setArOn] = useState(c.autoReply?.enabled ?? false);
  const [arText, setArText] = useState(c.autoReply?.text ?? 'Recebemos sua mensagem e em breve um atendente responderá. Protocolo: {{protocolo}}.');
  const [enabled, setEnabled] = useState(v.configured ? v.enabled : true);
  const [errs, setErrs] = useState<Record<string, string>>({}); const [formErr, setFormErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null); const [rotate, setRotate] = useState(false);

  const set = (k: string, val: unknown) => { const [g, f] = k.split('.'); (g === 'imap' ? setImap : setSmtp)((cur) => ({ ...cur, [f]: val })); };

  const build = (generate: boolean) => {
    const er: Record<string, string> = {};
    const conn = (id: 'imap' | 'smtp', s: typeof imap, prev?: Conn) => {
      if (!s.host.trim()) er[`${id}.host`] = 'Informe o servidor.';
      const port = Number(s.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) er[`${id}.port`] = 'Porta inválida (1 a 65535).';
      if (!s.user.trim()) er[`${id}.user`] = 'Informe o usuário.';
      const sameUser = prev?.user === s.user.trim();
      const hasPass = !!s.pass || (sameUser && prev?.pass === SECRET_MASK); const hasTok = !!s.token || (sameUser && prev?.accessToken === SECRET_MASK);
      if (!hasPass && !hasTok) er[`${id}.pass`] = 'Informe a senha de app (ou um token OAuth2).';
      return { host: s.host.trim(), port, secure: s.secure, user: s.user.trim(), ...(s.pass ? { pass: s.pass } : {}), ...(s.token ? { accessToken: s.token } : {}) };
    };
    const body: Record<string, unknown> = { imap: conn('imap', imap, c.imap), smtp: conn('smtp', smtp, c.smtp) };
    if (!fromAddr.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromAddr.trim())) er.fromAddr = 'Informe um e-mail de remetente válido.';
    body.from = { name: fromName.trim(), address: fromAddr.trim() };
    if (mailbox.trim()) body.mailbox = mailbox.trim();
    const pi = Number(poll);
    if (!Number.isInteger(pi) || pi < 10 || pi > 3600) er.poll = 'Informe de 10 a 3600 segundos.'; else body.pollIntervalSec = pi;
    if (arText.length > 2000) er.arText = 'No máximo 2.000 caracteres.';
    body.autoReply = { enabled: arOn, text: arText };
    body.enabled = enabled;
    if (generate) body.generateInboundSecret = true;
    return { body, er };
  };

  const save = async (generate: boolean) => {
    setFormErr(null);
    const { body, er } = build(generate);
    setErrs(er); if (Object.keys(er).length) { setFormErr('Corrija os campos indicados.'); return false; }
    setBusy(true);
    try {
      const r = await bv.put<{ ok: boolean; inboundSecret?: string }>('/email/config', body);
      if (r.inboundSecret) setNewSecret(r.inboundSecret);
      toast.success('Configuração de e-mail salva. Teste a conexão para validar.');
      if (!r.inboundSecret) await onSaved();
      return true;
    } catch (err) { const fe = fieldErrors(err); setErrs(fe.map); setFormErr([errMsg(err), ...fe.list].join(' ')); return false; }
    finally { setBusy(false); }
  };

  const webhookUrl = `${API_ORIGIN}${v.webhook.path}`;
  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={(e) => { e.preventDefault(); void save(false); }} noValidate className="flex flex-col gap-4">
        <ConnFields id="imap" title="Entrada de e-mails (IMAP)" c={c.imap ?? {}} s={imap} set={set} errs={errs} />
        <ConnFields id="smtp" title="Saída de e-mails (SMTP)" c={c.smtp ?? {}} s={smtp} set={set} errs={errs} />
        <fieldset className="rounded-md border border-bv-border p-3">
          <legend className="px-1 text-sm font-semibold">Remetente e coleta</legend>
          <div className="grid gap-3 md:grid-cols-2">
            <TextField label="Nome do remetente" value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Balcão Virtual TJTO" />
            <TextField label="E-mail do remetente" required type="email" value={fromAddr} onChange={(e) => setFromAddr(e.target.value)} error={errs.fromAddr} />
            <TextField label="Pasta monitorada" value={mailbox} onChange={(e) => setMailbox(e.target.value)} hint="Padrão: INBOX." />
            <TextField label="Intervalo de coleta (segundos)" type="number" min={10} max={3600} value={poll} onChange={(e) => setPoll(e.target.value)} error={errs.poll} hint="De 10 a 3.600." />
          </div>
        </fieldset>
        <fieldset className="rounded-md border border-bv-border p-3">
          <legend className="px-1 text-sm font-semibold">Resposta automática</legend>
          <Checkbox label="Enviar resposta automática ao receber um novo e-mail" hint="Uma por conversa, nunca para remetentes automáticos." checked={arOn} onChange={(e) => setArOn(e.target.checked)} />
          <div className="mt-2"><TextArea label="Texto da resposta automática" value={arText} onChange={(e) => setArText(e.target.value)} error={errs.arText} maxLength={2000} hint="Use {{protocolo}} para inserir o número de protocolo." /></div>
        </fieldset>
        <Checkbox label="Canal de e-mail ativado" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        {formErr && <Banner tone="danger" title="Não foi possível salvar">{formErr}</Banner>}
        <div><Button type="submit" loading={busy}>Salvar configuração</Button></div>
      </form>

      <Card title="Entrada por webhook (provedores que entregam e-mail por HTTP)">
        <p className="mb-3 text-sm text-bv-muted">Alternativa ao IMAP: o provedor envia o e-mail (MIME bruto) para a URL abaixo com o cabeçalho <code>X-Inbound-Secret</code>.</p>
        <div className="flex flex-col gap-3">
          <CopyField label="URL de entrada" value={webhookUrl} />
          <p className="text-sm">Segredo do webhook: <Badge tone={v.webhook.secretConfigured ? 'success' : 'warning'}>{v.webhook.secretConfigured ? 'configurado' : 'não configurado'}</Badge></p>
          {newSecret && (
            <Banner tone="warning" title="Copie o novo segredo agora — ele não será exibido de novo">
              <CopyField label="Novo segredo do webhook" value={newSecret} />
              <div className="mt-2"><Button size="sm" variant="secondary" onClick={() => { setNewSecret(null); void onSaved(); }}>Já copiei</Button></div>
            </Banner>
          )}
          <div><Button variant="secondary" disabled={!v.configured} onClick={() => setRotate(true)}>{v.webhook.secretConfigured ? 'Gerar novo segredo' : 'Gerar segredo'}</Button></div>
        </div>
      </Card>
      <ConfirmDialog open={rotate} onClose={() => setRotate(false)} title="Gerar segredo do webhook" confirmLabel="Gerar"
        message={`Será salvo o formulário atual e gerado um novo segredo.${v.webhook.secretConfigured ? ' O segredo anterior deixa de valer: atualize-o no provedor de e-mail.' : ''}`}
        onConfirm={async () => { await save(true); }} />
    </div>
  );
}

function Mailboxes() {
  const toast = useToast();
  const [items, setItems] = useState<Mailbox[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<PollResult | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try { setItems((await bv.get<{ items: Mailbox[] }>('/email/mailboxes')).items); } catch (e) { setError(errMsg(e, 'Não foi possível carregar as caixas.')); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const poll = async () => {
    setBusy(true); setRes(null);
    try { const r = await bv.post<PollResult>('/email/poll'); setRes(r); toast.success('Coleta concluída.'); await load(); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-bv-muted">A coleta roda sozinha no intervalo configurado. Use “Forçar coleta” para buscar novos e-mails agora.</p>
        <Button onClick={() => void poll()} loading={busy}>Forçar coleta agora</Button>
      </div>
      {res && (
        <Banner tone={res.failed || res.error ? 'warning' : 'success'} title="Resultado da coleta">
          {res.fetched} baixados · {res.ingested} registrados · {res.duplicates} repetidos · {res.ignored} ignorados (automáticos) · {res.failed} com falha{res.uidValidityReset ? ' · a caixa foi ressincronizada' : ''}{res.error ? ` — ${res.error}` : ''}.
        </Banner>
      )}
      {error && <Banner tone="danger" title="Indisponível">{error}</Banner>}
      {!items && !error ? <div className="p-6 text-center"><Spinner /></div> : items && (
        <DataTable caption="Caixas de e-mail monitoradas" rows={items} rowKey={(m) => m.id} empty="Nenhuma caixa monitorada. Salve a configuração de IMAP para criar."
          columns={[
            { key: 'a', header: 'Endereço', render: (m) => m.address },
            { key: 'f', header: 'Pasta', render: (m) => m.folder },
            { key: 'e', header: 'Situação', render: (m) => <Badge tone={m.lastError ? 'danger' : m.enabled ? 'success' : 'neutral'}>{m.lastError ? 'Com erro' : m.enabled ? 'Ativa' : 'Desativada'}</Badge> },
            { key: 'p', header: 'Última coleta', render: (m) => fmtDateTime(m.lastPolledAt) },
            { key: 'u', header: 'Último UID', render: (m) => m.lastUid ?? '—' },
            { key: 'er', header: 'Erro', render: (m) => m.lastError ?? '—' },
          ]} />
      )}
    </div>
  );
}
