import crypto from 'crypto';
import { prisma } from '../../../lib/prisma';
import { setContactDocument } from '../../core/contacts';
import { createMessage } from '../../core/messages';
import { newKey, putObject } from '../../core/storage';
import { saveIntegration } from '../../core/integrations';
import { makeOrg } from '../../core/testing';

export const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

/** Titular completo: contato com CPF, identidades, conversa, mensagens (com anexo), chamada com gravação, tarefa. */
export async function seedSubject(orgId: string, over: { email?: string; old?: boolean; document?: string } = {}) {
  const email = over.email ?? `titular-${crypto.randomBytes(3).toString('hex')}@exemplo.com`;
  const contact = await prisma.bvContact.create({ data: { orgId, name: 'Maria da Silva', email, phone: '5563999990000', govbrSub: 'sub-' + crypto.randomBytes(4).toString('hex') } });
  await setContactDocument(contact.id, over.document ?? '123.456.789-09');
  await prisma.bvContactIdentity.create({ data: { orgId, contactId: contact.id, channel: 'EMAIL', externalId: email } });
  await prisma.bvContactIdentity.create({ data: { orgId, contactId: contact.id, channel: 'WHATSAPP', externalId: '5563999990000' } });
  const when = over.old ? daysAgo(4000) : new Date();
  const conv = await prisma.bvConversation.create({ data: { orgId, protocol: 'BV-T-' + crypto.randomBytes(4).toString('hex'), channel: 'WHATSAPP', contactId: contact.id, subject: 'Meu processo', csatComment: 'Ótimo atendimento', channelRef: '5563999990000', startedAt: when } });
  const key = newKey(orgId, 'attachments', 'pdf');
  const stored = await putObject(key, Buffer.from('%PDF-1.4 conteúdo sensível'));
  const m1 = await createMessage({ orgId, conversationId: conv.id, direction: 'IN', senderType: 'CONTACT', body: 'Meu CPF é 123.456.789-09', attachments: [{ key, name: 'doc.pdf', mime: 'application/pdf', size: stored.size, sha256: stored.sha256 }], createdAt: when });
  const m2 = await createMessage({ orgId, conversationId: conv.id, direction: 'OUT', senderType: 'AGENT', body: 'Recebemos, obrigado.', createdAt: when });
  const note = await createMessage({ orgId, conversationId: conv.id, direction: 'INTERNAL', senderType: 'AGENT', body: 'nota interna', createdAt: when });
  const recKey = newKey(orgId, 'recordings', 'wav');
  const rec = await putObject(recKey, Buffer.from('RIFFfake-audio'));
  const call = await prisma.bvCall.create({ data: { orgId, conversationId: conv.id, direction: 'IN', fromNumber: '5563999990000', toNumber: '6333000000', status: 'ENDED', recordingKey: recKey, recordingSha256: rec.sha256, recordingSizeBytes: BigInt(rec.size), startedAt: when, durationSec: 60 } });
  const task = await prisma.bvTask.create({ data: { orgId, code: 'TAR-' + crypto.randomBytes(3).toString('hex'), title: 'Retornar ligação', conversationId: conv.id, contactId: contact.id } });
  return { contact, conv, messages: [m1.message, m2.message, note.message], key, recKey, call, task, email };
}

/** Órgão com dados variados para a exportação integral. */
export async function seedFullOrg() {
  const org = await makeOrg({ retention: { messagesDays: 1825, recordingsDays: 1825, auditDays: 1825, logsDays: 90 } });
  const orgId = org.id;
  const user = await prisma.bvUser.create({ data: { orgId, email: `adm-${crypto.randomBytes(3).toString('hex')}@t.local`, name: 'Adm', role: 'ADMIN', passwordHash: 'scrypt$SEGREDO-HASH', totpSecretEnc: 'bv1.0.SEGREDO-TOTP' } });
  await prisma.bvSector.create({ data: { orgId, name: "Setor 'Cível'" } });
  const queue = await prisma.bvQueue.create({ data: { orgId, name: 'Geral', slug: 'geral', categories: ['A', 'B'] } });
  await prisma.bvQueueMember.create({ data: { queueId: queue.id, userId: user.id } });
  await prisma.bvRoutingRule.create({ data: { orgId, name: 'r1', action: { queueId: queue.id } } });
  await prisma.bvIvrFlow.create({ data: { orgId, name: 'URA', version: 1, status: 'ARCHIVED', definition: { start: 'a', nodes: {} } } });
  await prisma.bvIvrFlow.create({ data: { orgId, name: 'URA', version: 2, status: 'ACTIVE', definition: { start: 'b', nodes: { b: { type: 'menu', prompt: { text: 'Olá\n"mundo"; \\ barra' } } } } } });
  const art = await prisma.bvKbArticle.create({ data: { orgId, title: 'Como peticionar', question: 'Como?', answer: 'Assim, com acentuação: ção.', tags: ['a', "b'c"], status: 'APPROVED' } });
  await prisma.bvKbArticleVersion.create({ data: { articleId: art.id, version: 1, snapshot: { answer: 'v1' } } });
  await prisma.bvKbSuggestion.create({ data: { orgId, type: 'GAP', question: 'Pergunta sem resposta?' } });
  const s = await seedSubject(orgId);
  await prisma.bvContact.create({ data: { orgId, name: 'Sem doc' } });
  await prisma.bvConversationEvent.create({ data: { orgId, conversationId: s.conv.id, type: 'CREATED' } });
  await prisma.bvTaskComment.create({ data: { taskId: s.task.id, userId: user.id, body: 'comentário' } });
  await prisma.bvTaskHistory.create({ data: { taskId: s.task.id, field: 'status', fromValue: 'OPEN', toValue: 'DONE' } });
  await prisma.bvAuditLog.create({ data: { orgId, action: 'x.test', actorType: 'SYSTEM' } });
  await prisma.bvUsageDaily.create({ data: { orgId, day: new Date('2026-01-01'), item: 'AI_CALLS', quantity: BigInt(7) } });
  await prisma.bvQuota.create({ data: { orgId, item: 'AI_CALLS', period: 'DAY', limit: BigInt(100) } });
  await prisma.bvWaTemplate.create({ data: { orgId, name: 'tpl', category: 'UTILITY', components: [] } });
  await saveIntegration(orgId, 'WHATSAPP', { phoneNumberId: '123', accessToken: 'SEGREDO-TOKEN', appSecret: 'SEGREDO-APP', apiBase: 'https://graph.example/v1', nested: { clientSecret: 'SEGREDO-NESTED' } });
  await prisma.bvIntegrationLog.create({ data: { orgId, type: 'WHATSAPP', operation: 'send', ok: true } });
  return { orgId, user, queue, ...s };
}
