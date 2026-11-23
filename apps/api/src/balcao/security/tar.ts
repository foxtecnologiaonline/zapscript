import crypto from 'crypto';
import { once } from 'events';
import type { Readable, Writable } from 'stream';

/**
 * Escritor de TAR (formato ustar, com cabeçalhos PAX para nomes longos/não ASCII e arquivos > 8 GiB) em streaming:
 * cada arquivo é gravado diretamente no destino com contrapressão, sem acumular nada em memória.
 * Sem dependências — o gzip é aplicado por quem consome (zlib.createGzip).
 */
const BLOCK = 512;
const MAX_OCTAL_11 = 0o77777777777; // 8 GiB - 1

function octal(n: number, len: number): string {
  return n.toString(8).padStart(len - 1, '0') + '\0';
}

/** Divide `name` em prefix (<=155) + name (<=100) numa barra; null se impossivel (aí usa PAX). */
function splitName(name: string): { prefix: string; base: string } | null {
  if (Buffer.byteLength(name) <= 100) return { prefix: '', base: name };
  for (let idx = name.indexOf('/'); idx > 0; idx = name.indexOf('/', idx + 1)) {
    const prefix = name.slice(0, idx);
    const base = name.slice(idx + 1);
    if (Buffer.byteLength(base) <= 100 && Buffer.byteLength(prefix) <= 155) return { prefix, base };
  }
  return null;
}

function buildHeader(name: string, size: number, mtime: number, type: string, mode = 0o640): Buffer {
  const b = Buffer.alloc(BLOCK);
  const sp = splitName(name) ?? { prefix: '', base: name.slice(0, 100) };
  const prefix = sp.prefix;
  const base = sp.base;
  b.write(base.slice(0, 100), 0, 100, 'utf8');
  b.write(octal(mode, 8), 100);
  b.write(octal(0, 8), 108);
  b.write(octal(0, 8), 116);
  b.write(octal(Math.min(size, MAX_OCTAL_11), 12), 124);
  b.write(octal(mtime, 12), 136);
  b.write('        ', 148); // checksum provisório
  b.write(type, 156, 1, 'ascii');
  b.write('ustar\0', 257, 6, 'ascii');
  b.write('00', 263, 2, 'ascii');
  b.write('root', 265, 32, 'ascii');
  b.write('root', 297, 32, 'ascii');
  if (prefix) b.write(prefix, 345, 155, 'utf8');
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += b[i];
  b.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return b;
}

function paxRecord(key: string, value: string): Buffer {
  const body = ` ${key}=${value}\n`;
  let len = Buffer.byteLength(body) + 1;
  while (String(len).length + Buffer.byteLength(body) !== len) len = String(len).length + Buffer.byteLength(body);
  return Buffer.from(`${len}${body}`);
}

function needsPaxName(name: string): boolean {
  if (/[^\x20-\x7e]/.test(name)) return true;
  return splitName(name) === null;
}

export interface TarEntryResult { bytes: number; sha256: string }

export class TarWriter {
  private ended = false;
  constructor(private readonly out: Writable, private readonly mtime = Math.floor(Date.now() / 1000)) {}

  private async put(buf: Buffer): Promise<void> {
    if (!buf.length) return;
    if (!this.out.write(buf)) await once(this.out, 'drain');
  }

  private async writeHeader(name: string, size: number): Promise<void> {
    if (name.startsWith('/') || name.split('/').includes('..')) throw new Error(`tar: nome inválido ${name}`);
    const pax: Buffer[] = [];
    if (needsPaxName(name)) pax.push(paxRecord('path', name));
    if (size > MAX_OCTAL_11) pax.push(paxRecord('size', String(size)));
    if (pax.length) {
      const body = Buffer.concat(pax);
      await this.put(buildHeader(`PaxHeader/${crypto.createHash('md5').update(name).digest('hex').slice(0, 16)}`, body.length, this.mtime, 'x'));
      await this.put(body);
      const pad = (BLOCK - (body.length % BLOCK)) % BLOCK;
      if (pad) await this.put(Buffer.alloc(pad));
    }
    const plain = needsPaxName(name) ? name.replace(/[^\x20-\x7e]/g, '_').slice(0, 99) : name;
    await this.put(buildHeader(plain, size, this.mtime, '0'));
  }

  /**
   * Adiciona um arquivo de tamanho conhecido. `source` pode ser Buffer ou stream; grava exatamente `size`
   * bytes (trunca excesso / completa com zeros se a origem encurtar) e devolve o sha256 do que foi gravado.
   */
  async addFile(name: string, size: number, source: Buffer | Readable): Promise<TarEntryResult> {
    if (this.ended) throw new Error('tar: já finalizado');
    await this.writeHeader(name, size);
    const hash = crypto.createHash('sha256');
    let remaining = size;
    const emit = async (chunk: Buffer) => {
      const part = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      if (!part.length) return;
      hash.update(part);
      remaining -= part.length;
      await this.put(part);
    };
    if (Buffer.isBuffer(source)) await emit(source);
    else for await (const c of source) { await emit(Buffer.isBuffer(c) ? c : Buffer.from(c)); if (remaining === 0) { source.destroy(); break; } }
    if (remaining > 0) { const z = Buffer.alloc(remaining); hash.update(z); await this.put(z); }
    const pad = (BLOCK - (size % BLOCK)) % BLOCK;
    if (pad) await this.put(Buffer.alloc(pad));
    return { bytes: size, sha256: hash.digest('hex') };
  }

  /** Escreve os dois blocos zerados finais e encerra o destino. */
  async finish(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    await this.put(Buffer.alloc(BLOCK * 2));
    await new Promise<void>((res, rej) => { this.out.once('error', rej); this.out.end(res); });
  }
}

/** Leitor mínimo (para testes e verificação): devolve nome → conteúdo. Suporta PAX 'path'. */
export function readTar(buf: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let off = 0;
  let paxPath: string | null = null;
  while (off + BLOCK <= buf.length) {
    const h = buf.subarray(off, off + BLOCK);
    if (h.every((x) => x === 0)) break;
    const str = (s: number, l: number) => h.subarray(s, s + l).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(str(124, 12).trim() || '0', 8);
    const type = String.fromCharCode(h[156]);
    const name = (str(345, 155) ? str(345, 155) + '/' : '') + str(0, 100);
    off += BLOCK;
    const data = buf.subarray(off, off + size);
    off += Math.ceil(size / BLOCK) * BLOCK;
    if (type === 'x') {
      const m = /\d+ path=([^\n]*)\n/.exec(data.toString('utf8'));
      if (m) paxPath = m[1];
      continue;
    }
    files.set(paxPath ?? name, Buffer.from(data));
    paxPath = null;
  }
  return files;
}
