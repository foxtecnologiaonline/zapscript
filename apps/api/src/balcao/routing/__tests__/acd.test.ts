import { prisma } from '../../../lib/prisma';
import { addBusinessSeconds, DEFAULT_SETTINGS } from '../../core/settings';
import { closeConversation, escalateToHuman } from '../../core/conversations';
import { setAgentPresence } from '../../core/presence';
import { clearBvEventHandlers } from '../../core/events';
import { attemptAssign, drainForAgent, prepareConversation, routeConversation } from '../acd';
import { addBusinessSecondsFast } from '../businessTime';
import { registerRoutingHandlers, unregisterRoutingHandlers } from '../handlers';
import { loadPool } from '../pool';
import { matchConditions } from '../rules';
import { runRoutingSweep } from '../sweep';
import { ALWAYS_OPEN, installSenders, makeQueue, NEVER_OPEN, onlineAgent, removeSenders, sentMessages, setup, waitFor, waitingConv } from './helpers';
import { makeUser } from '../../core/testing';

const conv = (id: string) => prisma.bvConversation.findUniqueOrThrow({ where: { id } });

beforeAll(() => installSenders());
afterAll(() => { removeSenders(); unregisterRoutingHandlers(); clearBvEventHandlers(); });

describe('routing/regras (puro)', () => {
  const base = { channel: 'WHATSAPP', contactCategory: 'ADVOGADO', category: 'PROCESSO', intent: 'consulta', outsideHours: false, weekday: 'mon' as const, waitSec: 120 };
  it('casa por canal, categoria do contato, assunto, intenção, dia e espera', () => {
    expect(matchConditions({}, base)).toBe(true);
    expect(matchConditions({ channels: ['WHATSAPP'], contactCategories: ['advogado'], categories: ['PROCESSO'], intents: ['consulta'], weekdays: [1], minWaitSec: 60 }, base)).toBe(true);
    expect(matchConditions({ channels: ['EMAIL'] }, base)).toBe(false);
    expect(matchConditions({ weekdays: ['tue', 3] }, base)).toBe(false);
    expect(matchConditions({ minWaitSec: 300 }, base)).toBe(false);
    expect(matchConditions({ outsideHours: true }, base)).toBe(false);
  });
});

describe('routing/businessTime', () => {
  it('equivale a addBusinessSeconds do núcleo', () => {
    const cases: Array<[string, number]> = [
      ['2026-11-23T20:30:00Z', 3600], ['2026-11-23T13:00:00Z', 300], ['2026-11-21T15:00:00Z', 7200], // sábado
      ['2026-11-20T20:59:30Z', 90000], ['2026-11-24T02:00:00Z', 600],
    ];
    for (const [from, sec] of cases) {
      const f = new Date(from);
      expect(addBusinessSecondsFast(DEFAULT_SETTINGS, f, sec).getTime()).toBe(addBusinessSeconds(DEFAULT_SETTINGS, f, sec).getTime());
    }
    const hol = new Set(['2026-11-24']);
    const f = new Date('2026-11-23T20:30:00Z');
    expect(addBusinessSecondsFast(DEFAULT_SETTINGS, f, 3600, hol).getTime()).toBe(addBusinessSeconds(DEFAULT_SETTINGS, f, 3600, hol).getTime());
  });
});

describe('routing/ACD', () => {
  it('regra por canal+categoria do contato escolhe a fila, aplica boost e peso por categoria', async () => {
    const orgId = await setup();
    const geral = await makeQueue(orgId, { slug: 'geral' });
    const adv = await makeQueue(orgId, { slug: 'advogados', priority: 10 });
    await prisma.bvRoutingRule.create({ data: { orgId, name: 'adv', position: 1, conditions: { channels: ['WEBCHAT'], contactCategories: ['ADVOGADO'] }, action: { queueId: adv.id, priorityBoost: 5, setCategory: 'ATENDIMENTO_ADVOGADO' } } });
    const c1 = await waitingConv(orgId, { contactCategory: 'ADVOGADO' });
    const c2 = await waitingConv(orgId);
    await routeConversation(orgId, c1.id, 'NEW');
    await routeConversation(orgId, c2.id, 'NEW');
    const a = await conv(c1.id); const b = await conv(c2.id);
    expect(a.queueId).toBe(adv.id);
    expect(a.priority).toBe(10 + 5 + 2); // fila + boost + peso ADVOGADO
    expect(a.category).toBe('ATENDIMENTO_ADVOGADO');
    expect(b.queueId).toBe(geral.id);
    expect(a.slaFirstResponseDueAt).not.toBeNull();
    expect(a.slaResolutionDueAt).not.toBeNull();
    expect(await prisma.bvConversationEvent.count({ where: { conversationId: a.id, type: 'QUEUED' } })).toBe(1);
  });

  it('sem regra: fila por categoria/canal, depois "geral", depois a 1ª ativa', async () => {
    const orgId = await setup();
    const first = await makeQueue(orgId, { slug: 'primeira' });
    const proc = await makeQueue(orgId, { slug: 'processos', categories: ['PROCESSO'] });
    const mail = await makeQueue(orgId, { slug: 'email', channels: ['EMAIL'] });
    const byCat = await waitingConv(orgId, { category: 'PROCESSO' });
    const byChannel = await waitingConv(orgId, { channel: 'EMAIL' });
    const other = await waitingConv(orgId);
    for (const c of [byCat, byChannel, other]) await prepareConversation(orgId, c.id, 'NEW');
    expect((await conv(byCat.id)).queueId).toBe(proc.id);
    expect((await conv(byChannel.id)).queueId).toBe(mail.id);
    expect((await conv(other.id)).queueId).toBe(first.id);
    const geral = await makeQueue(orgId, { slug: 'geral' });
    const other2 = await waitingConv(orgId);
    await prepareConversation(orgId, other2.id, 'NEW');
    expect((await conv(other2.id)).queueId).toBe(geral.id);
  });

  it('filtra por presença, membro, skills e capacidade; atribui via AUTO', async () => {
    const orgId = await setup();
    const skilled = await onlineAgent(orgId, { skills: ['libras'] });
    const plain = await onlineAgent(orgId);
    const offline = await makeUser(orgId, 'ATENDENTE', { skills: ['libras'], presence: 'OFFLINE' });
    const outsider = await onlineAgent(orgId, { skills: ['libras'] });
    const q = await makeQueue(orgId, { requiredSkills: ['libras'] }, [skilled.id, plain.id, offline.id]);
    const c = await waitingConv(orgId);
    const r = await routeConversation(orgId, c.id, 'NEW');
    expect(r).toEqual({ result: 'assigned', userId: skilled.id });
    const after = await conv(c.id);
    expect(after.status).toBe('ACTIVE'); expect(after.queueId).toBe(q.id);
    const ev = await prisma.bvConversationEvent.findFirst({ where: { conversationId: c.id, type: 'ASSIGNED' } });
    expect((ev!.data as any).via).toBe('AUTO');
    void outsider;
  });

  it('capacidade: respeita maxConcurrent e deixa o excedente em WAITING', async () => {
    const orgId = await setup();
    const a = await onlineAgent(orgId, { maxConcurrent: 1 });
    await makeQueue(orgId, {}, [a.id]);
    const c1 = await waitingConv(orgId); const c2 = await waitingConv(orgId);
    expect((await routeConversation(orgId, c1.id, 'NEW')).result).toBe('assigned');
    expect((await routeConversation(orgId, c2.id, 'NEW')).result).toBe('no_agent');
    expect((await conv(c2.id)).status).toBe('WAITING');
  });

  it('estratégias LEAST_BUSY, ROUND_ROBIN e LONGEST_IDLE', async () => {
    const orgId = await setup();
    const a = await onlineAgent(orgId); const b = await onlineAgent(orgId);
    // LEAST_BUSY: b já tem 1 ativa → a recebe
    const lb = await makeQueue(orgId, { strategy: 'LEAST_BUSY' }, [a.id, b.id]);
    const seed = await waitingConv(orgId);
    await prisma.bvConversation.update({ where: { id: seed.id }, data: { status: 'ACTIVE', assignedUserId: b.id, assignedAt: new Date() } });
    const c1 = await waitingConv(orgId);
    await prisma.bvConversation.update({ where: { id: c1.id }, data: { queueId: lb.id } });
    expect(await routeConversation(orgId, c1.id, 'TRANSFER')).toEqual({ result: 'assigned', userId: a.id });

    // ROUND_ROBIN: alterna
    const org2 = await setup();
    const x = await onlineAgent(org2, { maxConcurrent: 10 }); const y = await onlineAgent(org2, { maxConcurrent: 10 });
    await makeQueue(org2, { strategy: 'ROUND_ROBIN' }, [x.id, y.id]);
    const got: string[] = [];
    for (let i = 0; i < 4; i++) { const c = await waitingConv(org2); const r = await routeConversation(org2, c.id, 'NEW'); if (r.result === 'assigned') got.push(r.userId); await new Promise((r) => setTimeout(r, 5)); }
    expect(new Set(got.slice(0, 2)).size).toBe(2);
    expect(got[0]).toBe(got[2]); expect(got[1]).toBe(got[3]);

    // LONGEST_IDLE: quem encerrou há mais tempo recebe
    const org3 = await setup();
    const old = await onlineAgent(org3, { maxConcurrent: 5 }); const recent = await onlineAgent(org3, { maxConcurrent: 5 });
    await makeQueue(org3, { strategy: 'LONGEST_IDLE' }, [old.id, recent.id]);
    const h1 = await waitingConv(org3); const h2 = await waitingConv(org3);
    const now = Date.now();
    await prisma.bvConversation.update({ where: { id: h1.id }, data: { status: 'CLOSED', assignedUserId: old.id, assignedAt: new Date(now - 3 * 3600_000), closedAt: new Date(now - 3 * 3600_000) } });
    await prisma.bvConversation.update({ where: { id: h2.id }, data: { status: 'CLOSED', assignedUserId: recent.id, assignedAt: new Date(now - 60_000), closedAt: new Date(now - 60_000) } });
    await prisma.bvUser.updateMany({ where: { id: { in: [old.id, recent.id] } }, data: { presenceAt: new Date(now - 4 * 3600_000) } });
    const c = await waitingConv(org3);
    expect(await routeConversation(org3, c.id, 'NEW')).toEqual({ result: 'assigned', userId: old.id });
  });

  it('fora do horário: avisa UMA vez (SYSTEM) e mantém WAITING mesmo com agente ONLINE', async () => {
    const orgId = await setup({ businessHours: NEVER_OPEN, outsideHoursMessage: 'Voltamos em breve.' });
    const a = await onlineAgent(orgId);
    await makeQueue(orgId, {}, [a.id]);
    const c = await waitingConv(orgId);
    for (let i = 0; i < 3; i++) expect((await routeConversation(orgId, c.id, 'NEW')).result).toBe('outside_hours');
    expect((await conv(c.id)).status).toBe('WAITING');
    expect(sentMessages.filter((m) => m.conversationId === c.id && m.senderType === 'SYSTEM' && m.body === 'Voltamos em breve.')).toHaveLength(1);
  });

  it('fila com horário próprio abre quando o órgão está fechado', async () => {
    const orgId = await setup({ businessHours: NEVER_OPEN });
    const a = await onlineAgent(orgId);
    await makeQueue(orgId, { businessHours: ALWAYS_OPEN }, [a.id]);
    const c = await waitingConv(orgId);
    expect((await routeConversation(orgId, c.id, 'NEW')).result).toBe('assigned');
  });

  it('agent.available drena por prioridade e espera até esgotar a capacidade', async () => {
    const orgId = await setup();
    const a = await makeUser(orgId, 'ATENDENTE', { presence: 'OFFLINE', maxConcurrent: 2 });
    const q = await makeQueue(orgId, {}, [a.id]);
    const old = await waitingConv(orgId, { queuedAt: new Date(Date.now() - 600_000) });
    const mid = await waitingConv(orgId, { queuedAt: new Date(Date.now() - 300_000) });
    const vip = await waitingConv(orgId, { queuedAt: new Date(Date.now() - 10_000) });
    for (const c of [old, mid, vip]) await routeConversation(orgId, c.id, 'NEW');
    await prisma.bvConversation.update({ where: { id: vip.id }, data: { priority: 50 } });
    expect((await conv(old.id)).status).toBe('WAITING');
    await prisma.bvUser.update({ where: { id: a.id }, data: { presence: 'ONLINE' } });
    expect(await drainForAgent(orgId, a.id)).toBe(2);
    expect((await conv(vip.id)).assignedUserId).toBe(a.id); // maior prioridade
    expect((await conv(old.id)).assignedUserId).toBe(a.id); // maior espera
    expect((await conv(mid.id)).status).toBe('WAITING');
    void q;
  });

  it('eventos: needs_routing atribui e fechar conversa libera a próxima (agent.available)', async () => {
    registerRoutingHandlers();
    const orgId = await setup({ ai: { enabled: true } });
    const a = await onlineAgent(orgId, { maxConcurrent: 1 });
    await makeQueue(orgId, {}, [a.id]);
    const c1 = await waitingConv(orgId); const c2 = await waitingConv(orgId);
    await prisma.bvConversation.updateMany({ where: { id: { in: [c1.id, c2.id] } }, data: { status: 'BOT' } });
    await escalateToHuman(orgId, c1.id); // emite needs_routing
    await waitFor(async () => (await conv(c1.id)).status === 'ACTIVE');
    await escalateToHuman(orgId, c2.id);
    await waitFor(async () => (await conv(c2.id)).queueId);
    expect((await conv(c2.id)).status).toBe('WAITING');
    await closeConversation({ orgId, conversationId: c1.id, reason: 'RESOLVED', actorUserId: a.id, requestCsat: false });
    await waitFor(async () => (await conv(c2.id)).assignedUserId === a.id);
    // presença ONLINE também dispara a drenagem
    await setAgentPresence(orgId, a.id, 'ONLINE');
    unregisterRoutingHandlers();
  });

  it('concorrência: duas conversas disputando 1 vaga — só uma é atribuída', async () => {
    const orgId = await setup();
    const a = await onlineAgent(orgId, { maxConcurrent: 1 });
    await makeQueue(orgId, {}, [a.id]);
    const cs = await Promise.all([waitingConv(orgId), waitingConv(orgId), waitingConv(orgId), waitingConv(orgId)]);
    const res = await Promise.all(cs.map((c) => routeConversation(orgId, c.id, 'NEW')));
    expect(res.filter((r) => r.result === 'assigned')).toHaveLength(1);
    expect(await prisma.bvConversation.count({ where: { orgId, assignedUserId: a.id, status: 'ACTIVE' } })).toBe(1);
  });

  it('concorrência: a mesma conversa roteada em paralelo é atribuída uma única vez', async () => {
    const orgId = await setup();
    const ags = await Promise.all([onlineAgent(orgId), onlineAgent(orgId), onlineAgent(orgId)]);
    await makeQueue(orgId, {}, ags.map((x) => x.id));
    const c = await waitingConv(orgId);
    const res = await Promise.all([1, 2, 3, 4, 5].map(() => routeConversation(orgId, c.id, 'NEW')));
    expect(res.filter((r) => r.result === 'assigned')).toHaveLength(1);
    expect(await prisma.bvConversationEvent.count({ where: { conversationId: c.id, type: 'ASSIGNED' } })).toBe(1);
  });

  it('isolamento: agente de outro órgão nunca recebe', async () => {
    const orgA = await setup(); const orgB = await setup();
    const foreign = await onlineAgent(orgB);
    await makeQueue(orgA, {});
    const c = await waitingConv(orgA);
    expect((await routeConversation(orgA, c.id, 'NEW')).result).toBe('no_agent');
    expect((await loadPool(orgA)).agents).toHaveLength(0);
    expect((await conv(c.id)).assignedUserId).toBeNull();
    void foreign;
  });

  it('attemptAssign com conversa já atribuída é ignorado (idempotência)', async () => {
    const orgId = await setup();
    const a = await onlineAgent(orgId);
    await makeQueue(orgId, {}, [a.id]);
    const c = await waitingConv(orgId);
    await routeConversation(orgId, c.id, 'NEW');
    const pool = await loadPool(orgId);
    expect((await attemptAssign(orgId, c.id, pool, { reason: 'NEW', prepare: true })).result).toBe('skipped');
  });
});

describe('routing/sweep', () => {
  it('overflow: espera > maxWaitSec move para overflowQueueId; sem overflow aumenta prioridade', async () => {
    const orgId = await setup();
    const a = await onlineAgent(orgId);
    const overflow = await makeQueue(orgId, { slug: 'extra' }, [a.id]);
    const main = await makeQueue(orgId, { slug: 'geral', maxWaitSec: 60, overflowQueueId: overflow.id });
    const c = await waitingConv(orgId);
    await prepareConversation(orgId, c.id, 'NEW');
    expect((await conv(c.id)).queueId).toBe(main.id);
    const stats = await runRoutingSweep({ orgId, now: new Date(Date.now() + 120_000) });
    expect(stats.overflowed).toBe(1);
    const after = await conv(c.id);
    expect(after.queueId).toBe(overflow.id);
    expect(after.assignedUserId).toBe(a.id); // já roteada para a fila de overflow
    expect(await prisma.bvConversationEvent.count({ where: { conversationId: c.id, type: 'OVERFLOW' } })).toBe(1);

    const org2 = await setup();
    await makeQueue(org2, { slug: 'geral', maxWaitSec: 60, priority: 1 });
    const c2 = await waitingConv(org2);
    await prepareConversation(org2, c2.id, 'NEW');
    const s2 = await runRoutingSweep({ orgId: org2, now: new Date(Date.now() + 120_000) });
    expect(s2.boosted).toBe(1);
    expect((await conv(c2.id)).priority).toBe(1 + 5);
  });

  it('overflow não entra em ciclo (A→B→A)', async () => {
    const orgId = await setup();
    const a = await makeQueue(orgId, { slug: 'a', maxWaitSec: 10 });
    const b = await makeQueue(orgId, { slug: 'b', maxWaitSec: 10, overflowQueueId: a.id });
    await prisma.bvQueue.update({ where: { id: a.id }, data: { overflowQueueId: b.id } });
    const c = await waitingConv(orgId);
    await prepareConversation(orgId, c.id, 'NEW');
    let t = Date.now();
    for (let i = 0; i < 4; i++) { t += 60_000; await runRoutingSweep({ orgId, now: new Date(t) }); }
    expect(await prisma.bvConversationEvent.count({ where: { conversationId: c.id, type: 'OVERFLOW', data: { path: ['toQueueId'], not: 'x' } } })).toBeGreaterThanOrEqual(1);
    expect((await conv(c.id)).priority).toBeGreaterThan(0);
  });

  it('SLA: violação marca slaBreached, grava evento, notifica supervisores e emite sla.breach uma única vez', async () => {
    const orgId = await setup();
    const sup = await makeUser(orgId, 'SUPERVISOR'); const adm = await makeUser(orgId, 'ATENDENTE');
    await makeQueue(orgId, { slug: 'geral', slaFirstResponseSec: 30 });
    const c = await waitingConv(orgId);
    await prepareConversation(orgId, c.id, 'NEW');
    const events: string[] = [];
    const { onBvEvent } = await import('../../core/events');
    const off = onBvEvent('sla.breach', (e) => { if (e.orgId === orgId) events.push(e.kind); });
    const later = new Date(Date.now() + 3600_000);
    const s1 = await runRoutingSweep({ orgId, now: later });
    const s2 = await runRoutingSweep({ orgId, now: later });
    expect(s1.breaches).toBe(1); expect(s2.breaches).toBe(0);
    const after = await conv(c.id);
    expect(after.slaBreached).toBe(true);
    expect(await prisma.bvConversationEvent.count({ where: { conversationId: c.id, type: 'SLA_BREACH' } })).toBe(1);
    expect(await prisma.bvNotification.count({ where: { orgId, userId: sup.id, type: 'SLA_BREACH' } })).toBe(1);
    expect(await prisma.bvNotification.count({ where: { orgId, userId: adm.id } })).toBe(0);
    await new Promise((r) => setTimeout(r, 30));
    expect(events).toEqual(['FIRST_RESPONSE']);
    off();
  });

  it('timeout: BOT inativa há > 24h é encerrada com TIMEOUT; conversa recente não', async () => {
    const orgId = await setup();
    const old = await waitingConv(orgId); const fresh = await waitingConv(orgId);
    const day = 25 * 3600_000;
    await prisma.bvConversation.update({ where: { id: old.id }, data: { status: 'BOT', lastMessageAt: new Date(Date.now() - day) } });
    await prisma.bvConversation.update({ where: { id: fresh.id }, data: { status: 'BOT', lastMessageAt: new Date() } });
    const s = await runRoutingSweep({ orgId, forceTimeouts: true });
    expect(s.timedOut).toBe(1);
    expect(await conv(old.id)).toMatchObject({ status: 'CLOSED', closeReason: 'TIMEOUT' });
    expect((await conv(fresh.id)).status).toBe('BOT');
  });

  it('timeout de WAITING conta só horário útil (fim de semana fechado não encerra)', async () => {
    const orgId = await setup({ businessHours: NEVER_OPEN });
    const c = await waitingConv(orgId);
    await prisma.bvConversation.update({ where: { id: c.id }, data: { lastMessageAt: new Date(Date.now() - 48 * 3600_000), queuedAt: new Date(Date.now() - 48 * 3600_000) } });
    const s = await runRoutingSweep({ orgId, forceTimeouts: true });
    expect(s.timedOut).toBe(0);
    expect((await conv(c.id)).status).toBe('WAITING');
  });

  it('sweep roteia WAITING que perdeu o evento e drena ao abrir o horário', async () => {
    const orgId = await setup();
    const a = await onlineAgent(orgId);
    await makeQueue(orgId, {}, [a.id]);
    const c = await waitingConv(orgId, { queuedAt: new Date(Date.now() - 60_000) });
    const s = await runRoutingSweep({ orgId });
    expect(s.routed).toBe(1);
    expect((await conv(c.id)).assignedUserId).toBe(a.id);
  });
});
