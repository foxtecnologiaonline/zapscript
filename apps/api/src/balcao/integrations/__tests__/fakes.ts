process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-12345678901234567890';

import crypto from 'crypto';
import http from 'http';
import type { AddressInfo } from 'net';
import Fastify, { type FastifyInstance } from 'fastify';
import { signRs256, type Jwk } from '../jws';

export interface FakeServer { url: string; port: number; close: () => Promise<void>; hits: Array<{ method: string; path: string; headers: http.IncomingHttpHeaders; body: string }> }

/** Servidor HTTP local de teste (localhost). `handler` devolve [status, body, headers?]. */
export async function listen(handler: (req: { method: string; path: string; headers: http.IncomingHttpHeaders; body: string }) => [number, string | object, Record<string, string>?] | Promise<[number, string | object, Record<string, string>?]>): Promise<FakeServer> {
  const hits: FakeServer['hits'] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const r = { method: req.method ?? 'GET', path: req.url ?? '/', headers: req.headers, body: Buffer.concat(chunks).toString('utf8') };
      hits.push(r);
      try {
        const [status, body, headers] = await handler(r);
        const isObj = typeof body === 'object';
        res.writeHead(status, { 'content-type': isObj ? 'application/json' : 'text/xml', ...(headers ?? {}) });
        res.end(isObj ? JSON.stringify(body) : body);
      } catch { res.writeHead(500); res.end('x'); }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}`, port, hits, close: () => new Promise<void>((r) => { server.closeAllConnections?.(); server.close(() => r()); }) };
}

/** App Fastify só com o plugin de integrações (isolado das demais frentes). */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, trustProxy: true });
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    try { (req as any).rawBody = body; const s = body.toString().trim(); done(null, s ? JSON.parse(s) : {}); } catch (e: any) { done(e); }
  });
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'buffer' }, (_req, body, done) => { done(null, Object.fromEntries(new URLSearchParams(body.toString()))); });
  const { default: plugin } = await import('../index');
  await app.register(plugin, { prefix: '/balcao/integrations' });
  await app.ready();
  return app;
}

export const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** IdP OIDC falso: JWKS RSA, endpoint de token (valida PKCE e autenticação do cliente) e userinfo. */
export class FakeIdp {
  server!: FakeServer;
  privatePem!: string; otherPem!: string; jwk!: Jwk; kid = 'k1';
  clientId = 'client-123'; clientSecret = 'segredo-do-cliente';
  authMethod: 'basic' | 'post' = 'basic';
  issuer = '';
  codes = new Map<string, { nonce: string; challenge: string; claims: Record<string, unknown>; redirectUri: string }>();
  /** Falhas injetáveis. */
  opts: { wrongAud?: boolean; wrongNonce?: boolean; expired?: boolean; wrongIssuer?: boolean; otherKey?: boolean } = {};
  confiabilidades: unknown = [{ id: 3 }];
  confiabilidadesStatus = 200;
  accessToken = 'at-fake';

  static async create(): Promise<FakeIdp> {
    const i = new FakeIdp();
    const kp = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    i.privatePem = kp.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    i.otherPem = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    i.jwk = { ...(kp.publicKey.export({ format: 'jwk' }) as any), kid: i.kid, alg: 'RS256', use: 'sig' };
    i.server = await listen(async (r) => {
      const path = r.path.split('?')[0];
      if (path === '/jwks') return [200, { keys: [i.jwk] }];
      if (path === '/authorize') return [200, 'ok'];
      if (path === '/userinfo') return [200, { sub: [...i.codes.values()][0]?.claims.sub ?? 'x' }];
      if (path.startsWith('/confiabilidades')) {
        if (r.headers.authorization !== `Bearer ${i.accessToken}`) return [401, {}];
        return [i.confiabilidadesStatus, i.confiabilidades as object];
      }
      if (path === '/token' && r.method === 'POST') {
        const p = new URLSearchParams(r.body);
        let id = p.get('client_id'), secret = p.get('client_secret');
        if (r.headers.authorization?.startsWith('Basic ')) [id, secret] = Buffer.from(r.headers.authorization.slice(6), 'base64').toString().split(':').map(decodeURIComponent);
        if (id !== i.clientId || secret !== i.clientSecret) return [401, { error: 'invalid_client' }];
        const rec = i.codes.get(p.get('code') ?? '');
        i.codes.delete(p.get('code') ?? '');
        if (!rec || p.get('redirect_uri') !== rec.redirectUri) return [400, { error: 'invalid_grant' }];
        const verifier = p.get('code_verifier') ?? '';
        if (crypto.createHash('sha256').update(verifier).digest('base64url') !== rec.challenge) return [400, { error: 'invalid_grant', error_description: 'pkce' }];
        const now = Math.floor(Date.now() / 1000);
        const idToken = signRs256({
          ...rec.claims, nonce: i.opts.wrongNonce ? 'outro' : rec.nonce, iss: i.opts.wrongIssuer ? 'https://evil.example' : i.issuer,
          aud: i.opts.wrongAud ? 'outro-cliente' : i.clientId, iat: now - 10, exp: i.opts.expired ? now - 3600 : now + 300,
        }, i.opts.otherKey ? i.otherPem : i.privatePem, { kid: i.kid });
        return [200, { id_token: idToken, access_token: i.accessToken, token_type: 'Bearer' }];
      }
      return [404, {}];
    });
    i.issuer = i.server.url;
    return i;
  }
  get cfg() {
    const u = this.server.url;
    return { clientId: this.clientId, clientSecret: this.clientSecret, issuer: this.issuer, authorizeUrl: `${u}/authorize`, tokenUrl: `${u}/token`, jwksUri: `${u}/jwks`, userinfoUrl: `${u}/userinfo`, tokenAuthMethod: this.authMethod, allowPrivateHosts: true };
  }
  /** Simula o navegador: lê a URL de autorização, "autentica" e devolve a URL de retorno (redirect_uri?code&state). */
  authorize(authorizeLocation: string, claims: Record<string, unknown>): string {
    const u = new URL(authorizeLocation);
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('client_id')).toBe(this.clientId);
    const code = crypto.randomBytes(12).toString('hex');
    const redirectUri = u.searchParams.get('redirect_uri')!;
    this.codes.set(code, { nonce: u.searchParams.get('nonce')!, challenge: u.searchParams.get('code_challenge')!, claims, redirectUri });
    const back = new URL(redirectUri);
    back.searchParams.set('code', code);
    back.searchParams.set('state', u.searchParams.get('state')!);
    return back.toString();
  }
  /** Caminho+query (para app.inject) a partir de uma URL absoluta. */
  static pathOf(url: string) { const u = new URL(url); return `${u.pathname}${u.search}`; }
  close() { return this.server.close(); }
}
