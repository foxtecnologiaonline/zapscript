import { ImapFlow, type MailboxLockObject } from 'imapflow';
import { prisma } from '../../../lib/prisma';
import { logger } from '../../../lib/logger';
import { logIntegration, setIntegrationStatus } from '../../core/integrations';
import { loadEmailConfig, ownAddressesOf } from './config';
import { ingestRawEmail } from './inbound';
import { MAX_RAW_BYTES, type EmailConfig, type ImapClientFactory, type ImapConfig, type ImapRawMessage, type ImapSession } from './types';

// ── Adaptador real (imapflow) ────────────────────────────────────────────────

class ImapFlowSession implements ImapSession {
  private lock: MailboxLockObject | null = null;
  constructor(private client: ImapFlow) {}

  async openMailbox(folder: string) {
    this.lock = await this.client.getMailboxLock(folder);
    const mb: any = this.client.mailbox;
    return { uidValidity: BigInt(mb.uidValidity), uidNext: Number(mb.uidNext) };
  }

  async fetchNew(opts: { afterUid: number; limit: number; since?: Date }) {
    const found = opts.since
      ? await this.client.search({ seen: false, since: opts.since }, { uid: true })
      : await this.client.search({ uid: `${opts.afterUid + 1}:*` }, { uid: true });
    const uids = (found || []).filter((u) => u > opts.afterUid).sort((a, b) => a - b);
    const page = uids.slice(0, opts.limit);
    const messages: ImapRawMessage[] = [];
    if (page.length) {
      const sizes = new Map<number, number>();
      for await (const m of this.client.fetch(page.join(','), { uid: true, size: true }, { uid: true })) sizes.set(m.uid, m.size ?? 0);
      for (const uid of page) {
        const size = sizes.get(uid) ?? 0;
        if (size > MAX_RAW_BYTES) { messages.push({ uid, size, raw: null }); continue; }
        const m = await this.client.fetchOne(String(uid), { source: true }, { uid: true });
        if (m && m.source) messages.push({ uid, size: m.source.length, raw: m.source });
      }
    }
    return { messages, hasMore: uids.length > page.length };
  }

  async markSeen(uid: number) { await this.client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true }); }

  async close() {
    try { this.lock?.release(); } catch { /* noop */ }
    try { await this.client.logout(); } catch { try { this.client.close(); } catch { /* noop */ } }
  }
}

export const imapFlowFactory: ImapClientFactory = {
  async connect(cfg: ImapConfig) {
    const client = new ImapFlow({
      host: cfg.host, port: cfg.port, secure: cfg.secure,
      auth: cfg.pass ? { user: cfg.user, pass: cfg.pass } : { user: cfg.user, accessToken: cfg.accessToken },
      logger: false, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 60_000,
    });
    client.on('error', () => undefined); // evita 'unhandled error'; a falha aparece nas chamadas
    await client.connect();
    return new ImapFlowSession(client);
  },
};

// ── Poller ───────────────────────────────────────────────────────────────────

export interface PollResult {
  orgId: string;
  polled: boolean;
  skipped?: 'not_configured' | 'mailbox_disabled' | 'not_due' | 'busy';
  fetched: number;
  ingested: number;
  duplicates: number;
  ignored: number;
  failed: number;
  uidValidityReset?: boolean;
  error?: string;
}

const BATCH = 25;
const MAX_BATCHES = 5;
const MAX_ATTEMPTS = 3;
const FIRST_SYNC_DAYS = 7;

/** Mensagem de erro segura para guardar/exibir (sem credenciais). */
export function safeError(err: any, cfg?: { imap?: { pass?: string; accessToken?: string }; smtp?: { pass?: string; accessToken?: string } }): string {
  let m = String(err?.responseText || err?.message || err || 'erro desconhecido').replace(/\s+/g, ' ');
  for (const s of [cfg?.imap?.pass, cfg?.imap?.accessToken, cfg?.smtp?.pass, cfg?.smtp?.accessToken]) if (s && s.length >= 4) m = m.split(s).join('••••');
  return m.slice(0, 300);
}

export class ImapPoller {
  private inFlight = new Set<string>();
  private attempts = new Map<string, number>();
  constructor(private factory: ImapClientFactory) {}

  setFactory(f: ImapClientFactory) { this.factory = f; }
  getFactory() { return this.factory; }

  /** Garante a linha BvMailbox do órgão (uma ativa por endereço; as demais ficam desabilitadas). */
  async ensureMailbox(orgId: string, cfg: EmailConfig) {
    const address = cfg.from.address.toLowerCase();
    const existing = await prisma.bvMailbox.findUnique({ where: { orgId_address: { orgId, address } } });
    let mb = existing;
    if (!mb) mb = await prisma.bvMailbox.create({ data: { orgId, address, folder: cfg.mailbox } });
    else if (mb.folder !== cfg.mailbox) mb = await prisma.bvMailbox.update({ where: { id: mb.id }, data: { folder: cfg.mailbox, uidValidity: null, lastUid: 0n } });
    await prisma.bvMailbox.updateMany({ where: { orgId, address: { not: address }, enabled: true }, data: { enabled: false } });
    return mb;
  }

  async testImap(cfg: ImapConfig, folder: string): Promise<void> {
    const s = await this.factory.connect(cfg);
    try { await s.openMailbox(folder); } finally { await s.close().catch(() => undefined); }
  }

  /** Coleta e-mails novos da caixa do órgão. `force` ignora o intervalo configurado. */
  async pollOrg(orgId: string, opts: { force?: boolean } = {}): Promise<PollResult> {
    const base: PollResult = { orgId, polled: false, fetched: 0, ingested: 0, duplicates: 0, ignored: 0, failed: 0 };
    if (this.inFlight.has(orgId)) return { ...base, skipped: 'busy' };
    this.inFlight.add(orgId);
    try { return await this.run(orgId, opts, base); } finally { this.inFlight.delete(orgId); }
  }

  private async run(orgId: string, opts: { force?: boolean }, result: PollResult): Promise<PollResult> {
    const loaded = await loadEmailConfig(orgId);
    if (!loaded || !loaded.enabled) return { ...result, skipped: 'not_configured' };
    const cfg = loaded.config;
    const mailbox = await this.ensureMailbox(orgId, cfg);
    if (!mailbox.enabled) return { ...result, skipped: 'mailbox_disabled' };
    if (!opts.force && mailbox.lastPolledAt && Date.now() - mailbox.lastPolledAt.getTime() < cfg.pollIntervalSec * 1000 - 500) return { ...result, skipped: 'not_due' };

    const started = Date.now();
    result.polled = true;
    const ctx = { orgId, ownAddresses: ownAddressesOf(cfg), autoReply: cfg.autoReply, source: 'imap' as const };
    let session: ImapSession | null = null;
    try {
      session = await this.factory.connect(cfg.imap);
      const box = await session.openMailbox(cfg.mailbox);

      let lastUid = Number(mailbox.lastUid);
      let firstSync = mailbox.uidValidity == null;
      if (mailbox.uidValidity != null && mailbox.uidValidity !== box.uidValidity) {
        // UIDs invalidados pelo servidor: recomeça (o dedupe por Message-ID evita duplicar o que já foi ingerido)
        logger.warn({ orgId, old: String(mailbox.uidValidity), new: String(box.uidValidity) }, '[balcao.email] uidValidity mudou — reiniciando controle de UID');
        lastUid = 0; firstSync = true; result.uidValidityReset = true;
      }

      let firstError: string | undefined;
      let barrier = false;
      for (let batch = 0; batch < MAX_BATCHES && !barrier; batch++) {
        const since = firstSync ? new Date(Date.now() - FIRST_SYNC_DAYS * 86400_000) : undefined;
        const { messages, hasMore } = await session.fetchNew({ afterUid: lastUid, limit: BATCH, since });
        result.fetched += messages.length;
        for (const m of messages) {
          const key = `${mailbox.id}:${box.uidValidity}:${m.uid}`;
          try {
            if (!m.raw) {
              result.ignored++; firstError ??= `UID ${m.uid}: mensagem acima do limite (${Math.round(m.size / 1048576)} MB) ignorada`;
            } else {
              const out = await ingestRawEmail(m.raw, ctx);
              if (out.status === 'ingested') result.ingested++;
              else if (out.status === 'duplicate') result.duplicates++;
              else result.ignored++;
              // lido só depois de ingerir com sucesso (duplicata = já ingerida antes)
              if (out.status === 'ingested' || out.status === 'duplicate') await session.markSeen(m.uid).catch((e) => logger.warn({ err: e?.message, uid: m.uid }, '[balcao.email] não foi possível marcar como lido'));
            }
            this.attempts.delete(key);
            if (!barrier) lastUid = Math.max(lastUid, m.uid);
          } catch (err: any) {
            result.failed++;
            const n = (this.attempts.get(key) ?? 0) + 1;
            this.attempts.set(key, n);
            firstError ??= `UID ${m.uid}: ${safeError(err, cfg)}`;
            logger.error({ err: err?.message, orgId, uid: m.uid, attempt: n }, '[balcao.email] falha ao processar mensagem');
            if (n >= MAX_ATTEMPTS) { this.attempts.delete(key); if (!barrier) lastUid = Math.max(lastUid, m.uid); } // desiste da mensagem "venenosa"
            else barrier = true; // não avança além dela: será tentada de novo no próximo ciclo
          }
        }
        if (firstSync && !hasMore && !barrier) lastUid = Math.max(lastUid, box.uidNext - 1);
        firstSync = false;
        if (!hasMore || messages.length === 0) break;
      }

      await prisma.bvMailbox.update({
        where: { id: mailbox.id },
        data: { uidValidity: box.uidValidity, lastUid: BigInt(lastUid), lastPolledAt: new Date(), lastError: firstError ?? null },
      });
      if (!firstError) await setIntegrationStatus(loaded.id, 'OK');
      if (result.fetched > 0) await logIntegration(orgId, 'EMAIL_IMAP', 'imap.poll', result.failed === 0, { durationMs: Date.now() - started, meta: { fetched: result.fetched, ingested: result.ingested, failed: result.failed } });
      if (firstError) result.error = firstError;
    } catch (err: any) {
      const msg = safeError(err, cfg);
      result.error = msg;
      await prisma.bvMailbox.update({ where: { id: mailbox.id }, data: { lastPolledAt: new Date(), lastError: msg } }).catch(() => undefined);
      await setIntegrationStatus(loaded.id, 'ERROR', msg).catch(() => undefined);
      await logIntegration(orgId, 'EMAIL_IMAP', 'imap.poll', false, { durationMs: Date.now() - started, error: msg });
      logger.warn({ orgId, err: msg }, '[balcao.email] falha na coleta IMAP');
    } finally {
      if (session) await session.close().catch(() => undefined);
    }
    return result;
  }
}

export const imapPoller = new ImapPoller(imapFlowFactory);
/** Troca o cliente IMAP (testes). Sem argumento, restaura o imapflow. */
export const setImapClientFactory = (f?: ImapClientFactory) => imapPoller.setFactory(f ?? imapFlowFactory);

/** Job periódico: coleta todos os órgãos com e-mail habilitado cujo intervalo venceu. */
export async function pollAllOrgs(): Promise<void> {
  const rows = await prisma.bvIntegration.findMany({ where: { type: 'EMAIL_IMAP', enabled: true }, select: { orgId: true } });
  const ids = [...new Set(rows.map((r) => r.orgId))];
  for (let i = 0; i < ids.length; i += 5) {
    await Promise.allSettled(ids.slice(i, i + 5).map((id) => imapPoller.pollOrg(id)));
  }
}
