import crypto from 'crypto';
import { promisify } from 'util';

/**
 * Versões ASSÍNCRONAS (threadpool do libuv) do scrypt de core/passwords.ts — mesmo formato
 * (`scrypt$N$R$P$salt$hash`), então hashes são intercambiáveis com hashPassword/verifyPassword do core.
 * Usadas no login e no cadastro em massa para não bloquear o event loop (scryptSync leva dezenas de ms cada).
 */
const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, keylen: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
const N = 16384, R = 8, P = 1, KEYLEN = 64;

export async function hashPasswordAsync(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPasswordAsync(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: +n, r: +r, p: +p });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/** Verificação contra um hash descartável: iguala o tempo de resposta quando o usuário não existe (evita enumeração por timing). */
let dummy: Promise<string> | null = null;
export async function dummyVerify(password: string): Promise<void> {
  dummy ??= hashPasswordAsync(crypto.randomBytes(8).toString('hex'));
  await verifyPasswordAsync(password, await dummy);
}
