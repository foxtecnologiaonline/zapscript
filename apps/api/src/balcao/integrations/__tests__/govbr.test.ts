import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../lib/prisma';
import { blindIndex, decryptField } from '../../core/crypto';
import { ingestInbound } from '../../core/conversations';
import { clearChannelSenders, registerChannelSender } from '../../core/channels';
import { saveIntegration } from '../../core/integrations';
import { clearBotTools, getBotTool } from '../../core/tools';
import { listMessages } from '../../core/messages';
import { setContactDocument } from '../../core/contacts';
import { makeOrg } from '../../core/testing';
import { buildGovbrLoginUrl, highestLevel, isValidCpf } from '../govbr';
import { clearJwksCache } from '../common';
import { buildApp, FakeIdp } from './fakes';

const CPF = '52998224725';
const REDIRECT = 'https://api.test.local/balcao/integrations/govbr/callback';

describe('integrations/govbr — OIDC + PKCE para o cidadão', () => {
  let app: FastifyInstance; let idp: FakeIdp;
  beforeAll(async () => {
    app = await buildApp(); idp = await FakeIdp.create();
    registerChannelSender('WEBCHAT', async () => ({}));
  });
  afterAll(async () => { clearChannelSenders(); await idp.close(); await app.close(); });
  beforeEach(() => { idp.opts = {}; idp.confiabilidades = [{ id: 1 }, { id: 3 }]; idp.confiabilidadesStatus = 200; idp.authMethod = 'basic'; clearJwksCache(); });

  async function setup(over: Record<string, unknown> = {}) {
    const org = await makeOrg();
    await saveIntegration(org.id, 'GOVBR', {
      ...idp.cfg, redirectUri: REDIRECT, confiabilidadesUrl: `${idp.server.url}/confiabilidades/{cpf}`, scopes: ['openid', 'email', 'govbr_confiabilidades'], requiredLevel: 'ouro', ...over,
    });
    const ing = await ingestInbound({ orgId: org.id, channel: 'WEBCHAT', channelRef: `v-${Math.random()}`, externalId: `v-${Math.random()}`, message: { body: 'quero consultar meu processo' } });
    return { org, conv: ing.conversation, contactId: ing.contactId };
  }
  const start = async (orgId: string, convId: string) => {
    const url = await buildGovbrLoginUrl(orgId, convId);
    expect(url).toContain('/balcao/integrations/govbr/authorize');
    return app.inject({ method: 'GET', url: FakeIdp.pathOf(url) });
  };
  const callback = (backUrl: string) => app.inject({ method: 'GET', url: `/balcao/integrations/govbr/callback${new URL(backUrl).search}` });

  it('fluxo completo: autoriza, troca código com PKCE, verifica id_token, grava identidade e avisa a conversa', async () => {
    const { org, conv, contactId } = await setup();
    const r1 = await start(org.id, conv.id);
    expect(r1.statusCode).toBe(302);
    const loc = r1.headers.location as string;
    expect(loc.startsWith(idp.server.url + '/authorize')).toBe(true);
    const back = idp.authorize(loc, { sub: CPF, name: 'Maria da Silva' });
    const r2 = await callback(back);
    expect(r2.statusCode).toBe(200);
    expect(r2.headers['content-type']).toContain('text/html');
    expect(r2.body).toContain('Você já pode voltar ao atendimento');
    expect(r2.body).toContain('lang="pt-BR"');

    const c = await prisma.bvContact.findUnique({ where: { id: contactId } });
    expect(c).toMatchObject({ govbrLevel: 'ouro', name: 'Maria da Silva' });
    expect(c!.identityVerifiedAt).toBeTruthy();
    expect(decryptField(c!.documentEnc!)).toBe(CPF);
    expect(c!.documentHash).toBe(blindIndex(CPF));
    expect(c!.govbrSub).not.toContain(CPF); // sub (= CPF) não fica em claro

    const msgs = await listMessages(conv.id);
    expect(msgs.some((m) => m.senderType === 'SYSTEM' && m.body === 'Identidade confirmada (nível ouro).')).toBe(true);
    const audits = await prisma.bvAuditLog.findMany({ where: { orgId: org.id, action: 'govbr.identity_verified' } });
    expect(audits).toHaveLength(1); expect(JSON.stringify(audits)).not.toContain(CPF);
    const logs = await prisma.bvIntegrationLog.findMany({ where: { orgId: org.id, type: 'GOVBR' } });
    expect(logs.every((l) => l.ok)).toBe(true); expect(JSON.stringify(logs)).not.toContain(CPF);
  });

  it('também funciona com autenticação do cliente por POST', async () => {
    idp.authMethod = 'post';
    const { org, conv, contactId } = await setup({ tokenAuthMethod: 'post' });
    const back = idp.authorize((await start(org.id, conv.id)).headers.location as string, { sub: CPF });
    expect((await callback(back)).statusCode).toBe(200);
    expect((await prisma.bvContact.findUnique({ where: { id: contactId } }))!.govbrLevel).toBe('ouro');
  });

  it('replay do callback (state de uso único) e state adulterado/inexistente → página de erro genérica', async () => {
    const { org, conv, contactId } = await setup();
    const back = idp.authorize((await start(org.id, conv.id)).headers.location as string, { sub: CPF });
    expect((await callback(back)).statusCode).toBe(200);
    const replay = await callback(back);
    expect(replay.statusCode).toBe(400);
    expect(replay.body).toContain('Não foi possível confirmar sua identidade');
    expect(replay.body).not.toContain(CPF);
    const forged = new URL(back); forged.searchParams.set('state', 'estado-forjado-123456');
    expect((await callback(forged.toString())).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/balcao/integrations/govbr/callback' })).statusCode).toBe(400);
    // contato não foi alterado por tentativas inválidas além da 1ª
    expect((await prisma.bvContact.findUnique({ where: { id: contactId } }))!.govbrLevel).toBe('ouro');
  });

  it('CSRF: state de uma sessão não vale com code de outra; code sem o PKCE verifier correto é recusado pelo IdP', async () => {
    const a = await setup(); const b = await setup();
    const locA = (await start(a.org.id, a.conv.id)).headers.location as string;
    const locB = (await start(b.org.id, b.conv.id)).headers.location as string;
    const backA = new URL(idp.authorize(locA, { sub: CPF }));
    const backB = new URL(idp.authorize(locB, { sub: '11144477735' }));
    // atacante mistura o code de B com o state de A: o verifier de A não bate com o challenge de B
    backA.searchParams.set('code', backB.searchParams.get('code')!);
    const r = await callback(backA.toString());
    expect(r.statusCode).toBe(400);
    expect((await prisma.bvContact.findUnique({ where: { id: a.contactId } }))!.documentEnc).toBeNull();
    expect((await prisma.bvContact.findUnique({ where: { id: b.contactId } }))!.documentEnc).toBeNull();
  });

  it('nível insuficiente (prata < ouro): não grava identidade, avisa a conversa', async () => {
    idp.confiabilidades = [{ id: 2 }];
    const { org, conv, contactId } = await setup();
    const r = await callback(idp.authorize((await start(org.id, conv.id)).headers.location as string, { sub: CPF }));
    expect(r.statusCode).toBe(403);
    expect(r.body).not.toContain('prata');
    const c = await prisma.bvContact.findUnique({ where: { id: contactId } });
    expect(c!.govbrLevel).toBeNull(); expect(c!.documentEnc).toBeNull();
    expect((await listMessages(conv.id)).some((m) => m.senderType === 'SYSTEM' && /nível ouro/.test(m.body ?? ''))).toBe(true);
  });

  it('confiabilidades indisponível → falha fechada (não assume ouro)', async () => {
    idp.confiabilidadesStatus = 500;
    const { org, conv, contactId } = await setup();
    expect((await callback(idp.authorize((await start(org.id, conv.id)).headers.location as string, { sub: CPF }))).statusCode).toBe(400);
    expect((await prisma.bvContact.findUnique({ where: { id: contactId } }))!.govbrLevel).toBeNull();
  });

  it.each([
    ['nonce errado', { wrongNonce: true }], ['audience errada', { wrongAud: true }], ['issuer errado', { wrongIssuer: true }],
    ['token expirado', { expired: true }], ['assinatura de outra chave', { otherKey: true }],
  ])('id_token inválido (%s) é rejeitado', async (_n, o) => {
    idp.opts = o as any;
    const { org, conv, contactId } = await setup();
    const r = await callback(idp.authorize((await start(org.id, conv.id)).headers.location as string, { sub: CPF }));
    expect(r.statusCode).toBe(400);
    expect((await prisma.bvContact.findUnique({ where: { id: contactId } }))!.documentEnc).toBeNull();
    const log = await prisma.bvIntegrationLog.findFirst({ where: { orgId: org.id, type: 'GOVBR', ok: false } });
    expect(log).toBeTruthy(); expect(log!.error).toMatch(/^oidc\./);
  });

  it('sub que não é CPF válido é rejeitado; usuário que nega no GOV.BR (error=) também', async () => {
    const { org, conv } = await setup();
    expect((await callback(idp.authorize((await start(org.id, conv.id)).headers.location as string, { sub: '12345678900' }))).statusCode).toBe(400);
    const loc = new URL((await start(org.id, conv.id)).headers.location as string);
    const denied = await app.inject({ method: 'GET', url: `/balcao/integrations/govbr/callback?error=access_denied&state=${loc.searchParams.get('state')}` });
    expect(denied.statusCode).toBe(400);
  });

  it('link de autorização: exige assinatura válida, não expirada e contactId coerente', async () => {
    const { org, conv, contactId } = await setup();
    const url = new URL(await buildGovbrLoginUrl(org.id, conv.id));
    const mk = (mut: (u: URL) => void) => { const u = new URL(url); mut(u); return app.inject({ method: 'GET', url: FakeIdp.pathOf(u.toString()) }); };
    expect((await mk(() => undefined)).statusCode).toBe(302);
    expect((await mk((u) => u.searchParams.set('sig', 'a'.repeat(64)))).statusCode).toBe(400);
    expect((await mk((u) => u.searchParams.set('exp', String(Math.floor(Date.now() / 1000) + 99999)))).statusCode).toBe(400);
    expect((await mk((u) => u.searchParams.set('contactId', 'outro'))).statusCode).toBe(400);
    expect((await mk((u) => u.searchParams.delete('sig'))).statusCode).toBe(400);
    expect(contactId).toBeTruthy();
    await expect(buildGovbrLoginUrl((await makeOrg()).id, conv.id)).rejects.toMatchObject({ code: 'govbr.conversation_not_found' });
  });

  it('o mesmo cidadão vindo de outro canal é mesclado no contato existente (sem violar unicidade)', async () => {
    const { org, conv, contactId } = await setup();
    const other = await ingestInbound({ orgId: org.id, channel: 'WEBCHAT', channelRef: 'antigo', externalId: 'antigo', message: { body: 'oi' } });
    await setContactDocument(other.contactId, CPF);
    await callback(idp.authorize((await start(org.id, conv.id)).headers.location as string, { sub: CPF }));
    const moved = await prisma.bvContact.findUnique({ where: { id: contactId } });
    expect(moved!.mergedIntoId).toBe(other.contactId);
    const keep = await prisma.bvContact.findUnique({ where: { id: other.contactId } });
    expect(keep).toMatchObject({ govbrLevel: 'ouro' });
    expect((await prisma.bvConversation.findUnique({ where: { id: conv.id } }))!.contactId).toBe(other.contactId);
  });

  it('ferramenta do bot identity.request_login devolve o link; sem integração devolve mensagem amigável', async () => {
    clearBotTools();
    const mod = await import('../govbr'); mod.registerGovbrTool();
    const tool = getBotTool('identity.request_login')!;
    const { org, conv, contactId } = await setup();
    const ctx = { orgId: org.id, conversationId: conv.id, contactId, channel: 'WEBCHAT' as const, identityLevel: null };
    const res: any = await tool.handler(ctx, {});
    expect(res.ok).toBe(true); expect(res.data.url).toContain('/govbr/authorize');
    const none = await makeOrg();
    expect((await tool.handler({ ...ctx, orgId: none.id }, {})).ok).toBe(false);
  });

  it('rate limit nas rotas públicas (por IP)', async () => {
    process.env.BV_INT_RL_FORCE = '1';
    try {
      const ip = `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
      let last = 0;
      for (let i = 0; i < 61; i++) last = (await app.inject({ method: 'GET', url: '/balcao/integrations/govbr/callback', remoteAddress: ip })).statusCode;
      expect(last).toBe(429);
    } finally { delete process.env.BV_INT_RL_FORCE; }
  });

  it('utilitários: níveis e CPF', () => {
    expect(highestLevel([{ id: 1 }, { id: 2 }])).toBe('prata');
    expect(highestLevel(['Bronze', 'ouro'])).toBe('ouro');
    expect(highestLevel({ niveis: [{ nome: 'prata' }] })).toBe('prata');
    expect(highestLevel([])).toBeNull();
    expect(isValidCpf('529.982.247-25')).toBe(true); expect(isValidCpf('11111111111')).toBe(false); expect(isValidCpf('123')).toBe(false);
  });
});
