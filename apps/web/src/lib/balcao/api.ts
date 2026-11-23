'use client';
/**
 * Cliente HTTP do Balcão Virtual (API em `${NEXT_PUBLIC_API_URL}/balcao`). Independente do cliente do SaaS (lib/api.ts):
 * tokens próprios (bv_*), renovação single-flight entre abas (Web Locks) — o refresh ROTACIONA e reuso derruba a sessão,
 * então duas abas nunca podem renovar com o mesmo token.
 */
export const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL || 'https://api.zapscript.me';
const BASE = `${API_ORIGIN}/balcao`;
const K_ACCESS = 'bv_access', K_REFRESH = 'bv_refresh', K_EXP = 'bv_access_exp';

export class BvApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown, public headers?: Headers) { super(message); }
}

const ls = () => (typeof window === 'undefined' ? null : window.localStorage);
export const getAccessToken = () => ls()?.getItem(K_ACCESS) ?? null;
const getRefresh = () => ls()?.getItem(K_REFRESH) ?? null;

export interface SessionTokens { accessToken: string; refreshToken: string; expiresIn: number }
export function storeSession(t: SessionTokens) {
  const s = ls(); if (!s) return;
  s.setItem(K_ACCESS, t.accessToken); s.setItem(K_REFRESH, t.refreshToken); s.setItem(K_EXP, String(Date.now() + t.expiresIn * 1000));
  listeners.forEach((fn) => fn(t.accessToken));
}
export function clearSession() {
  const s = ls(); if (!s) return;
  s.removeItem(K_ACCESS); s.removeItem(K_REFRESH); s.removeItem(K_EXP);
  listeners.forEach((fn) => fn(null));
}
const listeners = new Set<(token: string | null) => void>();
/** Notifica quando o access token muda (login, refresh, logout). */
export function onTokenChange(fn: (token: string | null) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

async function rawFetch(path: string, init: RequestInit & { token?: string | null } = {}) {
  const { token, headers, ...rest } = init;
  const h = new Headers(headers);
  if (rest.body && !(rest.body instanceof FormData) && !h.has('Content-Type')) h.set('Content-Type', 'application/json');
  if (token) h.set('Authorization', `Bearer ${token}`);
  return fetch(`${BASE}${path}`, { ...rest, headers: h });
}

async function toError(res: Response): Promise<BvApiError> {
  let body: any = null;
  try { body = await res.json(); } catch { /* corpo vazio */ }
  const e = body?.error;
  return new BvApiError(res.status, e?.code ?? `http.${res.status}`, e?.message ?? 'Não foi possível concluir a operação.', e?.details, res.headers);
}

let refreshing: Promise<boolean> | null = null;
async function doRefresh(): Promise<boolean> {
  const run = async () => {
    // outra aba pode ter renovado enquanto esperávamos o lock: se o access mudou e ainda vale, basta usá-lo
    const refresh = getRefresh();
    if (!refresh) return false;
    const res = await rawFetch('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: refresh }) });
    if (!res.ok) return false;
    storeSession(await res.json());
    return true;
  };
  const locks = typeof navigator !== 'undefined' ? (navigator as any).locks : null;
  const before = getAccessToken();
  if (locks?.request) {
    return locks.request('bv-refresh', async () => {
      const now = getAccessToken(); const exp = Number(ls()?.getItem(K_EXP) ?? 0);
      if (now && now !== before && exp > Date.now() + 5000) return true; // outra aba já renovou
      return run();
    });
  }
  return run();
}
export function refreshSession(): Promise<boolean> {
  if (!refreshing) refreshing = doRefresh().finally(() => { refreshing = null; });
  return refreshing;
}

type Query = Record<string, string | number | boolean | null | undefined | string[]>;
const qs = (q?: Query) => {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v == null || v === '') continue;
    if (Array.isArray(v)) v.forEach((x) => p.append(k, x)); else p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
};

async function request<T>(method: string, path: string, opts: { body?: unknown; query?: Query; form?: FormData; auth?: boolean; raw?: boolean } = {}): Promise<T> {
  const auth = opts.auth !== false;
  const init = (): RequestInit & { token?: string | null } => ({
    method, token: auth ? getAccessToken() : null,
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  let res = await rawFetch(path + qs(opts.query), init());
  if (res.status === 401 && auth && !path.startsWith('/auth/')) {
    if (await refreshSession()) res = await rawFetch(path + qs(opts.query), init());
    else { clearSession(); if (typeof window !== 'undefined' && !location.pathname.startsWith('/balcao/login')) location.href = '/balcao/login?sessao=expirada'; }
  }
  if (!res.ok) throw await toError(res);
  if (opts.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  return (ct.includes('application/json') ? await res.json() : await res.text()) as T;
}

export const bv = {
  get: <T = any>(path: string, query?: Query) => request<T>('GET', path, { query }),
  post: <T = any>(path: string, body?: unknown, query?: Query) => request<T>('POST', path, { body, query }),
  put: <T = any>(path: string, body?: unknown) => request<T>('PUT', path, { body }),
  patch: <T = any>(path: string, body?: unknown) => request<T>('PATCH', path, { body }),
  del: <T = any>(path: string) => request<T>('DELETE', path),
  upload: <T = any>(path: string, form: FormData) => request<T>('POST', path, { form }),
  /** Rotas públicas (login etc.): sem Authorization e sem tentativa de refresh. */
  anon: { post: <T = any>(path: string, body?: unknown) => request<T>('POST', path, { body, auth: false }) },
  /** Baixa um arquivo autenticado (CSV, exportações) e dispara o download no navegador. */
  async download(path: string, filename: string, query?: Query) {
    const res = await request<Response>('GET', path, { query, raw: true });
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },
  /** Busca um recurso autenticado como Blob → object URL (reprodução de gravações, anexos). Chame URL.revokeObjectURL depois. */
  async blobUrl(path: string, query?: Query): Promise<string> {
    const res = await request<Response>('GET', path, { query, raw: true });
    return URL.createObjectURL(await res.blob());
  },
};

/** Mensagem amigável a partir de qualquer erro. */
export function errMsg(e: unknown, fallback = 'Não foi possível concluir a operação.'): string {
  return e instanceof BvApiError ? e.message : e instanceof Error ? e.message : fallback;
}
