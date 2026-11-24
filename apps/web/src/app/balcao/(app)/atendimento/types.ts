/** Tipos do console do atendente (formatos exatos das rotas /balcao/conversations, /contacts, /tasks etc.). */
export type Channel = 'WHATSAPP' | 'WEBCHAT' | 'EMAIL' | 'VOICE';
export type ConvStatus = 'BOT' | 'WAITING' | 'ACTIVE' | 'CLOSED';
export type TabId = 'mine' | 'queue' | 'all';
export type SortMode = 'priority' | 'wait' | 'recent';
export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';

/** Campos de serializeConversation (apps/api/src/balcao/routing/routes/common.ts). */
export interface ConvCore {
  id: string; protocol: string; channel: Channel; status: ConvStatus; priority: number;
  category: string | null; intent: string | null; subject: string | null;
  contactId: string; queueId: string | null; assignedUserId: string | null;
  startedAt: string; queuedAt: string | null; assignedAt: string | null; firstResponseAt: string | null;
  closedAt: string | null; closeReason: string | null;
  slaFirstResponseDueAt: string | null; slaResolutionDueAt: string | null; slaBreached: boolean;
  transferCount: number; lastMessageAt: string | null; lastInboundAt: string | null; unreadForAgent: number;
  botHandled: boolean; csatScore: number | null; waitSec: number | null;
}
export interface ConvListItem extends ConvCore {
  contact: { id: string; name: string | null; category: string };
  queue: { id: string; name: string } | null;
  assignee: { id: string; name: string } | null;
}
export interface ConvListResponse { items: ConvListItem[]; nextCursor: string | null }

export interface Attachment { key: string; name: string; mime: string; size: number; sha256?: string }
export type MsgStatus = 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
export interface ChatMessage {
  id: string; direction: 'IN' | 'OUT' | 'INTERNAL'; senderType: 'CONTACT' | 'BOT' | 'AGENT' | 'SYSTEM';
  senderUserId: string | null; kind: string; body: string | null; attachments: Attachment[] | null;
  status: MsgStatus; errorCode: string | null; aiMeta?: unknown; createdAt: string;
}
export interface ConvEvent { id: string; type: string; actorUserId: string | null; data: Record<string, any> | null; createdAt: string }
export interface ContactBrief {
  id: string; name: string | null; email: string | null; phone: string | null; category: string; tags: string[];
  document: string | null; identityVerifiedAt: string | null;
}
export interface ConvDetail {
  conversation: ConvCore & { queue: { id: string; name: string } | null; assignee: { id: string; name: string } | null };
  contact: ContactBrief | null;
  messages: ChatMessage[];
  /** Há mensagens mais antigas que as carregadas? `nextBefore` = id da mais antiga carregada (cursor da página anterior). */
  hasMore?: boolean; nextBefore?: string | null;
  events: ConvEvent[];
  canReply: boolean;
}

export type CannedScope = 'ORG' | 'PERSONAL';
export interface CannedResponse {
  id: string; shortcut: string; title: string; body: string;
  /** Ausente em respostas antigas: tratado como do órgão. */
  scope?: CannedScope; ownerId?: string | null; shadowsOrg?: boolean; shadowed?: boolean;
}
export interface Suggestion { suggestion: string; confidence: number; articles: Array<{ id: string; title: string }>; model?: string; conversationId: string; messageId?: string }
export interface StoredSuggestion { kind: string; suggestion: string; intent: string | null; category: string | null; confidence: number | null; articleIds: string[]; at: string }
export interface AiSummary { summary: string; intent: string | null; pending: string[]; keyFacts: string[]; model: string }

export interface QueueRow { id: string; name: string; active: boolean; memberCount?: number }
export interface AgentRow { id: string; name: string; role: string; presence: string; load: number; maxConcurrent: number }
export interface SectorRow { id: string; name: string; active?: boolean }

export interface WaTemplate { id: string; name: string; language: string; category: string; status: string; components: Array<{ type: string; format?: string; text?: string }> }

export interface ContactDetail {
  contact: { id: string; name: string | null; email: string | null; phone: string | null; category: string; tags: string[]; hasDocument: boolean; identityVerifiedAt: string | null; govbrLevel: string | null; document: string | null; createdAt: string };
  conversations: Array<{ id: string; protocol: string; channel: Channel; status: ConvStatus; category: string | null; subject: string | null; startedAt: string; closedAt: string | null; closeReason: string | null; csatScore: number | null }>;
}

export interface ProcessoResumo {
  numero: string; classe: string; assunto: string; orgaoJulgador: string; situacao: string; dataAutuacao: string | null;
  partes: Array<{ polo: string; nome: string }>; ultimosMovimentos: Array<{ data: string | null; descricao: string }>;
}
export interface KbHit { id: string; title: string; question: string; snippet: string; category: string | null; tags: string[]; rank: number }
export interface TaskRow { id: string; code: string; title: string; status: string; priority: string; kind: string; dueAt: string | null; conversationId: string | null }

/** Métodos que o composer expõe ao console (atalhos, painel do cidadão, resumo). */
export interface ComposerHandle {
  insert(text: string, mode?: 'reply' | 'note'): void;
  focus(mode?: 'reply' | 'note'): void;
}
