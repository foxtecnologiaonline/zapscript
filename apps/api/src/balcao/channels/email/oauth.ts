import axios from 'axios';
import crypto from 'crypto';
import type { EmailConfig, ImapConfig, OAuth2Auth, SmtpConfig } from './types';

/**
 * OAuth2 (Google Workspace) para IMAP (XOAUTH2) e SMTP: a config guarda `auth {type:'oauth2', clientId, clientSecret, refreshToken, user, tokenUrl?}`
 * (cifrada em repouso, mascarada nas respostas). O access token é obtido/renovado AUTOMATICAMENTE com o refresh token e fica em cache até ~1 min
 * antes de expirar; chamadas concorrentes dividem uma única renovação. Busca do token e relógio são injetáveis (testes).
 */
export const DEFAULT_TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** Margem: renova quando faltar menos que isto para expirar. */
export const REFRESH_SKEW_MS = 60_000;

export class OAuthError extends Error {
  constructor(message: string, public code: 'oauth2.refresh_failed' | 'oauth2.invalid_token_url' | 'oauth2.unreachable', public oauthError?: string) { super(message); }
}

export interface TokenResponse { accessToken: string; expiresInSec: number }
export type TokenFetcher = (auth: OAuth2Auth, tokenUrl: string) => Promise<TokenResponse>;

/** http só é aceito em teste/dev explícito (BV_EMAIL_OAUTH_ALLOW_HTTP=1): o refresh token e o client secret vão no corpo da requisição. */
export function assertTokenUrl(url: string): void {
  let u: URL;
  try { u = new URL(url); } catch { throw new OAuthError('tokenUrl inválida', 'oauth2.invalid_token_url'); }
  const insecureOk = process.env.NODE_ENV === 'test' || process.env.BV_EMAIL_OAUTH_ALLOW_HTTP === '1';
  if (u.protocol !== 'https:' && !(insecureOk && u.protocol === 'http:')) throw new OAuthError('tokenUrl deve usar https', 'oauth2.invalid_token_url');
  if (u.username || u.password) throw new OAuthError('tokenUrl não pode conter credenciais', 'oauth2.invalid_token_url');
}

const defaultFetcher: TokenFetcher = async (auth, tokenUrl) => {
  let res;
  try {
    res = await axios.post(tokenUrl, new URLSearchParams({
      grant_type: 'refresh_token', client_id: auth.clientId, client_secret: auth.clientSecret, refresh_token: auth.refreshToken,
    }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, timeout: 10_000, maxRedirects: 0, validateStatus: () => true });
  } catch (err: any) { throw new OAuthError(`Servidor de token inacessível: ${String(err?.code ?? err?.message ?? 'erro').slice(0, 80)}`, 'oauth2.unreachable'); }
  const body = (res.data && typeof res.data === 'object' ? res.data : {}) as Record<string, unknown>;
  if (res.status !== 200 || typeof body.access_token !== 'string' || !body.access_token) {
    const code = typeof body.error === 'string' ? body.error.slice(0, 60) : `http_${res.status}`;
    const desc = typeof body.error_description === 'string' ? ` — ${body.error_description.slice(0, 120)}` : '';
    throw new OAuthError(`Renovação do token OAuth2 recusada (${code})${desc}`, 'oauth2.refresh_failed', code);
  }
  const exp = Number(body.expires_in);
  return { accessToken: body.access_token, expiresInSec: Number.isFinite(exp) && exp > 0 ? exp : 3600 };
};

let fetcher: TokenFetcher = defaultFetcher;
let now: () => number = () => Date.now();
const cache = new Map<string, { token: string; expiresAt: number }>();
const inflight = new Map<string, Promise<string>>();
/** Segredos vistos (tokens de acesso) — removidos de mensagens de erro por `scrubSecrets`. */
const seen = new Set<string>();

/** Troca a busca do token (testes). Sem argumento, restaura a HTTP real. */
export const setOAuthTokenFetcher = (f?: TokenFetcher) => { fetcher = f ?? defaultFetcher; };
/** Troca o relógio (testes). Sem argumento, restaura Date.now. */
export const setOAuthClock = (fn?: () => number) => { now = fn ?? (() => Date.now()); };
export const clearOAuthTokenCache = () => { cache.clear(); inflight.clear(); };

const keyOf = (a: OAuth2Auth, url: string) => crypto.createHash('sha256').update([url, a.clientId, a.clientSecret, a.refreshToken, a.user].join('\0')).digest('hex');

/** Access token válido (cache até REFRESH_SKEW_MS antes de expirar). `force` ignora o cache (ex.: servidor recusou o token). */
export async function getAccessToken(auth: OAuth2Auth, opts: { force?: boolean } = {}): Promise<string> {
  const url = auth.tokenUrl || DEFAULT_TOKEN_URL;
  assertTokenUrl(url);
  const key = keyOf(auth, url);
  const hit = cache.get(key);
  if (!opts.force && hit && hit.expiresAt - REFRESH_SKEW_MS > now()) return hit.token;
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = (async () => {
    const t = await fetcher(auth, url);
    cache.set(key, { token: t.accessToken, expiresAt: now() + t.expiresInSec * 1000 });
    seen.add(t.accessToken); if (seen.size > 50) seen.delete(seen.values().next().value as string);
    return t.accessToken;
  })();
  inflight.set(key, p);
  try { return await p; } finally { inflight.delete(key); }
}

/** Remove segredos OAuth2 conhecidos de um texto de erro. */
export function scrubSecrets(text: string, auth?: Partial<OAuth2Auth> | null): string {
  let m = text;
  for (const s of [...seen, auth?.clientSecret, auth?.refreshToken]) if (s && s.length >= 6) m = m.split(s).join('••••');
  return m;
}

export const isOAuth = (cfg: Pick<EmailConfig, 'auth'>): cfg is Pick<EmailConfig, 'auth'> & { auth: OAuth2Auth } => cfg.auth?.type === 'oauth2';

/** IMAP efetivo: com OAuth2, usuário da conta + access token (XOAUTH2) e sem senha. */
export async function resolveImapConfig(cfg: EmailConfig, opts: { force?: boolean } = {}): Promise<ImapConfig> {
  if (!isOAuth(cfg)) return cfg.imap;
  const { pass: _pass, ...rest } = cfg.imap;
  return { ...rest, user: cfg.auth.user, accessToken: await getAccessToken(cfg.auth, opts) };
}

/** SMTP efetivo: com OAuth2, o nodemailer usa `auth: {type:'OAuth2', user, accessToken}`. */
export async function resolveSmtpConfig(cfg: EmailConfig, opts: { force?: boolean } = {}): Promise<SmtpConfig> {
  if (!isOAuth(cfg)) return cfg.smtp;
  const { pass: _pass, ...rest } = cfg.smtp;
  return { ...rest, user: cfg.auth.user, accessToken: await getAccessToken(cfg.auth, opts) };
}

/** O servidor recusou a credencial (token expirado/revogado antes do previsto)? */
export function isAuthFailure(err: any): boolean {
  if (err?.authenticationFailed === true) return true;
  const rc = Number(err?.responseCode ?? 0);
  if (rc === 535 || rc === 534 || rc === 401) return true;
  return /AUTHENTICATIONFAILED|authentication failed|invalid credentials|XOAUTH2|invalid_?token|unauthori[sz]ed/i.test(String(err?.responseText ?? err?.response ?? err?.message ?? ''));
}
