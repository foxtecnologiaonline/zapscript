import { z } from 'zod';
import { getIntegration, maskSecrets } from '../../core/integrations';
import { assertTokenUrl } from './oauth';
import { DEFAULT_POLL_INTERVAL_SEC, type EmailConfig, type OAuth2Auth } from './types';

export const SECRET_PLACEHOLDER = '••••••';

const conn = z.object({
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  /** Com `auth.type='oauth2'` pode ser omitido (usa `auth.user`). */
  user: z.string().trim().min(1).max(320).optional(),
  pass: z.string().max(1000).optional(),
  accessToken: z.string().max(4000).optional(),
});

/** OAuth2 (Google Workspace). `clientSecret`/`refreshToken`/`tokenUrl` omitidos ou "••••••" preservam o valor salvo. */
const oauth2 = z.object({
  type: z.literal('oauth2'),
  clientId: z.string().trim().min(1).max(300),
  clientSecret: z.string().max(500).optional(),
  refreshToken: z.string().max(2000).optional(),
  user: z.string().trim().email().max(320),
  tokenUrl: z.string().trim().max(500).optional(),
});

/** Entrada do PUT /config (segredos opcionais: omitidos ou "••••••" preservam o valor salvo). */
export const emailConfigInput = z.object({
  imap: conn,
  smtp: conn,
  auth: oauth2.optional(),
  from: z.object({ name: z.string().trim().max(120).default(''), address: z.string().trim().email().max(320) }),
  mailbox: z.string().trim().min(1).max(200).optional(),
  autoReply: z.object({ enabled: z.boolean(), text: z.string().max(2000).default('') }).optional(),
  pollIntervalSec: z.number().int().min(10).max(3600).optional(),
  inboundSecret: z.string().min(16).max(200).optional(),
});
export type EmailConfigInput = z.infer<typeof emailConfigInput>;

const keep = (v: string | undefined) => v === undefined || v === '' || v === SECRET_PLACEHOLDER;

/** Mescla a entrada com a config salva, preservando segredos não reenviados. */
export function mergeConfig(input: EmailConfigInput, existing?: Partial<EmailConfig> | null): EmailConfigInput {
  const out: EmailConfigInput = JSON.parse(JSON.stringify(input));
  if (out.auth?.type === 'oauth2') {
    const prev = existing?.auth?.type === 'oauth2' ? existing.auth : undefined;
    const sameClient = !!prev && prev.clientId === out.auth.clientId;
    const sameAccount = sameClient && prev!.user === out.auth.user; // refresh token pertence à conta: outra conta exige reenviar
    if (keep(out.auth.clientSecret)) { if (sameClient && prev?.clientSecret) out.auth.clientSecret = prev.clientSecret; else delete out.auth.clientSecret; }
    if (keep(out.auth.refreshToken)) { if (sameAccount && prev?.refreshToken) out.auth.refreshToken = prev.refreshToken; else delete out.auth.refreshToken; }
    if (out.auth.tokenUrl === SECRET_PLACEHOLDER) { if (prev?.tokenUrl) out.auth.tokenUrl = prev.tokenUrl; else delete out.auth.tokenUrl; }
    if (!out.auth.tokenUrl) delete out.auth.tokenUrl;
    // OAuth2 substitui senha/token estático: não guardamos credenciais que não serão usadas
    for (const k of ['imap', 'smtp'] as const) { out[k].user = out[k].user || out.auth.user; delete out[k].pass; delete out[k].accessToken; }
    if (keep(out.inboundSecret)) { if (existing?.inboundSecret) out.inboundSecret = existing.inboundSecret; else delete out.inboundSecret; }
    return out;
  }
  for (const k of ['imap', 'smtp'] as const) {
    const prev = existing?.[k];
    // Mesmo servidor/usuário → herda a senha/token salvos; se mudou o usuário, exige reenviar.
    const sameUser = prev && prev.user === out[k].user;
    if (keep(out[k].pass)) { if (sameUser && prev?.pass) out[k].pass = prev.pass; else delete out[k].pass; }
    if (keep(out[k].accessToken)) { if (sameUser && prev?.accessToken) out[k].accessToken = prev.accessToken; else delete out[k].accessToken; }
  }
  if (keep(out.inboundSecret)) { if (existing?.inboundSecret) out.inboundSecret = existing.inboundSecret; else delete out.inboundSecret; }
  return out;
}

/** Retorna problemas de credencial (IMAP/SMTP precisam de senha, token OU OAuth2 completo). */
export function credentialProblems(c: EmailConfigInput): string[] {
  const p: string[] = [];
  if (c.auth?.type === 'oauth2') {
    if (!c.auth.clientSecret) p.push('auth: informe clientSecret');
    if (!c.auth.refreshToken) p.push('auth: informe refreshToken');
    if (c.auth.tokenUrl) { try { assertTokenUrl(c.auth.tokenUrl); } catch (e: any) { p.push(`auth.tokenUrl: ${e.message}`); } }
    return p;
  }
  for (const k of ['imap', 'smtp'] as const) {
    if (!c[k].user) p.push(`${k}: informe user`);
    if (!c[k].pass && !c[k].accessToken) p.push(`${k}: informe pass (senha de app) ou accessToken`);
  }
  return p;
}

/** Config com segredos mascarados (clientSecret, refreshToken, senhas, tokens). `auth.tokenUrl` não é segredo e permanece legível. */
export function maskEmailConfig(cfg: Record<string, any>): Record<string, any> {
  const m = maskSecrets(cfg);
  if (m.auth && typeof cfg.auth?.tokenUrl === 'string') m.auth.tokenUrl = cfg.auth.tokenUrl;
  return m;
}

/** Aplica padrões. Retorna null se a config salva está incompleta/inválida. */
export function normalizeConfig(raw: unknown): EmailConfig | null {
  const r = emailConfigInput.safeParse(raw);
  if (!r.success) return null;
  const c = r.data;
  let auth: OAuth2Auth | undefined;
  if (c.auth) {
    if (!c.auth.clientSecret || !c.auth.refreshToken) return null;
    auth = { type: 'oauth2', clientId: c.auth.clientId, clientSecret: c.auth.clientSecret, refreshToken: c.auth.refreshToken, user: c.auth.user, ...(c.auth.tokenUrl ? { tokenUrl: c.auth.tokenUrl } : {}) };
  }
  const imapUser = c.imap.user ?? auth?.user; const smtpUser = c.smtp.user ?? auth?.user;
  if (!imapUser || !smtpUser) return null;
  return {
    imap: { ...c.imap, user: imapUser }, smtp: { ...c.smtp, user: smtpUser }, ...(auth ? { auth } : {}),
    from: { name: c.from.name, address: c.from.address.toLowerCase() },
    mailbox: c.mailbox ?? 'INBOX',
    autoReply: c.autoReply,
    pollIntervalSec: c.pollIntervalSec ?? DEFAULT_POLL_INTERVAL_SEC,
    inboundSecret: c.inboundSecret,
  };
}

export async function loadEmailConfig(orgId: string): Promise<{ id: string; enabled: boolean; config: EmailConfig } | null> {
  const row = await getIntegration<Record<string, unknown>>(orgId, 'EMAIL_IMAP');
  if (!row) return null;
  const config = normalizeConfig(row.config);
  return config ? { id: row.id, enabled: row.enabled, config } : null;
}

/** Endereços que pertencem ao próprio órgão (anti-loop). */
export function ownAddressesOf(cfg: EmailConfig | null): string[] {
  if (!cfg) return [];
  const set = new Set<string>([cfg.from.address.toLowerCase()]);
  for (const u of [cfg.imap.user, cfg.smtp.user, cfg.auth?.user ?? '']) if (u.includes('@')) set.add(u.toLowerCase());
  return [...set];
}
