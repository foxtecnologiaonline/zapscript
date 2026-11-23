import path from 'path';
import { prisma } from '../../../lib/prisma';
import { logger } from '../../../lib/logger';
import { ingestInbound } from '../../core/conversations';
import { getOrgSettings } from '../../core/settings';
import { recordUsage } from '../../core/usage';
import { getIntegration, logIntegration } from '../../core/integrations';
import { newKey, putObject } from '../../core/storage';
import { emitToConversation } from '../../core/realtime';
import { sha256Hex } from '../../core/crypto';
import type { Attachment } from '../../core/messages';
import type { MessageKind } from '../../core/types';
import { findByPhoneNumberId, findByWabaId } from './config';
import { apiBaseOf, graphCall, GraphError, isMock, mapGraphErrorCode, waRuntime, type WaConfig } from './graph';

/**
 * Pipeline de entrada: payload da Meta → ingestInbound / status / templates. Usado pelo webhook HTTP e pelo simulador.
 * Regras: idempotente por wamid; nunca loga conteúdo de mensagem; mídia é baixada em segundo plano (com reprocesso por job).
 */

// ── Segundo plano rastreável (permite aos testes aguardar) ───────────────────
const inflight = new Set<Promise<unknown>>();
function track<T>(p: Promise<T>): void { inflight.add(p); void p.finally(() => inflight.delete(p)).catch(() => undefined); }
export async function drainWhatsappBackground(): Promise<void> {
  while (inflight.size) await Promise.allSettled([...inflight]);
}

// ── Tipos mínimos do payload da Meta ─────────────────────────────────────────
export interface WaChange { field: string; value: any }
export interface WaPayload { object?: string; entry?: Array<{ id?: string; changes?: WaChange[] }> }
export interface ResolvedChange { orgId: string; config: WaConfig; field: string; value: any }

const RANK: Record<string, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3 };
const MAX_MEDIA_BYTES = 100 * 1024 * 1024;
const MEDIA_MAX_ATTEMPTS = 5;

/** Associa cada change do payload a um órgão (messages → phone_number_id; templates → wabaId). Desconhecidos são descartados. */
export async function resolveChanges(payload: WaPayload): Promise<ResolvedChange[]> {
  const out: ResolvedChange[] = [];
  for (const entry of payload?.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      const value = ch?.value ?? {};
      const phoneId = value?.metadata?.phone_number_id;
      const row = ch.field === 'messages' && phoneId ? await findByPhoneNumberId(String(phoneId)) : entry.id ? await findByWabaId(String(entry.id)) : null;
      if (row) out.push({ orgId: row.orgId, config: row.config, field: ch.field, value });
    }
  }
  return out;
}

export interface ProcessResult { messages: number; duplicates: number; statuses: number; failed: number }

/** Processa as changes de UM órgão. Erros por item são contados (e logados sem conteúdo) — o chamador decide o HTTP. */
export async function processChanges(orgId: string, config: WaConfig, changes: Array<{ field: string; value: any }>): Promise<ProcessResult> {
  const res: ProcessResult = { messages: 0, duplicates: 0, statuses: 0, failed: 0 };
  for (const ch of changes) {
    try {
      if (ch.field === 'messages') {
        const v = ch.value ?? {};
        const names = new Map<string, string>();
        for (const c of v.contacts ?? []) if (c?.wa_id) names.set(String(c.wa_id), c.profile?.name);
        for (const m of v.messages ?? []) {
          try {
            const r = await handleInboundMessage(orgId, config, m, names.get(String(m.from)));
            if (r === 'dup') res.duplicates++; else if (r === 'ok') res.messages++;
          } catch (err: any) {
            res.failed++;
            logger.error({ orgId, wamid: m?.id, err: err?.message }, '[balcao/whatsapp] falha ao ingerir mensagem');
          }
        }
        for (const s of v.statuses ?? []) {
          try { await handleStatus(orgId, s); res.statuses++; } catch (err: any) {
            res.failed++;
            logger.error({ orgId, wamid: s?.id, err: err?.message }, '[balcao/whatsapp] falha ao processar status');
          }
        }
      } else if (ch.field === 'message_template_status_update' || ch.field === 'template_category_update' || ch.field === 'message_template_quality_update') {
        await handleTemplateUpdate(orgId, ch.field, ch.value ?? {});
      }
    } catch (err: any) {
      res.failed++;
      logger.error({ orgId, field: ch.field, err: err?.message }, '[balcao/whatsapp] falha ao processar change');
    }
  }
  return res;
}

// ── Mensagens ────────────────────────────────────────────────────────────────
interface Mapped { kind: MessageKind; body: string | null; wa: Record<string, unknown>; media?: { id: string; mime?: string; sha256?: string; filename?: string } }

export function mapInboundMessage(m: any): Mapped | 'ignore' {
  const type = String(m?.type ?? '');
  const wa: Record<string, unknown> = { type };
  if (m?.context?.id) wa.replyTo = m.context.id;
  if (m?.referral) wa.referral = { sourceType: m.referral.source_type, sourceId: m.referral.source_id };
  switch (type) {
    case 'text': return { kind: 'TEXT', body: String(m.text?.body ?? ''), wa };
    case 'image': case 'audio': case 'video': case 'document': case 'sticker': {
      const o = m[type] ?? {};
      if (!o.id) return { kind: 'TEXT', body: '[Mídia indisponível]', wa };
      const kind: MessageKind = type === 'sticker' ? 'IMAGE' : (type.toUpperCase() as MessageKind);
      if (type === 'audio' && o.voice) wa.voice = true;
      return { kind, body: o.caption ? String(o.caption) : null, wa, media: { id: String(o.id), mime: o.mime_type, sha256: o.sha256, filename: o.filename } };
    }
    case 'location': {
      const l = m.location ?? {};
      wa.location = { latitude: l.latitude, longitude: l.longitude, name: l.name, address: l.address };
      const label = [l.name, l.address].filter(Boolean).join(' — ');
      return { kind: 'TEXT', body: `Localização compartilhada${label ? `: ${label}` : ''} (${l.latitude}, ${l.longitude})`, wa };
    }
    case 'interactive': {
      const i = m.interactive ?? {};
      const r = i.button_reply ?? i.list_reply ?? {};
      wa.interactive = { type: i.type, id: r.id, title: r.title, description: r.description };
      return { kind: 'TEXT', body: String(r.title ?? ''), wa };
    }
    case 'button': // resposta rápida de template
      wa.button = { payload: m.button?.payload };
      return { kind: 'TEXT', body: String(m.button?.text ?? m.button?.payload ?? ''), wa };
    case 'contacts': {
      const names = (m.contacts ?? []).map((c: any) => c?.name?.formatted_name).filter(Boolean).join(', ');
      return { kind: 'TEXT', body: `Contato compartilhado${names ? `: ${names}` : ''}`, wa };
    }
    case 'reaction': case 'system': case 'request_welcome': return 'ignore';
    default: return { kind: 'TEXT', body: '[Mensagem não suportada pelo atendimento]', wa };
  }
}

async function handleInboundMessage(orgId: string, config: WaConfig, m: any, profileName?: string): Promise<'ok' | 'dup' | 'ignored'> {
  if (!m?.id || !m?.from) return 'ignored';
  const mapped = mapInboundMessage(m);
  if (mapped === 'ignore') return 'ignored';
  const from = String(m.from);
  const ts = Number(m.timestamp);
  const createdAt = Number.isFinite(ts) && ts > 0 && ts * 1000 <= Date.now() ? new Date(ts * 1000) : undefined;
  const wa: Record<string, unknown> = { ...mapped.wa };
  if (mapped.media) Object.assign(wa, { mediaId: mapped.media.id, mimeType: mapped.media.mime, mediaSha256: mapped.media.sha256, filename: mapped.media.filename, mediaStatus: 'PENDING', mediaAttempts: 0 });

  const r = await ingestInbound({
    orgId, channel: 'WHATSAPP', channelRef: from, externalId: from, name: profileName ?? null, phone: from,
    message: { kind: mapped.kind, body: mapped.body, attachments: [], channelMessageId: String(m.id), channelMeta: { wa }, createdAt },
  });
  if (r.duplicate) return 'dup';

  try { await registerServiceWindow(orgId, r.conversation.id, r.contactId); } catch (err: any) {
    logger.error({ orgId, err: err?.message }, '[balcao/whatsapp] falha ao registrar janela de serviço');
  }
  if (mapped.media && r.message) {
    const messageId = r.message.id;
    track(fetchInboundMedia(orgId, messageId, config).catch((err) => logger.warn({ orgId, err: err?.message }, '[balcao/whatsapp] mídia pendente (será reprocessada)')));
  }
  return 'ok';
}

/**
 * Conta 1 × WA_SERVICE por abertura de janela de atendimento (bloco fixo de `windowHours` a partir da 1ª mensagem do cidadão),
 * e não por mensagem. Marcador em `conversation.metadata.whatsapp.windowOpenedAt`, reivindicado de forma atômica (SQL).
 * Se o mesmo contato já abriu janela em outra conversa dentro do período, não conta de novo.
 */
export async function registerServiceWindow(orgId: string, conversationId: string, contactId: string, now = new Date()): Promise<boolean> {
  const hours = (await getOrgSettings(orgId)).whatsapp.windowHours;
  const threshold = new Date(now.getTime() - hours * 3600_000).toISOString();
  const nowIso = now.toISOString();
  const claimed = await prisma.$executeRaw`
    UPDATE "BvConversation"
       SET "metadata" = jsonb_set(COALESCE("metadata", '{}'::jsonb), '{whatsapp}',
             COALESCE("metadata"->'whatsapp', '{}'::jsonb) || jsonb_build_object('windowOpenedAt', ${nowIso}::text), true)
     WHERE "id" = ${conversationId} AND "orgId" = ${orgId}
       AND ( ("metadata"->'whatsapp'->>'windowOpenedAt') IS NULL
          OR ("metadata"->'whatsapp'->>'windowOpenedAt')::timestamptz <= ${threshold}::timestamptz )`;
  if (claimed < 1) return false;
  const other = await prisma.$queryRaw<Array<{ one: number }>>`
    SELECT 1 AS one FROM "BvConversation"
     WHERE "orgId" = ${orgId} AND "contactId" = ${contactId} AND "channel" = 'WHATSAPP' AND "id" <> ${conversationId}
       AND ("metadata"->'whatsapp'->>'windowOpenedAt') IS NOT NULL
       AND ("metadata"->'whatsapp'->>'windowOpenedAt')::timestamptz > ${threshold}::timestamptz LIMIT 1`;
  if (other.length) return false;
  await recordUsage(orgId, 'WA_SERVICE', 1, now);
  return true;
}

// ── Mídia de entrada ─────────────────────────────────────────────────────────
const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/aac': 'aac', 'audio/amr': 'amr',
  'audio/mp4': 'm4a', 'video/mp4': 'mp4', 'video/3gpp': '3gp', 'application/pdf': 'pdf',
  'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'text/plain': 'txt',
};
const TRUSTED_MEDIA_HOST = /(^|\.)(fbsbx\.com|facebook\.com|fbcdn\.net|whatsapp\.net|whatsapp\.com)$/i;

/** O URL de download vem da Graph: só seguimos hosts da Meta (ou a base local de teste/dev) — evita SSRF. */
export function trustedMediaUrl(url: string, cfg: WaConfig): boolean {
  try {
    const u = new URL(url);
    const base = apiBaseOf(cfg);
    if (base !== 'https://graph.facebook.com' && u.origin === new URL(base).origin) return true;
    return u.protocol === 'https:' && TRUSTED_MEDIA_HOST.test(u.hostname);
  } catch { return false; }
}

const safeName = (n: string): string => path.basename(n).replace(/[^\w.\- ()]/g, '_').slice(0, 120) || 'arquivo';

/** Baixa a mídia (media id → url → bytes), grava no storage e preenche attachments. Atualiza channelMeta.wa.mediaStatus. */
export async function fetchInboundMedia(orgId: string, messageId: string, cfg?: WaConfig): Promise<'STORED' | 'PENDING' | 'FAILED'> {
  const row = await prisma.bvMessage.findFirst({ where: { id: messageId, orgId } });
  if (!row) return 'FAILED';
  const meta = (row.channelMeta ?? {}) as any;
  const wa = { ...(meta.wa ?? {}) } as Record<string, any>;
  if (wa.mediaStatus === 'STORED' || !wa.mediaId) return 'STORED';
  const config = cfg ?? (await getIntegration<WaConfig>(orgId, 'WHATSAPP'))?.config;
  const save = (patch: Record<string, unknown>, attachments?: Attachment[]) => prisma.bvMessage.update({
    where: { id: row.id },
    data: { channelMeta: { ...meta, wa: { ...wa, ...patch } } as any, ...(attachments ? { attachments: attachments as any } : {}) },
  });
  const attempts = Number(wa.mediaAttempts ?? 0) + 1;
  try {
    if (!config) throw new GraphError('Integração ausente', 'whatsapp.not_configured', 0, null, false);
    if (isMock(config)) { await save({ mediaStatus: 'FAILED', mediaError: 'whatsapp.mock_no_media', mediaAttempts: attempts }); return 'FAILED'; }
    const info = await graphCall<{ url?: string; mime_type?: string; sha256?: string; file_size?: number }>(config, { method: 'GET', path: String(wa.mediaId) });
    if (!info?.url || !trustedMediaUrl(info.url, config)) throw new GraphError('URL de mídia não confiável', 'whatsapp.media_error', 0, null, false);
    if (info.file_size && info.file_size > MAX_MEDIA_BYTES) throw new GraphError('Mídia acima do limite', 'whatsapp.media_too_large', 0, null, false);
    const bytes = await graphCall<Buffer>(config, { method: 'GET', path: '', absoluteUrl: info.url, binary: true });
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes as any);
    if (buf.length > MAX_MEDIA_BYTES) throw new GraphError('Mídia acima do limite', 'whatsapp.media_too_large', 0, null, false);
    const digest = sha256Hex(buf);
    const expected = String(info.sha256 ?? wa.mediaSha256 ?? '');
    if (/^[0-9a-f]{64}$/i.test(expected) && expected.toLowerCase() !== digest) throw new GraphError('sha256 da mídia não confere', 'whatsapp.media_error', 0, null, true);
    const mime = String(info.mime_type ?? wa.mimeType ?? 'application/octet-stream').split(';')[0].trim();
    const ext = EXT[mime] ?? (wa.filename ? path.extname(String(wa.filename)).slice(1) : '') ?? 'bin';
    const stored = await putObject(newKey(orgId, 'attachments', ext || 'bin'), buf);
    const name = wa.filename ? safeName(String(wa.filename)) : `${String(row.kind).toLowerCase()}-${String(row.channelMessageId ?? row.id).slice(-8).replace(/[^\w]/g, '')}.${ext || 'bin'}`;
    const att: Attachment = { key: stored.key, name, mime, size: stored.size, sha256: stored.sha256 };
    await save({ mediaStatus: 'STORED', mediaAttempts: attempts, mimeType: mime }, [att]);
    emitToConversation(row.conversationId, 'message:attachments', { conversationId: row.conversationId, messageId: row.id, attachments: [att] });
    return 'STORED';
  } catch (e: any) {
    const permanent = e instanceof GraphError ? !e.retryable : false;
    const failed = permanent || attempts >= MEDIA_MAX_ATTEMPTS;
    const code = e instanceof GraphError ? e.errorCode : 'whatsapp.media_error';
    await save({ mediaStatus: failed ? 'FAILED' : 'PENDING', mediaAttempts: attempts, mediaError: code }).catch(() => undefined);
    void logIntegration(orgId, 'WHATSAPP', 'media.download', false, { error: code });
    if (failed) return 'FAILED';
    throw e;
  }
}

/** Job: reprocessa mídias que ficaram PENDING (Graph fora do ar, etc.). */
export async function retryPendingMedia(limit = 50): Promise<number> {
  const rows = await prisma.bvMessage.findMany({
    where: { direction: 'IN', createdAt: { gt: new Date(Date.now() - 7 * 86400_000) }, channelMeta: { path: ['wa', 'mediaStatus'], equals: 'PENDING' } },
    orderBy: { createdAt: 'asc' }, take: limit, select: { id: true, orgId: true },
  });
  let ok = 0;
  for (const r of rows) {
    try { if ((await fetchInboundMedia(r.orgId, r.id)) === 'STORED') ok++; } catch { /* tenta de novo no próximo ciclo */ }
  }
  return ok;
}

// ── Status de entrega ────────────────────────────────────────────────────────
export function statusErrorCode(errors: any): string {
  const e = Array.isArray(errors) ? errors[0] : null;
  return e ? mapGraphErrorCode(typeof e.code === 'number' ? e.code : Number(e.code) || null) : 'whatsapp.send_failed';
}

async function applyStatus(orgId: string, s: any): Promise<boolean> {
  const row = await prisma.bvMessage.findFirst({ where: { orgId, channelMessageId: String(s.id) } });
  if (!row) return false;
  const next = String(s.status ?? '').toUpperCase();
  const cur = String(row.status);
  const meta = (row.channelMeta ?? {}) as any;
  const wa: Record<string, any> = { ...(meta.wa ?? {}) };
  if (s.pricing?.category) wa.billedCategory = s.pricing.category;
  if (typeof s.pricing?.billable === 'boolean') wa.billable = s.pricing.billable;
  if (s.conversation?.origin?.type) wa.conversationOrigin = s.conversation.origin.type;
  const data: Record<string, unknown> = { channelMeta: { ...meta, wa } };
  if (next === 'FAILED') {
    if ((RANK[cur] ?? 0) >= RANK.DELIVERED) return true; // já entregue: falha tardia é ignorada
    const code = statusErrorCode(s.errors);
    data.status = 'FAILED'; data.errorCode = code;
    const e = Array.isArray(s.errors) ? s.errors[0] : null;
    if (e) wa.error = { code: e.code, title: String(e.title ?? '').slice(0, 200) };
  } else if (next in RANK && next !== 'QUEUED') {
    if (cur === 'FAILED' || (RANK[cur] ?? 0) >= RANK[next]) { await prisma.bvMessage.update({ where: { id: row.id }, data: { channelMeta: data.channelMeta as any } }); return true; }
    data.status = next;
  } else return true; // "deleted", "warning"…
  await prisma.bvMessage.update({ where: { id: row.id }, data: data as any });
  emitToConversation(row.conversationId, 'message:status', { conversationId: row.conversationId, messageId: row.id, status: data.status ?? cur, errorCode: data.errorCode ?? null });
  return true;
}

/** O status pode chegar antes de o sendMessage gravar o wamid: se não achou, tenta de novo em segundo plano. */
async function handleStatus(orgId: string, s: any): Promise<void> {
  if (!s?.id) return;
  if (await applyStatus(orgId, s)) return;
  const delays = [...waRuntime.statusRetryDelaysMs];
  if (!delays.length) return;
  track((async () => {
    for (const d of delays) {
      await waRuntime.sleep(d);
      if (await applyStatus(orgId, s).catch(() => false)) return;
    }
  })());
}

// ── Templates (webhooks de aprovação) ────────────────────────────────────────
async function handleTemplateUpdate(orgId: string, field: string, v: any): Promise<void> {
  const name = v.message_template_name ?? v.template_name;
  const language = v.message_template_language ?? v.template_language;
  if (!name) return;
  const where = { orgId, name: String(name), ...(language ? { language: String(language) } : {}) };
  if (field === 'message_template_status_update') {
    const status = String(v.event ?? '').toUpperCase();
    if (!status) return;
    const reason = v.reason && String(v.reason).toUpperCase() !== 'NONE' ? String(v.reason) : null;
    await prisma.bvWaTemplate.updateMany({ where, data: { status, rejectedReason: status === 'REJECTED' || status === 'DISABLED' ? reason : null, ...(v.message_template_id ? { metaTemplateId: String(v.message_template_id) } : {}) } });
  } else if (field === 'template_category_update' && v.new_category) {
    await prisma.bvWaTemplate.updateMany({ where, data: { category: String(v.new_category).toUpperCase() } });
  }
}
