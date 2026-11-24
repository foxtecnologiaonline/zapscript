/** Tipos e utilidades do editor de URA. Fonte da verdade do formato: apps/api/src/balcao/channels/voice/ivr.ts (ivrDefinitionSchema). */
import { API_ORIGIN, BvApiError, getAccessToken, refreshSession } from '@/lib/balcao/api';
import { NODE_TYPE_LABEL } from './trail';

export type NodeType = 'menu' | 'play' | 'collect' | 'schedule' | 'language' | 'queue' | 'transfer' | 'hangup';
export const NODE_TYPES: NodeType[] = ['menu', 'play', 'collect', 'schedule', 'language', 'queue', 'transfer', 'hangup'];
export const NODE_HELP: Record<NodeType, string> = {
  menu: 'Toca um aviso e espera uma tecla; cada tecla leva a um nó.',
  play: 'Toca uma mensagem e segue para o próximo nó.',
  collect: 'Pede dígitos (ex.: CPF, nº do processo) e guarda em uma variável.',
  schedule: 'Desvia conforme o horário de atendimento e os feriados do órgão.',
  language: 'Deixa o chamador escolher o idioma dos próximos avisos.',
  queue: 'Entrega a ligação ao atendimento humano (fila).',
  transfer: 'Transfere para um número externo, ramal ou URA 0800.',
  hangup: 'Encerra a ligação (com mensagem opcional).',
};
export const TERMINAL: NodeType[] = ['queue', 'transfer', 'hangup'];

export interface Prompt { text?: string; audioKey?: string; lang?: string; i18n?: Record<string, { text?: string; audioKey?: string }> }
export interface IvrNode { type: NodeType; [k: string]: any }
export interface IvrDef { start: string; dids?: string[]; defaultLang?: string; entryByHeader?: { header: string; map: Record<string, string> }; nodes: Record<string, IvrNode> }
export interface Issue { code: string; message: string; node?: string; path?: string }
export interface Validation { ok: boolean; errors: Issue[]; warnings: Issue[] }
export interface FlowSummary { id: string; name: string; version: number; status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED'; language: string; createdById: string | null; publishedAt: string | null; createdAt: string; dids: string[] }
export interface FlowFull extends FlowSummary { definition: IvrDef; validation?: Validation }

export const STATUS_LABEL: Record<string, string> = { DRAFT: 'Rascunho', ACTIVE: 'Ativa', ARCHIVED: 'Arquivada' };
export const STATUS_TONE: Record<string, 'neutral' | 'success' | 'warning'> = { DRAFT: 'warning', ACTIVE: 'success', ARCHIVED: 'neutral' };
export const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '#'];
export const NODE_ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;
export const DID_RE = /^\+?[0-9*#]{2,20}$/;

export const typeLabel = (t: string) => NODE_TYPE_LABEL[t] ?? t;

export const NEW_FLOW_TEMPLATE: IvrDef = {
  start: 'boas_vindas',
  nodes: {
    boas_vindas: { type: 'menu', prompt: { text: 'Bem-vindo ao Balcão Virtual. Para falar com um atendente, digite 1. Para encerrar, digite 2.' }, options: { '1': 'atendimento', '2': 'encerrar' }, bargeIn: true, timeoutSec: 6, maxRetries: 3 },
    atendimento: { type: 'queue', prompt: { text: 'Aguarde, você será atendido.' }, category: 'geral' },
    encerrar: { type: 'hangup', prompt: { text: 'Obrigado por ligar.' } },
  },
};

/** Arestas (para onde cada nó pode ir) com rótulo legível. Espelha edgesOf() da API. */
export function edgesLabeled(n: IvrNode): Array<{ to: string; label: string }> {
  const out: Array<{ to: string; label: string }> = [];
  const retry = () => { if (n.timeoutNode) out.push({ to: n.timeoutNode, label: 'tempo esgotado' }); if (n.invalidNode) out.push({ to: n.invalidNode, label: 'opção inválida' }); };
  switch (n.type) {
    case 'menu': Object.entries<string>(n.options ?? {}).sort(([a], [b]) => a.localeCompare(b)).forEach(([k, to]) => out.push({ to, label: `tecla ${k}` })); retry(); break;
    case 'play': if (n.next) out.push({ to: n.next, label: 'segue' }); break;
    case 'collect': case 'language': if (n.next) out.push({ to: n.next, label: 'segue' }); retry(); break;
    case 'schedule': if (n.open) out.push({ to: n.open, label: 'em horário' }); if (n.closed) out.push({ to: n.closed, label: 'fora do horário' }); if (n.holiday) out.push({ to: n.holiday, label: 'feriado' }); break;
    default: break;
  }
  return out;
}

export interface TreeRow { id: string; depth: number; via: string; repeated: boolean; missing: boolean; parent: number; setSize: number; pos: number }

/** Árvore achatada (DFS a partir do nó inicial e das entradas alternativas), cada nó expandido uma só vez. */
export function buildTree(def: IvrDef): { rows: TreeRow[]; orphans: string[] } {
  const rows: TreeRow[] = []; const seen = new Set<string>();
  const visit = (id: string, depth: number, via: string, parent: number, pos: number, setSize: number) => {
    const node = def.nodes[id];
    const idx = rows.length;
    rows.push({ id, depth, via, repeated: seen.has(id), missing: !node, parent, setSize, pos });
    if (!node || seen.has(id)) return;
    seen.add(id);
    const edges = edgesLabeled(node);
    edges.forEach((e, i) => visit(e.to, depth + 1, e.label, idx, i + 1, edges.length));
  };
  const entries: Array<[string, string]> = [[def.start, 'início'], ...Object.entries(def.entryByHeader?.map ?? {}).map(([k, v]) => [v, `entrada ${def.entryByHeader?.header}=${k}`] as [string, string])];
  entries.forEach(([id, via], i) => visit(id, 0, via, -1, i + 1, entries.length));
  const orphans = Object.keys(def.nodes).filter((id) => !seen.has(id));
  return { rows, orphans };
}

/** Upload de áudio de prompt (corpo bruto). O cliente `bv` só envia JSON/FormData, por isso o fetch direto. */
export async function uploadPrompt(file: File): Promise<{ audioKey: string; sizeBytes: number; sha256: string }> {
  const ext = (file.name.split('.').pop() ?? 'wav').toLowerCase();
  const send = () => fetch(`${API_ORIGIN}/balcao/voice/ivr/prompts?ext=${encodeURIComponent(ext)}&name=${encodeURIComponent(file.name.slice(0, 80))}`, {
    method: 'POST', headers: { Authorization: `Bearer ${getAccessToken() ?? ''}`, 'Content-Type': ext === 'wav' ? 'audio/wav' : 'application/octet-stream' }, body: file,
  });
  let res = await send();
  if (res.status === 401 && (await refreshSession())) res = await send();
  if (!res.ok) {
    let b: any = null; try { b = await res.json(); } catch { /* sem corpo */ }
    throw new BvApiError(res.status, b?.error?.code ?? `http.${res.status}`, b?.error?.message ?? 'Não foi possível enviar o áudio.');
  }
  return res.json();
}

/** Diferenças simples entre duas definições (para comparar versões). */
export function diffDefs(a: IvrDef, b: IvrDef) {
  const ids = new Set([...Object.keys(a.nodes), ...Object.keys(b.nodes)]);
  const added: string[] = []; const removed: string[] = []; const changed: string[] = [];
  ids.forEach((id) => {
    if (!a.nodes[id]) added.push(id); else if (!b.nodes[id]) removed.push(id);
    else if (JSON.stringify(a.nodes[id]) !== JSON.stringify(b.nodes[id])) changed.push(id);
  });
  const meta: string[] = [];
  if (a.start !== b.start) meta.push(`Nó inicial: "${a.start}" → "${b.start}"`);
  if ((a.defaultLang ?? '') !== (b.defaultLang ?? '')) meta.push(`Idioma padrão: "${a.defaultLang ?? '—'}" → "${b.defaultLang ?? '—'}"`);
  if (JSON.stringify(a.dids ?? []) !== JSON.stringify(b.dids ?? [])) meta.push(`DIDs: [${(a.dids ?? []).join(', ')}] → [${(b.dids ?? []).join(', ')}]`);
  if (JSON.stringify(a.entryByHeader ?? null) !== JSON.stringify(b.entryByHeader ?? null)) meta.push('Entrada por cabeçalho SIP alterada');
  return { added: added.sort(), removed: removed.sort(), changed: changed.sort(), meta };
}

export function defaultNode(type: NodeType, target: string): IvrNode {
  switch (type) {
    case 'menu': return { type, prompt: { text: '' }, options: { '1': target }, bargeIn: true, timeoutSec: 6, maxRetries: 3 };
    case 'play': return { type, prompt: { text: '' }, next: target };
    case 'collect': return { type, prompt: { text: '' }, var: 'valor', next: target, minDigits: 1, maxDigits: 11, terminator: '#', timeoutSec: 8, maxRetries: 3 };
    case 'schedule': return { type, open: target, closed: target };
    case 'language': return { type, prompt: { text: '' }, languages: { '1': 'pt-BR', '2': 'en' }, next: target };
    case 'queue': return { type };
    case 'transfer': return { type, destination: { type: 'external', number: '' } };
    case 'hangup': return { type };
  }
}
