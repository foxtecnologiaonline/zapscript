process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-12345678901234567890';

import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../../lib/prisma';
import { clearBvEventHandlers } from '../../../core/events';
import { saveIntegration } from '../../../core/integrations';
import { authHeader, buildBalcaoTestApp, makeOrg, makeUser } from '../../../core/testing';
import { AriController, setAriController } from '../controller';
import { evaluateNumber, maskNumber, parseDialedNumber, resolveDialPolicy, startOfLocalDay } from '../dialPolicy';
import type { PromptProvider } from '../prompts';
import { FakeAri } from './fakeAri';

let app: FastifyInstance;
beforeAll(async () => { app = await buildBalcaoTestApp(); });
afterAll(async () => { await app.close(); });
afterEach(() => { clearBvEventHandlers(); setAriController(null); });

describe('discagem restrita — avaliação do número (sem I/O)', () => {
  const def = resolveDialPolicy(undefined);

  it('padrão: só números nacionais fixos/celulares do Brasil (DDD+número, com ou sem +55/55)', () => {
    for (const n of ['6332180000', '63999990001', '(63) 99999-0001', '63 3218-0000', '+55 63 3218-0000', '+5563999990001', '5563999990001', '556332180000', '11987654321', '55988887777']) {
      expect(evaluateNumber(def, n).ok).toBe(true);
    }
    expect(parseDialedNumber('(63) 99999-0001').e164).toBe('+5563999990001');
  });

  it('padrão: bloqueia premium (0900/0300), 0800, internacionais, códigos de serviço, curtos e malformados', () => {
    const cases: Array<[string, string]> = [
      ['09001234567', 'premium'], ['0300 123 4567', 'premium'], ['+55 0900 123 4567', 'not_allowed'], ['08001234567', 'not_allowed'],
      ['+351912345678', 'not_allowed'], ['00351912345678', 'not_allowed'], ['+14155550100', 'not_allowed'], ['*21', 'service_code'], ['#31#', 'service_code'],
      ['190', 'not_allowed'], ['12345', 'not_allowed'], ['6399999000', 'not_allowed'], ['639999900011', 'not_allowed'], ['0063999990001', 'not_allowed'],
    ];
    for (const [n, reason] of cases) {
      const r = evaluateNumber(def, n);
      expect([n, r.ok]).toEqual([n, false]);
      if (!r.ok) expect([n, r.reason]).toEqual([n, reason]);
    }
  });

  it('prefixos do órgão substituem o padrão (casam o número digitado, o E.164 e o nacional); 0900/0300 e * # continuam bloqueados', () => {
    const p = resolveDialPolicy({ dialAllowPrefixes: ['+5563', '0800', '+351 9'] });
    expect(evaluateNumber(p, '63 99999-0001').ok).toBe(true);
    expect(evaluateNumber(p, '+55 63 3218-0000').ok).toBe(true);
    expect(evaluateNumber(p, '08001234567').ok).toBe(true);
    expect(evaluateNumber(p, '+351912345678').ok).toBe(true);
    expect(evaluateNumber(p, '11987654321').ok).toBe(false);
    const all = resolveDialPolicy({ dialAllowPrefixes: ['0', '+5563', '6'] });
    expect(evaluateNumber(all, '09001234567')).toMatchObject({ ok: false, reason: 'premium' });
    expect(evaluateNumber(all, '*21')).toMatchObject({ ok: false, reason: 'service_code' });
    const nat = resolveDialPolicy({ dialAllowPrefixes: ['63'] }); // prefixo nacional (DDD)
    expect(evaluateNumber(nat, '+5563999990001').ok).toBe(true);
    expect(evaluateNumber(nat, '11987654321').ok).toBe(false);
  });

  it('JSON bruto inválido cai no padrão por campo (validação no ponto de uso)', () => {
    expect(resolveDialPolicy(undefined)).toEqual({ dialAllowPrefixes: [], dialMaxPerAgentPerDay: 50, dialRequirePermission: true });
    expect(resolveDialPolicy('lixo')).toEqual(resolveDialPolicy(undefined));
    expect(resolveDialPolicy({ dialAllowPrefixes: 'x', dialMaxPerAgentPerDay: 'muitas', dialRequirePermission: 'não' })).toEqual(resolveDialPolicy(undefined));
    expect(resolveDialPolicy({ dialAllowPrefixes: ['63', 12, 'abc', '+55 61'], dialMaxPerAgentPerDay: -3 })).toEqual({ dialAllowPrefixes: ['63', '+5561'], dialMaxPerAgentPerDay: 50, dialRequirePermission: true });
    expect(resolveDialPolicy({ dialMaxPerAgentPerDay: 0, dialRequirePermission: false })).toMatchObject({ dialMaxPerAgentPerDay: 0, dialRequirePermission: false });
  });

  it('número mascarado para auditoria e início do dia no fuso do órgão', () => {
    expect(maskNumber('(63) 99999-0001')).toBe('+5563*******01');
    expect(maskNumber('+5563999990001')).not.toContain('99999');
    expect(maskNumber('+5563999990001').endsWith('01')).toBe(true);
    expect(maskNumber('0800123456')).toMatch(/^08\*+56$/);
    // 02:00 UTC de 25/11 = 23:00 de 24/11 em Araguaína (UTC-3) → o dia local começou em 24/11 03:00 UTC
    expect(startOfLocalDay('America/Araguaina', new Date('2026-11-25T02:00:00Z')).toISOString()).toBe('2026-11-24T03:00:00.000Z');
  });
});

// ── Controlador + rota, com ARI simulado ────────────────────────────────────────────────────────────
let extSeq = 3000;
async function setup(voice?: Record<string, unknown>) {
  const org = await makeOrg({ ai: { enabled: false }, ...(voice ? { voice } : {}) });
  const orgId = org.id;
  const mk = async (role: 'ATENDENTE' | 'FISCAL' | 'SUPERVISOR', presence = 'ONLINE') => {
    const u = await makeUser(orgId, role, { presence });
    return prisma.bvUser.update({ where: { id: u.id }, data: { sipExtension: String(++extSeq) } });
  };
  const agent = await mk('ATENDENTE');
  await saveIntegration(orgId, 'SIP_TRUNK', { trunkEndpoint: 'tjto-trunk' });
  const fake = new FakeAri(); await fake.start();
  const prompts: PromptProvider = { resolve: async () => ({ media: ['sound:x'], source: 'tts' as const }) };
  const ctl = new AriController({ connection: { url: fake.url, username: fake.user, password: fake.pass, app: 'balcao' }, prompts, agentRingMs: 300, recordingDir: fake.recordingDir, recordingWaitMs: 300, backoff: { baseMs: 20, maxMs: 60 } });
  setAriController(ctl); ctl.start();
  await fake.waitFor(() => fake.connected, 'ARI conectado');
  const dial = (number: string, user = agent) => app.inject({ method: 'POST', url: '/balcao/voice/calls/dial', headers: authHeader(user), payload: { number } });
  const audits = () => prisma.bvAuditLog.findMany({ where: { orgId, action: 'call.dial' }, orderBy: { createdAt: 'asc' } });
  const close = async () => { await ctl.shutdown(); await fake.stop(); };
  return { orgId, agent, mk, fake, ctl, dial, audits, close };
}
type S = Awaited<ReturnType<typeof setup>>;
let s: S | null = null;
afterEach(async () => { if (s) { await s.close(); s = null; } });

describe('discagem restrita — POST /voice/calls/dial', () => {
  it('número fora da política → 403 voice.dial_not_allowed, nada é originado nem gravado, auditoria mascarada', async () => {
    s = await setup(); const c = s;
    for (const n of ['09001234567', '+351912345678', '08001234567', '*21']) {
      const r = await c.dial(n);
      expect([n, r.statusCode]).toEqual([n, 403]);
      expect(r.json().error.code).toBe('voice.dial_not_allowed');
      expect(r.json().error.details.reason).toMatch(/premium|not_allowed|service_code/);
    }
    expect(c.fake.originated()).toEqual([]);
    expect(await prisma.bvCall.count({ where: { orgId: c.orgId } })).toBe(0);
    const logs = await c.audits();
    expect(logs).toHaveLength(4);
    expect(logs.every((l) => (l.meta as any).outcome === 'denied' && (l.meta as any).code === 'voice.dial_not_allowed' && l.actorId === c.agent.id)).toBe(true);
    expect(JSON.stringify(logs.map((l) => l.meta))).not.toContain('351912345678');
  });

  it('número permitido → 202, origina ao ramal, e audita call.dial com o destino mascarado', async () => {
    s = await setup(); const c = s;
    const r = await c.dial('63999990001');
    expect(r.statusCode).toBe(202);
    const call = await prisma.bvCall.findUniqueOrThrow({ where: { id: r.json().callId } });
    expect(call).toMatchObject({ direction: 'OUT', agentUserId: c.agent.id });
    await c.fake.waitFor(() => c.fake.originated().find((x) => x.endpoint === `PJSIP/${c.agent.sipExtension}`), 'toque no ramal');
    const [log] = await c.audits();
    expect(log).toMatchObject({ entityId: call.id, actorId: c.agent.id });
    expect(log.meta).toEqual({ to: '+5563*******01', outcome: 'started' });
    expect(JSON.stringify(log)).not.toContain('99999');
  });

  it('padrão exige permissão conversation:reply E presença ONLINE/BUSY; dialRequirePermission=false dispensa', async () => {
    s = await setup(); const c = s;
    const fiscal = await c.mk('FISCAL');
    const fr = await c.dial('6332180000', fiscal);
    expect(fr.statusCode).toBe(403);
    expect(fr.json().error).toMatchObject({ code: 'voice.dial_not_allowed', details: { reason: 'permission' } });

    for (const presence of ['OFFLINE', 'AWAY']) {
      await prisma.bvUser.update({ where: { id: c.agent.id }, data: { presence } });
      const r = await c.dial('6332180000');
      expect([presence, r.statusCode, r.json().error.details.reason]).toEqual([presence, 403, 'presence']);
    }
    await prisma.bvUser.update({ where: { id: c.agent.id }, data: { presence: 'BUSY' } });
    const busy = await c.dial('6332180000');
    expect(busy.statusCode).toBe(202); // em atendimento

    // política do órgão: sem exigência de permissão/presença
    const loose = await setup({ dialRequirePermission: false }); // outro órgão
    try {
      const f2 = await loose.mk('FISCAL', 'OFFLINE');
      expect((await loose.dial('6332180000', f2)).statusCode).toBe(202);
      expect((await loose.dial('09001234567', loose.agent)).statusCode).toBe(403); // número continua valendo
    } finally { setAriController(c.ctl); await loose.close(); }
  });

  it('dialMaxPerAgentPerDay: bloqueia com 429 voice.dial_limit só depois do limite do dia; outro atendente e dias anteriores não contam', async () => {
    s = await setup({ dialMaxPerAgentPerDay: 2 }); const c = s;
    const other = await c.mk('ATENDENTE');
    const mkCall = (userId: string, startedAt: Date) => prisma.bvCall.create({ data: { orgId: c.orgId, direction: 'OUT', fromNumber: '3001', toNumber: '6332180000', status: 'ENDED', agentUserId: userId, startedAt } });
    await mkCall(c.agent.id, new Date(Date.now() - 3 * 86400_000)); // dias atrás: não conta
    await mkCall(other.id, new Date()); await mkCall(other.id, new Date());
    await mkCall(c.agent.id, new Date());
    const ok = await c.dial('6332180000');
    expect(ok.statusCode).toBe(202);
    await c.ctl.hangup(c.orgId, ok.json().callId);
    await c.fake.waitFor(async () => (await prisma.bvCall.findUnique({ where: { id: ok.json().callId } }))?.endedAt, 'chamada encerrada');
    const blocked = await c.dial('6332181111');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error).toMatchObject({ code: 'voice.dial_limit', details: { reason: 'daily_limit' } });
    expect((await c.audits()).some((l) => (l.meta as any).code === 'voice.dial_limit' && (l.meta as any).outcome === 'denied')).toBe(true);
    // o outro atendente também está no limite (2 ligações) e também é barrado
    expect((await c.dial('6332181111', other)).statusCode).toBe(429);
  });

  it('dialMaxPerAgentPerDay=0 bloqueia tudo; valores inválidos no JSON do órgão voltam ao padrão (50)', async () => {
    s = await setup({ dialMaxPerAgentPerDay: 0 }); const c = s;
    expect((await c.dial('6332180000')).statusCode).toBe(429);
    const bad = await setup({ dialMaxPerAgentPerDay: 'infinito', dialAllowPrefixes: 'tudo', dialRequirePermission: 'talvez' });
    try {
      expect((await bad.dial('6332180000')).statusCode).toBe(202);
      expect((await bad.dial('09001234567', await bad.mk('ATENDENTE'))).statusCode).toBe(403);
    } finally { setAriController(c.ctl); await bad.close(); }
  });

  it('prefixos do órgão liberam números fora do padrão (ex.: 0800) e continuam restringindo o resto', async () => {
    s = await setup({ dialAllowPrefixes: ['0800', '+5563'] }); const c = s;
    expect((await c.dial('08001234567')).statusCode).toBe(202);
    await c.ctl.hangup(c.orgId, (await prisma.bvCall.findFirstOrThrow({ where: { orgId: c.orgId } })).id);
    await c.fake.waitFor(async () => (await prisma.bvCall.findFirstOrThrow({ where: { orgId: c.orgId } })).endedAt, 'encerrada');
    const r = await c.dial('11987654321');
    expect(r.statusCode).toBe(403);
    expect(r.json().error.details.reason).toBe('not_allowed');
  });

  it('sem sessão → 401; número malformado → 400 (antes da política)', async () => {
    s = await setup(); const c = s;
    expect((await app.inject({ method: 'POST', url: '/balcao/voice/calls/dial', payload: { number: '6332180000' } })).statusCode).toBe(401);
    expect((await c.dial('abc')).statusCode).toBe(400);
  });
});
