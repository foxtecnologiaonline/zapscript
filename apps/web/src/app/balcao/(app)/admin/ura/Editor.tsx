'use client';
/**
 * Editor visual de um fluxo de URA. Árvore de nós navegável por teclado (ARIA tree achatada: ↑/↓ percorrem,
 * ← vai ao nó pai, → vai ao primeiro filho, Enter seleciona), formulário por tipo, validação em tempo real
 * (POST /voice/ivr/validate), simulador (POST /voice/ivr[/flows/:id]/simulate), salvar (PUT) e publicar (POST …/publish).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bv, BvApiError, errMsg } from '@/lib/balcao/api';
import { fmtDateTime } from '@/lib/balcao/format';
import { Badge, Banner, Button, Card, ConfirmDialog, Dialog, Select, Spinner, TextArea, TextField, cx, useToast } from '../../../_ui/ui';
import NodeForm from './NodeForm';
import { NODE_HELP, NODE_ID_RE, NODE_TYPES, STATUS_LABEL, STATUS_TONE, buildTree, defaultNode, edgesLabeled, typeLabel, DID_RE, type FlowFull, type Issue, type IvrDef, type IvrNode, type NodeType, type Validation } from './ivrTypes';
import { OUTCOME_LABEL, describeTrail, type TrailEntry } from './trail';

interface SimResult {
  outcome: { action: string; node: string; category?: string; queue?: string; destination?: { type: string; number: string }; reason?: string };
  trail: TrailEntry[]; lang: string; vars: Record<string, string>; sensitiveVars: string[];
  spoken: Array<{ text: string; audioKey?: string; lang: string; interruptible: boolean; cutThru?: boolean }>; unusedInputs: string[]; validation: Validation;
}

export default function Editor({ flowId, onClose, onChanged }: { flowId: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [flow, setFlow] = useState<FlowFull | null>(null);
  const [def, setDef] = useState<IvrDef | null>(null);
  const [language, setLanguage] = useState('pt-BR');
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [val, setVal] = useState<Validation | null>(null);
  const [valBusy, setValBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pubOpen, setPubOpen] = useState(false);
  const [pubErr, setPubErr] = useState<Issue[] | string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [delId, setDelId] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [announce, setAnnounce] = useState('');
  const readOnly = flow?.status !== 'DRAFT';

  useEffect(() => {
    let off = false;
    bv.get<FlowFull>(`/voice/ivr/flows/${flowId}`).then((f) => {
      if (off) return;
      setFlow(f); setDef(f.definition); setLanguage(f.language); setSel(f.definition.start); setDirty(false);
    }).catch((e) => !off && setLoadErr(errMsg(e)));
    return () => { off = true; };
  }, [flowId]);

  // aviso ao sair da página com alterações não salvas
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  // validação em tempo real (debounce)
  useEffect(() => {
    if (!def) return;
    setValBusy(true);
    const t = setTimeout(async () => {
      try { const v = await bv.post<Validation>('/voice/ivr/validate', { definition: def }); setVal(v); setAnnounce(v.ok ? `Validação: sem erros${v.warnings.length ? `, ${v.warnings.length} avisos` : ''}.` : `Validação: ${v.errors.length} erro(s).`); }
      catch (e) { setVal({ ok: false, errors: [{ code: 'client', message: errMsg(e) }], warnings: [] }); }
      finally { setValBusy(false); }
    }, 600);
    return () => clearTimeout(t);
  }, [def]);

  const update = useCallback((fn: (d: IvrDef) => IvrDef) => { setDef((d) => (d ? fn(d) : d)); setDirty(true); }, []);
  const setNode = (id: string, n: IvrNode) => update((d) => ({ ...d, nodes: { ...d.nodes, [id]: n } }));

  const tree = useMemo(() => (def ? buildTree(def) : { rows: [], orphans: [] }), [def]);
  const issueByNode = useMemo(() => {
    const m = new Map<string, { e: number; w: number }>();
    val?.errors.forEach((i) => { if (i.node) { const x = m.get(i.node) ?? { e: 0, w: 0 }; x.e++; m.set(i.node, x); } });
    val?.warnings.forEach((i) => { if (i.node) { const x = m.get(i.node) ?? { e: 0, w: 0 }; x.w++; m.set(i.node, x); } });
    return m;
  }, [val]);

  const save = async (): Promise<boolean> => {
    if (!def) return false;
    setSaving(true);
    try {
      const r = await bv.put<FlowFull>(`/voice/ivr/flows/${flowId}`, { language, definition: def });
      setFlow((f) => (f ? { ...f, ...r, definition: r.definition } : r)); if (r.validation) setVal(r.validation);
      setDirty(false); onChanged(); toast.success('Rascunho salvo.'); return true;
    } catch (e) { toast.error(errMsg(e, 'Não foi possível salvar o rascunho.')); return false; }
    finally { setSaving(false); }
  };

  const publish = async () => {
    setPubErr(null);
    if (dirty && !(await save())) throw new Error('save');
    try {
      const r = await bv.post<{ warnings: Issue[] }>(`/voice/ivr/flows/${flowId}/publish`);
      toast.success(`Versão ${flow?.version} publicada. Novas ligações já usam este fluxo.${r.warnings?.length ? ` (${r.warnings.length} avisos)` : ''}`);
      onChanged(); onClose();
    } catch (e) {
      const errs = e instanceof BvApiError ? ((e.details as any)?.errors as Issue[] | undefined) : undefined;
      setPubErr(errs?.length ? errs : errMsg(e)); throw e;
    }
  };

  const addNode = (id: string, type: NodeType) => {
    update((d) => ({ ...d, nodes: { ...d.nodes, [id]: defaultNode(type, d.start) } }));
    setSel(id); setAnnounce(`Nó ${id} adicionado. Ele ainda não é alcançável: ligue-o a partir de outro nó.`);
  };
  const removeNode = (id: string) => {
    update((d) => { const nodes = { ...d.nodes }; delete nodes[id]; return { ...d, nodes }; });
    setSel((s) => (s === id ? def?.start ?? null : s)); setAnnounce(`Nó ${id} removido.`);
  };
  const referencedBy = (id: string) => (def ? Object.entries(def.nodes).filter(([k, n]) => k !== id && edgesLabeled(n).some((e) => e.to === id)).map(([k]) => k) : []);

  if (loadErr) return <Banner tone="danger" title="Não foi possível abrir o fluxo">{loadErr} <Button size="sm" variant="secondary" onClick={onClose}>Voltar</Button></Banner>;
  if (!flow || !def) return <div className="flex justify-center p-10"><Spinner size={28} /></div>;
  const node = sel ? def.nodes[sel] : undefined;
  const nodeIds = Object.keys(def.nodes).sort();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold" tabIndex={-1}>{flow.name} <span className="text-bv-muted">· versão {flow.version}</span> <Badge tone={STATUS_TONE[flow.status]}>{STATUS_LABEL[flow.status]}</Badge></h2>
          <p className="text-sm text-bv-muted">{dirty ? 'Alterações não salvas.' : readOnly ? 'Somente leitura: esta versão não pode ser editada. Na lista, use "Nova versão a partir desta".' : 'Rascunho salvo.'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => (dirty ? setLeaveOpen(true) : onClose())}>Voltar à lista</Button>
          {!readOnly && <Button variant="secondary" onClick={() => void save()} loading={saving} disabled={!dirty}>Salvar rascunho</Button>}
          {flow.status !== 'ACTIVE' && <Button onClick={() => setPubOpen(true)} disabled={!val?.ok && !!val}>Publicar esta versão</Button>}
        </div>
      </div>
      <div role="status" className="bv-sr-only">{announce}</div>
      {flow.status === 'ACTIVE' && <Banner tone="primary">Esta é a versão ativa e atende ligações agora. Para alterar, volte à lista e crie uma nova versão.</Banner>}

      <div className="grid gap-4 lg:grid-cols-[minmax(16rem,22rem)_1fr]">
        <div className="flex flex-col gap-4">
          <Card title="Árvore de nós" actions={!readOnly && <Button size="sm" variant="secondary" onClick={() => setAddOpen(true)}>Adicionar nó</Button>}>
            <TreeView def={def} rows={tree.rows} sel={sel} onSel={setSel} issues={issueByNode} />
            {tree.orphans.length > 0 && (
              <div className="mt-3">
                <h3 className="text-sm font-semibold">Nós não alcançáveis ({tree.orphans.length})</h3>
                <ul className="mt-1 flex flex-col gap-1">
                  {tree.orphans.map((id) => <li key={id}><button type="button" className={cx('w-full rounded-md border border-bv-border px-2 py-1.5 text-left text-sm hover:bg-bv-subtle', sel === id && 'border-bv-primary bg-bv-primary-soft')} aria-current={sel === id ? 'true' : undefined} onClick={() => setSel(id)}>{id} — {typeLabel(def.nodes[id].type)} (sem ligação)</button></li>)}
                </ul>
              </div>
            )}
          </Card>
          <Card title="Configurações do fluxo"><FlowSettings def={def} language={language} disabled={readOnly} nodeIds={nodeIds} onLang={(l) => { setLanguage(l); setDirty(true); }} onDef={(p) => update((d) => ({ ...d, ...p }))} /></Card>
          <ValidationPanel val={val} busy={valBusy} onGo={(n) => def.nodes[n] && setSel(n)} />
        </div>

        <div className="flex flex-col gap-4">
          <Card title={sel ? `Nó "${sel}"` : 'Nó'} actions={sel && !readOnly && (
            <div className="flex gap-2">
              {def.start !== sel && <Button size="sm" variant="secondary" onClick={() => update((d) => ({ ...d, start: sel }))}>Definir como nó inicial</Button>}
              <Button size="sm" variant="danger" onClick={() => setDelId(sel)} disabled={Object.keys(def.nodes).length <= 1}>Remover nó</Button>
            </div>
          )}>
            {!node ? <p className="text-sm text-bv-muted">Selecione um nó na árvore para editar.</p> : (
              <>
                <p className="mb-3 text-sm text-bv-muted">{NODE_HELP[node.type]}{def.start === sel ? ' Este é o nó inicial.' : ''}</p>
                <NodeForm key={sel!} id={sel!} node={node} nodeIds={nodeIds} nodes={def.nodes} disabled={readOnly} onChange={(n) => setNode(sel!, n)} />
              </>
            )}
          </Card>
          <Simulator flowId={flowId} dirty={dirty} def={def} lang={language} />
        </div>
      </div>

      <AddNodeDialog open={addOpen} existing={nodeIds} onClose={() => setAddOpen(false)} onAdd={addNode} />
      <ConfirmDialog open={!!delId} title="Remover nó" danger confirmLabel="Remover" onClose={() => setDelId(null)}
        message={delId ? (referencedBy(delId).length ? `O nó "${delId}" é usado por: ${referencedBy(delId).join(', ')}. Depois de remover, esses nós ficarão com erro até você apontá-los para outro destino. Remover mesmo assim?` : `Remover o nó "${delId}"?`) : ''}
        onConfirm={() => { if (delId) removeNode(delId); }} />
      <ConfirmDialog open={leaveOpen} title="Descartar alterações?" danger confirmLabel="Descartar e voltar" message="Há alterações não salvas neste rascunho. Se voltar agora, elas serão perdidas." onClose={() => setLeaveOpen(false)} onConfirm={onClose} />
      <PublishDialog open={pubOpen} flow={flow} dirty={dirty} err={pubErr} onClose={() => { setPubOpen(false); setPubErr(null); }} onConfirm={publish} />
    </div>
  );
}

// ── Árvore ──────────────────────────────────────────────────────────────────────────────────────────
function TreeView({ def, rows, sel, onSel, issues }: { def: IvrDef; rows: ReturnType<typeof buildTree>['rows']; sel: string | null; onSel: (id: string) => void; issues: Map<string, { e: number; w: number }> }) {
  const [focusIdx, setFocusIdx] = useState(0);
  const refs = useRef<Array<HTMLLIElement | null>>([]);
  const move = (i: number) => { const n = Math.max(0, Math.min(rows.length - 1, i)); setFocusIdx(n); refs.current[n]?.focus(); };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); move(i + 1); break;
      case 'ArrowUp': e.preventDefault(); move(i - 1); break;
      case 'Home': e.preventDefault(); move(0); break;
      case 'End': e.preventDefault(); move(rows.length - 1); break;
      case 'ArrowLeft': e.preventDefault(); if (rows[i].parent >= 0) move(rows[i].parent); break;
      case 'ArrowRight': e.preventDefault(); if (rows[i + 1] && rows[i + 1].depth > rows[i].depth) move(i + 1); break;
      case 'Enter': case ' ': e.preventDefault(); onSel(rows[i].id); break;
      default: break;
    }
  };
  if (!rows.length) return <p className="text-sm text-bv-muted">Fluxo vazio.</p>;
  return (
    <>
      <p id="tree-help" className="mb-2 text-xs text-bv-muted">Use as setas para percorrer, Enter para abrir o nó, seta à esquerda para ir ao nó anterior e à direita para o primeiro destino.</p>
      <ul role="tree" aria-label="Nós do fluxo da URA" aria-describedby="tree-help" className="flex flex-col gap-1">
        {rows.map((r, i) => {
          const n = def.nodes[r.id]; const iss = issues.get(r.id);
          return (
            <li key={`${i}-${r.id}`} role="treeitem" aria-level={r.depth + 1} aria-posinset={r.pos} aria-setsize={r.setSize} aria-selected={sel === r.id}
              ref={(el) => { refs.current[i] = el; }} tabIndex={i === focusIdx ? 0 : -1} onFocus={() => setFocusIdx(i)} onKeyDown={(e) => onKey(e, i)} onClick={() => onSel(r.id)}
              style={{ marginLeft: `${Math.min(r.depth, 8) * 14}px` }}
              className={cx('cursor-pointer list-none rounded-md border px-2 py-1.5 text-sm hover:bg-bv-subtle', sel === r.id ? 'border-bv-primary bg-bv-primary-soft font-semibold' : 'border-bv-border')}>
              <span className="text-xs text-bv-muted">{r.via}{r.depth > 0 ? ' → ' : ': '}</span>
              <span>{r.id}</span>{' '}
              <span className="text-bv-muted">({n ? typeLabel(n.type) : 'nó inexistente'})</span>
              {r.repeated && <span className="text-xs text-bv-muted"> — já exibido acima</span>}
              {(r.missing || (iss && iss.e > 0)) && <span className="ml-1 font-semibold text-bv-danger"> [erro]</span>}
              {iss && iss.e === 0 && iss.w > 0 && <span className="ml-1 text-bv-warning"> [aviso]</span>}
            </li>
          );
        })}
      </ul>
    </>
  );
}

// ── Configurações do fluxo ───────────────────────────────────────────────────────────────────────────
function FlowSettings({ def, language, disabled, nodeIds, onLang, onDef }: { def: IvrDef; language: string; disabled: boolean; nodeIds: string[]; onLang: (l: string) => void; onDef: (p: Partial<IvrDef>) => void }) {
  const [did, setDid] = useState('');
  const [didErr, setDidErr] = useState<string | null>(null);
  const dids = def.dids ?? [];
  const ebh = def.entryByHeader;
  return (
    <fieldset className="flex flex-col gap-3" disabled={disabled}>
      <legend className="bv-sr-only">Configurações do fluxo</legend>
      <Select label="Nó inicial" value={def.start} onChange={(e) => onDef({ start: e.target.value })}>
        {nodeIds.map((n) => <option key={n} value={n}>{n}</option>)}
        {!nodeIds.includes(def.start) && <option value={def.start}>{def.start} (inexistente)</option>}
      </Select>
      <TextField label="Idioma do fluxo" value={language} maxLength={10} onChange={(e) => onLang(e.target.value)} hint="Ex.: pt-BR." />
      <TextField label="Idioma padrão dos avisos" value={def.defaultLang ?? ''} maxLength={10} onChange={(e) => onDef({ defaultLang: e.target.value || undefined })} hint="Em branco: idioma do órgão." />
      <div>
        <p className="text-sm font-medium">Números (DIDs / 0800) atendidos por este fluxo</p>
        <p className="mb-1 text-xs text-bv-muted">Sem nenhum número, o fluxo vira o padrão para números sem fluxo próprio. Um número só pode ser atendido por um fluxo ativo.</p>
        {dids.length > 0 && <ul className="mb-2 flex flex-wrap gap-2">{dids.map((d) => <li key={d} className="flex items-center gap-1 rounded-full border border-bv-border px-2 py-0.5 text-sm">{d}<button type="button" className="px-1 font-bold" aria-label={`Remover número ${d}`} onClick={() => onDef({ dids: dids.filter((x) => x !== d) })}>×</button></li>)}</ul>}
        <div className="flex items-end gap-2">
          <TextField label="Adicionar número" inputMode="tel" value={did} error={didErr} onChange={(e) => { setDid(e.target.value); setDidErr(null); }} placeholder="08006000000" />
          <Button variant="secondary" onClick={() => { const v = did.replace(/[\s().-]/g, ''); if (!DID_RE.test(v)) { setDidErr('Número inválido (2 a 20 dígitos, podendo iniciar com +).'); return; } if (!dids.includes(v)) onDef({ dids: [...dids, v] }); setDid(''); }}>Adicionar</Button>
        </div>
      </div>
      <details>
        <summary className="cursor-pointer text-sm font-medium">Entrada alternativa por cabeçalho SIP (URA 0800 do órgão)</summary>
        <div className="mt-2 flex flex-col gap-2">
          <TextField label="Nome do cabeçalho" value={ebh?.header ?? ''} placeholder="X-URA-Option" onChange={(e) => onDef({ entryByHeader: e.target.value ? { header: e.target.value, map: ebh?.map ?? {} } : undefined })} />
          {ebh && (
            <>
              {Object.entries(ebh.map).map(([k, v]) => (
                <div key={k} className="flex flex-wrap items-end gap-2">
                  <TextField label="Valor do cabeçalho" value={k} onChange={(e) => { const m: Record<string, string> = {}; Object.entries(ebh.map).forEach(([a, b]) => { m[a === k ? e.target.value : a] = b; }); onDef({ entryByHeader: { ...ebh, map: m } }); }} />
                  <Select label="Começar no nó" value={v} onChange={(e) => onDef({ entryByHeader: { ...ebh, map: { ...ebh.map, [k]: e.target.value } } })}>{nodeIds.map((n) => <option key={n} value={n}>{n}</option>)}</Select>
                  <Button variant="secondary" aria-label={`Remover valor ${k}`} onClick={() => { const m = { ...ebh.map }; delete m[k]; onDef({ entryByHeader: { ...ebh, map: m } }); }}>Remover</Button>
                </div>
              ))}
              <div><Button variant="secondary" onClick={() => onDef({ entryByHeader: { ...ebh, map: { ...ebh.map, [`valor${Object.keys(ebh.map).length + 1}`]: def.start } } })}>Adicionar valor</Button></div>
            </>
          )}
        </div>
      </details>
    </fieldset>
  );
}

// ── Validação ────────────────────────────────────────────────────────────────────────────────────────
function ValidationPanel({ val, busy, onGo }: { val: Validation | null; busy: boolean; onGo: (node: string) => void }) {
  const row = (i: Issue, k: string, kind: 'Erro' | 'Aviso') => (
    <li key={k} className="text-sm"><strong className={kind === 'Erro' ? 'text-bv-danger' : 'text-bv-warning'}>{kind}:</strong> {i.message}{i.path ? ` (campo ${i.path})` : ''}{' '}
      {i.node && <Button size="sm" variant="ghost" onClick={() => onGo(i.node!)}>Ir ao nó {i.node}</Button>}</li>
  );
  return (
    <Card title="Validação" actions={busy ? <Spinner size={16} label="Validando" /> : null}>
      {!val ? <p className="text-sm text-bv-muted">Validando…</p> : (
        <div className="flex flex-col gap-2">
          <p><Badge tone={val.ok ? 'success' : 'danger'}>{val.ok ? 'Fluxo válido' : `${val.errors.length} erro(s) a corrigir`}</Badge>{val.warnings.length > 0 && <> <Badge tone="warning">{val.warnings.length} aviso(s)</Badge></>}</p>
          {val.errors.length > 0 && <ul className="flex flex-col gap-1">{val.errors.map((e, i) => row(e, `e${i}`, 'Erro'))}</ul>}
          {val.warnings.length > 0 && <ul className="flex flex-col gap-1">{val.warnings.map((e, i) => row(e, `w${i}`, 'Aviso'))}</ul>}
          {val.ok && !val.warnings.length && <p className="text-sm text-bv-muted">Nenhum problema encontrado. O fluxo pode ser publicado.</p>}
        </div>
      )}
    </Card>
  );
}

// ── Simulador ────────────────────────────────────────────────────────────────────────────────────────
function Simulator({ flowId, dirty, def, lang }: { flowId: string; dirty: boolean; def: IvrDef; lang: string }) {
  const [text, setText] = useState('1');
  const [at, setAt] = useState('');
  const [simLang, setSimLang] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<SimResult | null>(null);
  const [err, setErr] = useState<Issue[] | string | null>(null);
  const run = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null); setRes(null);
    const inputs = text.split(/[\s,;]+/).filter(Boolean);
    const body = { inputs, ...(at ? { at: new Date(at).toISOString() } : {}), ...(simLang ? { lang: simLang } : {}) };
    try {
      // sem alterações pendentes simula a versão salva; com alterações, a definição que está na tela
      setRes(dirty ? await bv.post<SimResult>('/voice/ivr/simulate', { ...body, definition: def }) : await bv.post<SimResult>(`/voice/ivr/flows/${flowId}/simulate`, body));
    } catch (e2) { const errs = e2 instanceof BvApiError ? ((e2.details as any)?.errors as Issue[] | undefined) : undefined; setErr(errs?.length ? errs : errMsg(e2)); }
    finally { setBusy(false); }
  };
  return (
    <Card title="Simulador de chamada">
      <form onSubmit={run} className="flex flex-col gap-3">
        <TextArea label="Teclas digitadas pelo chamador, na ordem" value={text} onChange={(e) => setText(e.target.value)} rows={2}
          hint='Separe por espaço ou vírgula. "1" = tecla digitada após o aviso; "~1" = digitada durante o aviso (cut-thru); "12345678900#" = sequência de dígitos para uma coleta; "timeout" = sem resposta.' />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Simular em (data e hora, opcional)" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} hint="Para testar horário de atendimento/feriado." />
          <TextField label="Idioma inicial (opcional)" value={simLang} maxLength={10} onChange={(e) => setSimLang(e.target.value)} placeholder={def.defaultLang ?? lang} />
        </div>
        <div className="flex items-center gap-3"><Button type="submit" loading={busy}>Simular</Button><span className="text-xs text-bv-muted">{dirty ? 'Usa as alterações ainda não salvas.' : 'Usa a versão salva.'}</span></div>
      </form>
      <div role="status" aria-live="polite">
        {err && <div className="mt-3"><Banner tone="danger" title="A simulação não pôde ser executada">{typeof err === 'string' ? err : <ul>{err.map((x, i) => <li key={i}>{x.message}</li>)}</ul>}</Banner></div>}
        {res && (
          <div className="mt-4 flex flex-col gap-3">
            <p><strong>Resultado:</strong> <Badge tone={res.outcome.action === 'queue' ? 'success' : 'primary'}>{OUTCOME_LABEL[res.outcome.action] ?? res.outcome.action}</Badge>
              {res.outcome.category ? ` · categoria ${res.outcome.category}` : ''}{res.outcome.queue ? ` · fila ${res.outcome.queue}` : ''}{res.outcome.destination ? ` · para ${res.outcome.destination.number}` : ''}{res.outcome.reason ? ` · motivo: ${res.outcome.reason}` : ''}
              {' '}· idioma {res.lang}</p>
            <div><h3 className="text-sm font-semibold">Trilha</h3><ol className="list-decimal pl-5 text-sm">{res.trail.map((t, i) => <li key={i}>{describeTrail(t)}</li>)}</ol></div>
            <details><summary className="cursor-pointer text-sm font-semibold">O que o chamador ouviu ({res.spoken.length})</summary>
              <ol className="mt-1 list-decimal pl-5 text-sm">{res.spoken.map((s, i) => <li key={i}>{s.audioKey ? '[áudio gravado] ' : ''}{s.text || '(sem texto)'}{s.cutThru ? ' — interrompido pelo chamador' : ''}{!s.interruptible ? ' — aviso obrigatório' : ''}</li>)}</ol></details>
            {(Object.keys(res.vars).length > 0 || res.sensitiveVars.length > 0) && (
              <p className="text-sm"><strong>Variáveis coletadas:</strong> {Object.entries(res.vars).map(([k, v]) => `${k}=${v}`).join(', ')}{res.sensitiveVars.length ? ` · sensíveis (valor oculto): ${res.sensitiveVars.join(', ')}` : ''}</p>
            )}
            {res.unusedInputs.length > 0 && <Banner tone="warning">Teclas não usadas (a ligação terminou antes): {res.unusedInputs.join(', ')}</Banner>}
          </div>
        )}
      </div>
    </Card>
  );
}

// ── Diálogos ─────────────────────────────────────────────────────────────────────────────────────────
function AddNodeDialog({ open, existing, onClose, onAdd }: { open: boolean; existing: string[]; onClose: () => void; onAdd: (id: string, t: NodeType) => void }) {
  const [id, setId] = useState(''); const [type, setType] = useState<NodeType>('menu');
  const err = !id ? null : !NODE_ID_RE.test(id) ? 'Use letras, números, ponto, hífen ou _ (até 64 caracteres).' : existing.includes(id) ? 'Já existe um nó com este nome.' : null;
  useEffect(() => { if (open) { setId(''); setType('menu'); } }, [open]);
  return (
    <Dialog open={open} onClose={onClose} title="Adicionar nó" footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button disabled={!id || !!err} onClick={() => { onAdd(id, type); onClose(); }}>Adicionar</Button></>}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (id && !err) { onAdd(id, type); onClose(); } }}>
        <TextField label="Nome do nó (identificador)" required value={id} onChange={(e) => setId(e.target.value)} error={err} hint="Ex.: consulta_processo" />
        <Select label="Tipo" value={type} onChange={(e) => setType(e.target.value as NodeType)} hint={NODE_HELP[type]}>
          {NODE_TYPES.map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
        </Select>
      </form>
    </Dialog>
  );
}

function PublishDialog({ open, flow, dirty, err, onClose, onConfirm }: { open: boolean; flow: FlowFull; dirty: boolean; err: Issue[] | string | null; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onClose={onClose} title={`Publicar "${flow.name}" — versão ${flow.version}`} footer={
      <><Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button loading={busy} onClick={async () => { setBusy(true); try { await onConfirm(); } catch { /* erro exibido no diálogo */ } finally { setBusy(false); } }}>Publicar agora</Button></>}>
      <div className="flex flex-col gap-3 text-sm">
        <p>Ao publicar, esta versão passa a atender <strong>as novas ligações</strong> e a versão ativa atual (se houver) é arquivada. A troca é atômica e <strong>não interrompe o serviço</strong>: ligações em andamento terminam com a versão que já estavam usando.</p>
        {dirty && <p>Há alterações não salvas: elas serão salvas antes de publicar.</p>}
        {flow.status === 'ARCHIVED' && <p>Esta é uma versão arquivada: publicá-la equivale a voltar para ela (reversão).</p>}
        {err && <Banner tone="danger" title="Não foi possível publicar">{typeof err === 'string' ? err : <ul className="list-disc pl-4">{err.map((x, i) => <li key={i}>{x.message}</li>)}</ul>}</Banner>}
        <p className="text-xs text-bv-muted">Criada em {fmtDateTime(flow.createdAt)}{flow.publishedAt ? ` · publicada antes em ${fmtDateTime(flow.publishedAt)}` : ''}.</p>
      </div>
    </Dialog>
  );
}
