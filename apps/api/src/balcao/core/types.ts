/** Constantes e tipos compartilhados do Balcão Virtual. Strings (e não enums Prisma) por convenção do repo. */

export const CHANNELS = ['WHATSAPP', 'WEBCHAT', 'EMAIL', 'VOICE'] as const;
export type Channel = (typeof CHANNELS)[number];

export const ROLES = ['ATENDENTE', 'SUPERVISOR', 'ADMIN', 'FISCAL'] as const;
export type Role = (typeof ROLES)[number];

export type ConversationStatus = 'BOT' | 'WAITING' | 'ACTIVE' | 'CLOSED';
export type MessageDirection = 'IN' | 'OUT' | 'INTERNAL';
export type SenderType = 'CONTACT' | 'BOT' | 'AGENT' | 'SYSTEM';
export type MessageKind = 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO' | 'DOCUMENT' | 'TEMPLATE' | 'NOTE' | 'EVENT';
export type Presence = 'OFFLINE' | 'ONLINE' | 'AWAY' | 'BUSY';

export const CLOSE_REASONS = ['RESOLVED', 'ABANDONED', 'TRANSFERRED_OUT', 'SPAM', 'TIMEOUT'] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number];

export const CONTACT_CATEGORIES = ['CIDADAO', 'ADVOGADO', 'SERVIDOR', 'MP', 'DEFENSORIA', 'OUTRO'] as const;

/** Itens de consumo (painel do fiscal). Mapeiam os itens 7–11 do TR (+ extras de operação). */
export const USAGE_ITEMS = [
  'WA_SERVICE', // item 7 — conversas de serviço (iniciadas pelo cidadão)
  'WA_UTILITY', // item 8 — utilidade
  'WA_MARKETING', // item 9 — marketing
  'STORAGE_BYTES', // item 10 — gauge
  'VOICE_MINUTES', // item 11 — minutos de voz
  'VOICE_PEAK_CHANNELS', // item 11 — pico de canais simultâneos (gauge)
  'EMAIL_IN',
  'EMAIL_OUT',
  'WEBCHAT_MSG',
  'AI_CALLS',
  'AI_TOKENS',
] as const;
export type UsageItem = (typeof USAGE_ITEMS)[number];
export const GAUGE_ITEMS: UsageItem[] = ['STORAGE_BYTES', 'VOICE_PEAK_CHANNELS'];

export type IntegrationType =
  | 'WHATSAPP'
  | 'EMAIL_IMAP'
  | 'SIP_TRUNK'
  | 'EPROC'
  | 'GOVBR'
  | 'OIDC_TJTO'
  | 'GOOGLE_WORKSPACE'
  | 'JIRA'
  | 'URA_0800'
  | 'LLM';

/** Contexto autenticado anexado a `req.bv` pelo preHandler `bvAuth`. */
export interface BvAuthContext {
  userId: string;
  orgId: string;
  role: Role;
  name: string;
  email: string;
  sessionId?: string;
  via: 'jwt' | 'api-token';
  scopes?: string[];
}
