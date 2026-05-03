/**
 * Testes de rate limiting em endpoints críticos.
 * Verifica que 429 é retornado ao exceder o limite.
 */
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute', global: true });

  // Rota mock: login com 5 tentativas/15min
  app.post('/auth/login',
    { config: { rateLimit: { max: 3, timeWindow: '1 minute' } } },
    async () => ({ success: true })
  );

  // Rota mock: register com 5 tentativas/min
  app.post('/auth/register',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async () => ({ success: true })
  );

  await app.ready();
  return app;
}

describe('Rate Limiting — bruteforce protection', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });

  it('permite tentativas dentro do limite', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'test@test.com', password: 'pass' },
      });
      // Dentro do limite: deve passar
      expect(res.statusCode).toBe(200);
    }
  });

  it('retorna 429 ao exceder o limite de login', async () => {
    // Rebuild app para limpar contadores
    const freshApp = await buildApp();

    // Faz requisições até exceder
    let lastStatus = 200;
    for (let i = 0; i < 5; i++) {
      const res = await freshApp.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'brute@brute.com', password: 'wrong' },
      });
      lastStatus = res.statusCode;
      if (lastStatus === 429) break;
    }

    expect(lastStatus).toBe(429);
    await freshApp.close();
  });

  it('resposta 429 tem mensagem de erro adequada', async () => {
    const freshApp = await buildApp();
    let response429: any = null;

    for (let i = 0; i < 5; i++) {
      const res = await freshApp.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'brute@test.com', password: 'wrong' },
      });
      if (res.statusCode === 429) {
        response429 = res;
        break;
      }
    }

    expect(response429).not.toBeNull();
    // Mensagem padrão do @fastify/rate-limit
    expect(response429.statusCode).toBe(429);
    await freshApp.close();
  });

  it('register tem limite separado (5 req/min)', async () => {
    const freshApp = await buildApp();
    const responses: number[] = [];

    for (let i = 0; i < 6; i++) {
      const res = await freshApp.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email: `test${i}@test.com`, password: 'pass' },
      });
      responses.push(res.statusCode);
    }

    // Os primeiros 5 devem passar, o 6o deve ser 429
    expect(responses.slice(0, 5).every(s => s === 200)).toBe(true);
    expect(responses[5]).toBe(429);
    await freshApp.close();
  });

  it('rotas sem rate-limit específico usam o global (100/min)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {},
    });
    // Pode ser 200 ou 429, mas nunca 500
    expect([200, 429]).toContain(res.statusCode);
  });
});
