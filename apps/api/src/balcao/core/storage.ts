import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { pipeline } from 'stream/promises';
import type { Readable } from 'stream';
import { enforceScan, scanFile } from './antivirus';

/**
 * Armazenamento de objetos (anexos, gravações, exportações). Implementação em disco local
 * (BV_STORAGE_DIR) — volume Docker na mesma região (Brasil). A interface permite trocar por S3-compatível
 * sem mudar os chamadores. Chaves: `<orgId>/<kind>/<yyyy>/<mm>/<id>[.ext]` — nunca aceitar chave vinda do cliente sem validar.
 */
export const storageRoot = (): string => path.resolve(process.env.BV_STORAGE_DIR || (process.env.NODE_ENV === 'test' ? path.join(require('os').tmpdir(), 'bv-storage-test') : '/var/lib/zapscript/bv-storage'));

function resolveKey(key: string): string {
  if (!key || key.includes('\0') || key.startsWith('/') || key.split('/').includes('..')) throw new Error('storage: chave inválida');
  const full = path.resolve(storageRoot(), key);
  if (!full.startsWith(storageRoot() + path.sep)) throw new Error('storage: chave fora da raiz');
  return full;
}

export type StorageKind = 'attachments' | 'recordings' | 'exports' | 'ivr' | 'tmp';

export function newKey(orgId: string, kind: StorageKind, ext = ''): string {
  const d = new Date();
  const safeExt = ext ? '.' + ext.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase() : '';
  return `${orgId}/${kind}/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}${safeExt}`;
}

export interface StoredObject { key: string; size: number; sha256: string }

/** `scan: true` passa o arquivo pelo antivírus (ClamAV, se configurado) e REMOVE o objeto se recusado — use em anexos de cidadãos. */
export async function putObject(key: string, data: Buffer | Readable, opts: { scan?: boolean } = {}): Promise<StoredObject> {
  const stored = await writeObject(key, data);
  if (opts.scan) {
    try { enforceScan(await scanFile(resolveKey(key))); }
    catch (err) { await fs.promises.rm(resolveKey(key), { force: true }); throw err; }
  }
  return stored;
}

async function writeObject(key: string, data: Buffer | Readable): Promise<StoredObject> {
  const full = resolveKey(key);
  await fs.promises.mkdir(path.dirname(full), { recursive: true });
  const hash = crypto.createHash('sha256');
  let size = 0;
  if (Buffer.isBuffer(data)) {
    hash.update(data); size = data.length;
    await fs.promises.writeFile(full, data, { mode: 0o640 });
  } else {
    data.on('data', (c: Buffer) => { hash.update(c); size += c.length; });
    await pipeline(data, fs.createWriteStream(full, { mode: 0o640 }));
  }
  return { key, size, sha256: hash.digest('hex') };
}

export async function statObject(key: string): Promise<{ size: number } | null> {
  try { const s = await fs.promises.stat(resolveKey(key)); return { size: s.size }; } catch { return null; }
}

/** Stream com suporte a Range (reprodução de gravações). */
export function getObjectStream(key: string, range?: { start: number; end: number }): Readable {
  return fs.createReadStream(resolveKey(key), range ? { start: range.start, end: range.end } : undefined);
}

export async function getObjectBuffer(key: string): Promise<Buffer> { return fs.promises.readFile(resolveKey(key)); }

export async function deleteObject(key: string): Promise<void> { await fs.promises.rm(resolveKey(key), { force: true }); }

/** Interpreta o header Range: bytes=a-b. Retorna null se ausente/inválido. */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
  const m = header && /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start = m[1] === '' ? size - Number(m[2]) : Number(m[1]);
  let end = m[1] === '' || m[2] === '' ? size - 1 : Number(m[2]);
  start = Math.max(0, start); end = Math.min(size - 1, end);
  return start > end ? null : { start, end };
}
