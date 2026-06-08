import crypto from 'crypto';

const rawKey = process.env.ENCRYPTION_KEY;
if (!rawKey || rawKey.length !== 64 || !/^[0-9a-fA-F]+$/.test(rawKey)) {
  throw new Error('ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)');
}
const KEY = Buffer.from(rawKey, 'hex');

/** Criptografa uma string simples. Retorna iv:tag:data em hex. */
export function encryptStr(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('hex'), tag.toString('hex'), enc.toString('hex')].join(':');
}

export function encrypt(data: object): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(data), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString('hex'),
    tag.toString('hex'),
    encrypted.toString('hex'),
  ].join(':');
}

export function decrypt(str: string): object {
  const parts = str.split(':');
  if (parts.length !== 3) {
    throw new Error('Formato de string criptografada inválido');
  }
  const [ivHex, tagHex, dataHex] = parts;
  const iv        = Buffer.from(ivHex,  'hex');
  const tag       = Buffer.from(tagHex, 'hex');
  const encrypted = Buffer.from(dataHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}

/**
 * Decripta uma string criptografada por encryptStr no worker.
 * Se o valor não estiver no formato iv:tag:data, retorna-o como está
 * (compatibilidade retroativa com registros em plaintext).
 */
export function decryptStr(enc: string | null | undefined): string {
  if (!enc) return enc ?? '';
  const parts = enc.split(':');
  if (parts.length !== 3) return enc; // plaintext legado
  try {
    const [ivHex, tagHex, dataHex] = parts;
    const iv        = Buffer.from(ivHex,  'hex');
    const tag       = Buffer.from(tagHex, 'hex');
    const encrypted = Buffer.from(dataHex, 'hex');
    const decipher  = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return enc; // falha ao decriptar — retorna original
  }
}

/**
 * Blind index para CPF/CNPJ — HMAC-SHA256 determinístico com a chave AES.
 * Permite busca de unicidade no DB sem armazenar o CPF em plaintext.
 * Sempre produz o mesmo hash para o mesmo input (diferente do AES-GCM com IV aleatório).
 */
export function documentHash(cpfCnpj: string): string {
  return crypto.createHmac('sha256', KEY).update(cpfCnpj).digest('hex');
}

/**
 * Decripta um array de strings criptografado por encryptArr no worker.
 * Retorna array vazio se falhar.
 */
export function decryptArr(enc: string | null | undefined | unknown): string[] {
  if (!enc) return [];
  if (Array.isArray(enc)) return enc as string[]; // já é array (legado/plaintext Prisma Json)
  if (typeof enc !== 'string') return [];
  try {
    const raw = decryptStr(enc);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
