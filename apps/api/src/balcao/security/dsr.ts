import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { audit } from '../core/audit';
import { decryptField, encryptField } from '../core/crypto';
import { deleteObject, newKey, putObject } from '../core/storage';
import { activeLegalHold, getSecuritySettings } from './config';
import { maskNumber } from './retention';

/**
 * Direitos do titular (LGPD art. 18): acesso/exportação, anonimização e exclusão.
 * Tudo é idempotente e auditado; arquivos do storage são removidos ANTES das linhas (reexecução conclui o que falhou).
 */
export const DSR_TYPES = ['ACCESS', 'EXPORT', 'DELETE', 'ANONYMIZE'] as const;
export type DsrType = (typeof DSR_TYPES)[number];

export const ANON_MARKER = '[conteúdo removido a pedido do titular — LGPD]';
export const DSR_EXPORT_TTL_DAYS = 30;

/** `BvDataSubjectRequest.note` guarda um JSON (justificativa, origem, relatório de conclusão). */
export interface DsrNote {
  justification?: string;
  origin?: 'INTERNAL' | 'PUBLIC';
  requesterEmailHash?: string;
  text?: string;
  rejectedReason?: string;
  report?: Record<string, unknown>;
}
export const parseNote = (note: string | null): DsrNote => { try { return note ? (JSON.parse(note) as DsrNote) : {}; } catch { return { text: note ?? undefined }; } };
const serialize = (n: DsrNote): string => JSON.stringify(n);

export class DsrError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

const keyOk = (orgId: string, k: unknown): k is string => typeof k === 'string' && k.startsWith(`${orgId}/`);
const attachmentKeys = (orgId: string, att: unknown): string[] => (Array.isArray(att) ? att.map((a: any) => a?.key).filter((k) => keyOk(orgId, k)) : []);

/** Contato + contatos mesclados nele + conversas. */
async function subjectScope(orgId: string, contactId: string) {
  const contact = await prisma.bvContact.findFirst({ where: { id: contactId, orgId } });
  if (!contact) return null;
  const merged = await prisma.bvContact.findMany({ where: { orgId, mergedIntoId: contactId }, select: { id: true } });
  const contactIds = [contactId, ...merged.map((m) => m.id)];
  const conversations = await prisma.bvConversation.findMany({ where: { orgId, contactId: { in: contactIds } }, select: { id: true } });
  return { contact, contactIds, conversationIds: conversations.map((c) => c.id) };
}

// ── Exportação dos dados do titular ───────────────────────────────────────────

export async function buildSubjectExport(orgId: string, contactId: string): Promise<Record<string, unknown> | null> {
  const scope = await subjectScope(orgId, contactId);
  if (!scope) return null;
  const { contact, contactIds, conversationIds } = scope;
  const [identities, conversations, calls, tasks, webchat, audits] = await Promise.all([
    prisma.bvContactIdentity.findMany({ where: { orgId, contactId: { in: contactIds } }, select: { channel: true, externalId: true, createdAt: true } }),
    prisma.bvConversation.findMany({ where: { orgId, id: { in: conversationIds } }, orderBy: { startedAt: 'asc' } }),
    prisma.bvCall.findMany({ where: { orgId, conversationId: { in: conversationIds } }, orderBy: { startedAt: 'asc' } }),
    prisma.bvTask.findMany({ where: { orgId, OR: [{ contactId: { in: contactIds } }, { conversationId: { in: conversationIds } }] }, select: { code: true, kind: true, title: true, description: true, status: true, priority: true, createdAt: true, completedAt: true } }),
    prisma.bvWebchatSession.findMany({ where: { orgId, contactId: { in: contactIds } }, select: { origin: true, createdAt: true, endedAt: true } }),
    prisma.bvAuditLog.findMany({ where: { orgId, action: { in: ['contact.consent', 'lgpd.consent'] }, entityId: { in: contactIds } }, select: { action: true, createdAt: true, meta: true } }),
  ]);
  const messages = await prisma.bvMessage.findMany({ where: { orgId, conversationId: { in: conversationIds }, direction: { not: 'INTERNAL' } }, orderBy: [{ conversationId: 'asc' }, { createdAt: 'asc' }] });
  const byConv = new Map<string, any[]>();
  for (const m of messages) {
    const arr = byConv.get(m.conversationId) ?? [];
    arr.push({
      id: m.id, direction: m.direction, senderType: m.senderType, kind: m.kind, at: m.createdAt,
      body: m.body ? decryptField(m.body) : null,
      attachments: (Array.isArray(m.attachments) ? (m.attachments as any[]) : []).map((a) => ({ name: a.name, mime: a.mime, size: a.size, sha256: a.sha256 })),
    });
    byConv.set(m.conversationId, arr);
  }
  const consents = [
    ...conversations.map((c) => (c.metadata as any)?.consent).filter(Boolean),
    ...audits.map((a) => ({ action: a.action, at: a.createdAt, meta: a.meta })),
  ];
  return {
    generatedAt: new Date().toISOString(),
    legalNotice: 'Dados pessoais do titular tratados pelo controlador. Notas internas dos atendentes não estão incluídas.',
    contact: {
      id: contact.id, name: contact.name, email: contact.email, phone: contact.phone,
      document: contact.documentEnc ? decryptField(contact.documentEnc) : null,
      category: contact.category, govbrSub: contact.govbrSub, govbrLevel: contact.govbrLevel,
      identityVerifiedAt: contact.identityVerifiedAt, tags: contact.tags, createdAt: contact.createdAt, anonymizedAt: contact.anonymizedAt,
    },
    mergedContactIds: contactIds.filter((i) => i !== contactId),
    identities,
    conversations: conversations.map((c) => ({
      protocol: c.protocol, channel: c.channel, status: c.status, category: c.category, subject: c.subject, startedAt: c.startedAt, closedAt: c.closedAt,
      closeReason: c.closeReason, csatScore: c.csatScore, csatComment: c.csatComment, messages: byConv.get(c.id) ?? [],
    })),
    calls: calls.map((c) => ({ direction: c.direction, from: c.fromNumber, to: c.toNumber, startedAt: c.startedAt, endedAt: c.endedAt, durationSec: c.durationSec, hasRecording: !!c.recordingKey })),
    tasks, webchatSessions: webchat, consents,
  };
}

/** Gera o arquivo JSON do titular (storage + sha256) e registra um BvExportJob DSAR. */
export async function exportSubjectData(orgId: string, contactId: string, actorId: string | null) {
  const data = await buildSubjectExport(orgId, contactId);
  if (!data) throw new DsrError(404, 'dsr.contact_not_found', 'Titular não encontrado');
  const buf = Buffer.from(JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2), 'utf8');
  const key = newKey(orgId, 'exports', 'json');
  const stored = await putObject(key, buf);
  const job = await prisma.bvExportJob.create({
    data: {
      orgId, type: 'DSAR', format: 'JSON', params: { contactId }, status: 'DONE', fileKey: key, sha256: stored.sha256, sizeBytes: BigInt(stored.size),
      createdById: actorId, finishedAt: new Date(), expiresAt: new Date(Date.now() + DSR_EXPORT_TTL_DAYS * 86_400_000),
    },
  });
  return { jobId: job.id, sha256: stored.sha256, sizeBytes: stored.size, expiresAt: job.expiresAt };
}

// ── Anonimização ──────────────────────────────────────────────────────────────

export interface ErasureReport {
  contacts: number; messagesRedacted: number; attachmentsRemoved: number; recordingsRemoved: number; callsMasked: number;
  identitiesRemoved: number; webchatSessionsScrubbed: number; dsrExportsRemoved: number; conversationsScrubbed: number;
  conversationsDeleted?: number; messagesDeleted?: number; callsDeleted?: number; tasksUnlinked?: number;
  alreadyDone?: boolean; retained: string[];
}
const emptyReport = (): ErasureReport => ({
  contacts: 0, messagesRedacted: 0, attachmentsRemoved: 0, recordingsRemoved: 0, callsMasked: 0, identitiesRemoved: 0,
  webchatSessionsScrubbed: 0, dsrExportsRemoved: 0, conversationsScrubbed: 0,
  retained: ['Trilha de auditoria (obrigação legal; nunca contém o conteúdo das mensagens)', 'Métricas agregadas (contagens, SLA, CSAT) sem dado pessoal'],
});

async function removeSubjectExports(orgId: string, contactIds: string[]): Promise<number> {
  const jobs = await prisma.bvExportJob.findMany({ where: { orgId, type: 'DSAR', fileKey: { not: null } }, select: { id: true, fileKey: true, params: true } });
  let n = 0;
  for (const j of jobs) {
    if (!contactIds.includes((j.params as any)?.contactId) || !keyOk(orgId, j.fileKey)) continue;
    await deleteObject(j.fileKey).catch(() => undefined);
    await prisma.bvExportJob.update({ where: { id: j.id }, data: { fileKey: null, params: { ...(j.params as object), purged: true } as any } });
    n++;
  }
  return n;
}

export async function anonymizeContact(orgId: string, contactId: string, opts: { redactAllMessages?: boolean } = {}): Promise<ErasureReport> {
  const rep = emptyReport();
  const scope = await subjectScope(orgId, contactId);
  if (!scope) { rep.alreadyDone = true; return rep; }
  const { contact, contactIds, conversationIds } = scope;
  if (contact.anonymizedAt && contactIds.length === 1) { rep.alreadyDone = true; return rep; }

  // 1) mensagens (corpo → marcador, anexos removidos) — paginado por conversa
  for (const convId of conversationIds) {
    let cursor: string | undefined;
    for (;;) {
      const batch = await prisma.bvMessage.findMany({
        where: { orgId, conversationId: convId }, orderBy: { id: 'asc' }, take: 300, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, direction: true, senderType: true, attachments: true, channelMeta: true },
      });
      if (!batch.length) break;
      for (const m of batch) {
        if ((m.channelMeta as any)?.anonymized) continue; // já tratada
        const isSubject = m.senderType === 'CONTACT' || m.direction === 'IN';
        const keys = attachmentKeys(orgId, m.attachments);
        for (const k of keys) { await deleteObject(k).catch(() => undefined); rep.attachmentsRemoved++; }
        const redactBody = isSubject || opts.redactAllMessages;
        if (!redactBody && !keys.length) continue;
        await prisma.bvMessage.update({
          where: { id: m.id },
          data: { ...(redactBody ? { body: encryptField(ANON_MARKER) } : {}), attachments: Prisma.DbNull, channelMeta: { anonymized: true } },
        });
        if (redactBody) rep.messagesRedacted++;
      }
      cursor = batch[batch.length - 1].id;
    }
  }

  // 2) chamadas: gravação removida, números mascarados
  const calls = await prisma.bvCall.findMany({ where: { orgId, conversationId: { in: conversationIds } }, select: { id: true, recordingKey: true, fromNumber: true, toNumber: true } });
  for (const c of calls) {
    if (keyOk(orgId, c.recordingKey)) { await deleteObject(c.recordingKey).catch(() => undefined); rep.recordingsRemoved++; }
    const needs = c.recordingKey || !c.fromNumber.startsWith('***') || !c.toNumber.startsWith('***');
    if (!needs) continue;
    await prisma.bvCall.update({ where: { id: c.id }, data: { recordingKey: null, recordingSha256: null, recordingSizeBytes: null, fromNumber: maskNumber(c.fromNumber), toNumber: maskNumber(c.toNumber) } });
    rep.callsMasked++;
  }

  // 3) conversas, sessões de webchat, exportações do titular
  const convRes = await prisma.bvConversation.updateMany({ where: { orgId, id: { in: conversationIds } }, data: { csatComment: null, subject: null, channelRef: null, metadata: { anonymized: true } } });
  rep.conversationsScrubbed = convRes.count;
  const wc = await prisma.bvWebchatSession.updateMany({ where: { orgId, contactId: { in: contactIds } }, data: { ip: null, userAgent: null } });
  rep.webchatSessionsScrubbed = wc.count;
  rep.dsrExportsRemoved = await removeSubjectExports(orgId, contactIds);

  // 4) por último: identidades e dados pessoais do contato (a marca anonymizedAt indica conclusão)
  rep.identitiesRemoved = (await prisma.bvContactIdentity.deleteMany({ where: { orgId, contactId: { in: contactIds } } })).count;
  await prisma.bvTask.updateMany({ where: { orgId, contactId: { in: contactIds } }, data: { contactId: null } });
  const c = await prisma.bvContact.updateMany({
    where: { orgId, id: { in: contactIds } },
    data: { name: null, email: null, phone: null, documentEnc: null, documentHash: null, govbrSub: null, govbrLevel: null, tags: [], anonymizedAt: new Date() },
  });
  rep.contacts = c.count;
  return rep;
}

// ── Exclusão ──────────────────────────────────────────────────────────────────

export async function deleteContactData(orgId: string, contactId: string): Promise<ErasureReport> {
  const rep = emptyReport();
  rep.retained = ['Trilha de auditoria (obrigação legal; nunca contém o conteúdo das mensagens)', 'Tarefas internas (desvinculadas do titular; texto livre não é alterado)'];
  const scope = await subjectScope(orgId, contactId);
  if (!scope) { rep.alreadyDone = true; return rep; }
  const { contactIds, conversationIds } = scope;

  // arquivos primeiro (reexecução conclui o que faltar)
  const msgs = await prisma.bvMessage.findMany({ where: { orgId, conversationId: { in: conversationIds }, attachments: { not: Prisma.DbNull } }, select: { attachments: true } });
  for (const m of msgs) for (const k of attachmentKeys(orgId, m.attachments)) { await deleteObject(k).catch(() => undefined); rep.attachmentsRemoved++; }
  const calls = await prisma.bvCall.findMany({ where: { orgId, conversationId: { in: conversationIds } }, select: { recordingKey: true } });
  for (const c of calls) if (keyOk(orgId, c.recordingKey)) { await deleteObject(c.recordingKey).catch(() => undefined); rep.recordingsRemoved++; }
  rep.dsrExportsRemoved = await removeSubjectExports(orgId, contactIds);

  await prisma.$transaction(async (tx) => {
    rep.messagesDeleted = await tx.bvMessage.count({ where: { orgId, conversationId: { in: conversationIds } } });
    rep.callsDeleted = (await tx.bvCall.deleteMany({ where: { orgId, conversationId: { in: conversationIds } } })).count;
    await tx.bvWebchatSession.deleteMany({ where: { orgId, contactId: { in: contactIds } } });
    rep.tasksUnlinked = (await tx.bvTask.updateMany({ where: { orgId, OR: [{ contactId: { in: contactIds } }, { conversationId: { in: conversationIds } }] }, data: { contactId: null, conversationId: null } })).count;
    rep.conversationsDeleted = (await tx.bvConversation.deleteMany({ where: { orgId, id: { in: conversationIds } } })).count; // cascata: mensagens e eventos
    rep.identitiesRemoved = (await tx.bvContactIdentity.deleteMany({ where: { orgId, contactId: { in: contactIds } } })).count;
    rep.contacts = (await tx.bvContact.deleteMany({ where: { orgId, id: { in: contactIds } } })).count;
  });
  return rep;
}

// ── Fluxo de solicitação ──────────────────────────────────────────────────────

export interface OpenDsrInput { orgId: string; contactId: string; type: DsrType; actorId?: string | null; note?: string; justification?: string; origin?: 'INTERNAL' | 'PUBLIC'; requesterEmailHash?: string }

export async function openDsr(i: OpenDsrInput) {
  const contact = await prisma.bvContact.findFirst({ where: { id: i.contactId, orgId: i.orgId }, select: { id: true } });
  if (!contact) throw new DsrError(404, 'dsr.contact_not_found', 'Titular não encontrado neste órgão');
  const dup = await prisma.bvDataSubjectRequest.findFirst({ where: { orgId: i.orgId, contactId: i.contactId, type: i.type, status: 'OPEN' } });
  if (dup) return { request: dup, created: false };
  const request = await prisma.bvDataSubjectRequest.create({
    data: { orgId: i.orgId, contactId: i.contactId, type: i.type, handledById: null, note: serialize({ text: i.note, justification: i.justification, origin: i.origin ?? 'INTERNAL', requesterEmailHash: i.requesterEmailHash }) },
  });
  await audit({
    orgId: i.orgId, actorType: i.origin === 'PUBLIC' ? 'CONTACT' : 'USER', actorId: i.actorId ?? null,
    action: 'dsr.open', entityType: 'contact', entityId: i.contactId, meta: { requestId: request.id, type: i.type, origin: i.origin ?? 'INTERNAL' },
  });
  return { request, created: true };
}

export interface ProcessResult { request: Awaited<ReturnType<typeof prisma.bvDataSubjectRequest.findFirstOrThrow>>; report: Record<string, unknown>; alreadyDone: boolean }

/**
 * Executa a solicitação. Idempotente: se já DONE devolve o relatório gravado.
 * DELETE exige justificativa; DELETE/ANONYMIZE são recusados (status REJECTED, registrado) sob guarda legal.
 */
export async function processDsr(orgId: string, requestId: string, actorId: string | null, input: { justification?: string; redactAllMessages?: boolean } = {}): Promise<ProcessResult> {
  const req = await prisma.bvDataSubjectRequest.findFirst({ where: { id: requestId, orgId } });
  if (!req) throw new DsrError(404, 'dsr.not_found', 'Solicitação não encontrada');
  const note = parseNote(req.note);
  if (req.status === 'DONE') return { request: req, report: note.report ?? {}, alreadyDone: true };
  if (req.status === 'REJECTED') throw new DsrError(409, 'dsr.rejected', 'Solicitação já recusada — abra uma nova solicitação');
  const type = req.type as DsrType;
  const justification = (input.justification ?? note.justification ?? '').trim();

  if (type === 'DELETE' || type === 'ANONYMIZE') {
    const hold = activeLegalHold((await getSecuritySettings(orgId)).legalHold);
    if (hold) {
      const reason = `Guarda legal vigente${hold.basis ? ` (${hold.basis})` : ''}: dados mantidos para cumprimento de obrigação legal/regulatória (LGPD art. 16, I)`;
      const updated = await prisma.bvDataSubjectRequest.update({ where: { id: req.id }, data: { status: 'REJECTED', handledById: actorId, completedAt: new Date(), note: serialize({ ...note, justification: justification || note.justification, rejectedReason: reason }) } });
      await audit({ orgId, actorId, action: 'dsr.rejected_legal_hold', entityType: 'contact', entityId: req.contactId, meta: { requestId: req.id, type, basis: hold.basis ?? null } });
      return { request: updated, report: { rejected: true, reason }, alreadyDone: false };
    }
    if (type === 'DELETE' && justification.length < 10) throw new DsrError(400, 'dsr.justification_required', 'A exclusão exige justificativa (mínimo de 10 caracteres) com a base legal');
  }

  let report: Record<string, unknown>;
  if (type === 'ACCESS' || type === 'EXPORT') {
    const ex = await exportSubjectData(orgId, req.contactId, actorId);
    report = { type, exportJobId: ex.jobId, sha256: ex.sha256, sizeBytes: ex.sizeBytes, expiresAt: ex.expiresAt, delivery: 'download autenticado em GET /security/dsr/:id/export' };
  } else if (type === 'ANONYMIZE') {
    report = { type, ...(await anonymizeContact(orgId, req.contactId, { redactAllMessages: input.redactAllMessages })) };
  } else {
    report = { type, justification, ...(await deleteContactData(orgId, req.contactId)) };
  }

  const updated = await prisma.bvDataSubjectRequest.update({
    where: { id: req.id },
    data: { status: 'DONE', handledById: actorId, completedAt: new Date(), note: serialize({ ...note, justification: justification || note.justification, report }) },
  });
  await audit({ orgId, actorId, action: `dsr.${type.toLowerCase()}`, entityType: 'contact', entityId: req.contactId, meta: { requestId: req.id, report: { ...report, justification: undefined } } });
  return { request: updated, report, alreadyDone: false };
}

export async function rejectDsr(orgId: string, requestId: string, actorId: string | null, reason: string) {
  const req = await prisma.bvDataSubjectRequest.findFirst({ where: { id: requestId, orgId } });
  if (!req) throw new DsrError(404, 'dsr.not_found', 'Solicitação não encontrada');
  if (req.status !== 'OPEN') throw new DsrError(409, 'dsr.not_open', 'Solicitação não está aberta');
  const updated = await prisma.bvDataSubjectRequest.update({ where: { id: req.id }, data: { status: 'REJECTED', handledById: actorId, completedAt: new Date(), note: serialize({ ...parseNote(req.note), rejectedReason: reason }) } });
  await audit({ orgId, actorId, action: 'dsr.reject', entityType: 'contact', entityId: req.contactId, meta: { requestId: req.id, reason } });
  return updated;
}
