import crypto from 'crypto';

/**
 * Criptografia de campo (AES-256-GCM) com versionamento de chave — usada para conteúdo de mensagens,
 * credenciais de integração, segredo TOTP e documentos (CPF/CNPJ).
 *
 * Formato: `bv1.<kid>.<iv>.<tag>.<ciphertext>` (base64url). O `kid` permite rotacionar a chave:
 *   BV_FIELD_KEYS='{"1":"<64 hex>","2":"<64 hex>"}'  BV_FIELD_KEY_CURRENT=2
 * Sem BV_FIELD_KEYS, deriva a chave `0` de ENCRYPTION_KEY (HKDF) — mesmo segredo que o resto da plataforma.
 */

const PREFIX = 'bv1.';

function masterKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw || !/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error('ENCRYPTION_KEY ausente ou inválida (64 hex)');
  }
  return Buffer.from(raw, 'hex');
}

function keyring(): { current: string; keys: Map<string, Buffer> } {
  const keys = new Map<string, Buffer>();
  const rawKeys = process.env.BV_FIELD_KEYS;
  if (rawKeys) {
    const parsed = JSON.parse(rawKeys) as Record<string, string>;
    for (const [kid, hex] of Object.entries(parsed)) {
      if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error(`BV_FIELD_KEYS[${kid}] inválida (64 hex)`);
      keys.set(kid, Buffer.from(hex, 'hex'));
    }
  }
  keys.set('0', Buffer.from(crypto.hkdfSync('sha256', masterKey(), Buffer.alloc(0), 'bv-field-key-v0', 32)));
  const current = process.env.BV_FIELD_KEY_CURRENT || [...keys.keys()].filter((k) => k !== '0').sort().pop() || '0';
  if (!keys.has(current)) throw new Error(`BV_FIELD_KEY_CURRENT=${current} não existe em BV_FIELD_KEYS`);
  return { current, keys };
}

const b64 = (b: Buffer) => b.toString('base64url');

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

export function encryptField(plain: string): string {
  const { current, keys } = keyring();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keys.get(current)!, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${PREFIX}${current}.${b64(iv)}.${b64(cipher.getAuthTag())}.${b64(ct)}`;
}

/** Descriptografa; valores sem o prefixo (legado/teste) são devolvidos como estão. */
export function decryptField(value: string): string {
  if (!isEncrypted(value)) return value;
  const [kid, iv, tag, ct] = value.slice(PREFIX.length).split('.');
  const key = keyring().keys.get(kid);
  if (!key) throw new Error(`Chave de campo ${kid} não encontrada`);
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

export function encryptJson(obj: unknown): string {
  return encryptField(JSON.stringify(obj));
}
export function decryptJson<T = any>(value: string): T {
  return JSON.parse(decryptField(value)) as T;
}

/** Re-cifra com a chave atual (rotação). */
export function rotateField(value: string): string {
  return encryptField(decryptField(value));
}

/** Índice cego (busca exata de CPF/CNPJ etc. sem guardar em claro). */
export function blindIndex(value: string, purpose = 'doc'): string {
  const key = Buffer.from(crypto.hkdfSync('sha256', masterKey(), Buffer.alloc(0), `bv-blind-${purpose}`, 32));
  return crypto.createHmac('sha256', key).update(value).digest('hex');
}

export const sha256Hex = (data: string | Buffer): string => crypto.createHash('sha256').update(data).digest('hex');
export const randomToken = (bytes = 32): string => crypto.randomBytes(bytes).toString('base64url');
/** Hash de token opaco (sessão, token de API, visitante) — nunca guardar o token em claro. */
export const hashToken = (token: string): string => sha256Hex(`bv-token:${token}`);
