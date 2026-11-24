import net from 'net';
import fs from 'fs';

/**
 * Varredura antivírus opcional via ClamAV (clamd, protocolo INSTREAM). Ligado por BV_CLAMAV_HOST (+BV_CLAMAV_PORT, padrão 3310)
 * ou BV_CLAMAV_SOCKET (unix). Sem configuração → desligado (status 'skipped').
 * BV_CLAMAV_FAIL_MODE: 'closed' (padrão quando configurado: se o clamd não responder, o arquivo é RECUSADO) ou 'open'.
 */
export type ScanStatus = 'clean' | 'infected' | 'skipped' | 'error';
export interface ScanResult { status: ScanStatus; signature?: string; error?: string }

export class AttachmentRejectedError extends Error {
  constructor(public reason: 'infected' | 'scan_unavailable', public signature?: string) {
    super(reason === 'infected' ? `Arquivo recusado pelo antivírus${signature ? ` (${signature})` : ''}` : 'Antivírus indisponível: arquivo recusado');
  }
}

const enabled = () => !!(process.env.BV_CLAMAV_HOST || process.env.BV_CLAMAV_SOCKET);
const failClosed = () => (process.env.BV_CLAMAV_FAIL_MODE ?? 'closed') !== 'open';
export const antivirusEnabled = enabled;

function connect(): net.Socket {
  const sock = process.env.BV_CLAMAV_SOCKET
    ? net.createConnection({ path: process.env.BV_CLAMAV_SOCKET })
    : net.createConnection({ host: process.env.BV_CLAMAV_HOST!, port: Number(process.env.BV_CLAMAV_PORT ?? 3310) });
  sock.setTimeout(Number(process.env.BV_CLAMAV_TIMEOUT_MS ?? 30_000));
  return sock;
}

function parse(resp: string): ScanResult {
  const r = resp.replace(/\0/g, '').trim();
  if (/OK$/.test(r)) return { status: 'clean' };
  const m = /stream:\s*(.+?)\s+FOUND$/.exec(r);
  if (m) return { status: 'infected', signature: m[1] };
  return { status: 'error', error: r.slice(0, 120) || 'resposta vazia' };
}

/** Envia o conteúdo ao clamd (chunks de 64 KB). */
export async function scanStream(source: NodeJS.ReadableStream): Promise<ScanResult> {
  if (!enabled()) return { status: 'skipped' };
  return new Promise<ScanResult>((resolve) => {
    const sock = connect();
    let out = '';
    let done = false;
    const finish = (r: ScanResult) => { if (!done) { done = true; sock.destroy(); resolve(r); } };
    sock.on('data', (d) => { out += d.toString('utf8'); if (out.includes('\0') || out.includes('\n')) finish(parse(out)); });
    sock.on('end', () => finish(out ? parse(out) : { status: 'error', error: 'conexão encerrada' }));
    sock.on('timeout', () => finish({ status: 'error', error: 'timeout' }));
    sock.on('error', (e) => finish({ status: 'error', error: e.message }));
    sock.on('connect', () => {
      sock.write('zINSTREAM\0');
      source.on('data', (chunk: Buffer | string) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        for (let i = 0; i < buf.length; i += 65536) {
          const part = buf.subarray(i, i + 65536);
          const len = Buffer.alloc(4); len.writeUInt32BE(part.length, 0);
          sock.write(Buffer.concat([len, part]));
        }
      });
      source.on('end', () => sock.write(Buffer.alloc(4)));
      source.on('error', (e) => finish({ status: 'error', error: (e as Error).message }));
    });
  });
}

export async function scanBuffer(data: Buffer): Promise<ScanResult> {
  const { Readable } = await import('stream');
  return scanStream(Readable.from([data]));
}
export const scanFile = (path: string) => scanStream(fs.createReadStream(path));

/** Aplica a política: lança AttachmentRejectedError se infectado, ou se o antivírus falhou e o modo é 'closed'. */
export function enforceScan(r: ScanResult): void {
  if (r.status === 'infected') throw new AttachmentRejectedError('infected', r.signature);
  if (r.status === 'error' && failClosed()) throw new AttachmentRejectedError('scan_unavailable');
}
