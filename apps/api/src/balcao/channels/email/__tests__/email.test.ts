process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-12345678901234567890';

import type { FastifyInstance } from 'fastify';
import MailComposer from 'nodemailer/lib/mail-composer';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import { prisma } from '../../../../lib/prisma';
import { saveIntegration } from '../../../core/integrations';
import { getObjectBuffer } from '../../../core/storage';
import { getUsage } from '../../../core/usage';
import { listMessages } from '../../../core/messages';
import * as conversations from '../../../core/conversations';
import { sendMessage } from '../../../core/conversations';
import { authHeader, buildBalcaoTestApp, makeOrg, makeUser } from '../../../core/testing';
import { htmlToText, normalizeSubject, parseRawEmail } from '../parse';
import { ingestRawEmail } from '../inbound';
import { extractProtocol } from '../threading';
import { imapPoller, setImapClientFactory } from '../imap';
import { setMailTransportFactory, textToSafeHtml, buildReplySubject } from '../outbound';
import { secretsMatch } from '../index';
import type { ImapClientFactory, ImapSession, MailTransport } from '../types';

// ── Fixtures ────────────────────────────────────────────────────────────────

const OWN = 'balcao@tj.test';
let seq = 0;
const mid = (tag = 'm') => `<${tag}-${Date.now()}-${++seq}-${Math.random().toString(36).slice(2, 8)}@cidadao.test>`;

async function raw(o: { from?: string; name?: string; to?: string; subject?: string; text?: string; html?: string; messageId?: string; inReplyTo?: string; references?: string[]; headers?: Record<string, string>; attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>; cc?: string }): Promise<Buffer> {
  return new MailComposer({
    from: { name: o.name ?? 'Maria Cidadã', address: o.from ?? 'maria@cidadao.test' }, to: o.to ?? OWN, cc: o.cc,
    subject: o.subject ?? 'Dúvida sobre processo', text: o.text, html: o.html,
    messageId: o.messageId ?? mid(), inReplyTo: o.inReplyTo, references: o.references, headers: o.headers, attachments: o.attachments,
  }).compile().build();
}

/** Caixa IMAP em memória + fábrica compatível com ImapClientFactory. */
class FakeBox {
  uidValidity = 100n; nextUid = 1; msgs: Array<{ uid: number; raw: Buffer; seen: boolean; at: Date }> = [];
  add(buf: Buffer, seen = false, at = new Date()) { const uid = this.nextUid++; this.msgs.push({ uid, raw: buf, seen, at }); return uid; }
  factory(): ImapClientFactory {
    const box = this;
    return {
      async connect(): Promise<ImapSession> {
        return {
          async openMailbox() { return { uidValidity: box.uidValidity, uidNext: box.nextUid }; },
          async fetchNew({ afterUid, limit, since }) {
            let c = box.msgs.filter((m) => m.uid > afterUid);
            if (since) c = c.filter((m) => !m.seen && m.at >= since);
            c.sort((a, b) => a.uid - b.uid);
            return { messages: c.slice(0, limit).map((m) => ({ uid: m.uid, size: m.raw.length, raw: m.raw })), hasMore: c.length > limit };
          },
          async markSeen(uid) { const m = box.msgs.find((x) => x.uid === uid); if (m) m.seen = true; },
          async close() { /* noop */ },
        };
      },
    };
  }
}

interface Sent { mail: any }
function fakeTransport(sent: Sent[], opts: { fail?: (mail: any) => any } = {}): MailTransport {
  return {
    async sendMail(mail: any) {
      const err = opts.fail?.(mail);
      if (err) throw err;
      sent.push({ mail });
      return { messageId: mail.messageId, accepted: [mail.to], rejected: [] };
    },
    async verify() { return true; },
  };
}

const baseCfg = (over: Record<string, any> = {}) => ({
  imap: { host: 'imap.tj.test', port: 993, secure: true, user: OWN, pass: 'segredo-imap-123' },
  smtp: { host: 'smtp.tj.test', port: 465, secure: true, user: OWN, pass: 'segredo-smtp-456' },
  from: { name: 'Balcão Virtual TJ', address: OWN }, mailbox: 'INBOX', pollIntervalSec: 30, inboundSecret: 'segredo-webhook-0123456789', ...over,
});

async function setupOrg(over: Record<string, any> = {}) {
  const org = await makeOrg({ ai: { enabled: false } });
  await saveIntegration(org.id, 'EMAIL_IMAP', baseCfg(over));
  return org;
}
const ctxOf = (orgId: string, extra: Record<string, any> = {}) => ({ orgId, ownAddresses: [OWN], source: 'imap' as const, ...extra });
const convCount = (orgId: string) => prisma.bvConversation.count({ where: { orgId } });
const today = () => { const d = new Date(); return { from: new Date(d.getTime() - 86400_000), to: new Date(d.getTime() + 86400_000) }; };

let app: FastifyInstance;
let sent: Sent[];
beforeAll(async () => { delete process.env.BV_DEV_SIMULATORS; app = await buildBalcaoTestApp(); });
afterAll(async () => { await app.close(); });
beforeEach(() => { sent = []; setMailTransportFactory(() => fakeTransport(sent)); });
afterEach(() => { setMailTransportFactory(); setImapClientFactory(); jest.restoreAllMocks(); });

// ── Parse ───────────────────────────────────────────────────────────────────

describe('email — parse', () => {
  it('texto simples com cabeçalhos, cc e Message-ID', async () => {
    const id = mid();
    const p = await parseRawEmail(await raw({ text: 'Olá, preciso de ajuda.', messageId: id, cc: 'joao@cidadao.test', subject: 'Ajuda' }), [OWN]);
    expect(p.messageId).toBe(id);
    expect(p.from).toEqual({ address: 'maria@cidadao.test', name: 'Maria Cidadã' });
    expect(p.to).toEqual([OWN]); expect(p.cc).toEqual(['joao@cidadao.test']);
    expect(p.subject).toBe('Ajuda'); expect(p.text).toBe('Olá, preciso de ajuda.');
    expect(p.automated.automated).toBe(false);
  });

  it('só HTML vira texto limpo (sem script/estilo)', async () => {
    const html = '<html><head><style>p{color:red}</style></head><body><script>alert(1)</script><p>Prezados,</p><p>Segue o <b>pedido</b> &amp; o link <a href="https://tj.test/x">aqui</a>.</p><ul><li>um</li><li>dois</li></ul></body></html>';
    const p = await parseRawEmail(await raw({ html }));
    expect(p.text).not.toMatch(/<|alert|color:red/);
    expect(p.text).toContain('Prezados,'); expect(p.text).toContain('pedido & o link'); expect(p.text).toContain('https://tj.test/x'); expect(p.text).toMatch(/- um/);
    expect(htmlToText('<p>a&nbsp;b</p><br>c')).toBe('a b\n\nc'.replace('\n\nc', '\nc').replace('a b\nc', 'a b\n\nc'));
  });

  it('anexos (nome, tipo, tamanho)', async () => {
    const p = await parseRawEmail(await raw({ text: 'veja', attachments: [{ filename: 'laudo.pdf', content: Buffer.from('%PDF-1.4 teste'), contentType: 'application/pdf' }] }));
    expect(p.attachments).toHaveLength(1);
    expect(p.attachments[0]).toMatchObject({ filename: 'laudo.pdf', contentType: 'application/pdf', size: 14 });
  });

  it('normalizeSubject e extractProtocol', () => {
    expect(normalizeSubject('RES: Re: Fwd: Pedido [BV-2026-000123]')).toBe('Pedido');
    expect(extractProtocol('Re: Pedido [bv-2026-000123]', 'BV')).toBe('BV-2026-000123');
    expect(extractProtocol('Re: Pedido [XX-2026-000123]', 'BV')).toBeNull();
  });
});

// ── Filtros anti-loop ───────────────────────────────────────────────────────

describe('email — ignora mensagens automáticas', () => {
  const cases: Array<[string, Parameters<typeof raw>[0]]> = [
    ['auto_submitted', { headers: { 'Auto-Submitted': 'auto-replied' } }],
    ['precedence', { headers: { Precedence: 'bulk' } }],
    ['auto_response_suppress', { headers: { 'X-Auto-Response-Suppress': 'All' } }],
    ['noreply_sender', { from: 'no-reply@empresa.test' }],
    ['noreply_sender', { from: 'MAILER-DAEMON@mx.test' }],
    ['own_address', { from: OWN }],
    ['null_return_path', { headers: { 'Return-Path': '<>' } }],
  ];
  it.each(cases)('ignora (%s) e não cria conversa', async (reason, over) => {
    const org = await setupOrg();
    const out = await ingestRawEmail(await raw({ text: 'x', ...over }), ctxOf(org.id));
    expect(out).toEqual({ status: 'ignored', reason });
    expect(await convCount(org.id)).toBe(0);
  });

  it('Auto-Submitted: no é mensagem humana', async () => {
    const org = await setupOrg();
    const out = await ingestRawEmail(await raw({ text: 'oi', headers: { 'Auto-Submitted': 'no' } }), ctxOf(org.id));
    expect(out.status).toBe('ingested');
  });

  it('bounce multipart/report é ignorado', async () => {
    const org = await setupOrg();
    const dsn = `From: Mail Delivery <postmaster@mx.test>\r\nTo: ${OWN}\r\nSubject: Undelivered\r\nMessage-ID: ${mid('dsn')}\r\nContent-Type: multipart/report; report-type=delivery-status; boundary="b1"\r\n\r\n--b1\r\nContent-Type: text/plain\r\n\r\nFalha na entrega\r\n--b1--\r\n`;
    const out = await ingestRawEmail(Buffer.from(dsn), ctxOf(org.id));
    expect(out.status).toBe('ignored');
    expect(await convCount(org.id)).toBe(0);
  });
});

// ── Ingestão e threading ────────────────────────────────────────────────────

describe('email — ingestão e threading', () => {
  it('cria conversa EMAIL com contato, subject, channelMeta e conta EMAIL_IN', async () => {
    const org = await setupOrg();
    const id = mid();
    const out = await ingestRawEmail(await raw({ text: 'Quero certidão.', subject: 'Re: Certidão', messageId: id, cc: 'x@y.test' }), ctxOf(org.id));
    expect(out.status).toBe('ingested');
    if (out.status !== 'ingested') return;
    expect(out.isNew).toBe(true); expect(out.protocol).toMatch(/^BV-\d{4}-\d{6}$/);
    const conv = await prisma.bvConversation.findUniqueOrThrow({ where: { id: out.conversationId }, include: { contact: true } });
    expect(conv.channel).toBe('EMAIL'); expect(conv.channelRef).toBe(id); expect(conv.subject).toBe('Certidão');
    expect(conv.contact.email).toBe('maria@cidadao.test'); expect(conv.contact.name).toBe('Maria Cidadã');
    const [m] = await listMessages(conv.id);
    expect(m.body).toBe('Quero certidão.'); expect(m.channelMessageId).toBe(id);
    expect(m.channelMeta).toMatchObject({ messageId: id, subject: 'Re: Certidão', cc: ['x@y.test'], to: [OWN], matchedBy: 'new' });
    const r = today();
    expect(await getUsage(org.id, 'EMAIL_IN', r.from, r.to)).toBe(1);
  });

  it('dedupe por Message-ID (reentrega) e anexos salvos no storage com descritor', async () => {
    const org = await setupOrg();
    const buf = await raw({ text: 'segue', attachments: [{ filename: '../../laudo final.pdf', content: Buffer.from('conteudo-do-anexo'), contentType: 'application/pdf' }] });
    const a = await ingestRawEmail(buf, ctxOf(org.id));
    const b = await ingestRawEmail(buf, ctxOf(org.id));
    expect(a.status).toBe('ingested'); expect(b.status).toBe('duplicate');
    expect(await prisma.bvMessage.count({ where: { orgId: org.id } })).toBe(1);
    if (a.status !== 'ingested') return;
    const [m] = await listMessages(a.conversationId);
    const att = (m.attachments as any[])[0];
    expect(att).toMatchObject({ name: 'laudo final.pdf', mime: 'application/pdf', size: 17 });
    expect(att.key.startsWith(`${org.id}/attachments/`)).toBe(true);
    expect((await getObjectBuffer(att.key)).toString()).toBe('conteudo-do-anexo');
    const r = today();
    expect(await getUsage(org.id, 'EMAIL_IN', r.from, r.to)).toBe(1);
  });

  it('anexo acima de 20 MB não é salvo (registrado em channelMeta)', async () => {
    const org = await setupOrg();
    const big = Buffer.alloc(21 * 1024 * 1024, 1);
    const out = await ingestRawEmail(await raw({ text: 'enorme', attachments: [{ filename: 'video.bin', content: big }] }), ctxOf(org.id));
    if (out.status !== 'ingested') throw new Error('esperava ingested');
    const [m] = await listMessages(out.conversationId);
    expect(m.attachments ?? []).toHaveLength(0);
    expect((m.channelMeta as any).skippedAttachments[0]).toMatchObject({ name: 'video.bin', reason: 'too_large' });
  });

  it('thread por In-Reply-To/References e raiz = Message-ID do primeiro e-mail', async () => {
    const org = await setupOrg();
    const root = mid('root');
    const first = await ingestRawEmail(await raw({ text: 'primeira', subject: 'Processo 123', messageId: root }), ctxOf(org.id));
    const second = await ingestRawEmail(await raw({ text: 'segunda', subject: 'assunto totalmente diferente', inReplyTo: root, references: [root] }), ctxOf(org.id));
    if (first.status !== 'ingested' || second.status !== 'ingested') throw new Error('esperava ingested');
    expect(second.conversationId).toBe(first.conversationId); expect(second.isNew).toBe(false); expect(second.matchedBy).toBe('header');
    // só References (sem In-Reply-To), mesmo remetente diferente (colega em cópia)
    const third = await ingestRawEmail(await raw({ from: 'colega@cidadao.test', text: 'terceira', subject: 'Fwd: x', references: [mid('outro'), root] }), ctxOf(org.id));
    if (third.status !== 'ingested') throw new Error('esperava ingested');
    expect(third.conversationId).toBe(first.conversationId);
    expect(await convCount(org.id)).toBe(1);
  });

  it('thread por token de protocolo no assunto (só se o remetente for o contato)', async () => {
    const org = await setupOrg();
    const first = await ingestRawEmail(await raw({ text: 'oi', subject: 'Pedido' }), ctxOf(org.id));
    if (first.status !== 'ingested') throw new Error('x');
    const reply = await ingestRawEmail(await raw({ text: 'complemento', subject: `Re: coisa nova [${first.protocol}]` }), ctxOf(org.id));
    if (reply.status !== 'ingested') throw new Error('x');
    expect(reply.conversationId).toBe(first.conversationId); expect(reply.matchedBy).toBe('protocol');
    // terceiro tentando se enfiar na conversa pelo protocolo (sequencial/adivinhável) → conversa nova
    const intruder = await ingestRawEmail(await raw({ from: 'intruso@mal.test', text: 'x', subject: `Re: [${first.protocol}]` }), ctxOf(org.id));
    if (intruder.status !== 'ingested') throw new Error('x');
    expect(intruder.conversationId).not.toBe(first.conversationId);
  });

  it('thread por remetente + assunto normalizado em conversa aberta', async () => {
    const org = await setupOrg();
    const first = await ingestRawEmail(await raw({ text: 'a', subject: 'Audiência dia 10' }), ctxOf(org.id));
    const again = await ingestRawEmail(await raw({ text: 'b', subject: 'RES: Re: Audiência dia 10' }), ctxOf(org.id));
    const other = await ingestRawEmail(await raw({ text: 'c', subject: 'Outro assunto' }), ctxOf(org.id));
    if (first.status !== 'ingested' || again.status !== 'ingested' || other.status !== 'ingested') throw new Error('x');
    expect(again.conversationId).toBe(first.conversationId); expect(again.matchedBy).toBe('subject');
    expect(other.conversationId).not.toBe(first.conversationId);
  });
});

// ── Poller IMAP ─────────────────────────────────────────────────────────────

describe('email — ImapPoller (UID, uidValidity, falhas)', () => {
  it('ingere, marca como lido, avança lastUid e não repete na coleta seguinte', async () => {
    const org = await setupOrg();
    const box = new FakeBox();
    box.add(await raw({ text: 'um', subject: 'A' })); box.add(await raw({ text: 'dois', subject: 'B' }));
    setImapClientFactory(box.factory());
    const r1 = await imapPoller.pollOrg(org.id, { force: true });
    expect(r1).toMatchObject({ polled: true, ingested: 2, failed: 0 });
    expect(box.msgs.every((m) => m.seen)).toBe(true);
    let mb = await prisma.bvMailbox.findUniqueOrThrow({ where: { orgId_address: { orgId: org.id, address: OWN } } });
    expect(mb.lastUid).toBe(2n); expect(mb.uidValidity).toBe(100n); expect(mb.lastError).toBeNull(); expect(mb.lastPolledAt).not.toBeNull();

    const r2 = await imapPoller.pollOrg(org.id, { force: true });
    expect(r2.fetched).toBe(0);
    box.add(await raw({ text: 'três', subject: 'C' }));
    const r3 = await imapPoller.pollOrg(org.id, { force: true });
    expect(r3).toMatchObject({ fetched: 1, ingested: 1 });
    mb = await prisma.bvMailbox.findUniqueOrThrow({ where: { id: mb.id } });
    expect(mb.lastUid).toBe(3n);
    expect(await convCount(org.id)).toBe(3);
  });

  it('respeita o intervalo configurado (job) mas não quando forçado', async () => {
    const org = await setupOrg({ pollIntervalSec: 600 });
    const box = new FakeBox(); setImapClientFactory(box.factory());
    expect((await imapPoller.pollOrg(org.id)).polled).toBe(true);
    expect(await imapPoller.pollOrg(org.id)).toMatchObject({ polled: false, skipped: 'not_due' });
    expect((await imapPoller.pollOrg(org.id, { force: true })).polled).toBe(true);
  });

  it('primeira sincronização ignora lidas e antigas (>7 dias) e posiciona lastUid no fim', async () => {
    const org = await setupOrg();
    const box = new FakeBox();
    box.add(await raw({ text: 'velha lida', subject: 'v1' }), true);
    box.add(await raw({ text: 'velha não lida', subject: 'v2' }), false, new Date(Date.now() - 30 * 86400_000));
    box.add(await raw({ text: 'recente', subject: 'v3' }), false);
    setImapClientFactory(box.factory());
    const r = await imapPoller.pollOrg(org.id, { force: true });
    expect(r.ingested).toBe(1);
    const mb = await prisma.bvMailbox.findUniqueOrThrow({ where: { orgId_address: { orgId: org.id, address: OWN } } });
    expect(mb.lastUid).toBe(3n);
    expect((await imapPoller.pollOrg(org.id, { force: true })).fetched).toBe(0);
  });

  it('uidValidity mudou: reinicia sem duplicar (dedupe por Message-ID)', async () => {
    const org = await setupOrg();
    const box = new FakeBox();
    const m1 = await raw({ text: 'um', subject: 'A' });
    box.add(m1); setImapClientFactory(box.factory());
    await imapPoller.pollOrg(org.id, { force: true });
    // servidor renumera: mesma mensagem (ainda não lida, p.ex. flag perdida) com novo uidValidity + uma nova
    box.uidValidity = 200n; box.nextUid = 1; box.msgs = [];
    box.add(m1, false); box.add(await raw({ text: 'nova', subject: 'N' }));
    const r = await imapPoller.pollOrg(org.id, { force: true });
    expect(r).toMatchObject({ uidValidityReset: true, ingested: 1, duplicates: 1 });
    expect(await prisma.bvMessage.count({ where: { orgId: org.id } })).toBe(2);
    const mb = await prisma.bvMailbox.findUniqueOrThrow({ where: { orgId_address: { orgId: org.id, address: OWN } } });
    expect(mb.uidValidity).toBe(200n); expect(mb.lastUid).toBe(2n);
  });

  it('falha em uma mensagem não trava as demais; não é marcada como lida e é retentada', async () => {
    const org = await setupOrg();
    const box = new FakeBox();
    const u1 = box.add(await raw({ text: 'ok1', subject: 'ok1' }));
    const u2 = box.add(await raw({ text: 'falha', subject: 'FALHA' }));
    const u3 = box.add(await raw({ text: 'ok3', subject: 'ok3' }));
    setImapClientFactory(box.factory());
    const real = conversations.ingestInbound;
    let failing = true;
    jest.spyOn(conversations, 'ingestInbound').mockImplementation(async (i: any) => { if (failing && i.subject === 'FALHA') throw new Error('banco indisponível'); return real(i); });

    const r1 = await imapPoller.pollOrg(org.id, { force: true });
    expect(r1).toMatchObject({ ingested: 2, failed: 1 });
    expect(box.msgs.find((m) => m.uid === u1)!.seen).toBe(true);
    expect(box.msgs.find((m) => m.uid === u2)!.seen).toBe(false);
    expect(box.msgs.find((m) => m.uid === u3)!.seen).toBe(true);
    let mb = await prisma.bvMailbox.findUniqueOrThrow({ where: { orgId_address: { orgId: org.id, address: OWN } } });
    expect(mb.lastUid).toBe(BigInt(u1)); expect(mb.lastError).toContain('banco indisponível');

    failing = false; // volta a funcionar: o u2 é retentado; u3 é duplicata
    const r2 = await imapPoller.pollOrg(org.id, { force: true });
    expect(r2).toMatchObject({ ingested: 1, duplicates: 1, failed: 0 });
    expect(box.msgs.find((m) => m.uid === u2)!.seen).toBe(true);
    mb = await prisma.bvMailbox.findUniqueOrThrow({ where: { id: mb.id } });
    expect(mb.lastUid).toBe(3n); expect(mb.lastError).toBeNull();
    expect(await convCount(org.id)).toBe(3);
  });

  it('mensagem "venenosa" é abandonada após 3 tentativas', async () => {
    const org = await setupOrg();
    const box = new FakeBox();
    box.add(await raw({ text: 'x', subject: 'VENENO' })); box.add(await raw({ text: 'y', subject: 'depois' }));
    setImapClientFactory(box.factory());
    const real = conversations.ingestInbound;
    jest.spyOn(conversations, 'ingestInbound').mockImplementation(async (i: any) => { if (i.subject === 'VENENO') throw new Error('sempre falha'); return real(i); });
    for (let i = 0; i < 3; i++) await imapPoller.pollOrg(org.id, { force: true });
    const mb = await prisma.bvMailbox.findUniqueOrThrow({ where: { orgId_address: { orgId: org.id, address: OWN } } });
    expect(mb.lastUid).toBe(2n);
    expect(await convCount(org.id)).toBe(1);
  });

  it('erro de conexão grava lastError (sem vazar a senha) e status ERROR', async () => {
    const org = await setupOrg();
    setImapClientFactory({ connect: async () => { throw new Error('Login falhou para senha segredo-imap-123'); } });
    const r = await imapPoller.pollOrg(org.id, { force: true });
    expect(r.error).toContain('Login falhou'); expect(r.error).not.toContain('segredo-imap-123');
    const mb = await prisma.bvMailbox.findUniqueOrThrow({ where: { orgId_address: { orgId: org.id, address: OWN } } });
    expect(mb.lastError).not.toContain('segredo-imap-123');
    expect((await prisma.bvIntegration.findFirstOrThrow({ where: { orgId: org.id, type: 'EMAIL_IMAP' } })).status).toBe('ERROR');
  });

  it('automáticas na caixa são ignoradas (não criam conversa) mas avançam o UID', async () => {
    const org = await setupOrg();
    const box = new FakeBox();
    box.add(await raw({ text: 'fora do escritório', headers: { 'Auto-Submitted': 'auto-replied' } }));
    box.add(await raw({ text: 'humano' }));
    setImapClientFactory(box.factory());
    const r = await imapPoller.pollOrg(org.id, { force: true });
    expect(r).toMatchObject({ ingested: 1, ignored: 1 });
    expect(box.msgs[0].seen).toBe(false);
    expect(await convCount(org.id)).toBe(1);
  });
});

// ── Saída SMTP ──────────────────────────────────────────────────────────────

async function openThread(orgId: string, over: Parameters<typeof raw>[0] = {}) {
  const out = await ingestRawEmail(await raw({ text: 'Preciso de uma certidão.', subject: 'Certidão de objeto e pé', ...over }), ctxOf(orgId));
  if (out.status !== 'ingested') throw new Error('esperava ingested');
  return out;
}

describe('email — saída (SMTP)', () => {
  it('responde com Re: assunto [PROTOCOLO], In-Reply-To/References do thread, HTML seguro e EMAIL_OUT', async () => {
    const org = await setupOrg();
    const rootId = mid('root');
    const first = await openThread(org.id, { messageId: rootId });
    const user = await makeUser(org.id, 'ATENDENTE');
    const res = await sendMessage({ orgId: org.id, conversationId: first.conversationId, senderType: 'AGENT', userId: user.id, body: 'Prezada,\n<script>alert(1)</script> segue & ok.' });
    expect(res.error).toBeUndefined();
    expect(res.message.status).toBe('SENT');
    expect(sent).toHaveLength(1);
    const m = sent[0].mail;
    expect(m.to).toBe('maria@cidadao.test');
    expect(m.from).toEqual({ name: 'Balcão Virtual TJ', address: OWN });
    expect(m.subject).toBe(`Re: Certidão de objeto e pé [${first.protocol}]`);
    expect(m.inReplyTo).toBe(rootId); expect(m.references).toEqual([rootId]);
    expect(m.messageId).toMatch(/^<[0-9a-f-]{36}@tj\.test>$/);
    expect(m.html).not.toContain('<script'); expect(m.html).toContain('&lt;script&gt;'); expect(m.html).toContain('<br>'); expect(m.html).toContain('&amp; ok');
    expect(m.text).toContain('<script>alert(1)</script>');
    expect(m.headers['Auto-Submitted']).toBeUndefined();
    expect(res.message.channelMessageId).toBe(m.messageId);
    const r = today();
    expect(await getUsage(org.id, 'EMAIL_OUT', r.from, r.to)).toBe(1);

    // segunda resposta encadeia com a anterior (último Message-ID do thread)
    await sendMessage({ orgId: org.id, conversationId: first.conversationId, senderType: 'AGENT', userId: user.id, body: 'Complemento.' });
    const m2 = sent[1].mail;
    expect(m2.inReplyTo).toBe(m.messageId); expect(m2.references).toEqual([rootId, m.messageId]);

    // resposta do cidadão ao nosso e-mail cai na mesma conversa (pelo Message-ID gerado), mesmo sem protocolo no assunto
    const back = await ingestRawEmail(await raw({ text: 'obrigada', subject: 'Obrigada', inReplyTo: m2.messageId, references: [rootId, m.messageId, m2.messageId] }), ctxOf(org.id));
    if (back.status !== 'ingested') throw new Error('x');
    expect(back.conversationId).toBe(first.conversationId);
  });

  it('MIME real (nodemailer stream): cabeçalhos de thread, anexo do storage e citação', async () => {
    const org = await setupOrg();
    const rootId = mid('root');
    const first = await openThread(org.id, { messageId: rootId });
    const key = `${org.id}/attachments/2026/01/teste-saida.txt`;
    const { putObject } = await import('../../../core/storage');
    await putObject(key, Buffer.from('conteudo anexo saida'));
    const mimes: Buffer[] = [];
    setMailTransportFactory(() => ({
      async sendMail(msg: any) {
        const t = nodemailer.createTransport({ streamTransport: true, buffer: true });
        const info: any = await t.sendMail(msg); mimes.push(info.message);
        return { messageId: msg.messageId, accepted: [msg.to], rejected: [] };
      },
    }));
    await sendMessage({ orgId: org.id, conversationId: first.conversationId, senderType: 'AGENT', body: 'Segue o documento.', attachments: [{ key, name: 'certidao.txt', mime: 'text/plain', size: 20 }], channelMeta: { quote: true } });
    const parsed = await simpleParser(mimes[0]);
    expect(parsed.subject).toBe(`Re: Certidão de objeto e pé [${first.protocol}]`);
    expect(parsed.inReplyTo).toBe(rootId); expect(parsed.references).toEqual([rootId]);
    expect(parsed.attachments[0].filename).toBe('certidao.txt'); expect(parsed.attachments[0].content.toString()).toBe('conteudo anexo saida');
    expect(parsed.text).toContain('Segue o documento.'); expect(parsed.text).toContain('> Preciso de uma certidão.');
    expect(typeof parsed.html).toBe('string'); expect(String(parsed.html)).toContain('blockquote');
  });

  it('anexo de outro órgão é recusado', async () => {
    const orgA = await setupOrg(); const orgB = await setupOrg();
    const first = await openThread(orgA.id);
    const { putObject } = await import('../../../core/storage');
    const key = `${orgB.id}/attachments/2026/01/segredo.txt`;
    await putObject(key, Buffer.from('dados do outro órgão'));
    const res = await sendMessage({ orgId: orgA.id, conversationId: first.conversationId, senderType: 'AGENT', body: 'x', attachments: [{ key, name: 'segredo.txt', mime: 'text/plain', size: 5 }] });
    expect(res.error).toBe('email.attachment_invalid'); expect(sent).toHaveLength(0);
  });

  it('falha SMTP vira FAILED com código estável (email.smtp_failed) e não conta EMAIL_OUT', async () => {
    const org = await setupOrg();
    const first = await openThread(org.id);
    setMailTransportFactory(() => fakeTransport(sent, { fail: () => Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNECTION' }) }));
    const res = await sendMessage({ orgId: org.id, conversationId: first.conversationId, senderType: 'AGENT', body: 'oi' });
    expect(res.error).toBe('email.smtp_failed'); expect(res.message.status).toBe('FAILED');
    const row = await prisma.bvMessage.findUniqueOrThrow({ where: { id: res.message.id } });
    expect(row.status).toBe('FAILED'); expect(row.errorCode).toBe('email.smtp_failed');
    const r = today();
    expect(await getUsage(org.id, 'EMAIL_OUT', r.from, r.to)).toBe(0);
  });

  it('destinatário recusado → email.invalid_recipient; contato sem e-mail válido também', async () => {
    const org = await setupOrg();
    const first = await openThread(org.id);
    setMailTransportFactory(() => fakeTransport(sent, { fail: () => Object.assign(new Error('550 5.1.1 User unknown'), { code: 'EENVELOPE', responseCode: 550, rejected: ['maria@cidadao.test'] }) }));
    const res = await sendMessage({ orgId: org.id, conversationId: first.conversationId, senderType: 'AGENT', body: 'oi' });
    expect(res.error).toBe('email.invalid_recipient');

    const conv = await prisma.bvConversation.findUniqueOrThrow({ where: { id: first.conversationId } });
    await prisma.bvContact.update({ where: { id: conv.contactId }, data: { email: 'invalido' } });
    setMailTransportFactory(() => fakeTransport(sent));
    const res2 = await sendMessage({ orgId: org.id, conversationId: first.conversationId, senderType: 'AGENT', body: 'oi' });
    expect(res2.error).toBe('email.invalid_recipient'); expect(sent).toHaveLength(0);
  });

  it('sem configuração → email.not_configured', async () => {
    const org = await makeOrg({ ai: { enabled: false } });
    const first = await openThread(org.id);
    const res = await sendMessage({ orgId: org.id, conversationId: first.conversationId, senderType: 'AGENT', body: 'oi' });
    expect(res.error).toBe('email.not_configured');
  });

  it('buildReplySubject / textToSafeHtml', () => {
    expect(buildReplySubject('Re: Re: Pedido [BV-2026-000001]', 'BV-2026-000001')).toBe('Re: Pedido [BV-2026-000001]');
    expect(buildReplySubject(null, 'BV-2026-000002')).toBe('Re: Atendimento [BV-2026-000002]');
    expect(textToSafeHtml('<img src=x onerror=1>')).not.toContain('<img');
  });
});

// ── Resposta automática ─────────────────────────────────────────────────────

describe('email — resposta automática de recebimento', () => {
  it('envia 1 por conversa com o protocolo; nunca para automáticos; não repete em novas mensagens', async () => {
    const org = await setupOrg({ autoReply: { enabled: true, text: 'Recebido! Seu protocolo é {{protocolo}}.' } });
    const first = await ingestRawEmail(await raw({ text: 'oi', subject: 'Dúvida' }), ctxOf(org.id, { autoReply: { enabled: true, text: 'Recebido! Seu protocolo é {{protocolo}}.' } }));
    if (first.status !== 'ingested') throw new Error('x');
    expect(sent).toHaveLength(1);
    expect(sent[0].mail.text).toBe(`Recebido! Seu protocolo é ${first.protocol}.`);
    expect(sent[0].mail.subject).toBe(`Re: Dúvida [${first.protocol}]`);
    expect(sent[0].mail.headers['Auto-Submitted']).toBe('auto-replied');
    expect(sent[0].mail.headers['X-Auto-Response-Suppress']).toBe('All');

    await ingestRawEmail(await raw({ text: 'mais uma', subject: `Re: Dúvida [${first.protocol}]` }), ctxOf(org.id, { autoReply: { enabled: true, text: 'x' } }));
    expect(sent).toHaveLength(1);
    // automático / noreply: nem conversa nem resposta
    await ingestRawEmail(await raw({ from: 'noreply@x.test', text: 'x' }), ctxOf(org.id, { autoReply: { enabled: true, text: 'x' } }));
    await ingestRawEmail(await raw({ text: 'x', headers: { 'Auto-Submitted': 'auto-generated' } }), ctxOf(org.id, { autoReply: { enabled: true, text: 'x' } }));
    expect(sent).toHaveLength(1);
    expect(await convCount(org.id)).toBe(1);
    // a resposta automática fica registrada no histórico da conversa
    const msgs = await listMessages(first.conversationId);
    expect(msgs.filter((m) => m.direction === 'OUT' && m.senderType === 'SYSTEM')).toHaveLength(1);
  });

  it('texto sem {{protocolo}} recebe o protocolo ao final; padrão quando vazio; via poller', async () => {
    const org = await setupOrg({ autoReply: { enabled: true, text: 'Obrigado pelo contato.' } });
    const box = new FakeBox(); box.add(await raw({ text: 'oi', subject: 'Teste' })); setImapClientFactory(box.factory());
    await imapPoller.pollOrg(org.id, { force: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].mail.text).toMatch(/^Obrigado pelo contato\.\n\nProtocolo: BV-\d{4}-\d{6}$/);
  });
});

// ── HTTP: webhook, config, mailboxes, poll ──────────────────────────────────

describe('email — webhook POST /inbound', () => {
  it('segredo certo ingere (message/rfc822 e JSON {raw}); errado/ausente/outro órgão = 401', async () => {
    const org = await setupOrg();
    const otherOrg = await setupOrg({ inboundSecret: 'outro-segredo-0123456789' });
    const buf = await raw({ text: 'via webhook', subject: 'Webhook' });
    const url = `/balcao/email/inbound?org=${org.id}`;

    const ok = await app.inject({ method: 'POST', url, headers: { 'content-type': 'message/rfc822', 'x-inbound-secret': 'segredo-webhook-0123456789' }, payload: buf });
    expect(ok.statusCode).toBe(200); expect(ok.json().status).toBe('ingested');
    const dup = await app.inject({ method: 'POST', url, headers: { 'content-type': 'message/rfc822', 'x-inbound-secret': 'segredo-webhook-0123456789' }, payload: buf });
    expect(dup.json().status).toBe('duplicate');

    const jsonRes = await app.inject({ method: 'POST', url, headers: { 'x-inbound-secret': 'segredo-webhook-0123456789' }, payload: { raw: (await raw({ text: 'via json', subject: 'Json' })).toString() } });
    expect(jsonRes.statusCode).toBe(200); expect(jsonRes.json().status).toBe('ingested');
    const b64 = await app.inject({ method: 'POST', url, headers: { 'x-inbound-secret': 'segredo-webhook-0123456789' }, payload: { raw: (await raw({ text: 'via b64', subject: 'B64' })).toString('base64'), encoding: 'base64' } });
    expect(b64.json().status).toBe('ingested');
    expect(await convCount(org.id)).toBe(3);

    for (const headers of [{ 'x-inbound-secret': 'errado' }, {}, { 'x-inbound-secret': 'outro-segredo-0123456789' }, { 'x-inbound-secret': '' }]) {
      const r = await app.inject({ method: 'POST', url, headers: { 'content-type': 'message/rfc822', ...headers }, payload: await raw({ text: 'x', subject: 'Nao' }) });
      expect(r.statusCode).toBe(401);
    }
    // segredo do órgão A não vale no órgão B
    const cross = await app.inject({ method: 'POST', url: `/balcao/email/inbound?org=${otherOrg.id}`, headers: { 'content-type': 'message/rfc822', 'x-inbound-secret': 'segredo-webhook-0123456789' }, payload: await raw({ text: 'x', subject: 'Cross' }) });
    expect(cross.statusCode).toBe(401);
    expect(await convCount(otherOrg.id)).toBe(0);
    // sem segredo configurado nunca aceita
    const noSecret = await makeOrg(); await saveIntegration(noSecret.id, 'EMAIL_IMAP', baseCfg({ inboundSecret: undefined }));
    expect((await app.inject({ method: 'POST', url: `/balcao/email/inbound?org=${noSecret.id}`, headers: { 'content-type': 'message/rfc822', 'x-inbound-secret': 'qualquer-coisa' }, payload: await raw({ text: 'x' }) })).statusCode).toBe(401);
    // sem org
    expect((await app.inject({ method: 'POST', url: '/balcao/email/inbound', headers: { 'content-type': 'message/rfc822', 'x-inbound-secret': 'segredo-webhook-0123456789' }, payload: buf })).statusCode).toBe(401);
  });

  it('corpo vazio/inválido = 400; e-mail automático = ignored', async () => {
    const org = await setupOrg();
    const h = { 'x-inbound-secret': 'segredo-webhook-0123456789' };
    expect((await app.inject({ method: 'POST', url: `/balcao/email/inbound?org=${org.id}`, headers: h, payload: { foo: 1 } })).statusCode).toBe(400);
    const r = await app.inject({ method: 'POST', url: `/balcao/email/inbound?org=${org.id}`, headers: { ...h, 'content-type': 'message/rfc822' }, payload: await raw({ from: 'noreply@x.test', text: 'x' }) });
    expect(r.json()).toEqual({ status: 'ignored', reason: 'noreply_sender' });
  });

  it('secretsMatch', () => {
    expect(secretsMatch('abc', 'abc')).toBe(true); expect(secretsMatch('abc', 'abd')).toBe(false);
    expect(secretsMatch('', '')).toBe(false); expect(secretsMatch(undefined, 'x')).toBe(false);
  });
});

describe('email — admin (config, teste, mailboxes, poll)', () => {
  it('exige integration:manage; GET mascara segredos; PUT preserva segredo omitido/mascarado e gera segredo do webhook', async () => {
    const org = await makeOrg({ ai: { enabled: false } });
    const admin = await makeUser(org.id, 'ADMIN'); const agent = await makeUser(org.id, 'ATENDENTE');
    expect((await app.inject({ url: '/balcao/email/config' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/balcao/email/config', headers: authHeader(agent) })).statusCode).toBe(403);
    expect((await app.inject({ url: '/balcao/email/config', headers: authHeader(admin) })).json()).toMatchObject({ configured: false, config: null });

    const body = { imap: { host: 'imap.gmail.com', port: 993, secure: true, user: 'balcao@tj.test', pass: 'senha-app-imap' }, smtp: { host: 'smtp.gmail.com', port: 465, secure: true, user: 'balcao@tj.test', pass: 'senha-app-smtp' }, from: { name: 'TJ', address: 'balcao@tj.test' }, generateInboundSecret: true, autoReply: { enabled: true, text: 'ok' } };
    const put = await app.inject({ method: 'PUT', url: '/balcao/email/config', headers: authHeader(admin), payload: body });
    expect(put.statusCode).toBe(200);
    const secret = put.json().inboundSecret as string;
    expect(secret).toHaveLength(48);
    expect(JSON.stringify(put.json().config)).not.toContain('senha-app'); expect(JSON.stringify(put.json().config)).not.toContain(secret);

    const get = await app.inject({ url: '/balcao/email/config', headers: authHeader(admin) });
    expect(get.json().config.imap.pass).toBe('••••••'); expect(get.json().config.smtp.pass).toBe('••••••'); expect(get.json().config.inboundSecret).toBe('••••••');
    expect(get.json().webhook).toMatchObject({ secretConfigured: true });
    expect(get.body).not.toContain('senha-app');

    // reenvio com "••••••" e com campo omitido mantém os segredos salvos
    const body2 = { ...body, generateInboundSecret: undefined, imap: { ...body.imap, pass: '••••••' }, smtp: { host: 'smtp.gmail.com', port: 587, secure: false, user: 'balcao@tj.test' } };
    expect((await app.inject({ method: 'PUT', url: '/balcao/email/config', headers: authHeader(admin), payload: body2 })).statusCode).toBe(200);
    const { loadEmailConfig } = await import('../config');
    const saved = (await loadEmailConfig(org.id))!.config;
    expect(saved.imap.pass).toBe('senha-app-imap'); expect(saved.smtp.pass).toBe('senha-app-smtp'); expect(saved.inboundSecret).toBe(secret); expect(saved.smtp.port).toBe(587);

    // credencial obrigatória ao trocar de usuário sem reenviar senha
    const bad = await app.inject({ method: 'PUT', url: '/balcao/email/config', headers: authHeader(admin), payload: { ...body2, imap: { ...body.imap, user: 'outro@tj.test', pass: undefined } } });
    expect(bad.statusCode).toBe(400); expect(bad.json().error.code).toBe('email.credentials_required');
    // validação
    expect((await app.inject({ method: 'PUT', url: '/balcao/email/config', headers: authHeader(admin), payload: { ...body, from: { name: 'x', address: 'nao-e-email' } } })).statusCode).toBe(400);
    // auditoria + versão sem segredos
    const audit = await prisma.bvAuditLog.findFirst({ where: { orgId: org.id, action: 'config.update' } });
    expect(audit).not.toBeNull(); expect(JSON.stringify(audit)).not.toContain('senha-app');
    // mailbox criada
    const mbs = await app.inject({ url: '/balcao/email/mailboxes', headers: authHeader(admin) });
    expect(mbs.json().items).toHaveLength(1); expect(mbs.json().items[0]).toMatchObject({ address: 'balcao@tj.test', folder: 'INBOX', lastUid: '0', uidValidity: null });
  });

  it('POST /config/test testa IMAP e SMTP separadamente', async () => {
    const org = await setupOrg();
    const admin = await makeUser(org.id, 'ADMIN');
    const box = new FakeBox(); setImapClientFactory(box.factory());
    const ok = await app.inject({ method: 'POST', url: '/balcao/email/config/test', headers: authHeader(admin), payload: {} });
    expect(ok.json()).toEqual({ ok: true, imap: { ok: true }, smtp: { ok: true } });
    setImapClientFactory({ connect: async () => { throw new Error('AUTHENTICATIONFAILED segredo-imap-123'); } });
    setMailTransportFactory(() => ({ sendMail: async () => ({}), verify: async () => { throw new Error('535 Invalid credentials'); } }));
    const bad = (await app.inject({ method: 'POST', url: '/balcao/email/config/test', headers: authHeader(admin), payload: {} })).json();
    expect(bad.ok).toBe(false); expect(bad.imap.ok).toBe(false); expect(bad.imap.error).not.toContain('segredo-imap-123'); expect(bad.smtp).toMatchObject({ ok: false });
    const none = await makeOrg(); const adminNone = await makeUser(none.id, 'ADMIN');
    expect((await app.inject({ method: 'POST', url: '/balcao/email/config/test', headers: authHeader(adminNone), payload: {} })).statusCode).toBe(404);
  });

  it('POST /poll força a coleta; GET /mailboxes mostra estado e isola órgãos', async () => {
    const orgA = await setupOrg(); const orgB = await setupOrg({ from: { name: 'B', address: 'b@tj.test' } });
    const adminA = await makeUser(orgA.id, 'ADMIN'); const adminB = await makeUser(orgB.id, 'ADMIN');
    const box = new FakeBox();
    const shared = await raw({ text: 'mesma mensagem nos dois órgãos', subject: 'Compartilhado', messageId: mid('shared') });
    box.add(shared); setImapClientFactory(box.factory());
    const pa = await app.inject({ method: 'POST', url: '/balcao/email/poll', headers: authHeader(adminA) });
    expect(pa.statusCode).toBe(200); expect(pa.json()).toMatchObject({ polled: true, ingested: 1 });
    expect((await app.inject({ method: 'POST', url: '/balcao/email/poll', headers: authHeader(adminB) })).json()).toMatchObject({ ingested: 1 }); // mesmo Message-ID em outro órgão não é duplicata
    expect(await convCount(orgA.id)).toBe(1); expect(await convCount(orgB.id)).toBe(1);

    const la = (await app.inject({ url: '/balcao/email/mailboxes', headers: authHeader(adminA) })).json().items;
    const lb = (await app.inject({ url: '/balcao/email/mailboxes', headers: authHeader(adminB) })).json().items;
    expect(la.map((x: any) => x.address)).toEqual([OWN]); expect(lb.map((x: any) => x.address)).toEqual(['b@tj.test']);
    expect(la[0].lastPolledAt).not.toBeNull();
    const none = await makeOrg(); const adminNone = await makeUser(none.id, 'ADMIN');
    expect((await app.inject({ method: 'POST', url: '/balcao/email/poll', headers: authHeader(adminNone) })).statusCode).toBe(404);
  });

  it('isolamento: protocolo de outro órgão não casa; threads independentes', async () => {
    const orgA = await setupOrg(); const orgB = await setupOrg();
    const a = await openThread(orgA.id);
    const b = await ingestRawEmail(await raw({ text: 'x', subject: `Re: [${a.protocol}]` }), ctxOf(orgB.id));
    if (b.status !== 'ingested') throw new Error('x');
    expect(b.conversationId).not.toBe(a.conversationId);
    expect(await convCount(orgA.id)).toBe(1);
  });
});

// ── Simulador ───────────────────────────────────────────────────────────────

describe('email — simulador (BV_DEV_SIMULATORS=1)', () => {
  it('rota inexistente sem a variável', async () => {
    const org = await makeOrg(); const admin = await makeUser(org.id, 'ADMIN');
    const r = await app.inject({ method: 'POST', url: '/balcao/email/dev/simulate-inbound', headers: authHeader(admin), payload: { from: 'a@b.test', subject: 's', text: 't' } });
    expect(r.statusCode).toBe(404);
  });

  it('simula e-mail de entrada e a resposta cai na caixa de saída de dev (sem SMTP real)', async () => {
    process.env.BV_DEV_SIMULATORS = '1';
    const devApp = await buildBalcaoTestApp();
    try {
      const org = await makeOrg({ ai: { enabled: false } }); const admin = await makeUser(org.id, 'ADMIN');
      const r = await devApp.inject({ method: 'POST', url: '/balcao/email/dev/simulate-inbound', headers: authHeader(admin), payload: { from: 'cidadao@x.test', name: 'Zé', subject: 'Demo PoC', text: 'Quero atendimento.' } });
      expect(r.statusCode).toBe(200); expect(r.json().status).toBe('ingested');
      const bad = await devApp.inject({ method: 'POST', url: '/balcao/email/dev/simulate-inbound', headers: authHeader(admin), payload: { from: 'nao-email', text: 'x' } });
      expect(bad.statusCode).toBe(400);
      const out = await sendMessage({ orgId: org.id, conversationId: r.json().conversationId, senderType: 'AGENT', body: 'Olá Zé!' });
      expect(out.error).toBeUndefined();
      const box = await devApp.inject({ url: '/balcao/email/dev/outbox', headers: authHeader(admin) });
      expect(box.json().items[0]).toMatchObject({ to: 'cidadao@x.test', subject: `Re: Demo PoC [${r.json().protocol}]` });
      expect(sent).toHaveLength(0);
    } finally { await devApp.close(); delete process.env.BV_DEV_SIMULATORS; }
  });
});
