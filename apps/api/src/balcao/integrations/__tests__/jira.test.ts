import crypto from 'crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../lib/prisma';
import { emitBvEventAndWait, onBvEvent } from '../../core/events';
import { saveIntegration } from '../../core/integrations';
import { authHeader, makeOrg, makeUser } from '../../core/testing';
import { buildApp, listen, type FakeServer } from './fakes';

describe('integrations/jira', () => {
  let app: FastifyInstance; let srv: FakeServer; let seq = 0; let createStatus = 201;
  beforeAll(async () => {
    app = await buildApp();
    srv = await listen((r) => {
      if (r.headers.authorization !== `Basic ${Buffer.from('bot@tjto.jus.br:tok-jira-123').toString('base64')}`) return [401, {}];
      if (r.path === '/rest/api/3/issue' && r.method === 'POST') return createStatus === 201 ? [201, { id: '1', key: `BV-${++seq}` }] : [createStatus, { errorMessages: ['x'] }];
      if (r.path === '/rest/api/3/myself') return [200, { accountId: 'a' }];
      if (r.path === '/rest/api/3/project/BV') return [200, { key: 'BV' }];
      return [404, {}];
    });
  });
  afterAll(async () => { await srv.close(); await app.close(); });
  beforeEach(() => { createStatus = 201; srv.hits.length = 0; });

  async function setup(over: Record<string, unknown> = {}) {
    const org = await makeOrg();
    await saveIntegration(org.id, 'JIRA', { baseUrl: srv.url, email: 'bot@tjto.jus.br', apiToken: 'tok-jira-123', projectKey: 'BV', webhookSecret: 'segredo-webhook', allowPrivateHosts: true, ...over });
    return org;
  }
  const mkTask = (orgId: string, kind = 'SERVICE_REQUEST', extra: Record<string, unknown> = {}) =>
    prisma.bvTask.create({ data: { orgId, code: `TAR-${crypto.randomBytes(4).toString('hex')}`, kind, title: 'Impressora parada', description: 'Sala 3\nSem toner', priority: 'HIGH', ...extra } });
  const reload = (id: string) => prisma.bvTask.findUnique({ where: { id } });
  const hook = (slug: string, body: any, headers: Record<string, string> = {}, qs = '') => app.inject({ method: 'POST', url: `/balcao/integrations/jira/webhook?org=${slug}${qs}`, payload: body, headers });
  const issueEvt = (key: string, status: string, cat = 'indeterminate') => ({ webhookEvent: 'jira:issue_updated', issue: { key, fields: { status: { name: status, statusCategory: { key: cat } } } } });

  it('task.created de SERVICE_REQUEST cria a issue (v3/ADF) e grava a chave em externalRef; idempotente', async () => {
    const org = await setup();
    const t = await mkTask(org.id);
    await emitBvEventAndWait('task.created', { orgId: org.id, taskId: t.id });
    await emitBvEventAndWait('task.created', { orgId: org.id, taskId: t.id });
    const row = await reload(t.id);
    expect(row!.externalRef).toMatch(/^BV-\d+$/);
    expect(srv.hits.filter((h) => h.method === 'POST')).toHaveLength(1);
    const body = JSON.parse(srv.hits[0].body).fields;
    expect(body).toMatchObject({ project: { key: 'BV' }, issuetype: { name: 'Task' }, priority: { name: 'High' } });
    expect(body.summary).toContain(t.code);
    expect(body.description.type).toBe('doc');
    expect(await prisma.bvTaskHistory.count({ where: { taskId: t.id, field: 'externalRef' } })).toBe(1);
    const logs = await prisma.bvIntegrationLog.findMany({ where: { orgId: org.id, type: 'JIRA' } });
    expect(logs).toHaveLength(1); expect(logs[0].ok).toBe(true);
  });

  it('só atua para os kinds configurados; outros ficam sem issue', async () => {
    const org = await setup();
    const internal = await mkTask(org.id, 'INTERNAL');
    await emitBvEventAndWait('task.created', { orgId: org.id, taskId: internal.id });
    expect((await reload(internal.id))!.externalRef).toBeNull();
    expect(srv.hits).toHaveLength(0);
    const org2 = await setup({ syncKinds: ['SERVICE_REQUEST', 'DEMAND'], issueTypeMap: { DEMAND: 'Story' } });
    const demand = await mkTask(org2.id, 'DEMAND');
    await emitBvEventAndWait('task.created', { orgId: org2.id, taskId: demand.id });
    expect(JSON.parse(srv.hits[0].body).fields.issuetype.name).toBe('Story');
    expect((await reload(demand.id))!.externalRef).toMatch(/^BV-/);
  });

  it('falha do Jira não derruba o evento e libera a tarefa para nova tentativa; sem config é ignorado', async () => {
    const org = await setup();
    const t = await mkTask(org.id);
    createStatus = 500;
    await emitBvEventAndWait('task.created', { orgId: org.id, taskId: t.id });
    expect((await reload(t.id))!.externalRef).toBeNull();
    expect((await prisma.bvIntegrationLog.findFirst({ where: { orgId: org.id, type: 'JIRA', ok: false } }))!.error).toBe('jira.create_failed');
    createStatus = 201;
    const org2 = await makeOrg(); const t2 = await mkTask(org2.id);
    await emitBvEventAndWait('task.created', { orgId: org2.id, taskId: t2.id });
    expect((await reload(t2.id))!.externalRef).toBeNull();
  });

  it('não vaza tarefa entre órgãos (task.created com orgId errado é ignorado)', async () => {
    const org = await setup(); const other = await makeOrg();
    const t = await mkTask(other.id);
    await emitBvEventAndWait('task.created', { orgId: org.id, taskId: t.id });
    expect((await reload(t.id))!.externalRef).toBeNull();
    expect(srv.hits).toHaveLength(0);
  });

  it('webhook: exige segredo (header, query ou HMAC); sincroniza status; fecha e emite task.closed', async () => {
    const org = await setup();
    const t = await mkTask(org.id, 'SERVICE_REQUEST', { externalRef: 'BV-900' });
    const closed: string[] = []; const off = onBvEvent('task.closed', (e) => { closed.push(e.taskId); });
    expect((await hook(org.slug, issueEvt('BV-900', 'In Progress'))).statusCode).toBe(401);
    expect((await hook(org.slug, issueEvt('BV-900', 'In Progress'), { 'x-jira-secret': 'errado' })).statusCode).toBe(401);
    expect((await hook('inexistente-xyz', issueEvt('BV-900', 'Done'), { 'x-jira-secret': 'segredo-webhook' })).statusCode).toBe(401);
    expect((await reload(t.id))!.status).toBe('OPEN');

    expect((await hook(org.slug, issueEvt('BV-900', 'In Progress'), { 'x-jira-secret': 'segredo-webhook' })).json()).toMatchObject({ status: 'IN_PROGRESS' });
    expect((await reload(t.id))!.status).toBe('IN_PROGRESS');
    // query string
    expect((await hook(org.slug, issueEvt('BV-900', 'Waiting'), {}, '&secret=segredo-webhook')).json().status).toBe('WAITING');
    // HMAC do corpo
    const payload = JSON.stringify(issueEvt('BV-900', 'Done', 'done'));
    const sig = crypto.createHmac('sha256', 'segredo-webhook').update(payload).digest('hex');
    const r = await app.inject({ method: 'POST', url: `/balcao/integrations/jira/webhook?org=${org.slug}`, payload, headers: { 'content-type': 'application/json', 'x-hub-signature': `sha256=${sig}` } });
    expect(r.json().status).toBe('DONE');
    const done = await reload(t.id);
    expect(done!.status).toBe('DONE'); expect(done!.completedAt).toBeTruthy();
    await new Promise((x) => setTimeout(x, 50));
    expect(closed).toEqual([t.id]);
    off();
    expect(await prisma.bvTaskHistory.count({ where: { taskId: t.id, field: 'status' } })).toBe(3);
    // status desconhecido por categoria, e mesma situação é ignorada
    expect((await hook(org.slug, issueEvt('BV-900', 'Done', 'done'), { 'x-jira-secret': 'segredo-webhook' })).json().ignored).toBe(true);
    expect((await hook(org.slug, issueEvt('BV-404', 'Done'), { 'x-jira-secret': 'segredo-webhook' })).json().ignored).toBe(true);
  });

  it('webhook não altera tarefa de outro órgão com a mesma chave Jira', async () => {
    const a = await setup(); const b = await setup();
    const ta = await mkTask(a.id, 'SERVICE_REQUEST', { externalRef: 'BV-777' });
    const tb = await mkTask(b.id, 'SERVICE_REQUEST', { externalRef: 'BV-777' });
    await hook(a.slug, issueEvt('BV-777', 'Done', 'done'), { 'x-jira-secret': 'segredo-webhook' });
    expect((await reload(ta.id))!.status).toBe('DONE'); expect((await reload(tb.id))!.status).toBe('OPEN');
  });

  it('POST /jira/issues manual: perm task:manage, cria mesmo para kind não sincronizado', async () => {
    const org = await setup();
    const t = await mkTask(org.id, 'INTERNAL');
    const atendente = await makeUser(org.id, 'ATENDENTE'); const sup = await makeUser(org.id, 'SUPERVISOR');
    const call = (h: any, taskId: string) => app.inject({ method: 'POST', url: '/balcao/integrations/jira/issues', headers: h, payload: { taskId } });
    expect((await call(authHeader(atendente), t.id)).statusCode).toBe(403);
    const r = await call(authHeader(sup), t.id);
    expect(r.statusCode).toBe(201); expect(r.json().key).toMatch(/^BV-/);
    expect((await reload(t.id))!.externalRef).toBe(r.json().key);
    expect((await call(authHeader(sup), 'nao-existe')).statusCode).toBe(404);
    const o2 = await makeOrg();
    expect((await call(authHeader(await makeUser(o2.id, 'SUPERVISOR')), t.id)).statusCode).toBe(409);
    expect(await prisma.bvAuditLog.count({ where: { orgId: org.id, action: 'jira.issue_create' } })).toBe(1);
  });

  it('teste de conexão e segredos mascarados', async () => {
    const org = await setup();
    const admin = authHeader(await makeUser(org.id, 'ADMIN'));
    const t = await app.inject({ method: 'POST', url: '/balcao/integrations/JIRA/test', headers: admin });
    expect(t.json()).toMatchObject({ ok: true, status: 'OK' });
    const g = await app.inject({ method: 'GET', url: '/balcao/integrations/JIRA', headers: admin });
    expect(g.body).not.toContain('tok-jira-123'); expect(g.body).not.toContain('segredo-webhook');
    await saveIntegration(org.id, 'JIRA', { baseUrl: srv.url, email: 'bot@tjto.jus.br', apiToken: 'errado-errado', projectKey: 'BV', allowPrivateHosts: true });
    expect((await app.inject({ method: 'POST', url: '/balcao/integrations/JIRA/test', headers: admin })).json()).toMatchObject({ ok: false, status: 'ERROR' });
  });
});
