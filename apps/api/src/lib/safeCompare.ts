import crypto from 'crypto';

/**
 * Comparação de segredo em tempo constante (token de admin, token interno).
 *
 * Extraído de routes/admin.ts, onde era uma função local, para poder ser
 * reusado por outras rotas administrativas sem duplicar a implementação —
 * duplicar comparação de segredo é como uma das cópias acaba virando `===`
 * numa refatoração distraída e abrindo timing attack.
 */
export function safeCompare(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
