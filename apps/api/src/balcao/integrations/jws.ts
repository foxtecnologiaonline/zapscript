import crypto from 'crypto';

/**
 * JWT/JWS mínimo com node:crypto (RS256/PS256/ES256). Usado no lugar do `jose` porque o jose v6 é ESM-only e o jest
 * da API (CommonJS/ts-jest) não consegue carregá-lo. Whitelist estrita de algoritmos: `none` e HS* (confusão de chave) nunca passam.
 */

export class JwsError extends Error { constructor(public code: string, message = code) { super(message); } }

export interface Jwk { kty: string; kid?: string; alg?: string; use?: string; n?: string; e?: string; crv?: string; x?: string; y?: string }
export interface Jwks { keys: Jwk[] }
export interface VerifyOptions { issuer: string; audience: string; algorithms?: string[]; clockToleranceSec?: number; now?: number }

const b64uJson = (s: string) => { try { return JSON.parse(Buffer.from(s, 'base64url').toString('utf8')); } catch { throw new JwsError('jws.malformed'); } };

const ALG = {
  RS256: { kty: 'RSA', verify: (data: Buffer, sig: Buffer, key: crypto.KeyObject) => crypto.verify('sha256', data, key, sig) },
  PS256: { kty: 'RSA', verify: (data: Buffer, sig: Buffer, key: crypto.KeyObject) => crypto.verify('sha256', data, { key, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST }, sig) },
  ES256: { kty: 'EC', verify: (data: Buffer, sig: Buffer, key: crypto.KeyObject) => crypto.verify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, sig) },
} as const;

/** Verifica assinatura (JWKS), iss, aud, exp e nbf. Retorna o payload. */
export function verifyJws(token: string, jwks: Jwks, opts: VerifyOptions): Record<string, any> {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]*$/.test(p))) throw new JwsError('jws.malformed');
  const header = b64uJson(parts[0]);
  const payload = b64uJson(parts[1]);
  const allowed = opts.algorithms ?? ['RS256', 'PS256', 'ES256'];
  const alg = header?.alg as keyof typeof ALG;
  if (typeof alg !== 'string' || !allowed.includes(alg) || !(alg in ALG)) throw new JwsError('jws.alg_not_allowed');
  const spec = ALG[alg];
  const candidates = jwks.keys.filter((k) => k.kty === spec.kty && (!k.use || k.use === 'sig') && (!k.alg || k.alg === alg) && (header.kid ? k.kid === header.kid : jwks.keys.length === 1));
  if (!candidates.length) throw new JwsError('jws.no_matching_key');
  const data = Buffer.from(`${parts[0]}.${parts[1]}`);
  const sig = Buffer.from(parts[2], 'base64url');
  let valid = false;
  for (const jwk of candidates) {
    try { if (spec.verify(data, sig, crypto.createPublicKey({ key: jwk as any, format: 'jwk' }))) { valid = true; break; } } catch { /* chave inválida: tenta a próxima */ }
  }
  if (!valid) throw new JwsError('jws.bad_signature');

  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const tol = opts.clockToleranceSec ?? 30;
  if (typeof payload.exp !== 'number' || payload.exp + tol < now) throw new JwsError('jws.expired');
  if (typeof payload.nbf === 'number' && payload.nbf - tol > now) throw new JwsError('jws.not_yet_valid');
  if (payload.iss !== opts.issuer) throw new JwsError('jws.bad_issuer');
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(opts.audience)) throw new JwsError('jws.bad_audience');
  return payload;
}

/** Assina um JWT RS256 com chave privada PEM (PKCS8 ou PKCS1). */
export function signRs256(claims: Record<string, unknown>, privateKeyPem: string, header: Record<string, unknown> = {}): string {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', ...header })).toString('base64url');
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const sig = crypto.sign('sha256', Buffer.from(`${h}.${p}`), crypto.createPrivateKey(privateKeyPem)).toString('base64url');
  return `${h}.${p}.${sig}`;
}
