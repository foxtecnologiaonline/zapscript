'use client';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { errMsg } from '@/lib/balcao/api';
import { PRESENCE_LABEL, PRIORITY_LABEL } from '@/lib/balcao/format';
import { Badge, Banner, Button, Checkbox, Dialog, Select, Spinner, TextArea, TextField, useToast } from '../../_ui/ui';
import { CLOSE_REASON_LABEL, buildTemplateParams, fillTemplate, summaryNote, templateInfo } from './lib';
import { api } from './service';
import type { AgentRow, AiSummary, ConvCore, QueueRow, SectorRow, WaTemplate } from './types';

// ── Transferir ───────────────────────────────────────────────────────────────
export function TransferDialog({ conversationId, currentQueueId, meId, canPickAgent, onClose, onDone }: {
  conversationId: string; currentQueueId: string | null; meId: string; canPickAgent: boolean; onClose: () => void; onDone: (c: ConvCore) => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<'queue' | 'user'>('queue');
  const [queues, setQueues] = useState<QueueRow[] | null>(null);
  const [agents, setAgents] = useState<AgentRow[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [queueId, setQueueId] = useState('');
  const [userId, setUserId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.listQueues().then((r) => { if (alive) setQueues(r.items.filter((q) => q.active)); }).catch((e) => { if (alive) { setLoadErr(errMsg(e)); setQueues([]); } });
    if (canPickAgent) api.listAgents().then((r) => { if (alive) setAgents(r.items.filter((a) => a.id !== meId && a.presence !== 'OFFLINE')); }).catch(() => { if (alive) setAgents([]); });
    return () => { alive = false; };
  }, [canPickAgent, meId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    if (mode === 'queue' && !queueId) { setError('Escolha a fila de destino.'); return; }
    if (mode === 'user' && !userId) { setError('Escolha o atendente de destino.'); return; }
    setBusy(true);
    try {
      const r = await api.transfer(conversationId, { ...(mode === 'queue' ? { toQueueId: queueId } : { toUserId: userId }), ...(note.trim() ? { note: note.trim() } : {}) });
      toast.success(mode === 'queue' ? 'Conversa transferida para a fila.' : 'Conversa transferida para o atendente.');
      onDone(r.conversation); onClose();
    } catch (ex) { setError(errMsg(ex)); } finally { setBusy(false); }
  };

  return (
    <Dialog open onClose={onClose} title="Transferir conversa"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="bv-transfer-form" loading={busy}>Transferir</Button></>}>
      <form id="bv-transfer-form" onSubmit={submit} className="flex flex-col gap-3">
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-medium">Transferir para</legend>
          <label className="flex min-h-[32px] items-center gap-2 text-sm"><input type="radio" name="bv-tr-mode" className="h-5 w-5" checked={mode === 'queue'} onChange={() => setMode('queue')} />Uma fila</label>
          <label className="flex min-h-[32px] items-center gap-2 text-sm"><input type="radio" name="bv-tr-mode" className="h-5 w-5" checked={mode === 'user'} onChange={() => setMode('user')} disabled={!canPickAgent} />Um atendente disponível{!canPickAgent && <span className="text-xs text-bv-muted"> (exige perfil de supervisão)</span>}</label>
        </fieldset>
        {loadErr && <Banner tone="danger">{loadErr}</Banner>}
        {mode === 'queue' ? (
          queues == null ? <Spinner label="Carregando filas" /> : (
            <Select label="Fila de destino" required value={queueId} onChange={(e) => setQueueId(e.target.value)}>
              <option value="">Selecione…</option>
              {queues.map((q) => <option key={q.id} value={q.id}>{q.name}{q.id === currentQueueId ? ' (fila atual)' : ''}</option>)}
            </Select>
          )
        ) : agents == null ? <Spinner label="Carregando atendentes" /> : agents.length === 0 ? <Banner tone="warning">Nenhum outro atendente conectado no momento. Use a transferência para fila.</Banner> : (
          <Select label="Atendente de destino" required value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Selecione…</option>
            {[...agents].sort((a, b) => Number(b.presence === 'ONLINE') - Number(a.presence === 'ONLINE') || a.load - b.load).map((a) => (
              <option key={a.id} value={a.id}>{a.name} — {PRESENCE_LABEL[a.presence] ?? a.presence} ({a.load}/{a.maxConcurrent} conversas)</option>
            ))}
          </Select>
        )}
        <TextArea label="Nota para quem receber (opcional)" hint="Fica registrada como nota interna; o cidadão não vê." maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        {error && <Banner tone="danger">{error}</Banner>}
      </form>
    </Dialog>
  );
}

// ── Encerrar ─────────────────────────────────────────────────────────────────
const CLOSE_REASONS = ['RESOLVED', 'ABANDONED', 'TRANSFERRED_OUT', 'SPAM'] as const;
export function CloseDialog({ conversationId, protocol, onClose, onDone }: { conversationId: string; protocol: string; onClose: () => void; onDone: (c: ConvCore) => void }) {
  const toast = useToast();
  const [reason, setReason] = useState<string>('RESOLVED');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { const r = await api.close(conversationId, reason); toast.success(`Conversa ${protocol} encerrada.`); onDone(r.conversation); onClose(); }
    catch (ex) { setError(errMsg(ex)); } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} title="Encerrar conversa" size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="bv-close-form" loading={busy}>Encerrar</Button></>}>
      <form id="bv-close-form" onSubmit={submit} className="flex flex-col gap-3">
        <p className="text-sm">Você vai encerrar o atendimento <strong>{protocol}</strong>.</p>
        <Select label="Motivo do encerramento" required value={reason} onChange={(e) => setReason(e.target.value)}
          hint={reason === 'RESOLVED' ? 'Ao marcar como resolvido, o cidadão recebe a pesquisa de satisfação (quando habilitada).' : undefined}>
          {CLOSE_REASONS.map((r) => <option key={r} value={r}>{CLOSE_REASON_LABEL[r]}</option>)}
        </Select>
        {error && <Banner tone="danger">{error}</Banner>}
      </form>
    </Dialog>
  );
}

// ── Criar tarefa ─────────────────────────────────────────────────────────────
export function TaskDialog({ conversationId, defaultTitle, canListSectors, ownSectorId, onClose, onDone }: {
  conversationId: string; defaultTitle: string; canListSectors: boolean; ownSectorId: string | null | undefined; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('NORMAL');
  const [kind, setKind] = useState('DEMAND');
  const [sectors, setSectors] = useState<SectorRow[] | null>(null);
  const [sectorId, setSectorId] = useState(ownSectorId ?? '');
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [titleErr, setTitleErr] = useState<string | null>(null);

  useEffect(() => {
    if (!canListSectors) return;
    let alive = true;
    api.listSectors().then((r) => { if (alive) setSectors(r.items); }).catch(() => { if (alive) setSectors([]); });
    return () => { alive = false; };
  }, [canListSectors]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null); setTitleErr(null);
    if (title.trim() && title.trim().length < 3) { setTitleErr('O título precisa de pelo menos 3 caracteres.'); return; }
    setBusy(true);
    try {
      const t = await api.createTaskFromConversation({
        conversationId, kind, priority, notifyOnClose: notify,
        ...(title.trim() ? { title: title.trim() } : {}), ...(description.trim() ? { description: description.trim() } : {}), ...(sectorId ? { sectorId } : {}),
      });
      toast.success(`Tarefa ${t.code} criada.`);
      onDone(); onClose();
    } catch (ex) { setError(errMsg(ex)); } finally { setBusy(false); }
  };

  return (
    <Dialog open onClose={onClose} title="Criar tarefa a partir da conversa"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="bv-task-form" loading={busy}>Criar tarefa</Button></>}>
      <form id="bv-task-form" onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <TextField label="Título" value={title} maxLength={200} error={titleErr} hint="Se ficar em branco, o sistema usa o assunto e o protocolo." onChange={(e) => setTitle(e.target.value)} />
        <TextArea label="Descrição (opcional)" maxLength={8000} value={description} onChange={(e) => setDescription(e.target.value)} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select label="Prioridade" value={priority} onChange={(e) => setPriority(e.target.value)}>
            {['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
          </Select>
          <Select label="Tipo" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="DEMAND">Demanda interna</option>
            <option value="SERVICE_REQUEST">Solicitação de serviço à contratada</option>
          </Select>
        </div>
        {canListSectors && (
          sectors == null ? <Spinner label="Carregando setores" /> : (
            <Select label="Setor responsável" value={sectorId} onChange={(e) => setSectorId(e.target.value)} hint="Sem setor, a tarefa vai para a caixa geral.">
              <option value="">Sem setor (caixa geral)</option>
              {sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          )
        )}
        <Checkbox label="Avisar o cidadão quando a tarefa for encerrada" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
        {error && <Banner tone="danger">{error}</Banner>}
      </form>
    </Dialog>
  );
}

// ── Resumo por IA ────────────────────────────────────────────────────────────
export function SummaryDialog({ conversationId, canNote, onClose, onInsertNote }: { conversationId: string; canNote: boolean; onClose: () => void; onInsertNote: (text: string) => void }) {
  const toast = useToast();
  const [data, setData] = useState<AiSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true); setError(null);
    api.aiSummarize(conversationId).then(setData).catch((e) => setError(errMsg(e))).finally(() => setLoading(false));
  }, [conversationId]);
  useEffect(() => { load(); }, [load]);
  const text = data ? summaryNote(data) : '';
  const copy = async () => { try { await navigator.clipboard.writeText(text); toast.success('Resumo copiado.'); } catch { toast.error('Não foi possível copiar. Selecione o texto manualmente.'); } };
  return (
    <Dialog open onClose={onClose} title="Resumo da conversa (IA)" size="lg"
      footer={<>
        {data && <Button variant="secondary" onClick={() => void copy()}>Copiar</Button>}
        {data && canNote && <Button variant="secondary" onClick={() => { onInsertNote(text); onClose(); }}>Inserir como nota interna</Button>}
        <Button onClick={onClose}>Fechar</Button>
      </>}>
      <div aria-live="polite">
        {loading && <p className="flex items-center gap-2 text-sm"><Spinner label="" />Gerando resumo…</p>}
        {error && <div className="flex flex-col items-start gap-2"><Banner tone="danger">{error}</Banner><Button variant="secondary" size="sm" onClick={load}>Tentar de novo</Button></div>}
        {data && (
          <div className="flex flex-col gap-3 text-sm">
            <Banner tone="primary">Resumo gerado por IA a partir da conversa. Confira antes de usar.</Banner>
            <p className="whitespace-pre-wrap">{data.summary}</p>
            {data.intent && <p><strong>Assunto:</strong> {data.intent}</p>}
            {data.keyFacts.length > 0 && <div><p className="font-semibold">Fatos relevantes</p><ul className="list-disc pl-5">{data.keyFacts.map((f, i) => <li key={i}>{f}</li>)}</ul></div>}
            {data.pending.length > 0 && <div><p className="font-semibold">Pendências</p><ul className="list-disc pl-5">{data.pending.map((f, i) => <li key={i}>{f}</li>)}</ul></div>}
          </div>
        )}
      </div>
    </Dialog>
  );
}

// ── Modelo do WhatsApp ───────────────────────────────────────────────────────
export function TemplateDialog({ conversationId, onClose, onDone }: { conversationId: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [templates, setTemplates] = useState<WaTemplate[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [sel, setSel] = useState('');
  const [hv, setHv] = useState<string[]>([]);
  const [bv_, setBv] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.listTemplates().then((r) => { if (alive) setTemplates(Array.isArray(r) ? r : []); }).catch((e) => { if (alive) { setLoadErr(errMsg(e)); setTemplates([]); } });
    return () => { alive = false; };
  }, []);

  const tpl = useMemo(() => templates?.find((t) => `${t.name}|${t.language}` === sel) ?? null, [templates, sel]);
  const info = useMemo(() => (tpl ? templateInfo(tpl.components) : null), [tpl]);
  useEffect(() => { if (info) { setHv(Array(info.headerVars).fill('')); setBv(Array(info.bodyVars).fill('')); } }, [info]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    if (!tpl || !info) { setError('Escolha um modelo.'); return; }
    if (info.mediaHeader) { setError('Modelos com cabeçalho de imagem, vídeo ou documento ainda não podem ser enviados por esta tela.'); return; }
    if ([...hv, ...bv_].some((v) => !v.trim())) { setError('Preencha todas as variáveis do modelo.'); return; }
    setBusy(true);
    try {
      const params = buildTemplateParams(info, hv, bv_);
      await api.sendTemplate({ conversationId, templateName: tpl.name, language: tpl.language, ...(params ? { params } : {}) });
      toast.success('Modelo enviado ao cidadão.');
      onDone(); onClose();
    } catch (ex) { setError(errMsg(ex)); } finally { setBusy(false); }
  };

  const preview = info ? [fillTemplate(info.headerText, hv), fillTemplate(info.bodyText, bv_), info.footerText].filter(Boolean).join('\n\n') : '';

  return (
    <Dialog open onClose={onClose} title="Enviar modelo do WhatsApp" size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="bv-tpl-form" loading={busy} disabled={!tpl}>Enviar modelo</Button></>}>
      <form id="bv-tpl-form" onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <p className="text-sm text-bv-muted">Fora da janela de 24 h, só é possível iniciar a conversa com um modelo aprovado pela Meta. O envio conta na cota do contrato.</p>
        {loadErr && <Banner tone="danger">{loadErr}</Banner>}
        {templates == null ? <Spinner label="Carregando modelos" /> : templates.length === 0 && !loadErr ? <Banner tone="warning">Nenhum modelo aprovado cadastrado. Peça ao administrador para sincronizar os modelos do WhatsApp.</Banner> : (
          <Select label="Modelo" required value={sel} onChange={(e) => setSel(e.target.value)}>
            <option value="">Selecione…</option>
            {templates.map((t) => <option key={t.id} value={`${t.name}|${t.language}`}>{t.name} ({t.language}) — {t.category}</option>)}
          </Select>
        )}
        {info?.mediaHeader && <Banner tone="warning">Este modelo tem cabeçalho de mídia, que não é suportado nesta tela.</Banner>}
        {info && info.headerVars > 0 && hv.map((v, i) => <TextField key={`h${i}`} label={`Variável {{${i + 1}}} do cabeçalho`} required value={v} onChange={(e) => setHv((l) => l.map((x, j) => (j === i ? e.target.value : x)))} />)}
        {info && info.bodyVars > 0 && bv_.map((v, i) => <TextField key={`b${i}`} label={`Variável {{${i + 1}}} do corpo`} required value={v} onChange={(e) => setBv((l) => l.map((x, j) => (j === i ? e.target.value : x)))} />)}
        {tpl && (
          <div>
            <p className="mb-1 flex items-center gap-2 text-sm font-medium">Prévia <Badge>{tpl.category}</Badge></p>
            <p className="whitespace-pre-wrap rounded-md border border-bv-border bg-bv-subtle p-3 text-sm">{preview}</p>
          </div>
        )}
        {error && <Banner tone="danger">{error}</Banner>}
      </form>
    </Dialog>
  );
}

// ── Ajuda: atalhos ───────────────────────────────────────────────────────────
export const SHORTCUTS: Array<[string, string]> = [
  ['J / K', 'Próxima / conversa anterior da lista'],
  ['R', 'Responder (foco no campo de resposta)'],
  ['N', 'Escrever nota interna'],
  ['A', 'Assumir a conversa aberta (se estiver na fila)'],
  ['S', 'Pedir sugestão de resposta à IA'],
  ['T', 'Transferir a conversa'],
  ['E', 'Encerrar a conversa'],
  ['/', 'Buscar na lista de conversas'],
  ['?', 'Abrir esta ajuda'],
  ['Ctrl + Enter', 'Enviar a mensagem (dentro do campo de resposta)'],
  ['/atalho', 'No campo de resposta, abre a lista de respostas prontas'],
  ['Esc', 'Fecha diálogos e a lista de respostas prontas'],
];
export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} title="Atalhos de teclado" footer={<Button onClick={onClose}>Fechar</Button>}>
      <p className="mb-3 text-sm text-bv-muted">Os atalhos de uma tecla só funcionam quando o foco não está em um campo de texto, lista suspensa ou diálogo. No celular e em telas pequenas, use os botões da tela.</p>
      <table className="w-full border-collapse text-left text-sm">
        <caption className="bv-sr-only">Atalhos de teclado do console do atendente</caption>
        <thead><tr className="border-b border-bv-border"><th scope="col" className="py-2 pr-3">Tecla</th><th scope="col" className="py-2">Ação</th></tr></thead>
        <tbody>
          {SHORTCUTS.map(([k, d]) => <tr key={k} className="border-b border-bv-border"><th scope="row" className="py-2 pr-3 font-normal"><kbd className="rounded border border-bv-border bg-bv-subtle px-2 py-0.5 font-mono text-xs">{k}</kbd></th><td className="py-2">{d}</td></tr>)}
        </tbody>
      </table>
    </Dialog>
  );
}

// ── Visualização de anexo ────────────────────────────────────────────────────
export function PreviewDialog({ name, mime, url, onClose }: { name: string; mime: string; url: string; onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} title={name} size="lg" footer={<Button onClick={onClose}>Fechar</Button>}>
      {mime.startsWith('image/')
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={url} alt={`Imagem: ${name}`} className="mx-auto max-h-[70vh] max-w-full" />
        : <iframe src={url} title={`Documento: ${name}`} className="h-[70vh] w-full rounded border border-bv-border" />}
    </Dialog>
  );
}
