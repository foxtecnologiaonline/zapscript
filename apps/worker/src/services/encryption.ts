/**
 * encryption.ts (worker)
 *
 * AES-256-GCM — criptografia de strings em repouso.
 * ENCRYPTION_KEY = 64 chars hex (32 bytes) — mesma chave do serviço API.
 * Se a chave não estiver configurada, as funções retornam os valores
 * originais sem criptografar (modo transparente para dev local).
 */

import crypto from 'crypto';

const rawKey = process.env.ENCRYPTION_KEY;
const KEY =
  rawKey && rawKey.length === 64 && /^[0-9a-fA-F]+$/.test(rawKey)
    ? Buffer.from(rawKey, 'hex')
    : null;

if (!KEY) {
  console.warn('[Encryption] ENCRYPTION_KEY não configurada — dados serão salvos sem criptografia.');
}

/** Criptografa uma string. Retorna iv:tag:data em hex. */
export function encryptStr(plain: string): string {
  if (!KEY) return plain;
  const iv      = crypto.randomBytes(12);
  const cipher  = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc     = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag     = cipher.getAuthTag();
  return [iv.toString('hex'), tag.toString('hex'), enc.toString('hex')].join(':');
}

/** Criptografa um array de strings (JSON-serializado antes). */
export function encryptArr(arr: string[]): string {
  return encryptStr(JSON.stringify(arr));
}

/** Decripta string no formato iv:tag:data. Suporta plaintext legado. */
export function decryptStr(enc: string | null | undefined): string {
  if (!enc) return enc ?? '';
  if (!KEY) return enc;
  const parts = enc.split(':');
  if (parts.length !== 3) return enc; // plaintext legado
  try {
    const [ivHex, tagHex, dataHex] = parts;
    const iv      = Buffer.from(ivHex, 'hex');
    const tag     = Buffer.from(tagHex, 'hex');
    const data    = Buffer.from(dataHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return enc;
  }
}

/** Decripta array de strings criptografado. Suporta JSON legado direto. */
export function decryptArr(enc: string | string[] | null | undefined): string[] {
  if (!enc) return [];
  if (Array.isArray(enc)) return enc;
  try {
    const plain = decryptStr(enc);
    const parsed = JSON.parse(plain);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
