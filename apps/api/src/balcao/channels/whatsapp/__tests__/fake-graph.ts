import http from 'http';
import crypto from 'crypto';
import type { AddressInfo } from 'net';

/** Servidor HTTP local que imita a Graph API do WhatsApp (só para testes — nenhuma rede real). */
export interface FakeCall { method: string; path: string; query: URLSearchParams; headers: http.IncomingHttpHeaders; json?: any; raw?: Buffer }
export interface FakeFailure { status: number; body?: any; headers?: Record<string, string> }

export class FakeGraph {
  server!: http.Server;
  base = '';
  calls: FakeCall[] = [];
  /** Falhas a devolver (em ordem) nas próximas chamadas de POST /messages. */
  messageFailures: FakeFailure[] = [];
  mediaFailures: FakeFailure[] = [];
  files = new Map<string, { mime: string; data: Buffer; sha256?: string }>();
  templates: any[] = [];
  seq = 0;
  failAuth = false;

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => this.handle(req, res, Buffer.concat(chunks)));
    });
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.base = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }
  async stop(): Promise<void> { await new Promise<void>((r) => this.server.close(() => r())); }
  reset(): void { this.calls = []; this.messageFailures = []; this.mediaFailures = []; this.failAuth = false; }
  callsTo(re: RegExp, method?: string): FakeCall[] { return this.calls.filter((c) => re.test(c.path) && (!method || c.method === method)); }

  private send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
    const isBuf = Buffer.isBuffer(body);
    res.writeHead(status, { 'content-type': isBuf ? 'application/octet-stream' : 'application/json', ...headers });
    res.end(isBuf ? body : JSON.stringify(body));
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse, raw: Buffer) {
    const url = new URL(req.url ?? '/', this.base);
    const call: FakeCall = { method: req.method ?? 'GET', path: url.pathname, query: url.searchParams, headers: req.headers, raw };
    if ((req.headers['content-type'] ?? '').includes('json') && raw.length) { try { call.json = JSON.parse(raw.toString()); } catch { /* */ } }
    this.calls.push(call);
    if (this.failAuth || req.headers.authorization !== 'Bearer tok-test-1234567890') {
      return this.send(res, 401, { error: { message: 'Invalid OAuth access token', type: 'OAuthException', code: 190 } });
    }
    const parts = url.pathname.split('/').filter(Boolean); // [v23.0, id, ...]
    if (parts[0] === 'files') {
      const f = this.files.get(parts[1]);
      return f ? this.send(res, 200, f.data) : this.send(res, 404, { error: { message: 'x', code: 100 } });
    }
    const [, id, sub] = parts;
    if (req.method === 'POST' && sub === 'messages') {
      const f = this.messageFailures.shift();
      if (f) return this.send(res, f.status, f.body ?? { error: { message: 'falha', code: 1 } }, f.headers);
      return this.send(res, 200, { messaging_product: 'whatsapp', contacts: [{ input: call.json?.to, wa_id: call.json?.to }], messages: [{ id: `wamid.OUT${++this.seq}` }] });
    }
    if (req.method === 'POST' && sub === 'media') {
      const f = this.mediaFailures.shift();
      if (f) return this.send(res, f.status, f.body ?? { error: { message: 'falha', code: 131053 } });
      return this.send(res, 200, { id: `media-up-${++this.seq}` });
    }
    if (sub === 'message_templates') {
      if (req.method === 'POST') {
        const t = { id: `tpl-${++this.seq}`, status: 'PENDING', category: call.json?.category };
        this.templates.push({ ...t, name: call.json?.name, language: call.json?.language, components: call.json?.components });
        return this.send(res, 200, t);
      }
      if (req.method === 'GET') return this.send(res, 200, { data: this.templates, paging: { cursors: { after: 'x' } } });
      if (req.method === 'DELETE') { this.templates = this.templates.filter((t) => t.name !== url.searchParams.get('name')); return this.send(res, 200, { success: true }); }
    }
    if (req.method === 'GET' && !sub) {
      if (id.startsWith('media-in-')) {
        const f = this.files.get(id);
        if (!f) return this.send(res, 404, { error: { message: 'media', code: 100 } });
        const failure = this.mediaFailures.shift();
        if (failure) return this.send(res, failure.status, failure.body ?? { error: { message: 'falha', code: 1 } });
        return this.send(res, 200, { url: `${this.base}/files/${id}`, mime_type: f.mime, sha256: f.sha256 ?? crypto.createHash('sha256').update(f.data).digest('hex'), file_size: f.data.length, id });
      }
      if (this.wabaIds.has(id)) return this.send(res, 200, { id, name: 'WABA Teste', currency: 'BRL' });
      return this.send(res, 200, { id, display_phone_number: '+55 63 3333-0000', verified_name: 'TJ Teste', quality_rating: 'GREEN' });
    }
    return this.send(res, 404, { error: { message: 'rota desconhecida', code: 100 } });
  }
  wabaIds = new Set<string>();
}
