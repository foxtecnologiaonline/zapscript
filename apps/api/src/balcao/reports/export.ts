import { prisma } from '../../lib/prisma';
import type { CsvColumn } from './util';

/**
 * Exportação para BI (Power BI / Metabase): leitura paginada por cursor (keyset), sem conteúdo de mensagens
 * e sem PII além de ids/códigos (não exporta nomes, telefones, e-mails, assunto, comentário de NPS, números de chamada).
 */
export const DATASETS = ['conversations', 'messages-meta', 'calls', 'tasks', 'nps'] as const;
export type Dataset = (typeof DATASETS)[number];

export interface ExportPage { columns: CsvColumn[]; rows: Array<Record<string, unknown>>; nextCursor: string | null }
export class CursorError extends Error {}

export const encodeCursor = (t: Date, id: string) => Buffer.from(JSON.stringify({ t: t.toISOString(), id })).toString('base64url');
export function decodeCursor(c?: string): { t: Date; id: string } | null {
  if (!c) return null;
  try { const o = JSON.parse(Buffer.from(c, 'base64url').toString('utf8')); const t = new Date(o.t); if (!o.id || typeof o.id !== 'string' || Number.isNaN(t.getTime())) throw 0; return { t, id: o.id }; } catch { throw new CursorError('cursor inválido'); }
}

const cols = (...keys: string[]): CsvColumn[] => keys.map((k) => ({ key: k, label: k }));
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Paginação keyset genérica por (campo de data, id). */
function keyset(field: string, cur: { t: Date; id: string } | null) {
  return cur ? { OR: [{ [field]: { gt: cur.t } }, { [field]: cur.t, id: { gt: cur.id } }] } : {};
}

export async function exportPage(orgId: string, dataset: Dataset, range: { from: Date; to: Date }, cursor: string | undefined, limit: number): Promise<ExportPage> {
  const cur = decodeCursor(cursor);
  const take = limit + 1;
  const order = (f: string) => [{ [f]: 'asc' as const }, { id: 'asc' as const }];
  const finish = <T extends { id: string }>(rows: T[], tf: (r: T) => Date, map: (r: T) => Record<string, unknown>, columns: CsvColumn[]): ExportPage => {
    const more = rows.length > limit;
    const page = more ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return { columns, rows: page.map(map), nextCursor: more && last ? encodeCursor(tf(last), last.id) : null };
  };

  if (dataset === 'conversations' || dataset === 'nps') {
    const nps = dataset === 'nps';
    const rows = await prisma.bvConversation.findMany({
      where: { orgId, startedAt: { gte: range.from, lt: range.to }, ...(nps ? { csatScore: { not: null } } : {}), ...keyset('startedAt', cur) },
      orderBy: order('startedAt'), take,
      select: { id: true, protocol: true, channel: true, contactId: true, queueId: true, assignedUserId: true, status: true, category: true, intent: true, closeReason: true, startedAt: true, queuedAt: true, assignedAt: true, firstResponseAt: true, closedAt: true, botHandled: true, resolvedByBot: true, firstContactResolved: true, automatable: true, slaBreached: true, slaFirstResponseDueAt: true, slaResolutionDueAt: true, csatScore: true, csatAt: true, transferCount: true },
    });
    if (nps) return finish(rows, (r) => r.startedAt, (r) => ({ id: r.id, protocol: r.protocol, channel: r.channel, queueId: r.queueId, agentId: r.assignedUserId, category: r.category, startedAt: iso(r.startedAt), csatScore: r.csatScore, csatAt: iso(r.csatAt), npsClass: r.csatScore! >= 9 ? 'PROMOTER' : r.csatScore! >= 7 ? 'PASSIVE' : 'DETRACTOR' }), cols('id', 'protocol', 'channel', 'queueId', 'agentId', 'category', 'startedAt', 'csatScore', 'csatAt', 'npsClass'));
    return finish(rows, (r) => r.startedAt, (r) => ({
      id: r.id, protocol: r.protocol, channel: r.channel, contactId: r.contactId, queueId: r.queueId, agentId: r.assignedUserId, status: r.status, category: r.category, intent: r.intent,
      closeReason: r.closeReason, startedAt: iso(r.startedAt), queuedAt: iso(r.queuedAt), assignedAt: iso(r.assignedAt), firstResponseAt: iso(r.firstResponseAt), closedAt: iso(r.closedAt),
      tmeSec: r.firstResponseAt ? Math.max(0, (r.firstResponseAt.getTime() - r.startedAt.getTime()) / 1000) : null,
      tmaSec: r.closedAt && r.assignedAt ? Math.max(0, (r.closedAt.getTime() - r.assignedAt.getTime()) / 1000) : null,
      botHandled: r.botHandled, resolvedByBot: r.resolvedByBot, firstContactResolved: r.firstContactResolved, automatable: r.automatable, slaBreached: r.slaBreached,
      slaFirstResponseDueAt: iso(r.slaFirstResponseDueAt), slaResolutionDueAt: iso(r.slaResolutionDueAt), csatScore: r.csatScore, csatAt: iso(r.csatAt), transferCount: r.transferCount,
    }), cols('id', 'protocol', 'channel', 'contactId', 'queueId', 'agentId', 'status', 'category', 'intent', 'closeReason', 'startedAt', 'queuedAt', 'assignedAt', 'firstResponseAt', 'closedAt', 'tmeSec', 'tmaSec', 'botHandled', 'resolvedByBot', 'firstContactResolved', 'automatable', 'slaBreached', 'slaFirstResponseDueAt', 'slaResolutionDueAt', 'csatScore', 'csatAt', 'transferCount'));
  }

  if (dataset === 'messages-meta') {
    const rows = await prisma.bvMessage.findMany({
      where: { orgId, createdAt: { gte: range.from, lt: range.to }, ...keyset('createdAt', cur) }, orderBy: order('createdAt'), take,
      select: { id: true, conversationId: true, direction: true, senderType: true, senderUserId: true, kind: true, status: true, errorCode: true, createdAt: true, attachments: true, aiMeta: true },
    });
    return finish(rows, (r) => r.createdAt, (r) => {
      const att = Array.isArray(r.attachments) ? (r.attachments as any[]) : [];
      const ai = (r.aiMeta ?? {}) as any;
      return { id: r.id, conversationId: r.conversationId, direction: r.direction, senderType: r.senderType, senderUserId: r.senderUserId, kind: r.kind, status: r.status, errorCode: r.errorCode, createdAt: iso(r.createdAt), attachmentCount: att.length, attachmentBytes: att.reduce((s, a) => s + (Number(a?.size) || 0), 0), aiIntent: typeof ai.intent === 'string' ? ai.intent : null, aiConfidence: typeof ai.confidence === 'number' ? ai.confidence : null };
    }, cols('id', 'conversationId', 'direction', 'senderType', 'senderUserId', 'kind', 'status', 'errorCode', 'createdAt', 'attachmentCount', 'attachmentBytes', 'aiIntent', 'aiConfidence'));
  }

  if (dataset === 'calls') {
    const rows = await prisma.bvCall.findMany({
      where: { orgId, startedAt: { gte: range.from, lt: range.to }, ...keyset('startedAt', cur) }, orderBy: order('startedAt'), take,
      select: { id: true, conversationId: true, direction: true, status: true, ivrFlowId: true, agentUserId: true, startedAt: true, answeredAt: true, endedAt: true, durationSec: true, recordingKey: true, recordingSizeBytes: true, endReason: true },
    });
    return finish(rows, (r) => r.startedAt, (r) => ({ id: r.id, conversationId: r.conversationId, direction: r.direction, status: r.status, ivrFlowId: r.ivrFlowId, agentId: r.agentUserId, startedAt: iso(r.startedAt), answeredAt: iso(r.answeredAt), endedAt: iso(r.endedAt), durationSec: r.durationSec, hasRecording: !!r.recordingKey, recordingBytes: r.recordingSizeBytes != null ? Number(r.recordingSizeBytes) : null, endReason: r.endReason }),
      cols('id', 'conversationId', 'direction', 'status', 'ivrFlowId', 'agentId', 'startedAt', 'answeredAt', 'endedAt', 'durationSec', 'hasRecording', 'recordingBytes', 'endReason'));
  }

  const rows = await prisma.bvTask.findMany({
    where: { orgId, createdAt: { gte: range.from, lt: range.to }, ...keyset('createdAt', cur) }, orderBy: order('createdAt'), take,
    select: { id: true, code: true, kind: true, status: true, priority: true, origin: true, sectorId: true, assigneeId: true, creatorId: true, conversationId: true, contactId: true, dueAt: true, completedAt: true, supportLevel: true, respondedAt: true, slaResponseDueAt: true, slaResolutionDueAt: true, tags: true, createdAt: true },
  });
  return finish(rows, (r) => r.createdAt, (r) => ({ id: r.id, code: r.code, kind: r.kind, status: r.status, priority: r.priority, origin: r.origin, sectorId: r.sectorId, assigneeId: r.assigneeId, creatorId: r.creatorId, conversationId: r.conversationId, contactId: r.contactId, createdAt: iso(r.createdAt), dueAt: iso(r.dueAt), respondedAt: iso(r.respondedAt), completedAt: iso(r.completedAt), supportLevel: r.supportLevel, slaResponseDueAt: iso(r.slaResponseDueAt), slaResolutionDueAt: iso(r.slaResolutionDueAt), tags: r.tags.join('|') }),
    cols('id', 'code', 'kind', 'status', 'priority', 'origin', 'sectorId', 'assigneeId', 'creatorId', 'conversationId', 'contactId', 'createdAt', 'dueAt', 'respondedAt', 'completedAt', 'supportLevel', 'slaResponseDueAt', 'slaResolutionDueAt', 'tags'));
}
