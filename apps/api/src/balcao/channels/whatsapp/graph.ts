import axios from 'axios';
import { logger } from '../../../lib/logger';

/**
 * Cliente mínimo da Graph API (WhatsApp Cloud API) do Balcão Virtual.
 * - HTTP injetável (`setWaHttp`) e política de retry/backoff configurável (`configureWaRuntime`) — testes não usam rede.
 * - Erros da Graph viram `GraphError` com `errorCode` estável (`whatsapp.*`) que o sender repassa ao núcleo.
 */

export interface WaConfig {
  accessToken: string;
  phoneNumberId: string;
  wabaId: string;
  appSecret: string;
  verifyToken: string;
  graphVersion?: string;
  /** Só honrado em dev/teste (BV_DEV_SIMULATORS=1 ou NODE_ENV=test): permite apontar para um servidor local que imita a Graph. */
  apiBase?: string;
  /** Só honrado com BV_DEV_SIMULATORS=1: não chama a Graph e marca as mensagens como SENT. */
  mock?: boolean;
}

export const DEFAULT_GRAPH_VERSION = 'v23.0';
export const GRAPH_HOST = 'https://graph.facebook.com';

export const devSimulatorsEnabled = (): boolean => process.env.BV_DEV_SIMULATORS === '1';
export const customApiBaseAllowed = (): boolean => devSimulatorsEnabled() || process.env.NODE_ENV === 'test';
export const isMock = (cfg: Pick<WaConfig, 'mock'>): boolean => cfg.mock === true && devSimulatorsEnabled();

export function apiBaseOf(cfg: Pick<WaConfig, 'apiBase'>): string {
  return cfg.apiBase && customApiBaseAllowed() ? cfg.apiBase.replace(/\/+$/, '') : GRAPH_HOST;
}

// ── HTTP injetável ───────────────────────────────────────────────────────────
export interface WaHttpRequest {
  method: 'GET' | 'POST' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  params?: Record<string, string | number | undefined>;
  data?: unknown;
  binary?: boolean;
  timeoutMs?: number;
}
export interface WaHttpResponse { status: number; data: any; headers: Record<string, any> }
/** Nunca lança por status HTTP; lança (com `.code`) só em falha de rede/timeout. */
export type WaHttp = (req: WaHttpRequest) => Promise<WaHttpResponse>;

const axiosHttp: WaHttp = async (r) => {
  const res = await axios.request({
    method: r.method, url: r.url, headers: r.headers, params: r.params, data: r.data,
    responseType: r.binary ? 'arraybuffer' : 'json', timeout: r.timeoutMs ?? 20_000,
    validateStatus: () => true, maxContentLength: 110 * 1024 * 1024, maxBodyLength: 110 * 1024 * 1024, maxRedirects: 0,
  });
  return { status: res.status, data: res.data, headers: res.headers as any };
};

export const waRuntime = {
  http: axiosHttp as WaHttp,
  maxAttempts: 3,
  baseDelayMs: 400,
  maxDelayMs: 5_000,
  timeoutMs: 20_000,
  sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  /** Atrasos (ms) das novas tentativas quando o status chega antes de a mensagem de saída ter o wamid gravado. */
  statusRetryDelaysMs: [500, 2_000, 5_000] as number[],
};
export function configureWaRuntime(p: Partial<Omit<typeof waRuntime, 'http'>>): void { Object.assign(waRuntime, p); }
export function setWaHttp(fn: WaHttp | null): void { waRuntime.http = fn ?? axiosHttp; }

// ── Erros ────────────────────────────────────────────────────────────────────
const RATE_CODES = new Set([4, 17, 32, 613, 80007, 130429, 131056]);
const TRANSIENT_CODES = new Set([1, 2]);

/** Mapeia o código de erro da Graph para um errorCode estável do Balcão. */
export function mapGraphErrorCode(graphCode: number | null | undefined, httpStatus = 0): string {
  switch (graphCode) {
    case 131047: return 'whatsapp.outside_window';
    case 131026: case 131030: case 131021: return 'whatsapp.invalid_recipient';
    case 130429: case 131056: case 131048: case 80007: case 4: case 17: case 32: case 613: return 'whatsapp.rate_limited';
    case 132001: case 132015: case 132016: return 'whatsapp.template_not_approved';
    case 132000: case 132005: case 132007: case 132012: case 132018: return 'whatsapp.template_params_mismatch';
    case 190: case 10: case 102: case 131005: return 'whatsapp.auth_failed';
    case 131042: return 'whatsapp.payment_issue';
    case 131031: case 368: return 'whatsapp.account_restricted';
    case 131049: return 'whatsapp.not_delivered_policy';
    case 131051: return 'whatsapp.unsupported_message_type';
    case 131052: case 131053: return 'whatsapp.media_error';
    case 131009: return 'whatsapp.invalid_parameter';
    case 131008: return 'whatsapp.invalid_parameter';
    default: break;
  }
  if (graphCode != null && graphCode >= 200 && graphCode <= 299) return 'whatsapp.auth_failed';
  if (httpStatus === 429) return 'whatsapp.rate_limited';
  if (httpStatus === 401 || httpStatus === 403) return 'whatsapp.auth_failed';
  if (httpStatus >= 500) return 'whatsapp.unavailable';
  return 'whatsapp.send_failed';
}

export class GraphError extends Error {
  constructor(
    message: string, public errorCode: string, public httpStatus: number,
    public graphCode: number | null, public retryable: boolean, public retryAfterMs?: number,
  ) { super(message); }
}

function toGraphError(res: WaHttpResponse): GraphError {
  const e = res.data?.error ?? {};
  const code = typeof e.code === 'number' ? e.code : null;
  const retryable = res.status >= 500 || res.status === 429 || (code != null && (RATE_CODES.has(code) || TRANSIENT_CODES.has(code)));
  const ra = Number(res.headers?.['retry-after']);
  // A mensagem da Graph pode ecoar dados do pedido: guardamos só o resumo (tipo/código/título), sem corpo de mensagem.
  const msg = `Graph ${res.status}${code != null ? ` código ${code}` : ''}${e.error_subcode ? `/${e.error_subcode}` : ''}: ${String(e.error_user_title || e.message || 'erro').slice(0, 200)}`;
  return new GraphError(msg, mapGraphErrorCode(code, res.status), res.status, code, retryable, Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined);
}

export interface GraphCall {
  method: 'GET' | 'POST' | 'DELETE';
  /** Caminho relativo à versão (ex.: `${phoneNumberId}/messages`). */
  path: string;
  params?: Record<string, string | number | undefined>;
  json?: unknown;
  multipart?: { fields: Record<string, string>; file: { field: string; name: string; mime: string; data: Buffer } };
  /** URL absoluta (download de mídia): ignora versão/base; mantém o Bearer. */
  absoluteUrl?: string;
  binary?: boolean;
  /** POST não idempotente: não repete em timeout (resultado desconhecido) para não duplicar a mensagem. */
  noRetryOnTimeout?: boolean;
}

function buildMultipart(m: NonNullable<GraphCall['multipart']>): { body: Buffer; contentType: string } {
  const boundary = `----bv${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(m.fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  const safeName = m.file.name.replace(/["\r\n]/g, '_');
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${m.file.field}"; filename="${safeName}"\r\nContent-Type: ${m.file.mime}\r\n\r\n`));
  parts.push(m.file.data, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

/** Chama a Graph com retry/backoff para 5xx, 429, limites de taxa e falhas de rede. Lança GraphError. */
export async function graphCall<T = any>(cfg: WaConfig, call: GraphCall): Promise<T> {
  const version = cfg.graphVersion || DEFAULT_GRAPH_VERSION;
  const url = call.absoluteUrl ?? `${apiBaseOf(cfg)}/${version}/${call.path.replace(/^\/+/, '')}`;
  const headers: Record<string, string> = { Authorization: `Bearer ${cfg.accessToken}` };
  let data: unknown = call.json;
  if (call.multipart) {
    const mp = buildMultipart(call.multipart);
    data = mp.body; headers['Content-Type'] = mp.contentType;
  } else if (call.json !== undefined) headers['Content-Type'] = 'application/json';

  let last: GraphError | null = null;
  for (let attempt = 1; attempt <= Math.max(1, waRuntime.maxAttempts); attempt++) {
    try {
      const res = await waRuntime.http({ method: call.method, url, headers, params: call.params, data, binary: call.binary, timeoutMs: waRuntime.timeoutMs });
      if (res.status >= 200 && res.status < 300) return res.data as T;
      const err = toGraphError(res.data instanceof Buffer || call.binary ? { ...res, data: safeJson(res.data) } : res);
      if (!err.retryable) throw err;
      last = err;
    } catch (e: any) {
      if (e instanceof GraphError) { if (!e.retryable) throw e; last = e; } else {
        const timeout = e?.code === 'ECONNABORTED' || e?.code === 'ETIMEDOUT';
        const ge = new GraphError(`Falha de rede ao chamar a Graph (${e?.code ?? 'erro'})`, 'whatsapp.network_error', 0, null, !(timeout && call.noRetryOnTimeout));
        if (!ge.retryable) throw ge;
        last = ge;
      }
    }
    if (attempt >= waRuntime.maxAttempts) break;
    const backoff = Math.min(waRuntime.maxDelayMs, waRuntime.baseDelayMs * 2 ** (attempt - 1));
    const delay = Math.min(waRuntime.maxDelayMs, last.retryAfterMs ?? backoff + Math.floor(Math.random() * Math.min(100, backoff)));
    logger.warn({ attempt, code: last.graphCode, status: last.httpStatus }, '[balcao/whatsapp] Graph falhou, nova tentativa');
    await waRuntime.sleep(delay);
  }
  throw last!;
}

function safeJson(d: unknown): any {
  try { return d instanceof Buffer ? JSON.parse(d.toString('utf8')) : d; } catch { return {}; }
}
