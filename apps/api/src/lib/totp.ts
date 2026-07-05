import crypto from 'crypto';
import { redis } from '../services/queue';

/**
 * TOTP (RFC 6238) sem dependência externa — 2FA opcional do painel admin.
 * Compatível com apps padrão (Google Authenticator, Authy, 1Password).
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const char of clean) {
    const val = BASE32_ALPHABET.indexOf(char);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

/** Verifica um código TOTP de 6 dígitos com tolerância de ±1 passo (janela de 30s). */
export function verifyTotp(secretBase32: string, token: string | undefined, stepSec = 30, window = 1): boolean {
  if (!token || !/^\d{6}$/.test(token)) return false;
  const secret = base32Decode(secretBase32);
  if (secret.length === 0) return false;
  const counter = Math.floor(Date.now() / 1000 / stepSec);
  for (let i = -window; i <= window; i++) {
    if (hotp(secret, counter + i) === token) return true;
  }
  return false;
}

const SESSION_TTL_SEC = 12 * 60 * 60; // 12h — evita pedir o código a cada request

function sessionKey(adminToken: string): string {
  return `admin2fa:verified:${crypto.createHash('sha256').update(adminToken).digest('hex')}`;
}

/**
 * 2FA do painel admin: só é exigido se ADMIN_TOTP_SECRET estiver configurada
 * no ambiente (sem a env, comportamento idêntico a antes — só token).
 *
 * Um código TOTP só é válido por ~30s, então exigi-lo em toda chamada do
 * painel (dezenas por sessão) travaria o admin no meio do uso. Por isso a
 * verificação é feita uma vez e a sessão fica "lembrada" no Redis por 12h,
 * atrelada a um hash do próprio ADMIN_TOKEN (nunca o token em claro).
 */
export async function checkAdminTotp(
  adminToken: string,
  totpHeader: string | undefined,
): Promise<'ok' | 'totp_required' | 'totp_invalid'> {
  const secret = process.env.ADMIN_TOTP_SECRET;
  if (!secret) return 'ok'; // 2FA não habilitado

  const key = sessionKey(adminToken);
  try {
    if (await redis.exists(key)) return 'ok';
  } catch {
    return 'ok'; // Redis indisponível — não bloqueia acesso por falha do 2FA
  }

  if (!totpHeader) return 'totp_required';
  if (!verifyTotp(secret, totpHeader)) return 'totp_invalid';

  try { await redis.set(key, '1', 'EX', SESSION_TTL_SEC); } catch { /* best-effort */ }
  return 'ok';
}
