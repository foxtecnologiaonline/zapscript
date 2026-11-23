import dns from 'dns';
import http from 'http';
import https from 'https';
import net from 'net';

/**
 * Cliente HTTP endurecido para integrações: timeout, tamanho máximo de resposta, sem redirecionamento
 * automático e bloqueio de SSRF (hosts privados/loopback/link-local/metadata — checado na resolução DNS,
 * o que também cobre DNS rebinding). Os adaptadores recebem um `HttpClient` injetável (testes usam fakes).
 */

export class IntegrationError extends Error {
  constructor(public code: string, message: string, public status?: number, public retryable = false) { super(message); }
}

export interface HttpRequest {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  timeoutMs?: number;
  maxBytes?: number;
}
export interface HttpResponse { status: number; headers: Record<string, string>; text: string; durationMs: number }
export interface HttpClient { request(req: HttpRequest): Promise<HttpResponse> }

export interface HttpPolicy {
  /** Permite hosts privados/loopback. Só vale fora de produção. */
  allowPrivateHosts: boolean;
  timeoutMs: number;
  maxResponseBytes: number;
}

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

/** Política a partir da config da integração. `allowPrivateHosts` é ignorado em produção. */
export function policyFromConfig(config: { allowPrivateHosts?: boolean; timeoutMs?: number; maxResponseBytes?: number } | null | undefined): HttpPolicy {
  return {
    allowPrivateHosts: config?.allowPrivateHosts === true && process.env.NODE_ENV !== 'production',
    timeoutMs: clamp(config?.timeoutMs ?? DEFAULT_TIMEOUT_MS, 500, 60_000),
    maxResponseBytes: clamp(config?.maxResponseBytes ?? DEFAULT_MAX_BYTES, 1024, 20 * 1024 * 1024),
  };
}
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

const blocked = new net.BlockList();
for (const [net4, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
] as Array<[string, number]>) blocked.addSubnet(net4, prefix, 'ipv4');
for (const [net6, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96], ['2001:db8::', 32]] as Array<[string, number]>) blocked.addSubnet(net6, prefix, 'ipv6');

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal', 'metadata', 'instance-data']);

/** true se o IP (v4/v6) é privado, loopback, link-local, multicast, reservado ou de metadata de nuvem. */
export function isBlockedIp(ip: string): boolean {
  const clean = ip.replace(/^\[|\]$/g, '').split('%')[0];
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(clean);
  if (mapped) return isBlockedIp(mapped[1]);
  const v = net.isIP(clean);
  if (v === 0) return true;
  return blocked.check(clean, v === 4 ? 'ipv4' : 'ipv6');
}

/** Checagem sintática (sem DNS) para validar config no PUT: esquema http(s) e host literal não-privado. */
export function validatePublicUrl(raw: string, policy: Pick<HttpPolicy, 'allowPrivateHosts'>): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return 'URL inválida'; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'Apenas http/https';
  if (u.username || u.password) return 'Credenciais na URL não são permitidas';
  if (policy.allowPrivateHosts) return null;
  if (process.env.NODE_ENV === 'production' && u.protocol !== 'https:') return 'Use https';
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.internal') || host.endsWith('.local') || host.endsWith('.localhost')) return 'Host não permitido';
  if (net.isIP(host) && isBlockedIp(host)) return 'Host não permitido';
  return null;
}

export function createHttpClient(policy: HttpPolicy): HttpClient {
  const safeLookup = (hostname: string, options: any, cb: any) => {
    if (typeof options === 'function') { cb = options; options = {}; }
    dns.lookup(hostname, { ...options, all: true }, (err, addrs: any) => {
      if (err) return cb(err);
      const list: Array<{ address: string; family: number }> = Array.isArray(addrs) ? addrs : [{ address: addrs, family: net.isIP(addrs) }];
      if (!policy.allowPrivateHosts && list.some((a) => isBlockedIp(a.address))) return cb(new IntegrationError('http.ssrf_blocked', 'Host não permitido'));
      if (options?.all) return cb(null, list);
      return cb(null, list[0].address, list[0].family);
    });
  };

  return {
    request(req: HttpRequest): Promise<HttpResponse> {
      return new Promise<HttpResponse>((resolve, reject) => {
        let u: URL;
        try { u = new URL(req.url); } catch { return reject(new IntegrationError('http.bad_url', 'URL inválida')); }
        if (u.protocol !== 'https:' && u.protocol !== 'http:') return reject(new IntegrationError('http.bad_url', 'Esquema não permitido'));
        if (u.username || u.password) return reject(new IntegrationError('http.bad_url', 'Credenciais na URL não permitidas'));
        const host = u.hostname.replace(/^\[|\]$/g, '');
        if (!policy.allowPrivateHosts) {
          if (BLOCKED_HOSTNAMES.has(host.toLowerCase()) || (net.isIP(host) && isBlockedIp(host))) return reject(new IntegrationError('http.ssrf_blocked', 'Host não permitido'));
        }
        const timeoutMs = req.timeoutMs ?? policy.timeoutMs;
        const maxBytes = Math.min(req.maxBytes ?? policy.maxResponseBytes, policy.maxResponseBytes);
        const started = Date.now();
        const mod = u.protocol === 'https:' ? https : http;
        const headers: Record<string, string> = { accept: '*/*', 'user-agent': 'BalcaoVirtual/1.0', ...(req.headers ?? {}) };
        if (req.body !== undefined) headers['content-length'] = String(Buffer.byteLength(req.body));
        let settled = false;
        const done = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); fn(); } };
        const r = mod.request({
          protocol: u.protocol, hostname: host, port: u.port || undefined, path: `${u.pathname}${u.search}`,
          method: req.method ?? 'GET', headers, lookup: safeLookup as any, agent: false,
        }, (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (c: Buffer) => {
            size += c.length;
            if (size > maxBytes) { r.destroy(); res.destroy(); return done(() => reject(new IntegrationError('http.too_large', 'Resposta excede o tamanho máximo'))); }
            chunks.push(c);
          });
          res.on('end', () => done(() => {
            const h: Record<string, string> = {};
            for (const [k, v] of Object.entries(res.headers)) h[k] = Array.isArray(v) ? v.join(', ') : String(v ?? '');
            resolve({ status: res.statusCode ?? 0, headers: h, text: Buffer.concat(chunks).toString('utf8'), durationMs: Date.now() - started });
          }));
          res.on('error', () => done(() => reject(new IntegrationError('http.network', 'Falha de rede', undefined, true))));
        });
        const timer = setTimeout(() => { r.destroy(); done(() => reject(new IntegrationError('http.timeout', 'Tempo esgotado', undefined, true))); }, timeoutMs);
        r.on('error', (err: any) => done(() => {
          if (err instanceof IntegrationError) return reject(err);
          reject(new IntegrationError('http.network', 'Falha de rede', undefined, true));
        }));
        if (req.body !== undefined) r.write(req.body);
        r.end();
      });
    },
  };
}

/** Cliente padrão para uma config (SSRF + timeout + limite de tamanho vindos da própria config). */
export const httpClientFor = (config: Parameters<typeof policyFromConfig>[0]): HttpClient => createHttpClient(policyFromConfig(config));

/** Utilitários de corpo. */
export const formBody = (o: Record<string, string>) => new URLSearchParams(o).toString();
export function parseJsonSafe<T = any>(text: string): T | null {
  try { return JSON.parse(text) as T; } catch { return null; }
}
export const basicAuth = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;
