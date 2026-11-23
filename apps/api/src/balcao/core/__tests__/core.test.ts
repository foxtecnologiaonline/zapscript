process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-12345678901234567890';

import Fastify from 'fastify';
import { prisma } from '../../../lib/prisma';
import { decryptField, encryptField, isEncrypted, blindIndex } from '../crypto';
import { signJwt, verifyJwt } from '../jwt';
import { hashPassword, verifyPassword, passwordPolicyError } from '../passwords';
import { addBusinessSeconds, DEFAULT_SETTINGS, isWithinBusinessHours } from '../settings';
import { can } from '../permissions';
import { clearBvEventHandlers, onBvEvent } from '../events';
import { clearChannelSenders, registerChannelSender } from '../channels';
import { assignConversation, closeConversation, escalateToHuman, ingestInbound, sendMessage, transferConversation, canAccessConversation } from '../conversations';
import { listMessages } from '../messages';
import { recordUsage, getUsage, checkQuota } from '../usage';
import { authHeader, buildBalcaoTestApp, makeOrg, makeUser } from '../testing';
import { normalizePhone } from '../contacts';
import { putObject, getObjectBuffer, newKey, parseRange } from '../storage';

describe('balcao/core — criptografia, jwt, senha', () => {
  it('cifra e decifra campo; texto cifrado não contém o original', () => {
    const c = encryptField('Olá, cidadão 123');
    expect(isEncrypted(c)).toBe(true);
    expect(c).not.toContain('cidad');
    expect(decryptField(c)).toBe('Olá, cidadão 123');
  });
  it('blind index é determinístico', () => expect(blindIndex('12345678901')).toBe(blindIndex('12345678901')));
  it('jwt válido, adulterado e expirado', () => {
    const t = signJwt({ sub: 'u', org: 'o', role: 'ADMIN', typ: 'access' }, 60);
    expect(verifyJwt(t)?.sub).toBe('u');
    expect(verifyJwt(t.slice(0, -2) + 'xx')).toBeNull();
    expect(verifyJwt(signJwt({ sub: 'u', org: 'o', role: 'ADMIN', typ: 'access' }, -1))).toBeNull();
    expect(verifyJwt(t, 'mfa')).toBeNull();
  });
  it('senha: hash/verify e política', () => {
    const h = hashPassword('SenhaForte12345');
    expect(verifyPassword('SenhaForte12345', h)).toBe(true);
    expect(verifyPassword('errada', h)).toBe(false);
    expect(passwordPolicyError('curta1')).toBeTruthy();
    expect(passwordPolicyError('SenhaForte12345')).toBeNull();
  });
  it('permissões por perfil', () => {
    expect(can('ATENDENTE', 'conversation:reply')).toBe(true);
    expect(can('ATENDENTE', 'user:manage')).toBe(false);
    expect(can('FISCAL', 'fiscal:read')).toBe(true);
    expect(can('FISCAL', 'conversation:reply')).toBe(false);
    expect(can('ADMIN', 'security:manage')).toBe(true);
  });
});

describe('balcao/core — horário comercial e storage', () => {
  it('segunda 10h (Tocantins) é útil; domingo e feriado não', () => {
    const mon10 = new Date('2026-11-23T13:00:00Z'); // 10:00 -03
    expect(isWithinBusinessHours(DEFAULT_SETTINGS, mon10)).toBe(true);
    expect(isWithinBusinessHours(DEFAULT_SETTINGS, new Date('2026-11-22T13:00:00Z'))).toBe(false);
    expect(isWithinBusinessHours(DEFAULT_SETTINGS, mon10, new Set(['2026-11-23']))).toBe(false);
  });
  it('addBusinessSeconds pula a noite', () => {
    const from = new Date('2026-11-23T20:30:00Z'); // 17:30 -03 (30 min antes de fechar)
    const due = addBusinessSeconds(DEFAULT_SETTINGS, from, 3600); // 1h útil → 30min hoje + 30min amanhã 08:00
    expect(due.toISOString()).toBe('2026-11-24T11:30:00.000Z'); // 08:30 -03
  });
  it('storage grava/lê, calcula sha256 e rejeita path traversal', async () => {
    const key = newKey('org1', 'attachments', 'txt');
    const o = await putObject(key, Buffer.from('conteudo'));
    expect(o.size).toBe(8);
    expect((await getObjectBuffer(key)).toString()).toBe('conteudo');
    await expect(getObjectBuffer('../etc/passwd')).rejects.toThrow();
    expect(parseRange('bytes=0-3', 10)).toEqual({ start: 0, end: 3 });
    expect(parseRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
  });
  it('normalizePhone', () => {
    expect(normalizePhone('(63) 99999-1234')).toBe('5563999991234');
    expect(normalizePhone('5563999991234')).toBe('5563999991234');
  });
});

describe('balcao/core — ciclo da conversa', () => {
  let orgId: string;
  const sent: string[] = [];
  beforeAll(() => {
    registerChannelSender('WHATSAPP', async (r) => { sent.push(r.message.body ?? ''); return { channelMessageId: `out-${r.message.id}` }; });
  });
  afterAll(() => { clearChannelSenders(); clearBvEventHandlers(); });
  beforeEach(async () => { orgId = (await makeOrg({ ai: { enabled: true } })).id; });

  it('ingest cria contato/conversa em BOT, cifra o corpo em repouso e deduplica reentrega', async () => {
    const events: string[] = [];
    onBvEvent('conversation.created', (e) => { if (e.orgId === orgId) events.push('created'); });
    const r1 = await ingestInbound({ orgId, channel: 'WHATSAPP', channelRef: '5563999990001', externalId: '5563999990001', name: 'Maria', message: { body: 'Preciso de ajuda com meu processo', channelMessageId: 'wamid.1' } });
    expect(r1.isNew).toBe(true);
    expect(r1.conversation.status).toBe('BOT');
    expect(r1.conversation.protocol).toMatch(/^BV-\d{4}-\d{6}$/);
    const raw = await prisma.bvMessage.findUniqueOrThrow({ where: { id: r1.message!.id } });
    expect(raw.body).not.toContain('processo');
    expect((await listMessages(r1.conversation.id))[0].body).toBe('Preciso de ajuda com meu processo');
    const r2 = await ingestInbound({ orgId, channel: 'WHATSAPP', channelRef: '5563999990001', externalId: '5563999990001', message: { body: 'Preciso de ajuda com meu processo', channelMessageId: 'wamid.1' } });
    expect(r2.duplicate).toBe(true);
    expect(await prisma.bvMessage.count({ where: { conversationId: r1.conversation.id } })).toBe(1);
    await new Promise((r) => setTimeout(r, 20));
    expect(events).toEqual(['created']);
  });

  it('segunda mensagem cai na mesma conversa; mesma pessoa em outro canal reaproveita o contato', async () => {
    const a = await ingestInbound({ orgId, channel: 'WHATSAPP', channelRef: '5563988880002', externalId: '5563988880002', name: 'João', message: { body: 'oi' } });
    const b = await ingestInbound({ orgId, channel: 'WHATSAPP', channelRef: '5563988880002', externalId: '5563988880002', message: { body: 'tem alguém?' } });
    expect(b.conversation.id).toBe(a.conversation.id);
    const v = await ingestInbound({ orgId, channel: 'VOICE', channelRef: 'call-1', externalId: '63 98888-0002', message: { body: 'chamada' } });
    expect(v.contactId).toBe(a.contactId); // telefone casou com a identidade do WhatsApp
  });

  it('escalar → atribuir → responder (despacha ao canal) → transferir → encerrar → NPS por resposta numérica', async () => {
    const needs: string[] = [];
    onBvEvent('conversation.needs_routing', (e) => { if (e.orgId === orgId) needs.push(e.reason); });
    const agent1 = await makeUser(orgId, 'ATENDENTE');
    const agent2 = await makeUser(orgId, 'ATENDENTE');
    const r = await ingestInbound({ orgId, channel: 'WHATSAPP', channelRef: '5563977770003', externalId: '5563977770003', message: { body: 'quero falar com atendente' } });
    await escalateToHuman(orgId, r.conversation.id, { reason: 'pedido do cidadão', category: 'PROCESSO' });
    expect((await prisma.bvConversation.findUniqueOrThrow({ where: { id: r.conversation.id } })).status).toBe('WAITING');

    await assignConversation({ orgId, conversationId: r.conversation.id, userId: agent1.id, via: 'AUTO' });
    const out = await sendMessage({ orgId, conversationId: r.conversation.id, senderType: 'AGENT', userId: agent1.id, body: 'Olá, sou o atendente.' });
    expect(out.message.status).toBe('SENT');
    expect(sent).toContain('Olá, sou o atendente.');
    expect((await prisma.bvConversation.findUniqueOrThrow({ where: { id: r.conversation.id } })).firstResponseAt).not.toBeNull();

    await transferConversation({ orgId, conversationId: r.conversation.id, toUserId: agent2.id, actorUserId: agent1.id, note: 'especialista' });
    const conv = await prisma.bvConversation.findUniqueOrThrow({ where: { id: r.conversation.id } });
    expect(conv.assignedUserId).toBe(agent2.id);
    expect(conv.transferCount).toBe(1);

    await closeConversation({ orgId, conversationId: r.conversation.id, reason: 'RESOLVED', actorUserId: agent2.id });
    const closed = await prisma.bvConversation.findUniqueOrThrow({ where: { id: r.conversation.id } });
    expect(closed.status).toBe('CLOSED');
    expect((closed.metadata as any).csatPending).toBe(true);
    expect(sent.some((s) => s.includes('0 a 10'))).toBe(true);

    const csat = await ingestInbound({ orgId, channel: 'WHATSAPP', channelRef: '5563977770003', externalId: '5563977770003', message: { body: '9' } });
    expect(csat.csat).toBe(true);
    expect((await prisma.bvConversation.findUniqueOrThrow({ where: { id: r.conversation.id } })).csatScore).toBe(9);
    expect(needs).toEqual(expect.arrayContaining(['ESCALATED']));
  });

  it('cidadão volta dentro da janela → conversa reaberta (não gera novo protocolo)', async () => {
    const a = await ingestInbound({ orgId, channel: 'WHATSAPP', channelRef: '5563966660004', externalId: '5563966660004', message: { body: 'oi' } });
    await closeConversation({ orgId, conversationId: a.conversation.id, reason: 'ABANDONED', requestCsat: false });
    const b = await ingestInbound({ orgId, channel: 'WHATSAPP', channelRef: '5563966660004', externalId: '5563966660004', message: { body: 'mais uma dúvida' } });
    expect(b.reopened).toBe(true);
    expect(b.conversation.id).toBe(a.conversation.id);
  });

  it('acesso: atendente só vê as suas/da fila; supervisor vê todas; outro órgão nunca', async () => {
    const ag = await makeUser(orgId, 'ATENDENTE');
    const sup = await makeUser(orgId, 'SUPERVISOR');
    const other = await makeUser((await makeOrg()).id, 'ADMIN');
    const r = await ingestInbound({ orgId, channel: 'WEBCHAT', channelRef: 'v1', externalId: 'v1', message: { body: 'oi' } });
    await assignConversation({ orgId, conversationId: r.conversation.id, userId: sup.id });
    const conv = await prisma.bvConversation.findUniqueOrThrow({ where: { id: r.conversation.id } });
    const ctx = (u: typeof ag) => ({ userId: u.id, orgId: u.orgId, role: u.role as any, name: u.name, email: u.email, via: 'jwt' as const });
    expect(await canAccessConversation(ctx(ag), conv)).toBe(false);
    expect(await canAccessConversation(ctx(sup), conv)).toBe(true);
    expect(await canAccessConversation(ctx(other), conv)).toBe(false);
  });
});

describe('balcao/core — consumo e cotas', () => {
  it('soma consumo e bloqueia quando a cota BLOCK é atingida', async () => {
    const orgId = (await makeOrg()).id;
    await recordUsage(orgId, 'WA_SERVICE', 3);
    await recordUsage(orgId, 'WA_SERVICE', 2);
    expect(await getUsage(orgId, 'WA_SERVICE', new Date(Date.now() - 86400_000), new Date())).toBe(5);
    await prisma.bvQuota.create({ data: { orgId, item: 'WA_SERVICE', period: 'DAY', limit: 5n, action: 'BLOCK' } });
    const [q] = await checkQuota(orgId, 'WA_SERVICE', 1);
    expect(q.allowed).toBe(false);
    expect(q.alert).toBe(true);
  });
});

describe('balcao/core — http', () => {
  it('prefixos do plugin raiz e autenticação', async () => {
    const app = await buildBalcaoTestApp();
    expect((await app.inject({ method: 'GET', url: '/balcao/health' })).statusCode).toBe(200);
    await app.close();
  });
  it('prefix "/" aninhado não gera "//"', async () => {
    const app = Fastify();
    await app.register(async (root) => {
      await root.register(async (child) => { child.get('/auth/ping', async () => ({ ok: 1 })); }, { prefix: '/' });
    }, { prefix: '/balcao' });
    expect((await app.inject({ url: '/balcao/auth/ping' })).statusCode).toBe(200);
    await app.close();
  });
  it('authHeader gera token aceito por bvAuth', async () => {
    const { bvAuth } = await import('../http');
    const org = await makeOrg(); const u = await makeUser(org.id, 'ADMIN');
    const app = Fastify(); app.get('/x', { preHandler: bvAuth }, async (req) => ({ role: req.bv?.role }));
    const ok = await app.inject({ url: '/x', headers: authHeader(u) });
    expect(ok.json()).toEqual({ role: 'ADMIN' });
    expect((await app.inject({ url: '/x' })).statusCode).toBe(401);
    await app.close();
  });
});
