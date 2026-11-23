import crypto from 'crypto';

/** Utilitários TOTP (RFC 6238) do IAM: segredo base32, URL otpauth:// e geração de código (usada em testes). A verificação reutiliza lib/totp. */
export { verifyTotp } from '../../lib/totp';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) out += ALPHABET[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}

export function base32Decode(s: string): Buffer {
  let bits = '';
  for (const c of s.replace(/=+$/, '').toUpperCase()) {
    const v = ALPHABET.indexOf(c);
    if (v >= 0) bits += v.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** Segredo novo de 160 bits em base32 (32 caracteres). */
export const generateTotpSecret = (): string => base32Encode(crypto.randomBytes(20));

export function otpauthUrl(secret: string, account: string, issuer: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/** Código TOTP de 6 dígitos para o instante `atMs` (passo de 30 s). `stepOffset` desloca janelas (testes). */
export function totpCode(secret: string, atMs = Date.now(), stepOffset = 0): string {
  const counter = Math.floor(atMs / 1000 / 30) + stepOffset;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 0x0f;
  const code = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}
