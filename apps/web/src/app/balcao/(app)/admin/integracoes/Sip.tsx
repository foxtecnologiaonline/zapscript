'use client';
import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { bv, errMsg } from '@/lib/balcao/api';
import { fmtDateTime } from '@/lib/balcao/format';
import { Badge, Banner, Button, Card, Checkbox, Select, Spinner, StatCard, Tabs, TextArea, TextField, useToast } from '../../../_ui/ui';
import { fieldErrors, LogsPanel, postLoose, SECRET_MASK, SecretField, StatusBadge, TestButton } from './_shared';

interface Trunk {
  host?: string; port?: number; transport?: 'udp' | 'tcp' | 'tls'; authMode?: 'registration' | 'userpass' | 'ip'; username?: string; password?: string; identifyIps?: string[];
  codecs?: string[]; dtmfMode?: 'rfc4733' | 'inband' | 'info'; fromUser?: string; fromDomain?: string; trunkEndpoint?: string; dids?: string[]; preserveHeaders?: string[];
  transferCallerId?: 'original' | 'trunk'; transferRingSec?: number; speakProtocol?: 'start' | 'off'; autoCloseOnEnd?: boolean; recordIvrPhase?: boolean;
  ari?: { url?: string; username?: string; password?: string };
}
interface SipView {
  configured: boolean; enabled: boolean; status: string; config: Trunk; defaults: Trunk;
  environment: { voiceEnabled: boolean; ariUrl: string | null; agentExtensions: { start: string | null; end: string | null }; sipSecretConfigured: boolean };
}
interface AriStatus { enabled: boolean; connected: boolean; started: boolean; app?: string; url?: string; reconnects?: number; lastEventAt?: string | null; lastError?: string | null; activeCalls?: number; byState?: Record<string, number> }

const CODECS = [['ulaw', 'G.711 µ-law (ulaw)'], ['alaw', 'G.711 A-law (alaw)'], ['opus', 'Opus'], ['g722', 'G.722']] as const;
const lines = (a?: string[]) => (a ?? []).join('\n');
const parseList = (t: string) => Array.from(new Set(t.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)));

/** Painel da telefonia SIP (tronco + ARI) e da URA 0800 (DIDs ficam no tronco; fluxos em /balcao/admin/ura). */
export function SipPanel({ onChanged }: { onChanged: () => void }) {
  return (
    <Tabs label="Telefonia SIP" tabs={[
      { id: 'sip-tronco', title: 'Tronco SIP e DIDs', content: <Trunks onChanged={onChanged} /> },
      { id: 'sip-estado', title: 'Estado da telefonia (ARI)', content: <AriState /> },
      { id: 'sip-logs', title: 'Registros de chamadas', content: <LogsPanel type="SIP_TRUNK" /> },
    ]} />
  );
}

function Trunks({ onChanged }: { onChanged: () => void }) {
  const [v, setV] = useState<SipView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  const load = useCallback(async () => {
    setError(null);
    try { setV(await bv.get<SipView>('/voice/config')); } catch (e) { setError(errMsg(e, 'Telefonia indisponível neste servidor.')); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (error) return <Banner tone="warning" title="Indisponível">{error}</Banner>;
  if (!v) return <div className="p-6 text-center"><Spinner /></div>;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2"><StatusBadge s={v} /></div>
      <Card title="Ambiente do servidor (somente leitura)">
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div className="flex gap-1"><dt className="text-bv-muted">Telefonia habilitada no servidor:</dt><dd>{v.environment.voiceEnabled ? 'Sim' : 'Não (BV_VOICE_ENABLED)'}</dd></div>
          <div className="flex gap-1"><dt className="text-bv-muted">URL do ARI (Asterisk):</dt><dd>{v.environment.ariUrl ?? 'não definida no ambiente'}</dd></div>
          <div className="flex gap-1"><dt className="text-bv-muted">Faixa de ramais dos atendentes:</dt><dd>{v.environment.agentExtensions.start && v.environment.agentExtensions.end ? `${v.environment.agentExtensions.start} a ${v.environment.agentExtensions.end}` : '—'}</dd></div>
          <div className="flex gap-1"><dt className="text-bv-muted">Segredo SIP dos softphones:</dt><dd>{v.environment.sipSecretConfigured ? 'configurado' : 'não configurado'}</dd></div>
        </dl>
      </Card>
      <TrunkForm key={rev} v={v} onSaved={async () => { setRev((r) => r + 1); await load(); onChanged(); }} />
      <Card title="Testar conexão">
        <p className="mb-2 text-sm text-bv-muted">Verifica o ARI do Asterisk e se o tronco SIP está registrado/online.</p>
        <TestButton onDone={() => { void load(); onChanged(); }}
          run={async () => {
            const { status, body } = await postLoose<{ ok: boolean; ari?: { ok: boolean; version?: string | null; connected?: boolean; error?: string }; trunk?: { endpoint: string; state: string | null }; error?: { message?: string } }>('/voice/config/test');
            if (!body) return { ok: false, message: `Sem resposta do servidor (HTTP ${status}).` };
            if (body.error) return { ok: false, message: body.error.message ?? 'Telefonia desabilitada ou ARI não configurado.' };
            const ari = body.ari;
            return {
              ok: !!body.ok, message: body.ok ? 'ARI conectado e tronco online.' : ari && !ari.ok ? 'Não foi possível falar com o ARI do Asterisk.' : `O tronco não está online (estado: ${body.trunk?.state ?? 'desconhecido'}).`,
              details: [
                { label: 'ARI do Asterisk', ok: !!ari?.ok, text: ari?.ok ? `versão ${ari.version ?? '—'}${ari.connected ? ', stream conectado' : ', stream desconectado'}` : ari?.error ?? '' },
                ...(body.trunk ? [{ label: `Tronco ${body.trunk.endpoint}`, ok: body.trunk.state === 'online', text: `estado ${body.trunk.state ?? '—'}` }] : []),
              ],
            };
          }} />
      </Card>
      <Card title="URA 0800">
        <p className="text-sm">Os números 0800/DIDs que chegam pelo tronco são cadastrados no campo <strong>DIDs</strong> acima. Os fluxos de atendimento (menus, horários, transferências) são editados em <Link className="underline" href="/balcao/admin/ura">URA (atendimento por voz)</Link>. Não há credenciais separadas para a URA 0800 nesta versão.</p>
      </Card>
    </div>
  );
}

function TrunkForm({ v, onSaved }: { v: SipView; onSaved: () => void | Promise<void> }) {
  const toast = useToast();
  const c = v.config ?? {}; const d = v.defaults ?? {};
  const [host, setHost] = useState(c.host ?? ''); const [port, setPort] = useState(c.port ? String(c.port) : '5060');
  const [transport, setTransport] = useState(c.transport ?? 'udp'); const [authMode, setAuthMode] = useState(c.authMode ?? 'registration');
  const [username, setUsername] = useState(c.username ?? ''); const [password, setPassword] = useState('');
  const [ips, setIps] = useState(lines(c.identifyIps)); const [codecs, setCodecs] = useState<string[]>(c.codecs ?? ['ulaw', 'alaw']);
  const [dtmf, setDtmf] = useState(c.dtmfMode ?? 'rfc4733'); const [fromUser, setFromUser] = useState(c.fromUser ?? ''); const [fromDomain, setFromDomain] = useState(c.fromDomain ?? '');
  const [endpoint, setEndpoint] = useState(c.trunkEndpoint ?? d.trunkEndpoint ?? 'tjto-trunk');
  const [dids, setDids] = useState(lines(c.dids)); const [headers, setHeaders] = useState(lines(c.preserveHeaders ?? d.preserveHeaders));
  const [callerId, setCallerId] = useState(c.transferCallerId ?? d.transferCallerId ?? 'original'); const [ring, setRing] = useState(String(c.transferRingSec ?? d.transferRingSec ?? 45));
  const [speak, setSpeak] = useState(c.speakProtocol ?? d.speakProtocol ?? 'start');
  const [autoClose, setAutoClose] = useState(c.autoCloseOnEnd ?? d.autoCloseOnEnd ?? true); const [recIvr, setRecIvr] = useState(c.recordIvrPhase ?? d.recordIvrPhase ?? true);
  const [ariUrl, setAriUrl] = useState(c.ari?.url ?? ''); const [ariUser, setAriUser] = useState(c.ari?.username ?? ''); const [ariPass, setAriPass] = useState('');
  const [enabled, setEnabled] = useState(v.configured ? v.enabled : true);
  const [errs, setErrs] = useState<Record<string, string>>({}); const [formErr, setFormErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const pwSet = c.password === SECRET_MASK; const ariPwSet = c.ari?.password === SECRET_MASK;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setFormErr(null);
    const er: Record<string, string> = {};
    const config: Record<string, unknown> = {};
    if (host.trim()) config.host = host.trim();
    const p = Number(port); if (port.trim()) { if (!Number.isInteger(p) || p < 1 || p > 65535) er.port = 'Porta inválida (1 a 65535).'; else config.port = p; }
    config.transport = transport; config.authMode = authMode;
    if (username.trim()) config.username = username.trim();
    if (password) config.password = password; else if (pwSet) config.password = SECRET_MASK;
    if (authMode !== 'ip' && !username.trim() && !c.username) er.username = 'Informe o usuário do tronco.';
    const ipList = parseList(ips); if (ipList.length) config.identifyIps = ipList;
    if (authMode === 'ip' && !ipList.length) er.identifyIps = 'No modo por IP, informe ao menos um IP da operadora.';
    if (codecs.length) config.codecs = codecs;
    config.dtmfMode = dtmf;
    if (fromUser.trim()) config.fromUser = fromUser.trim(); if (fromDomain.trim()) config.fromDomain = fromDomain.trim();
    if (!/^[A-Za-z0-9_.-]{1,60}$/.test(endpoint.trim())) er.trunkEndpoint = 'Use letras, números, ponto, hífen ou _ (até 60).'; else config.trunkEndpoint = endpoint.trim();
    const didList = parseList(dids); if (didList.some((x) => !/^\+?[0-9*#]{2,20}$/.test(x))) er.dids = 'Cada número deve ter de 2 a 20 dígitos (pode começar com +).'; else config.dids = didList;
    const hl = parseList(headers); if (hl.some((x) => !/^[Xx]-[A-Za-z0-9-]{1,60}$/.test(x))) er.preserveHeaders = 'Cada cabeçalho deve começar com X- (ex.: X-URA-Option).'; else config.preserveHeaders = hl;
    config.transferCallerId = callerId;
    const r = Number(ring); if (!Number.isInteger(r) || r < 5 || r > 120) er.transferRingSec = 'Informe de 5 a 120 segundos.'; else config.transferRingSec = r;
    config.speakProtocol = speak; config.autoCloseOnEnd = autoClose; config.recordIvrPhase = recIvr;
    if (ariUrl.trim() || ariUser.trim() || ariPass) {
      if (!/^https?:\/\//i.test(ariUrl.trim())) er.ariUrl = 'Informe a URL completa do ARI (http:// ou https://).';
      if (!ariUser.trim()) er.ariUser = 'Informe o usuário do ARI.';
      config.ari = { url: ariUrl.trim(), username: ariUser.trim(), password: ariPass || (ariPwSet ? SECRET_MASK : '') };
    }
    setErrs(er); if (Object.keys(er).length) { setFormErr('Corrija os campos indicados.'); return; }
    setBusy(true);
    try { await bv.put('/voice/config', { enabled, config }); toast.success('Configuração do tronco salva. Teste a conexão para validar.'); await onSaved(); }
    catch (err) { const fe = fieldErrors(err); setErrs(fe.map); setFormErr([errMsg(err), ...fe.list].join(' ')); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <fieldset className="rounded-md border border-bv-border p-3">
        <legend className="px-1 text-sm font-semibold">Tronco SIP (operadora / VoIP do tribunal)</legend>
        <div className="grid gap-3 md:grid-cols-2">
          <TextField label="Servidor (host)" value={host} onChange={(e) => setHost(e.target.value)} placeholder="sip.operadora.com.br" />
          <TextField label="Porta" type="number" min={1} max={65535} value={port} onChange={(e) => setPort(e.target.value)} error={errs.port} />
          <Select label="Transporte" value={transport} onChange={(e) => setTransport(e.target.value as typeof transport)}><option value="udp">UDP</option><option value="tcp">TCP</option><option value="tls">TLS</option></Select>
          <Select label="Autenticação" value={authMode} onChange={(e) => setAuthMode(e.target.value as typeof authMode)} hint="Registro: o Asterisk se registra na operadora. Usuário/senha: autentica cada chamada. IP: a operadora libera o IP do servidor.">
            <option value="registration">Registro (usuário e senha)</option><option value="userpass">Usuário e senha por chamada</option><option value="ip">Por IP de origem</option>
          </Select>
          {authMode !== 'ip' && <TextField label="Usuário" value={username} onChange={(e) => setUsername(e.target.value)} error={errs.username} autoComplete="off" />}
          {authMode !== 'ip' && <SecretField label="Senha do tronco" value={password} onChange={setPassword} isSet={pwSet} />}
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <TextArea label="IPs da operadora (identificação)" value={ips} onChange={(e) => setIps(e.target.value)} error={errs.identifyIps} rows={3} className="font-mono text-sm" hint="Um por linha. Usados para reconhecer chamadas de entrada." />
          <TextField label="Nome do endpoint PJSIP do tronco" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} error={errs.trunkEndpoint} hint="Deve existir no pjsip.conf (padrão: tjto-trunk)." />
        </div>
      </fieldset>

      <fieldset className="rounded-md border border-bv-border p-3">
        <legend className="px-1 text-sm font-semibold">Números (DIDs / 0800) e cabeçalhos</legend>
        <div className="grid gap-3 md:grid-cols-2">
          <TextArea label="DIDs / números 0800 deste tronco" value={dids} onChange={(e) => setDids(e.target.value)} error={errs.dids} rows={4} className="font-mono text-sm" hint="Um por linha (ex.: 08006320000). Identificam o órgão da chamada." />
          <TextArea label="Cabeçalhos SIP copiados para a conversa" value={headers} onChange={(e) => setHeaders(e.target.value)} error={errs.preserveHeaders} rows={4} className="font-mono text-sm" hint="Um por linha, começando com X- (ex.: X-URA-Option)." />
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <TextField label="Usuário do cabeçalho From (opcional)" value={fromUser} onChange={(e) => setFromUser(e.target.value)} />
          <TextField label="Domínio do cabeçalho From (opcional)" value={fromDomain} onChange={(e) => setFromDomain(e.target.value)} />
        </div>
      </fieldset>

      <fieldset className="rounded-md border border-bv-border p-3">
        <legend className="px-1 text-sm font-semibold">Mídia e comportamento</legend>
        <fieldset className="mb-3"><legend className="text-sm font-medium">Codecs aceitos</legend>
          <div className="flex flex-wrap gap-4">{CODECS.map(([k, l]) => <Checkbox key={k} label={l} checked={codecs.includes(k)} onChange={(e) => setCodecs((cur) => e.target.checked ? [...cur, k] : cur.filter((x) => x !== k))} />)}</div>
        </fieldset>
        <div className="grid gap-3 md:grid-cols-2">
          <Select label="Modo DTMF" value={dtmf} onChange={(e) => setDtmf(e.target.value as typeof dtmf)}><option value="rfc4733">RFC 4733</option><option value="inband">In-band</option><option value="info">SIP INFO</option></Select>
          <Select label="Identificação nas transferências" value={callerId} onChange={(e) => setCallerId(e.target.value as typeof callerId)}><option value="original">Número original do cidadão</option><option value="trunk">Número do tronco</option></Select>
          <TextField label="Tempo de toque nas transferências (s)" type="number" min={5} max={120} value={ring} onChange={(e) => setRing(e.target.value)} error={errs.transferRingSec} />
          <Select label="Falar o número de protocolo" value={speak} onChange={(e) => setSpeak(e.target.value as typeof speak)}><option value="start">No início da chamada</option><option value="off">Não falar</option></Select>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          <Checkbox label="Encerrar a conversa quando a chamada terminar" checked={autoClose} onChange={(e) => setAutoClose(e.target.checked)} />
          <Checkbox label="Gravar também a fase da URA" checked={recIvr} onChange={(e) => setRecIvr(e.target.checked)} />
        </div>
      </fieldset>

      <fieldset className="rounded-md border border-bv-border p-3">
        <legend className="px-1 text-sm font-semibold">Conexão com o ARI do Asterisk (opcional)</legend>
        <p className="mb-2 text-xs text-bv-muted">Use apenas se o ARI não estiver definido nas variáveis de ambiente do servidor.</p>
        <div className="grid gap-3 md:grid-cols-3">
          <TextField label="URL do ARI" type="url" value={ariUrl} onChange={(e) => setAriUrl(e.target.value)} error={errs.ariUrl} placeholder="http://asterisk:8088/ari" />
          <TextField label="Usuário do ARI" value={ariUser} onChange={(e) => setAriUser(e.target.value)} error={errs.ariUser} autoComplete="off" />
          <SecretField label="Senha do ARI" value={ariPass} onChange={setAriPass} isSet={ariPwSet} />
        </div>
      </fieldset>

      <Checkbox label="Telefonia SIP ativada" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
      {formErr && <Banner tone="danger" title="Não foi possível salvar">{formErr}</Banner>}
      <div><Button type="submit" loading={busy}>Salvar configuração</Button></div>
    </form>
  );
}

function AriState() {
  const [s, setS] = useState<AriStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setS(await bv.get<AriStatus>('/voice/status')); } catch (e) { setError(errMsg(e, 'Estado da telefonia indisponível.')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-bv-muted">Situação da conexão do servidor com o Asterisk (ARI) e das chamadas em curso.</p>
        <Button variant="secondary" size="sm" loading={loading} onClick={() => void load()}>Atualizar</Button>
      </div>
      {error && <Banner tone="warning" title="Indisponível">{error}</Banner>}
      {loading && !s ? <div className="p-6 text-center"><Spinner /></div> : s && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Telefonia no servidor" value={s.enabled ? 'Habilitada' : 'Desabilitada'} tone={s.enabled ? 'success' : 'warning'} />
            <StatCard label="Conexão com o ARI" value={s.connected ? 'Conectado' : 'Desconectado'} tone={s.connected ? 'success' : 'danger'} hint={s.started ? undefined : 'Controlador não iniciado'} />
            <StatCard label="Chamadas ativas" value={s.activeCalls ?? 0} />
            <StatCard label="Reconexões" value={s.reconnects ?? 0} />
          </div>
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {s.app && <div className="flex gap-1"><dt className="text-bv-muted">Aplicação ARI:</dt><dd>{s.app}</dd></div>}
            {s.url && <div className="flex gap-1"><dt className="text-bv-muted">URL:</dt><dd>{s.url}</dd></div>}
            <div className="flex gap-1"><dt className="text-bv-muted">Último evento:</dt><dd>{fmtDateTime(s.lastEventAt)}</dd></div>
          </dl>
          {s.lastError && <Banner tone="danger" title="Último erro do ARI">{s.lastError}</Banner>}
          {s.byState && Object.keys(s.byState).length > 0 && <p className="text-sm">Chamadas por estado: {Object.entries(s.byState).map(([k, n]) => <Badge key={k}>{k}: {n}</Badge>)}</p>}
        </>
      )}
    </div>
  );
}
