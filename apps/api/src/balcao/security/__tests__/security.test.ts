import fs from 'fs';
import zlib from 'zlib';
import crypto from 'crypto';
import { PassThrough } from 'stream';

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-12345678901234567890';

import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../lib/prisma';
import { redis } from '../../../services/queue';
import { decryptField, encryptField } from '../../core/crypto';
import { getObjectBuffer, statObject } from '../../core/storage';
import { setIntegrationStatus, getIntegration } from '../../core/integrations';
import { authHeader, buildBalcaoTestApp, makeOrg, makeUser } from '../../core/testing';
import { readTar, TarWriter } from '../tar';
import { keyStatus, rotateFieldKeys } from '../keys';
import { runRetentionForOrg, maskNumber } from '../retention';
import { setDsrMailer } from '../publicDsr';
import { runFullExport } from '../exporter';
import { daysAgo, seedFullOrg, seedSubject } from './fixtures';

let app: FastifyInstance;
beforeAll(async () => { app = await buildBalcaoTestApp(); });
afterAll(async () => { await app.close(); });

const H = (u: { id: string; orgId: string; role: string }) => authHeader(u);

describe('security — tar', () => {
  it('escreve e lê arquivos, nomes longos e acentuados (PAX)', async () => {
    const out = new PassThrough(); const chunks: Buffer[] = []; out.on('data', (c) => chunks.push(c));
    const tar = new TarWriter(out);
    const long = 'files/' + 'org123/'.repeat(10) + 'attachments/2026/11/' + 'a'.repeat(60) + '.pdf';
    const r = await tar.addFile('a.txt', 6, Buffer.from('olá!!'));
    await tar.addFile(long, 3, Buffer.from('abc'));
    await tar.addFile('data/ação.json', 2, Buffer.from('{}'));
    await tar.addFile('curto.bin', 10, Buffer.from('1234'));
    await tar.finish();
    const files = readTar(Buffer.concat(chunks));
    expect(r.sha256).toBe(crypto.createHash('sha256').update('olá!!').digest('hex'));
    expect(files.get('a.txt')!.toString()).toBe('olá!!');
    expect(files.get(long)!.toString()).toBe('abc');
    expect(files.get('data/ação.json')!.toString()).toBe('{}');
    expect(files.get('curto.bin')!.length).toBe(10); // completado com zeros
    expect(Buffer.concat(chunks).length % 512).toBe(0);
  });
  it('é lido pelo tar do sistema', async () => {
    const out = new PassThrough(); const chunks: Buffer[] = []; out.on('data', (c) => chunks.push(c));
    const tar = new TarWriter(out);
    await tar.addFile('x/' + 'd'.repeat(120) + '.txt', 4, Buffer.from('dado'));
    await tar.finish();
    const f = `/tmp/bv-tar-${process.pid}.tar`;
    fs.writeFileSync(f, Buffer.concat(chunks));
    const { execFileSync } = await import('child_process');
    const list = execFileSync('tar', ['-tf', f]).toString();
    fs.rmSync(f);
    expect(list).toContain('d'.repeat(120) + '.txt');
  });
});

describe('security — rotação de chaves de campo', () => {
  const saved = { keys: process.env.BV_FIELD_KEYS, cur: process.env.BV_FIELD_KEY_CURRENT };
  afterEach(() => { process.env.BV_FIELD_KEYS = saved.keys; process.env.BV_FIELD_KEY_CURRENT = saved.cur; if (saved.keys === undefined) delete process.env.BV_FIELD_KEYS; if (saved.cur === undefined) delete process.env.BV_FIELD_KEY_CURRENT; });

  it('cifra com kid A, rotaciona para B, tudo continua legível; idempotente; status por kid', async () => {
    const kA = crypto.randomBytes(32).toString('hex'); const kB = crypto.randomBytes(32).toString('hex');
    process.env.BV_FIELD_KEYS = JSON.stringify({ A: kA, B: kB });
    process.env.BV_FIELD_KEY_CURRENT = 'A';
    const org = await makeOrg();
    const s = await seedSubject(org.id);
    const u = await prisma.bvUser.update({ where: { id: (await makeUser(org.id, 'ADMIN')).id }, data: { totpSecretEnc: encryptField('JBSWY3DPEHPK3PXP') } });
    await (await import('../../core/integrations')).saveIntegration(org.id, 'JIRA', { token: 'segredo-jira' });
    const before = await keyStatus(org.id);
    expect(before.currentKid).toBe('A');
    expect(before.usage.find((x) => x.table === 'BvMessage')!.byKid).toEqual({ A: 3 });

    process.env.BV_FIELD_KEY_CURRENT = 'B';
    const mid = await keyStatus(org.id);
    expect(mid.usage.find((x) => x.table === 'BvContact')!.byKid).toEqual({ A: 1 });

    const r1 = await rotateFieldKeys({ orgId: org.id, batchSize: 2 });
    expect(r1.done).toBe(true);
    expect(r1.tables.find((t) => t.table === 'BvMessage')!.rotated).toBe(3);
    expect(r1.tables.find((t) => t.table === 'BvContact')!.rotated).toBe(1);
    expect(r1.tables.find((t) => t.table === 'BvUser')!.rotated).toBe(1);
    expect(r1.tables.find((t) => t.table === 'BvIntegration')!.rotated).toBe(1);

    const r2 = await rotateFieldKeys({ orgId: org.id });
    expect(r2.rotated).toBe(0); // idempotente

    const after = await keyStatus(org.id);
    for (const x of after.usage) expect(Object.keys(x.byKid).filter((k) => k !== 'B')).toEqual([]);

    // a chave A pode ser aposentada: tudo continua legível só com B
    process.env.BV_FIELD_KEYS = JSON.stringify({ B: kB });
    const msgs = await prisma.bvMessage.findMany({ where: { conversationId: s.conv.id }, orderBy: { createdAt: 'asc' } });
    expect(msgs.map((m) => decryptField(m.body!)).sort()).toEqual(['Meu CPF é 123.456.789-09', 'Recebemos, obrigado.', 'nota interna'].sort());
    expect(decryptField((await prisma.bvContact.findUniqueOrThrow({ where: { id: s.contact.id } })).documentEnc!)).toBe('12345678909');
    expect(decryptField((await prisma.bvUser.findUniqueOrThrow({ where: { id: u.id } })).totpSecretEnc!)).toBe('JBSWY3DPEHPK3PXP');
    expect((await getIntegration(org.id, 'JIRA'))!.config).toEqual({ token: 'segredo-jira' });
  });

  it('maxRows limita o lote e permite retomar', async () => {
    const org = await makeOrg();
    await seedSubject(org.id);
    process.env.BV_FIELD_KEYS = JSON.stringify({ N1: crypto.randomBytes(32).toString('hex') });
    process.env.BV_FIELD_KEY_CURRENT = 'N1';
    const a = await rotateFieldKeys({ orgId: org.id, maxRows: 2 });
    expect(a.rotated).toBe(2); expect(a.done).toBe(false);
    const b = await rotateFieldKeys({ orgId: org.id });
    expect(b.done).toBe(true);
    expect(a.rotated + b.rotated).toBe(4); // 3 mensagens + documento
  });

  it('endpoints: status e rotate exigem security:manage e auditam', async () => {
    const org = await makeOrg();
    const admin = await makeUser(org.id, 'ADMIN'); const sup = await makeUser(org.id, 'SUPERVISOR');
    await seedSubject(org.id);
    expect((await app.inject({ method: 'GET', url: '/balcao/security/keys/status', headers: H(sup) })).statusCode).toBe(403);
    const st = await app.inject({ method: 'GET', url: '/balcao/security/keys/status', headers: H(admin) });
    expect(st.statusCode).toBe(200);
    expect(JSON.stringify(st.json())).not.toMatch(/[0-9a-f]{64}/);
    const rot = await app.inject({ method: 'POST', url: '/balcao/security/keys/rotate', headers: H(admin), payload: {} });
    expect(rot.statusCode).toBe(200);
    expect(await prisma.bvAuditLog.count({ where: { orgId: org.id, action: 'security.keys.rotate' } })).toBe(1);
  });
});

describe('security — retenção', () => {
  it('maskNumber é idempotente', () => { expect(maskNumber('5563999990000')).toBe('***0000'); expect(maskNumber('***0000')).toBe('***0000'); });

  it('dry-run conta; execução apaga só o que passou do prazo; registra BvRetentionRun; idempotente', async () => {
    process.env.BV_AUDIT_MIN_DAYS = '30';
    const org = await makeOrg({ retention: { messagesDays: 100, recordingsDays: 100, auditDays: 10, logsDays: 5 } });
    const old = await seedSubject(org.id, { old: true });
    const fresh = await seedSubject(org.id, { document: '987.654.321-00' });
    await prisma.bvIntegrationLog.createMany({ data: [{ orgId: org.id, type: 'LLM', operation: 'a', ok: true, createdAt: daysAgo(10) }, { orgId: org.id, type: 'LLM', operation: 'b', ok: true }] });
    await prisma.bvAuditLog.createMany({ data: [{ orgId: org.id, action: 'velho', createdAt: daysAgo(40) }, { orgId: org.id, action: 'meio', createdAt: daysAgo(20) }] });

    const dry = await runRetentionForOrg(org.id, { dryRun: true });
    expect(dry.kinds.find((k) => k.kind === 'MESSAGES')!.candidates).toBe(3);
    expect(dry.kinds.find((k) => k.kind === 'LOGS')!.candidates).toBe(1);
    expect(dry.kinds.find((k) => k.kind === 'AUDIT')!.candidates).toBe(1); // mínimo de 30 d prevalece sobre auditDays=10
    expect(await prisma.bvRetentionRun.count({ where: { orgId: org.id } })).toBe(0);
    expect(await statObject(old.key)).not.toBeNull();

    const res = await runRetentionForOrg(org.id, { batchSize: 2 });
    expect(res.kinds.find((k) => k.kind === 'MESSAGES')!.purged).toBe(3);
    expect(res.kinds.find((k) => k.kind === 'RECORDINGS')!.purged).toBe(1);
    expect(res.kinds.find((k) => k.kind === 'LOGS')!.purged).toBe(1);
    expect(res.kinds.find((k) => k.kind === 'AUDIT')!.purged).toBe(1);
    expect(await statObject(old.key)).toBeNull();
    expect(await statObject(old.recKey)).toBeNull();
    expect(await statObject(fresh.key)).not.toBeNull();
    const oldMsgs = await prisma.bvMessage.findMany({ where: { conversationId: old.conv.id } });
    expect(oldMsgs).toHaveLength(3); // linhas ficam (agregados)
    expect(oldMsgs.every((m) => m.body === null && m.attachments === null)).toBe(true);
    const freshMsgs = await prisma.bvMessage.findMany({ where: { conversationId: fresh.conv.id } });
    expect(freshMsgs.every((m) => m.body !== null)).toBe(true);
    const call = await prisma.bvCall.findUniqueOrThrow({ where: { id: old.call.id } });
    expect(call.recordingKey).toBeNull(); expect(call.fromNumber).toBe('***' + old.contact.phone!.slice(-4));
    expect(await prisma.bvAuditLog.count({ where: { orgId: org.id, action: 'velho' } })).toBe(0);
    expect(await prisma.bvAuditLog.count({ where: { orgId: org.id, action: 'meio' } })).toBe(1);
    expect(await prisma.bvRetentionRun.count({ where: { orgId: org.id, kind: 'MESSAGES' } })).toBe(1);
    expect(await prisma.bvAuditLog.count({ where: { orgId: org.id, action: 'retention.messages' } })).toBe(1);

    const again = await runRetentionForOrg(org.id);
    expect(again.kinds.every((k) => k.purged === 0)).toBe(true);
    delete process.env.BV_AUDIT_MIN_DAYS;
  });

  it('lotes pequenos são retomáveis (maxBatches) e guarda legal suspende', async () => {
    const org = await makeOrg({ retention: { messagesDays: 100, recordingsDays: 100, auditDays: 1825, logsDays: 5 } });
    await seedSubject(org.id, { old: true }); await seedSubject(org.id, { old: true, document: '111.222.333-96' });
    const a = await runRetentionForOrg(org.id, { batchSize: 2, maxBatches: 1 });
    expect(a.kinds.find((k) => k.kind === 'MESSAGES')!.purged).toBe(2);
    expect(a.kinds.find((k) => k.kind === 'MESSAGES')!.more).toBe(true);
    await prisma.bvOrg.update({ where: { id: org.id }, data: { settings: { retention: { messagesDays: 100, recordingsDays: 100, auditDays: 1825, logsDays: 5 }, security: { legalHold: { active: true, basis: 'Processo 0001/2026' } } } } });
    (await import('../../core/settings')).invalidateOrgSettings(org.id);
    const held = await runRetentionForOrg(org.id);
    expect(held.legalHold).toBe(true);
    expect(held.kinds.find((k) => k.kind === 'MESSAGES')!.skipped).toMatch(/guarda legal/);
    expect(await prisma.bvMessage.count({ where: { orgId: org.id, body: { not: null } } })).toBe(4);
  });

  it('endpoint manual: dryRun=1 e permissão', async () => {
    const org = await makeOrg({ retention: { messagesDays: 100, recordingsDays: 100, auditDays: 1825, logsDays: 5 } });
    const admin = await makeUser(org.id, 'ADMIN'); const sup = await makeUser(org.id, 'SUPERVISOR');
    await seedSubject(org.id, { old: true });
    expect((await app.inject({ method: 'POST', url: '/balcao/security/retention/run', headers: H(sup) })).statusCode).toBe(403);
    const r = await app.inject({ method: 'POST', url: '/balcao/security/retention/run?dryRun=1', headers: H(admin) });
    expect(r.statusCode).toBe(200);
    expect(r.json().dryRun).toBe(true);
    expect(r.json().kinds.find((k: any) => k.kind === 'MESSAGES').candidates).toBe(3);
    expect(await prisma.bvMessage.count({ where: { orgId: org.id, body: { not: null } } })).toBe(3);
  });
});

describe('security — LGPD (DSR)', () => {
  async function setup() {
    const org = await makeOrg();
    const sup = await makeUser(org.id, 'SUPERVISOR'); const atend = await makeUser(org.id, 'ATENDENTE');
    const s = await seedSubject(org.id);
    return { org, sup, atend, s };
  }
  const open = (h: any, contactId: string, type: string, extra: object = {}) => app.inject({ method: 'POST', url: '/balcao/security/dsr', headers: h, payload: { contactId, type, ...extra } });

  it('perm: atendente não acessa; supervisor (contact:lgpd) sim; isolamento entre órgãos', async () => {
    const { atend, sup, s } = await setup();
    expect((await open(H(atend), s.contact.id, 'EXPORT')).statusCode).toBe(403);
    const other = await makeOrg(); const otherAdmin = await makeUser(other.id, 'ADMIN');
    expect((await open(H(otherAdmin), s.contact.id, 'EXPORT')).statusCode).toBe(404);
    expect((await open(H(sup), s.contact.id, 'EXPORT')).statusCode).toBe(201);
  });

  it('exportação: JSON com dados decifrados, sha256, download autenticado e auditado; idempotente', async () => {
    const { org, sup, s } = await setup();
    const id = (await open(H(sup), s.contact.id, 'EXPORT')).json().id;
    // abrir de novo devolve a mesma solicitação
    expect((await open(H(sup), s.contact.id, 'EXPORT')).json().id).toBe(id);
    const p = await app.inject({ method: 'POST', url: `/balcao/security/dsr/${id}/process`, headers: H(sup), payload: {} });
    expect(p.statusCode).toBe(200);
    expect(p.json().status).toBe('DONE');
    const rep = p.json().report;
    const dl = await app.inject({ method: 'GET', url: `/balcao/security/dsr/${id}/export`, headers: H(sup) });
    expect(dl.statusCode).toBe(200);
    expect(crypto.createHash('sha256').update(dl.rawPayload).digest('hex')).toBe(rep.sha256);
    expect(dl.headers['x-content-sha256']).toBe(rep.sha256);
    const data = dl.json();
    expect(data.contact.document).toBe('12345678909');
    expect(data.contact.email).toBe(s.email);
    expect(data.identities).toHaveLength(2);
    const msgs = data.conversations[0].messages;
    expect(msgs.map((m: any) => m.body)).toEqual(['Meu CPF é 123.456.789-09', 'Recebemos, obrigado.']); // sem nota interna
    expect(data.calls).toHaveLength(1); expect(data.tasks).toHaveLength(1);
    // sem token → 401; outro órgão → 404
    expect((await app.inject({ method: 'GET', url: `/balcao/security/dsr/${id}/export` })).statusCode).toBe(401);
    const other = await makeOrg(); const oa = await makeUser(other.id, 'ADMIN');
    expect((await app.inject({ method: 'GET', url: `/balcao/security/dsr/${id}/export`, headers: H(oa) })).statusCode).toBe(404);
    // idempotente
    const again = await app.inject({ method: 'POST', url: `/balcao/security/dsr/${id}/process`, headers: H(sup), payload: {} });
    expect(again.json().alreadyDone).toBe(true);
    expect(await prisma.bvExportJob.count({ where: { orgId: org.id, type: 'DSAR' } })).toBe(1);
    expect(await prisma.bvAuditLog.count({ where: { orgId: org.id, action: 'dsr.export.download' } })).toBe(1);
  });

  it('anonimização: apaga PII, remove arquivos, mantém métricas; idempotente; remove export anterior', async () => {
    const { org, sup, s } = await setup();
    const exId = (await open(H(sup), s.contact.id, 'EXPORT')).json().id;
    await app.inject({ method: 'POST', url: `/balcao/security/dsr/${exId}/process`, headers: H(sup), payload: {} });
    const exJob = await prisma.bvExportJob.findFirstOrThrow({ where: { orgId: org.id, type: 'DSAR' } });

    const id = (await open(H(sup), s.contact.id, 'ANONYMIZE')).json().id;
    const r = await app.inject({ method: 'POST', url: `/balcao/security/dsr/${id}/process`, headers: H(sup), payload: {} });
    expect(r.statusCode).toBe(200);
    const rep = r.json().report;
    expect(rep.contacts).toBe(1); expect(rep.messagesRedacted).toBe(1); expect(rep.attachmentsRemoved).toBe(1); expect(rep.recordingsRemoved).toBe(1); expect(rep.dsrExportsRemoved).toBe(1);

    const c = await prisma.bvContact.findUniqueOrThrow({ where: { id: s.contact.id } });
    expect([c.name, c.email, c.phone, c.documentEnc, c.documentHash, c.govbrSub]).toEqual([null, null, null, null, null, null]);
    expect(c.anonymizedAt).not.toBeNull();
    expect(await prisma.bvContactIdentity.count({ where: { contactId: s.contact.id } })).toBe(0);
    expect(await statObject(s.key)).toBeNull(); expect(await statObject(s.recKey)).toBeNull();
    expect(await statObject(exJob.fileKey!)).toBeNull();
    const msgs = await prisma.bvMessage.findMany({ where: { conversationId: s.conv.id }, orderBy: { createdAt: 'asc' } });
    expect(msgs).toHaveLength(3);
    const inbound = msgs.find((m) => m.direction === 'IN')!;
    expect(decryptField(inbound.body!)).toMatch(/removido a pedido do titular/);
    expect(inbound.attachments).toBeNull();
    expect(decryptField(msgs.find((m) => m.direction === 'OUT')!.body!)).toBe('Recebemos, obrigado.');
    const conv = await prisma.bvConversation.findUniqueOrThrow({ where: { id: s.conv.id } });
    expect([conv.subject, conv.csatComment, conv.channelRef]).toEqual([null, null, null]);
    const call = await prisma.bvCall.findUniqueOrThrow({ where: { id: s.call.id } });
    expect(call.recordingKey).toBeNull(); expect(call.durationSec).toBe(60);
    expect((await prisma.bvTask.findUniqueOrThrow({ where: { id: s.task.id } })).contactId).toBeNull();
    expect(await prisma.bvAuditLog.count({ where: { orgId: org.id, action: 'dsr.anonymize' } })).toBe(1);

    // idempotente: segunda chamada devolve o mesmo relatório; nova solicitação não faz nada
    expect((await app.inject({ method: 'POST', url: `/balcao/security/dsr/${id}/process`, headers: H(sup), payload: {} })).json().alreadyDone).toBe(true);
    const id2 = (await open(H(sup), s.contact.id, 'ANONYMIZE')).json().id;
    const r2 = await app.inject({ method: 'POST', url: `/balcao/security/dsr/${id2}/process`, headers: H(sup), payload: {} });
    expect(r2.json().report.alreadyDone).toBe(true);
    expect(r2.json().report.contacts).toBe(0);
  });

  it('exclusão: exige justificativa; remove tudo; guarda legal recusa e registra', async () => {
    const { org, sup, s } = await setup();
    const id = (await open(H(sup), s.contact.id, 'DELETE')).json().id;
    const no = await app.inject({ method: 'POST', url: `/balcao/security/dsr/${id}/process`, headers: H(sup), payload: {} });
    expect(no.statusCode).toBe(400); expect(no.json().error.code).toBe('dsr.justification_required');
    expect(await prisma.bvContact.count({ where: { id: s.contact.id } })).toBe(1);

    // guarda legal
    await prisma.bvOrg.update({ where: { id: org.id }, data: { settings: { security: { legalHold: { active: true, basis: 'Ação civil pública 123' } } } } });
    (await import('../../core/settings')).invalidateOrgSettings(org.id);
    const held = await app.inject({ method: 'POST', url: `/balcao/security/dsr/${id}/process`, headers: H(sup), payload: { justification: 'Pedido do titular, art. 18, VI' } });
    expect(held.statusCode).toBe(200);
    expect(held.json().status).toBe('REJECTED');
    expect(held.json().rejectedReason).toMatch(/Guarda legal/);
    expect(await prisma.bvContact.count({ where: { id: s.contact.id } })).toBe(1);
    expect(await prisma.bvAuditLog.count({ where: { orgId: org.id, action: 'dsr.rejected_legal_hold' } })).toBe(1);

    // sem guarda: nova solicitação executa
    await prisma.bvOrg.update({ where: { id: org.id }, data: { settings: {} } });
    (await import('../../core/settings')).invalidateOrgSettings(org.id);
    const id2 = (await open(H(sup), s.contact.id, 'DELETE', { justification: 'Titular pediu; sem base legal de guarda' })).json().id;
    const ok = await app.inject({ method: 'POST', url: `/balcao/security/dsr/${id2}/process`, headers: H(sup), payload: {} });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().report.conversationsDeleted).toBe(1);
    expect(await prisma.bvContact.count({ where: { id: s.contact.id } })).toBe(0);
    expect(await prisma.bvConversation.count({ where: { orgId: org.id } })).toBe(0);
    expect(await prisma.bvMessage.count({ where: { orgId: org.id } })).toBe(0);
    expect(await prisma.bvCall.count({ where: { orgId: org.id } })).toBe(0);
    expect(await statObject(s.key)).toBeNull();
    expect((await prisma.bvTask.findUniqueOrThrow({ where: { id: s.task.id } })).conversationId).toBeNull();
    expect((await app.inject({ method: 'POST', url: `/balcao/security/dsr/${id2}/process`, headers: H(sup), payload: {} })).json().alreadyDone).toBe(true);
  });

  it('endpoint público: verificação por e-mail com token de uso único e rate limit', async () => {
    const org = await makeOrg();
    await makeUser(org.id, 'ADMIN');
    const s = await seedSubject(org.id);
    const sent: Array<{ to: string; text: string }> = [];
    setDsrMailer(async (to, _subject, text) => { sent.push({ to, text }); });
    const post = (payload: object, ip = '10.0.0.1') => app.inject({ method: 'POST', url: '/balcao/security/public/dsr', payload, remoteAddress: ip });

    const r = await post({ org: org.slug, email: s.email, type: 'EXPORT' });
    expect(r.statusCode).toBe(202);
    expect(sent).toHaveLength(1);
    const token = /token=([A-Za-z0-9_-]+)/.exec(sent[0].text)![1];
    expect(await prisma.bvDataSubjectRequest.count({ where: { orgId: org.id } })).toBe(0); // nada antes de confirmar

    // GET não consome o token
    const page = await app.inject({ method: 'GET', url: `/balcao/security/public/dsr/confirm?token=${token}` });
    expect(page.statusCode).toBe(200); expect(page.body).toContain('Confirmar');
    expect((await app.inject({ method: 'GET', url: '/balcao/security/public/dsr/confirm?token=<script>' })).statusCode).toBe(400);

    const v = await app.inject({ method: 'POST', url: '/balcao/security/public/dsr/verify', payload: { token } });
    expect(v.statusCode).toBe(200); expect(v.json().status).toBe('CONFIRMED');
    const reqRow = await prisma.bvDataSubjectRequest.findUniqueOrThrow({ where: { id: v.json().requestId } });
    expect(reqRow.status).toBe('OPEN'); expect(reqRow.contactId).toBe(s.contact.id);
    expect(await prisma.bvNotification.count({ where: { orgId: org.id, type: 'dsr.requested' } })).toBe(1);
    // uso único
    expect((await app.inject({ method: 'POST', url: '/balcao/security/public/dsr/verify', payload: { token } })).statusCode).toBe(400);

    // e-mail/órgão desconhecidos: mesma resposta, sem envio
    const n = sent.length;
    expect((await post({ org: org.slug, email: 'ninguem@exemplo.com', type: 'ACCESS' }, '10.0.0.2')).statusCode).toBe(202);
    expect((await post({ org: 'nao-existe-x', email: 'a@exemplo.com', type: 'ACCESS' }, '10.0.0.3')).json()).toEqual(r.json());
    expect(sent.length).toBe(n + 1); // só o órgão existente envia
    const v2 = await app.inject({ method: 'POST', url: '/balcao/security/public/dsr/verify', payload: { token: (/token=([A-Za-z0-9_-]+)/.exec(sent[n].text)![1]) } });
    expect(v2.json().status).toBe('NO_DATA');

    // rate limit por e-mail (3/h)
    const mail = `rl-${crypto.randomBytes(3).toString('hex')}@exemplo.com`;
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await post({ org: org.slug, email: mail, type: 'ACCESS' }, '10.0.1.' + i)).statusCode);
    expect(codes).toEqual([202, 202, 202, 429, 429]);
    await redis.del(`bv:sec:rl:dsr:mail:${crypto.createHash('sha256').update(mail).digest('hex')}`);
  });
});

describe('security — exportação integral', () => {
  async function readExport(jobId: string) {
    const job = await prisma.bvExportJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe('DONE');
    const gz = await getObjectBuffer(job.fileKey!);
    expect(crypto.createHash('sha256').update(gz).digest('hex')).toBe(job.sha256);
    const files = readTar(zlib.gunzipSync(gz));
    return { job, files, manifest: JSON.parse(files.get('manifest.json')!.toString()) };
  }
  const mkJob = (orgId: string, format: string, params: object = {}) => prisma.bvExportJob.create({ data: { orgId, type: 'FULL_EXPORT', format, params: params as any } });

  it('JSON: manifest confere sha256/linhas, mensagens decifradas, sem segredos, arquivos copiados', async () => {
    const o = await seedFullOrg();
    const job = await mkJob(o.orgId, 'JSON');
    expect((await runFullExport(job.id))!.status).toBe('DONE');
    const { files, manifest, job: done } = await readExport(job.id);
    expect(done.params).toMatchObject({ progress: { percent: 100 } });

    for (const f of manifest.files) {
      const content = files.get(f.path)!;
      expect(content).toBeDefined();
      expect(content.length).toBe(f.bytes);
      expect(crypto.createHash('sha256').update(content).digest('hex')).toBe(f.sha256);
      if (f.kind === 'data') expect(JSON.parse(content.toString()).length).toBe(f.rows);
    }
    const rows = (n: string) => JSON.parse(files.get(`data/${n}.json`)!.toString());
    expect(rows('messages')).toHaveLength(3);
    expect(rows('messages').map((m: any) => m.body).sort()).toEqual(['Meu CPF é 123.456.789-09', 'Recebemos, obrigado.', 'nota interna'].sort());
    expect(rows('ivr_flows')).toHaveLength(2); // todas as versões
    expect(rows('kb_articles')).toHaveLength(1); expect(rows('kb_article_versions')).toHaveLength(1); expect(rows('kb_suggestions')).toHaveLength(1);
    expect(rows('contacts')).toHaveLength(2);
    expect(rows('contacts').every((c: any) => c.document === null)).toBe(true); // sem flag
    expect(rows('tasks')).toHaveLength(1); expect(rows('task_comments')).toHaveLength(1);
    expect(rows('queue_members')).toHaveLength(1); expect(rows('users')).toHaveLength(1);
    // sem segredos
    const all = [...files.entries()].filter(([k]) => k.startsWith('data/')).map(([, v]) => v.toString()).join('\n');
    for (const secret of ['SEGREDO-HASH', 'SEGREDO-TOTP', 'SEGREDO-TOKEN', 'SEGREDO-APP', 'SEGREDO-NESTED', 'passwordHash', 'configEnc']) expect(all).not.toContain(secret);
    expect(rows('integrations')[0].config).toMatchObject({ phoneNumberId: '123', apiBase: 'https://graph.example/v1', accessToken: '[removido]' });
    // anexos e gravações copiados
    expect(files.get(`files/${o.key}`)!.toString()).toBe('%PDF-1.4 conteúdo sensível');
    expect(files.get(`files/${o.recKey}`)!.toString()).toBe('RIFFfake-audio');
    expect(manifest.totals.copiedFiles).toBe(2);
    expect(manifest.includeDocuments).toBe(false);
    // temp limpo
    expect(fs.existsSync(`${(await import('../../core/storage')).storageRoot()}/${o.orgId}/tmp/export-${job.id}`)).toBe(false);
  });

  it('documentos só com a flag explícita', async () => {
    const o = await seedFullOrg();
    const job = await mkJob(o.orgId, 'JSON', { includeDocuments: true, includeFiles: false });
    await runFullExport(job.id);
    const { files, manifest } = await readExport(job.id);
    const contacts = JSON.parse(files.get('data/contacts.json')!.toString());
    expect(contacts.map((c: any) => c.document).sort()).toEqual(['12345678909', null]);
    expect(manifest.totals.copiedFiles).toBe(0);
    expect([...files.keys()].some((k) => k.startsWith('files/'))).toBe(false);
  });

  it('CSV e XML: escape correto, contagem de linhas', async () => {
    const o = await seedFullOrg();
    for (const format of ['CSV', 'XML']) {
      const job = await mkJob(o.orgId, format, { includeFiles: false });
      await runFullExport(job.id);
      const { files, manifest } = await readExport(job.id);
      const m = manifest.files.find((f: any) => f.entity === 'messages');
      expect(m.rows).toBe(3);
      const txt = files.get(`data/messages.${format.toLowerCase()}`)!.toString();
      if (format === 'CSV') { expect(txt.split('\r\n').filter(Boolean)).toHaveLength(4); expect(txt).toContain('Meu CPF é 123.456.789-09'); }
      else { expect((txt.match(/<row>/g) ?? []).length).toBe(3); expect(txt).toContain('<body>Meu CPF é 123.456.789-09</body>'); expect(txt).toContain('nil="true"'); }
      if (format === 'CSV') {
        const ivr = files.get('data/ivr_flows.csv')!.toString();
        expect(ivr).toContain('""text"":""Olá\\n\\""mundo\\""; \\\\ barra""'); // JSON dentro de CSV, aspas dobradas
      } else {
        const sectors = files.get('data/sectors.xml')!.toString();
        expect(sectors).toContain("Setor 'Cível'");
      }
    }
  });

  it('SQL: INSERTs válidos por tabela, com escape, executam no Postgres', async () => {
    const o = await seedFullOrg();
    const job = await mkJob(o.orgId, 'SQL', { includeFiles: false });
    await runFullExport(job.id);
    const { files, manifest } = await readExport(job.id);
    const schema = 'bvexp_' + crypto.randomBytes(4).toString('hex');
    const tables = ['BvSector', 'BvIvrFlow', 'BvKbArticle', 'BvMessage', 'BvQueue'];
    const entityOf: Record<string, string> = { BvSector: 'sectors', BvIvrFlow: 'ivr_flows', BvKbArticle: 'kb_articles', BvMessage: 'messages', BvQueue: 'queues' };
    await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    try {
      for (const t of tables) await prisma.$executeRawUnsafe(`CREATE TABLE "${schema}"."${t}" (LIKE public."${t}" INCLUDING DEFAULTS)`);
      for (const t of tables) {
        const sql = files.get(`data/${entityOf[t]}.sql`)!.toString();
        const stmts = sql.split('\n').filter((l) => l.startsWith('INSERT'));
        expect(stmts.length).toBe(manifest.files.find((f: any) => f.entity === entityOf[t]).rows);
        await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
          for (const s of stmts) await tx.$executeRawUnsafe(s);
        });
      }
      const flow = await prisma.$queryRawUnsafe<any[]>(`SELECT definition FROM "${schema}"."BvIvrFlow" WHERE version = 2`);
      expect(flow[0].definition.nodes.b.prompt.text).toBe('Olá\n"mundo"; \\ barra');
      const sec = await prisma.$queryRawUnsafe<any[]>(`SELECT name FROM "${schema}"."BvSector"`);
      expect(sec[0].name).toBe("Setor 'Cível'");
      const art = await prisma.$queryRawUnsafe<any[]>(`SELECT tags FROM "${schema}"."BvKbArticle"`);
      expect(art[0].tags).toEqual(['a', "b'c"]);
      const msgs = await prisma.$queryRawUnsafe<any[]>(`SELECT body FROM "${schema}"."BvMessage" ORDER BY "createdAt"`);
      expect(msgs.map((m) => m.body)).toContain('Meu CPF é 123.456.789-09');
    } finally { await prisma.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); }
  });

  it('API: POST /export exige security+org:manage, acompanha progresso e baixa com Range (auditado)', async () => {
    const o = await seedFullOrg();
    const admin = await makeUser(o.orgId, 'ADMIN'); const sup = await makeUser(o.orgId, 'SUPERVISOR');
    expect((await app.inject({ method: 'POST', url: '/balcao/security/export', headers: H(sup), payload: { format: 'JSON' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/balcao/security/export', headers: H(admin), payload: { format: 'PDF' } })).statusCode).toBe(400);
    const r = await app.inject({ method: 'POST', url: '/balcao/security/export', headers: H(admin), payload: { format: 'JSON', includeDocuments: true } });
    expect(r.statusCode).toBe(202);
    const id = r.json().id;
    let st: any;
    for (let i = 0; i < 100; i++) { st = (await app.inject({ method: 'GET', url: `/balcao/security/exports/${id}`, headers: H(admin) })).json(); if (['DONE', 'FAILED'].includes(st.status)) break; await new Promise((x) => setTimeout(x, 100)); }
    expect(st.status).toBe('DONE'); expect(st.downloadable).toBe(true); expect(st.includeDocuments).toBe(true);
    expect((await app.inject({ method: 'GET', url: `/balcao/security/exports/${id}/download`, headers: H(sup) })).statusCode).toBe(403);
    const full = await app.inject({ method: 'GET', url: `/balcao/security/exports/${id}/download`, headers: H(admin) });
    expect(full.statusCode).toBe(200);
    expect(crypto.createHash('sha256').update(full.rawPayload).digest('hex')).toBe(st.sha256);
    expect(zlib.gunzipSync(full.rawPayload).length).toBeGreaterThan(1000);
    const part = await app.inject({ method: 'GET', url: `/balcao/security/exports/${id}/download`, headers: { ...H(admin), range: 'bytes=0-9' } });
    expect(part.statusCode).toBe(206);
    expect(part.rawPayload.equals(full.rawPayload.subarray(0, 10))).toBe(true);
    expect(part.headers['content-range']).toBe(`bytes 0-9/${full.rawPayload.length}`);
    expect(await prisma.bvAuditLog.count({ where: { orgId: o.orgId, action: 'security.export.download' } })).toBeGreaterThanOrEqual(1);
    expect(await prisma.bvAuditLog.count({ where: { orgId: o.orgId, action: 'security.export.documents' } })).toBe(1);
    // outro órgão não enxerga
    const other = await makeOrg(); const oa = await makeUser(other.id, 'ADMIN');
    expect((await app.inject({ method: 'GET', url: `/balcao/security/exports/${id}`, headers: H(oa) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/balcao/security/exports/${id}/download`, headers: H(oa) })).statusCode).toBe(404);
  });
});

describe('security — postura e incidentes', () => {
  it('posture: checagens objetivas, backup lido do arquivo de status, sem segredos', async () => {
    const org = await makeOrg({ security: { requireMfaRoles: ['ADMIN'] } });
    const admin = await makeUser(org.id, 'ADMIN'); await makeUser(org.id, 'ATENDENTE');
    await prisma.bvUser.update({ where: { id: admin.id }, data: { totpEnabled: true } });
    const f = `/tmp/bv-backup-status-${process.pid}.json`;
    fs.writeFileSync(f, JSON.stringify({ lastBackupAt: new Date().toISOString(), lastBackupOk: true, encrypted: true, lastRestoreTestAt: new Date().toISOString(), lastRestoreTestOk: true, rtoSeconds: 42 }));
    process.env.BV_BACKUP_STATUS_FILE = f;
    const sup = await makeUser(org.id, 'SUPERVISOR');
    expect((await app.inject({ method: 'GET', url: '/balcao/security/posture', headers: H(await makeUser(org.id, 'ATENDENTE')) })).statusCode).toBe(403);
    const r = await app.inject({ method: 'GET', url: '/balcao/security/posture', headers: { ...H(sup), 'x-forwarded-proto': 'https' } });
    delete process.env.BV_BACKUP_STATUS_FILE; fs.rmSync(f);
    expect(r.statusCode).toBe(200);
    const body = r.json();
    const by = (id: string) => body.checks.find((c: any) => c.id === id);
    expect(by('crypto.encryption_key').status).toBe('OK');
    expect(by('mfa.required_roles').status).toBe('FAIL'); // SUPERVISOR não exigido
    expect(by('mfa.required_roles').remediation).toBeTruthy();
    expect(by('backup.last').status).toBe('OK');
    expect(by('backup.restore_test').detail).toContain('RTO medido 42');
    expect(by('tls.proxy').status).toBe('OK');
    expect(by('audit.append_only').status).toBe('OK');
    expect(by('retention.last_run').status).toBe('WARN');
    expect(JSON.stringify(body)).not.toContain(process.env.ENCRYPTION_KEY!);
    expect(typeof body.score).toBe('number');
  });

  it('incidentes: registro com prazo de 24 h, lembrete, comunicação, histórico e auditoria', async () => {
    const org = await makeOrg();
    const admin = await makeUser(org.id, 'ADMIN'); const sup = await makeUser(org.id, 'SUPERVISOR');
    const aware = new Date(Date.now() - 20 * 3600_000).toISOString();
    expect((await app.inject({ method: 'POST', url: '/balcao/security/incidents', headers: H(sup), payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/balcao/security/incidents', headers: H(admin), payload: { title: 'x' } })).statusCode).toBe(400);
    const c = await app.inject({ method: 'POST', url: '/balcao/security/incidents', headers: H(admin), payload: { title: 'Acesso indevido a anexos', description: 'Credencial vazada usada para baixar anexos', dataAffected: ['anexos', 'nomes'], affectedSubjects: 12, severity: 'HIGH', awareAt: aware } });
    expect(c.statusCode).toBe(201);
    const inc = c.json();
    expect(Date.parse(inc.deadlineAt) - Date.parse(inc.awareAt)).toBe(24 * 3600_000);
    expect(inc.notifiedAt).toBeNull();
    expect(await prisma.bvNotification.count({ where: { orgId: org.id, userId: admin.id, type: 'security.incident' } })).toBe(1);

    const p1 = (await app.inject({ method: 'GET', url: '/balcao/security/posture', headers: H(admin) })).json();
    expect(p1.checks.find((x: any) => x.id === 'incident.deadline').status).toBe('WARN');

    const { remindIncidents } = await import('../incidents');
    expect(await remindIncidents()).toBe(1); // faltam 4 h (< 6 h)
    expect(await remindIncidents()).toBe(0); // no máximo 1 por hora
    expect(await prisma.bvNotification.count({ where: { orgId: org.id, type: 'security.incident.reminder' } })).toBe(1);

    const n = await app.inject({ method: 'PATCH', url: `/balcao/security/incidents/${inc.id}`, headers: H(admin), payload: { notifiedAt: new Date().toISOString(), notifiedTo: 'dpo@tjto.jus.br', status: 'CONTAINED' } });
    expect(n.statusCode).toBe(200); expect(n.json().notifiedTo).toBe('dpo@tjto.jus.br');
    const got = (await app.inject({ method: 'GET', url: `/balcao/security/incidents/${inc.id}`, headers: H(sup) })).json();
    expect(got.history.length).toBeGreaterThanOrEqual(3);
    expect(got.incident.status).toBe('CONTAINED');
    expect(await remindIncidents()).toBe(0);
    expect((await app.inject({ method: 'GET', url: '/balcao/security/incidents', headers: H(admin) })).json().items).toHaveLength(1);
    expect(await prisma.bvAuditLog.count({ where: { orgId: org.id, action: { in: ['security.incident.open', 'security.incident.notified'] } } })).toBe(2);
    const other = await makeOrg(); const oa = await makeUser(other.id, 'ADMIN');
    expect((await app.inject({ method: 'GET', url: `/balcao/security/incidents/${inc.id}`, headers: H(oa) })).statusCode).toBe(404);
    // vencido
    const late = (await app.inject({ method: 'POST', url: '/balcao/security/incidents', headers: H(admin), payload: { title: 'Outro incidente', description: 'Descrição suficiente aqui', awareAt: new Date(Date.now() - 30 * 3600_000).toISOString() } })).json();
    const p2 = (await app.inject({ method: 'GET', url: '/balcao/security/posture', headers: H(admin) })).json();
    expect(p2.checks.find((x: any) => x.id === 'incident.deadline').status).toBe('FAIL');
    expect(late.id).toBeTruthy();
  });

  it('legal hold: PUT exige base, é versionado e auditado', async () => {
    const org = await makeOrg();
    const admin = await makeUser(org.id, 'ADMIN');
    expect((await app.inject({ method: 'PUT', url: '/balcao/security/legal-hold', headers: H(admin), payload: { active: true } })).statusCode).toBe(400);
    const r = await app.inject({ method: 'PUT', url: '/balcao/security/legal-hold', headers: H(admin), payload: { active: true, basis: 'Inquérito civil 77/2026' } });
    expect(r.json().effective).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/balcao/security/legal-hold', headers: H(admin) })).json().effective).toBe(true);
    expect(await prisma.bvAuditLog.count({ where: { orgId: org.id, action: 'security.legal_hold' } })).toBe(1);
    await setIntegrationStatus; // referência para manter import usado em tipos
  });
});
