'use client';
/**
 * URA 0800 (integração URA_0800) — contratos: docs/balcao/api-voice.md ("URA 0800") e apps/api/src/balcao/channels/voice/{routes,ura0800}.ts.
 *  GET|PUT /voice/ura0800  { enabled?, config: { dids:[{did,flowName}], headerMap:{lógico:'X-…'}, allowedSourceIps? } }  (substituição completa; sem segredos)
 *  POST /voice/ura0800/test { did?, headers?, sourceIp? } — testa a configuração SALVA; não cria chamada.
 *  GET /voice/ivr/flows → fluxos da URA (nomes) para o select de DID → fluxo.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { bv, BvApiError, errMsg } from '@/lib/balcao/api';
import { fmtDateTime } from '@/lib/balcao/format';
import { Badge, Banner, Button, Card, Checkbox, DataTable, Select, Spinner, Tabs, TextArea, TextField } from '../../../_ui/ui';
import { fieldErrors, LogsPanel, StatusBadge, type IntegrationSummary } from './_shared';

interface UraView {
  configured: boolean; enabled: boolean; status: string;
  config: { dids?: Array<{ did: string; flowName: string }>; headerMap?: Record<string, string>; allowedSourceIps?: string[] };
  defaults: { headerMap: Record<string, string> };
}
interface FlowRow { id: string; name: string; version: number; status: string }
interface TestResult {
  ok: boolean; enabled: boolean;
  dids: Array<{ did: string; flowName: string; flowFound: boolean; flowId: string | null; flowVersion: number | null }>;
  headers: { map: Record<string, string>; captured: Record<string, string>; missing: string[] };
  sourceIp: { configured: boolean; tested: string | null; allowed: boolean | null };
  entry: { option: string | null; node: string | null };
  warnings: string[];
}

const DID_RE = /^\+?[0-9*#]{2,20}$/;
const LOGICAL_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const HEADER_RE = /^[Xx]-[A-Za-z0-9-]{1,60}$/;
const isV4 = (s: string) => /^(\d{1,3})(\.\d{1,3}){3}$/.test(s) && s.split('.').every((o) => Number(o) <= 255);
const isV6 = (s: string) => s.includes(':') && /^[0-9a-fA-F:.]+$/.test(s) && s.split(':').length >= 3 && s.split(':').length <= 8 + 1;
/** Validação leve no cliente; a API valida de forma estrita e devolve o campo com erro. */
function validIpOrCidr(v: string): boolean {
  const [ip, bits, extra] = v.split('/');
  if (extra !== undefined || !ip) return false;
  const v4 = isV4(ip); const v6 = !v4 && isV6(ip);
  if (!v4 && !v6) return false;
  if (bits === undefined) return true;
  return /^\d{1,3}$/.test(bits) && Number(bits) <= (v4 ? 32 : 128);
}

let seq = 0;
const nid = () => `r${++seq}`;
interface DidRow { k: string; did: string; flowName: string }
interface HdrRow { k: string; logical: string; header: string }

export function UraPanel({ summary, onChanged }: { summary?: IntegrationSummary; onChanged: () => void }) {
  return (
    <Tabs label="URA 0800" tabs={[
      { id: 'ura-config', title: 'Configuração', content: <UraConfig summary={summary} onChanged={onChanged} /> },
      { id: 'ura-logs', title: 'Registros de chamadas', content: <LogsPanel type="URA_0800" /> },
    ]} />
  );
}

function UraConfig({ summary, onChanged }: { summary?: IntegrationSummary; onChanged: () => void }) {
  const [view, setView] = useState<UraView | null>(null);
  const [flows, setFlows] = useState<FlowRow[] | null>(null);
  const [flowsErr, setFlowsErr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rev, setRev] = useState(0);

  const load = useCallback(async () => {
    setError(null);
    try { setView(await bv.get<UraView>('/voice/ura0800')); } catch (e) { setError(errMsg(e, 'Não foi possível carregar a configuração da URA 0800.')); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    bv.get<{ items: FlowRow[] }>('/voice/ivr/flows')
      .then((r) => setFlows(r.items)).catch((e) => { setFlows(null); setFlowsErr(errMsg(e, 'Não foi possível listar os fluxos da URA.')); });
  }, []);

  if (error) return <Banner tone="danger" title="Indisponível">{error}</Banner>;
  if (!view) return <div className="p-6 text-center"><Spinner /></div>;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge s={view} />
        {summary?.lastCheckAt && <span className="text-sm text-bv-muted">Última verificação: {fmtDateTime(summary.lastCheckAt)}</span>}
      </div>
      {summary?.lastError && <Banner tone="danger" title="Último erro">{summary.lastError}</Banner>}
      <Card title="Como funciona">
        <ul className="list-disc pl-5 text-sm">
          <li>Cada <strong>número 0800/DID</strong> que chega ao Balcão é ligado ao <strong>fluxo da URA</strong> escolhido abaixo (os fluxos são editados em <Link className="underline" href="/balcao/admin/ura">URA (atendimento por voz)</Link>; o tronco SIP, em <Link className="underline" href="/balcao/admin/integracoes#sip">Telefonia SIP</Link>).</li>
          <li>Os <strong>cabeçalhos SIP X-*</strong> enviados pela URA do tribunal são lidos de cada chamada e guardados no atendimento. O cabeçalho do nome lógico <code>opcao</code> define a opção de entrada; use o mesmo cabeçalho no mapeamento de entrada do fluxo.</li>
          <li>Se informar <strong>IPs de origem</strong>, chamadas desses DIDs vindas de outro IP são recusadas. Esta integração não tem senha nem token.</li>
        </ul>
      </Card>
      <UraForm key={rev} v={view} flows={flows} flowsErr={flowsErr} onSaved={async () => { setRev((r) => r + 1); await load(); onChanged(); }} />
      <UraTest v={view} onDone={() => { void load(); onChanged(); }} />
    </div>
  );
}

function UraForm({ v, flows, flowsErr, onSaved }: { v: UraView; flows: FlowRow[] | null; flowsErr: string | null; onSaved: () => void | Promise<void> }) {
  const cfg = v.config ?? {};
  const [enabled, setEnabled] = useState(v.configured ? v.enabled : true);
  const [dids, setDids] = useState<DidRow[]>(() => (cfg.dids ?? []).map((d) => ({ k: nid(), did: d.did, flowName: d.flowName })));
  const [hdrs, setHdrs] = useState<HdrRow[]>(() => Object.entries(cfg.headerMap ?? {}).map(([logical, header]) => ({ k: nid(), logical, header })));
  const [ips, setIps] = useState((cfg.allowedSourceIps ?? []).join('\n'));
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [live, setLive] = useState('');
  const focusRef = useRef<string | null>(null);
  const addDidRef = useRef<HTMLButtonElement>(null);
  const addHdrRef = useRef<HTMLButtonElement>(null);
  const sumRef = useRef<HTMLDivElement>(null);

  useEffect(() => { // foco na linha recém-adicionada
    if (focusRef.current) { document.getElementById(focusRef.current)?.focus(); focusRef.current = null; }
  });
  useEffect(() => { if (summary.length) sumRef.current?.focus(); }, [summary]);

  const flowNames = flows ? [...new Set(flows.map((f) => f.name))].sort((a, b) => a.localeCompare(b, 'pt-BR')) : null;
  const activeNames = new Set((flows ?? []).filter((f) => f.status === 'ACTIVE').map((f) => f.name));

  const touch = () => { setSaved(false); };
  const addDid = () => { const k = nid(); setDids((l) => [...l, { k, did: '', flowName: flowNames?.[0] ?? '' }]); focusRef.current = `ura-did-${k}`; setLive(`DID ${dids.length + 1} adicionado.`); touch(); };
  const rmDid = (k: string, i: number) => { setDids((l) => l.filter((x) => x.k !== k)); setLive(`DID ${i + 1} removido.`); addDidRef.current?.focus(); touch(); };
  const addHdr = () => { const k = nid(); setHdrs((l) => [...l, { k, logical: '', header: '' }]); focusRef.current = `ura-hl-${k}`; setLive(`Cabeçalho ${hdrs.length + 1} adicionado.`); touch(); };
  const rmHdr = (k: string, i: number) => { setHdrs((l) => l.filter((x) => x.k !== k)); setLive(`Cabeçalho ${i + 1} removido.`); addHdrRef.current?.focus(); touch(); };
  const useDefaults = () => {
    setHdrs(Object.entries(v.defaults?.headerMap ?? {}).map(([logical, header]) => ({ k: nid(), logical, header })));
    setLive('Nomes padrão de cabeçalho preenchidos.'); touch();
  };

  const ipList = () => [...new Set(ips.split(/[\n,;]/).map((x) => x.trim()).filter(Boolean))];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaved(false);
    const er: Record<string, string> = {}; const sum: string[] = [];
    const seen = new Set<string>();
    dids.forEach((d, i) => {
      const n = d.did.replace(/[\s().-]/g, '');
      if (!DID_RE.test(n)) { er[`dids.${i}.did`] = 'Número inválido: use 2 a 20 dígitos (podendo começar com +, e conter * ou #).'; }
      else if (seen.has(n)) er[`dids.${i}.did`] = 'Número repetido.'; else seen.add(n);
      if (!d.flowName.trim()) er[`dids.${i}.flowName`] = 'Escolha o fluxo da URA.';
    });
    const seenL = new Set<string>();
    hdrs.forEach((h, i) => {
      if (!LOGICAL_RE.test(h.logical.trim())) er[`headerMap.${i}.logical`] = 'Nome lógico inválido: comece com letra; use letras, números e _ (até 40).';
      else if (seenL.has(h.logical.trim())) er[`headerMap.${i}.logical`] = 'Nome lógico repetido.'; else seenL.add(h.logical.trim());
      if (!HEADER_RE.test(h.header.trim())) er[`headerMap.${i}.header`] = 'O cabeçalho deve começar com X- (ex.: X-TJTO-URA-Opcao).';
    });
    if (hdrs.length > 20) er.headerMap = 'No máximo 20 cabeçalhos.';
    if (dids.length > 100) er.dids = 'No máximo 100 DIDs.';
    const il = ipList();
    il.forEach((ip, i) => { if (!validIpOrCidr(ip)) er[`allowedSourceIps.${i}`] = `IP ou CIDR inválido: “${ip}”.`; });
    if (il.length > 50) er.allowedSourceIps = 'No máximo 50 IPs.';
    if (Object.keys(er).length) {
      setErrs(er);
      setSummary(['Corrija os campos indicados.', ...Object.values(er).filter((m, i, a) => a.indexOf(m) === i).slice(0, 8)]);
      return;
    }
    setErrs({}); setSummary([]);
    const headerMap: Record<string, string> = {};
    hdrs.forEach((h) => { headerMap[h.logical.trim()] = h.header.trim(); });
    const config: Record<string, unknown> = {
      dids: dids.map((d) => ({ did: d.did.replace(/[\s().-]/g, ''), flowName: d.flowName.trim() })), headerMap,
      ...(il.length ? { allowedSourceIps: il } : {}),
    };
    setBusy(true);
    try {
      await bv.put('/voice/ura0800', { enabled, config });
      setSaved(true); await onSaved();
    } catch (err) {
      const fe = fieldErrors(err);
      // caminhos da API vêm como "config.dids.0.did" / "config.headerMap.opcao" / "config.allowedSourceIps.1"
      const mapped: Record<string, string> = {};
      for (const [k, m] of Object.entries(fe.map)) {
        const p = k.replace(/^config\./, '');
        const hm = /^headerMap\.(.+)$/.exec(p);
        if (hm) { const idx = hdrs.findIndex((h) => h.logical.trim() === hm[1]); mapped[idx >= 0 ? `headerMap.${idx}.header` : 'headerMap'] = m; } else mapped[p] = m;
      }
      setErrs(mapped);
      setSummary([errMsg(err, 'Não foi possível salvar a configuração.'), ...Object.entries(fe.map).map(([k, m]) => `${k}: ${m}`), ...fe.list]);
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-label="Configuração da URA 0800">
      <p className="bv-sr-only" role="status" aria-live="polite">{live}</p>
      {summary.length > 0 && (
        <div ref={sumRef} tabIndex={-1} role="alert" className="rounded-md border border-bv-danger bg-bv-danger-soft px-3 py-2 text-sm text-bv-danger outline-none">
          <strong className="block">Não foi possível salvar</strong>
          <ul className="list-disc pl-5">{summary.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      )}
      {flowsErr && <Banner tone="warning" title="Lista de fluxos indisponível">{flowsErr} Digite o nome do fluxo manualmente.</Banner>}

      <fieldset className="rounded-md border border-bv-border p-3">
        <legend className="px-1 text-sm font-semibold">Números (DIDs) e fluxos da URA</legend>
        <p className="mb-3 text-sm text-bv-muted">Informe o número exatamente como o tronco o entrega no INVITE (confirme com o tribunal se vem com +55 e DDD). Cada número usa o fluxo ativo com o nome escolhido.</p>
        {errs.dids && <p role="alert" className="mb-2 text-sm text-bv-danger">{errs.dids}</p>}
        {dids.length === 0 && <p className="mb-2 text-sm text-bv-muted">Nenhum DID cadastrado.</p>}
        <ul className="flex flex-col gap-3">
          {dids.map((d, i) => {
            const names = flowNames && d.flowName && !flowNames.includes(d.flowName) ? [d.flowName, ...flowNames] : flowNames;
            return (
              <li key={d.k} className="grid items-start gap-3 rounded-md border border-bv-border p-3 md:grid-cols-[1fr_1fr_auto]">
                <TextField id={`ura-did-${d.k}`} label={`Número (DID) ${i + 1}`} required inputMode="tel" value={d.did} placeholder="08006320000" autoComplete="off"
                  onChange={(e) => { setDids((l) => l.map((x) => (x.k === d.k ? { ...x, did: e.target.value } : x))); touch(); }} error={errs[`dids.${i}.did`]} />
                {names ? (
                  <Select label={`Fluxo da URA ${i + 1}`} required value={d.flowName} error={errs[`dids.${i}.flowName`]}
                    hint={d.flowName && !activeNames.has(d.flowName) ? 'Atenção: não há versão ativa (publicada) com este nome.' : undefined}
                    onChange={(e) => { setDids((l) => l.map((x) => (x.k === d.k ? { ...x, flowName: e.target.value } : x))); touch(); }}>
                    {!d.flowName && <option value="">Selecione…</option>}
                    {names.map((n) => <option key={n} value={n}>{n}{activeNames.has(n) ? '' : ' (sem versão ativa)'}</option>)}
                  </Select>
                ) : (
                  <TextField label={`Fluxo da URA ${i + 1}`} required value={d.flowName} error={errs[`dids.${i}.flowName`]}
                    onChange={(e) => { setDids((l) => l.map((x) => (x.k === d.k ? { ...x, flowName: e.target.value } : x))); touch(); }} />
                )}
                <div className="md:pt-6"><Button variant="secondary" size="sm" onClick={() => rmDid(d.k, i)} aria-label={`Remover DID ${i + 1}${d.did ? ` (${d.did})` : ''}`}>Remover</Button></div>
              </li>
            );
          })}
        </ul>
        {flowNames && flowNames.length === 0 && <p className="mt-2 text-sm text-bv-warning">Ainda não há fluxos de URA. Crie e publique um em <Link className="underline" href="/balcao/admin/ura">URA (atendimento por voz)</Link>.</p>}
        <div className="mt-3"><Button ref={addDidRef} variant="secondary" onClick={addDid}>Adicionar DID</Button></div>
      </fieldset>

      <fieldset className="rounded-md border border-bv-border p-3">
        <legend className="px-1 text-sm font-semibold">Mapeamento de cabeçalhos SIP (X-*)</legend>
        <p className="mb-3 text-sm text-bv-muted">Associe um <em>nome lógico</em> (como <code>opcao</code>, <code>ura</code>, <code>protocolo</code>) ao cabeçalho que a URA do tribunal envia. O valor de <code>opcao</code> escolhe o ponto de entrada da URA. Sem mapeamento, valem os nomes padrão: {Object.entries(v.defaults?.headerMap ?? {}).map(([k, h]) => `${k} = ${h}`).join('; ') || '—'}.</p>
        {errs.headerMap && <p role="alert" className="mb-2 text-sm text-bv-danger">{errs.headerMap}</p>}
        {hdrs.length === 0 && <p className="mb-2 text-sm text-bv-muted">Nenhum cabeçalho mapeado.</p>}
        <ul className="flex flex-col gap-3">
          {hdrs.map((h, i) => (
            <li key={h.k} className="grid items-start gap-3 rounded-md border border-bv-border p-3 md:grid-cols-[1fr_1fr_auto]">
              <TextField id={`ura-hl-${h.k}`} label={`Nome lógico ${i + 1}`} required value={h.logical} placeholder="opcao" autoComplete="off" spellCheck={false}
                onChange={(e) => { setHdrs((l) => l.map((x) => (x.k === h.k ? { ...x, logical: e.target.value } : x))); touch(); }} error={errs[`headerMap.${i}.logical`]} />
              <TextField label={`Cabeçalho SIP ${i + 1}`} required value={h.header} placeholder="X-TJTO-URA-Opcao" autoComplete="off" spellCheck={false}
                onChange={(e) => { setHdrs((l) => l.map((x) => (x.k === h.k ? { ...x, header: e.target.value } : x))); touch(); }} error={errs[`headerMap.${i}.header`]} />
              <div className="md:pt-6"><Button variant="secondary" size="sm" onClick={() => rmHdr(h.k, i)} aria-label={`Remover cabeçalho ${i + 1}${h.logical ? ` (${h.logical})` : ''}`}>Remover</Button></div>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button ref={addHdrRef} variant="secondary" onClick={addHdr}>Adicionar cabeçalho</Button>
          <Button variant="ghost" onClick={useDefaults}>Preencher com os nomes padrão</Button>
        </div>
      </fieldset>

      <fieldset className="rounded-md border border-bv-border p-3">
        <legend className="px-1 text-sm font-semibold">IPs de origem permitidos (opcional)</legend>
        <TextArea label="IPs ou faixas CIDR" rows={4} value={ips} onChange={(e) => { setIps(e.target.value); touch(); }} spellCheck={false} placeholder={'203.0.113.0/24\n198.51.100.5'}
          error={errs.allowedSourceIps ?? Object.entries(errs).find(([k]) => k.startsWith('allowedSourceIps.'))?.[1]}
          hint="Um por linha (IPv4 ou IPv6, com /máscara opcional). Vale só para os DIDs acima: chamadas de outro IP, ou sem IP conhecido, são recusadas. Em branco = não restringe. Exige que o dialplan do Asterisk informe o IP de origem." />
      </fieldset>

      <Checkbox label="Integração URA 0800 ativada" hint="Desativada, a configuração é guardada mas ignorada nas chamadas." checked={enabled} onChange={(e) => { setEnabled(e.target.checked); touch(); }} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={busy}>Salvar configuração</Button>
        <span role="status" className="text-sm text-bv-success">{saved ? '✔ Configuração salva. Use “Testar” para validar.' : ''}</span>
      </div>
    </form>
  );
}

/** "X-Nome: valor" por linha → objeto. Linhas inválidas são devolvidas para o aviso. */
function parseHeaders(text: string): { headers: Record<string, string>; bad: string[] } {
  const headers: Record<string, string> = {}; const bad: string[] = [];
  for (const line of text.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const i = line.indexOf(':');
    if (i < 1) { bad.push(line); continue; }
    headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { headers, bad };
}

function UraTest({ v, onDone }: { v: UraView; onDone: () => void }) {
  const [did, setDid] = useState('');
  const [hText, setHText] = useState('');
  const [ip, setIp] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<TestResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const savedDids = v.config?.dids ?? [];

  const run = async () => {
    setErr(null); setRes(null);
    const { headers, bad } = parseHeaders(hText);
    if (bad.length) { setErr(`Linha de cabeçalho inválida: “${bad[0]}”. Use o formato Nome: valor.`); return; }
    const body: Record<string, unknown> = {};
    if (did) body.did = did;
    if (Object.keys(headers).length) body.headers = headers;
    if (ip.trim()) body.sourceIp = ip.trim();
    setBusy(true);
    try { setRes(await bv.post<TestResult>('/voice/ura0800/test', body)); }
    catch (e) {
      setErr(e instanceof BvApiError && e.code === 'ura0800.not_configured' ? 'Salve a configuração antes de testar.' : errMsg(e, 'Falha ao testar a URA 0800.'));
    } finally { setBusy(false); onDone(); }
  };

  return (
    <Card title="Testar">
      <p className="mb-3 text-sm text-bv-muted">{v.configured ? 'Testa a configuração salva (salve antes, se alterou algo): fluxo de cada DID, leitura dos cabeçalhos de um INVITE de exemplo e IP de origem. Não cria chamada.' : 'Salve a configuração antes de testar.'}</p>
      <div className="grid gap-3 md:grid-cols-2">
        <Select label="DID a testar" value={did} onChange={(e) => setDid(e.target.value)} hint="Em branco, testa todos os DIDs salvos.">
          <option value="">Todos os DIDs</option>
          {savedDids.map((d) => <option key={d.did} value={d.did}>{d.did}</option>)}
        </Select>
        <TextField label="IP de origem de teste" value={ip} onChange={(e) => setIp(e.target.value)} placeholder="203.0.113.50 ou 203.0.113.50:5060" autoComplete="off" hint="Opcional. Confere contra os IPs permitidos." />
        <TextArea label="Cabeçalhos do INVITE de teste" rows={3} value={hText} onChange={(e) => setHText(e.target.value)} spellCheck={false} className="md:col-span-2" placeholder={'X-TJTO-URA-Opcao: 3\nX-TJTO-Protocolo: 2026-000123'}
          hint="Opcional. Um por linha, no formato Nome: valor. Mostra o que seria extraído de cada cabeçalho mapeado." />
      </div>
      <div className="mt-3"><Button variant="secondary" onClick={() => void run()} loading={busy} disabled={!v.configured}>Testar</Button></div>
      <div aria-live="polite" className="mt-3">
        {err && <Banner tone="danger" title="Teste não realizado">{err}</Banner>}
        {res && <TestOutput r={res} />}
      </div>
    </Card>
  );
}

function TestOutput({ r }: { r: TestResult }) {
  const hdrRows = Object.entries(r.headers.map).map(([logical, header]) => ({ logical, header, value: r.headers.captured[logical], missing: r.headers.missing.includes(logical) }));
  return (
    <div className="flex flex-col gap-3">
      <Banner tone={r.ok ? 'success' : 'danger'} title={r.ok ? '✔ Verificação concluída sem problemas.' : '✖ A verificação encontrou problemas.'}>
        {!r.enabled && ' A integração está desativada: estas regras não valem nas chamadas até ser ativada.'}
      </Banner>
      {r.warnings.length > 0 && (
        <Banner tone="warning" title="Avisos"><ul className="list-disc pl-5">{r.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></Banner>
      )}
      <DataTable caption="DIDs e fluxos da URA" rows={r.dids} rowKey={(d) => d.did} empty="Nenhum DID verificado."
        columns={[
          { key: 'd', header: 'Número (DID)', render: (d) => d.did },
          { key: 'f', header: 'Fluxo', render: (d) => d.flowName },
          { key: 's', header: 'Situação', render: (d) => d.flowFound ? <Badge tone="success">Fluxo ativo encontrado (versão {d.flowVersion})</Badge> : <Badge tone="danger">Sem fluxo ativo com este nome</Badge> },
        ]} />
      <DataTable caption="Cabeçalhos mapeados" rows={hdrRows} rowKey={(h) => h.logical} empty="Nenhum cabeçalho mapeado (valem os nomes padrão)."
        columns={[
          { key: 'l', header: 'Nome lógico', render: (h) => h.logical },
          { key: 'h', header: 'Cabeçalho SIP', render: (h) => <code>{h.header}</code> },
          { key: 'v', header: 'Valor extraído', render: (h) => h.value !== undefined ? <Badge tone="success">{h.value}</Badge> : h.missing ? <Badge tone="warning">Ausente no INVITE de teste</Badge> : <span className="text-bv-muted">Não testado</span> },
        ]} />
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-medium">IP de origem</dt>
          <dd>
            {!r.sourceIp.configured ? 'Sem restrição de IP configurada.' : 'Restrição de IP configurada.'}{' '}
            {r.sourceIp.tested
              ? <>Testado {r.sourceIp.tested}: <Badge tone={r.sourceIp.allowed ? 'success' : 'danger'}>{r.sourceIp.allowed ? 'permitido' : 'recusado'}</Badge></>
              : 'Nenhum IP informado para testar.'}
          </dd>
        </div>
        <div>
          <dt className="font-medium">Ponto de entrada da URA</dt>
          <dd>{r.entry.option == null ? 'Sem opção de entrada nos cabeçalhos de teste.' : <>Opção <strong>{r.entry.option}</strong> → {r.entry.node ? <>nó <code>{r.entry.node}</code></> : 'sem nó correspondente no mapeamento de entrada do fluxo (usa o início padrão)'}.</>}</dd>
        </div>
      </dl>
    </div>
  );
}
