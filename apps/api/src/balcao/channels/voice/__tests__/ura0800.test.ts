process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-12345678901234567890';

import crypto from 'crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../../lib/prisma';
import { clearBvEventHandlers } from '../../../core/events';
import { getIntegration, saveIntegration } from '../../../core/integrations';
import { authHeader, buildBalcaoTestApp, makeOrg, makeUser } from '../../../core/testing';
import { AriController, setAriController } from '../controller';
import { resolveOrgForDid } from '../config';
import { resolveFlowForDid } from '../ivrFlows';
import type { PromptProvider } from '../prompts';
import { entryOptionOf, headersToCapture, mapUraHeaders, parseSrcAddr, sourceIpAllowed, ura0800Schema } from '../ura0800';
import { FakeAri } from './fakeAri';

let app: FastifyInstance;
beforeAll(async () => { app = await buildBalcaoTestApp(); });
afterAll(async () => { await app.close(); });
afterEach(() => { clearBvEventHandlers(); setAriController(null); });

const uniqDid = () => `0800${crypto.randomInt(1000000, 9999999)}`;
const FLOW = (header: string) => ({
  start: 'welcome', entryByHeader: { header, map: { '3': 'q_proc' } },
  nodes: {
    welcome: { type: 'menu', prompt: { text: 'Bem-vindo ao Balcão Virtual.' }, options: { '1': 'q_geral' }, maxRetries: 1, timeoutSec: 5 },
    q_geral: { type: 'queue', category: 'GERAL' },
    q_proc: { type: 'queue', category: 'PROCESSO', queue: 'processos' },
  },
});

async function world() {
  const org = await makeOrg({ ai: { enabled: false } });
  const admin = await makeUser(org.id, 'ADMIN');
  const agent = await makeUser(org.id, 'ATENDENTE');
  const mkFlow = (name: string, header = 'X-URA-Option') => prisma.bvIvrFlow.create({ data: { orgId: org.id, name, status: 'ACTIVE', definition: FLOW(header) as any, publishedAt: new Date() } });
  const put = (config: unknown, enabled?: boolean, h = authHeader(admin)) => app.inject({ method: 'PUT', url: '/balcao/voice/ura0800', headers: h, payload: { ...(enabled === undefined ? {} : { enabled }), config } as any });
  const test = (body: unknown = {}, h = authHeader(admin)) => app.inject({ method: 'POST', url: '/balcao/voice/ura0800/test', headers: h, payload: body as any });
  return { org, orgId: org.id, admin, agent, mkFlow, put, test };
}
type W = Awaited<ReturnType<typeof world>>;

describe('URA 0800 — unidades', () => {
  it('schema: DIDs {did, flowName}, headerMap com nomes X-*, IPs/CIDRs válidos; strict e sem DID repetido', () => {
    const ok = ura0800Schema.safeParse({ dids: [{ did: '08001112222', flowName: 'ura' }], headerMap: { opcao: 'X-TJTO-URA-Opcao' }, allowedSourceIps: ['203.0.113.0/24', '2001:db8::1'] });
    expect(ok.success).toBe(true);
    for (const bad of [
      { dids: [{ did: 'abc', flowName: 'x' }] }, { dids: [{ did: '0800', flowName: 'x' }] }, { dids: [{ did: '08001112222' }] },
      { dids: [], headerMap: { opcao: 'Opcao' } }, { dids: [], headerMap: { '1x': 'X-A' } }, { dids: [], allowedSourceIps: ['999.1.1.1'] }, { dids: [], allowedSourceIps: ['10.0.0.0/33'] },
      { dids: [{ did: '08001112222', flowName: 'a' }, { did: '08001112222', flowName: 'b' }] }, { dids: [], extra: 1 },
    ]) expect([JSON.stringify(bad), ura0800Schema.safeParse(bad).success]).toEqual([JSON.stringify(bad), false]);
  });

  it('cabeçalhos: o headerMap substitui os nomes fixos; opcao → entryOption (cabeçalho legado X-URA-Option sem URA_0800)', () => {
    const cfg = ura0800Schema.parse({ dids: [], headerMap: { opcao: 'X-TJTO-URA-Opcao', protocolo: 'X-TJTO-Proto' } });
    expect(headersToCapture(cfg, { preserveHeaders: ['X-URA-Option', 'X-URA-Id', 'X-Protocolo-0800'] })).toEqual(['X-TJTO-URA-Opcao', 'X-TJTO-Proto']); // padrão do tronco não entra
    expect(headersToCapture(cfg, { preserveHeaders: ['X-Custom'] })).toEqual(['X-TJTO-URA-Opcao', 'X-TJTO-Proto', 'X-Custom']);
    expect(headersToCapture(null, { preserveHeaders: ['X-URA-Option'] })).toEqual(['X-URA-Option']);
    const h = { 'x-tjto-ura-opcao': ' 7 ', 'X-TJTO-Proto': 'P1', 'X-Outro': 'z' };
    expect(mapUraHeaders(cfg, h)).toEqual({ opcao: '7', protocolo: 'P1' });
    expect(entryOptionOf(cfg, h)).toBe('7');
    expect(entryOptionOf(null, { 'X-URA-OPTION': '9' })).toBe('9');
    expect(entryOptionOf(cfg, { 'X-URA-Option': '9' })).toBeNull(); // com URA_0800 vale o cabeçalho mapeado
    expect(entryOptionOf(null, {})).toBeNull();
  });

  it('IP de origem: parse de ip:porta/[v6]:porta e CIDR/IPv4 mapeado', () => {
    expect(parseSrcAddr('203.0.113.7:5060')).toBe('203.0.113.7');
    expect(parseSrcAddr('203.0.113.7')).toBe('203.0.113.7');
    expect(parseSrcAddr('[2001:db8::1]:5060')).toBe('2001:db8::1');
    expect(parseSrcAddr('lixo:5060')).toBeNull();
    expect(parseSrcAddr('')).toBeNull();
    expect(parseSrcAddr(undefined)).toBeNull();
    expect(sourceIpAllowed(['203.0.113.0/24'], '203.0.113.200')).toBe(true);
    expect(sourceIpAllowed(['203.0.113.0/24'], '203.0.114.1')).toBe(false);
    expect(sourceIpAllowed(['198.51.100.5'], '198.51.100.5')).toBe(true);
    expect(sourceIpAllowed(['198.51.100.5'], '198.51.100.6')).toBe(false);
    expect(sourceIpAllowed(['2001:db8::/32'], '2001:db8:1::5')).toBe(true);
    expect(sourceIpAllowed(['203.0.113.0/24'], '::ffff:203.0.113.9')).toBe(true);
  });
});

describe('URA 0800 — GET/PUT /voice/ura0800 e POST /voice/ura0800/test', () => {
  it('GET vazio; PUT valida (strict), persiste cifrado, audita e versiona; só integration:manage', async () => {
    const w = await world();
    const hs = authHeader(await makeUser(w.orgId, 'SUPERVISOR'));
    const g0 = await app.inject({ method: 'GET', url: '/balcao/voice/ura0800', headers: authHeader(w.admin) });
    expect(g0.statusCode).toBe(200);
    expect(g0.json()).toMatchObject({ configured: false, enabled: false, status: 'UNCONFIGURED', config: { dids: [], headerMap: {} }, defaults: { headerMap: { opcao: 'X-URA-Option' } } });

    const cfg = { dids: [{ did: '08001112222', flowName: 'ura-0800' }], headerMap: { opcao: 'X-TJTO-URA-Opcao', cpf: 'X-TJTO-Cpf' }, allowedSourceIps: ['203.0.113.0/24'] };
    expect((await w.put(cfg, true, authHeader(w.agent))).statusCode).toBe(403);
    expect((await w.put(cfg, true, hs)).statusCode).toBe(403); // supervisor não tem integration:manage
    expect((await w.put({ ...cfg, headerMap: { opcao: 'Opcao' } })).statusCode).toBe(400);
    expect((await w.put({ ...cfg, dids: [{ did: 'xx', flowName: 'a' }] })).statusCode).toBe(400);
    expect((await w.put({ ...cfg, surpresa: 1 })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/balcao/voice/ura0800', payload: { config: cfg } })).statusCode).toBe(401);

    const r = await w.put(cfg, true);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true, enabled: true, config: cfg });
    const g1 = (await app.inject({ method: 'GET', url: '/balcao/voice/ura0800', headers: authHeader(w.admin) })).json();
    expect(g1).toMatchObject({ configured: true, enabled: true, config: cfg });

    const row = await prisma.bvIntegration.findFirstOrThrow({ where: { orgId: w.orgId, type: 'URA_0800' } });
    expect(row.configEnc).not.toContain('X-TJTO-URA-Opcao'); // cifrado em repouso
    expect((await getIntegration(w.orgId, 'URA_0800'))?.config).toMatchObject({ dids: cfg.dids });
    expect(await prisma.bvAuditLog.count({ where: { orgId: w.orgId, action: 'config.update', entityType: 'URA_0800' } })).toBe(1);
    expect(await prisma.bvConfigVersion.count({ where: { orgId: w.orgId, kind: 'URA_0800' } })).toBe(1);

    // desabilitar sem reenviar tudo não é suportado: PUT é substituição completa; enabled:false desliga
    expect((await w.put(cfg, false)).json().enabled).toBe(false);
  });

  it('POST /test: confere DID → fluxo ACTIVE, cabeçalhos do INVITE de teste e IP de origem; status da integração acompanha', async () => {
    const w = await world();
    const did = uniqDid();
    expect((await w.test()).statusCode).toBe(404); // sem config
    await w.put({ dids: [{ did, flowName: 'ura-0800' }], headerMap: { opcao: 'X-TJTO-URA-Opcao', cpf: 'X-TJTO-Cpf' }, allowedSourceIps: ['203.0.113.0/24'] }, true);

    const noFlow = (await w.test({ did })).json();
    expect(noFlow).toMatchObject({ ok: false, dids: [{ did, flowName: 'ura-0800', flowFound: false }] });
    expect(noFlow.warnings.join(' ')).toContain('ura-0800');
    expect((await prisma.bvIntegration.findFirstOrThrow({ where: { orgId: w.orgId, type: 'URA_0800' } })).status).toBe('ERROR');

    const flow = await w.mkFlow('ura-0800', 'X-TJTO-URA-Opcao');
    const full = (await w.test({ did, headers: { 'X-TJTO-URA-Opcao': '3', 'X-TJTO-Cpf': '123' }, sourceIp: '203.0.113.50:5060' })).json();
    expect(full).toMatchObject({
      ok: true, enabled: true, dids: [{ did, flowFound: true, flowId: flow.id, flowVersion: 1 }],
      headers: { captured: { opcao: '3', cpf: '123' }, missing: [] }, sourceIp: { configured: true, allowed: true },
      entry: { option: '3', node: 'q_proc' }, warnings: [],
    });
    expect((await prisma.bvIntegration.findFirstOrThrow({ where: { orgId: w.orgId, type: 'URA_0800' } })).status).toBe('OK');

    const bad = (await w.test({ did, headers: { 'X-TJTO-URA-Opcao': '3' }, sourceIp: '198.51.100.1' })).json();
    expect(bad.ok).toBe(false);
    expect(bad).toMatchObject({ sourceIp: { allowed: false }, headers: { missing: ['cpf'] } });
    expect((await w.test({ did: '0800999' })).json().warnings.join(' ')).toContain('não está em dids');
    expect((await w.test({ did: 'x' })).statusCode).toBe(400);
    expect(await prisma.bvIntegrationLog.count({ where: { orgId: w.orgId, type: 'URA_0800', operation: 'test' } })).toBeGreaterThanOrEqual(4);
  });

  it('config salva fora do schema (legado/edição manual) → 422 no /test; DID resolve órgão com ambos os formatos', async () => {
    const w = await world();
    const did = uniqDid(); const legacy = uniqDid();
    await saveIntegration(w.orgId, 'URA_0800', { dids: [{ did, flowName: 'f' }] }, { enabled: true });
    expect(await resolveOrgForDid(did)).toBe(w.orgId);
    await saveIntegration(w.orgId, 'URA_0800', { dids: [legacy], extra: true }, { enabled: true });
    expect(await resolveOrgForDid(legacy)).toBe(w.orgId); // formato antigo string[]
    const r = await w.test({});
    expect(r.statusCode).toBe(422);
    expect(r.json().error.code).toBe('ura0800.invalid_config');
  });

  it('resolveFlowForDid: o mapeamento do 0800 (flowName) tem prioridade sobre fluxos por definition.dids e o padrão', async () => {
    const w = await world();
    const did = uniqDid();
    const padrao = await w.mkFlow('padrao');
    const ura = await w.mkFlow('ura-0800');
    expect((await resolveFlowForDid(w.orgId, did))?.id).toBe(padrao.id); // sem integração: fluxo padrão
    await saveIntegration(w.orgId, 'URA_0800', { dids: [{ did, flowName: 'ura-0800' }], headerMap: {} }, { enabled: true });
    expect((await resolveFlowForDid(w.orgId, did))?.id).toBe(ura.id);
    expect((await resolveFlowForDid(w.orgId, uniqDid()))?.id).toBe(padrao.id); // outro DID: não mapeado
    await saveIntegration(w.orgId, 'URA_0800', { dids: [{ did, flowName: 'inexistente' }], headerMap: {} }, { enabled: true });
    expect((await resolveFlowForDid(w.orgId, did))?.id).toBe(padrao.id); // flowName sem fluxo ACTIVE: cai no padrão
    await saveIntegration(w.orgId, 'URA_0800', { dids: [{ did, flowName: 'ura-0800' }], headerMap: {} }, { enabled: false });
    expect((await resolveFlowForDid(w.orgId, did))?.id).toBe(padrao.id); // integração desabilitada: ignorada
  });
});

// ── Controlador: INVITE com X-* do 0800 ──────────────────────────────────────────────────────────────
async function ariWorld(w: W) {
  const fake = new FakeAri(); await fake.start();
  const prompts: PromptProvider = { resolve: async (_o, p) => ({ media: [`sound:test/${p.text.slice(0, 12).replace(/\W/g, '_')}`], source: 'tts' as const }) };
  const ctl = new AriController({ connection: { url: fake.url, username: fake.user, password: fake.pass, app: 'balcao' }, prompts, agentRingMs: 300, recordingDir: fake.recordingDir, recordingWaitMs: 300, backoff: { baseMs: 20, maxMs: 60 } });
  ctl.start();
  await fake.waitFor(() => fake.connected, 'ARI conectado');
  const callOf = (ch: string) => prisma.bvCall.findFirst({ where: { orgId: w.orgId, ariChannelId: ch } });
  return { fake, ctl, callOf, close: async () => { await ctl.shutdown(); await fake.stop(); } };
}

describe('URA 0800 — INVITE com cabeçalhos X-* vira metadata da chamada/conversa', () => {
  it('headerMap do 0800: lê SÓ os cabeçalhos configurados, entryOption + voice.ura0800, fluxo por flowName e entrada direta (entryByHeader)', async () => {
    const w = await world();
    const did = uniqDid();
    await w.mkFlow('padrao');
    await w.mkFlow('ura-0800', 'X-TJTO-URA-Opcao');
    await saveIntegration(w.orgId, 'SIP_TRUNK', { trunkEndpoint: 'tjto-trunk' }); // sem dids: o órgão vem da URA_0800
    expect((await w.put({ dids: [{ did, flowName: 'ura-0800' }], headerMap: { opcao: 'X-TJTO-URA-Opcao', protocolo: 'X-TJTO-Protocolo' } }, true)).statusCode).toBe(200);
    const c = await ariWorld(w);
    try {
      c.fake.incoming('ch-0800', { number: '63999990100', did, headers: { 'X-TJTO-URA-Opcao': '3', 'X-TJTO-Protocolo': 'TJ-77', 'X-Outro': 'nao-lido', 'X-URA-Option': '1' } });
      const call = await c.fake.waitFor(async () => { const x = await c.callOf('ch-0800'); return x?.status === 'QUEUED' ? x : null; }, 'direto para a fila (opção 3 do 0800)');
      const conv = await prisma.bvConversation.findUniqueOrThrow({ where: { id: call.conversationId! } });
      const meta = conv.metadata as any;
      expect(meta.ivr.entryOption).toBe('3');
      expect(meta.ivr).toMatchObject({ queue: 'processos', category: 'PROCESSO', outcome: 'queue' }); // mesclado: entryOption permanece
      expect(meta.voice.ura0800).toEqual({ headers: { opcao: '3', protocolo: 'TJ-77' } });
      expect(meta.voice.headers).toEqual({ 'X-TJTO-URA-Opcao': '3', 'X-TJTO-Protocolo': 'TJ-77' }); // X-Outro e o X-URA-Option padrão não foram lidos
      expect(meta.voice.flow).toMatchObject({ name: 'ura-0800' });
      expect(conv.category).toBe('PROCESSO');
      expect(call.ivrFlowId).toBe(meta.voice.flow.id);
      expect(c.fake.playsOn('ch-0800').some((p) => p.media[0].includes('Bem_vindo'))).toBe(false); // pulou o menu
      const asked = c.fake.requests.filter((r) => r.path.endsWith('/variable')).map((r) => r.query.variable);
      expect(asked.sort()).toEqual(['PJSIP_HEADER(read,X-TJTO-Protocolo)', 'PJSIP_HEADER(read,X-TJTO-URA-Opcao)']);

      // a API de consulta expõe tudo isso ao frontend
      const sup = await makeUser(w.orgId, 'SUPERVISOR');
      const d = (await app.inject({ method: 'GET', url: `/balcao/voice/calls/${call.id}`, headers: authHeader(sup) })).json();
      expect(d.voice.headers['X-TJTO-URA-Opcao']).toBe('3');
      expect(d.voice.flow.name).toBe('ura-0800');
    } finally { await c.close(); }
  });

  it('sem URA_0800: cabeçalho legado X-URA-Option também vira ivr.entryOption (compatibilidade)', async () => {
    const w = await world();
    const did = uniqDid();
    await w.mkFlow('padrao');
    await saveIntegration(w.orgId, 'SIP_TRUNK', { trunkEndpoint: 'tjto-trunk', dids: [did] });
    const c = await ariWorld(w);
    try {
      c.fake.incoming('ch-legacy', { number: '63999990101', did, headers: { 'X-URA-Option': '3' } });
      const call = await c.fake.waitFor(async () => { const x = await c.callOf('ch-legacy'); return x?.status === 'QUEUED' ? x : null; }, 'fila');
      const meta = (await prisma.bvConversation.findUniqueOrThrow({ where: { id: call.conversationId! } })).metadata as any;
      expect(meta.ivr.entryOption).toBe('3');
      expect(meta.voice.ura0800).toBeUndefined();
    } finally { await c.close(); }
  });

  it('allowedSourceIps: só aceita INVITE de IP permitido (BV_SRC_ADDR do dialplan); IP fora, ausente ou inválido é recusado sem criar chamada', async () => {
    const w = await world();
    const did = uniqDid(); const other = uniqDid();
    await w.mkFlow('padrao');
    await saveIntegration(w.orgId, 'SIP_TRUNK', { trunkEndpoint: 'tjto-trunk', dids: [other] });
    await w.put({ dids: [{ did, flowName: 'padrao' }], headerMap: { opcao: 'X-TJTO-URA-Opcao' }, allowedSourceIps: ['203.0.113.0/24', '198.51.100.5'] }, true);
    const c = await ariWorld(w);
    try {
      c.fake.incoming('ch-ip-ok', { number: '63999990201', did, channelvars: { BV_SRC_ADDR: '203.0.113.77:5060' } });
      await c.fake.waitFor(() => c.callOf('ch-ip-ok'), 'chamada do IP permitido');
      c.fake.incoming('ch-ip-ok2', { number: '63999990202', did, channelvars: { BV_SRC_ADDR: '198.51.100.5:5060' } });
      await c.fake.waitFor(() => c.callOf('ch-ip-ok2'), 'IP exato permitido');
      for (const [id, vars] of [['ch-ip-bad', { BV_SRC_ADDR: '192.0.2.10:5060' }], ['ch-ip-none', {}], ['ch-ip-junk', { BV_SRC_ADDR: 'x:y' }]] as const) {
        c.fake.incoming(id, { number: '63999990203', did, channelvars: vars });
        await c.fake.waitFor(() => !c.fake.channels.has(id), `${id} recusada`);
        expect(await c.callOf(id)).toBeNull();
      }
      // DID que não é do 0800 (outro tronco) não é afetado pela lista de IPs
      c.fake.incoming('ch-other', { number: '63999990204', did: other, channelvars: { BV_SRC_ADDR: '192.0.2.10:5060' } });
      await c.fake.waitFor(() => c.callOf('ch-other'), 'DID fora do 0800 segue normal');
    } finally { await c.close(); }
  });
});
