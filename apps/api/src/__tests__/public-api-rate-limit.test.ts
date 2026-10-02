/**
 * Rate limit da API pública v1 — prova que o orçamento é POR CHAVE, não por IP.
 *
 * Importa: é uma API servidor-a-servidor. Com o keyGenerator default (IP), dois
 * integradores atrás do mesmo NAT dividiriam o mesmo orçamento (um derrubaria
 * o outro) e o mesmo integrador ganharia orçamento novo só trocando de IP de
 * saída. No `app.inject` todas as requisições vêm do mesmo IP, então se o
 * limite fosse por IP o teste de isolamento abaixo falharia.
 */
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import crypto from 'crypto';

const hashApiKey = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

/**
 * Réplica do keyGenerator de routes/publicApi.ts. Ele é um closure interno da
 * rota (não exportado), então o que se testa aqui é o COMPORTAMENTO que ele
 * precisa garantir, com a mesma lógica.
 */
function apiKeyRateKey(req: any): string {
  const header = req.headers['x-api-key'];
  return typeof header === 'string' && header.trim()
    ? 'ak:' + hashApiKey(header.trim()).slice(0, 32)
    : 'ip:' + req.ip;
}

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(rateLimit, { max: 1000, timeWindow: '1 minute', global: true });

  app.post('/public/v1/messages',
    { config: { rateLimit: { max: 3, timeWindow: '1 minute', keyGenerator: apiKeyRateKey } } },
    async () => ({ id: 'msg_1', status: 'sent' }),
  );

  await app.ready();
  return app;
}

const send = (app: any, key?: string) =>
  app.inject({
    method:  'POST',
    url:     '/public/v1/messages',
    headers: key ? { 'x-api-key': key } : {},
    payload: { numberId: 'n1', to: '5511999999999', body: 'oi' },
  });

describe('rate limit por chave de API', () => {
  let app: any;
  beforeEach(async () => { app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('permite requisições dentro do limite da chave', async () => {
    for (let i = 0; i < 3; i++) {
      expect((await send(app, 'zsk_live_aaa')).statusCode).toBe(200);
    }
  });

  it('devolve 429 ao exceder o limite da chave', async () => {
    for (let i = 0; i < 3; i++) await send(app, 'zsk_live_aaa');
    expect((await send(app, 'zsk_live_aaa')).statusCode).toBe(429);
  });

  it('ISOLAMENTO: chave esgotada não afeta outra chave (mesmo IP)', async () => {
    // O ponto central do teste. Mesmo IP nos dois casos — se o limite fosse
    // por IP, a segunda chave já chegaria estourada.
    for (let i = 0; i < 4; i++) await send(app, 'zsk_live_aaa');
    expect((await send(app, 'zsk_live_aaa')).statusCode).toBe(429);

    expect((await send(app, 'zsk_live_bbb')).statusCode).toBe(200);
  });

  it('requisição sem chave ainda tem teto (cai no IP, não fica ilimitada)', async () => {
    for (let i = 0; i < 3; i++) expect((await send(app)).statusCode).toBe(200);
    expect((await send(app)).statusCode).toBe(429);
  });

  it('o token em claro nunca vira nome de chave do rate limit', async () => {
    // O valor usado como chave no store (Redis em produção) é o hash, não o
    // token — um dump do Redis não pode entregar credencial de integrador.
    const token = 'zsk_live_segredoabsoluto';
    const key = apiKeyRateKey({ headers: { 'x-api-key': token }, ip: '1.2.3.4' });
    expect(key).not.toContain(token);
    expect(key).not.toContain('segredoabsoluto');
    expect(key).toBe('ak:' + hashApiKey(token).slice(0, 32));
  });

  it('espaço em branco ao redor do token não cria orçamento separado', async () => {
    expect(apiKeyRateKey({ headers: { 'x-api-key': ' zsk_live_aaa ' }, ip: '1.1.1.1' }))
      .toBe(apiKeyRateKey({ headers: { 'x-api-key': 'zsk_live_aaa' }, ip: '9.9.9.9' }));
  });
});
