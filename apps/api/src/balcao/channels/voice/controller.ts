import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { logger } from '../../../lib/logger';
import { redis } from '../../../services/queue';
import { emitBvEvent, onBvEvent } from '../../core/events';
import { addConversationEvent, closeConversation, escalateToHuman, openConversation } from '../../core/conversations';
import { emitToSupervisors, emitToUser } from '../../core/realtime';
import { getHolidays, getOrgSettings } from '../../core/settings';
import { recordUsage, setUsageGauge } from '../../core/usage';
import { setAgentPresence } from '../../core/presence';
import type { Role as BvRole } from '../../core/types';
import { checkDialPolicy, evaluateNumber, loadDialPolicy } from './dialPolicy';
import { AriLeaderLock, type LockRedis } from './leader';
import { entryOptionOf, headersToCapture, loadUra0800, mapUraHeaders, parseSrcAddr, sourceIpAllowed } from './ura0800';
import { AriError, AriEventStream, createAxiosAriHttp, type AriEvent, type AriHttp, type AriSocketFactory, type BackoffOptions } from './ari';
import { agentRingMs, didsOf as uraDids, loadTrunkConfig, maxQueueMs, recordingDir, resolveOrgForDid, type TrunkConfig } from './config';
import { flowDefinition, resolveFlowForDid } from './ivrFlows';
import { IvrAborted, phrase, runIvr, type IvrIO, type IvrOutcome, type ResolvedIvrPrompt, type TrailEntry } from './ivr';
import type { PromptProvider } from './prompts';
import { storeRecording } from './recordings';

/**
 * Controlador de chamadas (ARI). Fluxo de uma chamada recebida:
 *  StasisStart → BvCall + conversa (BOT) → atende → aviso de gravação → protocolo → URA → fila (MoH, conversa WAITING)
 *  → `conversation.assigned` → origina PJSIP/<ramal> → atendeu: bridge + gravação → fim: duração, minutos, pico, eventos.
 * Cliente HTTP, WebSocket e provedor de prompts são injetáveis (testes usam um ARI falso local).
 */
export type CallState = 'IVR' | 'QUEUED' | 'RINGING_AGENT' | 'ACTIVE' | 'ENDING';
type Role = 'caller' | 'agent' | 'external';

/** Lock de liderança do ARI (Redis). `false` desliga (instância única). Padrão: ligado, exceto em NODE_ENV=test e com BV_VOICE_LEADER_LOCK=off. */
export interface LeaderLockSettings { redis?: LockRedis; key?: string; ttlMs?: number; renewMs?: number; retryMs?: number; instanceId?: string }

export interface ControllerOptions {
  connection: { url: string; username: string; password: string; app: string; orgId?: string };
  lock?: false | LeaderLockSettings;
  prompts: PromptProvider;
  http?: AriHttp;
  socketFactory?: AriSocketFactory;
  backoff?: BackoffOptions;
  agentRingMs?: number;
  maxQueueMs?: number;
  recordingDir?: string;
  recordingWaitMs?: number;
  playbackMaxMs?: number;
  /** Para testes: aceita as conversas sem consultar o storage etc. */
}

const rid = () => crypto.randomBytes(6).toString('hex');
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const ANON = /^(anonymous|unknown|restricted|private|)$/i;

/** Mídia falada do protocolo: BV-2026-000123 → characters:BV · digits:2026 · digits:000123. */
export function protocolMedia(protocol: string): string[] {
  return protocol.split('-').filter(Boolean).map((p) => (/^\d+$/.test(p) ? `digits:${p}` : `characters:${p}`));
}

class Session {
  state: CallState = 'IVR';
  direction: 'IN' | 'OUT' = 'IN';
  callerChannelId?: string;
  agentChannelId?: string;
  extChannelId?: string;
  bridgeId?: string;
  agentUserId?: string;
  pendingAgentId?: string;
  agentAttempts = 0;
  ringTimer?: NodeJS.Timeout;
  queueTimer?: NodeJS.Timeout;
  transferTimer?: NodeJS.Timeout;
  transferTarget?: string;
  transferred = false;
  connectedAt?: Date;
  ending = false;
  ivrPath: TrailEntry[] = [];
  selfService = false;
  io: AriIvrIO;
  recordings = new Map<string, { kind: 'main' | 'ura'; finished: Promise<void>; resolve: () => void; stopped: boolean }>();
  constructor(public callId: string, public orgId: string, public conversationId: string, public cfg: TrunkConfig & Record<string, any>, public lang: string, public startedAt: Date, public from: string, public to: string) {
    this.io = new AriIvrIO();
  }
  get recordingBase() { return `bv-${this.callId}`; }
}

/** IO da URA sobre o ARI: reprodução, DTMF (cut-thru/force-play) e detecção de desligamento. */
class AriIvrIO implements IvrIO {
  private buf: string[] = [];
  private waiter: ((d: string | null) => void) | null = null;
  private aborted = false;
  private abortPromise: Promise<never>;
  private abortReject!: (e: Error) => void;
  play!: IvrIO['play'];
  waitDigit!: IvrIO['waitDigit'];
  collect!: IvrIO['collect'];
  sayDigits!: IvrIO['sayDigits'];
  constructor() {
    this.abortPromise = new Promise<never>((_, rej) => { this.abortReject = rej; });
    this.abortPromise.catch(() => undefined);
  }
  get isAborted() { return this.aborted; }
  abort() { if (this.aborted) return; this.aborted = true; this.abortReject(new IvrAborted('caller_hangup')); this.waiter?.(null); }
  pushDigit(d: string) { if (this.waiter) { const w = this.waiter; this.waiter = null; w(d); } else this.buf.push(d); }
  flush() { this.buf.length = 0; }
  take(): string | undefined { return this.buf.shift(); }
  /** Espera um dígito (ms=null: sem limite) até `cancel()`. */
  waitRaw(ms: number | null): { promise: Promise<string | null>; cancel: () => void } {
    let timer: NodeJS.Timeout | undefined;
    const promise = new Promise<string | null>((resolve) => {
      const buffered = this.buf.shift();
      if (buffered !== undefined) return resolve(buffered);
      this.waiter = (d) => { if (timer) clearTimeout(timer); resolve(d); };
      if (ms != null) timer = setTimeout(() => { this.waiter = null; resolve(null); }, ms);
    });
    return { promise, cancel: () => { if (timer) clearTimeout(timer); this.waiter = null; } };
  }
  guard<T>(p: Promise<T>): Promise<T> { return Promise.race([p, this.abortPromise]); }
}

export interface ControllerStatus {
  enabled: boolean; /** 'leader': controla o ARI; 'standby': aguardando assumir o lock (outra instância é a líder). */ role: 'leader' | 'standby'; connected: boolean; app: string; url: string; reconnects: number; lastEventAt: string | null; lastError: string | null;
  activeCalls: number; byState: Record<string, number>;
}

export class AriController {
  readonly http: AriHttp;
  private stream: AriEventStream | null = null;
  private sessions = new Map<string, Session>();
  private byConv = new Map<string, string>();
  private channels = new Map<string, { session: Session; role: Role }>();
  private playbacks = new Map<string, () => void>();
  private offs: Array<() => void> = [];
  private started = false;
  private active = false;
  private lock: AriLeaderLock | null = null;
  private dialing = new Set<string>();

  constructor(private o: ControllerOptions) {
    this.http = o.http ?? createAxiosAriHttp(o.connection);
  }

  /** Chave do lock: escopo (órgão dono da conexão ARI, ou hash da URL) + app Stasis. */
  get lockKey(): string {
    const c = this.o.connection;
    const scope = c.orgId ?? crypto.createHash('sha256').update(c.url.replace(/\/+$/, '')).digest('hex').slice(0, 16);
    return this.o.lock && this.o.lock.key ? this.o.lock.key : `bv:voice:ari-leader:${scope}:${c.app}`;
  }
  private lockEnabled(): boolean {
    if (this.o.lock === false) return false;
    if (this.o.lock) return true;
    return process.env.NODE_ENV !== 'test' && process.env.BV_VOICE_LEADER_LOCK !== 'off';
  }
  get role(): 'leader' | 'standby' { return this.active ? 'leader' : 'standby'; }

  private get ringMs() { return this.o.agentRingMs ?? agentRingMs(); }
  private get queueMs() { return this.o.maxQueueMs ?? maxQueueMs(); }
  private get recDir() { return this.o.recordingDir ?? recordingDir(); }

  // ── ciclo de vida ──────────────────────────────────────────────────────────────────────────────────
  start() {
    if (this.started) return;
    this.started = true;
    if (!this.lockEnabled()) { this.activate(); return; }
    const l = typeof this.o.lock === 'object' ? this.o.lock : {};
    this.lock = new AriLeaderLock({
      redis: l.redis ?? (redis as unknown as LockRedis), key: this.lockKey, ttlMs: l.ttlMs, renewMs: l.renewMs, retryMs: l.retryMs, instanceId: l.instanceId,
      onAcquire: () => this.activate(), onLose: () => this.deactivate(),
    });
    this.lock.start();
  }

  /** Passa a controlar o ARI (só o líder): handlers de eventos + WebSocket. */
  private activate() {
    if (this.active || !this.started) return;
    this.active = true;
    this.offs.push(onBvEvent('conversation.assigned', (e) => this.onAssigned(e.orgId, e.conversationId, e.userId)));
    this.offs.push(onBvEvent('conversation.closed', (e) => this.onConversationClosed(e.orgId, e.conversationId, e.channel)));
    this.stream = new AriEventStream(this.o.connection, (ev) => { void this.onEvent(ev); }, {
      socketFactory: this.o.socketFactory, backoff: this.o.backoff,
      onOpen: () => { void this.reconcile().catch((err) => logger.warn({ err: err?.message }, '[balcao/voice] reconcile falhou')); },
    });
    this.stream.start();
  }

  /** Deixa de controlar o ARI (perda do lock ou parada): desconecta e solta os handlers. */
  private deactivate() {
    this.active = false;
    this.stream?.stop(); this.stream = null;
    for (const off of this.offs.splice(0)) off();
    for (const s of this.sessions.values()) { clearTimeout(s.ringTimer); clearTimeout(s.queueTimer); clearTimeout(s.transferTimer); }
  }

  stop() { void this.shutdown(); }

  /** Para o controlador e LIBERA o lock de liderança (aguardável: use no shutdown da API). */
  async shutdown(): Promise<void> {
    this.started = false;
    this.deactivate();
    await this.lock?.stop();
    this.lock = null;
  }

  status(): ControllerStatus {
    const byState: Record<string, number> = {};
    for (const s of this.sessions.values()) byState[s.state] = (byState[s.state] ?? 0) + 1;
    return {
      enabled: true, role: this.role, connected: this.stream?.connected ?? false, app: this.o.connection.app, url: this.o.connection.url,
      reconnects: this.stream?.reconnects ?? 0, lastEventAt: this.stream?.lastEventAt?.toISOString() ?? null, lastError: this.stream?.lastError ?? null,
      activeCalls: this.sessions.size, byState,
    };
  }
  get isConnected() { return this.stream?.connected ?? false; }
  getSession(callId: string) { return this.sessions.get(callId); }
  activeCallIds(orgId?: string) { return [...this.sessions.values()].filter((s) => !orgId || s.orgId === orgId).map((s) => s.callId); }

  /** Chamadas do banco que ficaram "vivas" sem canal no Asterisk (queda da API) → encerradas. */
  async reconcile(): Promise<number> {
    let live = new Set<string>();
    try { live = new Set(((await this.http.request<any[]>('GET', '/channels')) ?? []).map((c) => c.id)); } catch { return 0; }
    const rows = await prisma.bvCall.findMany({ where: { status: { in: ['RINGING', 'IVR', 'QUEUED', 'ACTIVE'] } }, take: 500 });
    let n = 0;
    for (const r of rows) {
      if (this.sessions.has(r.id) || (r.ariChannelId && live.has(r.ariChannelId))) continue;
      const endedAt = new Date();
      await prisma.bvCall.update({ where: { id: r.id }, data: { status: r.status === 'ACTIVE' ? 'ENDED' : 'ABANDONED', endedAt, durationSec: Math.round((endedAt.getTime() - r.startedAt.getTime()) / 1000), endReason: 'LOST_CONTROL' } });
      if (r.conversationId) await closeConversation({ orgId: r.orgId, conversationId: r.conversationId, reason: 'ABANDONED', requestCsat: false }).catch(() => undefined);
      n++;
    }
    if (n) logger.warn({ n }, '[balcao/voice] chamadas órfãs encerradas');
    return n;
  }

  // ── utilidades ARI ─────────────────────────────────────────────────────────────────────────────────
  private async ari<T = any>(method: 'GET' | 'POST' | 'DELETE', path: string, q?: Record<string, any>, body?: unknown): Promise<T | undefined> {
    try { return await this.http.request<T>(method, path, { query: q, body }); }
    catch (err: any) {
      if (err instanceof AriError && err.gone) return undefined;
      logger.warn({ err: err?.message, path }, '[balcao/voice] chamada ARI falhou');
      return undefined;
    }
  }
  private async ariStrict<T = any>(method: 'GET' | 'POST' | 'DELETE', path: string, q?: Record<string, any>, body?: unknown): Promise<T> {
    return this.http.request<T>(method, path, { query: q, body });
  }
  private async hangupChannel(id: string | undefined, reason = 'normal') { if (id) await this.ari('DELETE', `/channels/${encodeURIComponent(id)}`, { reason }); }

  private register(s: Session, channelId: string, role: Role) {
    this.channels.set(channelId, { session: s, role });
    if (role === 'caller') s.callerChannelId = channelId; else if (role === 'agent') s.agentChannelId = channelId; else s.extChannelId = channelId;
  }

  private toSocket(s: Session, event: string, extra: Record<string, unknown> = {}) {
    const payload = { callId: s.callId, conversationId: s.conversationId, direction: s.direction, from: s.from, to: s.to, state: s.state, ...extra };
    if (s.agentUserId) emitToUser(s.agentUserId, event, payload);
    emitToSupervisors(s.orgId, event, payload);
  }

  // ── despacho de eventos ────────────────────────────────────────────────────────────────────────────
  async onEvent(ev: AriEvent): Promise<void> {
    try {
      switch (ev.type) {
        case 'StasisStart': return await this.onStasisStart(ev);
        case 'StasisEnd': case 'ChannelDestroyed': return await this.onChannelGone(ev);
        case 'ChannelDtmfReceived': { const c = ev.channel && this.channels.get(ev.channel.id); if (c?.role === 'caller' && ev.digit) c.session.io.pushDigit(ev.digit); return; }
        case 'PlaybackFinished': { const id = ev.playback?.id; if (id) { this.playbacks.get(id)?.(); } return; }
        case 'RecordingFinished': case 'RecordingFailed': return await this.onRecordingEnded(ev);
        default: return;
      }
    } catch (err: any) { logger.error({ err: err?.message, type: ev.type }, '[balcao/voice] erro ao tratar evento ARI'); }
  }

  private async onStasisStart(ev: AriEvent) {
    const ch = ev.channel; if (!ch) return;
    const kind = ev.args?.[0];
    const known = this.channels.get(ch.id);
    if (kind === 'agent' || kind === 'transfer' || kind === 'dial' || kind === 'dialout') {
      if (!known) { await this.hangupChannel(ch.id); return; }
      const s = known.session;
      if (s.ending) return;
      if (kind === 'agent') return this.onAgentAnswered(s);
      if (kind === 'transfer') return this.onTransferAnswered(s);
      if (kind === 'dial') return this.onDialAgentAnswered(s);
      return this.onDialoutAnswered(s);
    }
    if (known) return;
    return this.handleIncoming(ev);
  }

  private async onChannelGone(ev: AriEvent) {
    const id = ev.channel?.id; if (!id) return;
    const c = this.channels.get(id); if (!c) return;
    this.channels.delete(id);
    const s = c.session;
    if (s.ending) return;
    if (c.role === 'caller') {
      s.io.abort();
      const reason = s.state === 'ACTIVE' ? 'CALLER_HANGUP' : s.state === 'IVR' ? 'CALLER_HANGUP_IVR' : 'CALLER_HANGUP_QUEUE';
      return this.endCall(s, { reason });
    }
    if (c.role === 'agent') {
      s.agentChannelId = undefined;
      if (s.direction === 'IN' && s.state === 'RINGING_AGENT') return this.requeue(s, `agent_unavailable:${ev.cause ?? ''}`);
      if (s.state === 'ACTIVE') return this.endCall(s, { reason: 'AGENT_HANGUP' });
      return this.endCall(s, { reason: 'AGENT_UNAVAILABLE', status: 'FAILED' });
    }
    // external
    s.extChannelId = undefined;
    if (s.transferTarget && !s.transferred && s.bridgeId) { // transbordo não completou: o atendente continua com o chamador
      clearTimeout(s.transferTimer); s.transferTarget = undefined;
      this.toSocket(s, 'call:transfer_failed', { cause: ev.cause_txt ?? 'no_answer' });
      return;
    }
    if (s.state === 'ACTIVE') return this.endCall(s, { reason: s.direction === 'OUT' ? 'REMOTE_HANGUP' : 'TRANSFER_REMOTE_HANGUP' });
    return this.endCall(s, { reason: 'DIAL_FAILED', status: 'FAILED' });
  }

  // ── chamada recebida ───────────────────────────────────────────────────────────────────────────────
  private async handleIncoming(ev: AriEvent) {
    const ch = ev.channel!;
    const did = ev.args?.[1] || ch.dialplan?.exten || '';
    const number = (ch.caller?.number ?? '').trim();
    const orgId = await resolveOrgForDid(did);
    if (!orgId) { logger.warn({ did }, '[balcao/voice] chamada para DID sem órgão; recusada'); await this.ari('POST', `/channels/${ch.id}/answer`); await this.hangupChannel(ch.id, 'rejected'); return; }

    const cfg = await loadTrunkConfig(orgId);
    const ura = await loadUra0800(orgId);
    // URA 0800: se o órgão restringiu os IPs de origem, só chamadas vindas deles são atendidas (o dialplan expõe BV_SRC_ADDR)
    if (ura?.allowedSourceIps?.length && uraDids(ura).includes(did)) {
      const src = parseSrcAddr(ch.channelvars?.BV_SRC_ADDR);
      if (!src || !sourceIpAllowed(ura.allowedSourceIps, src)) {
        logger.warn({ did, src: src ?? 'desconhecido' }, '[balcao/voice] chamada 0800 de IP de origem não permitido; recusada');
        await this.hangupChannel(ch.id, 'rejected');
        return;
      }
    }
    const settings = await getOrgSettings(orgId);
    const callId = `c${crypto.randomBytes(11).toString('hex')}`;
    const anonymous = ANON.test(number);
    const startedAt = new Date();
    await prisma.bvCall.create({ data: { id: callId, orgId, direction: 'IN', fromNumber: anonymous ? 'anonimo' : number, toNumber: did, ariChannelId: ch.id, status: 'RINGING', startedAt } });
    const headers = await this.readHeaders(ch, headersToCapture(ura, cfg));
    const flowRow = await resolveFlowForDid(orgId, did);
    const entryOption = entryOptionOf(ura, headers);
    const { conversation } = await openConversation({
      orgId, channel: 'VOICE', channelRef: callId, externalId: anonymous ? `anonimo:${callId}` : number, status: 'BOT',
      metadata: {
        voice: { callId, did, headers, flow: flowRow ? { id: flowRow.id, name: flowRow.name, version: flowRow.version } : null, ...(ura ? { ura0800: { headers: mapUraHeaders(ura, headers) } } : {}) },
        ...(entryOption != null ? { ivr: { entryOption } } : {}),
      },
    });
    await prisma.bvCall.update({ where: { id: callId }, data: { conversationId: conversation.id, ivrFlowId: flowRow?.id ?? null } });

    const s = new Session(callId, orgId, conversation.id, cfg, settings.language, startedAt, anonymous ? 'anonimo' : number, did);
    this.sessions.set(callId, s); this.byConv.set(conversation.id, callId);
    this.register(s, ch.id, 'caller');
    emitBvEvent('call.started', { orgId, callId, conversationId: conversation.id });
    void this.updatePeak(orgId);

    try {
      await this.ariStrict('POST', `/channels/${ch.id}/answer`);
      await prisma.bvCall.update({ where: { id: callId }, data: { status: 'IVR' } });
      if (cfg.recordIvrPhase !== false) await this.startRecording(s, 'ura', 'channel', ch.id);

      // aviso de gravação (LGPD) — force-play: não pode ser interrompido
      await this.speak(s, { text: settings.recordingNotice, lang: settings.language }, false);
      await prisma.bvCall.update({ where: { id: callId }, data: { recordingNotified: true } });
      // protocolo por interação
      if (cfg.speakProtocol !== 'off') await this.speakProtocol(s, conversation.protocol, settings.language);

      let outcome: IvrOutcome; let result;
      if (flowRow) {
        const def = flowDefinition(flowRow); // definição congelada: publicações novas não afetam esta chamada
        const env = { now: () => new Date(), settings, holidays: await getHolidays(orgId) };
        s.io.play = (p, o) => this.ivrPlay(s, p, o);
        s.io.waitDigit = (sec) => this.ivrWaitDigit(s, sec);
        s.io.collect = (o) => this.ivrCollect(s, o);
        s.io.sayDigits = (d) => this.ivrSayDigits(s, d);
        result = await runIvr(def, s.io, env, { lang: def.defaultLang ?? settings.language, headers });
        s.ivrPath = result.trail; outcome = result.outcome;
        await prisma.bvCall.update({ where: { id: callId }, data: { ivrPath: [...result.trail] as any } });
        await this.mergeConversationMeta(s, { ivr: { flowId: flowRow.id, lang: result.lang, category: (outcome as any).category ?? null, queue: (outcome as any).queue ?? null, vars: result.vars, sensitiveCollected: result.sensitiveVars, outcome: outcome.action } });
        if (result.lang !== settings.language) await prisma.bvConversation.update({ where: { id: conversation.id }, data: { language: result.lang } });
      } else {
        outcome = { action: 'queue', node: '-' };
      }
      if (s.ending) return;
      await this.applyOutcome(s, outcome);
    } catch (err: any) {
      if (err instanceof IvrAborted || s.ending) return; // chamador desligou: endCall já foi/será acionado pelo evento
      logger.error({ err: err?.message, callId }, '[balcao/voice] falha na chamada recebida');
      await this.endCall(s, { reason: 'ERROR', status: 'FAILED' });
    }
  }

  private async readHeaders(ch: { id: string; channelvars?: Record<string, string> }, names: string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(ch.channelvars ?? {})) if (k.startsWith('BV_X_') && v) out[`X-${k.slice(5).replace(/_/g, '-')}`] = String(v).slice(0, 200);
    for (const n of names) {
      if (Object.keys(out).some((k) => k.toLowerCase() === n.toLowerCase())) continue;
      const r = await this.ari<{ value?: string }>('GET', `/channels/${ch.id}/variable`, { variable: `PJSIP_HEADER(read,${n})` });
      if (r?.value) out[n] = String(r.value).slice(0, 200);
    }
    return out;
  }

  private async applyOutcome(s: Session, outcome: IvrOutcome) {
    if (outcome.action === 'aborted') return;
    if (outcome.action === 'hangup') {
      s.selfService = true;
      await this.endCall(s, { reason: outcome.reason === 'end' ? 'IVR_END' : `IVR_${outcome.reason.toUpperCase()}`, hangupCaller: true });
      return;
    }
    if (outcome.action === 'transfer') {
      s.selfService = false;
      await this.ivrTransfer(s, outcome.destination.number);
      return;
    }
    await this.enterQueue(s, outcome);
  }

  private async enterQueue(s: Session, o: Extract<IvrOutcome, { action: 'queue' }>) {
    s.state = 'QUEUED';
    await prisma.bvCall.update({ where: { id: s.callId }, data: { status: 'QUEUED' } });
    if (s.callerChannelId) await this.ari('POST', `/channels/${s.callerChannelId}/moh`, { mohClass: o.mohClass || 'default' });
    s.queueTimer = setTimeout(() => { void this.onQueueTimeout(s); }, this.queueMs); s.queueTimer.unref?.();
    if (o.priority != null) await prisma.bvConversation.update({ where: { id: s.conversationId }, data: { priority: o.priority } });
    this.toSocket(s, 'call:queued', { category: o.category ?? null });
    await escalateToHuman(s.orgId, s.conversationId, { reason: 'ivr', category: o.category ?? null });
    if (s.pendingAgentId) { const u = s.pendingAgentId; s.pendingAgentId = undefined; await this.ringAgent(s, u); }
  }

  private async onQueueTimeout(s: Session) {
    if (s.ending || s.state === 'ACTIVE') return;
    await this.speak(s, phrase('maxRetries', s.lang), false, 8000).catch(() => undefined);
    await this.endCall(s, { reason: 'QUEUE_TIMEOUT', closeReason: 'TIMEOUT', hangupCaller: true });
  }

  // ── reprodução / DTMF ──────────────────────────────────────────────────────────────────────────────
  private async resolveMedia(s: Session, p: ResolvedIvrPrompt): Promise<string[]> {
    return (await this.o.prompts.resolve(s.orgId, p)).media;
  }

  /** Toca mídia(s) e espera o fim. `io` habilita cut-thru (devolve o dígito que interrompeu). */
  private async playMedia(s: Session, media: string[], interruptible: boolean, maxMs = this.o.playbackMaxMs ?? 120_000): Promise<string | null> {
    const chId = s.callerChannelId;
    if (!chId || media.length === 0) return null;
    const io = s.io;
    if (interruptible) { const early = io.take(); if (early !== undefined) return early; } else io.flush();
    const playbackId = `pb-${rid()}`;
    const finished = new Promise<void>((resolve) => { this.playbacks.set(playbackId, resolve); });
    try {
      try { await this.ariStrict('POST', `/channels/${chId}/play`, { media, playbackId }); }
      catch (err: any) { if (err instanceof AriError && err.gone) { io.abort(); throw new IvrAborted(); } throw err; }
      const dig = interruptible ? io.waitRaw(null) : null;
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<null>((r) => { timer = setTimeout(() => r(null), maxMs); });
      try {
        const winner = await io.guard(Promise.race([finished.then(() => 'done' as const), timeout.then(() => 'done' as const), ...(dig ? [dig.promise.then((d) => (d === null ? ('done' as const) : d))] : [])]));
        if (winner !== 'done') { await this.ari('DELETE', `/playbacks/${playbackId}`); return winner; }
        return null;
      } finally { clearTimeout(timer); dig?.cancel(); }
    } finally {
      this.playbacks.delete(playbackId);
      if (!interruptible) io.flush(); // force-play: dígitos digitados durante o áudio são descartados
    }
  }

  private async speak(s: Session, p: ResolvedIvrPrompt | { text: string; lang: string }, interruptible: boolean, maxMs?: number): Promise<string | null> {
    const media = await this.resolveMedia(s, { text: p.text, lang: p.lang, audioKey: (p as any).audioKey });
    return this.playMedia(s, media, interruptible, maxMs);
  }

  private async speakProtocol(s: Session, protocol: string, lang: string) {
    const intro = await this.resolveMedia(s, { text: 'Seu protocolo de atendimento é', lang });
    await this.playMedia(s, [...intro, ...protocolMedia(protocol)], false);
  }

  private ivrPlay(s: Session, p: ResolvedIvrPrompt, o: { interruptible: boolean }) { return s.io.guard(this.speak(s, p, o.interruptible)); }
  private async ivrWaitDigit(s: Session, sec: number) { const w = s.io.waitRaw(sec * 1000); try { return await s.io.guard(w.promise); } finally { w.cancel(); } }
  private async ivrSayDigits(s: Session, digits: string) { await s.io.guard(this.playMedia(s, [`digits:${digits.replace(/\D/g, '')}`], false)); }
  private async ivrCollect(s: Session, o: { min: number; max: number; terminator: string | null; timeoutSec: number; initial?: string }) {
    let digits = o.initial ?? '';
    for (;;) {
      if (digits.length >= o.max) break;
      const d = await this.ivrWaitDigit(s, o.timeoutSec);
      if (d === null) return { digits, timedOut: digits.length === 0 };
      if (o.terminator && d === o.terminator) break;
      digits += d;
    }
    return { digits, timedOut: false };
  }

  // ── atendente ──────────────────────────────────────────────────────────────────────────────────────
  private async onAssigned(orgId: string, conversationId: string, userId: string) {
    const callId = this.byConv.get(conversationId); const s = callId ? this.sessions.get(callId) : undefined;
    if (!s || s.orgId !== orgId || s.ending) return;
    if (s.state === 'IVR') { s.pendingAgentId = userId; return; }
    if (s.state === 'QUEUED') return this.ringAgent(s, userId);
    if (s.state === 'RINGING_AGENT' && s.agentUserId !== userId) { await this.cancelAgentLeg(s); return this.ringAgent(s, userId); }
    logger.info({ callId: s.callId, state: s.state }, '[balcao/voice] atribuição ignorada (chamada não está na fila)');
  }

  private async cancelAgentLeg(s: Session) {
    clearTimeout(s.ringTimer);
    const id = s.agentChannelId; s.agentChannelId = undefined;
    if (id) { this.channels.delete(id); await this.hangupChannel(id); }
  }

  private async ringAgent(s: Session, userId: string) {
    const user = await prisma.bvUser.findFirst({ where: { id: userId, orgId: s.orgId, active: true }, select: { id: true, sipExtension: true, name: true } });
    s.agentUserId = userId;
    if (!user?.sipExtension) { await this.requeue(s, 'no_extension'); return; }
    s.state = 'RINGING_AGENT'; s.agentAttempts++;
    const channelId = `a-${s.callId}-${s.agentAttempts}`;
    this.register(s, channelId, 'agent');
    this.toSocket(s, 'call:ringing', { agentUserId: userId });
    try {
      await this.ariStrict('POST', '/channels', {
        endpoint: `PJSIP/${user.sipExtension}`, app: this.o.connection.app, appArgs: `agent,${s.callId}`, callerId: s.from, channelId, timeout: Math.max(1, Math.ceil(this.ringMs / 1000)),
      });
    } catch (err: any) { logger.warn({ err: err?.message, callId: s.callId }, '[balcao/voice] falha ao originar para o atendente'); this.channels.delete(channelId); s.agentChannelId = undefined; await this.requeue(s, 'originate_failed'); return; }
    s.ringTimer = setTimeout(() => { void this.onRingTimeout(s, channelId); }, this.ringMs); s.ringTimer.unref?.();
  }

  private async onRingTimeout(s: Session, channelId: string) {
    if (s.ending || s.state !== 'RINGING_AGENT' || s.agentChannelId !== channelId) return;
    await this.requeue(s, 'ring_timeout');
  }

  /** Atendente não atendeu / indisponível: ele fica AWAY e a conversa volta à fila para novo roteamento. */
  private async requeue(s: Session, reason: string) {
    if (s.ending) return;
    const userId = s.agentUserId;
    await this.cancelAgentLeg(s);
    s.state = 'QUEUED'; s.agentUserId = undefined;
    logger.info({ callId: s.callId, reason }, '[balcao/voice] chamada devolvida à fila');
    if (userId) await setAgentPresence(s.orgId, userId, 'AWAY');
    await prisma.bvConversation.update({ where: { id: s.conversationId }, data: { status: 'WAITING', assignedUserId: null, assignedAt: null, queuedAt: new Date() } });
    await addConversationEvent(s.orgId, s.conversationId, 'REQUEUED', null, { reason, userId });
    this.toSocket(s, 'call:queued', { requeued: true, reason });
    emitBvEvent('conversation.needs_routing', { orgId: s.orgId, conversationId: s.conversationId, reason: 'OVERFLOW' });
  }

  private async onAgentAnswered(s: Session) {
    clearTimeout(s.ringTimer); clearTimeout(s.queueTimer);
    if (s.state !== 'RINGING_AGENT' || !s.callerChannelId || !s.agentChannelId) { await this.hangupChannel(s.agentChannelId); return; }
    await this.ari('DELETE', `/channels/${s.callerChannelId}/moh`);
    await this.stopRecording(s, 'ura');
    const bridge = await this.ariStrict<{ id: string }>('POST', '/bridges', { type: 'mixing', name: `bv-${s.callId}` });
    s.bridgeId = bridge.id;
    await this.ariStrict('POST', `/bridges/${bridge.id}/addChannel`, { channel: [s.callerChannelId, s.agentChannelId] });
    await this.startRecording(s, 'main', 'bridge', bridge.id);
    s.state = 'ACTIVE'; s.connectedAt = new Date();
    await prisma.bvCall.update({ where: { id: s.callId }, data: { status: 'ACTIVE', answeredAt: s.connectedAt, agentUserId: s.agentUserId } });
    this.toSocket(s, 'call:active', { agentUserId: s.agentUserId });
  }

  // ── gravação ───────────────────────────────────────────────────────────────────────────────────────
  private async startRecording(s: Session, kind: 'main' | 'ura', target: 'bridge' | 'channel', id: string) {
    const name = kind === 'main' ? s.recordingBase : `${s.recordingBase}-ura`;
    let resolve!: () => void;
    const finished = new Promise<void>((r) => { resolve = r; });
    s.recordings.set(name, { kind, finished, resolve, stopped: false });
    const path = target === 'bridge' ? `/bridges/${id}/record` : `/channels/${id}/record`;
    try { await this.ariStrict('POST', path, { name, format: 'wav', ifExists: 'overwrite', beep: false, terminateOn: 'none' }); }
    catch (err: any) { logger.error({ err: err?.message, callId: s.callId, kind }, '[balcao/voice] não foi possível iniciar a gravação'); resolve(); s.recordings.delete(name); }
  }

  private async stopRecording(s: Session, kind: 'main' | 'ura') {
    const name = kind === 'main' ? s.recordingBase : `${s.recordingBase}-ura`;
    const r = s.recordings.get(name);
    if (!r || r.stopped) return;
    r.stopped = true;
    await this.ari('POST', `/recordings/live/${encodeURIComponent(name)}/stop`);
  }

  private async onRecordingEnded(ev: AriEvent) {
    const name = ev.recording?.name; if (!name) return;
    const m = /^bv-([a-z0-9]+?)(-ura)?$/i.exec(name); if (!m) return;
    const s = this.sessions.get(m[1]);
    const r = s?.recordings.get(name);
    if (r) { r.resolve(); return; }
    if (!s && ev.type === 'RecordingFinished') await this.recoverOrphanRecording(m[1], name, !!m[2]);
  }

  /** Gravação terminou depois da chamada ter sido finalizada (ex.: queda da API) → anexa à chamada. */
  private async recoverOrphanRecording(callId: string, name: string, ura: boolean) {
    const call = await prisma.bvCall.findUnique({ where: { id: callId } });
    if (!call || (!ura && call.recordingKey)) return;
    const stored = await storeRecording(call.orgId, name, this.http, { dir: this.recDir });
    if (stored && !ura) await prisma.bvCall.update({ where: { id: callId }, data: { recordingKey: stored.key, recordingSha256: stored.sha256, recordingSizeBytes: BigInt(stored.size) } });
  }

  private async finalizeRecordings(s: Session) {
    const waitMs = this.o.recordingWaitMs ?? 5000;
    const stored: Partial<Record<'main' | 'ura', { key: string; sha256: string; size: number }>> = {};
    for (const [name, r] of s.recordings) {
      await Promise.race([r.finished, sleep(waitMs)]);
      const o = await storeRecording(s.orgId, name, this.http, { dir: this.recDir });
      if (o) stored[r.kind] = o;
    }
    return stored;
  }

  // ── fim da chamada ─────────────────────────────────────────────────────────────────────────────────
  async endCall(s: Session, why: { reason: string; status?: 'ENDED' | 'ABANDONED' | 'FAILED'; closeReason?: 'RESOLVED' | 'ABANDONED' | 'TIMEOUT' | 'TRANSFERRED_OUT'; hangupCaller?: boolean }) {
    if (s.ending) return;
    s.ending = true;
    const prevState = s.state;
    s.state = 'ENDING';
    clearTimeout(s.ringTimer); clearTimeout(s.queueTimer); clearTimeout(s.transferTimer);
    s.io.abort();
    await this.stopRecording(s, 'main'); await this.stopRecording(s, 'ura');
    const legs = [s.callerChannelId, s.agentChannelId, s.extChannelId].filter(Boolean) as string[];
    for (const id of legs) this.channels.delete(id);
    await Promise.all(legs.map((id) => this.hangupChannel(id)));
    if (s.bridgeId) await this.ari('DELETE', `/bridges/${s.bridgeId}`);

    const endedAt = new Date();
    const durationSec = Math.max(0, Math.round((endedAt.getTime() - s.startedAt.getTime()) / 1000));
    const status = why.status ?? (s.connectedAt || why.reason === 'IVR_END' ? 'ENDED' : s.direction === 'OUT' ? 'FAILED' : 'ABANDONED');
    let rec: Awaited<ReturnType<typeof this.finalizeRecordings>> = {};
    try { rec = await this.finalizeRecordings(s); } catch (err: any) { logger.error({ err: err?.message, callId: s.callId }, '[balcao/voice] finalizeRecordings'); }
    const main = rec.main ?? rec.ura; // sem ponte (não chegou a atendente): a gravação da fase da URA é a gravação da chamada

    if (rec.main && rec.ura) await this.mergeConversationMeta(s, { voice: { uraRecording: { key: rec.ura.key, sha256: rec.ura.sha256, size: rec.ura.size } } });
    await recordUsage(s.orgId, 'VOICE_MINUTES', Math.max(1, Math.ceil((endedAt.getTime() - s.startedAt.getTime()) / 60_000)));

    // conversa
    const conv = await prisma.bvConversation.findUnique({ where: { id: s.conversationId }, select: { status: true } });
    if (conv && conv.status !== 'CLOSED') {
      const closeReason = why.closeReason ?? (status === 'ENDED' ? (s.connectedAt || s.selfService ? 'RESOLVED' : 'ABANDONED') : 'ABANDONED');
      if (closeReason !== 'RESOLVED' || s.cfg.autoCloseOnEnd !== false || s.selfService) {
        await closeConversation({ orgId: s.orgId, conversationId: s.conversationId, reason: closeReason, requestCsat: false, resolvedByBot: s.selfService || undefined })
          .catch((err) => logger.warn({ err: err?.message }, '[balcao/voice] closeConversation falhou'));
      }
    }
    await prisma.bvCall.update({
      where: { id: s.callId },
      data: {
        status, endedAt, durationSec, endReason: why.reason, ivrPath: s.ivrPath.length ? ([...s.ivrPath] as any) : undefined,
        ...(main ? { recordingKey: main.key, recordingSha256: main.sha256, recordingSizeBytes: BigInt(main.size) } : {}),
      },
    });
    this.sessions.delete(s.callId); this.byConv.delete(s.conversationId);
    this.toSocket(s, 'call:ended', { status, durationSec, reason: why.reason, prevState });
    emitBvEvent('call.ended', { orgId: s.orgId, callId: s.callId, conversationId: s.conversationId });
    void why.hangupCaller;
  }

  private async mergeConversationMeta(s: Session, patch: Record<string, any>) {
    const row = await prisma.bvConversation.findUnique({ where: { id: s.conversationId }, select: { metadata: true } });
    const cur = (row?.metadata ?? {}) as Record<string, any>;
    const merged: Record<string, any> = { ...cur };
    for (const [k, v] of Object.entries(patch)) merged[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...(cur[k] ?? {}), ...v } : v;
    await prisma.bvConversation.update({ where: { id: s.conversationId }, data: { metadata: merged as Prisma.InputJsonValue } });
  }

  private async updatePeak(orgId: string) {
    const n = [...this.sessions.values()].filter((x) => x.orgId === orgId).length;
    await setUsageGauge(orgId, 'VOICE_PEAK_CHANNELS', n, 'max');
  }

  private async onConversationClosed(orgId: string, conversationId: string, channel: string) {
    if (channel !== 'VOICE') return;
    const callId = this.byConv.get(conversationId); const s = callId ? this.sessions.get(callId) : undefined;
    if (!s || s.orgId !== orgId || s.ending) return;
    if (s.transferred) return; // transbordo concluído: a ligação segue entre chamador e destino
    await this.endCall(s, { reason: 'CONVERSATION_CLOSED', status: s.connectedAt ? 'ENDED' : undefined });
  }

  // ── transbordo / discagem ──────────────────────────────────────────────────────────────────────────
  private trunkDial(s: Session | { cfg: TrunkConfig & Record<string, any> }, number: string) { return `PJSIP/${number}@${s.cfg.trunkEndpoint ?? 'tjto-trunk'}`; }

  /** Transbordo (blind transfer) para número da telefonia do TJTO: origina pelo tronco e liga ao chamador; o atendente sai. */
  async transferCall(orgId: string, callId: string, number: string): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
    const s = this.sessions.get(callId);
    if (!s || s.orgId !== orgId) return { ok: false, code: 'call.not_found', message: 'Chamada não encontrada ou já encerrada' };
    if (s.state !== 'ACTIVE' || !s.bridgeId) return { ok: false, code: 'call.not_active', message: 'A chamada não está em atendimento' };
    if (s.transferTarget) return { ok: false, code: 'call.transfer_in_progress', message: 'Já existe um transbordo em andamento' };
    if (!/^\+?[0-9*#]{2,20}$/.test(number)) return { ok: false, code: 'validation.number', message: 'Número inválido' };
    const allowed = await this.transferAllowed(orgId, number);
    if (!allowed.ok) return { ok: false, code: 'voice.transfer_not_allowed', message: 'Destino não permitido pela política de discagem do órgão' };
    s.transferTarget = number;
    const channelId = `t-${s.callId}-${rid().slice(0, 4)}`;
    this.register(s, channelId, 'external');
    try {
      await this.ariStrict('POST', '/channels', {
        endpoint: this.trunkDial(s, number), app: this.o.connection.app, appArgs: `transfer,${s.callId}`, channelId,
        callerId: s.cfg.transferCallerId === 'trunk' ? (s.cfg.fromUser ?? '') : s.from, timeout: s.cfg.transferRingSec ?? 45,
      });
    } catch (err: any) { this.channels.delete(channelId); s.extChannelId = undefined; s.transferTarget = undefined; return { ok: false, code: 'call.transfer_failed', message: err?.message ?? 'Falha ao originar' }; }
    s.transferTimer = setTimeout(() => { void this.onTransferTimeout(s, channelId); }, ((s.cfg.transferRingSec ?? 45) + 2) * 1000); s.transferTimer.unref?.();
    return { ok: true };
  }

  private async onTransferTimeout(s: Session, channelId: string) {
    if (s.ending || s.transferred || s.extChannelId !== channelId) return;
    this.channels.delete(channelId); s.extChannelId = undefined; s.transferTarget = undefined;
    await this.hangupChannel(channelId);
    this.toSocket(s, 'call:transfer_failed', { cause: 'timeout' });
  }

  private async onTransferAnswered(s: Session) {
    clearTimeout(s.transferTimer);
    if (!s.extChannelId) return;
    if (!s.bridgeId) return this.onIvrTransferAnswered(s);
    await this.ariStrict('POST', `/bridges/${s.bridgeId}/addChannel`, { channel: [s.extChannelId] });
    const agentCh = s.agentChannelId; s.agentChannelId = undefined;
    if (agentCh) { this.channels.delete(agentCh); await this.ari('POST', `/bridges/${s.bridgeId}/removeChannel`, { channel: [agentCh] }); await this.hangupChannel(agentCh); }
    s.transferred = true;
    await prisma.bvCall.update({ where: { id: s.callId }, data: { endReason: 'TRANSFERRED' } });
    await this.mergeConversationMeta(s, { voice: { transferredTo: s.transferTarget, transferredAt: new Date().toISOString() } });
    await closeConversation({ orgId: s.orgId, conversationId: s.conversationId, reason: 'TRANSFERRED_OUT', requestCsat: false }).catch(() => undefined);
    this.toSocket(s, 'call:active', { transferred: true, to: s.transferTarget });
  }

  /** Transferência vinda da URA (nó transfer): liga o chamador direto ao destino pelo tronco. */
  /** Política de destino do transbordo: ramais internos (≤ 6 dígitos, sem +) passam; números externos seguem a política de discagem do órgão (sem premium/serviço/internacional fora da lista). */
  private async transferAllowed(orgId: string, number: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (/^[0-9]{2,6}$/.test(number)) return { ok: true };
    try {
      const verdict = evaluateNumber(await loadDialPolicy(orgId), number);
      return verdict.ok ? { ok: true } : { ok: false, reason: verdict.reason };
    } catch { return { ok: false, reason: 'policy_error' }; }
  }

  private async ivrTransfer(s: Session, number: string) {
    const allowed = await this.transferAllowed(s.orgId, number);
    if (!allowed.ok) {
      logger.warn({ reason: allowed.reason, callId: s.callId }, '[balcao/voice] destino de transferência da URA recusado pela política');
      await this.endCall(s, { reason: 'TRANSFER_NOT_ALLOWED', status: 'FAILED' });
      return;
    }
    s.transferTarget = number;
    const channelId = `t-${s.callId}-${rid().slice(0, 4)}`;
    this.register(s, channelId, 'external');
    try {
      await this.ariStrict('POST', '/channels', { endpoint: this.trunkDial(s, number), app: this.o.connection.app, appArgs: `transfer,${s.callId}`, channelId, callerId: s.from, timeout: s.cfg.transferRingSec ?? 45 });
    } catch (err: any) { logger.warn({ err: err?.message }, '[balcao/voice] transferência da URA falhou'); await this.endCall(s, { reason: 'TRANSFER_FAILED', status: 'FAILED' }); return; }
    s.transferTimer = setTimeout(() => { void this.endCall(s, { reason: 'TRANSFER_TIMEOUT', status: 'FAILED' }); }, ((s.cfg.transferRingSec ?? 45) + 2) * 1000); s.transferTimer.unref?.();
    s.state = 'RINGING_AGENT';
    if (s.callerChannelId) await this.ari('POST', `/channels/${s.callerChannelId}/ring`);
  }

  /** Nó transfer da URA: o destino atendeu → ponte chamador ↔ destino (gravada). */
  private async onIvrTransferAnswered(s: Session) {
    if (!s.callerChannelId || !s.extChannelId) return;
    await this.ari('DELETE', `/channels/${s.callerChannelId}/ring`);
    await this.stopRecording(s, 'ura');
    const bridge = await this.ariStrict<{ id: string }>('POST', '/bridges', { type: 'mixing', name: `bv-${s.callId}` });
    s.bridgeId = bridge.id;
    await this.ariStrict('POST', `/bridges/${bridge.id}/addChannel`, { channel: [s.callerChannelId, s.extChannelId] });
    await this.startRecording(s, 'main', 'bridge', bridge.id);
    s.state = 'ACTIVE'; s.connectedAt = new Date(); s.transferred = true;
    await prisma.bvCall.update({ where: { id: s.callId }, data: { status: 'ACTIVE', answeredAt: s.connectedAt, endReason: 'TRANSFERRED' } });
    await this.mergeConversationMeta(s, { voice: { transferredTo: s.transferTarget, transferredAt: s.connectedAt.toISOString(), from: 'ivr' } });
    await closeConversation({ orgId: s.orgId, conversationId: s.conversationId, reason: 'TRANSFERRED_OUT', requestCsat: false }).catch(() => undefined);
    this.toSocket(s, 'call:active', { transferred: true, to: s.transferTarget });
  }

  private async onDialAgentAnswered(s: Session) {
    clearTimeout(s.ringTimer);
    const number = s.to;
    const channelId = `o-${s.callId}`;
    this.register(s, channelId, 'external');
    try { await this.ariStrict('POST', '/channels', { endpoint: this.trunkDial(s, number), app: this.o.connection.app, appArgs: `dialout,${s.callId}`, channelId, callerId: s.cfg.fromUser ?? s.from, timeout: 45 }); }
    catch (err: any) { logger.warn({ err: err?.message }, '[balcao/voice] click-to-call: falha ao discar'); this.channels.delete(channelId); await this.endCall(s, { reason: 'DIAL_FAILED', status: 'FAILED' }); }
  }

  private async onDialoutAnswered(s: Session) {
    if (!s.agentChannelId || !s.extChannelId) return;
    const bridge = await this.ariStrict<{ id: string }>('POST', '/bridges', { type: 'mixing', name: `bv-${s.callId}` });
    s.bridgeId = bridge.id;
    await this.ariStrict('POST', `/bridges/${bridge.id}/addChannel`, { channel: [s.agentChannelId, s.extChannelId] });
    await this.startRecording(s, 'main', 'bridge', bridge.id);
    s.state = 'ACTIVE'; s.connectedAt = new Date();
    await prisma.bvCall.update({ where: { id: s.callId }, data: { status: 'ACTIVE', answeredAt: s.connectedAt } });
    this.toSocket(s, 'call:active', { agentUserId: s.agentUserId });
  }

  /**
   * Click-to-call: toca o ramal do atendente e, ao atender, disca `number` pelo tronco.
   * Política por órgão (dialPolicy.ts): prefixos/número permitidos, limite diário por atendente e (padrão) permissão + presença ONLINE.
   * Códigos estáveis: `voice.dial_not_allowed` (403) e `voice.dial_limit` (429); `voice.standby` (503) se esta instância não é a líder do ARI.
   */
  async dial(orgId: string, userId: string, number: string): Promise<{ ok: true; callId: string; conversationId: string } | { ok: false; code: string; message: string; status?: number; reason?: string }> {
    if (!/^\+?[0-9*#]{2,20}$/.test(number)) return { ok: false, code: 'validation.number', message: 'Número inválido', status: 400 };
    if (!this.active) return { ok: false, code: 'voice.standby', message: 'Esta instância não controla a telefonia (standby)', status: 503 };
    if (this.dialing.has(userId)) return { ok: false, code: 'voice.busy', message: 'Você já tem uma ligação em andamento', status: 409 };
    this.dialing.add(userId); // exclusão mútua: duas discagens simultâneas do mesmo atendente não furam o limite diário
    try { return await this.dialLocked(orgId, userId, number); } finally { this.dialing.delete(userId); }
  }

  private async dialLocked(orgId: string, userId: string, number: string): ReturnType<AriController['dial']> {
    const user = await prisma.bvUser.findFirst({ where: { id: userId, orgId, active: true }, select: { sipExtension: true, role: true, presence: true } });
    if (!user?.sipExtension) return { ok: false, code: 'voice.no_extension', message: 'Seu usuário não tem ramal SIP configurado', status: 409 };
    if ([...this.sessions.values()].some((x) => x.agentUserId === userId && x.direction === 'OUT')) return { ok: false, code: 'voice.busy', message: 'Você já tem uma ligação em andamento', status: 409 };
    const decision = await checkDialPolicy({ orgId, userId, role: user.role as BvRole, presence: user.presence, number });
    if (!decision.ok) return { ok: false, code: decision.code, message: decision.message, status: decision.status, reason: decision.reason };
    const cfg = await loadTrunkConfig(orgId);
    const settings = await getOrgSettings(orgId);
    const callId = `c${crypto.randomBytes(11).toString('hex')}`;
    const startedAt = new Date();
    await prisma.bvCall.create({ data: { id: callId, orgId, direction: 'OUT', fromNumber: user.sipExtension, toNumber: number, status: 'RINGING', agentUserId: userId, startedAt } });
    const { conversation } = await openConversation({ orgId, channel: 'VOICE', channelRef: callId, externalId: number, status: 'ACTIVE', assignedUserId: userId, metadata: { voice: { callId, direction: 'OUT' } } });
    await prisma.bvCall.update({ where: { id: callId }, data: { conversationId: conversation.id } });
    const s = new Session(callId, orgId, conversation.id, cfg, settings.language, startedAt, user.sipExtension, number);
    s.direction = 'OUT'; s.agentUserId = userId; s.state = 'RINGING_AGENT';
    this.sessions.set(callId, s); this.byConv.set(conversation.id, callId);
    const channelId = `d-${callId}`;
    this.register(s, channelId, 'agent');
    emitBvEvent('call.started', { orgId, callId, conversationId: conversation.id });
    void this.updatePeak(orgId);
    try { await this.ariStrict('POST', '/channels', { endpoint: `PJSIP/${user.sipExtension}`, app: this.o.connection.app, appArgs: `dial,${callId}`, channelId, callerId: number, timeout: Math.ceil(this.ringMs / 1000) }); }
    catch (err: any) { await this.endCall(s, { reason: 'ORIGINATE_FAILED', status: 'FAILED' }); return { ok: false, code: 'voice.originate_failed', message: err?.message ?? 'Falha ao originar', status: 502 }; }
    this.toSocket(s, 'call:ringing', { agentUserId: userId });
    s.ringTimer = setTimeout(() => { void this.endCall(s, { reason: 'AGENT_NO_ANSWER', status: 'FAILED' }); }, this.ringMs + 500); s.ringTimer.unref?.();
    return { ok: true, callId, conversationId: conversation.id };
  }

  /** Encerra uma chamada ativa (botão "desligar"). */
  async hangup(orgId: string, callId: string): Promise<boolean> {
    const s = this.sessions.get(callId);
    if (!s || s.orgId !== orgId) return false;
    await this.endCall(s, { reason: 'AGENT_HANGUP_API' });
    return true;
  }
}

// ── singleton do processo ─────────────────────────────────────────────────────────────────────────────
let instance: AriController | null = null;
export const getAriController = () => instance;
export function setAriController(c: AriController | null) { instance = c; }
