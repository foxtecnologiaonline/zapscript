import { z } from 'zod';
import { getIntegration } from '../../core/integrations';
import { DEFAULT_POLL_INTERVAL_SEC, type EmailConfig } from './types';

export const SECRET_PLACEHOLDER = '••••••';

const conn = z.object({
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  user: z.string().trim().min(1).max(320),
  pass: z.string().max(1000).optional(),
  accessToken: z.string().max(4000).optional(),
});

/** Entrada do PUT /config (segredos opcionais: omitidos ou "••••••" preservam o valor salvo). */
export const emailConfigInput = z.object({
  imap: conn,
  smtp: conn,
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

/** Retorna problemas de credencial (IMAP/SMTP precisam de senha OU token). */
export function credentialProblems(c: EmailConfigInput): string[] {
  const p: string[] = [];
  if (!c.imap.pass && !c.imap.accessToken) p.push('imap: informe pass (senha de app) ou accessToken');
  if (!c.smtp.pass && !c.smtp.accessToken) p.push('smtp: informe pass (senha de app) ou accessToken');
  return p;
}

/** Aplica padrões. Retorna null se a config salva está incompleta/inválida. */
export function normalizeConfig(raw: unknown): EmailConfig | null {
  const r = emailConfigInput.safeParse(raw);
  if (!r.success) return null;
  const c = r.data;
  return {
    imap: c.imap, smtp: c.smtp,
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
  for (const u of [cfg.imap.user, cfg.smtp.user]) if (u.includes('@')) set.add(u.toLowerCase());
  return [...set];
}
