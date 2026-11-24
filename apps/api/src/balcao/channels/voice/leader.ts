import crypto from 'crypto';
import { logger } from '../../../lib/logger';

/**
 * Exclusão mútua do controlador ARI: só UMA instância da API controla a aplicação Stasis (várias conexões à mesma app recebem os MESMOS
 * eventos e atenderiam a chamada em duplicidade). Lock distribuído em Redis: `SET key id PX ttl NX`, renovado periodicamente por script
 * (só renova se o valor ainda é o nosso) e liberado no shutdown. Instância sem o lock fica em standby e tenta assumir a cada `retryMs`.
 *
 * Perda de liderança: renovação rejeitada (outro dono) OU sem confirmação do Redis por mais de `ttlMs` (não dá para provar que ainda
 * somos donos) → `onLose` (o controlador desconecta do ARI). Redis fora no start = standby (falha fechada: duplicar o ARI é pior).
 */
export interface LockRedis {
  set(key: string, value: string, ...args: any[]): Promise<unknown>;
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

export interface LeaderLockOptions {
  redis: LockRedis;
  key: string;
  ttlMs?: number;
  renewMs?: number;
  retryMs?: number;
  instanceId?: string;
  onAcquire: () => void;
  onLose: () => void;
}

const RENEW = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end`;
const RELEASE = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

export class AriLeaderLock {
  readonly instanceId: string;
  readonly ttlMs: number;
  private renewMs: number;
  private retryMs: number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastConfirmedAt = 0;
  private busy = false;
  held = false;
  lastError: string | null = null;

  constructor(private o: LeaderLockOptions) {
    this.instanceId = o.instanceId ?? `${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
    this.ttlMs = Math.max(200, o.ttlMs ?? 15_000);
    this.renewMs = Math.max(50, o.renewMs ?? Math.floor(this.ttlMs / 3));
    this.retryMs = Math.max(50, o.retryMs ?? this.renewMs);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.tick();
  }

  private schedule(ms: number) {
    if (!this.running) return;
    this.timer = setTimeout(() => { void this.tick(); }, ms);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (!this.running || this.busy) return;
    this.busy = true;
    try { if (this.held) await this.renew(); else await this.tryAcquire(); }
    finally { this.busy = false; this.schedule(this.held ? this.renewMs : this.retryMs); }
  }

  private async tryAcquire(): Promise<void> {
    try {
      const got = await this.o.redis.set(this.o.key, this.instanceId, 'PX', this.ttlMs, 'NX');
      this.lastError = null;
      if (got !== 'OK') return;
      if (!this.running) { await this.o.redis.eval(RELEASE, 1, this.o.key, this.instanceId); return; } // parou durante a aquisição
      this.held = true; this.lastConfirmedAt = Date.now();
      logger.info({ key: this.o.key }, '[balcao/voice] esta instância assumiu o controle do ARI (leader)');
      this.o.onAcquire();
    } catch (err: any) { this.lastError = err?.message ?? 'redis indisponível'; }
  }

  private async renew(): Promise<void> {
    try {
      const ok = Number(await this.o.redis.eval(RENEW, 1, this.o.key, this.instanceId, this.ttlMs));
      this.lastError = null;
      if (ok === 1) { this.lastConfirmedAt = Date.now(); return; }
      this.lose('outra instância assumiu o lock');
    } catch (err: any) {
      this.lastError = err?.message ?? 'redis indisponível';
      if (Date.now() - this.lastConfirmedAt >= this.ttlMs) this.lose('lock não confirmado dentro do TTL (Redis indisponível)');
    }
  }

  private lose(why: string) {
    if (!this.held) return;
    this.held = false;
    logger.warn({ key: this.o.key, why }, '[balcao/voice] controle do ARI perdido — instância em standby');
    try { this.o.onLose(); } catch (err: any) { logger.error({ err: err?.message }, '[balcao/voice] onLose falhou'); }
  }

  /** Para de renovar/tentar e libera o lock (se ainda é nosso). Idempotente. */
  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const wasHeld = this.held;
    this.held = false;
    if (!wasHeld) return;
    try { await this.o.redis.eval(RELEASE, 1, this.o.key, this.instanceId); }
    catch (err: any) { logger.warn({ err: err?.message }, '[balcao/voice] não foi possível liberar o lock do ARI (expira sozinho no TTL)'); }
  }
}
