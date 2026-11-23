import crypto from 'crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../lib/prisma';
import { clearChannelSenders, registerChannelSender } from '../../core/channels';
import { ingestInbound } from '../../core/conversations';
import { listMessages } from '../../core/messages';
import { saveIntegration } from '../../core/integrations';
import { authHeader, makeOrg, makeUser } from '../../core/testing';
import { buildRfc822, clearGoogleTokenCache } from '../google';
import { verifyJws } from '../jws';
import { buildApp, listen, type FakeServer } from './fakes';

describe('integrations/google — Agenda/Meet e Gmail com conta de serviço', () => {
  let app: FastifyInstance; let srv: FakeServer;
  const kp = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = kp.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  const jwks = { keys: [{ ...(kp.publicKey.export({ format: 'jwk' }) as any), alg: 'RS256' }] };
  const SA_EMAIL = 'balcao@proj.iam.gserviceaccount.com';
  let tokenStatus = 200; let tokenCount = 0; let noMeet = false;

  beforeAll(async () => {
    app = await buildApp();
    registerChannelSender('WEBCHAT', async () => ({}));
    srv = await listen((r) => {
      const path = r.path.split('?')[0];
      if (path === '/token') {
        tokenCount++;
        const p = new URLSearchParams(r.body);
        if (p.get('grant_type') !== 'urn:ietf:params:oauth:grant-type:jwt-bearer') return [400, { error: 'bad_grant' }];
        let claims: any;
        try { claims = verifyJws(p.get('assertion')!, jwks, { issuer: SA_EMAIL, audience: `${srv.url}/token` }); } catch { return [400, { error: 'invalid_grant' }]; }
        if (claims.sub !== 'atendimento@tjto.jus.br' || !String(claims.scope).includes('googleapis.com/auth/')) return [400, { error: 'invalid_grant' }];
        return tokenStatus === 200 ? [200, { access_token: `at-${claims.scope.includes('gmail') ? 'gmail' : 'cal'}`, expires_in: 3600 }] : [tokenStatus, { error: 'x' }];
      }
      if (path === '/calendar/v3/calendars/agenda%40tjto.jus.br/events' && r.method === 'POST') {
        if (r.headers.authorization !== 'Bearer at-cal') return [401, {}];
        const b = JSON.parse(r.body);
        if (!r.path.includes('conferenceDataVersion=1') || b.conferenceData?.createRequest?.conferenceSolutionKey?.type !== 'hangoutsMeet') return [400, {}];
        return [200, { id: 'ev1', htmlLink: 'https://calendar.test/ev1', ...(noMeet ? {} : { hangoutLink: 'https://meet.google.com/abc-defg-hij' }), echo: b.attendees }];
      }
      if (path === '/gmail/v1/users/me/messages/send') {
        if (r.headers.authorization !== 'Bearer at-gmail') return [401, {}];
        return [200, { id: 'gm1', raw: JSON.parse(r.body).raw }];
      }
      return [404, {}];
    });
  });
  afterAll(async () => { clearChannelSenders(); await srv.close(); await app.close(); });
  beforeEach(() => { tokenStatus = 200; noMeet = false; tokenCount = 0; clearGoogleTokenCache(); srv.hits.length = 0; });

  async function setup() {
    const org = await makeOrg();
    await saveIntegration(org.id, 'GOOGLE_WORKSPACE', {
      serviceAccountJson: JSON.stringify({ client_email: SA_EMAIL, private_key: pem, token_uri: `${srv.url}/token` }),
      delegatedUser: 'atendimento@tjto.jus.br', calendarId: 'agenda@tjto.jus.br', calendarBaseUrl: srv.url, gmailBaseUrl: srv.url, allowPrivateHosts: true,
    });
    const agent = await makeUser(org.id, 'ATENDENTE');
    return { org, agent, h: authHeader(agent) };
  }
  const post = (url: string, h: any, payload: any) => app.inject({ method: 'POST', url: `/balcao/integrations${url}`, headers: h, payload });
  const start = new Date(Date.now() + 86_400_000).toISOString();

  it('cria evento com Meet, devolve o link e o envia na conversa; token em cache entre chamadas', async () => {
    const { org, agent, h } = await setup();
    const ing = await ingestInbound({ orgId: org.id, channel: 'WEBCHAT', channelRef: 'g1', externalId: 'g1', message: { body: 'preciso de videochamada' } });
    const r = await post('/google/meet', h, { conversationId: ing.conversation.id, summary: 'Atendimento', start, durationMin: 30, attendees: ['cidadao@example.com'] });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ eventId: 'ev1', meetLink: 'https://meet.google.com/abc-defg-hij' });
    const msgs = await listMessages(ing.conversation.id);
    expect(msgs.some((m) => m.direction === 'OUT' && m.senderUserId === agent.id && m.body?.includes('https://meet.google.com/abc-defg-hij'))).toBe(true);
    const cal = srv.hits.find((x) => x.path.includes('/calendar/'))!;
    const body = JSON.parse(cal.body);
    expect(body.attendees).toEqual([{ email: 'cidadao@example.com' }]);
    expect(new Date(body.end.dateTime).getTime() - new Date(body.start.dateTime).getTime()).toBe(30 * 60_000);
    expect(body.start.timeZone).toBe('America/Araguaina');
    await post('/google/meet', h, { summary: 'Outra', start, durationMin: 15 });
    expect(tokenCount).toBe(1);
    expect(await prisma.bvAuditLog.count({ where: { orgId: org.id, action: 'google.meet_create' } })).toBe(2);
    const logs = await prisma.bvIntegrationLog.findMany({ where: { orgId: org.id, type: 'GOOGLE_WORKSPACE' } });
    expect(JSON.stringify(logs)).not.toContain('cidadao@example.com'); expect(logs.every((l) => l.durationMs != null)).toBe(true);
  });

  it('valida entrada, permissão, conversa de outro órgão e falhas do Google', async () => {
    const { h } = await setup();
    expect((await post('/google/meet', h, { summary: '', start, durationMin: 30 })).statusCode).toBe(400);
    expect((await post('/google/meet', h, { summary: 'x', start: 'ontem', durationMin: 30 })).statusCode).toBe(400);
    expect((await post('/google/meet', h, { summary: 'x', start, durationMin: 30, attendees: ['nao-e-email'] })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/balcao/integrations/google/meet', payload: {} })).statusCode).toBe(401);
    const fiscal = await makeUser((await prisma.bvUser.findFirst({ where: { id: (h as any) && undefined } }) as any)?.orgId ?? (await makeOrg()).id, 'FISCAL');
    expect((await post('/google/meet', authHeader(fiscal), { summary: 'x', start, durationMin: 30 })).statusCode).toBe(403);

    const other = await makeOrg();
    const foreign = await ingestInbound({ orgId: other.id, channel: 'WEBCHAT', channelRef: 'g2', externalId: 'g2', message: { body: 'oi' } });
    expect((await post('/google/meet', h, { conversationId: foreign.conversation.id, summary: 'x', start, durationMin: 30 })).statusCode).toBe(404);

    tokenStatus = 400;
    const bad = await post('/google/meet', h, { summary: 'x', start, durationMin: 30 });
    expect(bad.statusCode).toBe(502); expect(bad.json().error.code).toBe('google.token_rejected');
    tokenStatus = 200; clearGoogleTokenCache(); noMeet = true;
    expect((await post('/google/meet', h, { summary: 'x', start, durationMin: 30 })).json().error.code).toBe('google.no_meet_link');
    const noCfg = authHeader(await makeUser((await makeOrg()).id, 'ATENDENTE'));
    expect((await post('/google/meet', noCfg, { summary: 'x', start, durationMin: 30 })).statusCode).toBe(409);
  });

  it('envia e-mail pelo Gmail como o usuário delegado (RFC 2822 em UTF-8, sem injeção de cabeçalho)', async () => {
    const { org, h } = await setup();
    const r = await post('/google/mail/send', h, { to: ['cidadao@example.com'], subject: 'Atenção: audiência\r\nBcc: x@y.z', text: 'Olá, sua audiência foi remarcada.' });
    expect(r.statusCode).toBe(202);
    expect(r.json().messageId).toBe('gm1');
    const raw = Buffer.from(JSON.parse(srv.hits.find((x) => x.path.includes('/gmail/'))!.body).raw, 'base64url').toString('utf8');
    expect(raw).toContain('From: atendimento@tjto.jus.br'); expect(raw).toContain('To: cidadao@example.com');
    expect(raw).not.toMatch(/^Bcc:/m);
    const subj = /Subject: =\?UTF-8\?B\?(.+)\?=/.exec(raw)![1];
    expect(Buffer.from(subj, 'base64').toString()).toContain('Atenção: audiência');
    const bodyB64 = raw.split('\r\n\r\n')[1].replace(/\r\n/g, '');
    expect(Buffer.from(bodyB64, 'base64').toString()).toBe('Olá, sua audiência foi remarcada.');
    expect((await post('/google/mail/send', h, { to: [], subject: 'x', text: 'y' })).statusCode).toBe(400);
    const audit = await prisma.bvAuditLog.findMany({ where: { orgId: org.id, action: 'google.mail_send' } });
    expect(JSON.stringify(audit)).not.toContain('cidadao@example.com');
    expect(buildRfc822({ from: 'a@b.c', to: ['x@y.z\nBcc: evil@e.com'], subject: 's', text: 't' })).not.toMatch(/^Bcc:/m);
  });

  it('config: serviceAccountJson é cifrado/mascarado; teste de conexão obtém token', async () => {
    const { org, agent } = await setup();
    const admin = await makeUser(org.id, 'ADMIN');
    const g = await app.inject({ method: 'GET', url: '/balcao/integrations/GOOGLE_WORKSPACE', headers: authHeader(admin) });
    expect(g.body).not.toContain('PRIVATE KEY'); expect(g.json().config.serviceAccountJson).toBe('••••••');
    const t = await app.inject({ method: 'POST', url: '/balcao/integrations/GOOGLE_WORKSPACE/test', headers: authHeader(admin) });
    expect(t.json()).toMatchObject({ ok: true, status: 'OK' });
    tokenStatus = 400;
    expect((await app.inject({ method: 'POST', url: '/balcao/integrations/GOOGLE_WORKSPACE/test', headers: authHeader(admin) })).json()).toMatchObject({ ok: false, status: 'ERROR' });
    expect(agent.orgId).toBe(org.id);
  });
});
