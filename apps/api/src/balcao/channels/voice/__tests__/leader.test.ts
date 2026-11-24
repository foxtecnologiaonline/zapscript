process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-12345678901234567890';

import crypto from 'crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../../lib/prisma';
import { redis } from '../../../../services/queue';
import { clearBvEventHandlers } from '../../../core/events';
import { saveIntegration } from '../../../core/integrations';
import { authHeader, buildBalcaoTestApp, makeOrg, makeUser } from '../../../core/testing';
import { AriController, setAriController, type LeaderLockSettings } from '../controller';
import { AriLeaderLock, type LockRedis } from '../leader';
import type { PromptProvider } from '../prompts';
import { FakeAri } from './fakeAri';

const prompts: PromptProvider = { resolve: async () => ({ media: ['sound:test/x'], source: 'tts' as const }) };
const LOCK = { ttlMs: 600, renewMs: 100, retryMs: 60 };

async function world() {
  const org = await makeOrg({ ai: { enabled: false } });
  const did = `0800${crypto.randomInt(1000000, 9999999)}`;
  await saveIntegration(org.id, 'SIP_TRUNK', { trunkEndpoint: 'tjto-trunk', dids: [did] });
  const fake = new FakeAri(); await fake.start();
  const mk = (lock: LeaderLockSettings = LOCK) => new AriController({
    connection: { url: fake.url, username: fake.user, password: fake.pass, app: 'balcao', orgId: org.id }, prompts, lock,
    agentRingMs: 300, recordingDir: fake.recordingDir, recordingWaitMs: 300, backoff: { baseMs: 20, maxMs: 60 },
  });
  const wsClients = () => (fake.wss as any).clients.size as number;
  const callsOf = () => prisma.bvCall.count({ where: { orgId: org.id } });
  return { org, orgId: org.id, did, fake, mk, wsClients, callsOf };
}
type W = Awaited<ReturnType<typeof world>>;

let w: W | null = null;
const ctls: AriController[] = [];
afterEach(async () => {
  for (const c of ctls.splice(0)) await c.shutdown();
  if (w) { await w.fake.stop(); await redis.del(`bv:voice:ari-leader:${w.orgId}:balcao`); w = null; }
  clearBvEventHandlers(); setAriController(null);
});
const track = (c: AriController) => { ctls.push(c); return c; };
const until = <T>(fn: () => T | Promise<T>, what: string, ms = 6000) => w!.fake.waitFor(fn, what, ms);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('ARI — exclusão mútua (lock em Redis, leader/standby)', () => {
  it('dois controladores concorrentes: só um vira leader e conecta ao ARI; a chamada é tratada UMA vez', async () => {
    w = await world(); const x = w;
    const a = track(x.mk()); const b = track(x.mk());
    a.start(); b.start();
    await until(() => [a, b].filter((c) => c.role === 'leader').length === 1, 'um leader');
    await until(() => x.fake.connected, 'leader conectado ao ARI');
    await sleep(300); // o standby continua tentando, sem nunca conectar
    expect([a.role, b.role].sort()).toEqual(['leader', 'standby']);
    expect(x.wsClients()).toBe(1);
    const leader = a.role === 'leader' ? a : b; const standby = leader === a ? b : a;
    expect(leader.status()).toMatchObject({ role: 'leader', connected: true });
    expect(standby.status()).toMatchObject({ role: 'standby', connected: false });

    x.fake.incoming('ch-lead-1', { number: '63999990001', did: x.did });
    await until(async () => (await x.callsOf()) >= 1, 'chamada criada');
    await sleep(400);
    expect(await x.callsOf()).toBe(1); // sem duplicidade
    expect(x.fake.req('POST', '/channels/ch-lead-1/answer')).toHaveLength(1);
    expect(leader.activeCallIds(x.orgId)).toHaveLength(1);
    expect(standby.activeCallIds(x.orgId)).toHaveLength(0);
  });

  it('shutdown do leader libera o lock: o standby assume rapidamente (bem antes do TTL) e passa a atender', async () => {
    w = await world(); const x = w;
    const a = track(x.mk({ ...LOCK, ttlMs: 30_000, renewMs: 5_000 })); const b = track(x.mk({ ...LOCK, ttlMs: 30_000, renewMs: 5_000 }));
    a.start();
    await until(() => a.role === 'leader', 'A leader');
    b.start();
    await sleep(250);
    expect(b.role).toBe('standby');
    const t0 = Date.now();
    await a.shutdown();
    expect(await redis.get(a.lockKey)).toBeNull(); // liberado, não esperou expirar
    await until(() => b.role === 'leader', 'B assumiu');
    expect(Date.now() - t0).toBeLessThan(5000); // TTL era 30 s
    await until(() => x.fake.connected, 'B conectado');
    x.fake.incoming('ch-lead-2', { number: '63999990002', did: x.did });
    await until(async () => (await x.callsOf()) === 1, 'B atendeu');
  });

  it('lock perdido (outro dono) → leader desconecta e vira standby; reassume quando o lock fica livre', async () => {
    w = await world(); const x = w;
    const a = track(x.mk());
    a.start();
    await until(() => a.role === 'leader' && x.fake.connected, 'leader');
    await redis.set(a.lockKey, 'intruso', 'PX', 60_000); // outra instância "roubou" o lock
    await until(() => a.role === 'standby', 'standby após perder o lock');
    await until(() => !x.fake.connected, 'WebSocket do ARI fechado');
    expect(a.status()).toMatchObject({ role: 'standby', connected: false });
    x.fake.incoming('ch-lost', { number: '63999990003', did: x.did });
    await sleep(300);
    expect(await x.callsOf()).toBe(0); // standby não atende
    await redis.del(a.lockKey);
    await until(() => a.role === 'leader' && x.fake.connected, 'reassumiu');
  });

  it('o lock é renovado enquanto o leader vive (passa do TTL original) e a chave é por órgão/app do ARI', async () => {
    w = await world(); const x = w;
    const a = track(x.mk({ ttlMs: 400, renewMs: 80, retryMs: 50 }));
    a.start();
    await until(() => a.role === 'leader', 'leader');
    expect(a.lockKey).toBe(`bv:voice:ari-leader:${x.orgId}:balcao`);
    await sleep(1200); // 3× o TTL
    expect(a.role).toBe('leader');
    expect(await redis.get(a.lockKey)).not.toBeNull();
    expect(await redis.pttl(a.lockKey)).toBeGreaterThan(0);
    // outra app/órgão = outra chave (não disputam)
    const other = new AriController({ connection: { url: x.fake.url, username: 'u', password: 'p', app: 'outra-app', orgId: 'org-x' }, prompts });
    expect(other.lockKey).toBe('bv:voice:ari-leader:org-x:outra-app');
    const env = new AriController({ connection: { url: 'http://asterisk:8088/', username: 'u', password: 'p', app: 'balcao' }, prompts });
    expect(env.lockKey).toMatch(/^bv:voice:ari-leader:[0-9a-f]{16}:balcao$/);
    expect(env.lockKey).toBe(new AriController({ connection: { url: 'http://asterisk:8088', username: 'u', password: 'p', app: 'balcao' }, prompts }).lockKey);
  });

  it('Redis indisponível no início → standby (falha fechada) e assume quando volta; /voice/status informa o role; dial em standby = 503', async () => {
    w = await world(); const x = w;
    let down = true;
    const flaky: LockRedis = {
      set: (...a) => (down ? Promise.reject(new Error('redis fora')) : (redis as any).set(...a)),
      eval: (...a) => (down ? Promise.reject(new Error('redis fora')) : (redis as any).eval(...a)),
    };
    const a = track(x.mk({ ...LOCK, redis: flaky }));
    setAriController(a); a.start();
    await sleep(300);
    expect(a.role).toBe('standby');
    expect(x.wsClients()).toBe(0);

    const app: FastifyInstance = await buildBalcaoTestApp();
    try {
      const sup = await makeUser(x.orgId, 'SUPERVISOR');
      const st = await app.inject({ method: 'GET', url: '/balcao/voice/status', headers: authHeader(sup) });
      expect(st.json()).toMatchObject({ started: true, role: 'standby', connected: false });
      const agent = await makeUser(x.orgId, 'ATENDENTE', { presence: 'ONLINE' });
      await prisma.bvUser.update({ where: { id: agent.id }, data: { sipExtension: '3999' } });
      const d = await app.inject({ method: 'POST', url: '/balcao/voice/calls/dial', headers: authHeader(agent), payload: { number: '6332180000' } });
      expect(d.statusCode).toBe(503);
      expect(d.json().error.code).toBe('voice.standby');

      down = false;
      await until(() => a.role === 'leader' && x.fake.connected, 'assumiu após Redis voltar');
      const st2 = await app.inject({ method: 'GET', url: '/balcao/voice/status', headers: authHeader(sup) });
      expect(st2.json()).toMatchObject({ role: 'leader', connected: true });
    } finally { await app.close(); }
  });

  it('Redis cai com o leader ativo: mantém a liderança dentro do TTL e abre mão ao estourar (não dá para provar a posse)', async () => {
    const calls: string[] = [];
    let down = false; let lost = 0; let got = 0;
    const store = new Map<string, string>();
    const fakeRedis: LockRedis = {
      async set(k, v) { if (down) throw new Error('x'); if (store.has(k)) return null; store.set(k, v); return 'OK'; },
      async eval(_s, _n, k, id) { calls.push('eval'); if (down) throw new Error('x'); const ok = store.get(String(k)) === id; if (ok && String(_s).includes("'del'")) store.delete(String(k)); return ok ? 1 : 0; },
    };
    const lock = new AriLeaderLock({ redis: fakeRedis, key: 'k', ttlMs: 500, renewMs: 60, retryMs: 60, onAcquire: () => { got++; }, onLose: () => { lost++; } });
    lock.start();
    await sleep(150);
    expect(lock.held).toBe(true);
    down = true;
    await sleep(250); // < TTL: ainda líder
    expect(lock.held).toBe(true); expect(lost).toBe(0);
    await sleep(500); // > TTL sem confirmação
    expect(lock.held).toBe(false); expect(lost).toBe(1);
    down = false; store.clear();
    await sleep(250);
    expect(lock.held).toBe(true); expect(got).toBe(2);
    await lock.stop();
    expect(store.size).toBe(0); // liberado
    expect(calls.length).toBeGreaterThan(2);
  });
});
