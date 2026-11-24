process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-12345678901234567890';
process.env.BV_STORAGE_DIR = process.env.BV_STORAGE_DIR || require('path').join(require('os').tmpdir(), 'bv-storage-webchat-test');

import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import path from 'path';
import Fastify, { type FastifyInstance } from 'fastify';
import { prisma } from '../../../../lib/prisma';
import { makeOrg } from '../../../core/testing';
import { storageRoot } from '../../../core/storage';

function fakeClamd(): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const srv = net.createServer((sock) => {
      let buf = Buffer.alloc(0);
      sock.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        if (buf.subarray(buf.length - 4).equals(Buffer.alloc(4))) { sock.write(buf.includes('EICAR') ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0'); sock.end(); }
      });
    }).listen(0, '127.0.0.1', () => resolve({ port: (srv.address() as net.AddressInfo).port, close: () => { srv.close(); } }));
  });
}

let app: FastifyInstance;
beforeAll(async () => {
  app = Fastify({ logger: false, trustProxy: true });
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => { try { const t = body.toString().trim(); done(null, t ? JSON.parse(t) : {}); } catch (e: any) { done(e); } });
  const { default: webchat } = await import('../index');
  await app.register(webchat, { prefix: '/balcao/webchat' });
  await app.ready();
});
afterAll(async () => { await app.close(); });

const rnd = () => crypto.randomBytes(4).toString('hex');
const ipOf = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (extra = 'limpo') => Buffer.concat([PNG_HEAD, Buffer.from(extra), Buffer.alloc(64, 1)]);
function multipart(file: { name: string; type: string; data: Buffer }) {
  const b = `----bv${rnd()}`;
  const payload = Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`), file.data, Buffer.from(`\r\n--${b}--\r\n`)]);
  return { payload, contentType: `multipart/form-data; boundary=${b}` };
}
async function visitor() {
  const o = await makeOrg({ ai: { enabled: false }, webchat: {} });
  const ip = ipOf();
  const res = await app.inject({ method: 'POST', url: '/balcao/webchat/public/session', headers: { 'x-forwarded-for': ip }, payload: { org: o.slug } });
  const headers = { 'x-visitor-token': res.json().token as string, 'x-forwarded-for': ip };
  const upload = (data: Buffer, name = 'foto.png') => { const m = multipart({ name, type: 'image/png', data }); return app.inject({ method: 'POST', url: '/balcao/webchat/public/attachments', headers: { ...headers, 'content-type': m.contentType }, payload: m.payload }); };
  return { orgId: o.id, upload };
}
const filesOf = (orgId: string): string[] => {
  const walk = (d: string): string[] => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);
  return walk(path.join(storageRoot(), orgId, 'attachments'));
};

describe('webchat — antivírus em /public/attachments', () => {
  let clam: { port: number; close: () => void };
  beforeEach(async () => { clam = await fakeClamd(); process.env.BV_CLAMAV_HOST = '127.0.0.1'; process.env.BV_CLAMAV_PORT = String(clam.port); });
  afterEach(() => { clam.close(); delete process.env.BV_CLAMAV_HOST; delete process.env.BV_CLAMAV_PORT; delete process.env.BV_CLAMAV_FAIL_MODE; });

  it('arquivo infectado → 422 attachment.rejected; nada fica no storage nem vira mensagem; limpo → 201', async () => {
    const v = await visitor();
    const bad = await v.upload(png('EICAR-STANDARD-ANTIVIRUS-TEST-FILE'));
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error).toMatchObject({ code: 'attachment.rejected', details: { reason: 'infected' } });
    expect(JSON.stringify(bad.json())).not.toContain('Eicar-Test-Signature'); // não expõe a assinatura ao cidadão
    expect(filesOf(v.orgId)).toHaveLength(0);
    expect(await prisma.bvMessage.count({ where: { orgId: v.orgId } })).toBe(0);
    expect(await prisma.bvConversation.count({ where: { orgId: v.orgId } })).toBe(0);

    const ok = await v.upload(png());
    expect(ok.statusCode).toBe(201);
    expect(ok.json().message.attachments).toHaveLength(1);
    expect(filesOf(v.orgId)).toHaveLength(1);
  });

  it('clamd indisponível: fail-closed (padrão) recusa com reason scan_unavailable; fail-open aceita', async () => {
    const v = await visitor();
    clam.close(); process.env.BV_CLAMAV_PORT = '1';
    const closed = await v.upload(png());
    expect(closed.statusCode).toBe(422);
    expect(closed.json().error).toMatchObject({ code: 'attachment.rejected', details: { reason: 'scan_unavailable' } });
    expect(filesOf(v.orgId)).toHaveLength(0);
    process.env.BV_CLAMAV_FAIL_MODE = 'open';
    expect((await v.upload(png())).statusCode).toBe(201);
  });

  it('sem ClamAV configurado a varredura é desligada (nada muda)', async () => {
    delete process.env.BV_CLAMAV_HOST;
    const v = await visitor();
    expect((await v.upload(png('EICAR-STANDARD-ANTIVIRUS-TEST-FILE'))).statusCode).toBe(201);
  });
});
