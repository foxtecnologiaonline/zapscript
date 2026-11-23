import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { WebSocketServer, type WebSocket } from 'ws';
import { makeToneWav } from '../wav';

/** Servidor HTTP+WebSocket que imita o ARI do Asterisk o bastante para testar o controlador (sem Asterisk). */
export interface FakeChannel { id: string; endpoint?: string; appArgs?: string; originated: boolean; bridge?: string; moh?: boolean; ring?: boolean; answered?: boolean; callerId?: string }
export interface FakePlay { channelId: string; media: string[]; playbackId: string }

export class FakeAri {
  server!: http.Server;
  wss!: WebSocketServer;
  port = 0;
  user = 'balcao'; pass = 'secret';
  recordingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-ari-rec-'));
  requests: Array<{ method: string; path: string; query: Record<string, string>; body: any }> = [];
  channels = new Map<string, FakeChannel>();
  bridges = new Map<string, { id: string; channels: string[]; recording?: string }>();
  live = new Map<string, { target: string }>();
  plays: FakePlay[] = [];
  vars = new Map<string, Record<string, string>>();
  stored = new Map<string, Buffer>();
  holdPlayback = false;
  playDelayMs = 3;
  trunkState = 'online';
  failOriginate = false;
  /** Se true, grava arquivos só no "ARI" (sem o volume compartilhado) → exercita o download pelo ARI. */
  noSharedVolume = false;
  private seq = 0;
  private sockets = new Set<WebSocket>();

  async start() {
    this.server = http.createServer((req, res) => { void this.handle(req, res); });
    this.wss = new WebSocketServer({ noServer: true });
    this.server.on('upgrade', (req, socket, head) => {
      const u = new URL(req.url!, 'http://x');
      if (u.pathname !== '/ari/events' || u.searchParams.get('api_key') !== `${this.user}:${this.pass}` || u.searchParams.get('app') !== 'balcao') { socket.destroy(); return; }
      this.wss.handleUpgrade(req, socket, head, (ws) => { this.sockets.add(ws); ws.on('close', () => this.sockets.delete(ws)); });
    });
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.port = (this.server.address() as any).port;
  }
  async stop() {
    for (const s of this.sockets) s.terminate();
    this.wss.close();
    await new Promise<void>((r) => this.server.close(() => r()));
    fs.rmSync(this.recordingDir, { recursive: true, force: true });
  }
  get url() { return `http://127.0.0.1:${this.port}`; }
  get connected() { return this.sockets.size > 0; }
  closeSockets() { for (const s of this.sockets) s.terminate(); }

  emit(ev: Record<string, any>) { const msg = JSON.stringify({ application: 'balcao', timestamp: new Date().toISOString(), ...ev }); for (const s of this.sockets) s.send(msg); }

  // ── helpers de cenário ─────────────────────────────────────────────────────────────────────────
  incoming(id: string, o: { number: string; did: string; headers?: Record<string, string>; channelvars?: Record<string, string> }) {
    this.channels.set(id, { id, originated: false, answered: false });
    if (o.headers) this.vars.set(id, Object.fromEntries(Object.entries(o.headers).map(([k, v]) => [`PJSIP_HEADER(read,${k})`, v])));
    this.emit({ type: 'StasisStart', args: ['in', o.did], channel: { id, name: `PJSIP/tjto-trunk-${id}`, state: 'Ring', caller: { number: o.number, name: '' }, dialplan: { context: 'from-trunk', exten: o.did }, channelvars: o.channelvars ?? {} } });
  }
  dtmf(id: string, digit: string) { this.emit({ type: 'ChannelDtmfReceived', digit, duration_ms: 100, channel: { id } }); }
  hangup(id: string, cause = 16) {
    if (!this.channels.has(id)) return;
    this.dropChannel(id);
    this.emit({ type: 'StasisEnd', channel: { id } });
    this.emit({ type: 'ChannelDestroyed', cause, cause_txt: 'Normal Clearing', channel: { id } });
  }
  originated() { return [...this.channels.values()].filter((c) => c.originated); }
  answerOriginated(id: string) {
    const c = this.channels.get(id)!; c.answered = true;
    this.emit({ type: 'StasisStart', args: c.appArgs!.split(','), channel: { id, state: 'Up', caller: { number: c.callerId ?? '' }, dialplan: {} } });
  }
  failOriginated(id: string, cause = 19) { this.hangup(id, cause); }

  async waitFor<T>(fn: () => T | Promise<T>, what = 'condição', timeoutMs = 8000): Promise<NonNullable<T>> {
    const t0 = Date.now();
    for (;;) {
      const v = await fn();
      if (v) return v as NonNullable<T>;
      if (Date.now() - t0 > timeoutMs) throw new Error(`timeout esperando ${what}`);
      await new Promise((r) => setTimeout(r, 15));
    }
  }
  playsOn(id: string) { return this.plays.filter((p) => p.channelId === id); }
  req(method: string, pathPart: string) { return this.requests.filter((r) => r.method === method && r.path.includes(pathPart)); }

  // ── ARI HTTP ───────────────────────────────────────────────────────────────────────────────────
  private dropChannel(id: string) {
    const c = this.channels.get(id); this.channels.delete(id);
    if (c?.bridge) { const b = this.bridges.get(c.bridge); if (b) b.channels = b.channels.filter((x) => x !== id); }
  }
  private finishRecording(name: string) {
    if (!this.live.has(name)) return;
    this.live.delete(name);
    const wav = makeToneWav(1, 8000, 300 + (this.seq++ % 50));
    if (this.noSharedVolume) this.stored.set(name, wav); else fs.writeFileSync(path.join(this.recordingDir, `${name}.wav`), wav);
    this.emit({ type: 'RecordingFinished', recording: { name, format: 'wav', state: 'done' } });
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const u = new URL(req.url!, 'http://x');
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString();
    let body: any; try { body = raw ? JSON.parse(raw) : undefined; } catch { body = raw; }
    const auth = req.headers.authorization ?? '';
    if (auth !== `Basic ${Buffer.from(`${this.user}:${this.pass}`).toString('base64')}`) { res.writeHead(401); return res.end('{}'); }
    const query = Object.fromEntries(u.searchParams.entries());
    const p = u.pathname.replace(/^\/ari/, '');
    const m = req.method!;
    this.requests.push({ method: m, path: p, query, body });
    const json = (code: number, data: unknown = {}) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    let r: RegExpExecArray | null;

    if (m === 'GET' && p === '/asterisk/info') return json(200, { system: { version: '20.9.0-fake' } });
    if (m === 'GET' && (r = /^\/endpoints\/PJSIP\/(.+)$/.exec(p))) return this.trunkState === 'none' ? json(404, { message: 'not found' }) : json(200, { technology: 'PJSIP', resource: r[1], state: this.trunkState });
    if (m === 'GET' && p === '/channels') return json(200, [...this.channels.values()].map((c) => ({ id: c.id })));
    if (m === 'GET' && (r = /^\/channels\/([^/]+)\/variable$/.exec(p))) { const v = this.vars.get(r[1])?.[query.variable]; return v === undefined ? json(404, { message: 'Provided variable was not found' }) : json(200, { value: v }); }
    if (m === 'GET' && (r = /^\/recordings\/stored\/([^/]+)\/file$/.exec(p))) { const b = this.stored.get(r[1]); if (!b) return json(404); res.writeHead(200, { 'Content-Type': 'audio/wav' }); return res.end(b); }
    if (m === 'DELETE' && (r = /^\/recordings\/stored\/([^/]+)$/.exec(p))) { this.stored.delete(r[1]); return json(204); }

    if (m === 'POST' && p === '/channels') {
      if (this.failOriginate) return json(500, { message: 'originate failed' });
      const id = query.channelId || `orig-${++this.seq}`;
      this.channels.set(id, { id, endpoint: query.endpoint, appArgs: query.appArgs, originated: true, callerId: query.callerId });
      return json(200, { id, state: 'Down' });
    }
    if ((r = /^\/channels\/([^/]+)(?:\/(answer|play|moh|ring|record))?$/.exec(p))) {
      const [, id, act] = r;
      if (!this.channels.has(id)) return json(404, { message: 'Channel not found' });
      const ch = this.channels.get(id)!;
      if (m === 'DELETE' && !act) { this.hangup(id); return json(204); }
      if (m === 'POST' && act === 'answer') { ch.answered = true; return json(204); }
      if (m === 'POST' && act === 'moh') { ch.moh = true; return json(204); }
      if (m === 'DELETE' && act === 'moh') { ch.moh = false; return json(204); }
      if (m === 'POST' && act === 'ring') { ch.ring = true; return json(204); }
      if (m === 'DELETE' && act === 'ring') { ch.ring = false; return json(204); }
      if (m === 'POST' && act === 'play') {
        const playbackId = query.playbackId || `pb-${++this.seq}`;
        this.plays.push({ channelId: id, media: query.media.split(','), playbackId });
        json(201, { id: playbackId, state: 'queued', target_uri: `channel:${id}` });
        if (!this.holdPlayback) setTimeout(() => this.emit({ type: 'PlaybackFinished', playback: { id: playbackId, state: 'done' } }), this.playDelayMs);
        return;
      }
      if (m === 'POST' && act === 'record') { this.live.set(query.name, { target: `channel:${id}` }); this.emit({ type: 'RecordingStarted', recording: { name: query.name, state: 'recording' } }); return json(201, { name: query.name, state: 'queued' }); }
    }
    if (m === 'DELETE' && (r = /^\/playbacks\/([^/]+)$/.exec(p))) { this.emit({ type: 'PlaybackFinished', playback: { id: r[1], state: 'done' } }); return json(204); }
    if (m === 'POST' && (r = /^\/recordings\/live\/([^/]+)\/stop$/.exec(p))) { if (!this.live.has(r[1])) return json(404); this.finishRecording(r[1]); return json(204); }

    if (m === 'POST' && p === '/bridges') { const id = `br-${++this.seq}`; this.bridges.set(id, { id, channels: [] }); return json(200, { id, bridge_type: query.type }); }
    if ((r = /^\/bridges\/([^/]+)(?:\/(addChannel|removeChannel|record))?$/.exec(p))) {
      const [, id, act] = r; const b = this.bridges.get(id);
      if (!b) return json(404, { message: 'Bridge not found' });
      if (m === 'DELETE' && !act) { if (b.recording) this.finishRecording(b.recording); this.bridges.delete(id); return json(204); }
      if (m === 'POST' && act === 'addChannel') { for (const c of query.channel.split(',')) { const ch = this.channels.get(c); if (!ch) return json(422, { message: 'channel not found' }); ch.bridge = id; b.channels.push(c); } return json(204); }
      if (m === 'POST' && act === 'removeChannel') { for (const c of query.channel.split(',')) { b.channels = b.channels.filter((x) => x !== c); const ch = this.channels.get(c); if (ch) ch.bridge = undefined; } return json(204); }
      if (m === 'POST' && act === 'record') { b.recording = query.name; this.live.set(query.name, { target: `bridge:${id}` }); this.emit({ type: 'RecordingStarted', recording: { name: query.name, state: 'recording' } }); return json(201, { name: query.name, state: 'queued' }); }
    }
    return json(404, { message: `rota não simulada: ${m} ${p}` });
  }
}
