import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../lib/prisma';
import { getIntegration } from '../../core/integrations';
import { authHeader, makeOrg, makeUser } from '../../core/testing';
import { buildApp, listen } from './fakes';

const BASE = '/balcao/integrations';

describe('integrations/admin', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });

  async function setup() {
    const org = await makeOrg();
    const admin = await makeUser(org.id, 'ADMIN');
    return { org, admin, h: authHeader(admin) };
  }
  const inj = (method: any, url: string, h: any, payload?: any) => app.inject({ method, url: `${BASE}${url}`, headers: h, payload });

  it('exige integration:manage', async () => {
    const { org } = await setup();
    const sup = await makeUser(org.id, 'SUPERVISOR');
    expect((await app.inject({ method: 'GET', url: `${BASE}/` })).statusCode).toBe(401);
    expect((await inj('GET', '/', authHeader(sup))).statusCode).toBe(403);
    expect((await inj('PUT', '/JIRA', authHeader(sup), { config: {} })).statusCode).toBe(403);
  });

  it('lista todos os tipos (inclusive os de outras frentes) com status', async () => {
    const { h } = await setup();
    const r = await inj('GET', '/', h);
    expect(r.statusCode).toBe(200);
    const list = r.json().integrations;
    expect(list.map((i: any) => i.type).sort()).toEqual(['EMAIL_IMAP', 'EPROC', 'GOOGLE_WORKSPACE', 'GOVBR', 'JIRA', 'LLM', 'OIDC_TJTO', 'SIP_TRUNK', 'URA_0800', 'WHATSAPP']);
    expect(list.find((i: any) => i.type === 'EPROC')).toMatchObject({ managedHere: true, status: 'UNCONFIGURED', configured: false });
    expect(list.find((i: any) => i.type === 'WHATSAPP')).toMatchObject({ managedHere: false });
  });

  it('PUT valida por tipo, cifra, mascara segredos na leitura e preserva segredo quando mascarado/omitido', async () => {
    const { org, h } = await setup();
    expect((await inj('PUT', '/EPROC', h, { config: { mode: 'soap', endpoint: 'https://eproc.example.gov.br/mni' } })).statusCode).toBe(400); // sem credenciais
    expect((await inj('PUT', '/EPROC', h, { config: { mode: 'soap', endpoint: 'http://169.254.169.254/x', idConsultante: 'a', senhaConsultante: 'b' } })).statusCode).toBe(400); // SSRF
    expect((await inj('PUT', '/JIRA', h, { config: { baseUrl: 'https://x.atlassian.net', email: 'a@b.c', apiToken: 'tok', projectKey: 'minúsculo' } })).statusCode).toBe(400);

    const cfg = { mode: 'soap', endpoint: 'https://eproc.example.gov.br/mni', idConsultante: 'balcao', senhaConsultante: 'SUPER-SEGREDO-1' };
    const put = await inj('PUT', '/EPROC', h, { config: cfg });
    expect(put.statusCode).toBe(200);
    expect(put.body).not.toContain('SUPER-SEGREDO-1');
    expect(put.json().config.senhaConsultante).toBe('••••••');
    const get = await inj('GET', '/EPROC', h);
    expect(get.body).not.toContain('SUPER-SEGREDO-1');
    expect(get.json().config).toMatchObject({ idConsultante: 'balcao', mode: 'soap', senhaConsultante: '••••••' });

    const row = await prisma.bvIntegration.findFirst({ where: { orgId: org.id, type: 'EPROC' } });
    expect(row!.configEnc).not.toContain('SUPER-SEGREDO-1'); expect(row!.configEnc).not.toContain('balcao');

    await inj('PUT', '/EPROC', h, { config: { ...cfg, endpoint: 'https://eproc2.example.gov.br/mni', senhaConsultante: '••••••' } });
    await inj('PUT', '/EPROC', h, { config: { mode: 'soap', endpoint: 'https://eproc2.example.gov.br/mni', idConsultante: 'balcao' } });
    expect((await getIntegration<any>(org.id, 'EPROC'))!.config.senhaConsultante).toBe('SUPER-SEGREDO-1');
    expect((await getIntegration<any>(org.id, 'EPROC'))!.config.endpoint).toContain('eproc2');
    expect(await prisma.bvAuditLog.count({ where: { orgId: org.id, action: 'integration.update' } })).toBe(3);
    expect(await prisma.bvConfigVersion.count({ where: { orgId: org.id, entityType: 'integration' } })).toBe(3);
  });

  it('tipos de outras frentes: leitura permitida, escrita recusada', async () => {
    const { h } = await setup();
    expect((await inj('GET', '/WHATSAPP', h)).statusCode).toBe(200);
    expect((await inj('PUT', '/WHATSAPP', h, { config: {} })).statusCode).toBe(400);
    expect((await inj('POST', '/WHATSAPP/test', h)).statusCode).toBe(400);
    expect((await inj('GET', '/NOPE', h)).statusCode).toBe(400);
  });

  it('teste de conexão grava status OK/ERROR, last check e log; GET logs lista só do órgão', async () => {
    const { org, h } = await setup();
    let wsdlOk = true;
    const srv = await listen((r) => (r.path.startsWith('/mni') ? (wsdlOk ? [200, '<definitions xmlns="http://schemas.xmlsoap.org/wsdl/"/>'] : [503, 'x']) : [404, '']));
    try {
      expect((await inj('POST', '/EPROC/test', h)).statusCode).toBe(404);
      await inj('PUT', '/EPROC', h, { config: { mode: 'soap', endpoint: `${srv.url}/mni`, idConsultante: 'a', senhaConsultante: 'b', allowPrivateHosts: true } });
      const ok = await inj('POST', '/EPROC/test', h);
      expect(ok.json()).toMatchObject({ ok: true, status: 'OK' });
      let row = await prisma.bvIntegration.findFirst({ where: { orgId: org.id, type: 'EPROC' } });
      expect(row).toMatchObject({ status: 'OK', lastError: null }); expect(row!.lastCheckAt).toBeTruthy();
      wsdlOk = false;
      const bad = await inj('POST', '/EPROC/test', h);
      expect(bad.json()).toMatchObject({ ok: false, status: 'ERROR' });
      row = await prisma.bvIntegration.findFirst({ where: { orgId: org.id, type: 'EPROC' } });
      expect(row!.status).toBe('ERROR'); expect(row!.lastError).toBeTruthy();
      const logs = (await inj('GET', '/EPROC/logs?limit=10', h)).json().logs;
      expect(logs.length).toBe(2); expect(logs[0].ok).toBe(false); expect(logs[1].ok).toBe(true);

      const org2 = await makeOrg(); const h2 = authHeader(await makeUser(org2.id, 'ADMIN'));
      expect((await inj('GET', '/EPROC/logs', h2)).json().logs).toHaveLength(0);
      expect((await inj('GET', '/EPROC', h2)).json().configured).toBe(false);
    } finally { await srv.close(); }
  });

  it('allowPrivateHosts é descartado em produção (config não vira rota para rede interna)', async () => {
    const { h } = await setup();
    const old = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
    try {
      const r = await inj('PUT', '/JIRA', h, { config: { baseUrl: 'https://127.0.0.1:8080', email: 'a@b.c', apiToken: 'tok-12345', projectKey: 'BV', allowPrivateHosts: true } });
      expect(r.statusCode).toBe(400);
    } finally { process.env.NODE_ENV = old; }
  });
});
