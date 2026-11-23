import crypto from 'crypto';
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet, type JWTPayload } from 'jose';
import { redis } from '../../services/queue';
import { logIntegration } from '../core/integrations';
import type { IntegrationType } from '../core/types';
import { randomToken } from '../core/crypto';
import { basicAuth, formBody, IntegrationError, parseJsonSafe, type HttpClient } from './http-client';

/** Utilitários compartilhados pelos fluxos OIDC (GOV.BR e IdP do TJTO) e pelo registro de chamadas. */

export interface Deps { http?: HttpClient }

/** Executa `fn`, registra em BvIntegrationLog (duração, sucesso, CÓDIGO do erro — nunca corpo/dados pessoais). */
export async function logged<T>(orgId: string, type: IntegrationType, operation: string, fn: () => Promise<T>, meta?: Record<string, unknown>): Promise<T> {
  const t0 = Date.now();
  try {
    const out = await fn();
    await logIntegration(orgId, type, operation, true, { durationMs: Date.now() - t0, meta });
    return out;
  } catch (err: any) {
    await logIntegration(orgId, type, operation, false, { durationMs: Date.now() - t0, error: err instanceof IntegrationError ? err.code : 'unexpected', meta });
    throw err;
  }
}

// ── Armazenamento de uso único com TTL (Redis) ──────────────────────────────────────────────────
const KEY = (ns: string, id: string) => `bv:int:${ns}:${crypto.createHash('sha256').update(id).digest('hex')}`;

export async function putOnce(ns: string, id: string, data: unknown, ttlSec: number): Promise<void> {
  await redis.set(KEY(ns, id), JSON.stringify(data), 'EX', ttlSec);
}
/** Lê e apaga atomicamente (uso único). Retorna null se não existe/expirou/já usado. */
export async function takeOnce<T = any>(ns: string, id: string): Promise<T | null> {
  const res = await redis.multi().get(KEY(ns, id)).del(KEY(ns, id)).exec();
  const raw = res?.[0]?.[1] as string | null | undefined;
  return raw ? (parseJsonSafe<T>(raw)) : null;
}

/** Rate limit simples (janela fixa); fail-open se o Redis falhar. */
export async function hitLimit(ns: string, id: string, max: number, windowSec: number): Promise<boolean> {
  const key = `bv:int:rl:${ns}:${id.slice(0, 80)}`;
  try {
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, windowSec);
    return n <= max;
  } catch { return true; }
}

// ── PKCE / OIDC ─────────────────────────────────────────────────────────────────────────────────
export const pkceChallenge = (verifier: string) => crypto.createHash('sha256').update(verifier).digest('base64url');
export const newPkce = () => { const verifier = randomToken(48); return { verifier, challenge: pkceChallenge(verifier) }; };

export interface OidcClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  issuer: string;
  authorizeUrl: string;
  tokenUrl: string;
  jwksUri: string;
  userinfoUrl?: string;
  scopes?: string[] | string;
  tokenAuthMethod?: 'basic' | 'post';
  allowPrivateHosts?: boolean;
  timeoutMs?: number;
}

export const scopeString = (s: string[] | string | undefined, fallback = 'openid') => (Array.isArray(s) ? s.join(' ') : s) || fallback;

export function buildAuthorizeUrl(cfg: OidcClientConfig, p: { state: string; nonce: string; challenge: string; extra?: Record<string, string> }): string {
  const u = new URL(cfg.authorizeUrl);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('redirect_uri', cfg.redirectUri);
  u.searchParams.set('scope', scopeString(cfg.scopes));
  u.searchParams.set('state', p.state);
  u.searchParams.set('nonce', p.nonce);
  u.searchParams.set('code_challenge', p.challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  for (const [k, v] of Object.entries(p.extra ?? {})) u.searchParams.set(k, v);
  return u.toString();
}

export interface TokenSet { idToken: string; accessToken?: string }

export async function exchangeCode(cfg: OidcClientConfig, http: HttpClient, code: string, verifier: string): Promise<TokenSet> {
  const params: Record<string, string> = { grant_type: 'authorization_code', code, redirect_uri: cfg.redirectUri, code_verifier: verifier };
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };
  if ((cfg.tokenAuthMethod ?? 'basic') === 'basic') headers.authorization = basicAuth(encodeURIComponent(cfg.clientId), encodeURIComponent(cfg.clientSecret));
  else { params.client_id = cfg.clientId; params.client_secret = cfg.clientSecret; }
  const res = await http.request({ method: 'POST', url: cfg.tokenUrl, headers, body: formBody(params) });
  if (res.status < 200 || res.status >= 300) throw new IntegrationError('oidc.token_rejected', `Troca de código recusada (HTTP ${res.status})`, res.status);
  const j = parseJsonSafe<{ id_token?: string; access_token?: string }>(res.text);
  if (!j?.id_token) throw new IntegrationError('oidc.no_id_token', 'Resposta sem id_token');
  return { idToken: j.id_token, accessToken: j.access_token };
}

const jwksCache = new Map<string, { at: number; keys: JSONWebKeySet }>();
const JWKS_TTL_MS = 5 * 60_000;
export const clearJwksCache = () => jwksCache.clear();

async function loadJwks(cfg: OidcClientConfig, http: HttpClient, force: boolean): Promise<JSONWebKeySet> {
  const hit = jwksCache.get(cfg.jwksUri);
  if (hit && !force && Date.now() - hit.at < JWKS_TTL_MS) return hit.keys;
  const res = await http.request({ url: cfg.jwksUri, headers: { accept: 'application/json' } });
  const keys = parseJsonSafe<JSONWebKeySet>(res.text);
  if (res.status !== 200 || !keys || !Array.isArray(keys.keys)) throw new IntegrationError('oidc.jwks_unavailable', 'JWKS indisponível');
  jwksCache.set(cfg.jwksUri, { at: Date.now(), keys });
  return keys;
}

/** Verifica assinatura (JWKS), iss, aud, exp/nbf e nonce do id_token. Refaz o JWKS uma vez se a chave (kid) não for achada. */
export async function verifyIdToken(cfg: OidcClientConfig, http: HttpClient, idToken: string, expectedNonce: string): Promise<JWTPayload> {
  const opts = { issuer: cfg.issuer, audience: cfg.clientId, algorithms: ['RS256', 'PS256', 'ES256'], clockTolerance: 30 };
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(idToken, createLocalJWKSet(await loadJwks(cfg, http, false)), opts));
  } catch (err: any) {
    if (err?.code !== 'ERR_JWKS_NO_MATCHING_KEY') throw mapJoseError(err);
    try { ({ payload } = await jwtVerify(idToken, createLocalJWKSet(await loadJwks(cfg, http, true)), opts)); } catch (e2: any) { throw mapJoseError(e2); }
  }
  const nonce = typeof payload.nonce === 'string' ? payload.nonce : '';
  if (!nonce || nonce.length !== expectedNonce.length || !crypto.timingSafeEqual(Buffer.from(nonce), Buffer.from(expectedNonce))) throw new IntegrationError('oidc.nonce_mismatch', 'nonce inválido');
  if (typeof payload.sub !== 'string' || !payload.sub) throw new IntegrationError('oidc.no_sub', 'id_token sem sub');
  return payload;
}
function mapJoseError(err: any): IntegrationError {
  if (err instanceof IntegrationError) return err;
  return new IntegrationError('oidc.invalid_id_token', `id_token inválido (${String(err?.code ?? 'erro')})`);
}

// ── Páginas HTML mínimas e acessíveis ───────────────────────────────────────────────────────────
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function htmlPage(title: string, message: string, kind: 'ok' | 'error'): string {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>body{font-family:system-ui,sans-serif;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#f5f7fa;color:#14213d}
main{max-width:32rem;margin:1rem;padding:2rem;background:#fff;border-radius:.5rem;border:2px solid ${kind === 'ok' ? '#1b7f3b' : '#b3261e'}}
h1{font-size:1.4rem;margin-top:0}p{font-size:1.1rem;line-height:1.5}</style></head>
<body><main role="${kind === 'ok' ? 'status' : 'alert'}"><h1>${esc(title)}</h1><p>${esc(message)}</p></main></body></html>`;
}

export const SECURITY_HEADERS = {
  'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
} as const;

export function publicBaseUrl(): string {
  return (process.env.BV_PUBLIC_API_URL || process.env.API_PUBLIC_URL || 'https://api.zapscript.me').replace(/\/+$/, '');
}
