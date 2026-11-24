process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-12345678901234567890';

import crypto from 'crypto';
import { prisma } from '../../../../lib/prisma';
import { assignConversation, closeConversation } from '../../../core/conversations';
import { clearBvEventHandlers, onBvEvent } from '../../../core/events';
import { getObjectBuffer } from '../../../core/storage';
import { getUsage } from '../../../core/usage';
import { saveIntegration } from '../../../core/integrations';
import * as realtime from '../../../core/realtime';
import { makeOrg, makeUser } from '../../../core/testing';
import { AriController, protocolMedia } from '../controller';
import type { PromptProvider } from '../prompts';
import { FakeAri } from './fakeAri';

class MockPrompts implements PromptProvider {
  resolved: string[] = [];
  async resolve(_orgId: string, p: { text: string }) { this.resolved.push(p.text); return { media: [`sound:test/${p.text.slice(0, 12).replace(/\W/g, '_') || 'vazio'}`], source: 'tts' as const }; }
}

const FLOW = (did: string) => ({
  start: 'welcome', dids: [did], entryByHeader: { header: 'X-URA-Option', map: { '9': 'q_proc' } },
  nodes: {
    welcome: { type: 'menu', prompt: { text: 'Bem-vindo ao Balcão Virtual. Digite 1 para processos ou 2 para informações.' }, options: { '1': 'q_proc', '2': 'info', '3': 'tr' }, maxRetries: 1, timeoutSec: 5 },
    info: { type: 'play', prompt: { text: 'Informações gerais.' }, next: 'bye' },
    bye: { type: 'hangup', prompt: { text: 'Obrigado, até logo.' } },
    tr: { type: 'transfer', destination: { type: 'external', number: '6332180000' } },
    q_proc: { type: 'queue', category: 'PROCESSO', queue: 'atendimento', priority: 2 },
  },
});

async function setup(opts: { ringMs?: number; sharedVolume?: boolean; agents?: number } = {}) {
  const org = await makeOrg({ ai: { enabled: false } });
  const orgId = org.id;
  const agents = [];
  for (let i = 0; i < (opts.agents ?? 1); i++) {
    const a = await makeUser(orgId, 'ATENDENTE', { presence: 'ONLINE' });
    await prisma.bvUser.update({ where: { id: a.id }, data: { sipExtension: `10${i}${crypto.randomInt(10, 99)}` } });
    agents.push(await prisma.bvUser.findUniqueOrThrow({ where: { id: a.id } }));
  }
  const did = `0800${crypto.randomInt(1000000, 9999999)}`;
  const flow = await prisma.bvIvrFlow.create({ data: { orgId, name: 'principal', status: 'ACTIVE', definition: FLOW(did) as any, publishedAt: new Date() } });
  await saveIntegration(orgId, 'SIP_TRUNK', { trunkEndpoint: 'tjto-trunk', preserveHeaders: ['X-URA-Option'] });
  const fake = new FakeAri();
  fake.noSharedVolume = opts.sharedVolume === false;
  await fake.start();
  const prompts = new MockPrompts();
  const ctl = new AriController({
    connection: { url: fake.url, username: fake.user, password: fake.pass, app: 'balcao' }, prompts,
    agentRingMs: opts.ringMs ?? 400, recordingDir: fake.recordingDir, recordingWaitMs: 1500, backoff: { baseMs: 20, maxMs: 60 },
  });
  ctl.start();
  await fake.waitFor(() => fake.connected, 'ARI conectado');
  const callOf = async (chId: string) => prisma.bvCall.findFirst({ where: { orgId, ariChannelId: chId } });
  return { orgId, agents, did, flow, fake, ctl, prompts, callOf };
}
type Ctx = Awaited<ReturnType<typeof setup>>;
let ctx: Ctx | null = null;
afterEach(async () => { if (ctx) { ctx.ctl.stop(); await ctx.fake.stop(); ctx = null; } clearBvEventHandlers(); jest.restoreAllMocks(); });

/** "Roteamento" de teste: atribui a conversa ao primeiro atendente ONLINE da lista. */
function autoRoute(c: Ctx) {
  return onBvEvent('conversation.needs_routing', async (e) => {
    if (e.orgId !== c.orgId) return;
    const a = await prisma.bvUser.findFirst({ where: { orgId: c.orgId, presence: 'ONLINE', active: true, sipExtension: { not: null } }, orderBy: { sipExtension: 'asc' } });
    if (a) await assignConversation({ orgId: c.orgId, conversationId: e.conversationId, userId: a.id, via: 'AUTO' }).catch(() => undefined);
  });
}

async function dialAndChoose(c: Ctx, chId: string, number: string, digit: string) {
  c.fake.incoming(chId, { number, did: c.did });
  await c.fake.waitFor(() => c.fake.playsOn(chId).some((p) => p.media[0].includes('Bem_vindo')), 'menu da URA');
  c.fake.dtmf(chId, digit);
}

describe('voice/ARI — chamada recebida de ponta a ponta', () => {
  it('StasisStart → aviso+protocolo → URA → fila → atribuição → atendente atende → bridge+gravação → arquivo no storage → fim', async () => {
    ctx = await setup(); const c = ctx;
    autoRoute(c);
    const events: string[] = [];
    onBvEvent('call.started', (e) => { if (e.orgId === c.orgId) events.push('started'); });
    onBvEvent('call.ended', (e) => { if (e.orgId === c.orgId) events.push('ended'); });
    const emitUser = jest.spyOn(realtime, 'emitToUser');

    await dialAndChoose(c, 'ch-in-1', '+55 63 99999-0001', '1');
    const call0 = await c.fake.waitFor(() => c.callOf('ch-in-1'), 'BvCall');
    // aviso de gravação (force-play) e protocolo falados antes da URA
    const conv0 = await prisma.bvConversation.findFirstOrThrow({ where: { id: call0.conversationId! } });
    const plays = c.fake.playsOn('ch-in-1').map((p) => p.media);
    expect(plays[0][0]).toContain('Esta_chamada');
    expect(plays[1]).toEqual(expect.arrayContaining([...protocolMedia(conv0.protocol)]));

    // fila: MoH ligada, conversa WAITING com a categoria da URA
    await c.fake.waitFor(async () => (await c.callOf('ch-in-1'))?.status === 'QUEUED' || (await c.callOf('ch-in-1'))?.status === 'ACTIVE', 'fila');
    expect(c.fake.channels.get('ch-in-1')?.moh).toBeDefined();

    // atribuição → origina para PJSIP/<ramal>
    const agent = c.agents[0];
    const orig = await c.fake.waitFor(() => c.fake.originated().find((x) => x.endpoint === `PJSIP/${agent.sipExtension}`), 'originate ao atendente');
    expect(orig.appArgs).toBe(`agent,${call0.id}`);
    c.fake.answerOriginated(orig.id);

    await c.fake.waitFor(async () => (await c.callOf('ch-in-1'))?.status === 'ACTIVE', 'chamada ativa');
    const br = [...c.fake.bridges.values()][0];
    expect(br.channels.sort()).toEqual(['ch-in-1', orig.id].sort());
    expect(c.fake.live.has(`bv-${call0.id}`)).toBe(true); // gravação da ponte em curso
    expect(c.fake.channels.get('ch-in-1')?.moh).toBe(false);
    const active = await c.callOf('ch-in-1');
    expect(active?.agentUserId).toBe(agent.id);
    expect(active?.recordingNotified).toBe(true);
    const conv1 = await prisma.bvConversation.findUniqueOrThrow({ where: { id: conv0.id } });
    expect(conv1.status).toBe('ACTIVE'); expect(conv1.category).toBe('PROCESSO'); expect(conv1.priority).toBe(2);
    expect((conv1.metadata as any).ivr.queue).toBe('atendimento');
    expect(emitUser.mock.calls.some(([uid, ev]) => uid === agent.id && ev === 'call:ringing')).toBe(true);
    expect(emitUser.mock.calls.some(([uid, ev]) => uid === agent.id && ev === 'call:active')).toBe(true);

    await new Promise((r) => setTimeout(r, 1100)); // alguma duração
    c.fake.hangup('ch-in-1');

    const ended = await c.fake.waitFor(async () => { const x = await c.callOf('ch-in-1'); return x?.status === 'ENDED' && x.recordingKey ? x : null; }, 'chamada encerrada com gravação');
    // arquivo no storage, com sha256 e tamanho corretos
    const buf = await getObjectBuffer(ended.recordingKey!);
    expect(crypto.createHash('sha256').update(buf).digest('hex')).toBe(ended.recordingSha256);
    expect(Number(ended.recordingSizeBytes)).toBe(buf.length);
    expect(ended.recordingKey!.startsWith(`${c.orgId}/recordings/`)).toBe(true);
    expect(ended.durationSec).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(ended.ivrPath)).toBe(true);
    expect((ended.ivrPath as any[]).some((s) => s.event === 'choice' && s.input === '1')).toBe(true);
    // conversa encerrada, eventos
    await c.fake.waitFor(async () => (await prisma.bvConversation.findUniqueOrThrow({ where: { id: conv0.id } })).status === 'CLOSED', 'conversa fechada');
    expect((await prisma.bvConversation.findUniqueOrThrow({ where: { id: conv0.id } })).closeReason).toBe('RESOLVED');
    // consumo
    const day = new Date(Date.now() - 86400_000);
    expect(await getUsage(c.orgId, 'VOICE_MINUTES', day, new Date())).toBeGreaterThanOrEqual(1);
    expect(await getUsage(c.orgId, 'VOICE_PEAK_CHANNELS', day, new Date())).toBe(1);
    await c.fake.waitFor(() => events.includes('ended'), 'call.ended');
    expect(events).toEqual(['started', 'ended']);
    // a gravação da fase da URA também foi guardada como secundária
    const meta = (await prisma.bvConversation.findUniqueOrThrow({ where: { id: conv0.id } })).metadata as any;
    expect(meta.voice.uraRecording.key).toBeTruthy();
    // arquivos do volume foram movidos
    expect(c.fake.channels.size).toBe(0);
  });

  it('sem volume compartilhado: baixa a gravação pela API do ARI', async () => {
    ctx = await setup({ sharedVolume: false }); const c = ctx;
    autoRoute(c);
    await dialAndChoose(c, 'ch-nv', '63999990002', '1');
    const orig = await c.fake.waitFor(() => c.fake.originated()[0], 'originate');
    c.fake.answerOriginated(orig.id);
    await c.fake.waitFor(async () => (await c.callOf('ch-nv'))?.status === 'ACTIVE', 'ativa');
    c.fake.hangup('ch-nv');
    const done = await c.fake.waitFor(async () => { const x = await c.callOf('ch-nv'); return x?.recordingKey ? x : null; }, 'gravação');
    expect(done.recordingSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(c.fake.stored.size).toBe(0); // apagada do ARI após guardar
  });

  it('atendente não atende em N s: devolve à fila, ele fica AWAY e o roteamento reencaminha', async () => {
    ctx = await setup({ ringMs: 250, agents: 2 }); const c = ctx;
    autoRoute(c);
    const needs: string[] = [];
    onBvEvent('conversation.needs_routing', (e) => { if (e.orgId === c.orgId) needs.push(e.reason); });
    await dialAndChoose(c, 'ch-rt', '63999990003', '1');
    const [a1, a2] = [...c.agents].sort((x, y) => x.sipExtension!.localeCompare(y.sipExtension!));
    const first = await c.fake.waitFor(() => c.fake.originated().find((x) => x.endpoint === `PJSIP/${a1.sipExtension}`), '1º toque');
    // ninguém atende → timeout
    const second = await c.fake.waitFor(() => c.fake.originated().find((x) => x.endpoint === `PJSIP/${a2.sipExtension}`), 'reencaminhado ao 2º atendente', 3000);
    expect(c.fake.channels.has(first.id)).toBe(false); // 1º toque derrubado
    expect((await prisma.bvUser.findUniqueOrThrow({ where: { id: a1.id } })).presence).toBe('AWAY');
    expect(needs).toContain('OVERFLOW');
    c.fake.answerOriginated(second.id);
    await c.fake.waitFor(async () => (await c.callOf('ch-rt'))?.agentUserId === a2.id && (await c.callOf('ch-rt'))?.status === 'ACTIVE', 'ativa com o 2º');
    c.fake.hangup('ch-rt');
    await c.fake.waitFor(async () => (await c.callOf('ch-rt'))?.status === 'ENDED', 'fim');
  });

  it('atendente rejeita (canal destruído antes de atender) → volta à fila imediatamente', async () => {
    ctx = await setup({ ringMs: 5000, agents: 2 }); const c = ctx;
    autoRoute(c);
    await dialAndChoose(c, 'ch-rj', '63999990004', '1');
    const first = await c.fake.waitFor(() => c.fake.originated()[0], 'toque');
    c.fake.failOriginated(first.id, 21);
    const second = await c.fake.waitFor(() => c.fake.originated().find((x) => x.id !== first.id), 'reencaminha');
    expect(second.endpoint).not.toBe(first.endpoint);
  });

  it('chamador desliga na fila → ABANDONED + conversa fechada (ABANDONED, sem CSAT)', async () => {
    ctx = await setup(); const c = ctx;
    await dialAndChoose(c, 'ch-ab', '63999990005', '1');
    const call = await c.fake.waitFor(async () => { const x = await c.callOf('ch-ab'); return x?.status === 'QUEUED' ? x : null; }, 'fila');
    c.fake.hangup('ch-ab');
    const done = await c.fake.waitFor(async () => { const x = await c.callOf('ch-ab'); return x?.status === 'ABANDONED' ? x : null; }, 'abandonada');
    expect(done.endReason).toBe('CALLER_HANGUP_QUEUE');
    expect(done.recordingKey).toBeTruthy(); // a fase da URA/fila também é gravada
    const conv = await c.fake.waitFor(async () => { const x = await prisma.bvConversation.findUniqueOrThrow({ where: { id: call.conversationId! } }); return x.status === 'CLOSED' ? x : null; }, 'conversa fechada');
    expect(conv.closeReason).toBe('ABANDONED');
    expect(await prisma.bvConversation.count({ where: { id: conv.id, csatScore: { not: null } } })).toBe(0);
  });

  it('autoatendimento: opção 2 → play → hangup; chamada ENDED e conversa resolvida pelo bot', async () => {
    ctx = await setup(); const c = ctx;
    await dialAndChoose(c, 'ch-ss', '63999990006', '2');
    const done = await c.fake.waitFor(async () => { const x = await c.callOf('ch-ss'); return x?.status === 'ENDED' ? x : null; }, 'fim da URA');
    expect(done.endReason).toBe('IVR_END');
    const conv = await prisma.bvConversation.findUniqueOrThrow({ where: { id: done.conversationId! } });
    expect(conv.status).toBe('CLOSED'); expect(conv.resolvedByBot).toBe(true);
    expect(c.fake.playsOn('ch-ss').some((p) => p.media[0].includes('Informa'))).toBe(true);
    expect(c.fake.channels.has('ch-ss')).toBe(false); // desligou o chamador
  });

  it('cut-thru: dígito durante o prompt interrompe o áudio (DELETE /playbacks); force-play ignora', async () => {
    ctx = await setup(); const c = ctx;
    c.fake.holdPlayback = true; // o áudio "dura" até alguém interromper
    c.fake.incoming('ch-cut', { number: '63999990007', did: c.did });
    // aviso de gravação (force-play): digitar não deve interromper
    const notice = await c.fake.waitFor(() => c.fake.playsOn('ch-cut')[0], 'aviso');
    c.fake.dtmf('ch-cut', '1');
    await new Promise((r) => setTimeout(r, 80));
    expect(c.fake.req('DELETE', '/playbacks/')).toHaveLength(0);
    c.fake.emit({ type: 'PlaybackFinished', playback: { id: notice.playbackId } });
    const proto = await c.fake.waitFor(() => c.fake.playsOn('ch-cut')[1], 'protocolo');
    c.fake.emit({ type: 'PlaybackFinished', playback: { id: proto.playbackId } });
    const menu = await c.fake.waitFor(() => c.fake.playsOn('ch-cut')[2], 'menu');
    expect(menu.media[0]).toContain('Bem_vindo');
    c.fake.dtmf('ch-cut', '1'); // cut-thru durante o menu
    await c.fake.waitFor(() => c.fake.req('DELETE', `/playbacks/${menu.playbackId}`).length === 1, 'menu interrompido');
    await c.fake.waitFor(async () => (await c.callOf('ch-cut'))?.status === 'QUEUED', 'fila');
  });

  it('transbordo (blind transfer): origina pelo tronco, liga ao chamador, atendente sai; ligação segue gravada até o fim', async () => {
    ctx = await setup(); const c = ctx;
    autoRoute(c);
    await dialAndChoose(c, 'ch-tr', '63999990008', '1');
    const ag = await c.fake.waitFor(() => c.fake.originated()[0], 'toque');
    c.fake.answerOriginated(ag.id);
    const call = await c.fake.waitFor(async () => { const x = await c.callOf('ch-tr'); return x?.status === 'ACTIVE' ? x : null; }, 'ativa');

    const r = await c.ctl.transferCall(c.orgId, call.id, '6332182000');
    expect(r).toEqual({ ok: true });
    const t = await c.fake.waitFor(() => c.fake.originated().find((x) => x.appArgs?.startsWith('transfer')), 'originate do transbordo');
    expect(t.endpoint).toBe('PJSIP/6332182000@tjto-trunk');
    c.fake.answerOriginated(t.id);
    await c.fake.waitFor(() => c.fake.channels.has(ag.id) === false, 'atendente saiu');
    const br = [...c.fake.bridges.values()][0];
    expect(br.channels.sort()).toEqual(['ch-tr', t.id].sort());
    const conv = await c.fake.waitFor(async () => { const x = await prisma.bvConversation.findUniqueOrThrow({ where: { id: call.conversationId! } }); return x.status === 'CLOSED' ? x : null; }, 'conversa fechada');
    expect(conv.closeReason).toBe('TRANSFERRED_OUT');
    expect((await c.callOf('ch-tr'))?.status).toBe('ACTIVE'); // a ligação continua
    c.fake.hangup(t.id); // destino desliga
    const done = await c.fake.waitFor(async () => { const x = await c.callOf('ch-tr'); return x?.status === 'ENDED' && x.recordingKey ? x : null; }, 'fim');
    expect(done.endReason).toBe('TRANSFER_REMOTE_HANGUP');
  });

  it('transbordo respeita a política de discagem: premium/serviço/internacional recusados; ramal e fixo nacional passam', async () => {
    ctx = await setup(); const c = ctx;
    autoRoute(c);
    await dialAndChoose(c, 'ch-pol', '63999990010', '1');
    const ag = await c.fake.waitFor(() => c.fake.originated()[0], 'toque');
    c.fake.answerOriginated(ag.id);
    const call = await c.fake.waitFor(async () => { const x = await c.callOf('ch-pol'); return x?.status === 'ACTIVE' ? x : null; }, 'ativa');
    for (const bad of ['09001234567', '03001234567', '*123', '+12025550100']) {
      const r = await c.ctl.transferCall(c.orgId, call.id, bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(['voice.transfer_not_allowed', 'validation.number']).toContain(r.code);
    }
    expect((await c.ctl.transferCall(c.orgId, call.id, '6332182000')).ok).toBe(true); // fixo nacional
  });

  it('transbordo que não completa devolve o controle ao atendente (chamada continua)', async () => {
    ctx = await setup(); const c = ctx;
    autoRoute(c);
    await dialAndChoose(c, 'ch-tf', '63999990009', '1');
    const ag = await c.fake.waitFor(() => c.fake.originated()[0], 'toque');
    c.fake.answerOriginated(ag.id);
    const call = await c.fake.waitFor(async () => { const x = await c.callOf('ch-tf'); return x?.status === 'ACTIVE' ? x : null; }, 'ativa');
    expect((await c.ctl.transferCall(c.orgId, call.id, 'abc')).ok).toBe(false);
    expect((await c.ctl.transferCall('outro-org', call.id, '6332182000')).ok).toBe(false);
    await c.ctl.transferCall(c.orgId, call.id, '6332182000');
    const t = await c.fake.waitFor(() => c.fake.originated().find((x) => x.appArgs?.startsWith('transfer')), 'originate');
    c.fake.failOriginated(t.id, 17); // ocupado
    await new Promise((r) => setTimeout(r, 100));
    expect((await c.callOf('ch-tf'))?.status).toBe('ACTIVE');
    expect(c.fake.channels.has(ag.id)).toBe(true);
    expect(c.ctl.getSession(call.id)).toBeDefined();
  });

  it('nó transfer da URA: liga o chamador ao destino pelo tronco', async () => {
    ctx = await setup(); const c = ctx;
    await dialAndChoose(c, 'ch-ut', '63999990010', '3');
    const t = await c.fake.waitFor(() => c.fake.originated()[0], 'originate');
    expect(t.endpoint).toBe('PJSIP/6332180000@tjto-trunk');
    c.fake.answerOriginated(t.id);
    await c.fake.waitFor(async () => (await c.callOf('ch-ut'))?.status === 'ACTIVE', 'ativa');
    expect([...c.fake.bridges.values()][0].channels.sort()).toEqual(['ch-ut', t.id].sort());
    c.fake.hangup('ch-ut');
    await c.fake.waitFor(async () => (await c.callOf('ch-ut'))?.status === 'ENDED', 'fim');
  });

  it('cabeçalho SIP X-URA-Option vai para a conversa e define o ponto de entrada da URA', async () => {
    ctx = await setup(); const c = ctx;
    c.fake.incoming('ch-hd', { number: '63999990011', did: c.did, headers: { 'X-URA-Option': '9' } });
    const call = await c.fake.waitFor(async () => { const x = await c.callOf('ch-hd'); return x?.status === 'QUEUED' ? x : null; }, 'direto para a fila (entryByHeader)');
    const conv = await c.fake.waitFor(async () => { const x = await prisma.bvConversation.findUniqueOrThrow({ where: { id: call.conversationId! } }); return x.status === 'WAITING' ? x : null; }, 'conversa na fila');
    expect((conv.metadata as any).voice.headers['X-URA-Option']).toBe('9');
    expect(conv.category).toBe('PROCESSO');
    expect(c.fake.playsOn('ch-hd').some((p) => p.media[0].includes('Bem_vindo'))).toBe(false); // pulou o menu
  });

  it('click-to-call: toca o ramal, ao atender disca pelo tronco, bridge + gravação', async () => {
    ctx = await setup(); const c = ctx;
    const agent = c.agents[0];
    const r = await c.ctl.dial(c.orgId, agent.id, '63988887777');
    expect(r.ok).toBe(true);
    const a = await c.fake.waitFor(() => c.fake.originated().find((x) => x.endpoint === `PJSIP/${agent.sipExtension}`), 'toque no ramal');
    c.fake.answerOriginated(a.id);
    const o = await c.fake.waitFor(() => c.fake.originated().find((x) => x.appArgs?.startsWith('dialout')), 'discagem externa');
    expect(o.endpoint).toBe('PJSIP/63988887777@tjto-trunk');
    c.fake.answerOriginated(o.id);
    const callId = (r as any).callId as string;
    await c.fake.waitFor(async () => (await prisma.bvCall.findUnique({ where: { id: callId } }))?.status === 'ACTIVE', 'ativa');
    expect(c.fake.live.has(`bv-${callId}`)).toBe(true);
    c.fake.hangup(o.id);
    const done = await c.fake.waitFor(async () => { const x = await prisma.bvCall.findUnique({ where: { id: callId } }); return x?.status === 'ENDED' && x.recordingKey ? x : null; }, 'fim');
    expect(done.direction).toBe('OUT');
    // sem ramal → recusa
    const noExt = await makeUser(c.orgId, 'ATENDENTE');
    expect(await c.ctl.dial(c.orgId, noExt.id, '63988887777')).toMatchObject({ ok: false, code: 'voice.no_extension' });
  });

  it('pico de canais simultâneos: duas chamadas ao mesmo tempo → gauge = 2', async () => {
    ctx = await setup(); const c = ctx;
    for (const [id, n] of [['ch-p1', '63999991001'], ['ch-p2', '63999991002']]) c.fake.incoming(id, { number: n, did: c.did });
    await c.fake.waitFor(() => c.ctl.activeCallIds(c.orgId).length === 2, '2 sessões');
    await c.fake.waitFor(async () => (await getUsage(c.orgId, 'VOICE_PEAK_CHANNELS', new Date(Date.now() - 86400_000), new Date())) === 2, 'pico 2');
    c.fake.hangup('ch-p1'); c.fake.hangup('ch-p2');
    await c.fake.waitFor(() => c.ctl.activeCallIds(c.orgId).length === 0, 'encerradas');
    expect(await getUsage(c.orgId, 'VOICE_PEAK_CHANNELS', new Date(Date.now() - 86400_000), new Date())).toBe(2); // modo max
  });

  it('DID de outro órgão/sem fluxo: a chamada é recusada; DID isolado por órgão', async () => {
    ctx = await setup(); const c = ctx;
    c.fake.incoming('ch-x', { number: '63999990099', did: '0800000000' });
    await c.fake.waitFor(() => !c.fake.channels.has('ch-x'), 'recusada');
    expect(await prisma.bvCall.count({ where: { orgId: c.orgId } })).toBe(0);
  });

  it('conversa fechada pelo atendente derruba a ligação ativa', async () => {
    ctx = await setup(); const c = ctx;
    autoRoute(c);
    await dialAndChoose(c, 'ch-cl', '63999990012', '1');
    const ag = await c.fake.waitFor(() => c.fake.originated()[0], 'toque');
    c.fake.answerOriginated(ag.id);
    const call = await c.fake.waitFor(async () => { const x = await c.callOf('ch-cl'); return x?.status === 'ACTIVE' ? x : null; }, 'ativa');
    await closeConversation({ orgId: c.orgId, conversationId: call.conversationId!, reason: 'RESOLVED', actorUserId: c.agents[0].id });
    await c.fake.waitFor(async () => (await c.callOf('ch-cl'))?.status === 'ENDED', 'chamada encerrada');
    expect(c.fake.channels.has('ch-cl')).toBe(false);
  });
});

describe('voice/ARI — conexão', () => {
  it('reconecta com backoff quando o WebSocket cai e reconcilia chamadas órfãs', async () => {
    ctx = await setup(); const c = ctx;
    // chamada "viva" no banco, sem canal no Asterisk (API caiu no meio)
    const orphan = await prisma.bvCall.create({ data: { orgId: c.orgId, direction: 'IN', fromNumber: '1', toNumber: c.did, status: 'QUEUED', ariChannelId: 'ghost' } });
    c.fake.closeSockets();
    await c.fake.waitFor(() => !c.fake.connected, 'queda');
    await c.fake.waitFor(() => c.fake.connected, 'reconexão');
    expect(c.ctl.status().connected).toBe(true);
    expect(c.ctl.status().reconnects).toBeGreaterThanOrEqual(1);
    await c.fake.waitFor(async () => (await prisma.bvCall.findUniqueOrThrow({ where: { id: orphan.id } })).status === 'ABANDONED', 'órfã encerrada');
  });
});
