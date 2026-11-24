process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-12345678901234567890';

import fs from 'fs';
import net from 'net';
import path from 'path';
import Fastify, { type FastifyInstance } from 'fastify';
import MailComposer from 'nodemailer/lib/mail-composer';
import { prisma } from '../../../../lib/prisma';
import { saveIntegration } from '../../../core/integrations';
import { listMessages } from '../../../core/messages';
import { getObjectBuffer, storageRoot } from '../../../core/storage';
import { makeOrg } from '../../../core/testing';
import emailPlugin from '../index';
import { imapPoller, setImapClientFactory } from '../imap';
import { ingestRawEmail } from '../inbound';
import type { ImapClientFactory } from '../types';

/** clamd falso: lê o INSTREAM e responde FOUND se o conteúdo contiver "EICAR". */
function fakeClamd(): Promise<{ port: number; scans: number; close: () => void }> {
  return new Promise((resolve) => {
    const state = { port: 0, scans: 0, close: () => undefined as void };
    const srv = net.createServer((sock) => {
      let buf = Buffer.alloc(0);
      sock.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        if (buf.subarray(buf.length - 4).equals(Buffer.alloc(4))) { state.scans++; sock.write(buf.includes('EICAR') ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0'); sock.end(); }
      });
    }).listen(0, '127.0.0.1', () => { state.port = (srv.address() as net.AddressInfo).port; state.close = () => { srv.close(); }; resolve(state); });
  });
}

const OWN = 'balcao@av.test';
const filesOf = (orgId: string): string[] => {
  const dir = path.join(storageRoot(), orgId, 'attachments');
  const walk = (d: string): string[] => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);
  return walk(dir);
};
const mail = (attachments: Array<{ filename: string; content: Buffer }>, id = `<av-${Date.now()}-${Math.random().toString(36).slice(2)}@cidadao.test>`) =>
  new MailComposer({ from: { name: 'Maria', address: 'maria@cidadao.test' }, to: OWN, subject: 'Documentos', text: 'segue em anexo', messageId: id, attachments }).compile().build();
const ctxOf = (orgId: string) => ({ orgId, ownAddresses: [OWN], source: 'imap' as const });

let clam: Awaited<ReturnType<typeof fakeClamd>>;
beforeEach(async () => { clam = await fakeClamd(); process.env.BV_CLAMAV_HOST = '127.0.0.1'; process.env.BV_CLAMAV_PORT = String(clam.port); });
afterEach(() => { clam.close(); delete process.env.BV_CLAMAV_HOST; delete process.env.BV_CLAMAV_PORT; delete process.env.BV_CLAMAV_FAIL_MODE; setImapClientFactory(); });

describe('e-mail — antivírus nos anexos de cidadãos', () => {
  it('anexo infectado é descartado e registrado em channelMeta.attachmentsRejected; a mensagem e os anexos limpos seguem', async () => {
    const org = await makeOrg({ ai: { enabled: false } });
    const out = await ingestRawEmail(await mail([
      { filename: 'laudo.pdf', content: Buffer.from('%PDF-1.4 documento limpo') },
      { filename: 'fatura.exe', content: Buffer.from('MZ X5O!P%@AP EICAR-STANDARD-ANTIVIRUS-TEST-FILE') },
      { filename: 'foto.jpg', content: Buffer.from('imagem-limpa') },
    ]), ctxOf(org.id));
    if (out.status !== 'ingested') throw new Error('esperava ingested');
    const [m] = await listMessages(out.conversationId);
    expect(m.body).toContain('segue em anexo');
    expect((m.attachments as any[]).map((a) => a.name)).toEqual(['laudo.pdf', 'foto.jpg']);
    expect((m.channelMeta as any).attachmentsRejected).toEqual([{ name: 'fatura.exe', reason: 'infected' }]);
    expect((await getObjectBuffer((m.attachments as any[])[0].key)).toString()).toContain('documento limpo');
    expect(filesOf(org.id)).toHaveLength(2); // o infectado não ficou no storage
    expect(clam.scans).toBe(3);
  });

  it('todos os anexos recusados: a mensagem é ingerida sem anexos (não derruba o e-mail)', async () => {
    const org = await makeOrg({ ai: { enabled: false } });
    const out = await ingestRawEmail(await mail([{ filename: 'a.bin', content: Buffer.from('EICAR 1') }, { filename: 'b.bin', content: Buffer.from('EICAR 2') }]), ctxOf(org.id));
    expect(out.status).toBe('ingested');
    if (out.status !== 'ingested') return;
    const [m] = await listMessages(out.conversationId);
    expect(m.attachments ?? []).toHaveLength(0);
    expect((m.channelMeta as any).attachmentsRejected).toEqual([{ name: 'a.bin', reason: 'infected' }, { name: 'b.bin', reason: 'infected' }]);
    expect(filesOf(org.id)).toHaveLength(0);
  });

  it('sem anexos recusados o channelMeta não ganha attachmentsRejected', async () => {
    const org = await makeOrg({ ai: { enabled: false } });
    const out = await ingestRawEmail(await mail([{ filename: 'ok.txt', content: Buffer.from('ok') }]), ctxOf(org.id));
    if (out.status !== 'ingested') throw new Error('x');
    const [m] = await listMessages(out.conversationId);
    expect((m.channelMeta as any).attachmentsRejected).toBeUndefined();
  });

  it('clamd fora do ar: fail-closed descarta (scan_unavailable); fail-open aceita', async () => {
    const org = await makeOrg({ ai: { enabled: false } });
    clam.close(); process.env.BV_CLAMAV_PORT = '1';
    const closed = await ingestRawEmail(await mail([{ filename: 'x.pdf', content: Buffer.from('%PDF-1.4') }]), ctxOf(org.id));
    if (closed.status !== 'ingested') throw new Error('x');
    expect(((await listMessages(closed.conversationId))[0].channelMeta as any).attachmentsRejected).toEqual([{ name: 'x.pdf', reason: 'scan_unavailable' }]);
    process.env.BV_CLAMAV_FAIL_MODE = 'open';
    const open = await ingestRawEmail(await mail([{ filename: 'y.pdf', content: Buffer.from('%PDF-1.4') }]), ctxOf(org.id));
    if (open.status !== 'ingested') throw new Error('x');
    const all = await listMessages(open.conversationId);
    const m = all[all.length - 1]; // mesma conversa (mesmo remetente/assunto): a mais recente
    expect((m.attachments as any[]).map((a) => a.name)).toEqual(['y.pdf']);
    expect((m.channelMeta as any).attachmentsRejected).toBeUndefined();
  });

  it('sem ClamAV configurado nada muda (varredura desligada)', async () => {
    delete process.env.BV_CLAMAV_HOST;
    const org = await makeOrg({ ai: { enabled: false } });
    const out = await ingestRawEmail(await mail([{ filename: 'eicar.txt', content: Buffer.from('EICAR') }]), ctxOf(org.id));
    if (out.status !== 'ingested') throw new Error('x');
    expect((await listMessages(out.conversationId))[0].attachments).toHaveLength(1);
    expect(clam.scans).toBe(0);
  });

  it('pelo poller IMAP e pelo webhook /inbound o comportamento é o mesmo', async () => {
    const org = await makeOrg({ ai: { enabled: false } });
    await saveIntegration(org.id, 'EMAIL_IMAP', {
      imap: { host: 'h', port: 993, secure: true, user: OWN, pass: 'segredo-imap-123' }, smtp: { host: 's', port: 465, secure: true, user: OWN, pass: 'segredo-smtp-456' },
      from: { name: 'B', address: OWN }, mailbox: 'INBOX', pollIntervalSec: 30, inboundSecret: 'segredo-webhook-0123456789',
    });
    const raw1 = await mail([{ filename: 'virus.exe', content: Buffer.from('EICAR') }]);
    const factory: ImapClientFactory = { async connect() { return { async openMailbox() { return { uidValidity: 1n, uidNext: 2 }; }, async fetchNew() { return { messages: [{ uid: 1, size: raw1.length, raw: raw1 }], hasMore: false }; }, async markSeen() { /* noop */ }, async close() { /* noop */ } }; } };
    setImapClientFactory(factory);
    expect(await imapPoller.pollOrg(org.id, { force: true })).toMatchObject({ ingested: 1, failed: 0 });

    const app: FastifyInstance = Fastify({ logger: false, trustProxy: true });
    app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_r, body, done) => { try { const s = body.toString().trim(); done(null, s ? JSON.parse(s) : {}); } catch (e: any) { done(e); } });
    await app.register(emailPlugin, { prefix: '/balcao/email' }); await app.ready();
    try {
      const raw2 = await mail([{ filename: 'webhook.exe', content: Buffer.from('EICAR') }, { filename: 'ok.pdf', content: Buffer.from('%PDF-1.4') }]);
      const r = await app.inject({ method: 'POST', url: `/balcao/email/inbound?org=${org.id}`, headers: { 'content-type': 'message/rfc822', 'x-inbound-secret': 'segredo-webhook-0123456789' }, payload: raw2 });
      expect(r.statusCode).toBe(200);
      expect(r.json().status).toBe('ingested');
    } finally { await app.close(); }
    const rows = await prisma.bvMessage.findMany({ where: { orgId: org.id, direction: 'IN' }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((x) => (x.channelMeta as any).attachmentsRejected?.[0]?.name)).toEqual(['virus.exe', 'webhook.exe']);
    expect(filesOf(org.id)).toHaveLength(1); // só ok.pdf
  });
});
