/**
 * Rate limiting configs para @fastify/rate-limit
 * Usado no registro de rotas do Fastify
 */

export const rateLimitConfig = {
  auth: {
    max: 5,
    timeWindow: '15 minutes',
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'Muitas tentativas. Tente novamente em 15 minutos.',
    }),
  },
  api: {
    max: 100,
    timeWindow: '15 minutes',
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'Limite de requisições atingido.',
    }),
  },
  webhook: {
    max: 1000,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'Limite de webhook atingido.',
    }),
  },
  admin: {
    max: 50,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'Limite admin atingido.',
    }),
  },
};
