import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../lib/prisma';
import { clearBvEventHandlers } from '../../core/events';
import { ingestInbound } from '../../core/conversations';
import { setContactDocument } from '../../core/contacts';
import { authHeader, buildBalcaoTestApp, makeOrg, makeUser } from '../../core/testing';
import { unregisterRoutingHandlers } from '../handlers';
import { validDocument } from '../routes/contacts';
import { installSenders, makeQueue, onlineAgent, removeSenders, setup, waitingConv } from './helpers';

let app: FastifyInstance;
beforeAll(async () => { installSenders(); app = await buildBalcaoTestApp(); unregisterRoutingHandlers(); });
afterAll(async () => { await app.close(); removeSenders(); clearBvEventHandlers(); });

type U = Awaited<ReturnType<typeof makeUser>>;
const call = async (u: U, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) => {
  const r = await app.inject({ method, url: `/balcao${url}`, headers: authHeader(u), payload: payload as any });
  let json: any = null; try { json = r.json(); } catch { /* sem corpo */ }
  return { status: r.statusCode, json, raw: r };
};

function multipartBody(filename: string, mime: string, content: Buffer) {
  const boundary = '----bvtest' + Math.random().toString(16).slice(2);
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`);
  return { payload: Buffer.concat([head, content, Buffer.from(`\r\n--${boundary}--\r\n`)]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

describe('routing/REST — conversas (fluxo completo)', () => {
  it('lista, abre (audita), responde, nota, anexa, transfere, fecha; sem vazar corpo cifrado', async () => {
    const orgId = await setup();
    const ag = await onlineAgent(orgId); const ag2 = await onlineAgent(orgId);
    const q = await makeQueue(orgId, {}, [ag.id, ag2.id]);
    const r = await ingestInbound({ orgId, channel: 'WHATSAPP', channelRef: '5563911110001', externalId: '5563911110001', name: 'Maria', message: { body: 'Preciso da certidão do processo 123' } });
    await prisma.bvConversation.update({ where: { id: r.conversation.id }, data: { status: 'WAITING', queuedAt: new Date(), queueId: q.id } });
    const id = r.conversation.id;

    const list = await call(ag, 'GET', '/conversations?status=WAITING&unassigned=true');
    expect(list.status).toBe(200);
    expect(list.json.items.map((c: any) => c.id)).toContain(id);
    expect(JSON.stringify(list.json)).not.toContain('metadata');

    expect((await call(ag, 'POST', `/conversations/${id}/messages`, { text: 'oi' })).status).toBe(403); // ainda não é dele
    const pick = await call(ag, 'POST', `/conversations/${id}/pickup`);
    expect(pick.status).toBe(200);
    expect(pick.json.conversation.assignedUserId).toBe(ag.id);
    expect((await call(ag2, 'POST', `/conversations/${id}/pickup`)).status).toBe(403); // já atribuída a outro: some da caixa do colega

    const detail = await call(ag, 'GET', `/conversations/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.json.messages[0].body).toBe('Preciso da certidão do processo 123');
    expect(detail.raw.body).not.toMatch(/"body":"[A-Za-z0-9+/=]{40,}"/); // nunca o texto cifrado
    expect(await prisma.bvAuditLog.count({ where: { orgId, action: 'conversation.read', entityId: id } })).toBe(1);

    const sent = await call(ag, 'POST', `/conversations/${id}/messages`, { text: 'Olá Maria, já vou verificar.' });
    expect(sent.status).toBe(201);
    expect(sent.json.message.senderType).toBe('AGENT');
    expect((await call(ag, 'POST', `/conversations/${id}/notes`, { text: 'cidadã idosa' })).status).toBe(201);

    // anexo: sobe, devolve descritor, usa na mensagem e baixa
    const png = Buffer.concat([Buffer.from([0x89]), Buffer.from('PNG\r\n\x1a\n'), Buffer.alloc(64)]);
    const mp = multipartBody('foto.png', 'image/png', png);
    const up = await app.inject({ method: 'POST', url: `/balcao/conversations/${id}/attachments`, headers: { ...authHeader(ag), ...mp.headers }, payload: mp.payload });
    expect(up.statusCode).toBe(201);
    const att = up.json().attachment;
    expect(att).toMatchObject({ name: 'foto.png', mime: 'image/png', size: png.length });
    expect(att.sha256).toHaveLength(64);
    expect((await call(ag, 'POST', `/conversations/${id}/messages`, { attachments: [att] })).status).toBe(201);
    const dl = await app.inject({ method: 'GET', url: `/balcao/conversations/${id}/attachments/${att.key}`, headers: authHeader(ag) });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-type']).toBe('image/png');
    expect(String(dl.headers['content-disposition'])).toContain('attachment');
    expect(dl.rawPayload.equals(png)).toBe(true);
    // chave inventada / de outra conversa
    expect((await app.inject({ method: 'GET', url: `/balcao/conversations/${id}/attachments/${orgId}/attachments/2026/01/x.png`, headers: authHeader(ag) })).statusCode).toBe(404);
    expect((await call(ag, 'POST', `/conversations/${id}/messages`, { attachments: [{ ...att, key: `${orgId}/attachments/2026/01/x.png` }] })).status).toBe(400);

    expect((await call(ag, 'POST', `/conversations/${id}/read`)).status).toBe(200);
    expect((await prisma.bvConversation.findUniqueOrThrow({ where: { id } })).unreadForAgent).toBe(0);

    const tr = await call(ag, 'POST', `/conversations/${id}/transfer`, { toUserId: ag2.id, note: 'especialista' });
    expect(tr.status).toBe(200);
    expect(tr.json.conversation.assignedUserId).toBe(ag2.id);
    expect((await call(ag, 'POST', `/conversations/${id}/close`, { reason: 'RESOLVED' })).status).toBe(403); // não é mais dele
    const trBad = await call(ag2, 'POST', `/conversations/${id}/transfer`, { toUserId: 'x', toQueueId: 'y' });
    expect(trBad.status).toBe(400);
    const closed = await call(ag2, 'POST', `/conversations/${id}/close`, { reason: 'RESOLVED' });
    expect(closed.status).toBe(200);
    expect(closed.json.conversation.status).toBe('CLOSED');
    expect((await call(ag2, 'POST', `/conversations/${id}/messages`, { text: 'tarde' })).status).toBe(409);
  });

  it('pickup concorrente: dois atendentes puxando a mesma conversa — só um vence', async () => {
    const orgId = await setup();
    const a = await onlineAgent(orgId); const b = await onlineAgent(orgId);
    await makeQueue(orgId, {}, [a.id, b.id]);
    const c = await waitingConv(orgId);
    const [ra, rb] = await Promise.all([call(a, 'POST', `/conversations/${c.id}/pickup`), call(b, 'POST', `/conversations/${c.id}/pickup`)]);
    expect([ra.status, rb.status].sort()).toEqual([200, 409]);
    expect(await prisma.bvConversationEvent.count({ where: { conversationId: c.id, type: 'ASSIGNED' } })).toBe(1);
  });

  it('anexo: rejeita tipo proibido, conteúdo que não confere e arquivo > 15 MB', async () => {
    const orgId = await setup();
    const ag = await onlineAgent(orgId);
    const c = await waitingConv(orgId);
    await prisma.bvConversation.update({ where: { id: c.id }, data: { status: 'ACTIVE', assignedUserId: ag.id } });
    const post = (m: ReturnType<typeof multipartBody>) => app.inject({ method: 'POST', url: `/balcao/conversations/${c.id}/attachments`, headers: { ...authHeader(ag), ...m.headers }, payload: m.payload });
    expect((await post(multipartBody('x.html', 'text/html', Buffer.from('<script>')))).statusCode).toBe(415);
    expect((await post(multipartBody('x.svg', 'image/svg+xml', Buffer.from('<svg/>')))).statusCode).toBe(415);
    expect((await post(multipartBody('falso.png', 'image/png', Buffer.from('not a png at all')))).statusCode).toBe(415);
    expect((await post(multipartBody('grande.pdf', 'application/pdf', Buffer.concat([Buffer.from('%PDF-1.4'), Buffer.alloc(15 * 1024 * 1024 + 10)])))).statusCode).toBe(413);
    expect((await post(multipartBody('ok.pdf', 'application/pdf', Buffer.from('%PDF-1.4 conteudo')))).statusCode).toBe(201);
  });

  it('permissões: atendente não vê conversa alheia nem de fila de que não é membro; supervisor vê tudo', async () => {
    const orgId = await setup();
    const a = await onlineAgent(orgId); const b = await onlineAgent(orgId); const sup = await makeUser(orgId, 'SUPERVISOR');
    const qa = await makeQueue(orgId, { slug: 'qa' }, [a.id]);
    const qb = await makeQueue(orgId, { slug: 'qb' }, [b.id]);
    const mine = await waitingConv(orgId); const theirs = await waitingConv(orgId); const queued = await waitingConv(orgId); const otherQueue = await waitingConv(orgId);
    await prisma.bvConversation.update({ where: { id: mine.id }, data: { status: 'ACTIVE', assignedUserId: a.id } });
    await prisma.bvConversation.update({ where: { id: theirs.id }, data: { status: 'ACTIVE', assignedUserId: b.id } });
    await prisma.bvConversation.update({ where: { id: queued.id }, data: { queueId: qa.id } });
    await prisma.bvConversation.update({ where: { id: otherQueue.id }, data: { queueId: qb.id } });
    const ids = async (u: U, path = '/conversations') => (await call(u, 'GET', path)).json.items.map((x: any) => x.id).sort();
    expect(await ids(a)).toEqual([mine.id, queued.id].sort());
    expect((await call(a, 'GET', `/conversations/${theirs.id}`)).status).toBe(403);
    expect((await call(a, 'GET', `/conversations/${otherQueue.id}`)).status).toBe(403);
    expect((await call(a, 'POST', `/conversations/${theirs.id}/messages`, { text: 'x' })).status).toBe(403);
    expect((await call(a, 'GET', '/supervisor/overview')).status).toBe(403);
    expect((await call(a, 'POST', `/conversations/${theirs.id}/assign`, { userId: a.id })).status).toBe(403);
    expect((await ids(sup)).length).toBe(4);
    expect((await call(sup, 'GET', `/conversations/${theirs.id}`)).status).toBe(200);
    expect((await call(sup, 'GET', `/conversations?mine=true`)).json.items).toHaveLength(0);
    const fiscal = await makeUser(orgId, 'FISCAL');
    expect((await call(fiscal, 'GET', '/conversations')).status).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/balcao/conversations' })).statusCode).toBe(401);
  });

  it('paginação por cursor e filtros (canal, protocolo, status)', async () => {
    const orgId = await setup();
    const sup = await makeUser(orgId, 'SUPERVISOR');
    const made = [];
    for (let i = 0; i < 5; i++) made.push(await waitingConv(orgId, { channel: i % 2 ? 'EMAIL' : 'WEBCHAT' }));
    const p1 = await call(sup, 'GET', '/conversations?limit=2');
    expect(p1.json.items).toHaveLength(2); expect(p1.json.nextCursor).toBeTruthy();
    const p2 = await call(sup, 'GET', `/conversations?limit=2&cursor=${p1.json.nextCursor}`);
    const p3 = await call(sup, 'GET', `/conversations?limit=2&cursor=${p2.json.nextCursor}`);
    const all = [...p1.json.items, ...p2.json.items, ...p3.json.items].map((x: any) => x.id);
    expect(new Set(all).size).toBe(5); expect(p3.json.nextCursor).toBeNull();
    expect((await call(sup, 'GET', '/conversations?channel=EMAIL')).json.items).toHaveLength(2);
    expect((await call(sup, 'GET', `/conversations?protocol=${made[0].protocol}`)).json.items).toHaveLength(1);
    expect((await call(sup, 'GET', '/conversations?status=CLOSED')).json.items).toHaveLength(0);
    const pr = await call(sup, 'GET', '/conversations?sort=priority&limit=3');
    expect(pr.json.items).toHaveLength(3); expect(pr.json.nextCursor).toBeTruthy();
  });

  it('atribuição manual e takeover da supervisão; pickup respeita capacidade', async () => {
    const orgId = await setup();
    const sup = await makeUser(orgId, 'SUPERVISOR'); const a = await onlineAgent(orgId, { maxConcurrent: 1 });
    await makeQueue(orgId, {}, [a.id]);
    const c1 = await waitingConv(orgId); const c2 = await waitingConv(orgId);
    expect((await call(a, 'POST', `/conversations/${c1.id}/pickup`)).status).toBe(200);
    const full = await call(a, 'POST', `/conversations/${c2.id}/pickup`);
    expect(full.status).toBe(409); expect(full.json.error.code).toBe('agent.at_capacity');
    expect((await call(sup, 'POST', `/conversations/${c2.id}/assign`, { userId: a.id })).json.conversation.assignedUserId).toBe(a.id);
    const take = await call(sup, 'POST', `/supervisor/conversations/${c1.id}/takeover`);
    expect(take.status).toBe(200);
    expect((await prisma.bvConversation.findUniqueOrThrow({ where: { id: c1.id } })).assignedUserId).toBe(sup.id);
    expect(await prisma.bvConversationEvent.count({ where: { conversationId: c1.id, type: 'TAKEOVER' } })).toBe(1);
    expect((await call(sup, 'POST', `/conversations/${c1.id}/assign`, { userId: 'inexistente' })).status).toBe(404);
  });
});

describe('routing/REST — filas e regras', () => {
  it('CRUD de fila com auditoria e versão; valida overflow e ciclos; membros', async () => {
    const orgId = await setup();
    const sup = await makeUser(orgId, 'SUPERVISOR'); const ag = await makeUser(orgId, 'ATENDENTE'); const other = await makeUser((await makeOrg()).id, 'ATENDENTE');
    const created = await call(sup, 'POST', '/queues', { name: 'Atendimento Geral', categories: ['PROCESSO'], strategy: 'ROUND_ROBIN', maxWaitSec: 120, businessHours: { mon: [['08:00', '12:00']] }, memberIds: [ag.id] });
    expect(created.status).toBe(201);
    const q1 = created.json.queue;
    expect(q1.slug).toBe('atendimento-geral');
    expect(await prisma.bvConfigVersion.count({ where: { entityType: 'queue', entityId: q1.id } })).toBe(1);
    expect(await prisma.bvAuditLog.count({ where: { orgId, action: 'queue.create', entityId: q1.id } })).toBe(1);
    expect((await call(sup, 'POST', '/queues', { name: 'Outra', slug: 'atendimento-geral' })).status).toBe(409);
    expect((await call(sup, 'POST', '/queues', { name: 'X', businessHours: { mon: [['25:00', '26:00']] } })).status).toBe(400);
    expect((await call(sup, 'POST', '/queues', { name: 'X', memberIds: [other.id] })).status).toBe(400);

    const q2 = (await call(sup, 'POST', '/queues', { name: 'Plantão', overflowQueueId: q1.id })).json.queue;
    expect(q2.overflowQueueId).toBe(q1.id);
    const cyc = await call(sup, 'PATCH', `/queues/${q1.id}`, { overflowQueueId: q2.id });
    expect(cyc.status).toBe(400); expect(cyc.json.error.code).toBe('queue.invalid_overflow');
    expect((await call(sup, 'PATCH', `/queues/${q1.id}`, { overflowQueueId: q1.id })).status).toBe(400);
    expect((await call(sup, 'PATCH', `/queues/${q1.id}`, { overflowQueueId: 'inexistente' })).status).toBe(400);
    const upd = await call(sup, 'PATCH', `/queues/${q1.id}`, { priority: 7, active: true });
    expect(upd.json.queue.priority).toBe(7);
    expect(await prisma.bvConfigVersion.count({ where: { entityType: 'queue', entityId: q1.id } })).toBe(2);

    expect((await call(sup, 'PUT', `/queues/${q1.id}/members`, { userIds: [ag.id, sup.id] })).json.userIds.sort()).toEqual([ag.id, sup.id].sort());
    expect((await call(sup, 'DELETE', `/queues/${q1.id}/members/${sup.id}`)).status).toBe(204);
    expect((await call(sup, 'GET', `/queues/${q1.id}/members`)).json.items.map((u: any) => u.id)).toEqual([ag.id]);
    expect((await call(sup, 'PUT', `/queues/${q1.id}/members`, { userIds: [other.id] })).status).toBe(400);
    expect((await call(ag, 'GET', '/queues')).json.items.length).toBe(2); // atendente lista (para transferir)
    expect((await call(ag, 'POST', '/queues', { name: 'Z' })).status).toBe(403);
    expect((await call(ag, 'GET', `/queues/${q1.id}`)).json.queue.members).toBeUndefined();

    expect((await call(sup, 'DELETE', `/queues/${q1.id}`)).status).toBe(409); // q2 aponta overflow para ela
    expect((await call(sup, 'DELETE', `/queues/${q2.id}`)).status).toBe(204);
    expect((await call(sup, 'DELETE', `/queues/${q1.id}`)).status).toBe(204);
  });

  it('regras: CRUD, posição, reordenação, simulação; isolamento entre órgãos', async () => {
    const orgId = await setup();
    const sup = await makeUser(orgId, 'SUPERVISOR');
    const q = (await call(sup, 'POST', '/queues', { name: 'A' })).json.queue; const q2 = (await call(sup, 'POST', '/queues', { name: 'B', priority: 4 })).json.queue;
    const r1 = (await call(sup, 'POST', '/routing-rules', { name: 'r1', conditions: { channels: ['EMAIL'] }, action: { queueId: q.id } })).json.rule;
    const r2 = (await call(sup, 'POST', '/routing-rules', { name: 'r2', conditions: { contactCategories: ['MP'] }, action: { queueId: q2.id, priorityBoost: 2 } })).json.rule;
    const r3 = (await call(sup, 'POST', '/routing-rules', { name: 'r3', position: 0, action: { queueId: q.id } })).json.rule;
    const order = async () => (await call(sup, 'GET', '/routing-rules')).json.items.map((r: any) => r.id);
    expect(await order()).toEqual([r3.id, r1.id, r2.id]);
    expect((await call(sup, 'POST', '/routing-rules', { name: 'x', conditions: { foo: 1 }, action: { queueId: q.id } })).status).toBe(400);
    expect((await call(sup, 'POST', '/routing-rules', { name: 'x', action: { queueId: 'nope' } })).status).toBe(400);
    expect((await call(sup, 'POST', '/routing-rules/reorder', { ids: [r2.id, r1.id] })).status).toBe(400);
    expect((await call(sup, 'POST', '/routing-rules/reorder', { ids: [r2.id, r3.id, r1.id] })).status).toBe(200);
    expect(await order()).toEqual([r2.id, r3.id, r1.id]);
    expect((await call(sup, 'PATCH', `/routing-rules/${r1.id}`, { position: 0, active: true })).status).toBe(200);
    expect(await order()).toEqual([r1.id, r2.id, r3.id]);
    expect(await prisma.bvConfigVersion.count({ where: { entityType: 'routing-rule', entityId: r1.id } })).toBeGreaterThanOrEqual(3);
    const sim = await call(sup, 'POST', '/routing-rules/test', { channel: 'WEBCHAT', contactCategory: 'MP' });
    expect(sim.json).toMatchObject({ ruleId: r2.id, queueId: q2.id, priority: 4 + 2 + 3 });
    expect((await call(sup, 'DELETE', `/routing-rules/${r3.id}`)).status).toBe(204);
    expect((await call(sup, 'DELETE', `/queues/${q2.id}`)).status).toBe(409); // regra usa a fila

    const foreign = await makeUser((await makeOrg()).id, 'ADMIN');
    expect((await call(foreign, 'GET', `/routing-rules/${r1.id}`)).status).toBe(404);
    expect((await call(foreign, 'PATCH', `/queues/${q.id}`, { priority: 99 })).status).toBe(404);
    expect((await call(foreign, 'POST', '/routing-rules', { name: 'x', action: { queueId: q.id } })).status).toBe(400);
    expect((await call(foreign, 'GET', '/routing-rules')).json.items).toHaveLength(0);
  });
});

describe('routing/REST — agentes e supervisão', () => {
  it('presença, lista de agentes e overview em tempo real', async () => {
    const orgId = await setup();
    const sup = await makeUser(orgId, 'SUPERVISOR'); const a = await makeUser(orgId, 'ATENDENTE', { maxConcurrent: 1 }); const b = await makeUser(orgId, 'ATENDENTE');
    const q = await makeQueue(orgId, { name: 'Geral', slug: 'geral', maxWaitSec: 60 }, [a.id, b.id]);
    expect((await call(a, 'PUT', '/agents/me/presence', { presence: 'ONLINE' })).status).toBe(200);
    expect((await call(b, 'PUT', '/agents/me/presence', { presence: 'AWAY' })).status).toBe(200);
    expect((await call(a, 'PUT', '/agents/me/presence', { presence: 'INVALIDO' })).status).toBe(400);
    expect((await call(a, 'GET', '/agents')).status).toBe(403);
    const list = await call(sup, 'GET', '/agents?presence=ONLINE');
    expect(list.json.items.map((x: any) => x.id)).toEqual([a.id]);

    const active = await waitingConv(orgId); const w1 = await waitingConv(orgId, { queuedAt: new Date(Date.now() - 90_000) }); const w2 = await waitingConv(orgId);
    await prisma.bvConversation.update({ where: { id: active.id }, data: { status: 'ACTIVE', assignedUserId: a.id, queueId: q.id } });
    await prisma.bvConversation.updateMany({ where: { id: { in: [w1.id, w2.id] } }, data: { queueId: q.id } });
    await prisma.bvConversation.update({ where: { id: w1.id }, data: { slaBreached: true } });
    const ov = (await call(sup, 'GET', '/supervisor/overview')).json;
    const qrow = ov.queues.find((x: any) => x.queueId === q.id);
    expect(qrow).toMatchObject({ waiting: 2, active: 1, agentsOnline: 1, agentsBusy: 1, agentsAvailable: 0 });
    expect(qrow.longestWaitSec).toBeGreaterThanOrEqual(90);
    expect(ov.agents.find((x: any) => x.userId === a.id)).toMatchObject({ presence: 'ONLINE', load: 1 });
    expect(ov.agents.find((x: any) => x.userId === a.id).conversations.map((c: any) => c.id)).toEqual([active.id]);
    expect(ov.slaBreaches.map((c: any) => c.id)).toEqual([w1.id]);
    const mon = await call(sup, 'GET', '/supervisor/conversations');
    expect(mon.json.items).toHaveLength(3);
    expect((await call(sup, 'GET', '/supervisor/conversations?slaBreached=true')).json.items).toHaveLength(1);
    // outro órgão não enxerga nada
    const foreign = await makeUser((await makeOrg()).id, 'SUPERVISOR');
    const fo = (await call(foreign, 'GET', '/supervisor/overview')).json;
    expect(fo.totals).toMatchObject({ waiting: 0, active: 0, slaBreached: 0 });
    expect((await call(foreign, 'GET', '/supervisor/conversations')).json.items).toHaveLength(0);
    expect((await call(foreign, 'POST', `/supervisor/conversations/${w1.id}/takeover`)).status).toBe(404);
  });
});

describe('routing/REST — contatos e respostas prontas', () => {
  it('busca, histórico entre canais, PATCH, documento (CPF válido) mascarado, merge e auditoria', async () => {
    const orgId = await setup({ contactCategories: ['CIDADAO', 'ADVOGADO'] });
    const ag = await makeUser(orgId, 'ATENDENTE'); const sup = await makeUser(orgId, 'SUPERVISOR');
    const wa = await ingestInbound({ orgId, channel: 'WHATSAPP', channelRef: '5563922220001', externalId: '5563922220001', name: 'João Silva', message: { body: 'oi' } });
    const em = await ingestInbound({ orgId, channel: 'EMAIL', channelRef: 'm1', externalId: 'joao.dup@exemplo.com', name: 'João S.', message: { body: 'e-mail' } });
    expect(wa.contactId).not.toBe(em.contactId);

    const s1 = await call(ag, 'GET', '/contacts?q=silva');
    expect(s1.json.items.map((c: any) => c.id)).toEqual([wa.contactId]);
    expect((await call(ag, 'GET', '/contacts?q=63922220001')).json.items).toHaveLength(1);
    expect((await call(ag, 'GET', `/contacts?q=${wa.conversation.protocol}`)).json.items.map((c: any) => c.id)).toEqual([wa.contactId]);

    expect((await call(ag, 'POST', `/contacts/${wa.contactId}/document`, { document: '111.111.111-11' })).status).toBe(400);
    const cpf = '529.982.247-25';
    expect(validDocument(cpf)).toBe(true);
    const setDoc = await call(ag, 'POST', `/contacts/${wa.contactId}/document`, { document: cpf });
    expect(setDoc.status).toBe(200); expect(setDoc.json.document).not.toContain('529');
    expect((await call(ag, 'GET', `/contacts?q=${cpf}`)).json.items).toHaveLength(1); // busca por documento (índice cego)
    expect((await call(ag, 'POST', `/contacts/${em.contactId}/document`, { document: cpf })).status).toBe(409);

    const det = await call(ag, 'GET', `/contacts/${wa.contactId}`);
    expect(det.json.contact.document).toBe('***.982.***-**');
    expect(det.raw.body).not.toContain('52998224725');
    expect((await call(ag, 'GET', `/contacts/${wa.contactId}?reveal=1`)).status).toBe(403);
    expect((await call(sup, 'GET', `/contacts/${wa.contactId}?reveal=1`)).json.contact.document).toBe('52998224725');
    expect(await prisma.bvAuditLog.count({ where: { orgId, action: 'contact.document.reveal' } })).toBe(1);
    expect(await prisma.bvAuditLog.count({ where: { orgId, action: 'contact.read' } })).toBe(2);

    const pat = await call(ag, 'PATCH', `/contacts/${wa.contactId}`, { category: 'ADVOGADO', tags: ['vip', 'vip'], email: 'JOAO@Exemplo.com' });
    expect(pat.json.contact).toMatchObject({ category: 'ADVOGADO', tags: ['vip'], email: 'joao@exemplo.com' });
    expect((await call(ag, 'PATCH', `/contacts/${wa.contactId}`, { category: 'INEXISTENTE' })).status).toBe(400);
    expect((await call(ag, 'GET', '/contacts/categories')).json.items).toEqual(['CIDADAO', 'ADVOGADO']);

    expect((await call(ag, 'POST', '/contacts/merge', { intoId: wa.contactId, fromId: em.contactId })).status).toBe(403);
    expect((await call(sup, 'POST', '/contacts/merge', { intoId: wa.contactId, fromId: wa.contactId })).status).toBe(400);
    expect((await call(sup, 'POST', '/contacts/merge', { intoId: wa.contactId, fromId: em.contactId })).status).toBe(200);
    const merged = await call(ag, 'GET', `/contacts/${wa.contactId}`);
    expect(merged.json.conversations.map((c: any) => c.channel).sort()).toEqual(['EMAIL', 'WHATSAPP']); // histórico unificado
    expect(merged.json.contact.identities).toHaveLength(2);
    const gone = await call(ag, 'GET', `/contacts/${em.contactId}`);
    expect(gone.status).toBe(404); expect(gone.json.error.details.mergedIntoId).toBe(wa.contactId);

    const foreign = await makeUser((await makeOrg()).id, 'ADMIN');
    expect((await call(foreign, 'GET', `/contacts/${wa.contactId}`)).status).toBe(404);
    expect((await call(foreign, 'GET', '/contacts?q=silva')).json.items).toHaveLength(0);
    expect((await call(foreign, 'POST', '/contacts/merge', { intoId: wa.contactId, fromId: em.contactId })).status).toBe(404);
  });

  it('documento já gravado nunca é devolvido por conversa; GET /:id mascara', async () => {
    const orgId = await setup();
    const ag = await onlineAgent(orgId);
    const c = await waitingConv(orgId);
    await prisma.bvConversation.update({ where: { id: c.id }, data: { status: 'ACTIVE', assignedUserId: ag.id } });
    await setContactDocument(c.contactId, '52998224725');
    const d = await call(ag, 'GET', `/conversations/${c.id}`);
    expect(d.json.contact.document).toBe('***.982.***-**');
    expect(d.raw.body).not.toContain('52998224725');
  });

  it('respostas prontas: CRUD, atalho único por órgão, escrita só para gestão', async () => {
    const orgId = await setup(); const org2 = await setup();
    const sup = await makeUser(orgId, 'SUPERVISOR'); const ag = await makeUser(orgId, 'ATENDENTE'); const sup2 = await makeUser(org2, 'SUPERVISOR');
    const c = await call(sup, 'POST', '/canned-responses', { shortcut: '/Bom-Dia', title: 'Saudação', body: 'Bom dia! Em que posso ajudar?' });
    expect(c.status).toBe(201); expect(c.json.item.shortcut).toBe('bom-dia');
    expect((await call(sup, 'POST', '/canned-responses', { shortcut: 'bom-dia', title: 'x', body: 'y' })).status).toBe(409);
    expect((await call(sup2, 'POST', '/canned-responses', { shortcut: 'bom-dia', title: 'x', body: 'y' })).status).toBe(201); // outro órgão pode repetir
    expect((await call(ag, 'POST', '/canned-responses', { shortcut: 'z', title: 'x', body: 'y' })).status).toBe(403);
    expect((await call(ag, 'GET', '/canned-responses?q=bom')).json.items).toHaveLength(1);
    expect((await call(sup, 'PATCH', `/canned-responses/${c.json.item.id}`, { body: 'Olá!' })).json.item.body).toBe('Olá!');
    expect((await call(sup2, 'PATCH', `/canned-responses/${c.json.item.id}`, { body: 'hack' })).status).toBe(404);
    expect((await call(sup, 'DELETE', `/canned-responses/${c.json.item.id}`)).status).toBe(204);
    expect((await call(ag, 'GET', '/canned-responses')).json.items).toHaveLength(0);
  });
});
