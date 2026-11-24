import net from 'net';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../lib/prisma';
import { ChannelSendError, registerChannelSender } from '../../core/channels';
import { clearBvEventHandlers } from '../../core/events';
import { createMessage } from '../../core/messages';
import { authHeader, buildBalcaoTestApp, makeUser } from '../../core/testing';
import { unregisterRoutingHandlers } from '../handlers';
import { installSenders, makeQueue, removeSenders, setup, waitingConv } from './helpers';

jest.setTimeout(60_000);

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
/** Conversa ACTIVE atribuída ao usuário. */
async function activeConv(orgId: string, userId: string, queueId?: string) {
  const c = await waitingConv(orgId);
  return prisma.bvConversation.update({ where: { id: c.id }, data: { status: 'ACTIVE', assignedUserId: userId, assignedAt: new Date(), ...(queueId ? { queueId } : {}) } });
}

describe('routing — respostas prontas pessoais', () => {
  it('atendente gerencia as SUAS; as do órgão exigem queue:manage; pessoal de A nunca aparece para B', async () => {
    const orgId = await setup(); const org2 = await setup();
    const sup = await makeUser(orgId, 'SUPERVISOR'); const a = await makeUser(orgId, 'ATENDENTE'); const b = await makeUser(orgId, 'ATENDENTE');
    const other = await makeUser(org2, 'ATENDENTE');

    const org = await call(sup, 'POST', '/canned-responses', { shortcut: 'bom-dia', title: 'Saudação', body: 'Bom dia do órgão' });
    expect(org.status).toBe(201); expect(org.json.item).toMatchObject({ scope: 'ORG', ownerId: null });
    // atendente não cria/edita/exclui do órgão
    expect((await call(a, 'POST', '/canned-responses', { shortcut: 'x', title: 'x', body: 'y', scope: 'ORG' })).status).toBe(403);
    expect((await call(a, 'PATCH', `/canned-responses/${org.json.item.id}`, { body: 'hack' })).status).toBe(403);
    expect((await call(a, 'DELETE', `/canned-responses/${org.json.item.id}`)).status).toBe(403);

    // cria pessoal (padrão do atendente); atalho único por dono
    const mine = await call(a, 'POST', '/canned-responses', { shortcut: '/Ola', title: 'Olá', body: 'Olá, A' });
    expect(mine.status).toBe(201); expect(mine.json.item).toMatchObject({ scope: 'PERSONAL', ownerId: a.id, shortcut: 'ola' });
    expect((await call(a, 'POST', '/canned-responses', { shortcut: 'ola', title: 'x', body: 'y' })).status).toBe(409);
    expect((await call(b, 'POST', '/canned-responses', { shortcut: 'ola', title: 'Olá B', body: 'Olá, B' })).status).toBe(201); // outro dono pode repetir

    // pessoal sobrescreve o do órgão (mesmo atalho) e vem primeiro
    const mineOverride = await call(a, 'POST', '/canned-responses', { shortcut: 'bom-dia', title: 'Meu bom dia', body: 'Bom dia, A' });
    expect(mineOverride.status).toBe(201);
    const listA = (await call(a, 'GET', '/canned-responses')).json.items as any[];
    expect(listA.map((i) => `${i.scope}:${i.shortcut}`)).toEqual(['PERSONAL:bom-dia', 'PERSONAL:ola']); // o do órgão "bom-dia" foi sobrescrito
    expect(listA[0]).toMatchObject({ body: 'Bom dia, A', shadowsOrg: true });
    const all = (await call(a, 'GET', '/canned-responses?includeShadowed=true')).json.items as any[];
    expect(all.map((i) => `${i.scope}:${i.shortcut}`)).toEqual(['PERSONAL:bom-dia', 'PERSONAL:ola', 'ORG:bom-dia']);

    // B vê as do órgão + as dele, nunca as de A
    const listB = (await call(b, 'GET', '/canned-responses')).json.items as any[];
    expect(listB.map((i) => `${i.scope}:${i.shortcut}:${i.body}`)).toEqual(['PERSONAL:ola:Olá, B', 'ORG:bom-dia:Bom dia do órgão']);
    expect(JSON.stringify(listB)).not.toContain(a.id);
    // supervisor também só vê as pessoais dele
    expect((await call(sup, 'GET', '/canned-responses')).json.items).toHaveLength(1);
    // busca
    expect((await call(a, 'GET', '/canned-responses?q=ola')).json.items).toHaveLength(1);

    // B não altera nem exclui a pessoal de A (404, sem revelar); nem outro órgão
    expect((await call(b, 'PATCH', `/canned-responses/${mine.json.item.id}`, { body: 'hack' })).status).toBe(404);
    expect((await call(b, 'DELETE', `/canned-responses/${mine.json.item.id}`)).status).toBe(404);
    expect((await call(sup, 'DELETE', `/canned-responses/${mine.json.item.id}`)).status).toBe(404); // nem a gestão enxerga a pessoal alheia
    expect((await call(other, 'PATCH', `/canned-responses/${org.json.item.id}`, { body: 'hack' })).status).toBe(404);
    expect((await call(other, 'GET', '/canned-responses')).json.items).toHaveLength(0);

    // A edita e exclui a sua; atalho duplicado no PATCH → 409
    expect((await call(a, 'PATCH', `/canned-responses/${mine.json.item.id}`, { body: 'Olá novo' })).json.item.body).toBe('Olá novo');
    expect((await call(a, 'PATCH', `/canned-responses/${mine.json.item.id}`, { shortcut: 'bom-dia' })).status).toBe(409);
    expect((await call(a, 'DELETE', `/canned-responses/${mine.json.item.id}`)).status).toBe(204);
    // a gestão ainda edita/exclui a do órgão e cria pessoal com scope explícito
    expect((await call(sup, 'PATCH', `/canned-responses/${org.json.item.id}`, { body: 'Olá!' })).json.item.body).toBe('Olá!');
    expect((await call(sup, 'POST', '/canned-responses', { shortcut: 'meu', title: 'm', body: 'm', scope: 'PERSONAL' })).json.item.scope).toBe('PERSONAL');
    expect((await call(sup, 'POST', '/canned-responses', { shortcut: 'bom-dia', title: 'x', body: 'y' })).status).toBe(409); // do órgão repetido
    expect((await call(sup, 'DELETE', `/canned-responses/${org.json.item.id}`)).status).toBe(204);
    expect(await prisma.bvAuditLog.count({ where: { orgId, action: { startsWith: 'canned-response.' } } })).toBeGreaterThanOrEqual(8);
  });
});

describe('routing — reenvio de mensagem que falhou', () => {
  it('reenvia a MESMA mensagem (sem nova bolha), audita e recusa o que não é elegível', async () => {
    const orgId = await setup();
    const ag = await makeUser(orgId, 'ATENDENTE'); const ag2 = await makeUser(orgId, 'ATENDENTE'); const sup = await makeUser(orgId, 'SUPERVISOR');
    const conv = await activeConv(orgId, ag.id);
    let fail = true; const delivered: Array<{ id: string; body: string | null }> = [];
    registerChannelSender('WEBCHAT', async (r) => {
      if (fail) throw new ChannelSendError('fora do ar', 'channel.unreachable');
      delivered.push({ id: r.message.id, body: r.message.body });
      return { channelMessageId: `ok-${r.message.id}` };
    });

    const sent = await call(ag, 'POST', `/conversations/${conv.id}/messages`, { text: 'Segue o documento' });
    expect(sent.status).toBe(201);
    expect(sent.json.delivery).toEqual({ status: 'FAILED', error: 'channel.unreachable' });
    const id = sent.json.message.id;
    const before = await prisma.bvMessage.count({ where: { conversationId: conv.id } });

    // ainda falhando: continua FAILED, mesma mensagem
    const still = await call(ag, 'POST', `/conversations/${conv.id}/messages/${id}/resend`);
    expect(still.status).toBe(200);
    expect(still.json.delivery).toEqual({ status: 'FAILED', error: 'channel.unreachable' });
    expect(still.json.message.id).toBe(id);

    // outro atendente (sem acesso) não reenvia
    expect((await call(ag2, 'POST', `/conversations/${conv.id}/messages/${id}/resend`)).status).toBe(403);

    fail = false;
    const ok = await call(ag, 'POST', `/conversations/${conv.id}/messages/${id}/resend`);
    expect(ok.status).toBe(200);
    expect(ok.json.delivery).toEqual({ status: 'SENT', error: null });
    expect(ok.json.message).toMatchObject({ id, status: 'SENT', body: 'Segue o documento' });
    expect(ok.json.message.channelMeta).toBeUndefined();
    expect(delivered).toEqual([{ id, body: 'Segue o documento' }]);
    const row = await prisma.bvMessage.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: 'SENT', errorCode: null, channelMessageId: `ok-${id}` });
    expect(await prisma.bvMessage.count({ where: { conversationId: conv.id } })).toBe(before); // sem duplicar a bolha
    expect(await prisma.bvAuditLog.count({ where: { orgId, action: 'conversation.message.resend', entityId: conv.id } })).toBe(2);

    // não elegível: já enviada; nota interna; mensagem do cidadão; inexistente / de outra conversa
    const again = await call(ag, 'POST', `/conversations/${conv.id}/messages/${id}/resend`);
    expect(again.status).toBe(409); expect(again.json.error.code).toBe('message.not_resendable');
    const note = await call(ag, 'POST', `/conversations/${conv.id}/notes`, { text: 'nota' });
    expect((await call(ag, 'POST', `/conversations/${conv.id}/messages/${note.json.message.id}/resend`)).json.error.code).toBe('message.not_resendable');
    const inbound = (await createMessage({ orgId, conversationId: conv.id, direction: 'IN', senderType: 'CONTACT', body: 'oi', status: 'FAILED' })).message;
    expect((await call(ag, 'POST', `/conversations/${conv.id}/messages/${inbound.id}/resend`)).json.error.code).toBe('message.not_resendable');
    expect((await call(ag, 'POST', `/conversations/${conv.id}/messages/inexistente/resend`)).status).toBe(404);
    const conv2 = await activeConv(orgId, ag.id);
    expect((await call(ag, 'POST', `/conversations/${conv2.id}/messages/${id}/resend`)).status).toBe(404);

    // supervisor reenvia mensagem FAILED de outro atendente; atendente colega da conversa não
    const failed = (await createMessage({ orgId, conversationId: conv.id, direction: 'OUT', senderType: 'AGENT', senderUserId: ag2.id, body: 'do colega', status: 'FAILED' })).message;
    expect((await call(ag, 'POST', `/conversations/${conv.id}/messages/${failed.id}/resend`)).json.error.code).toBe('message.not_owner');
    const bySup = await call(sup, 'POST', `/conversations/${conv.id}/messages/${failed.id}/resend`);
    expect(bySup.json.delivery.status).toBe('SENT');

    // conversa encerrada
    const failed2 = (await createMessage({ orgId, conversationId: conv.id, direction: 'OUT', senderType: 'AGENT', senderUserId: ag.id, body: 'x', status: 'FAILED' })).message;
    await prisma.bvConversation.update({ where: { id: conv.id }, data: { status: 'CLOSED', closedAt: new Date() } });
    expect((await call(sup, 'POST', `/conversations/${conv.id}/messages/${failed2.id}/resend`)).json.error.code).toBe('conversation.closed');
    installSenders(); // restaura remetentes padrão
  });

  it('dois reenvios simultâneos: só um chega ao canal', async () => {
    const orgId = await setup();
    const ag = await makeUser(orgId, 'ATENDENTE');
    const conv = await activeConv(orgId, ag.id);
    let calls = 0;
    registerChannelSender('WEBCHAT', async () => { calls++; await new Promise((r) => setTimeout(r, 80)); return {}; });
    const m = (await createMessage({ orgId, conversationId: conv.id, direction: 'OUT', senderType: 'AGENT', senderUserId: ag.id, body: 'x', status: 'FAILED' })).message;
    const rs = await Promise.all([1, 2, 3].map(() => call(ag, 'POST', `/conversations/${conv.id}/messages/${m.id}/resend`)));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(2);
    expect(calls).toBe(1);
    installSenders();
  });
});

describe('routing — paginação do histórico', () => {
  it('padrão: últimas 100 + hasMore/nextBefore; before por id ou ISO; sem pular nem repetir', async () => {
    const orgId = await setup();
    const ag = await makeUser(orgId, 'ATENDENTE');
    const conv = await activeConv(orgId, ag.id);
    const base = Date.now() - 3600_000;
    const ids: string[] = [];
    for (let i = 0; i < 130; i++) {
      // pares com o mesmo createdAt para exercitar o desempate por id
      const m = (await createMessage({ orgId, conversationId: conv.id, direction: i % 2 ? 'OUT' : 'IN', senderType: i % 2 ? 'AGENT' : 'CONTACT', body: `m${i}`, createdAt: new Date(base + Math.floor(i / 2) * 1000) })).message;
      ids.push(m.id);
    }
    const first = await call(ag, 'GET', `/conversations/${conv.id}`);
    expect(first.status).toBe(200);
    expect(first.json.messages).toHaveLength(100);
    expect(first.json.hasMore).toBe(true);
    expect(first.json.messages[99].body).toBe('m129'); // últimas, em ordem cronológica
    expect(first.json.nextBefore).toBe(first.json.messages[0].id);
    expect(first.json.canReply).toBe(true);
    expect(first.json.conversation.id).toBe(conv.id);

    const second = await call(ag, 'GET', `/conversations/${conv.id}?before=${first.json.nextBefore}`);
    expect(second.json.messages).toHaveLength(30);
    expect(second.json.hasMore).toBe(false);
    expect(second.json.nextBefore).toBeNull();
    const seen = [...second.json.messages, ...first.json.messages].map((m: any) => m.body);
    expect(seen).toEqual(Array.from({ length: 130 }, (_, i) => `m${i}`).filter((_, i) => seen.includes(`m${i}`)));
    expect(new Set(seen).size).toBe(130);

    // limite menor e cursor por data ISO
    const lim = await call(ag, 'GET', `/conversations/${conv.id}?limit=10`);
    expect(lim.json.messages.map((m: any) => m.body)).toEqual(Array.from({ length: 10 }, (_, i) => `m${120 + i}`));
    const iso = await call(ag, 'GET', `/conversations/${conv.id}?before=${encodeURIComponent(new Date(base + 5000).toISOString())}&limit=200`);
    expect(iso.json.messages.map((m: any) => m.body)).toEqual(Array.from({ length: 10 }, (_, i) => `m${i}`));
    expect(iso.json.hasMore).toBe(false);

    expect((await call(ag, 'GET', `/conversations/${conv.id}?before=naoexiste`)).status).toBe(400);
    expect((await call(ag, 'GET', `/conversations/${conv.id}?limit=0`)).status).toBe(400);
    expect((await call(ag, 'GET', `/conversations/${conv.id}?limit=201`)).status).toBe(400);
    // id de mensagem de outra conversa não vale como cursor
    const other = await activeConv(orgId, ag.id);
    expect((await call(ag, 'GET', `/conversations/${other.id}?before=${ids[5]}`)).status).toBe(400);
    expect(await prisma.bvAuditLog.count({ where: { orgId, action: 'conversation.read', entityId: conv.id } })).toBe(4); // só leituras bem-sucedidas são auditadas
  });

  it('conversa curta: hasMore=false e o corpo continua decifrado', async () => {
    const orgId = await setup(); const ag = await makeUser(orgId, 'ATENDENTE');
    const conv = await activeConv(orgId, ag.id);
    await createMessage({ orgId, conversationId: conv.id, direction: 'IN', senderType: 'CONTACT', body: 'só uma' });
    const r = await call(ag, 'GET', `/conversations/${conv.id}`);
    expect(r.json).toMatchObject({ hasMore: false, nextBefore: null });
    expect(r.json.messages.map((m: any) => m.body)).toEqual(['só uma']);
  });
});

describe('routing — histórico de versões da configuração', () => {
  it('lista com autor/snapshot e restaura uma versão da fila (valida, audita e versiona)', async () => {
    const orgId = await setup(); const org2 = await setup();
    const sup = await makeUser(orgId, 'SUPERVISOR', { name: 'Sup Um' }); const ag = await makeUser(orgId, 'ATENDENTE'); const sup2 = await makeUser(org2, 'SUPERVISOR');
    const created = await call(sup, 'POST', '/queues', { name: 'Certidões', slug: `cert-${Date.now()}`, priority: 5, slaFirstResponseSec: 600 });
    expect(created.status).toBe(201);
    const qid = created.json.queue.id;
    expect((await call(sup, 'PATCH', `/queues/${qid}`, { priority: 50, slaFirstResponseSec: 120, active: false })).status).toBe(200);
    expect((await call(sup, 'PATCH', `/queues/${qid}`, { name: 'Certidões v3', strategy: 'ROUND_ROBIN' })).status).toBe(200);

    const list = await call(sup, 'GET', `/queues/${qid}/versions`);
    expect(list.status).toBe(200);
    expect(list.json.items.map((v: any) => v.version)).toEqual([3, 2, 1]);
    expect(list.json.items[0]).toMatchObject({ changedBy: { id: sup.id, name: 'Sup Um' }, deleted: false });
    expect(list.json.items[0].snapshot).toMatchObject({ name: 'Certidões v3', strategy: 'ROUND_ROBIN' });
    expect(list.json.items[2].snapshot).toMatchObject({ priority: 5, slaFirstResponseSec: 600 });
    expect((await call(sup, 'GET', `/queues/${qid}/versions?limit=1`)).json.items).toHaveLength(1);

    // permissões e isolamento
    expect((await call(ag, 'GET', `/queues/${qid}/versions`)).status).toBe(403);
    expect((await call(ag, 'POST', `/queues/${qid}/versions/1/restore`)).status).toBe(403);
    expect((await call(sup2, 'GET', `/queues/${qid}/versions`)).status).toBe(404);
    expect((await call(sup2, 'POST', `/queues/${qid}/versions/1/restore`)).status).toBe(404);
    expect((await call(sup, 'POST', `/queues/${qid}/versions/99/restore`)).json.error.code).toBe('version.not_found');
    expect((await call(sup, 'POST', `/queues/${qid}/versions/abc/restore`)).status).toBe(400);

    // restaura a versão 1
    const rs = await call(sup, 'POST', `/queues/${qid}/versions/1/restore`);
    expect(rs.status).toBe(200);
    expect(rs.json).toMatchObject({ version: 4, restoredFrom: 1 });
    expect(rs.json.queue).toMatchObject({ name: 'Certidões', priority: 5, slaFirstResponseSec: 600, active: true, strategy: 'LEAST_BUSY' });
    const db = await prisma.bvQueue.findUniqueOrThrow({ where: { id: qid } });
    expect(db).toMatchObject({ name: 'Certidões', priority: 5, active: true });
    expect((await call(sup, 'GET', `/queues/${qid}/versions`)).json.items[0]).toMatchObject({ version: 4 });
    const log = await prisma.bvAuditLog.findFirstOrThrow({ where: { orgId, action: 'queue.restore', entityId: qid } });
    expect(log.meta).toMatchObject({ restoredFromVersion: 1, newVersion: 4 });
    expect((log.before as any).priority).toBe(50);

    // snapshot inválido (overflow para fila excluída) → 422 e a fila não muda
    const target = await call(sup, 'POST', '/queues', { name: 'Destino', slug: `dest-${Date.now()}` });
    expect((await call(sup, 'PATCH', `/queues/${qid}`, { overflowQueueId: target.json.queue.id })).status).toBe(200); // versão 5 aponta p/ Destino
    expect((await call(sup, 'PATCH', `/queues/${qid}`, { overflowQueueId: null })).status).toBe(200); // versão 6
    expect((await call(sup, 'DELETE', `/queues/${target.json.queue.id}`)).status).toBe(204);
    const bad = await call(sup, 'POST', `/queues/${qid}/versions/5/restore`);
    expect(bad.status).toBe(422); expect(bad.json.error.code).toBe('version.invalid_snapshot');
    expect((await prisma.bvQueue.findUniqueOrThrow({ where: { id: qid } })).overflowQueueId).toBeNull();

    // versão de exclusão não é restaurável; histórico de fila excluída continua legível
    expect((await call(sup, 'GET', `/queues/${target.json.queue.id}/versions`)).json.items[0]).toMatchObject({ deleted: true });
    expect((await call(sup, 'POST', `/queues/${target.json.queue.id}/versions/2/restore`)).status).toBe(404); // fila não existe mais
    expect((await call(sup, 'GET', `/queues/naoexiste/versions`)).status).toBe(404);
  });

  it('conflito de slug na restauração → 409; histórico de regras exige routing:manage', async () => {
    const orgId = await setup();
    const sup = await makeUser(orgId, 'SUPERVISOR'); const ag = await makeUser(orgId, 'ATENDENTE');
    const slugA = `a-${Date.now()}`;
    const qa = (await call(sup, 'POST', '/queues', { name: 'A', slug: slugA })).json.queue;
    await call(sup, 'PATCH', `/queues/${qa.id}`, { slug: `${slugA}-novo` });
    await call(sup, 'POST', '/queues', { name: 'B', slug: slugA }); // ocupa o slug antigo
    const r = await call(sup, 'POST', `/queues/${qa.id}/versions/1/restore`);
    expect(r.status).toBe(409); expect(r.json.error.code).toBe('queue.slug_taken');

    const q = await makeQueue(orgId);
    const rule = await call(sup, 'POST', '/routing-rules', { name: 'R', conditions: { channels: ['WEBCHAT'] }, action: { queueId: q.id } });
    expect(rule.status).toBe(201);
    await call(sup, 'PATCH', `/routing-rules/${rule.json.rule.id}`, { name: 'R2', active: false });
    const v = await call(sup, 'GET', `/routing-rules/${rule.json.rule.id}/versions`);
    expect(v.status).toBe(200);
    expect(v.json.items.map((x: any) => x.version)).toEqual([2, 1]);
    expect(v.json.items[0]).toMatchObject({ changedBy: { id: sup.id }, snapshot: { name: 'R2', active: false } });
    expect((await call(ag, 'GET', `/routing-rules/${rule.json.rule.id}/versions`)).status).toBe(403);
    const sup2 = await makeUser(await setup(), 'SUPERVISOR');
    expect((await call(sup2, 'GET', `/routing-rules/${rule.json.rule.id}/versions`)).status).toBe(404);
  });
});

describe('routing — supervisor: SLA em risco', () => {
  it('conta, por fila e no total, prazos de 1ª resposta/resolução que vencem em até N min (padrão 10)', async () => {
    const orgId = await setup();
    const sup = await makeUser(orgId, 'SUPERVISOR'); const ag = await makeUser(orgId, 'ATENDENTE');
    const q1 = await makeQueue(orgId, {}, [ag.id]); const q2 = await makeQueue(orgId, {});
    const now = Date.now(); const min = (n: number) => new Date(now + n * 60_000);
    const mk = async (queueId: string | null, data: Record<string, unknown>) => {
      const c = await waitingConv(orgId);
      return prisma.bvConversation.update({ where: { id: c.id }, data: { queueId, ...data } });
    };
    await mk(q1.id, { slaFirstResponseDueAt: min(5) });                                               // em risco (1ª resposta)
    await mk(q1.id, { slaFirstResponseDueAt: min(5), slaResolutionDueAt: min(3) });                   // em risco nos dois prazos: conta 1×
    await mk(q1.id, { slaFirstResponseDueAt: min(30), slaResolutionDueAt: min(8), status: 'ACTIVE', assignedUserId: ag.id }); // em risco (resolução)
    await mk(q1.id, { slaFirstResponseDueAt: min(30) });                                              // longe: não conta
    await mk(q1.id, { slaFirstResponseDueAt: min(5), firstResponseAt: new Date(), status: 'ACTIVE', assignedUserId: ag.id }); // já respondida: não conta
    await mk(q1.id, { slaFirstResponseDueAt: min(-2), slaBreached: true, metadata: { routing: { breached: ['FIRST_RESPONSE'] } } }); // já violada: vai em slaBreaches
    await mk(q1.id, { slaFirstResponseDueAt: min(5), status: 'CLOSED', closedAt: new Date() });       // encerrada: não conta
    await mk(q2.id, { slaFirstResponseDueAt: min(9) });                                               // em risco em outra fila
    await mk(q2.id, { slaFirstResponseDueAt: min(20) });                                              // só no recorte maior
    await mk(null, { slaFirstResponseDueAt: min(1) });                                                // sem fila

    const r = await call(sup, 'GET', '/supervisor/overview');
    expect(r.status).toBe(200);
    expect(r.json.slaRiskMin).toBe(10);
    const row = (id: string | null) => r.json.queues.find((q: any) => q.queueId === id);
    expect(row(q1.id).slaAtRisk).toBe(3);
    expect(row(q2.id).slaAtRisk).toBe(1);
    expect(row(null).slaAtRisk).toBe(1);
    expect(r.json.totals.slaAtRisk).toBe(5);
    expect(r.json.totals.slaBreached).toBe(1);

    const wide = await call(sup, 'GET', '/supervisor/overview?slaRiskMin=60');
    expect(wide.json.slaRiskMin).toBe(60);
    expect(wide.json.totals.slaAtRisk).toBe(7); // +2: a conversa de 1ª resposta em 30 min (q1) e a de 20 min (q2)
    expect(wide.json.queues.find((q: any) => q.queueId === q2.id).slaAtRisk).toBe(2);
    expect((await call(sup, 'GET', '/supervisor/overview?slaRiskMin=0')).status).toBe(400);
    expect((await call(ag, 'GET', '/supervisor/overview')).status).toBe(403);

    // outro órgão não vê nem conta
    const sup2 = await makeUser(await setup(), 'SUPERVISOR');
    expect((await call(sup2, 'GET', '/supervisor/overview')).json.totals.slaAtRisk).toBe(0);
  });
});

/** clamd falso: responde FOUND se o conteúdo tiver "EICAR". */
function fakeClamd(): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const srv = net.createServer((sock) => {
      let buf = Buffer.alloc(0);
      sock.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        if (buf.subarray(buf.length - 4).equals(Buffer.alloc(4))) { sock.write(buf.includes('EICAR') ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0'); sock.end(); }
      });
    }).listen(0, '127.0.0.1', () => resolve({ port: (srv.address() as net.AddressInfo).port, close: () => srv.close() }));
  });
}

describe('routing — anexos com antivírus', () => {
  afterEach(() => { delete process.env.BV_CLAMAV_HOST; delete process.env.BV_CLAMAV_PORT; delete process.env.BV_CLAMAV_FAIL_MODE; });

  it('infectado → 422 attachment.rejected (infected); limpo → 201; clamd fora → scan_unavailable (fail-closed) ou aceita (fail-open)', async () => {
    const orgId = await setup(); const ag = await makeUser(orgId, 'ATENDENTE');
    const conv = await activeConv(orgId, ag.id);
    const upload = (content: Buffer, name = 'a.txt') => {
      const mp = multipartBody(name, 'text/plain', content);
      return app.inject({ method: 'POST', url: `/balcao/conversations/${conv.id}/attachments`, headers: { ...authHeader(ag), ...mp.headers }, payload: mp.payload });
    };
    const c = await fakeClamd();
    process.env.BV_CLAMAV_HOST = '127.0.0.1'; process.env.BV_CLAMAV_PORT = String(c.port);

    const ok = await upload(Buffer.from('documento normal'));
    expect(ok.statusCode).toBe(201);
    const bad = await upload(Buffer.from('X5O!P%@AP EICAR-STANDARD'), 'virus.txt');
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error).toMatchObject({ code: 'attachment.rejected', details: { reason: 'infected' } });
    // nada gravado: só o evento do anexo limpo
    expect(await prisma.bvConversationEvent.count({ where: { conversationId: conv.id, type: 'ATTACHMENT_UPLOADED' } })).toBe(1);
    const rej = await prisma.bvAuditLog.findFirstOrThrow({ where: { orgId, action: 'conversation.attachment.rejected' } });
    expect(rej.meta).toMatchObject({ reason: 'infected', signature: 'Eicar-Test-Signature' });
    c.close();

    // clamd indisponível
    process.env.BV_CLAMAV_PORT = '1';
    const down = await upload(Buffer.from('qualquer'));
    expect(down.statusCode).toBe(422);
    expect(down.json().error).toMatchObject({ code: 'attachment.rejected', details: { reason: 'scan_unavailable' } });
    process.env.BV_CLAMAV_FAIL_MODE = 'open';
    expect((await upload(Buffer.from('qualquer'))).statusCode).toBe(201);
  });
});
