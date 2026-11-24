'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { API_ORIGIN, bv, errMsg } from '@/lib/balcao/api';
import { fmtDateTime } from '@/lib/balcao/format';
import { Badge, Banner, Button, Card, Checkbox, ConfirmDialog, DataTable, Spinner, Tabs, TextArea, TextField, useToast } from '../../../_ui/ui';
import { CopyField, fieldErrors, LogsPanel, SECRET_MASK, SecretField, StatusBadge, TestButton } from './_shared';

interface OAuthView { type?: string; clientId?: string; clientSecret?: string; refreshToken?: string; user?: string; tokenUrl?: string }
interface Conn { host?: string; port?: number; secure?: boolean; user?: string; pass?: string; accessToken?: string }
interface EmailView {
  configured: boolean; enabled: boolean; status: string; lastError: string | null; lastCheckAt: string | null;
  config: { imap?: Conn; smtp?: Conn; auth?: OAuthView; from?: { name?: string; address?: string }; mailbox?: string; autoReply?: { enabled: boolean; text: string }; pollIntervalSec?: number; inboundSecret?: string } | null;
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
        <p className="mb-2 text-sm text-bv-muted">{v.configured ? 'Testa o servidor de entrada (IMAP) e o de saída (SMTP) com a configuração salva. Com OAuth2, também obtém um token de acesso no servidor do Google.' : 'Salve a configuração antes de testar.'}</p>
        <TestButton disabled={!v.configured} onDone={() => { void load(); onChanged(); }}
          run={async () => {
            const r = await bv.post<{ ok: boolean; imap: { ok: boolean; error?: string }; smtp: { ok: boolean; error?: string } }>('/email/config/test');
            return { ok: r.ok, message: r.ok ? 'Entrada (IMAP) e saída (SMTP) responderam.' : 'Verifique host, porta e credenciais (senha de app, ou client ID, client secret e refresh token do OAuth2).', details: [{ label: 'Entrada (IMAP)', ok: r.imap.ok, text: r.imap.error ?? '' }, { label: 'Saída (SMTP)', ok: r.smtp.ok, text: r.smtp.error ?? '' }] };
          }} />
      </Card>
    </div>
  );
}

function ConnFields({ id, title, c, s, set, errs, oauth }: { id: 'imap' | 'smtp'; title: string; oauth: boolean; c: Conn; s: { host: string; port: string; secure: boolean; user: string; pass: string; token: string }; set: (k: string, v: unknown) => void; errs: Record<string, string> }) {
  const p = (k: string) => `${id}.${k}`;
  return (
    <fieldset className="rounded-md border border-bv-border p-3">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      <div className="grid gap-3 md:grid-cols-2">
        <TextField label="Servidor (host)" required value={s.host} onChange={(e) => set(p('host'), e.target.value)} error={errs[p('host')]} placeholder={id === 'imap' ? 'imap.exemplo.gov.br' : 'smtp.exemplo.gov.br'} />
        <TextField label="Porta" required type="number" min={1} max={65535} value={s.port} onChange={(e) => set(p('port'), e.target.value)} error={errs[p('port')]} hint={id === 'imap' ? 'Geralmente 993 (TLS).' : '465 (TLS) ou 587 (STARTTLS).'} />
        {!oauth && <TextField label="Usuário" required value={s.user} onChange={(e) => set(p('user'), e.target.value)} error={errs[p('user')]} autoComplete="off" />}
        {!oauth && <SecretField label="Senha (senha de app)" value={s.pass} onChange={(x) => set(p('pass'), x)} isSet={c.pass === SECRET_MASK} error={errs[p('pass')]} hint="Se mudar o usuário, informe a senha novamente." />}
      </div>
      {oauth && <p className="mt-2 text-xs text-bv-muted">Com OAuth2 o usuário é o e-mail da conta informado em “Credenciais OAuth2” e não há senha neste servidor.</p>}
      <div className="mt-2"><Checkbox label="Conexão segura direta (SSL/TLS)" hint={id === 'imap' ? 'Marque para a porta 993.' : 'Marque para a porta 465; desmarque para 587 (STARTTLS).'} checked={s.secure} onChange={(e) => set(p('secure'), e.target.checked)} /></div>
      {!oauth && (
        <details className="mt-2"><summary className="cursor-pointer text-sm">Token de acesso estático (avançado, só para testes)</summary>
          <div className="mt-2"><SecretField label="Token OAuth2 (access token)" value={s.token} onChange={(x) => set(p('token'), x)} isSet={c.accessToken === SECRET_MASK} hint="Expira em cerca de 1 hora e não é renovado automaticamente. Para uso contínuo, escolha “OAuth2 (Google Workspace)” em Autenticação." /></div>
        </details>
      )}
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
  const oa = c.auth?.type === 'oauth2' ? c.auth : undefined;
  const [authType, setAuthType] = useState<'password' | 'oauth2'>(oa ? 'oauth2' : 'password');
  const [oClientId, setOClientId] = useState(oa?.clientId ?? ''); const [oSecret, setOSecret] = useState(''); const [oRefresh, setORefresh] = useState('');
  const [oUser, setOUser] = useState(oa?.user ?? c.smtp?.user ?? c.imap?.user ?? ''); const [oTokenUrl, setOTokenUrl] = useState(oa?.tokenUrl ?? '');
  const oauth = authType === 'oauth2';

  const set = (k: string, val: unknown) => { const [g, f] = k.split('.'); (g === 'imap' ? setImap : setSmtp)((cur) => ({ ...cur, [f]: val })); };

  const build = (generate: boolean) => {
    const er: Record<string, string> = {};
    const conn = (id: 'imap' | 'smtp', s: typeof imap, prev?: Conn) => {
      if (!s.host.trim()) er[`${id}.host`] = 'Informe o servidor.';
      const port = Number(s.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) er[`${id}.port`] = 'Porta inválida (1 a 65535).';
      if (oauth) return { host: s.host.trim(), port, secure: s.secure }; // usuário vem de auth.user; sem senha
      if (!s.user.trim()) er[`${id}.user`] = 'Informe o usuário.';
      const sameUser = prev?.user === s.user.trim();
      const hasPass = !!s.pass || (sameUser && prev?.pass === SECRET_MASK); const hasTok = !!s.token || (sameUser && prev?.accessToken === SECRET_MASK);
      if (!hasPass && !hasTok) er[`${id}.pass`] = 'Informe a senha de app (ou use a autenticação OAuth2).';
      return { host: s.host.trim(), port, secure: s.secure, user: s.user.trim(), ...(s.pass ? { pass: s.pass } : {}), ...(s.token ? { accessToken: s.token } : {}) };
    };
    const body: Record<string, unknown> = { imap: conn('imap', imap, c.imap), smtp: conn('smtp', smtp, c.smtp) };
    if (oauth) {
      const cid = oClientId.trim(); const usr = oUser.trim(); const tu = oTokenUrl.trim();
      if (!cid) er.oClientId = 'Informe o ID do cliente OAuth.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(usr)) er.oUser = 'Informe o e-mail da conta dona do refresh token.';
      const sameClient = oa?.clientId === cid; const sameAccount = sameClient && oa?.user === usr;
      if (!oSecret && !(sameClient && oa?.clientSecret === SECRET_MASK)) er.oSecret = sameClient || !oa ? 'Informe o client secret.' : 'Ao trocar o ID do cliente, informe o client secret novamente.';
      if (!oRefresh && !(sameAccount && oa?.refreshToken === SECRET_MASK)) er.oRefresh = sameAccount || !oa ? 'Informe o refresh token.' : 'Ao trocar a conta ou o cliente, informe o refresh token novamente.';
      if (tu && !/^https:\/\//i.test(tu)) er.oTokenUrl = 'A URL do servidor de token deve usar https://.';
      body.auth = { type: 'oauth2', clientId: cid, user: usr, ...(oSecret ? { clientSecret: oSecret } : {}), ...(oRefresh ? { refreshToken: oRefresh } : {}), ...(tu ? { tokenUrl: tu } : {}) };
    }
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
    } catch (err) {
      const fe = fieldErrors(err);
      const AUTH: Record<string, string> = { 'auth.clientId': 'oClientId', 'auth.clientSecret': 'oSecret', 'auth.refreshToken': 'oRefresh', 'auth.user': 'oUser', 'auth.tokenUrl': 'oTokenUrl' };
      setErrs(Object.fromEntries(Object.entries(fe.map).map(([k, m]) => [AUTH[k] ?? k, m]))); setFormErr([errMsg(err), ...fe.list].join(' ')); return false;
    }
    finally { setBusy(false); }
  };

  const webhookUrl = `${API_ORIGIN}${v.webhook.path}`;
  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={(e) => { e.preventDefault(); void save(false); }} noValidate className="flex flex-col gap-4">
        <fieldset className="rounded-md border border-bv-border p-3">
          <legend className="px-1 text-sm font-semibold">Autenticação</legend>
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
            {([['password', 'Senha de app'], ['oauth2', 'OAuth2 (Google Workspace)']] as const).map(([val, label]) => (
              <label key={val} className="flex min-h-[40px] items-center gap-2 text-sm">
                <input type="radio" name="email-auth" value={val} checked={authType === val} onChange={() => setAuthType(val)} className="h-5 w-5 accent-[rgb(var(--bv-primary))]" />
                {label}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-bv-muted">{oauth ? 'O token de acesso é obtido e renovado automaticamente a partir do refresh token; não há senha para trocar.' : 'Mais simples: use uma senha de app da conta (exige verificação em duas etapas). Servidores que só aceitam OAuth2 precisam da outra opção.'}</p>
        </fieldset>
        {oauth && (
          <fieldset className="rounded-md border border-bv-border p-3">
            <legend className="px-1 text-sm font-semibold">Credenciais OAuth2</legend>
            <div className="grid gap-3 md:grid-cols-2">
              <TextField label="ID do cliente (client ID)" required value={oClientId} onChange={(e) => setOClientId(e.target.value)} error={errs.oClientId} placeholder="123456.apps.googleusercontent.com" autoComplete="off" spellCheck={false} />
              <SecretField label="Chave secreta do cliente (client secret)" value={oSecret} onChange={setOSecret} isSet={oa?.clientSecret === SECRET_MASK} required error={errs.oSecret} hint="Ao trocar o ID do cliente, informe-a novamente." />
              <TextField label="E-mail da conta (usuário)" required type="email" value={oUser} onChange={(e) => setOUser(e.target.value)} error={errs.oUser} autoComplete="off" hint="A conta que autorizou o acesso e dona do refresh token." />
              <SecretField label="Refresh token" value={oRefresh} onChange={setORefresh} isSet={oa?.refreshToken === SECRET_MASK} required error={errs.oRefresh} area hint="Ao trocar a conta, informe-o novamente." />
              <TextField label="URL do servidor de token (opcional)" value={oTokenUrl} onChange={(e) => setOTokenUrl(e.target.value)} error={errs.oTokenUrl} placeholder="https://oauth2.googleapis.com/token" autoComplete="off" spellCheck={false} className="md:col-span-2"
                hint="Em branco usa o do Google (https://oauth2.googleapis.com/token) ou mantém o já salvo. Precisa usar https." />
            </div>
            <details className="mt-3 rounded-md bg-bv-subtle p-3 text-sm">
              <summary className="cursor-pointer font-medium">Como obter o refresh token no Google Cloud</summary>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>No <strong>Google Admin Console</strong>, habilite o acesso por IMAP para a conta (Apps &gt; Google Workspace &gt; Gmail &gt; Configurações do usuário final).</li>
                <li>No <strong>Google Cloud Console</strong>, crie ou escolha um projeto e configure a <em>Tela de consentimento OAuth</em>. Para contas do próprio Workspace, prefira o tipo <em>Interno</em>.</li>
                <li>Em <em>APIs e serviços &gt; Credenciais</em>, crie um <strong>ID do cliente OAuth</strong> (tipo “Aplicativo da Web” ou “App para computador”). Copie o <strong>ID do cliente</strong> e a <strong>chave secreta</strong>. Se for usar o OAuth 2.0 Playground, cadastre <code>https://developers.google.com/oauthplayground</code> como URI de redirecionamento.</li>
                <li>Autorize o escopo <code>https://mail.google.com/</code> com a conta do Balcão, pedindo acesso <strong>offline</strong> (<code>access_type=offline</code> e <code>prompt=consent</code>). No OAuth 2.0 Playground: engrenagem &gt; “Use your own OAuth credentials” &gt; informe o ID e a chave &gt; autorize o escopo acima &gt; “Exchange authorization code for tokens”.</li>
                <li>Copie o <strong>refresh token</strong> (costuma começar com <code>1//</code>) e cole acima. Ele é guardado cifrado e nunca é exibido de novo.</li>
              </ol>
              <p className="mt-2 text-bv-muted">Atenção: em aplicativos com o consentimento em modo “Teste”, o refresh token expira em 7 dias; publique o app (ou use o tipo Interno). Se o token for revogado pelo administrador, o teste de conexão mostrará “invalid_grant” e será preciso gerar outro. Microsoft 365/Exchange Online não é suportado por esta opção.</p>
            </details>
          </fieldset>
        )}
        <ConnFields id="imap" title="Entrada de e-mails (IMAP)" oauth={oauth} c={c.imap ?? {}} s={imap} set={set} errs={errs} />
        <ConnFields id="smtp" title="Saída de e-mails (SMTP)" oauth={oauth} c={c.smtp ?? {}} s={smtp} set={set} errs={errs} />
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
