process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-12345678901234567890';

import crypto from 'crypto';
import path from 'path';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../../lib/prisma';
import { openConversation } from '../../../core/conversations';
import { clearBvEventHandlers } from '../../../core/events';
import { saveIntegration } from '../../../core/integrations';
import { getObjectBuffer, newKey, putObject } from '../../../core/storage';
import { authHeader, buildBalcaoTestApp, makeOrg, makeUser } from '../../../core/testing';
import { AriController, setAriController } from '../controller';
import type { PromptProvider } from '../prompts';
import { buildSoftphoneCredentials, deriveSipPassword, parseIceServers } from '../sip';
import { inspectWav, makeToneWav } from '../wav';
import { FakeAri } from './fakeAri';

const INFRA = path.resolve(__dirname, '../../../../../../../infra/asterisk');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const genAgents = require(path.join(INFRA, 'gen-agents.js')) as { derivePassword(s: string, e: string): string; generate(env: Record<string, string>): string };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { renderTemplate } = require(path.join(INFRA, 'render.js')) as { renderTemplate(t: string, env: Record<string, string>, f?: string): string };

const FLOW = (did: string, extra: Record<string, unknown> = {}) => ({
  start: 'm', dids: [did], ...extra,
  nodes: {
    m: { type: 'menu', prompt: { text: 'Digite 1 para atendimento.' }, options: { '1': 'q' }, maxRetries: 1 },
    q: { type: 'queue', category: 'GERAL' },
  },
});
const uniqDid = () => `0800${crypto.randomInt(1000000, 9999999)}`;

let app: FastifyInstance;
beforeAll(async () => { app = await buildBalcaoTestApp(); });
afterAll(async () => { await app.close(); });
afterEach(() => { clearBvEventHandlers(); setAriController(null); delete process.env.BV_DEV_SIMULATORS; delete process.env.BV_SIP_SECRET; });

async function world() {
  const org = await makeOrg({ ai: { enabled: false } });
  const sup = await makeUser(org.id, 'SUPERVISOR');
  const agent = await makeUser(org.id, 'ATENDENTE');
  const fiscal = await makeUser(org.id, 'FISCAL');
  return { org, orgId: org.id, sup, agent, fiscal, hs: authHeader(sup), ha: authHeader(agent), hf: authHeader(fiscal) };
}
type W = Awaited<ReturnType<typeof world>>;

async function makeCall(w: W, o: { agentUserId?: string; withRecording?: boolean; status?: string; number?: string; durationSec?: number; startedAt?: Date; answered?: boolean; direction?: string; protocol?: boolean } = {}) {
  let rec: { key: string; sha256: string; size: number } | null = null;
  if (o.withRecording) rec = await putObject(newKey(w.orgId, 'recordings', 'wav'), makeToneWav(2));
  const call = await prisma.bvCall.create({
    data: {
      orgId: w.orgId, direction: o.direction ?? 'IN', fromNumber: o.number ?? '63999990000', toNumber: '08001234567', status: o.status ?? 'ENDED',
      startedAt: o.startedAt ?? new Date(), endedAt: new Date(), durationSec: o.durationSec ?? 30, agentUserId: o.agentUserId ?? null, answeredAt: o.answered ? new Date() : null,
      ...(rec ? { recordingKey: rec.key, recordingSha256: rec.sha256, recordingSizeBytes: BigInt(rec.size) } : {}),
    },
  });
  return { call, rec };
}

describe('voice — gravações (busca, reprodução com Range e auditoria)', () => {
  it('GET /calls/:id/recording: 200 completo, 206 com Range, 416 inválido, auditado como recording.listen', async () => {
    const w = await world();
    const { call, rec } = await makeCall(w, { withRecording: true });
    const full = await app.inject({ method: 'GET', url: `/balcao/voice/calls/${call.id}/recording`, headers: w.hs });
    expect(full.statusCode).toBe(200);
    expect(full.headers['content-type']).toBe('audio/wav');
    expect(full.headers['accept-ranges']).toBe('bytes');
    expect(Number(full.headers['content-length'])).toBe(rec!.size);
    expect(inspectWav(full.rawPayload)).toMatchObject({ channels: 1, bits: 16 });
    expect(crypto.createHash('sha256').update(full.rawPayload).digest('hex')).toBe(rec!.sha256);

    const part = await app.inject({ method: 'GET', url: `/balcao/voice/calls/${call.id}/recording`, headers: { ...w.hs, range: 'bytes=44-99' } });
    expect(part.statusCode).toBe(206);
    expect(part.headers['content-range']).toBe(`bytes 44-99/${rec!.size}`);
    expect(part.rawPayload.length).toBe(56);
    expect(part.rawPayload.equals((await getObjectBuffer(rec!.key)).subarray(44, 100))).toBe(true);

    const tail = await app.inject({ method: 'GET', url: `/balcao/voice/calls/${call.id}/recording`, headers: { ...w.hs, range: 'bytes=-10' } });
    expect(tail.statusCode).toBe(206);
    expect(tail.rawPayload.length).toBe(10);

    const bad = await app.inject({ method: 'GET', url: `/balcao/voice/calls/${call.id}/recording`, headers: { ...w.hs, range: 'bytes=999999-' } });
    expect(bad.statusCode).toBe(416);
    expect(bad.headers['content-range']).toBe(`bytes */${rec!.size}`);

    const dl = await app.inject({ method: 'GET', url: `/balcao/voice/calls/${call.id}/recording?download=true`, headers: w.hs });
    expect(String(dl.headers['content-disposition'])).toMatch(/^attachment; filename=/);

    const logs = await prisma.bvAuditLog.findMany({ where: { orgId: w.orgId, action: 'recording.listen', entityId: call.id } });
    expect(logs.length).toBe(4); // 200 + 206 + 206 + download (o 416 não entrega áudio)
    expect(logs.every((l) => l.actorId === w.sup.id)).toBe(true);
    expect(logs.some((l) => (l.meta as any)?.range === 'bytes=44-99')).toBe(true);
  });

  it('permissão e isolamento: atendente/fiscal não escutam; outro órgão recebe 404; sem gravação = 404', async () => {
    const w = await world(); const other = await world();
    const { call } = await makeCall(w, { withRecording: true });
    const { call: noRec } = await makeCall(w);
    expect((await app.inject({ method: 'GET', url: `/balcao/voice/calls/${call.id}/recording`, headers: w.ha })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/balcao/voice/calls/${call.id}/recording`, headers: w.hf })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/balcao/voice/calls/${call.id}/recording`, headers: other.hs })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/balcao/voice/calls/${call.id}/recording` })).statusCode).toBe(401);
    const r = await app.inject({ method: 'GET', url: `/balcao/voice/calls/${noRec.id}/recording`, headers: w.hs });
    expect(r.statusCode).toBe(404);
    expect(r.json().error?.code ?? r.json().code).toBe('recording.not_found');
  });

  it('GET /calls/:id/recording/meta: sha256, tamanho e verificação de integridade (?verify=true)', async () => {
    const w = await world();
    const { call, rec } = await makeCall(w, { withRecording: true });
    const ok = await app.inject({ method: 'GET', url: `/balcao/voice/calls/${call.id}/recording/meta?verify=true`, headers: w.hs });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ callId: call.id, format: 'audio/wav', sha256: rec!.sha256, sizeBytes: rec!.size, integrityOk: true });
    await prisma.bvCall.update({ where: { id: call.id }, data: { recordingSha256: 'f'.repeat(64) } });
    const tampered = await app.inject({ method: 'GET', url: `/balcao/voice/calls/${call.id}/recording/meta?verify=true`, headers: w.hs });
    expect(tampered.json().integrityOk).toBe(false);
  });

  it('cobertura de gravação (100% das chamadas): conta atendidas × com arquivo e lista as que faltam', async () => {
    const w = await world();
    await makeCall(w, { withRecording: true });
    await makeCall(w, { withRecording: true, status: 'ABANDONED' });
    const { call: missing } = await makeCall(w); // ENDED sem gravação
    await makeCall(w, { status: 'FAILED', direction: 'OUT' }); // originação que nunca atendeu: fora da conta
    const r = await app.inject({ method: 'GET', url: '/balcao/voice/recording/coverage', headers: w.hf }); // fiscal tem report:read
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ total: 3, withRecording: 2, withoutRecording: 1, coveragePct: 66.67 });
    expect(r.json().recentMissing.map((x: any) => x.id)).toEqual([missing.id]);
    expect((await app.inject({ method: 'GET', url: '/balcao/voice/recording/coverage', headers: w.ha })).statusCode).toBe(403);
    const empty = await world();
    expect((await app.inject({ method: 'GET', url: '/balcao/voice/recording/coverage', headers: empty.hs })).json()).toMatchObject({ total: 0, coveragePct: 100 });
  });
});

describe('voice — listagem e detalhe de chamadas', () => {
  it('filtros (número, status, protocolo, duração, período, gravação), paginação por cursor e visão do atendente', async () => {
    const w = await world();
    const t0 = Date.now();
    const a = await makeCall(w, { number: '63988887777', durationSec: 10, withRecording: true, agentUserId: w.agent.id, startedAt: new Date(t0 - 3000) });
    const b = await makeCall(w, { number: '63911112222', durationSec: 120, status: 'ABANDONED', startedAt: new Date(t0 - 2000) });
    const c = await makeCall(w, { number: '63955556666', durationSec: 300, withRecording: true, startedAt: new Date(t0 - 1000) });
    const { conversation: conv } = await openConversation({ orgId: w.orgId, channel: 'VOICE', channelRef: c.call.id, externalId: '63955556666', status: 'BOT' });
    await prisma.bvCall.update({ where: { id: c.call.id }, data: { conversationId: conv.id } });
    const get = async (qs: string, h = w.hs) => (await app.inject({ method: 'GET', url: `/balcao/voice/calls${qs}`, headers: h })).json();

    expect((await get('')).items.map((x: any) => x.id)).toEqual([c.call.id, b.call.id, a.call.id]);
    expect((await get('?number=8888-7777')).items.map((x: any) => x.id)).toEqual([a.call.id]);
    expect((await get('?status=ABANDONED')).items.map((x: any) => x.id)).toEqual([b.call.id]);
    expect((await get('?minDuration=100&maxDuration=200')).items.map((x: any) => x.id)).toEqual([b.call.id]);
    expect((await get('?hasRecording=false')).items.map((x: any) => x.id)).toEqual([b.call.id]);
    expect((await get('?hasRecording=true')).items.length).toBe(2);
    expect((await get(`?protocol=${conv.protocol.slice(-6)}`)).items.map((x: any) => x.id)).toEqual([c.call.id]);
    expect((await get(`?from=${new Date(t0 - 2500).toISOString()}&to=${new Date(t0 - 1500).toISOString()}`)).items.map((x: any) => x.id)).toEqual([b.call.id]);
    expect((await get(`?agentUserId=${w.agent.id}`)).items.map((x: any) => x.id)).toEqual([a.call.id]);
    const p1 = await get('?limit=2');
    expect(p1.items.length).toBe(2); expect(p1.nextCursor).toBeTruthy();
    const p2 = await get(`?limit=2&cursor=${p1.nextCursor}`);
    expect(p2.items.map((x: any) => x.id)).toEqual([a.call.id]); expect(p2.nextCursor).toBeNull();
    // atendente só vê as próprias chamadas
    expect((await get('', w.ha)).items.map((x: any) => x.id)).toEqual([a.call.id]);
    expect((await app.inject({ method: 'GET', url: `/balcao/voice/calls/${b.call.id}`, headers: w.ha })).statusCode).toBe(404);
    const dto = (await get('')).items.find((x: any) => x.id === c.call.id);
    expect(dto).toMatchObject({ protocol: conv.protocol, hasRecording: true, direction: 'IN' });
  });

  it('GET /calls/:id traz cabeçalhos SIP X-* da URA 0800, DID e resultado da URA; isolamento entre órgãos', async () => {
    const w = await world(); const other = await world();
    const { call } = await makeCall(w);
    const { conversation: conv } = await openConversation({
      orgId: w.orgId, channel: 'VOICE', channelRef: call.id, externalId: '63999990000', status: 'BOT',
      metadata: { voice: { did: '08001234567', headers: { 'X-URA-Option': '9', 'X-Protocolo-0800': 'P-77' }, transferredTo: '6332180000' }, ivr: { category: 'PROCESSO', outcome: 'queue', vars: { processo: '123' }, sensitiveCollected: ['cpf'] } },
    });
    await prisma.bvCall.update({ where: { id: call.id }, data: { conversationId: conv.id } });
    const r = await app.inject({ method: 'GET', url: `/balcao/voice/calls/${call.id}`, headers: w.hs });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      id: call.id, protocol: conv.protocol,
      voice: { did: '08001234567', headers: { 'X-URA-Option': '9', 'X-Protocolo-0800': 'P-77' }, transferredTo: '6332180000' },
      ivr: { category: 'PROCESSO', vars: { processo: '123' }, sensitiveCollected: ['cpf'] },
    });
    expect((await app.inject({ method: 'GET', url: `/balcao/voice/calls/${call.id}`, headers: other.hs })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/balcao/voice/calls', headers: other.hs })).json().items).toEqual([]);
  });
});

describe('voice — URA: fluxos (CRUD, publicação sem interrupção, simulação)', () => {
  it('rascunho → edição → publicação; nova versão arquiva a anterior; rollback; conflito de DID; só rascunho edita/apaga', async () => {
    const w = await world();
    const did = uniqDid();
    const post = (url: string, payload: unknown, h = w.hs) => app.inject({ method: 'POST', url: `/balcao/voice${url}`, headers: h, payload: payload as any });

    const c1 = await post('/ivr/flows', { name: 'principal', definition: FLOW(did) });
    expect(c1.statusCode).toBe(201);
    const v1 = c1.json();
    expect(v1).toMatchObject({ version: 1, status: 'DRAFT', dids: [did], validation: { ok: true } });

    const upd = await app.inject({ method: 'PUT', url: `/balcao/voice/ivr/flows/${v1.id}`, headers: w.hs, payload: { definition: FLOW(did, { defaultLang: 'pt-BR' }) } });
    expect(upd.statusCode).toBe(200);
    expect(upd.json().definition.defaultLang).toBe('pt-BR');

    const pub1 = await post(`/ivr/flows/${v1.id}/publish`, {});
    expect(pub1.statusCode).toBe(200);
    expect(pub1.json()).toMatchObject({ status: 'ACTIVE', archivedId: null });
    expect((await app.inject({ method: 'PUT', url: `/balcao/voice/ivr/flows/${v1.id}`, headers: w.hs, payload: { language: 'en' } })).statusCode).toBe(409); // ativo não se edita
    expect((await app.inject({ method: 'DELETE', url: `/balcao/voice/ivr/flows/${v1.id}`, headers: w.hs })).statusCode).toBe(404);
    expect((await post(`/ivr/flows/${v1.id}/publish`, {})).statusCode).toBe(409); // já ativo

    // nova versão (v2) publicada: v1 vai a ARCHIVED na mesma transação — sempre exatamente 1 ACTIVE
    const v2 = (await post('/ivr/flows', { name: 'principal', definition: FLOW(did, { defaultLang: 'en' }) })).json();
    expect(v2.version).toBe(2);
    const pub2 = await post(`/ivr/flows/${v2.id}/publish`, {});
    expect(pub2.json()).toMatchObject({ status: 'ACTIVE', archivedId: v1.id });
    const list = (await app.inject({ method: 'GET', url: '/balcao/voice/ivr/flows?name=principal', headers: w.hs })).json().items;
    expect(list.map((f: any) => `${f.version}:${f.status}`)).toEqual(['2:ACTIVE', '1:ARCHIVED']);

    // rollback = publicar a versão arquivada
    const rb = await post(`/ivr/flows/${v1.id}/publish`, {});
    expect(rb.json()).toMatchObject({ status: 'ACTIVE', archivedId: v2.id });

    // outro fluxo (nome diferente) não pode tomar o mesmo DID
    const other = (await post('/ivr/flows', { name: 'outro', definition: FLOW(did) })).json();
    const clash = await post(`/ivr/flows/${other.id}/publish`, {});
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error?.code ?? clash.json().code).toBe('ivr.did_conflict');

    // rascunho pode ser apagado
    expect((await app.inject({ method: 'DELETE', url: `/balcao/voice/ivr/flows/${other.id}`, headers: w.hs })).statusCode).toBe(204);

    const versions = await prisma.bvConfigVersion.findMany({ where: { orgId: w.orgId, entityType: 'IVR_FLOW' } });
    expect(versions.length).toBe(3); // 3 publicações registradas
    const audits = await prisma.bvAuditLog.findMany({ where: { orgId: w.orgId, action: { startsWith: 'ivr.' } } });
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(['ivr.draft_create', 'ivr.draft_update', 'ivr.publish', 'ivr.draft_delete']));
  });

  it('publicação inválida é recusada (422); rascunho com erro de grafo é aceito mas devolve a validação; estrutura inválida = 422', async () => {
    const w = await world();
    const broken = { start: 'm', nodes: { m: { type: 'menu', prompt: { text: 'x' }, options: { '1': 'inexistente' } } } };
    const c = await app.inject({ method: 'POST', url: '/balcao/voice/ivr/flows', headers: w.hs, payload: { name: 'x', definition: broken } });
    expect(c.statusCode).toBe(201);
    expect(c.json().validation.ok).toBe(false);
    const pub = await app.inject({ method: 'POST', url: `/balcao/voice/ivr/flows/${c.json().id}/publish`, headers: w.hs, payload: {} });
    expect(pub.statusCode).toBe(422);
    expect(JSON.stringify(pub.json())).toContain('ivr.node_missing');
    const bad = await app.inject({ method: 'POST', url: '/balcao/voice/ivr/flows', headers: w.hs, payload: { name: 'y', definition: { start: 'a', nodes: { a: { type: 'nada' } } } } });
    expect(bad.statusCode).toBe(422);
    const val = await app.inject({ method: 'POST', url: '/balcao/voice/ivr/validate', headers: w.hs, payload: { definition: FLOW(uniqDid()) } });
    expect(val.json()).toMatchObject({ ok: true, errors: [] });
  });

  it('permissão (ivr:manage) e isolamento entre órgãos', async () => {
    const w = await world(); const other = await world();
    expect((await app.inject({ method: 'GET', url: '/balcao/voice/ivr/flows', headers: w.ha })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/balcao/voice/ivr/flows', headers: w.ha, payload: { name: 'n', definition: FLOW(uniqDid()) } })).statusCode).toBe(403);
    const f = (await app.inject({ method: 'POST', url: '/balcao/voice/ivr/flows', headers: w.hs, payload: { name: 'n', definition: FLOW(uniqDid()) } })).json();
    expect((await app.inject({ method: 'GET', url: `/balcao/voice/ivr/flows/${f.id}`, headers: other.hs })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/balcao/voice/ivr/flows/${f.id}/publish`, headers: other.hs, payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/balcao/voice/ivr/flows', headers: other.hs })).json().items).toEqual([]);
  });

  it('simulate (fluxo salvo e definição avulsa): cut-thru, trilha e entradas não usadas', async () => {
    const w = await world();
    const f = (await app.inject({ method: 'POST', url: '/balcao/voice/ivr/flows', headers: w.hs, payload: { name: 's', definition: FLOW(uniqDid()) } })).json();
    const r = await app.inject({ method: 'POST', url: `/balcao/voice/ivr/flows/${f.id}/simulate`, headers: w.hs, payload: { inputs: ['~1', '9'] } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ outcome: { action: 'queue', category: 'GERAL' }, unusedInputs: ['9'], lang: 'pt-BR' });
    expect(r.json().trail[0]).toMatchObject({ event: 'choice', bargedIn: true });
    const t = await app.inject({ method: 'POST', url: '/balcao/voice/ivr/simulate', headers: w.hs, payload: { definition: FLOW(uniqDid()), inputs: ['', '', ''] } });
    expect(t.json().outcome).toMatchObject({ action: 'hangup', reason: 'max_retries' });
    const inv = await app.inject({ method: 'POST', url: '/balcao/voice/ivr/simulate', headers: w.hs, payload: { definition: { start: 'x', nodes: {} }, inputs: [] } });
    expect(inv.statusCode).toBe(422);
  });

  it('upload de prompt: valida WAV (PCM 16-bit mono 8/16 kHz) e devolve audioKey do órgão', async () => {
    const w = await world();
    const ok = await app.inject({ method: 'POST', url: '/balcao/voice/ivr/prompts?ext=wav&name=boas-vindas', headers: { ...w.hs, 'content-type': 'audio/wav' }, payload: makeToneWav(1) });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().audioKey.startsWith(`${w.orgId}/ivr/`)).toBe(true);
    expect((await getObjectBuffer(ok.json().audioKey)).length).toBe(ok.json().sizeBytes);
    const stereo = Buffer.from(makeToneWav(1)); stereo.writeUInt16LE(2, 22);
    expect((await app.inject({ method: 'POST', url: '/balcao/voice/ivr/prompts', headers: { ...w.hs, 'content-type': 'audio/wav' }, payload: stereo })).statusCode).toBe(415);
    expect((await app.inject({ method: 'POST', url: '/balcao/voice/ivr/prompts?ext=exe', headers: { ...w.hs, 'content-type': 'audio/wav' }, payload: makeToneWav(1) })).statusCode).toBe(415);
    expect((await app.inject({ method: 'POST', url: '/balcao/voice/ivr/prompts', headers: { ...w.ha, 'content-type': 'audio/wav' }, payload: makeToneWav(1) })).statusCode).toBe(403);
  });
});

describe('voice — documentação', () => {
  it('o fluxo de exemplo de docs/balcao/api-voice.md é válido e percorre até a fila', async () => {
    const md = require('fs').readFileSync(path.resolve(__dirname, '../../../../../../../docs/balcao/api-voice.md'), 'utf8') as string;
    const m = /```json\n(\{\n  "start": "idioma"[\s\S]*?\n\})\n```/.exec(md);
    expect(m).not.toBeNull();
    const def = JSON.parse(m![1]);
    const w = await world();
    const r = await app.inject({
      method: 'POST', url: '/balcao/voice/ivr/flows/' + (await app.inject({ method: 'POST', url: '/balcao/voice/ivr/flows', headers: w.hs, payload: { name: 'doc', definition: def } })).json().id + '/simulate',
      headers: w.hs, payload: { inputs: ['1', '~5', '~1', '1234567#', '1'], at: '2026-03-10T15:00:00Z' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().validation).toMatchObject({ ok: true, errors: [] });
    expect(r.json().outcome).toMatchObject({ action: 'queue', category: 'PROCESSO' });
    expect(r.json().vars.processo).toBe('1234567');
  });
});

describe('voice — softphone WebRTC', () => {
  it('GET /softphone: credenciais derivadas (mesma senha do gen-agents.js), sem cache, auditado', async () => {
    const w = await world();
    process.env.BV_SIP_SECRET = 's3gredo-de-teste';
    process.env.BV_SIP_DOMAIN = 'voz.exemplo.gov.br';
    try {
      expect((await app.inject({ method: 'GET', url: '/balcao/voice/softphone', headers: w.ha })).statusCode).toBe(409); // sem ramal
      await prisma.bvUser.update({ where: { id: w.agent.id }, data: { sipExtension: '1007' } });
      const r = await app.inject({ method: 'GET', url: '/balcao/voice/softphone', headers: w.ha });
      expect(r.statusCode).toBe(200);
      expect(r.headers['cache-control']).toBe('no-store');
      const c = r.json();
      expect(c).toMatchObject({ ramal: '1007', domain: 'voz.exemplo.gov.br', sipUri: 'sip:1007@voz.exemplo.gov.br', wssUrl: 'wss://voz.exemplo.gov.br:8089/ws', displayName: w.agent.name });
      expect(c.senha).toBe(genAgents.derivePassword('s3gredo-de-teste', '1007'));
      expect(c.senha).toBe(deriveSipPassword('s3gredo-de-teste', '1007'));
      expect(c.senha).toHaveLength(24);
      expect(c.iceServers[0].urls).toBeTruthy();
      expect((await prisma.bvAuditLog.count({ where: { orgId: w.orgId, action: 'softphone.credentials', actorId: w.agent.id } }))).toBe(1);
      delete process.env.BV_SIP_SECRET;
      expect((await app.inject({ method: 'GET', url: '/balcao/voice/softphone', headers: w.ha })).statusCode).toBe(503);
    } finally { delete process.env.BV_SIP_DOMAIN; }
  });

  it('paridade API ↔ Asterisk: o endpoint gerado por gen-agents.js contém a senha que a API entrega', () => {
    const env = { BV_SIP_SECRET: 'segredo-x', BV_AGENT_EXT_START: '1001', BV_AGENT_EXT_END: '1003', BV_TEST_CALLER_EXT: '9001' };
    const conf = genAgents.generate(env);
    for (const ext of ['1001', '1002', '1003', '9001']) {
      const creds = buildSoftphoneCredentials({ name: 'X', sipExtension: ext }, { BV_SIP_SECRET: 'segredo-x' } as any)!;
      expect(conf).toContain(`[${ext}]\ntype=auth\nauth_type=userpass\nusername=${ext}\npassword=${creds.senha}\n`);
    }
    expect(conf).toContain('context=from-trunk'); // ramal de teste que simula o tronco
    expect(() => genAgents.generate({ ...env, BV_TEST_CALLER_EXT: '1002' })).toThrow(/dentro da faixa/);
    expect(() => genAgents.generate({ BV_AGENT_EXT_START: '1' })).toThrow(/BV_SIP_SECRET/);
    expect(() => genAgents.generate({ BV_SIP_SECRET: 'x', BV_AGENT_EXT_START: '10', BV_AGENT_EXT_END: '5' })).toThrow(/faixa/i);
  });

  it('BV_ICE_SERVERS (JSON) com STUN/TURN próprios; inválido cai no padrão', () => {
    expect(parseIceServers('[{"urls":"turn:turn.exemplo:3478","username":"u","credential":"c"}]')).toEqual([{ urls: 'turn:turn.exemplo:3478', username: 'u', credential: 'c' }]);
    expect(parseIceServers('lixo')[0].urls).toEqual(['stun:stun.l.google.com:19302']);
  });
});

describe('voice — infra/asterisk: templates geram configuração válida', () => {
  const fs = require('fs') as typeof import('fs');
  const tpl = (n: string) => fs.readFileSync(path.join(INFRA, 'templates', n), 'utf8');
  const BASE = { BV_ARI_PASS: 'ari-exemplo', BV_SIP_SECRET: 'x', BV_EXTERNAL_IP: '198.51.100.7' };
  const sections = (conf: string) => conf.split('\n').filter((l) => /^\[.+\]$/.test(l));

  it('tronco por IP: endpoint+aor+identify; sem BV_TRUNK_HOST o arquivo fica vazio de seções', () => {
    const ip = renderTemplate(tpl('pjsip_trunk.conf.tpl'), { ...BASE, BV_TRUNK_HOST: 'sbc.tjto.exemplo', BV_TRUNK_IPS: '203.0.113.10,203.0.113.11' });
    expect(sections(ip)).toEqual(['[tjto-trunk]', '[tjto-trunk]', '[tjto-trunk]']);
    expect(ip).toContain('match=203.0.113.10,203.0.113.11');
    expect(ip).toContain('contact=sip:sbc.tjto.exemplo:5060');
    expect(ip).not.toMatch(/\{\{|;#/);
    expect(sections(renderTemplate(tpl('pjsip_trunk.conf.tpl'), BASE))).toEqual([]);
  });

  it('tronco com registro exige usuário e senha; trunk-auth e registration são gerados', () => {
    const reg = renderTemplate(tpl('pjsip_trunk.conf.tpl'), { ...BASE, BV_TRUNK_HOST: 'sbc.exemplo', BV_TRUNK_AUTH: 'registration', BV_TRUNK_USER: 'balcao', BV_TRUNK_PASS: 'pw' });
    expect(sections(reg)).toEqual(expect.arrayContaining(['[tjto-trunk-reg]', '[tjto-trunk-auth]']));
    expect(reg).toContain('client_uri=sip:balcao@sbc.exemplo');
    expect(() => renderTemplate(tpl('pjsip_trunk.conf.tpl'), { ...BASE, BV_TRUNK_HOST: 'h', BV_TRUNK_AUTH: 'registration' }, 'trunk')).toThrow(/BV_TRUNK_USER/);
  });

  it('ari.conf/http.conf/rtp.conf/pjsip.conf: variáveis obrigatórias, padrões e IP externo', () => {
    expect(() => renderTemplate(tpl('ari.conf.tpl'), {}, 'ari')).toThrow(/BV_ARI_PASS/);
    const ari = renderTemplate(tpl('ari.conf.tpl'), BASE);
    expect(ari).toContain('[balcao]');
    expect(ari).toContain('channelvars=BV_X_URA_OPTION,BV_X_URA_ID,BV_X_PROTOCOLO_0800');
    expect(renderTemplate(tpl('http.conf.tpl'), {})).toContain('tlsbindaddr=0.0.0.0:8089');
    expect(renderTemplate(tpl('rtp.conf.tpl'), { BV_RTP_START: '20000', BV_RTP_END: '20400' })).toMatch(/rtpstart=20000\nrtpend=20400/);
    const pj = renderTemplate(tpl('pjsip.conf.tpl'), BASE);
    expect(pj).toContain('external_media_address=198.51.100.7');
    expect(sections(pj)).toEqual(['[transport-udp]', '[transport-tcp]', '[transport-wss]']);
    expect(renderTemplate(tpl('pjsip.conf.tpl'), {})).not.toContain('external_media_address');
  });

  it('o dialplan entrega o DID ao ARI (Stasis balcao,in,<did>) e os cabeçalhos X-* viram variáveis BV_X_*', () => {
    const ext = fs.readFileSync(path.join(INFRA, 'conf', 'extensions.conf'), 'utf8');
    expect(ext).toContain('Stasis(balcao,in,${EXTEN})');
    for (const h of ['X-URA-Option', 'X-URA-Id', 'X-Protocolo-0800']) expect(ext).toContain(`PJSIP_HEADER(read,${h})`);
  });
});

describe('voice — configuração do tronco SIP e status (com ARI simulado)', () => {
  it('GET/PUT /config: mascara segredos, preserva senha mascarada, valida (strict), audita e versiona', async () => {
    const w = await world();
    const adm = await makeUser(w.orgId, 'ADMIN'); const ha = authHeader(adm);
    expect((await app.inject({ method: 'GET', url: '/balcao/voice/config', headers: w.hs })).statusCode).toBe(403); // supervisor não gerencia integrações
    const g0 = (await app.inject({ method: 'GET', url: '/balcao/voice/config', headers: ha })).json();
    expect(g0).toMatchObject({ configured: false, status: 'UNCONFIGURED', config: { trunkEndpoint: 'tjto-trunk', speakProtocol: 'start' } });

    const put = await app.inject({
      method: 'PUT', url: '/balcao/voice/config', headers: ha,
      payload: { enabled: true, config: { host: 'sbc.tjto.exemplo', authMode: 'registration', username: 'balcao', password: 'segredo-do-tronco', dids: ['08001234567'], preserveHeaders: ['X-URA-Option'], ari: { url: 'http://asterisk:8088', username: 'balcao', password: 'ari-segredo' } } },
    });
    expect(put.statusCode).toBe(200);
    expect(JSON.stringify(put.json())).not.toContain('segredo');
    const g1 = (await app.inject({ method: 'GET', url: '/balcao/voice/config', headers: ha })).json();
    expect(g1).toMatchObject({ configured: true, enabled: true, config: { host: 'sbc.tjto.exemplo', password: '••••••', ari: { password: '••••••' } } });
    expect(JSON.stringify(g1)).not.toContain('segredo');

    // reenviar a máscara mantém o segredo guardado
    await app.inject({ method: 'PUT', url: '/balcao/voice/config', headers: ha, payload: { config: { host: 'sbc2.tjto.exemplo', password: '••••••', ari: { url: 'http://asterisk:8088', username: 'balcao', password: '••••••' } } } });
    const stored = await (await import('../../../core/integrations')).getIntegration<any>(w.orgId, 'SIP_TRUNK');
    expect(stored!.config).toMatchObject({ host: 'sbc2.tjto.exemplo', password: 'segredo-do-tronco', ari: { password: 'ari-segredo' } });

    expect((await app.inject({ method: 'PUT', url: '/balcao/voice/config', headers: ha, payload: { config: { porta: 1 } } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/balcao/voice/config', headers: ha, payload: { config: { preserveHeaders: ['Authorization'] } } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/balcao/voice/config', headers: ha, payload: { config: { trunkEndpoint: 'a b;c' } } })).statusCode).toBe(400);

    expect(await prisma.bvAuditLog.count({ where: { orgId: w.orgId, action: 'config.update', entityType: 'SIP_TRUNK' } })).toBe(2);
    expect(await prisma.bvConfigVersion.count({ where: { orgId: w.orgId, entityType: 'SIP_TRUNK' } })).toBe(2);
    const audit = await prisma.bvAuditLog.findFirst({ where: { orgId: w.orgId, action: 'config.update' } });
    expect(JSON.stringify(audit)).not.toContain('segredo');
  });

  it('POST /config/test e GET /status: 503 sem telefonia; com ARI simulado informa versão e estado do tronco', async () => {
    const w = await world();
    const adm = await makeUser(w.orgId, 'ADMIN'); const ha = authHeader(adm);
    expect((await app.inject({ method: 'GET', url: '/balcao/voice/status', headers: w.hs })).json()).toMatchObject({ connected: false, started: false });
    expect((await app.inject({ method: 'POST', url: '/balcao/voice/config/test', headers: ha, payload: {} })).statusCode).toBe(503);

    await saveIntegration(w.orgId, 'SIP_TRUNK', { trunkEndpoint: 'tjto-trunk' });
    const fake = new FakeAri(); await fake.start();
    const prompts: PromptProvider = { resolve: async () => ({ media: ['sound:x'], source: 'tts' as const }) };
    const ctl = new AriController({ connection: { url: fake.url, username: fake.user, password: fake.pass, app: 'balcao' }, prompts, recordingDir: fake.recordingDir, backoff: { baseMs: 20, maxMs: 60 } });
    setAriController(ctl); ctl.start();
    try {
      await fake.waitFor(() => fake.connected, 'ARI conectado');
      const st = (await app.inject({ method: 'GET', url: '/balcao/voice/status', headers: w.hs })).json();
      expect(st).toMatchObject({ started: true, connected: true, app: 'balcao', activeCalls: 0 });
      const ok = await app.inject({ method: 'POST', url: '/balcao/voice/config/test', headers: ha, payload: {} });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({ ok: true, ari: { ok: true, version: '20.9.0-fake', connected: true }, trunk: { endpoint: 'tjto-trunk', state: 'online' } });
      fake.trunkState = 'offline';
      const off = await app.inject({ method: 'POST', url: '/balcao/voice/config/test', headers: ha, payload: {} });
      expect(off.json()).toMatchObject({ ok: false, trunk: { state: 'offline' } });
      const row = await prisma.bvIntegration.findFirst({ where: { orgId: w.orgId, type: 'SIP_TRUNK' } });
      expect(row?.status).toBe('ERROR');
    } finally { ctl.stop(); await fake.stop(); }
  });

  it('rotas de ligação: 503 sem telefonia; dial → 202 e transfer fora de atendimento → 409; número inválido → 400', async () => {
    const w = await world();
    const post = (url: string, payload: unknown, h = w.ha) => app.inject({ method: 'POST', url: `/balcao/voice${url}`, headers: h, payload: payload as any });
    expect((await post('/calls/dial', { number: '6332180000' })).statusCode).toBe(503);
    expect((await post('/calls/dial', { number: 'abc' })).statusCode).toBe(400);

    await prisma.bvUser.update({ where: { id: w.agent.id }, data: { sipExtension: `20${crypto.randomInt(10, 99)}` } });
    await saveIntegration(w.orgId, 'SIP_TRUNK', { trunkEndpoint: 'tjto-trunk' });
    const fake = new FakeAri(); await fake.start();
    const prompts: PromptProvider = { resolve: async () => ({ media: ['sound:x'], source: 'tts' as const }) };
    const ctl = new AriController({ connection: { url: fake.url, username: fake.user, password: fake.pass, app: 'balcao' }, prompts, agentRingMs: 300, recordingDir: fake.recordingDir, recordingWaitMs: 300, backoff: { baseMs: 20, maxMs: 60 } });
    setAriController(ctl); ctl.start();
    try {
      await fake.waitFor(() => fake.connected, 'ARI conectado');
      const d = await post('/calls/dial', { number: '6332180000' });
      expect(d.statusCode).toBe(202);
      const callId = d.json().callId;
      expect(fake.originated().some((c) => c.endpoint?.startsWith('PJSIP/20'))).toBe(true);
      const tr = await post(`/calls/${callId}/transfer`, { number: '6332181111' }, w.ha);
      expect(tr.statusCode).toBe(409); // ainda tocando no ramal, não está em atendimento
      expect((await post(`/calls/${callId}/transfer`, { number: 'x' }, w.ha)).statusCode).toBe(400);
      expect((await post(`/calls/inexistente/transfer`, { number: '6332181111' }, w.ha)).statusCode).toBe(404);
      expect((await post(`/calls/${callId}/hangup`, {}, w.ha)).statusCode).toBe(200);
      await fake.waitFor(async () => (await prisma.bvCall.findUnique({ where: { id: callId } }))?.status === 'FAILED', 'chamada encerrada');
    } finally { ctl.stop(); await fake.stop(); }
  });
});

describe('voice — simulador de desenvolvimento (BV_DEV_SIMULATORS=1)', () => {
  it('desligado por padrão (404); ligado cria chamada + conversa com protocolo + gravação fictícia e NÃO consome minutos', async () => {
    const w = await world();
    const did = uniqDid();
    const flow = (await app.inject({ method: 'POST', url: '/balcao/voice/ivr/flows', headers: w.hs, payload: { name: 'sim', definition: FLOW(did) } })).json();
    await app.inject({ method: 'POST', url: `/balcao/voice/ivr/flows/${flow.id}/publish`, headers: w.hs, payload: {} });
    const body = { from: '63999991111', did, inputs: ['~1'], headers: { 'X-URA-Option': '1' } };

    expect((await app.inject({ method: 'POST', url: '/balcao/voice/dev/simulate-call', headers: w.hs, payload: body })).statusCode).toBe(404);
    process.env.BV_DEV_SIMULATORS = '1';
    const r = await app.inject({ method: 'POST', url: '/balcao/voice/dev/simulate-call', headers: w.hs, payload: { ...body, agentUserId: w.agent.id, durationSec: 90 } });
    expect(r.statusCode).toBe(201);
    const out = r.json();
    expect(out.outcome).toMatchObject({ action: 'queue', category: 'GERAL' });
    expect(out.protocol).toMatch(/^BV-/);
    const call = await prisma.bvCall.findUniqueOrThrow({ where: { id: out.callId } });
    expect(call).toMatchObject({ orgId: w.orgId, status: 'ENDED', durationSec: 90, agentUserId: w.agent.id, endReason: 'SIMULATED', recordingNotified: true });
    expect(inspectWav(await getObjectBuffer(call.recordingKey!))).toMatchObject({ sampleRate: 8000 });
    const conv = await prisma.bvConversation.findUniqueOrThrow({ where: { id: out.conversationId } });
    expect(conv).toMatchObject({ channel: 'VOICE', status: 'CLOSED' });
    expect((conv.metadata as any).voice).toMatchObject({ simulated: true, did, headers: { 'X-URA-Option': '1' } });
    expect(await prisma.bvUsageDaily.count({ where: { orgId: w.orgId, item: 'VOICE_MINUTES' } })).toBe(0);

    // a chamada simulada é encontrada pela busca e a gravação toca
    const found = (await app.inject({ method: 'GET', url: `/balcao/voice/calls?protocol=${out.protocol}`, headers: w.hs })).json();
    expect(found.items.map((x: any) => x.id)).toEqual([out.callId]);
    expect((await app.inject({ method: 'GET', url: `/balcao/voice/calls/${out.callId}/recording`, headers: { ...w.hs, range: 'bytes=0-43' } })).statusCode).toBe(206);

    expect((await app.inject({ method: 'POST', url: '/balcao/voice/dev/simulate-call', headers: w.hs, payload: { ...body, did: '0800000999' } })).statusCode).toBe(404); // sem fluxo para o DID
    expect((await app.inject({ method: 'POST', url: '/balcao/voice/dev/simulate-call', headers: w.ha, payload: body })).statusCode).toBe(403);
  });
});
