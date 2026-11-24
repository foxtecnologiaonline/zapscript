'use client';
/** Chamadas HTTP do console do atendente (todas sob `${API}/balcao`). Formatos conferidos nas rotas da API. */
import { bv } from '@/lib/balcao/api';
import type {
  AgentRow, AiSummary, Attachment, CannedResponse, ChatMessage, ContactDetail, ConvCore, ConvDetail, ConvListResponse, KbHit, ProcessoResumo,
  QueueRow, SectorRow, StoredSuggestion, Suggestion, TaskRow, WaTemplate,
} from './types';

type Q = Record<string, string | number | boolean | undefined>;
const cid = (id: string) => encodeURIComponent(id);

export const api = {
  listConversations: (q: Q) => bv.get<ConvListResponse>('/conversations', q),
  getConversation: (id: string) => bv.get<ConvDetail>(`/conversations/${cid(id)}`),
  markRead: (id: string) => bv.post<{ ok: true }>(`/conversations/${cid(id)}/read`),
  pickup: (id: string) => bv.post<{ conversation: ConvCore }>(`/conversations/${cid(id)}/pickup`),
  sendMessage: (id: string, body: { text?: string; attachments?: Attachment[] }) =>
    bv.post<{ message: ChatMessage; delivery: { status: string; error: string | null } }>(`/conversations/${cid(id)}/messages`, body),
  sendNote: (id: string, text: string) => bv.post<{ message: ChatMessage }>(`/conversations/${cid(id)}/notes`, { text }),
  uploadAttachment: (id: string, file: File) => {
    const form = new FormData();
    form.append('file', file, file.name);
    return bv.upload<{ attachment: Attachment }>(`/conversations/${cid(id)}/attachments`, form);
  },
  transfer: (id: string, body: { toUserId?: string; toQueueId?: string; note?: string }) => bv.post<{ conversation: ConvCore }>(`/conversations/${cid(id)}/transfer`, body),
  close: (id: string, reason: string) => bv.post<{ conversation: ConvCore }>(`/conversations/${cid(id)}/close`, { reason }),

  listCanned: () => bv.get<{ items: CannedResponse[] }>('/canned-responses'),
  listQueues: () => bv.get<{ items: QueueRow[] }>('/queues'),
  /** Exige conversation:monitor (supervisão). */
  listAgents: () => bv.get<{ items: AgentRow[] }>('/agents'),
  /** Exige user:manage ou queue:manage; atendente comum recebe 403 (campo some do diálogo). */
  listSectors: () => bv.get<{ items: SectorRow[] }>('/admin/sectors', { active: 'true' }),

  aiSuggest: (conversationId: string) => bv.post<Suggestion>('/ai/suggest', { conversationId }),
  aiSummarize: (conversationId: string) => bv.post<AiSummary>('/ai/summarize', { conversationId }),
  lastSuggestion: (id: string) => bv.get<{ suggestion: StoredSuggestion | null }>(`/ai/conversations/${cid(id)}/suggestion`),

  createTaskFromConversation: (body: Record<string, unknown>) => bv.post<TaskRow>('/tasks/from-conversation', body),
  listTasks: (q: Q) => bv.get<{ items: TaskRow[]; nextCursor: string | null }>('/tasks', q),

  listTemplates: () => bv.get<WaTemplate[]>('/whatsapp/templates', { status: 'APPROVED' }),
  sendTemplate: (body: { conversationId: string; templateName: string; language: string; params?: unknown }) =>
    bv.post<{ conversationId: string; protocol: string; message: { id: string; status: string } }>('/whatsapp/send-template', body),

  getContact: (id: string) => bv.get<ContactDetail>(`/contacts/${cid(id)}`),
  eproc: (numero: string) => bv.get<{ processo: ProcessoResumo }>(`/integrations/eproc/processo/${cid(numero)}`, { movimentos: 'true' }),
  kbSearch: (q: string) => bv.get<{ items: KbHit[] }>('/kb/search', { q, limit: 8 }),
  kbArticle: (id: string) => bv.get<{ id: string; title: string; answer: string }>(`/kb/articles/${cid(id)}`),
};
