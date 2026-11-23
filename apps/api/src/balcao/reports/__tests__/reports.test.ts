process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-12345678901234567890';

import type { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { prisma } from '../../../lib/prisma';
import { authHeader, buildBalcaoTestApp, makeOrg, makeUser } from '../../core/testing';
import { hashToken } from '../../core/crypto';
import { getObjectBuffer, putObject, storageRoot } from '../../core/storage';
import { getUsage } from '../../core/usage';
import { csvCell, toCsv, percentile, npsFromScores, projectMonthEnd, resolvePeriod, zonedToUtc, presetPeriod, nextRunAfter, previousPeriod } from '../util';
import { iqaByContractMonth, iqaGlosa, iqaGoal } from '../metrics';
import { runDueSchedules, setReportMailer, runQuotaAlerts, runStorageMeasure, measureOrgStorage } from '../index';
import { monthlyRows, buildMonthly } from '../monthly';

let app: FastifyInstance;
beforeAll(async () => { app = await buildBalcaoTestApp(); });
afterAll(async () => { await app.close(); });

const T0 = Date.parse('2026-11-10T12:00:00Z');
const at = (sec: number, base = T0) => new Date(base + sec * 1000);
let seq = 0;

async function seedContact(orgId: string) { return prisma.bvContact.create({ data: { orgId, name: 'Pessoa Teste' } }); }
async function conv(orgId: string, contactId: string, o: Record<string, any>) {
  seq++;
  return prisma.bvConversation.create({ data: { orgId, contactId, protocol: `T-${Date.now()}-${seq}`, channel: 'WHATSAPP', status: 'CLOSED', ...o } });
}

interface World { orgId: string; sup: any; fiscal: any; admin: any; a1: any; a2: any; q1: string; q2: string; contactId: string }
async function makeWorld(settings: Record<string, unknown> = {}): Promise<World> {
  const org = await makeOrg(settings);
  const [sup, fiscal, admin, a1, a2] = await Promise.all([makeUser(org.id, 'SUPERVISOR'), makeUser(org.id, 'FISCAL'), makeUser(org.id, 'ADMIN'), makeUser(org.id, 'ATENDENTE'), makeUser(org.id, 'ATENDENTE')]);
  const [q1, q2] = await Promise.all([prisma.bvQueue.create({ data: { orgId: org.id, name: 'Fila 1', slug: 'f1' } }), prisma.bvQueue.create({ data: { orgId: org.id, name: 'Fila 2', slug: 'f2' } })]);
  const contact = await seedContact(org.id);
  return { orgId: org.id, sup, fiscal, admin, a1, a2, q1: q1.id, q2: q2.id, contactId: contact.id };
}

/** Cenário de valores conhecidos (ver docs). Período de teste: 2026-11-01 a 2026-11-30. */
async function seedKnown(w: World) {
  const h = (base: number, p: Record<string, number | null>) => ({
    startedAt: at(0, base), queuedAt: at(0, base), assignedAt: p.assign != null ? at(p.assign, base) : null,
    firstResponseAt: p.first != null ? at(p.first, base) : null, closedAt: p.close != null ? at(p.close, base) : null,
  });
  const B1 = T0, B2 = T0 + 600_000, B3 = T0 + 3600_000, B4 = T0 + 7200_000;
  await conv(w.orgId, w.contactId, { ...h(B1, { assign: 60, first: 120, close: 720 }), channel: 'WHATSAPP', queueId: w.q1, assignedUserId: w.a1.id, closeReason: 'RESOLVED', csatScore: 10, firstContactResolved: true, slaFirstResponseDueAt: at(300, B1), slaResolutionDueAt: at(3600, B1) });
  await conv(w.orgId, w.contactId, { ...h(B2, { assign: 30, first: 60, close: 330 }), channel: 'WEBCHAT', queueId: w.q1, assignedUserId: w.a1.id, closeReason: 'RESOLVED', csatScore: 9, firstContactResolved: true, slaFirstResponseDueAt: at(300, B2) });
  await conv(w.orgId, w.contactId, { ...h(B3, { assign: 100, first: 300, close: 700 }), channel: 'WHATSAPP', queueId: w.q2, assignedUserId: w.a2.id, closeReason: 'RESOLVED', csatScore: 5, firstContactResolved: false, slaFirstResponseDueAt: at(240, B3) });
  await conv(w.orgId, w.contactId, { ...h(B4, { assign: 50, first: 180, close: 950 }), channel: 'WHATSAPP', queueId: w.q2, assignedUserId: w.a2.id, closeReason: 'RESOLVED', csatScore: 8, firstContactResolved: true, botHandled: true, slaFirstResponseDueAt: at(300, B4) });
  // bot: resolvido automatizável / resolvido não automatizável
  await conv(w.orgId, w.contactId, { startedAt: at(0, B4 + 3600_000), closedAt: at(60, B4 + 3600_000), closeReason: 'RESOLVED', botHandled: true, resolvedByBot: true, firstContactResolved: true, automatable: true });
  await conv(w.orgId, w.contactId, { startedAt: at(0, B4 + 3700_000), closedAt: at(60, B4 + 3700_000), closeReason: 'RESOLVED', botHandled: true, resolvedByBot: true, firstContactResolved: true, automatable: false, category: '=cmd|calc' });
  // abandonada
  await conv(w.orgId, w.contactId, { startedAt: at(0, B4 + 7200_000), queuedAt: at(0, B4 + 7200_000), closedAt: at(300, B4 + 7200_000), closeReason: 'ABANDONED', channel: 'WEBCHAT', queueId: w.q1 });
  // aberta (aguardando)
  await conv(w.orgId, w.contactId, { startedAt: at(0, B4 + 9000_000), status: 'WAITING', queuedAt: at(0, B4 + 9000_000), queueId: w.q2 });
}

const get = (w: World, url: string, who: 'sup' | 'fiscal' | 'admin' = 'sup') => app.inject({ method: 'GET', url: `/balcao${url}`, headers: authHeader(w[who]) });
const send = (w: World, method: 'POST' | 'PUT' | 'DELETE', url: string, payload?: any, who: 'sup' | 'fiscal' | 'admin' = 'fiscal') => app.inject({ method, url: `/balcao${url}`, headers: authHeader(w[who]), payload });
const PERIOD = 'from=2026-11-01&to=2026-11-30';

describe('reports/util — funções puras', () => {
  it('percentil com interpolação, NPS e projeção linear exatos', () => {
    expect(percentile([60, 120, 180, 300], 0.5)).toBe(150);
    expect(percentile([60, 120, 180, 300], 0.9)).toBeCloseTo(264, 6);
    expect(npsFromScores([10, 9, 5, 8])).toEqual({ responses: 4, promoters: 2, passives: 1, detractors: 1, nps: 25 });
    expect(npsFromScores([]).nps).toBeNull();
    expect(projectMonthEnd([10, 10, 10], 30).projected).toBe(300);
    expect(projectMonthEnd([10, 20, 30], 30).projected).toBeGreaterThan(300); // acelerando
    expect(projectMonthEnd([100, 100], 30, true).projected).toBe(100); // gauge estável
    expect(projectMonthEnd([100, 110, 120], 30, true).projected).toBe(400);
    expect(projectMonthEnd([5], 30).projected).toBe(150); // 1 ponto: proporcional
  });
  it('IQA: meta por mês de contrato e faixa de glosa', () => {
    expect([1, 3, 4, 6, 7, 20].map(iqaGoal)).toEqual([40, 40, 60, 60, 80, 80]);
    expect(iqaGlosa(45, 40)).toBe(0);
    expect(iqaGlosa(35, 40)).toBe(10);
    expect(iqaGlosa(55, 80)).toBe(15);
    expect(iqaGlosa(10, 80)).toBe(20);
    expect(iqaGlosa(null, 80)).toBeNull();
  });
  it('fuso: dia local do Tocantins (UTC-3) e períodos relativos', () => {
    expect(zonedToUtc(2026, 11, 10, 0, 0, 'America/Araguaina').toISOString()).toBe('2026-11-10T03:00:00.000Z');
    const p = resolvePeriod({ from: '2026-11-01', to: '2026-11-30' }, 'America/Araguaina');
    expect(p.from.toISOString()).toBe('2026-11-01T03:00:00.000Z');
    expect(p.to.toISOString()).toBe('2026-12-01T03:00:00.000Z'); // dia final inclusivo
    expect(() => resolvePeriod({ from: '2026-11-30', to: '2026-11-01' }, 'America/Araguaina')).toThrow();
    const now = new Date('2026-11-23T15:00:00Z');
    expect(presetPeriod('PREVIOUS_MONTH', 'America/Araguaina', now).from.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(presetPeriod('PREVIOUS_WEEK', 'America/Araguaina', now).from.toISOString()).toBe('2026-11-16T03:00:00.000Z');
    expect(previousPeriod(p).to).toEqual(p.from);
    expect(nextRunAfter({ frequency: 'DAILY', hour: 6 }, new Date('2026-11-23T10:00:00Z'), 'America/Araguaina').toISOString()).toBe('2026-11-24T09:00:00.000Z');
    expect(nextRunAfter({ frequency: 'MONTHLY', hour: 6, dayOfMonth: 1 }, new Date('2026-11-23T10:00:00Z'), 'America/Araguaina').toISOString()).toBe('2026-12-01T09:00:00.000Z');
  });
  it('CSV: BOM, separador ; e proteção contra injeção de fórmula', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('+55')).toBe("'+55");
    expect(csvCell('-cmd')).toBe("'-cmd");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell(-5)).toBe('-5'); // número negativo legítimo não é prefixado
    expect(csvCell(1.5)).toBe('1,5');
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('diz "oi"')).toBe('"diz ""oi"""');
    const csv = toCsv([{ key: 'a', label: 'Coluna A' }, { key: 'b', label: 'B' }], [{ a: '=HYPERLINK("x")', b: 2 }]);
    expect(csv.startsWith('﻿Coluna A;B\r\n')).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""x"")";2`);
  });
});

describe('reports — métricas com valores conhecidos', () => {
  let w: World;
  beforeAll(async () => { w = await makeWorld(); await seedKnown(w); });

  it('overview: TME, TMA, TMR, fila, abandono, FCR, bot, SLA, NPS e IQA exatos', async () => {
    const r = await get(w, `/reports/overview?${PERIOD}`);
    expect(r.statusCode).toBe(200);
    const k = r.json().kpis;
    expect(k.total).toBe(8); expect(k.closed).toBe(7); expect(k.open).toBe(1);
    expect([k.tmeAvg, k.tmeP50, k.tmeP90, k.tmeCount]).toEqual([165, 150, 264, 4]);
    expect([k.tmaAvg, k.tmaP50, k.tmaP90]).toEqual([615, 630, 828]);
    expect(k.tmrAvg).toBe(Math.round(((720 + 330 + 700 + 950) / 4) * 10) / 10);
    expect(k.queueWaitAvg).toBe(60);
    expect(k.abandoned).toBe(1); expect(k.abandonRate).toBeCloseTo(14.29, 2);
    expect(k.fcrRate).toBeCloseTo(83.33, 2);
    expect(k.botInvolved).toBe(3); expect(k.botResolved).toBe(2); expect(k.botContainmentRate).toBeCloseTo(66.67, 2);
    expect(k.slaBase).toBe(4); expect(k.slaViolations).toBe(1); expect(k.slaRate).toBe(75); expect(k.slaFirstResponseRate).toBe(75); expect(k.slaResolutionRate).toBe(100);
    expect([k.npsResponses, k.npsPromoters, k.npsPassives, k.npsDetractors, k.nps, k.csatAvg]).toEqual([4, 2, 1, 1, 25, 8]);
    expect(k.iqaCount).toBe(1); expect(k.iqaRate).toBeCloseTo(33.33, 2);
  });

  it('comparação com período anterior', async () => {
    const r = await get(w, `/reports/overview?from=2026-12-01&to=2026-12-30&compare=true`);
    expect(r.json().kpis.total).toBe(0);
    const r2 = await get(w, `/reports/overview?from=2026-11-10&to=2026-11-10&compare=true`);
    expect(r2.json().kpis.total).toBe(8);
    expect(r2.json().previous.kpis.total).toBe(0);
    expect(r2.json().comparison.total.delta).toBe(8);
  });

  it('por canal, fila, atendente (com simultaneidade) e NPS', async () => {
    const ch = (await get(w, `/reports/channels?${PERIOD}`)).json().channels;
    expect(Object.fromEntries(ch.map((c: any) => [c.channel, c.total]))).toEqual({ WHATSAPP: 6, WEBCHAT: 2 });
    const qs = (await get(w, `/reports/queues?${PERIOD}`)).json().queues;
    const q2 = qs.find((q: any) => q.queue === w.q2);
    expect(q2.queueName).toBe('Fila 2'); expect(q2.tmeAvg).toBe(240); expect(q2.nps).toBe(0);
    const ag = (await get(w, `/reports/agents?${PERIOD}`)).json().agents;
    const a1 = ag.find((a: any) => a.agent === w.a1.id);
    expect(a1.total).toBe(2); expect(a1.tmeAvg).toBe(90); expect(a1.tmaAvg).toBe(480); expect(a1.nps).toBe(100);
    // A1: [12:01:00–12:12:00] e [12:10:30–12:15:30] → pico 2, 960 s·conv em 870 s ocupado
    expect(a1.simultaneousPeak).toBe(2); expect(a1.busySeconds).toBe(870); expect(a1.simultaneousAvg).toBeCloseTo(1.1, 1);
    const nps = (await get(w, `/reports/nps?${PERIOD}`)).json();
    expect(nps.summary.nps).toBe(25);
    expect(nps.distribution).toHaveLength(11); expect(nps.distribution[10].count).toBe(1); expect(nps.distribution[5].count).toBe(1);
    expect(nps.check.nps).toBe(25);
    expect(nps.byAgent.find((a: any) => a.agent === w.a2.id).nps).toBe(0);
  });

  it('SLA: violações listadas; filtro por canal/fila', async () => {
    const s = (await get(w, `/reports/sla?${PERIOD}`)).json();
    expect(s.summary.slaRate).toBe(75);
    expect(s.violations).toHaveLength(1); expect(s.violations[0].kind).toBe('FIRST_RESPONSE');
    const f = (await get(w, `/reports/overview?${PERIOD}&channel=WEBCHAT`)).json().kpis;
    expect(f.total).toBe(2); expect(f.tmeAvg).toBe(60);
    const bad = await get(w, `/reports/overview?${PERIOD}&channel=TELEGRAM`);
    expect(bad.statusCode).toBe(400);
  });

  it('série temporal por dia e por hora (fuso do órgão)', async () => {
    const d = (await get(w, `/reports/timeseries?${PERIOD}&granularity=day`)).json();
    expect(d.series).toHaveLength(1); expect(d.series[0].day).toBe('2026-11-10'); expect(d.series[0].total).toBe(8);
    const h = (await get(w, `/reports/timeseries?${PERIOD}&granularity=hour&metrics=total`)).json().series;
    expect(h[0].datetime).toBe('2026-11-10 09:00'); expect(h[0].total).toBe(2); // 12:00Z e 12:10Z = 09:00 local
  });

  it('IQA por mês de contrato (settings.contract.startDate) com meta e glosa', async () => {
    const w2 = await makeWorld({ contract: { startDate: '2026-05-01' } });
    await seedKnown(w2);
    const r = await get(w2, '/reports/iqa');
    const nov = r.json().months.find((m: any) => m.from.startsWith('2026-11-01'));
    expect(nov.contractMonth).toBe(7); expect(nov.goal).toBe(80); expect(nov.botInvolved).toBe(3); expect(nov.numerator).toBe(1);
    expect(nov.value).toBeCloseTo(33.33, 2); expect(nov.reachedGoal).toBe(false);
    const done = await iqaByContractMonth({ orgId: w2.orgId }, 'America/Araguaina', new Date('2026-12-15T00:00:00Z'));
    expect(done.months.find((m) => m.contractMonth === 7)!.glosaPct).toBe(20);
    const done2 = await iqaByContractMonth({ orgId: w2.orgId }, 'America/Araguaina', new Date('2026-12-15T00:00:00Z'), '2026-09-01');
    expect(done2.months.find((m) => m.contractMonth === 3)).toMatchObject({ goal: 40, glosaPct: 10 });
    // sem contract.startDate: padrão = data do primeiro atendimento
    const def = await iqaByContractMonth({ orgId: w.orgId }, 'America/Araguaina', new Date('2026-12-15T00:00:00Z'));
    expect(def.contract.source).toBe('first_conversation'); expect(def.contract.startDate).toBe('2026-11-10');
    await prisma.bvOrg.deleteMany({ where: { id: w2.orgId } });
  });

  it('fuso horário na agregação por dia: 23h locais (02:00Z) contam no dia anterior', async () => {
    const w3 = await makeWorld();
    await conv(w3.orgId, w3.contactId, { startedAt: new Date('2026-11-10T02:00:00Z') });
    await conv(w3.orgId, w3.contactId, { startedAt: new Date('2026-11-10T04:00:00Z') });
    const s = (await get(w3, `/reports/timeseries?from=2026-11-09&to=2026-11-10&metrics=total`)).json().series;
    expect(s.map((x: any) => [x.day, x.total])).toEqual([['2026-11-09', 1], ['2026-11-10', 1]]);
    const hod = (await get(w3, `/reports/timeseries?from=2026-11-09&to=2026-11-10&granularity=hour&metrics=total`)).json().series.map((x: any) => x.datetime);
    expect(hod).toEqual(['2026-11-09 23:00', '2026-11-10 01:00']);
    // o mesmo dado com período que exclui a 1ª (início local 10/11)
    const only = (await get(w3, `/reports/overview?from=2026-11-10&to=2026-11-10`)).json().kpis.total;
    expect(only).toBe(1);
  });

  it('voz: chamadas, duração, abandono, gravações e pico simultâneo', async () => {
    const w4 = await makeWorld();
    const base = T0;
    await prisma.bvCall.createMany({ data: [
      { orgId: w4.orgId, direction: 'IN', fromNumber: '1', toNumber: '2', status: 'ENDED', startedAt: at(0, base), answeredAt: at(10, base), endedAt: at(130, base), durationSec: 120, agentUserId: w4.a1.id, recordingKey: 'k', recordingSizeBytes: 1000n },
      { orgId: w4.orgId, direction: 'IN', fromNumber: '1', toNumber: '2', status: 'ABANDONED', startedAt: at(1800, base), endedAt: at(1820, base) },
      { orgId: w4.orgId, direction: 'OUT', fromNumber: '1', toNumber: '2', status: 'ENDED', startedAt: at(55, base), answeredAt: at(60, base), endedAt: at(360, base), durationSec: 300, agentUserId: w4.a1.id },
    ] });
    const v = (await get(w4, `/reports/voice?${PERIOD}`)).json();
    expect(v.totals).toMatchObject({ total: 3, inbound: 2, outbound: 1, answered: 2, abandoned: 1, abandonRate: 50, minutes: 7, durationAvg: 210, durationP50: 210, waitAvg: 7.5, recordings: 1, recordingBytes: 1000, peakConcurrent: 2 });
    expect(v.totals.durationP90).toBeCloseTo(282, 5);
    expect(v.byAgent[0].agent).toBe(w4.a1.id);
    const csv = await get(w4, `/reports/voice?${PERIOD}&format=csv`);
    expect(csv.headers['content-type']).toContain('text/csv');
  });

  it('CSV em português com BOM, separador ; e injeção neutralizada', async () => {
    const r = await get(w, `/reports/overview?${PERIOD}&format=csv`);
    expect(r.statusCode).toBe(200);
    expect(r.body.startsWith('﻿Métrica;Valor;')).toBe(true);
    expect(r.body).toContain('TME médio (s);165;');
    const c = await send(w, 'POST', '/reports/custom?format=csv', { metrics: ['total'], groupBy: ['category'], period: { from: '2026-11-01', to: '2026-11-30' } }, 'sup');
    expect(c.statusCode).toBe(200);
    expect(c.body).toContain("'=cmd|calc;1");
    expect(c.body).not.toMatch(/(^|;|\n)=cmd/);
  });

  it('realtime: espera, atendimento, SLA em risco, agentes e chamadas ativas', async () => {
    const w5 = await makeWorld();
    const now = Date.now();
    await prisma.bvUser.update({ where: { id: w5.a1.id }, data: { presence: 'ONLINE' } });
    await prisma.bvUser.update({ where: { id: w5.a2.id }, data: { presence: 'BUSY' } });
    await conv(w5.orgId, w5.contactId, { status: 'WAITING', startedAt: new Date(now - 700_000), queuedAt: new Date(now - 600_000), queueId: w5.q1, slaFirstResponseDueAt: new Date(now + 60_000) });
    await conv(w5.orgId, w5.contactId, { status: 'WAITING', startedAt: new Date(now - 100_000), queuedAt: new Date(now - 60_000), queueId: w5.q1, slaFirstResponseDueAt: new Date(now + 3_600_000) });
    await conv(w5.orgId, w5.contactId, { status: 'ACTIVE', startedAt: new Date(now - 900_000), assignedAt: new Date(now - 800_000), assignedUserId: w5.a2.id, slaFirstResponseDueAt: new Date(now - 30_000) });
    await conv(w5.orgId, w5.contactId, { status: 'BOT', startedAt: new Date(now - 10_000) });
    await prisma.bvCall.create({ data: { orgId: w5.orgId, direction: 'IN', fromNumber: '1', toNumber: '2', status: 'ACTIVE' } });
    const r = (await get(w5, '/reports/realtime')).json();
    expect(r).toMatchObject({ waiting: 2, inService: 1, withBot: 1, slaAtRisk: 1, slaBreachedOpen: 1, activeCalls: 1 });
    expect(r.longestWaitSec).toBeGreaterThanOrEqual(600); expect(r.longestWaitSec).toBeLessThan(620);
    expect(r.agents.online).toBe(1); expect(r.agents.busy).toBe(1);
    expect(r.agents.list.find((a: any) => a.id === w5.a2.id).activeConversations).toBe(1);
    expect(r.queues.find((q: any) => q.queue === w5.q1).waiting).toBe(2);
  });
});

describe('reports — relatórios personalizáveis (allowlist)', () => {
  let w: World;
  beforeAll(async () => { w = await makeWorld(); await seedKnown(w); });
  const custom = (body: any) => send(w, 'POST', '/reports/custom', body, 'sup');

  it('definições expõem catálogo; custom executa e valores batem', async () => {
    const d = (await get(w, '/reports/definitions')).json();
    expect(d.metrics.map((m: any) => m.key)).toEqual(expect.arrayContaining(['tmeAvg', 'nps', 'iqaRate']));
    expect(d.dimensions.map((x: any) => x.key)).toEqual(expect.arrayContaining(['channel', 'queue', 'agent', 'day']));
    const r = await custom({ metrics: ['total', 'tmeAvg', 'nps'], groupBy: ['channel'], period: { from: '2026-11-01', to: '2026-11-30' }, orderBy: { key: 'total', dir: 'desc' } });
    expect(r.statusCode).toBe(200);
    const rows = r.json().rows;
    expect(rows[0]).toMatchObject({ channel: 'WHATSAPP', total: 6, tmeAvg: 215 });
    expect(rows[1]).toMatchObject({ channel: 'WEBCHAT', total: 2, tmeAvg: 60, nps: 100 });
  });

  it('rejeita métrica, dimensão, filtro e campos fora da allowlist (nunca SQL livre)', async () => {
    const base = { metrics: ['total'], groupBy: [], period: { preset: 'LAST_7_DAYS' } };
    const cases = [
      { ...base, metrics: ['total; DROP TABLE "BvConversation"'] },
      { ...base, metrics: ['password'] },
      { ...base, groupBy: ['contactId'] },
      { ...base, groupBy: ['channel', 'queue', 'agent'] },
      { ...base, filters: { orgId: 'outra' } },
      { ...base, filters: { channel: ['TELEGRAM'] } },
      { ...base, sql: 'select 1' },
      { ...base, orderBy: { key: 'csatComment', dir: 'asc' } },
      { ...base, limit: 999999 },
      { ...base, metrics: [] },
    ];
    for (const c of cases) expect((await custom(c)).statusCode).toBe(400);
    expect((await custom({ ...base, period: { from: '2026-12-01', to: '2026-11-01' } })).statusCode).toBe(400);
  });

  it('atendente comum não acessa relatórios', async () => {
    const r = await app.inject({ method: 'GET', url: '/balcao/reports/overview', headers: authHeader(w.a1) });
    expect(r.statusCode).toBe(403);
  });
});

describe('reports — token de API e exportação para BI', () => {
  let w: World;
  const token = `bvt_${crypto.randomBytes(16).toString('hex')}`;
  const bearer = { authorization: `Bearer ${token}` };
  beforeAll(async () => {
    w = await makeWorld(); await seedKnown(w);
    await prisma.bvApiToken.create({ data: { orgId: w.orgId, name: 'BI', tokenHash: hashToken(token), scopes: ['report:read'] } });
    await prisma.bvCall.create({ data: { orgId: w.orgId, direction: 'IN', fromNumber: '+5563999990000', toNumber: '0800', status: 'ENDED', startedAt: at(0), durationSec: 5 } });
  });

  it('token com report:read lê exportações, mas não escreve nem lê o painel do fiscal', async () => {
    const ok = await app.inject({ method: 'GET', url: `/balcao/reports/export/conversations?${PERIOD}`, headers: bearer });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toContain('ndjson');
    expect((await app.inject({ method: 'GET', url: `/balcao/reports/overview?${PERIOD}`, headers: bearer })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/balcao/reports/saved', headers: bearer, payload: { name: 'x', definition: { metrics: ['total'] } } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/balcao/reports/monthly', headers: bearer, payload: { month: '2026-11' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/balcao/fiscal/quotas', headers: bearer, payload: { item: 'WA_SERVICE', period: 'DAY', limit: 1 } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/balcao/fiscal/consumption', headers: bearer })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/balcao/reports/export/conversations`, headers: { authorization: 'Bearer bvt_invalido' } })).statusCode).toBe(401);
  });

  it('paginação por cursor percorre tudo sem repetir; sem PII nem conteúdo', async () => {
    const ids: string[] = [];
    let cursor = '';
    for (let i = 0; i < 10; i++) {
      const r = await app.inject({ method: 'GET', url: `/balcao/reports/export/conversations?${PERIOD}&limit=3&format=json${cursor ? `&cursor=${cursor}` : ''}`, headers: bearer });
      const b = r.json();
      ids.push(...b.data.map((x: any) => x.id));
      for (const row of b.data) for (const bad of ['subject', 'name', 'phone', 'email', 'csatComment', 'channelRef', 'body']) expect(row).not.toHaveProperty(bad);
      if (!b.nextCursor) break;
      cursor = b.nextCursor;
    }
    expect(ids).toHaveLength(8); expect(new Set(ids).size).toBe(8);
    const nd = await app.inject({ method: 'GET', url: `/balcao/reports/export/conversations?${PERIOD}&limit=2`, headers: bearer });
    expect(nd.body.trim().split('\n')).toHaveLength(2);
    expect(nd.headers['x-has-more']).toBe('true');
    expect((await app.inject({ method: 'GET', url: `/balcao/reports/export/conversations?cursor=%%%`, headers: bearer })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: `/balcao/reports/export/usuarios`, headers: bearer })).statusCode).toBe(404);
  });

  it('calls omite números de telefone; nps e csv', async () => {
    const calls = (await app.inject({ method: 'GET', url: `/balcao/reports/export/calls?${PERIOD}&format=json`, headers: bearer })).json().data;
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(calls)).not.toContain('5563999990000'); expect(calls[0]).not.toHaveProperty('fromNumber');
    const nps = (await app.inject({ method: 'GET', url: `/balcao/reports/export/nps?${PERIOD}&format=json`, headers: bearer })).json().data;
    expect(nps.map((x: any) => x.npsClass).sort()).toEqual(['DETRACTOR', 'PASSIVE', 'PROMOTER', 'PROMOTER']);
    const csv = await app.inject({ method: 'GET', url: `/balcao/reports/export/tasks?${PERIOD}&format=csv`, headers: bearer });
    expect(csv.body.startsWith('﻿id;code;kind')).toBe(true);
    expect((await app.inject({ method: 'GET', url: `/balcao/reports/export/messages-meta?${PERIOD}&format=json`, headers: bearer })).statusCode).toBe(200);
  });
});

describe('reports — painel do fiscal, cotas e alertas', () => {
  let w: World;
  const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  beforeAll(async () => {
    w = await makeWorld({ billing: { unitPrices: { WA_UTILITY: 0.2 } } });
    const d = (s: string) => new Date(`${s}T00:00:00Z`);
    await prisma.bvUsageDaily.createMany({ data: [
      { orgId: w.orgId, day: d('2026-11-01'), item: 'WA_SERVICE', quantity: 600n }, { orgId: w.orgId, day: d('2026-11-02'), item: 'WA_SERVICE', quantity: 400n },
      { orgId: w.orgId, day: d('2026-11-01'), item: 'WA_UTILITY', quantity: 100n }, { orgId: w.orgId, day: d('2026-11-01'), item: 'WA_MARKETING', quantity: 100n },
      { orgId: w.orgId, day: d('2026-11-01'), item: 'STORAGE_BYTES', quantity: 1_000_000_000_000n }, { orgId: w.orgId, day: d('2026-11-02'), item: 'STORAGE_BYTES', quantity: 2_000_000_000_000n },
      { orgId: w.orgId, day: d('2026-11-01'), item: 'VOICE_PEAK_CHANNELS', quantity: 4n }, { orgId: w.orgId, day: d('2026-11-02'), item: 'VOICE_PEAK_CHANNELS', quantity: 6n },
      { orgId: w.orgId, day: d('2026-11-01'), item: 'VOICE_MINUTES', quantity: 50n },
    ] });
  });

  it('consumo por item com valores unitários estimados (TR e override do órgão)', async () => {
    const r = (await get(w, '/fiscal/consumption?period=MONTH&from=2026-11-01&to=2026-11-30', 'fiscal')).json();
    const it = (n: string) => r.items.find((i: any) => i.item === n);
    expect(it('WA_SERVICE')).toMatchObject({ trItem: '7', quantity: 1000, unitPrice: 0.11, estimatedCost: 110 });
    expect(it('WA_UTILITY')).toMatchObject({ trItem: '8', quantity: 100, unitPrice: 0.2, estimatedCost: 20 }); // override
    expect(it('WA_MARKETING')).toMatchObject({ trItem: '9', quantity: 100, estimatedCost: 46 });
    expect(it('STORAGE_BYTES')).toMatchObject({ trItem: '10', quantity: 2_000_000_000_000, estimatedCost: 986, aggregation: 'MAX' }); // 2 TB × 493
    expect(it('VOICE_PEAK_CHANNELS')).toMatchObject({ quantity: 6, estimatedCost: 2190 }); // 6 canais × 365
    expect(it('VOICE_MINUTES').quantity).toBe(50);
    expect(r.totals.estimatedCost).toBe(110 + 20 + 46 + 986 + 2190);
    const daily = (await get(w, '/fiscal/consumption?period=DAY&from=2026-11-01&to=2026-11-03', 'fiscal')).json();
    expect(daily.items.find((i: any) => i.item === 'WA_SERVICE').series.map((s: any) => s.quantity)).toEqual([600, 400, 0]);
    expect((await get(w, '/fiscal/consumption?period=MONTH&format=csv', 'fiscal')).body.startsWith('﻿Item;')).toBe(true);
    // supervisor não tem fiscal:read
    expect((await get(w, '/fiscal/consumption', 'sup')).statusCode).toBe(403);
  });

  it('licenças em uso = usuários distintos com sessão/atividade no mês', async () => {
    await prisma.bvSession.create({ data: { userId: w.a1.id, refreshHash: crypto.randomBytes(8).toString('hex'), expiresAt: new Date(Date.now() + 1e6), createdAt: new Date('2026-11-05T12:00:00Z') } });
    await prisma.bvSession.create({ data: { userId: w.a1.id, refreshHash: crypto.randomBytes(8).toString('hex'), expiresAt: new Date(Date.now() + 1e6), createdAt: new Date('2026-11-06T12:00:00Z') } });
    await prisma.bvSession.create({ data: { userId: w.sup.id, refreshHash: crypto.randomBytes(8).toString('hex'), expiresAt: new Date(Date.now() + 1e6), createdAt: new Date('2026-11-06T12:00:00Z') } });
    const r = (await get(w, '/fiscal/consumption?period=MONTH&from=2026-11-01&to=2026-11-30', 'fiscal')).json();
    expect(r.licenses[0]).toMatchObject({ month: '2026-11', atendente: 1, supervisor: 1 });
  });

  it('CRUD de cotas audita, versiona e mostra status atual', async () => {
    await prisma.bvUsageDaily.upsert({ where: { orgId_day_item: { orgId: w.orgId, day: today, item: 'WA_MARKETING' } }, create: { orgId: w.orgId, day: today, item: 'WA_MARKETING', quantity: 50n }, update: { quantity: 50n } });
    const c1 = await send(w, 'POST', '/fiscal/quotas', { item: 'WA_MARKETING', period: 'MONTH', limit: 500, action: 'BLOCK', alertAtPct: 80 });
    expect(c1.statusCode).toBe(201); expect(c1.json().version).toBe(1);
    const c2 = await send(w, 'POST', '/fiscal/quotas', { item: 'WA_MARKETING', period: 'MONTH', limit: 400, action: 'BLOCK', alertAtPct: 70 });
    expect(c2.statusCode).toBe(200); expect(c2.json().version).toBe(2);
    expect((await send(w, 'POST', '/fiscal/quotas', { item: 'INVALIDO', period: 'MONTH', limit: 5 })).statusCode).toBe(400);
    expect((await send(w, 'POST', '/fiscal/quotas', { item: 'WA_SERVICE', period: 'MONTH', limit: 5 }, 'sup')).statusCode).toBe(403);
    const list = (await get(w, '/fiscal/quotas', 'fiscal')).json().quotas;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ item: 'WA_MARKETING', limit: 400, status: { used: expect.any(Number), allowed: true } });
    const vers = await prisma.bvConfigVersion.count({ where: { orgId: w.orgId, entityType: 'quota', entityId: c1.json().id } });
    expect(vers).toBe(2);
    const aud = await prisma.bvAuditLog.findMany({ where: { orgId: w.orgId, entityType: 'BvQuota' }, select: { action: true } });
    expect(aud.map((a) => a.action).sort()).toEqual(['quota.create', 'quota.update']);
    const put = await send(w, 'PUT', `/fiscal/quotas/${c1.json().id}`, { limit: 1000 });
    expect(put.json().limit).toBe(1000);
    expect((await send(w, 'DELETE', `/fiscal/quotas/${c1.json().id}`)).statusCode).toBe(204);
    expect((await send(w, 'DELETE', `/fiscal/quotas/${c1.json().id}`)).statusCode).toBe(404);
  });

  it('alertas ao cruzar alertAtPct e 100%, uma única vez por período/limiar', async () => {
    const wa = await makeWorld();
    const qty = async (n: number) => prisma.bvUsageDaily.upsert({ where: { orgId_day_item: { orgId: wa.orgId, day: today, item: 'WA_SERVICE' } }, create: { orgId: wa.orgId, day: today, item: 'WA_SERVICE', quantity: BigInt(n) }, update: { quantity: BigInt(n) } });
    await prisma.bvQuota.create({ data: { orgId: wa.orgId, item: 'WA_SERVICE', period: 'DAY', limit: 1000n, alertAtPct: 80, action: 'ALERT' } });
    await qty(500);
    expect((await runQuotaAlerts(wa.orgId)).created).toBe(0);
    await qty(850);
    expect((await runQuotaAlerts(wa.orgId)).created).toBe(2); // FISCAL + ADMIN
    expect((await runQuotaAlerts(wa.orgId)).created).toBe(0);
    await qty(900);
    expect((await runQuotaAlerts(wa.orgId)).created).toBe(0); // mesmo limiar
    await qty(1000);
    expect((await runQuotaAlerts(wa.orgId)).created).toBe(2); // 100%
    expect((await runQuotaAlerts(wa.orgId)).created).toBe(0);
    const notes = await prisma.bvNotification.findMany({ where: { orgId: wa.orgId, userId: wa.fiscal.id } });
    expect(notes.map((n) => (n.data as any).level).sort()).toEqual(['ALERT', 'LIMIT']);
    expect(await prisma.bvNotification.count({ where: { orgId: wa.orgId, userId: wa.sup.id } })).toBe(0);
    // isolamento: outro órgão não recebe nada
    expect(await prisma.bvNotification.count({ where: { orgId: w.orgId, type: 'QUOTA_ALERT' } })).toBe(0);
  });

  it('dashboard: consumo × cota × projeção até o fim do mês', async () => {
    const wd = await makeWorld();
    const now = new Date();
    for (let d = 1; d <= now.getUTCDate(); d++) await prisma.bvUsageDaily.create({ data: { orgId: wd.orgId, day: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), d)), item: 'WA_SERVICE', quantity: 10n } });
    await prisma.bvQuota.create({ data: { orgId: wd.orgId, item: 'WA_SERVICE', period: 'MONTH', limit: 100n, action: 'ALERT' } });
    const r = (await get(wd, '/fiscal/dashboard', 'fiscal')).json();
    const it = r.items.find((i: any) => i.item === 'WA_SERVICE');
    const dim = r.daysInMonth;
    expect(it.monthToDate).toBe(10 * r.daysElapsed);
    if (r.daysElapsed >= 2) expect(it.projection.monthEnd).toBe(10 * dim); // regressão linear exata
    expect(it.quotas[0].willExceed).toBe(10 * dim > 100);
    expect(it.projectedCost).toBeCloseTo(it.projection.monthEnd * 0.11, 1);
  });

  it('job de armazenamento mede o disco do órgão e grava o gauge', async () => {
    const ws = await makeWorld();
    await putObject(`${ws.orgId}/attachments/2026/11/a.bin`, Buffer.alloc(1500));
    await putObject(`${ws.orgId}/recordings/2026/11/b.wav`, Buffer.alloc(2500));
    await putObject(`${w.orgId}/attachments/2026/11/outro.bin`, Buffer.alloc(9999)); // outro órgão não conta
    const m = await measureOrgStorage(ws.orgId);
    expect(m).toMatchObject({ bytes: 4000, files: 2, truncated: false });
    expect(measureOrgStorage(ws.orgId, { maxEntries: 1 })).resolves.toMatchObject({ truncated: true });
    await runStorageMeasure(ws.orgId);
    expect(await getUsage(ws.orgId, 'STORAGE_BYTES', new Date(Date.now() - 86400_000), new Date())).toBe(4000);
    // sem pasta de gravações no disco → soma recordingSizeBytes do banco
    const wn = await makeWorld();
    await prisma.bvCall.create({ data: { orgId: wn.orgId, direction: 'IN', fromNumber: '1', toNumber: '2', recordingKey: 'x', recordingSizeBytes: 7000n } });
    expect((await measureOrgStorage(wn.orgId)).bytes).toBe(7000);
    fs.rmSync(path.join(storageRoot(), ws.orgId), { recursive: true, force: true });
    fs.rmSync(path.join(storageRoot(), w.orgId), { recursive: true, force: true });
  });
});

describe('reports — salvos, agendamento e relatório mensal', () => {
  let w: World;
  const sent: Array<{ to: string; subject: string; html: string }> = [];
  beforeAll(async () => {
    w = await makeWorld(); await seedKnown(w);
    setReportMailer(async (to, subject, html) => { sent.push({ to, subject, html }); });
  });
  afterAll(() => setReportMailer());

  it('salva relatório com agendamento DIÁRIO e executa uma única vez por ocorrência (idempotente)', async () => {
    const r = await send(w, 'POST', '/reports/saved', { name: 'Diário por canal', definition: { metrics: ['total', 'tmeAvg'], groupBy: ['channel'] }, schedule: { frequency: 'DAILY', format: 'CSV', recipients: ['gestor@tjto.jus.br'], hour: 7 } }, 'sup');
    expect(r.statusCode).toBe(201);
    const saved = r.json();
    expect(saved.definition.period).toEqual({ preset: 'YESTERDAY' });
    expect(new Date(saved.schedule.nextRunAt).getTime()).toBeGreaterThan(Date.now());
    expect((await send(w, 'POST', '/reports/saved', { name: 'x', definition: { metrics: ['hack'] } }, 'sup')).statusCode).toBe(400);
    expect((await send(w, 'POST', '/reports/saved', { name: 'x', definition: { metrics: ['total'] }, schedule: { frequency: 'DAILY', recipients: ['nao-e-email'] } }, 'sup')).statusCode).toBe(400);

    // vence o agendamento e dispara duas execuções concorrentes
    await prisma.bvReportSchedule.update({ where: { id: saved.id }, data: { nextRunAt: new Date(Date.now() - 1000) } });
    const now = new Date();
    const [a, b] = await Promise.all([runDueSchedules(now), runDueSchedules(now)]);
    const ran = [...a, ...b].filter((x) => x.status === 'DONE');
    expect(ran).toHaveLength(1);
    expect(await runDueSchedules(now)).toHaveLength(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'gestor@tjto.jus.br' });
    expect(sent[0].html).toContain('/balcao/reports/exports/');
    const jobs = await prisma.bvExportJob.findMany({ where: { orgId: w.orgId, type: 'REPORT', params: { path: ['scheduleId'], equals: saved.id } } });
    expect(jobs).toHaveLength(1);
    const buf = await getObjectBuffer(jobs[0].fileKey!);
    expect(crypto.createHash('sha256').update(buf).digest('hex')).toBe(jobs[0].sha256);
    expect(Number(jobs[0].sizeBytes)).toBe(buf.length);
    expect(buf.toString('utf8').startsWith('﻿Canal;')).toBe(true);
    const after = await prisma.bvReportSchedule.findUniqueOrThrow({ where: { id: saved.id } });
    expect(after.nextRunAt!.getTime()).toBeGreaterThan(now.getTime());
    expect(after.lastRunAt).toBeTruthy();

    // download autenticado + isolamento entre órgãos
    const dl = await get(w, `/reports/exports/${jobs[0].id}/download`);
    expect(dl.statusCode).toBe(200); expect(dl.headers['x-content-sha256']).toBe(jobs[0].sha256);
    const other = await makeWorld();
    expect((await get(other, `/reports/exports/${jobs[0].id}/download`)).statusCode).toBe(404);
    expect((await get(other, '/reports/saved')).json().reports).toHaveLength(0);
    expect((await send(other, 'DELETE', `/reports/saved/${saved.id}`, undefined, 'sup')).statusCode).toBe(404);
  });

  it('falha de e-mail não duplica nem perde o arquivo; execução manual com JSON', async () => {
    const r = await send(w, 'POST', '/reports/saved', { name: 'Manual', definition: { metrics: ['total'], period: { from: '2026-11-01', to: '2026-11-30' } }, schedule: { frequency: 'WEEKLY', format: 'JSON', recipients: ['a@b.com'], active: false } }, 'sup');
    const id = r.json().id;
    setReportMailer(async () => { throw new Error('smtp fora'); });
    const run = await send(w, 'POST', `/reports/saved/${id}/run?send=true`, undefined, 'sup');
    expect(run.statusCode).toBe(200); expect(run.json().failed).toEqual(['a@b.com']);
    const list = (await get(w, '/reports/exports')).json().exports;
    const j = list.find((e: any) => e.id === run.json().jobId);
    expect(j).toMatchObject({ format: 'JSON', status: 'DONE', error: 'falha no envio de todos os e-mails' });
    setReportMailer(async (to, subject, html) => { sent.push({ to, subject, html }); });
    const upd = await send(w, 'PUT', `/reports/saved/${id}`, { schedule: null }, 'sup');
    expect(upd.json().schedule).toBeNull();
  });

  it('relatório mensal da contratada: documento JSON + CSV armazenados como BvExportJob', async () => {
    await prisma.bvOrg.update({ where: { id: w.orgId }, data: { settings: { contract: { startDate: '2026-09-01', hours: { curadoria: 12, integracao: 8, treinamento: 4 } } } } });
    const { invalidateOrgSettings } = await import('../../core/settings'); invalidateOrgSettings(w.orgId);
    await prisma.bvUsageDaily.createMany({ data: [{ orgId: w.orgId, day: new Date('2026-11-03T00:00:00Z'), item: 'WA_SERVICE', quantity: 77n }, { orgId: w.orgId, day: new Date('2026-11-03T00:00:00Z'), item: 'VOICE_MINUTES', quantity: 12n }, { orgId: w.orgId, day: new Date('2026-11-03T00:00:00Z'), item: 'STORAGE_BYTES', quantity: 5000n }] });
    await prisma.bvTask.createMany({ data: [{ orgId: w.orgId, code: `TAR-${Date.now()}1`, kind: 'SERVICE_REQUEST', status: 'OPEN', title: 't1', createdAt: new Date('2026-11-04T12:00:00Z') }, { orgId: w.orgId, code: `TAR-${Date.now()}2`, kind: 'SERVICE_REQUEST', status: 'DONE', title: 't2', createdAt: new Date('2026-11-04T12:00:00Z'), completedAt: new Date('2026-11-05T12:00:00Z') }, { orgId: w.orgId, code: `TAR-${Date.now()}3`, kind: 'INTERNAL', status: 'OPEN', title: 't3', createdAt: new Date('2026-11-04T12:00:00Z') }] });
    expect((await send(w, 'POST', '/reports/monthly', { month: '2026-13' }, 'sup')).statusCode).toBe(400);
    const r = await send(w, 'POST', '/reports/monthly', { month: '2026-11' }, 'sup');
    expect(r.statusCode).toBe(201);
    const d = r.json().document;
    expect(d.licenses.atendentes).toBeGreaterThanOrEqual(1);
    expect(d.messaging.find((m: any) => m.item === 'WA_SERVICE').quantity).toBe(77);
    expect(d.voice.minutes).toBe(12); expect(d.storage.maxBytes).toBe(5000);
    expect(d.attendances.total).toBe(8);
    expect(d.indicators).toMatchObject({ nps: 25, tmeAvgSec: 165, tmaAvgSec: 615 });
    expect(d.indicators.iqa).toMatchObject({ contractMonth: 3, goal: 40, glosaPct: 10, numerator: 1, base: 3 });
    expect(d.serviceDesk.createdByKind.SERVICE_REQUEST).toEqual({ total: 2, byStatus: { OPEN: 1, DONE: 1 } });
    expect(d.serviceDesk.completedInMonth).toBe(1);
    expect(d.contractHours).toEqual({ curadoria: 12, integracao: 8, treinamento: 4 });
    const json = await get(w, `/reports/exports/${r.json().jobId}/download`);
    expect(JSON.parse(json.body).month).toBe('2026-11');
    const csv = await get(w, `/reports/exports/${r.json().jobId}/download?format=csv`);
    expect(csv.body.startsWith('﻿Seção;Item;Valor;Unidade')).toBe(true);
    expect(csv.body).toContain('Indicadores;NPS;25;');
    const job = await prisma.bvExportJob.findUniqueOrThrow({ where: { id: r.json().jobId } });
    expect(job.sha256).toBe(r.json().sha256);
    expect(monthlyRows(await buildMonthly(w.orgId, '2026-10')).length).toBeGreaterThan(10);
  });
});

describe('reports — isolamento entre órgãos', () => {
  it('órgão B nunca vê dados do A (relatórios, exportação, cotas)', async () => {
    const a = await makeWorld(); await seedKnown(a);
    await prisma.bvQuota.create({ data: { orgId: a.orgId, item: 'WA_SERVICE', period: 'DAY', limit: 10n } });
    const b = await makeWorld();
    const ov = (await get(b, `/reports/overview?${PERIOD}`)).json().kpis;
    expect(ov.total).toBe(0); expect(ov.nps).toBeNull();
    expect((await get(b, `/reports/agents?${PERIOD}`)).json().agents).toHaveLength(0);
    expect((await get(b, `/reports/export/conversations?${PERIOD}&format=json`)).json().data).toHaveLength(0);
    expect((await get(b, '/fiscal/quotas', 'fiscal')).json().quotas).toHaveLength(0);
    // filtro por fila de outro órgão não vaza
    const f = (await get(b, `/reports/overview?${PERIOD}&queueId=${a.q1}`)).json().kpis;
    expect(f.total).toBe(0);
    const rt = (await get(b, '/reports/realtime')).json();
    expect(rt.waiting).toBe(0);
  });
});

describe('reports — desempenho com volume', () => {
  it('overview com ~20 mil conversas responde em < 2 s', async () => {
    const w = await makeWorld();
    const N = 20000;
    const start = Date.parse('2026-10-01T03:00:00Z');
    const chans = ['WHATSAPP', 'WEBCHAT', 'EMAIL', 'VOICE'];
    const data = Array.from({ length: N }, (_, i) => {
      const s = new Date(start + Math.floor((i / N) * 55 * 86400_000));
      const resp = 30 + (i % 600);
      return {
        orgId: w.orgId, contactId: w.contactId, protocol: `P-${i}`, channel: chans[i % 4], queueId: i % 2 ? w.q1 : w.q2, assignedUserId: i % 3 ? w.a1.id : w.a2.id,
        status: 'CLOSED', startedAt: s, queuedAt: s, assignedAt: new Date(s.getTime() + 20_000), firstResponseAt: new Date(s.getTime() + resp * 1000), closedAt: new Date(s.getTime() + (resp + 400) * 1000),
        closeReason: i % 17 === 0 ? 'ABANDONED' : 'RESOLVED', csatScore: i % 5 === 0 ? i % 11 : null, resolvedByBot: i % 7 === 0, botHandled: i % 7 === 0, automatable: i % 14 === 0, firstContactResolved: i % 3 === 0,
        slaFirstResponseDueAt: new Date(s.getTime() + 300_000), slaBreached: i % 40 === 0,
      };
    });
    for (let i = 0; i < N; i += 5000) await prisma.bvConversation.createMany({ data: data.slice(i, i + 5000) });
    try {
      const t0 = Date.now();
      const r = await get(w, '/reports/overview?from=2026-10-01&to=2026-11-30&compare=true');
      const ms = Date.now() - t0;
      expect(r.statusCode).toBe(200);
      expect(r.json().kpis.total).toBe(N);
      expect(ms).toBeLessThan(2000);
      const t1 = Date.now();
      const ag = await get(w, '/reports/agents?from=2026-10-01&to=2026-11-30');
      expect(ag.statusCode).toBe(200);
      expect(Date.now() - t1).toBeLessThan(3000);
      const ts = await get(w, '/reports/timeseries?from=2026-10-01&to=2026-11-30&granularity=day');
      expect(ts.json().series.length).toBeGreaterThan(50);
    } finally {
      await prisma.bvConversation.deleteMany({ where: { orgId: w.orgId } });
    }
  }, 120_000);
});
