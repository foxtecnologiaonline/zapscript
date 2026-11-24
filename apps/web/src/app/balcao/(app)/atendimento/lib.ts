/**
 * Funções puras do console do atendente (ordenação, SLA, filtros, atalhos `/resposta`, CNJ, modelos do WhatsApp…).
 * Sem React e sem acesso ao DOM — cobertas por __tests__/lib.test.ts.
 */
import { fmtDuration } from '@/lib/balcao/format';
import type {
  Attachment, ChatMessage, ConvCore, ConvEvent, ConvListItem, CannedResponse, MsgStatus, ProcessoResumo, SortMode, TabId, Tone, WaTemplate,
} from './types';

// ── Rótulos ──────────────────────────────────────────────────────────────────
export const CLOSE_REASON_LABEL: Record<string, string> = {
  RESOLVED: 'Resolvido', ABANDONED: 'Abandonado pelo cidadão', TRANSFERRED_OUT: 'Encaminhado a outro órgão', SPAM: 'Spam ou engano', TIMEOUT: 'Inatividade',
};
export const TASK_STATUS_LABEL: Record<string, string> = { OPEN: 'Aberta', IN_PROGRESS: 'Em andamento', WAITING: 'Aguardando', DONE: 'Concluída', CANCELLED: 'Cancelada' };
export const IDENTITY_LABEL: Record<string, string> = { bronze: 'Bronze', prata: 'Prata', ouro: 'Ouro' };
export const POLO_LABEL: Record<string, string> = { ATIVO: 'Polo ativo', PASSIVO: 'Polo passivo', TERCEIRO: 'Terceiro interessado', FISCAL_DA_LEI: 'Fiscal da lei' };

// ── Tempo de espera / SLA ────────────────────────────────────────────────────
const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

/** Segundos aguardando atendimento (só conversas na fila). */
export function waitSeconds(c: Pick<ConvCore, 'status' | 'queuedAt' | 'startedAt' | 'waitSec'>, now: number): number | null {
  if (c.status !== 'WAITING') return null;
  const since = ms(c.queuedAt) ?? ms(c.startedAt);
  if (since == null) return c.waitSec;
  return Math.max(0, Math.floor((now - since) / 1000));
}

export interface SlaInfo { tone: Tone; label: string; detail: string | null; kind: 'Primeira resposta' | 'Resolução' | null }
/** Estado do SLA: sempre texto + tom (nunca só cor). `null` quando não se aplica (encerrada/bot/sem prazo). */
export function slaInfo(c: Pick<ConvCore, 'status' | 'slaBreached' | 'firstResponseAt' | 'slaFirstResponseDueAt' | 'slaResolutionDueAt'>, now: number, warnSec = 600): SlaInfo | null {
  if (c.status === 'CLOSED' || c.status === 'BOT') return null;
  const first = !c.firstResponseAt && ms(c.slaFirstResponseDueAt) != null;
  const due = first ? ms(c.slaFirstResponseDueAt) : ms(c.slaResolutionDueAt);
  const kind = due == null ? null : first ? 'Primeira resposta' : 'Resolução';
  if (due == null) return c.slaBreached ? { tone: 'danger', label: 'SLA violado', detail: null, kind: null } : null;
  const diff = Math.round((due - now) / 1000);
  if (c.slaBreached || diff < 0) return { tone: 'danger', label: 'SLA vencido', detail: diff < 0 ? `há ${fmtDuration(-diff)}` : null, kind };
  if (diff <= warnSec) return { tone: 'warning', label: 'SLA a vencer', detail: `em ${fmtDuration(diff)}`, kind };
  return { tone: 'success', label: 'SLA no prazo', detail: `${fmtDuration(diff)} restantes`, kind };
}

/** Prioridade numérica (fila + regras + categoria) → rótulo. */
export function priorityLabel(p: number): string | null {
  if (p >= 5) return 'Prioridade urgente';
  if (p >= 3) return 'Prioridade alta';
  if (p >= 1) return 'Prioridade elevada';
  return null;
}

// ── Ordenação e filtros ──────────────────────────────────────────────────────
const lastActivity = (c: ConvListItem) => ms(c.lastMessageAt) ?? ms(c.startedAt) ?? 0;
const queueSince = (c: ConvListItem) => ms(c.queuedAt) ?? ms(c.startedAt) ?? 0;

export function sortConversations(items: ConvListItem[], mode: SortMode): ConvListItem[] {
  const arr = [...items];
  const tie = (a: ConvListItem, b: ConvListItem) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (mode === 'recent') return arr.sort((a, b) => lastActivity(b) - lastActivity(a) || tie(a, b));
  if (mode === 'wait') {
    return arr.sort((a, b) => {
      const aw = a.status === 'WAITING' ? 0 : 1, bw = b.status === 'WAITING' ? 0 : 1;
      if (aw !== bw) return aw - bw;
      // na fila: quem espera há mais tempo primeiro; demais: atividade mais antiga primeiro (precisa de atenção)
      return aw === 0 ? queueSince(a) - queueSince(b) || tie(a, b) : lastActivity(a) - lastActivity(b) || tie(a, b);
    });
  }
  return arr.sort((a, b) => b.priority - a.priority || queueSince(a) - queueSince(b) || tie(a, b));
}

/** Remove acentos e caixa. */
export const norm = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Busca local (todas as palavras devem aparecer): protocolo, contato, assunto ou categoria. */
export function matchesSearch(c: ConvListItem, text: string): boolean {
  const words = norm(text).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = norm([c.protocol, c.contact?.name, c.subject, c.category].filter(Boolean).join(' '));
  return words.every((w) => hay.includes(w));
}

/** O texto parece (parte de) um protocolo? Então também filtramos no servidor (`protocol` = contém). */
export const looksLikeProtocol = (t: string) => /^[A-Za-z]{0,6}-?\d[\w-]*$/.test(t.trim());

export interface ListFilters { text: string; channel: string; status: string; sort: SortMode }
export const DEFAULT_SORT: Record<TabId, SortMode> = { mine: 'recent', queue: 'priority', all: 'priority' };

/** Parâmetros de GET /conversations para a aba e os filtros atuais. */
export function buildListQuery(tab: TabId, f: ListFilters, cursor?: string | null): Record<string, string | number | boolean | undefined> {
  const q: Record<string, string | number | boolean | undefined> = { limit: 50, sort: f.sort === 'recent' ? 'recent' : 'priority' };
  if (tab === 'queue') { q.unassigned = true; q.status = 'WAITING'; }
  else {
    if (tab === 'mine') q.mine = true;
    q.status = f.status || (tab === 'mine' ? 'ACTIVE' : 'BOT,WAITING,ACTIVE');
  }
  if (f.channel) q.channel = f.channel;
  if (f.text.trim() && looksLikeProtocol(f.text)) q.protocol = f.text.trim();
  if (cursor) q.cursor = cursor;
  return q;
}

/** Aplica o payload parcial de `conversation:updated` a um item da lista. */
export function applyUpdate(item: ConvListItem, patch: Record<string, any>): ConvListItem {
  const next: ConvListItem = { ...item };
  const keys = ['status', 'queueId', 'priority', 'assignedUserId', 'unreadForAgent', 'slaFirstResponseDueAt', 'slaResolutionDueAt', 'slaBreached', 'lastMessageAt'] as const;
  for (const k of keys) if (patch[k] !== undefined) (next as any)[k] = patch[k];
  if (patch.assignedUserId !== undefined && patch.assignedUserId !== item.assignedUserId) next.assignee = null;
  if (patch.queueId !== undefined && patch.queueId !== item.queueId) next.queue = null;
  return next;
}

/** Índice vizinho para J/K (sem dar a volta). */
export function neighborId(ids: string[], current: string | null, dir: 1 | -1): string | null {
  if (!ids.length) return null;
  const i = current ? ids.indexOf(current) : -1;
  if (i < 0) return dir === 1 ? ids[0] : ids[ids.length - 1];
  return ids[Math.min(ids.length - 1, Math.max(0, i + dir))];
}

// ── Mensagens ────────────────────────────────────────────────────────────────
/** Insere/atualiza por id mantendo a ordem cronológica. */
export function upsertMessage(list: ChatMessage[], m: ChatMessage): ChatMessage[] {
  const i = list.findIndex((x) => x.id === m.id);
  if (i >= 0) { const copy = [...list]; copy[i] = { ...copy[i], ...m }; return copy; }
  const last = list[list.length - 1];
  if (!last || Date.parse(m.createdAt) >= Date.parse(last.createdAt)) return [...list, m];
  return [...list, m].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

export const isNote = (m: Pick<ChatMessage, 'direction' | 'kind'>) => m.direction === 'INTERNAL' || m.kind === 'NOTE';

const ERROR_LABEL: Record<string, string> = {
  'whatsapp.outside_window': 'janela de 24 h do WhatsApp expirada — envie um modelo aprovado',
  'whatsapp.invalid_recipient': 'número de WhatsApp inválido ou inexistente',
  'whatsapp.rate_limited': 'limite de envios atingido; tente de novo em instantes',
  'whatsapp.template_not_approved': 'modelo não aprovado',
  'whatsapp.template_params_mismatch': 'parâmetros do modelo não conferem',
  'whatsapp.quota_exceeded': 'cota do contrato esgotada',
  'whatsapp.auth_failed': 'falha de autenticação com o WhatsApp (avise o administrador)',
  'whatsapp.payment_issue': 'problema de cobrança na conta do WhatsApp',
  'whatsapp.account_restricted': 'conta do WhatsApp restrita',
  'whatsapp.not_delivered_policy': 'barrada por política do WhatsApp',
  'whatsapp.unsupported_message_type': 'tipo de mensagem não suportado',
  'whatsapp.media_error': 'erro ao enviar o arquivo',
  'whatsapp.invalid_parameter': 'parâmetro inválido',
  'whatsapp.invalid_attachment': 'anexo inválido',
  'whatsapp.unsupported_media': 'tipo de arquivo não aceito pelo WhatsApp',
  'whatsapp.media_too_large': 'arquivo grande demais para o WhatsApp',
  'whatsapp.unavailable': 'WhatsApp indisponível no momento',
  'whatsapp.network_error': 'falha de rede ao falar com o WhatsApp',
  'whatsapp.not_configured': 'canal WhatsApp não configurado',
  'whatsapp.disabled': 'canal WhatsApp desabilitado',
  'whatsapp.send_failed': 'falha no envio pelo WhatsApp',
  'email.attachments_too_large': 'anexos acima do limite do e-mail',
  'channel.no_sender': 'canal sem integração de envio',
  'channel.send_failed': 'falha no envio pelo canal',
};
export const errorLabel = (code: string | null | undefined) => (code ? ERROR_LABEL[code] ?? `erro de envio (${code})` : 'erro de envio');

export interface DeliveryInfo { label: string; tone: Tone; failed: boolean }
export function deliveryInfo(status: MsgStatus, errorCode: string | null): DeliveryInfo {
  switch (status) {
    case 'QUEUED': return { label: 'Enviando…', tone: 'neutral', failed: false };
    case 'SENT': return { label: 'Enviada', tone: 'neutral', failed: false };
    case 'DELIVERED': return { label: 'Entregue', tone: 'neutral', failed: false };
    case 'READ': return { label: 'Lida pelo cidadão', tone: 'success', failed: false };
    default: return { label: `Falhou: ${errorLabel(errorCode)}`, tone: 'danger', failed: true };
  }
}

/** Heurística de janela do WhatsApp (o backend é a fonte da verdade — erro `whatsapp.outside_window`). */
export function windowExpired(lastInboundAt: string | null, now: number, hours = 24): boolean {
  const t = ms(lastInboundAt);
  if (t == null) return true;
  return now - t > hours * 3600_000;
}
/** A última tentativa de resposta falhou por janela expirada e o cidadão não escreveu desde então. */
export function failedOutsideWindow(messages: ChatMessage[], lastInboundAt: string | null): boolean {
  const li = ms(lastInboundAt) ?? 0;
  return messages.some((m) => m.direction === 'OUT' && m.errorCode === 'whatsapp.outside_window' && (ms(m.createdAt) ?? 0) >= li);
}

/** Rótulo curto do remetente para a bolha/leitores de tela. */
export function senderLabel(m: ChatMessage, ctx: { meId: string; contactName: string | null; assignee: { id: string; name: string } | null }): string {
  if (isNote(m)) return m.senderUserId === ctx.meId ? 'Você (nota interna)' : 'Nota interna da equipe';
  switch (m.senderType) {
    case 'CONTACT': return ctx.contactName || 'Cidadão';
    case 'BOT': return 'Assistente virtual';
    case 'SYSTEM': return 'Sistema';
    default:
      if (m.senderUserId === ctx.meId) return 'Você';
      if (ctx.assignee && m.senderUserId === ctx.assignee.id) return ctx.assignee.name;
      return 'Atendente';
  }
}

export const attachmentPath = (conversationId: string, key: string) =>
  `/conversations/${encodeURIComponent(conversationId)}/attachments/${key.split('/').map(encodeURIComponent).join('/')}`;
export const isImage = (a: Pick<Attachment, 'mime'>) => a.mime.startsWith('image/');
export const canPreview = (a: Pick<Attachment, 'mime'>) => ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'].includes(a.mime);

/** Prévia curta para anúncio por leitor de tela. */
export function preview(text: string | null | undefined, max = 160): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// ── Linha do tempo (mensagens + eventos + separador de dia) ─────────────────
export type TimelineItem =
  | { type: 'message'; key: string; at: string; m: ChatMessage }
  | { type: 'event'; key: string; at: string; text: string }
  | { type: 'day'; key: string; at: string };

export function eventText(e: ConvEvent, meId: string): string | null {
  const d = e.data ?? {};
  switch (e.type) {
    case 'ASSIGNED':
      if (d.via === 'TRANSFER') return null; // já descrito por TRANSFERRED
      if (d.via === 'PICKUP') return e.actorUserId === meId ? 'Você assumiu a conversa' : 'Conversa assumida por um atendente';
      if (d.via === 'MANUAL') return d.userId === meId ? 'Um supervisor atribuiu a conversa a você' : 'Conversa atribuída por um supervisor';
      return d.userId === meId ? 'Conversa distribuída a você' : 'Conversa distribuída a um atendente';
    case 'TRANSFERRED': return d.toQueueId ? 'Conversa transferida para outra fila' : d.toUserId === meId ? 'Conversa transferida para você' : 'Conversa transferida para outro atendente';
    case 'ESCALATED': return 'O assistente virtual encaminhou o cidadão para atendimento humano';
    case 'QUEUED': return 'Conversa entrou na fila de atendimento';
    case 'REQUEUED': return 'Conversa devolvida à fila';
    case 'OVERFLOW': return 'Conversa movida para a fila de transbordo por tempo de espera';
    case 'CLOSED': return `Conversa encerrada${d.reason ? ` (${CLOSE_REASON_LABEL[d.reason] ?? d.reason})` : ''}`;
    case 'REOPENED': return 'Conversa reaberta por nova mensagem do cidadão';
    case 'TAKEOVER': return 'Um supervisor assumiu a conversa';
    case 'TASK_CREATED': return `Tarefa criada a partir desta conversa${d.code ? ` (${d.code})` : ''}`;
    case 'SLA_BREACH': return 'Prazo de SLA violado';
    case 'TIMEOUT': return 'Conversa encerrada por inatividade';
    case 'CSAT': return 'Avaliação do atendimento registrada';
    default: return null;
  }
}

export function buildTimeline(messages: ChatMessage[], events: ConvEvent[], meId: string, dayKey: (iso: string) => string): TimelineItem[] {
  const rows: Array<Exclude<TimelineItem, { type: 'day' }>> = messages.map((m) => ({ type: 'message' as const, key: `m-${m.id}`, at: m.createdAt, m }));
  for (const e of events) {
    const text = eventText(e, meId);
    if (text) rows.push({ type: 'event', key: `e-${e.id}`, at: e.createdAt, text });
  }
  rows.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const out: TimelineItem[] = [];
  let lastDay = '';
  for (const r of rows) {
    const day = dayKey(r.at);
    if (day !== lastDay) { out.push({ type: 'day', key: `d-${day}`, at: r.at }); lastDay = day; }
    out.push(r);
  }
  return out;
}

// ── Respostas prontas (`/atalho`) ────────────────────────────────────────────
export interface SlashToken { start: number; end: number; query: string }
/** Token `/xxx` imediatamente antes do cursor (início do texto ou após espaço/quebra de linha). */
export function findSlashToken(text: string, caret: number): SlashToken | null {
  const before = text.slice(0, caret);
  const m = /(^|\s)\/([A-Za-z0-9_-]{0,32})$/.exec(before);
  if (!m) return null;
  const start = before.length - m[2].length - 1;
  return { start, end: caret, query: m[2].toLowerCase() };
}
/** Selo textual do escopo da resposta pronta (nunca só cor). Sem `scope` (API antiga) = do órgão. */
export const cannedScopeLabel = (c: Pick<CannedResponse, 'scope'>): 'Minha' | 'Órgão' => (c.scope === 'PERSONAL' ? 'Minha' : 'Órgão');
/** Pessoais primeiro, preservando a ordem relativa (o servidor já ordena por atalho dentro de cada grupo). */
const personalFirst = (items: CannedResponse[]) => [...items.filter((c) => c.scope === 'PERSONAL'), ...items.filter((c) => c.scope !== 'PERSONAL')];
export function filterCanned(items: CannedResponse[], query: string, limit = 8): CannedResponse[] {
  const q = norm(query);
  const visible = items.filter((c) => !c.shadowed); // a do órgão sobrescrita por uma pessoal de mesmo atalho não aparece
  if (!q) return personalFirst(visible).slice(0, limit);
  const starts = visible.filter((c) => c.shortcut.toLowerCase().startsWith(q));
  const rest = visible.filter((c) => !starts.includes(c) && (c.shortcut.toLowerCase().includes(q) || norm(c.title).includes(q)));
  return [...personalFirst(starts), ...personalFirst(rest)].slice(0, limit);
}

/** Atalho como o servidor normaliza: sem "/" inicial, minúsculo. */
export const normalizeShortcut = (s: string) => s.trim().replace(/^\/+/, '').toLowerCase();
/** Mensagem de erro do atalho (ou null se válido). */
export function shortcutError(s: string): string | null {
  const v = normalizeShortcut(s);
  if (!v) return 'Informe o atalho.';
  if (!/^[a-z0-9_-]{1,32}$/.test(v)) return 'Use de 1 a 32 letras (sem acento), números, _ ou -, sem espaços.';
  return null;
}

export function replaceRange(text: string, start: number, end: number, insertion: string): { text: string; caret: number } {
  return { text: text.slice(0, start) + insertion + text.slice(end), caret: start + insertion.length };
}

// ── Reenvio, anexos recusados e histórico paginado ───────────────────────────
/** Erro de POST …/messages/:id/resend → texto claro em português. */
export function resendErrorMessage(status: number, code: string, fallback: string): string {
  if (code === 'message.not_resendable') return 'Esta mensagem não pode mais ser reenviada: ela já foi enviada ou outro reenvio está em andamento.';
  if (code === 'conversation.closed') return 'A conversa foi encerrada; não é possível reenviar mensagens.';
  if (code === 'message.not_owner' || (status === 403 && code === 'auth.forbidden')) return 'Só o autor da mensagem (ou a supervisão) pode reenviá-la.';
  if (status === 404) return 'A mensagem não foi encontrada nesta conversa.';
  return fallback;
}

/** `details.reason` de 422 attachment.rejected. */
export function attachmentRejectedMessage(details: unknown): string {
  const reason = (details as { reason?: string } | null | undefined)?.reason;
  if (reason === 'infected') return 'O arquivo foi recusado pelo antivírus.';
  if (reason === 'scan_unavailable') return 'Não foi possível verificar o arquivo agora; tente novamente.';
  return 'O arquivo foi recusado na verificação de segurança.';
}

/**
 * Atualização silenciosa da conversa devolve só a página mais recente. Se o atendente já carregou mensagens mais
 * antigas, elas são mantidas (e o cursor `nextBefore` continua o da mais antiga carregada).
 */
export function mergeDetailMessages(
  old: { messages: ChatMessage[]; hasMore?: boolean; nextBefore?: string | null } | null,
  fresh: { messages: ChatMessage[]; hasMore?: boolean; nextBefore?: string | null },
): { messages: ChatMessage[]; hasMore: boolean; nextBefore: string | null } {
  const page = { messages: fresh.messages, hasMore: !!fresh.hasMore, nextBefore: fresh.nextBefore ?? null };
  if (!old || !old.messages.length || !fresh.messages.length) return page;
  const firstFresh = Date.parse(fresh.messages[0].createdAt);
  const ids = new Set(fresh.messages.map((m) => m.id));
  const older = old.messages.filter((m) => !ids.has(m.id) && Date.parse(m.createdAt) <= firstFresh);
  if (!older.length) return page;
  return { messages: [...older, ...fresh.messages], hasMore: !!old.hasMore, nextBefore: old.nextBefore ?? null };
}

/** Junta uma página mais antiga à frente da lista, sem repetir ids. */
export function prependMessages(list: ChatMessage[], older: ChatMessage[]): ChatMessage[] {
  const ids = new Set(list.map((m) => m.id));
  return [...older.filter((m) => !ids.has(m.id)), ...list];
}

/** Texto para leitor de tela quando o status de uma mensagem enviada muda (null = não anunciar). */
export function statusAnnouncement(prev: MsgStatus | undefined, next: MsgStatus, errorCode: string | null): string | null {
  if (prev === next) return null;
  if (next === 'FAILED') return `Falha no envio de uma mensagem: ${errorLabel(errorCode)}.`;
  if (prev === 'FAILED' && (next === 'SENT' || next === 'DELIVERED' || next === 'READ')) return `Mensagem reenviada com sucesso (${deliveryInfo(next, null).label.toLowerCase()}).`;
  return null;
}

// ── CNJ (e-Proc) ─────────────────────────────────────────────────────────────
/** Formata progressivamente: NNNNNNN-DD.AAAA.J.TR.OOOO. */
export function formatCnj(input: string): string {
  const d = input.replace(/\D/g, '').slice(0, 20);
  const parts = [d.slice(0, 7), d.slice(7, 9), d.slice(9, 13), d.slice(13, 14), d.slice(14, 16), d.slice(16, 20)];
  let out = parts[0];
  if (parts[1]) out += `-${parts[1]}`;
  if (parts[2]) out += `.${parts[2]}`;
  if (parts[3]) out += `.${parts[3]}`;
  if (parts[4]) out += `.${parts[4]}`;
  if (parts[5]) out += `.${parts[5]}`;
  return out;
}
const mod97 = (digits: string) => { let r = 0; for (const ch of digits) r = (r * 10 + Number(ch)) % 97; return r; };
/** Dígito verificador do CNJ (Resolução CNJ 65/2008): 98 − ((NNNNNNNAAAAJTROOOO00) mod 97). */
export function validCnj(input: string): boolean {
  const d = input.replace(/\D/g, '');
  if (d.length !== 20) return false;
  const dv = Number(d.slice(7, 9));
  return 98 - mod97(d.slice(0, 7) + d.slice(9) + '00') === dv;
}

export function processoText(p: ProcessoResumo): string {
  const last = p.ultimosMovimentos[0];
  return [
    `Processo ${p.numero}`,
    `Classe: ${p.classe || '—'}`, `Assunto: ${p.assunto || '—'}`, `Órgão julgador: ${p.orgaoJulgador || '—'}`, `Situação: ${p.situacao || '—'}`,
    last ? `Último movimento: ${last.descricao}${last.data ? ` (${last.data.slice(0, 10).split('-').reverse().join('/')})` : ''}` : null,
  ].filter(Boolean).join('\n');
}

// ── Modelos do WhatsApp ──────────────────────────────────────────────────────
const VAR_RE = /\{\{\s*(\d+)\s*\}\}/g;
export const varCount = (text: string | undefined | null) => new Set([...(text ?? '').matchAll(VAR_RE)].map((m) => Number(m[1]))).size;

export interface TemplateInfo { headerText: string; bodyText: string; footerText: string; headerVars: number; bodyVars: number; mediaHeader: boolean }
export function templateInfo(components: WaTemplate['components']): TemplateInfo {
  const by = (t: string) => components.find((c) => String(c.type).toUpperCase() === t);
  const header = by('HEADER');
  const fmt = String(header?.format ?? 'TEXT').toUpperCase();
  const mediaHeader = !!header && fmt !== 'TEXT';
  const headerText = !mediaHeader ? String(header?.text ?? '') : '';
  const bodyText = String(by('BODY')?.text ?? '');
  return { headerText, bodyText, footerText: String(by('FOOTER')?.text ?? ''), headerVars: varCount(headerText), bodyVars: varCount(bodyText), mediaHeader };
}
export const fillTemplate = (text: string, values: string[]) => text.replace(VAR_RE, (_m, n) => values[Number(n) - 1]?.trim() || `{{${n}}}`);
/** `params` de POST /whatsapp/send-template: lista (só corpo) ou `{header, body}`. */
export function buildTemplateParams(info: TemplateInfo, header: string[], body: string[]): string[] | { header?: string[]; body?: string[] } | undefined {
  const h = header.slice(0, info.headerVars).map((s) => s.trim());
  const b = body.slice(0, info.bodyVars).map((s) => s.trim());
  if (info.headerVars === 0 && info.bodyVars === 0) return undefined;
  if (info.headerVars === 0) return b;
  return { ...(h.length ? { header: h } : {}), ...(b.length ? { body: b } : {}) };
}

/** Texto de resumo da IA → nota interna. */
export function summaryNote(s: { summary: string; intent: string | null; pending: string[]; keyFacts: string[] }): string {
  const lines = [`Resumo (IA): ${s.summary}`];
  if (s.intent) lines.push(`Assunto: ${s.intent}`);
  if (s.keyFacts.length) lines.push('Fatos relevantes:', ...s.keyFacts.map((f) => `- ${f}`));
  if (s.pending.length) lines.push('Pendências:', ...s.pending.map((f) => `- ${f}`));
  return lines.join('\n');
}

export const GOVBR_PLACEHOLDER = '[LINK GOV.BR]';
export const GOVBR_DRAFT = `Para continuar com segurança, precisamos confirmar sua identidade pela conta GOV.BR. Acesse o link a seguir (válido por 30 minutos) e faça o login: ${GOVBR_PLACEHOLDER}\nDepois, volte a esta conversa.`;

/** Tamanho legível para anexos. */
export const humanSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1).replace('.', ',')} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
