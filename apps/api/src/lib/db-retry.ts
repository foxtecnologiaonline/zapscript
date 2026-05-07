/**
 * Retry logic para queries do Prisma que falhem com ECONNRESET ou timeout
 * Implementa exponential backoff com jitter
 */

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  delayMs: number = 100,
  maxDelayMs: number = 2000,
): Promise<T> {
  let lastError: any;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;

      // Não fazer retry para erros que não são de conexão
      const isConnectionError =
        err.code === 'ECONNRESET' ||
        err.code === 'ECONNREFUSED' ||
        err.code === 'ETIMEDOUT' ||
        err.code === 'P1008' || // Prisma timeout
        (err.message && err.message.includes('Connection terminated unexpectedly'));

      if (!isConnectionError || attempt === maxAttempts - 1) {
        throw err;
      }

      // Exponential backoff com jitter
      const exponentialDelay = delayMs * Math.pow(2, attempt);
      const jitter = Math.random() * exponentialDelay * 0.1;
      const delay = Math.min(exponentialDelay + jitter, maxDelayMs);

      console.warn(
        `[DB Retry] Tentativa ${attempt + 1}/${maxAttempts} falhou. Aguardando ${Math.round(delay)}ms...`,
        { code: err.code, message: err.message },
      );

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
