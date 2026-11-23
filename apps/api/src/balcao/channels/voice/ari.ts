import axios, { type AxiosInstance } from 'axios';
import WebSocket from 'ws';
import { logger } from '../../../lib/logger';

/** Camada fina sobre o ARI do Asterisk: HTTP (REST) e WebSocket de eventos, ambos injetáveis para teste. */
export class AriError extends Error {
  constructor(public status: number, message: string, public body?: unknown) { super(message); }
  /** Canal/bridge/playback já não existe (corrida normal em desligamentos). */
  get gone() { return this.status === 404 || this.status === 409 || this.status === 422; }
}

export interface AriRequest { query?: Record<string, string | number | boolean | string[] | undefined>; body?: unknown; binary?: boolean }
export interface AriHttp { request<T = any>(method: 'GET' | 'POST' | 'DELETE' | 'PUT', path: string, o?: AriRequest): Promise<T> }

export function createAxiosAriHttp(c: { url: string; username: string; password: string }): AriHttp {
  const http: AxiosInstance = axios.create({ baseURL: `${c.url.replace(/\/+$/, '')}/ari`, auth: { username: c.username, password: c.password }, timeout: 8000, validateStatus: () => true });
  return {
    async request(method, path, o = {}) {
      const params: Record<string, string> = {};
      for (const [k, v] of Object.entries(o.query ?? {})) if (v !== undefined) params[k] = Array.isArray(v) ? v.join(',') : String(v);
      const res = await http.request({ method, url: path, params, data: o.body, responseType: o.binary ? 'arraybuffer' : 'json' });
      if (res.status >= 400) throw new AriError(res.status, `ARI ${method} ${path} → ${res.status}`, o.binary ? undefined : res.data);
      return (o.binary ? Buffer.from(res.data) : res.data) as any;
    },
  };
}

// ── Tipos mínimos dos eventos ───────────────────────────────────────────────────────────────────────
export interface AriChannel { id: string; name?: string; state?: string; caller?: { name?: string; number?: string }; dialplan?: { context?: string; exten?: string }; channelvars?: Record<string, string> }
export interface AriEvent {
  type: string;
  channel?: AriChannel;
  args?: string[];
  digit?: string;
  duration_ms?: number;
  cause?: number;
  cause_txt?: string;
  playback?: { id: string; state?: string; target_uri?: string };
  recording?: { name: string; state?: string; format?: string; cause?: string };
  [k: string]: any;
}

// ── WebSocket de eventos ────────────────────────────────────────────────────────────────────────────
export interface AriSocketLike {
  on(event: 'open', cb: () => void): unknown;
  on(event: 'message', cb: (data: any) => void): unknown;
  on(event: 'close', cb: () => void): unknown;
  on(event: 'error', cb: (err: Error) => void): unknown;
  close(): void;
  terminate?(): void;
}
export type AriSocketFactory = (url: string) => AriSocketLike;
export const defaultSocketFactory: AriSocketFactory = (url) => new WebSocket(url) as unknown as AriSocketLike;

export interface BackoffOptions { baseMs?: number; maxMs?: number }

/** Conexão persistente com reconexão exponencial (com jitter). `status()` expõe saúde para o /status. */
export class AriEventStream {
  private sock: AriSocketLike | null = null;
  private timer: NodeJS.Timeout | null = null;
  private stopped = true;
  private attempt = 0;
  connected = false;
  reconnects = 0;
  lastEventAt: Date | null = null;
  lastError: string | null = null;

  constructor(
    private conn: { url: string; username: string; password: string; app: string },
    private onEvent: (ev: AriEvent) => void,
    private opts: { socketFactory?: AriSocketFactory; backoff?: BackoffOptions; onOpen?: () => void; onClose?: () => void } = {},
  ) {}

  wsUrl(): string {
    const base = this.conn.url.replace(/^http/i, 'ws');
    return `${base}/ari/events?app=${encodeURIComponent(this.conn.app)}&api_key=${encodeURIComponent(`${this.conn.username}:${this.conn.password}`)}`;
  }

  start() { this.stopped = false; this.connect(); }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try { this.sock?.close(); } catch { /* noop */ }
    this.sock = null; this.connected = false;
  }

  private connect() {
    if (this.stopped) return;
    let s: AriSocketLike;
    try { s = (this.opts.socketFactory ?? defaultSocketFactory)(this.wsUrl()); } catch (err: any) { this.lastError = err?.message; return this.scheduleReconnect(); }
    this.sock = s;
    s.on('open', () => { this.connected = true; this.attempt = 0; this.lastError = null; logger.info({ app: this.conn.app }, '[balcao/voice] ARI conectado'); this.opts.onOpen?.(); });
    s.on('message', (data) => {
      this.lastEventAt = new Date();
      try { this.onEvent(JSON.parse(typeof data === 'string' ? data : data.toString())); } catch (err: any) { logger.warn({ err: err?.message }, '[balcao/voice] evento ARI inválido'); }
    });
    s.on('error', (err) => { this.lastError = err.message; });
    s.on('close', () => {
      if (this.sock !== s) return;
      this.connected = false; this.sock = null;
      this.opts.onClose?.();
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect() {
    if (this.stopped || this.timer) return;
    const { baseMs = 1000, maxMs = 30_000 } = this.opts.backoff ?? {};
    const delay = Math.min(maxMs, baseMs * 2 ** this.attempt) * (0.8 + Math.random() * 0.4);
    this.attempt++;
    this.timer = setTimeout(() => { this.timer = null; this.reconnects++; this.connect(); }, delay);
    this.timer.unref?.();
  }
}
