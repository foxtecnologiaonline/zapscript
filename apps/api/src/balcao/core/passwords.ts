import crypto from 'crypto';

const N = 16384, R = 8, P = 1, KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, { N: +n, r: +r, p: +p });
  return crypto.timingSafeEqual(actual, expected);
}

/** Política de senha: ≥ 12 caracteres, com letra e número. Retorna mensagem de erro ou null. */
export function passwordPolicyError(password: string): string | null {
  if (password.length < 12) return 'A senha deve ter pelo menos 12 caracteres.';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'A senha deve conter letras e números.';
  return null;
}
