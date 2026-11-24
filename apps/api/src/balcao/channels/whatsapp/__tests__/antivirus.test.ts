process.env.BV_DEV_SIMULATORS = '1';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-12345678901234567890';

import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import path from 'path';
import Fastify, { type FastifyInstance } from 'fastify';
import { prisma } from '../../../../lib/prisma';
import { makeOrg } from '../../../core/testing';
import waPlugin from '../index';
import { clearBvEventHandlers } from '../../../core/events';
import { saveIntegration } from '../../../core/integrations';
import { listMessages } from '../../../core/messages';
import { storageRoot } from '../../../core/storage';
import { configureWaRuntime, setWaHttp } from '../graph';
import { drainWhatsappBackground, retryPendingMedia } from '../inbound';
import { invalidateWaConfigCache } from '../config';
import { FakeGraph } from './fake-graph';

const TOKEN = 'tok-test-1234567890';
const graph = new FakeGraph();
let app: FastifyInstance;
const rand = (n = 12) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');

function fakeClamd(): Promise<{ port: number; scans: number; close: () => void }> {
  return new Promise((resolve) => {
    const st = { port: 0, scans: 0, close: () => undefined as void };
    const srv = net.createServer((sock) => {
      let buf = Buffer.alloc(0);
      sock.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        if (buf.subarray(buf.length - 4).equals(Buffer.alloc(4))) { st.scans++; sock.write(buf.includes('EICAR') ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0'); sock.end(); }
      });
    }).listen(0, '127.0.0.1', () => { st.port = (srv.address() as net.AddressInfo).port; st.close = () => { srv.close(); }; resolve(st); });
  });
}

async function setup() {
  const org = await makeOrg({ ai: { enabled: false } });
  const c = { phoneNumberId: rand(), wabaId: rand(), appSecret: `secret-${rand(8)}`, verifyToken: `verify-${rand(8)}` };
  graph.wabaIds.add(c.wabaId);
  await saveIntegration(org.id, 'WHATSAPP', { accessToken: TOKEN, ...c, apiBase: graph.base });
  invalidateWaConfigCache();
  return { orgId: org.id, ...c };
}
type Ctx = Awaited<ReturnType<typeof setup>>;
const sign = (body: string, secret: string) => 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
async function receive(ctx: Ctx, m: any) {
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: ctx.phoneNumberId }, contacts: [{ profile: { name: 'Maria' }, wa_id: m.from }], messages: [m] } }] }] });
  const r = await app.inject({ method: 'POST', url: '/balcao/whatsapp/webhook', payload: body, headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body, ctx.appSecret) } });
  expect(r.statusCode).toBe(200);
  await drainWhatsappBackground();
  return prisma.bvMessage.findFirstOrThrow({ where: { orgId: ctx.orgId, channelMessageId: m.id } });
}
const imageMsg = (mediaId: string, wamid: string) => ({ from: '5563988880099', id: wamid, timestamp: String(Math.floor(Date.now() / 1000)), type: 'image', image: { id: mediaId, mime_type: 'image/jpeg', caption: 'minha foto' } });
const filesOf = (orgId: string): string[] => {
  const walk = (d: string): string[] => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);
  return walk(path.join(storageRoot(), orgId, 'attachments'));
};

beforeAll(async () => {
  await graph.start();
  configureWaRuntime({ baseDelayMs: 1, maxDelayMs: 5, sleep: async () => undefined, statusRetryDelaysMs: [] });
  app = Fastify({ logger: false, trustProxy: true });
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => { try { (req as any).rawBody = body; const t = body.toString().trim(); done(null, t ? JSON.parse(t) : {}); } catch (e: any) { done(e); } });
  await app.register(waPlugin, { prefix: '/balcao/whatsapp' });
  await app.ready();
});
afterAll(async () => { await drainWhatsappBackground(); await app.close(); await graph.stop(); clearBvEventHandlers(); setWaHttp(null); });
beforeEach(() => graph.reset());

describe('whatsapp — antivírus na mídia baixada da Graph', () => {
  let clam: Awaited<ReturnType<typeof fakeClamd>>;
  beforeEach(async () => { clam = await fakeClamd(); process.env.BV_CLAMAV_HOST = '127.0.0.1'; process.env.BV_CLAMAV_PORT = String(clam.port); });
  afterEach(() => { clam.close(); delete process.env.BV_CLAMAV_HOST; delete process.env.BV_CLAMAV_PORT; delete process.env.BV_CLAMAV_FAIL_MODE; });

  it('mídia limpa é guardada normalmente (varrida uma vez)', async () => {
    const ctx = await setup();
    graph.files.set('media-in-av-ok', { mime: 'image/jpeg', data: Buffer.from('jpeg-limpo-0123456789') });
    const row = await receive(ctx, imageMsg('media-in-av-ok', 'wamid.AVOK'));
    expect((row.channelMeta as any).wa.mediaStatus).toBe('STORED');
    expect((row.attachments as any[])).toHaveLength(1);
    expect((row.channelMeta as any).attachmentsRejected).toBeUndefined();
    expect(clam.scans).toBe(1);
    expect(filesOf(ctx.orgId)).toHaveLength(1);
  });

  it('mídia infectada: descartada, registrada em channelMeta.attachmentsRejected, nada no storage; a mensagem (legenda) segue', async () => {
    const ctx = await setup();
    graph.files.set('media-in-av-bad', { mime: 'image/jpeg', data: Buffer.from('X5O!P%@AP EICAR-STANDARD-ANTIVIRUS-TEST-FILE') });
    const row = await receive(ctx, imageMsg('media-in-av-bad', 'wamid.AVBAD'));
    expect((await listMessages(row.conversationId))[0].body).toBe('minha foto');
    expect(row.kind).toBe('IMAGE');
    expect(row.attachments).toEqual([]);
    const meta = row.channelMeta as any;
    expect(meta.attachmentsRejected).toEqual([{ name: expect.stringMatching(/^image-.*\.jpg$/), reason: 'infected' }]);
    expect(meta.wa).toMatchObject({ mediaStatus: 'REJECTED', mediaError: 'attachment.rejected', mediaId: 'media-in-av-bad' });
    expect(filesOf(ctx.orgId)).toHaveLength(0);
    // REJECTED é definitivo: o job de reprocessamento não baixa de novo
    const calls = graph.calls.length;
    await retryPendingMedia();
    expect(graph.calls.length).toBe(calls);
    expect(await prisma.bvIntegrationLog.count({ where: { orgId: ctx.orgId, type: 'WHATSAPP', operation: 'media.download', ok: false } })).toBe(1);
  });

  it('documento infectado usa o nome do arquivo (sem path traversal) no registro', async () => {
    const ctx = await setup();
    graph.files.set('media-in-av-doc', { mime: 'application/pdf', data: Buffer.from('%PDF-1.4 EICAR') });
    const m = { from: '5563988880098', id: 'wamid.AVDOC', timestamp: String(Math.floor(Date.now() / 1000)), type: 'document', document: { id: 'media-in-av-doc', mime_type: 'application/pdf', filename: '../../etc/laudo.pdf' } };
    const row = await receive(ctx, m);
    expect((row.channelMeta as any).attachmentsRejected).toEqual([{ name: 'laudo.pdf', reason: 'infected' }]);
  });

  it('antivírus indisponível (fail-closed): fica PENDING e é reprocessado pelo job; ao voltar, a mídia é guardada', async () => {
    const ctx = await setup();
    graph.files.set('media-in-av-down', { mime: 'image/jpeg', data: Buffer.from('jpeg-limpo-abcdef') });
    clam.close(); process.env.BV_CLAMAV_PORT = '1';
    let row = await receive(ctx, imageMsg('media-in-av-down', 'wamid.AVDOWN'));
    expect((row.channelMeta as any).wa).toMatchObject({ mediaStatus: 'PENDING', mediaAttempts: 1, mediaError: 'attachment.scan_unavailable' });
    expect(row.attachments).toEqual([]);
    expect((row.channelMeta as any).attachmentsRejected).toBeUndefined();
    expect(filesOf(ctx.orgId)).toHaveLength(0);

    const back = await fakeClamd(); process.env.BV_CLAMAV_PORT = String(back.port);
    try {
      expect(await retryPendingMedia()).toBeGreaterThanOrEqual(1);
      row = await prisma.bvMessage.findFirstOrThrow({ where: { id: row.id } });
      expect((row.channelMeta as any).wa.mediaStatus).toBe('STORED');
      expect((row.attachments as any[])).toHaveLength(1);
    } finally { back.close(); }
  });

  it('antivírus fora por todas as tentativas: ao esgotar, é descartado e registrado (scan_unavailable)', async () => {
    const ctx = await setup();
    graph.files.set('media-in-av-dead', { mime: 'image/jpeg', data: Buffer.from('jpeg-x') });
    clam.close(); process.env.BV_CLAMAV_PORT = '1';
    let row = await receive(ctx, imageMsg('media-in-av-dead', 'wamid.AVDEAD'));
    for (let i = 0; i < 6; i++) await retryPendingMedia();
    row = await prisma.bvMessage.findFirstOrThrow({ where: { id: row.id } });
    expect((row.channelMeta as any).wa).toMatchObject({ mediaStatus: 'REJECTED', mediaAttempts: 5 });
    expect((row.channelMeta as any).attachmentsRejected).toEqual([{ name: expect.any(String), reason: 'scan_unavailable' }]);
    expect(row.attachments).toEqual([]);
  });

  it('fail-open com antivírus fora: aceita; sem ClamAV configurado: varredura desligada', async () => {
    const ctx = await setup();
    graph.files.set('media-in-av-open', { mime: 'image/jpeg', data: Buffer.from('jpeg-open') });
    clam.close(); process.env.BV_CLAMAV_PORT = '1'; process.env.BV_CLAMAV_FAIL_MODE = 'open';
    expect(((await receive(ctx, imageMsg('media-in-av-open', 'wamid.AVOPEN'))).channelMeta as any).wa.mediaStatus).toBe('STORED');
    delete process.env.BV_CLAMAV_HOST; delete process.env.BV_CLAMAV_PORT; delete process.env.BV_CLAMAV_FAIL_MODE;
    graph.files.set('media-in-av-off', { mime: 'image/jpeg', data: Buffer.from('EICAR sem scan') });
    expect(((await receive(ctx, imageMsg('media-in-av-off', 'wamid.AVOFF'))).channelMeta as any).wa.mediaStatus).toBe('STORED');
  });
});
