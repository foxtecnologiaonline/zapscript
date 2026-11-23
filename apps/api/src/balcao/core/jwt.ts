import crypto from 'crypto';

/**
 * JWT HS256 mínimo para o Balcão. A chave é derivada de JWT_SECRET com rótulo próprio, então um token do
 * SaaS ZapScript NÃO vale no Balcão (e vice-versa).
 */
function key(): Buffer {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET ausente');
  return crypto.createHmac('sha256', s).update('bv-jwt-v1').digest();
}
const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

export interface BvJwtPayload {
  sub: string; // userId
  org: string;
  role: string;
  sid?: string; // sessionId
  typ: 'access' | 'mfa';
  iat: number;
  exp: number;
}

export function signJwt(p: Omit<BvJwtPayload, 'iat' | 'exp'>, ttlSec: number): string {
  const now = Math.floor(Date.now() / 1000);
  const body = enc({ ...p, iat: now, exp: now + ttlSec });
  const head = enc({ alg: 'HS256', typ: 'JWT' });
  const sig = crypto.createHmac('sha256', key()).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

export function verifyJwt(token: string, expectedTyp: 'access' | 'mfa' = 'access'): BvJwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const expected = crypto.createHmac('sha256', key()).update(`${parts[0]}.${parts[1]}`).digest();
  const given = Buffer.from(parts[2], 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as BvJwtPayload;
    if (p.typ !== expectedTyp || p.exp < Math.floor(Date.now() / 1000)) return null;
    return p;
  } catch {
    return null;
  }
}
