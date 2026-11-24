import type { SendMailOptions } from 'nodemailer';

/** Configuração do canal de e-mail (BvIntegration type 'EMAIL_IMAP', cifrada em repouso). */
export interface ImapConfig { host: string; port: number; secure: boolean; user: string; pass?: string; accessToken?: string }
export interface SmtpConfig { host: string; port: number; secure: boolean; user: string; pass?: string; accessToken?: string }
/** OAuth2 (Google Workspace): o access token é obtido/renovado com o refresh token (ver oauth.ts) e usado em XOAUTH2 (IMAP) e OAuth2 (SMTP). */
export interface OAuth2Auth { type: 'oauth2'; clientId: string; clientSecret: string; refreshToken: string; /** Conta (e-mail) dona do refresh token. */ user: string; /** Padrão: https://oauth2.googleapis.com/token */ tokenUrl?: string }
export interface EmailConfig {
  imap: ImapConfig;
  smtp: SmtpConfig;
  from: { name: string; address: string };
  /** Se `type:'oauth2'`, substitui `pass`/`accessToken` de imap e smtp. */
  auth?: OAuth2Auth;
  mailbox: string;
  autoReply?: { enabled: boolean; text: string };
  pollIntervalSec: number;
  /** Segredo compartilhado do webhook POST /inbound (header X-Inbound-Secret). */
  inboundSecret?: string;
}

export const DEFAULT_POLL_INTERVAL_SEC = 30;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_RAW_BYTES = 40 * 1024 * 1024;

// ── Cliente IMAP (encapsulado: testes injetam um fake) ───────────────────────

export interface ImapRawMessage { uid: number; size: number; /** null = acima do limite (não baixado) */ raw: Buffer | null }

export interface ImapSession {
  openMailbox(folder: string): Promise<{ uidValidity: bigint; uidNext: number }>;
  /**
   * Mensagens com UID > afterUid, em ordem crescente (no máximo `limit`). Com `since` (primeira sincronização),
   * devolve só as NÃO LIDAS recebidas desde essa data — não importa o histórico inteiro da caixa.
   */
  fetchNew(opts: { afterUid: number; limit: number; since?: Date }): Promise<{ messages: ImapRawMessage[]; hasMore: boolean }>;
  markSeen(uid: number): Promise<void>;
  close(): Promise<void>;
}
export interface ImapClientFactory { connect(cfg: ImapConfig): Promise<ImapSession> }

// ── Transporte SMTP (encapsulado: testes injetam um fake) ────────────────────

export interface MailTransport {
  sendMail(msg: SendMailOptions): Promise<{ messageId?: string; accepted?: unknown[]; rejected?: unknown[] }>;
  verify?(): Promise<unknown>;
  close?(): void;
}
export type MailTransportFactory = (cfg: SmtpConfig) => MailTransport;
