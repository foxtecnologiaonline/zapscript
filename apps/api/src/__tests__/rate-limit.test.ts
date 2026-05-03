/**
 * Testes de rate limiting em endpoints críticos.
 */
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';

async function buildApp() {
  const app = Fastify({ logger: false });
  app.register(jwt, { secret: 'test-secret' });
  app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

  // Rota mock para testar rate limiting
  app.post('/auth/login',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      return { success: true, token: 'mock-token' };
    }
  );

  app.post('/auth/register',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      return { success: true, userId: 'user-1' };
    }
  );

  await app.ready();
  return app;
}

describe('Rate Limiting', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('permite 5 login attempts em 15 minutos', async () => {
    // Simular 5 tentativas de login
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'test@test.com', password: 'pass' },
      });
      expect(res.statusCode).toBe(200);
    }
  });

  it('documenta rate limit headers nas respostas', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'test@test.com', password: 'pass' },
    });

    // Rate limit headers devem estar presentes
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
    expect(res.headers['x-ratelimit-reset']).toBeDefined();
  });

  it('permite 5 register attempts por minuto', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: `test${i}@test.com`,
          password: 'password',
        },
      });
      expect(res.statusCode).toBe(200);
    }
  });
});
