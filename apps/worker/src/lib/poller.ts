import { logger } from './logger';

/**
 * Poller com intervalo adaptativo — substitui o padrão `setInterval(tick, FIXO)`
 * dos agendadores do worker.
 *
 * MOTIVAÇÃO (carga/custo): os três pollers de 30s/60s (notifier de campanhas,
 * agendador de campanhas, agendador do MKT-Fast) somavam ~5.760 execuções por
 * dia contra o Supabase mesmo com ZERO campanha ou missão no sistema — ~91% de
 * todos os ticks da plataforma. Em produto ocioso isso é query paga (egress +
 * compute do banco) e CPU que empurram a necessidade de uma máquina maior do
 * que a carga real justifica.
 *
 * Dois mecanismos combinados:
 *
 * 1. BACKOFF ADAPTATIVO — um tick que não encontra trabalho dobra o próximo
 *    intervalo até `maxMs`; um tick que encontra trabalho volta na hora para
 *    `minMs`. Enquanto existe atividade a cadência é idêntica à de antes (sem
 *    regressão de experiência); em ociosidade converge para o teto.
 *
 * 2. HORIZONTE — quando o tick sabe quando é o próximo trabalho (ex.: o
 *    `scheduledAt` mais próximo), devolve `nextAt` e o poller encurta o sono
 *    para acordar nesse instante. Isso torna o disparo agendado MAIS preciso do
 *    que o intervalo fixo de 60s anterior: uma campanha marcada com antecedência
 *    maior que `maxMs` dispara no horário, em vez de até 60s depois.
 *
 *    O horizonte apenas ENCURTA o sono — nunca o alonga além de `maxMs`. Um
 *    trabalho criado DURANTE o sono (campanha agendada agora para daqui 2 min)
 *    ainda precisa ser descoberto, e `maxMs` é o atraso máximo nesse caso. É
 *    por isso que `maxMs` não deve ser arbitrariamente grande.
 *
 *    Um sono definido pelo horizonte é EXATO: não leva jitter nem respeita o
 *    piso de `minMs`. Os dois existem para o caso ocioso; aplicados aqui,
 *    fariam o poller acordar antes da hora, não achar nada e então esperar
 *    outro `minMs` inteiro — exatamente o atraso que o horizonte elimina.
 *    O piso absoluto de MIN_TIMER_MS evita sono degenerado se um `nextAt`
 *    patológico (relógio fora de hora) ficar sempre a milissegundos à frente.
 *
 * Sem heartbeat de propósito: gravar `CronHeartbeat` a cada tick adicionaria
 * justamente as escritas que este módulo existe para remover, e o watchdog de
 * `health-monitor.ts` filtra por uma lista fixa de `jobName` (COPILOTO_CRON_*)
 * que não inclui estes pollers. Se um deles entrar nessa lista no futuro, o
 * lugar de gravar é dentro do próprio tick, não aqui.
 */

/** Piso absoluto de qualquer sono agendado — rede contra loop quente. */
const MIN_TIMER_MS = 1_000;

export interface PollerTickResult {
  /** true = achou trabalho neste tick → o próximo intervalo volta para `minMs`. */
  worked?: boolean;
  /** Próximo trabalho conhecido; encurta o sono para acordar nesse instante. */
  nextAt?: Date | null;
}

export interface PollerOptions {
  /** Identificador usado no prefixo de log. */
  name: string;
  /** Cadência quando há trabalho — equivale ao intervalo fixo de antes. */
  minMs: number;
  /** Teto em ociosidade. Também é o atraso máximo para descobrir trabalho novo. */
  maxMs: number;
  /** Atraso do primeiro tick. Default 0 — roda no boot, como o código anterior. */
  firstRunMs?: number;
  /**
   * Dispersão aleatória aplicada a cada intervalo (default 10%). Evita que
   * todos os pollers acordem no mesmo segundo depois de um restart e batam no
   * banco em rajada.
   */
  jitterPct?: number;
  tick: () => Promise<PollerTickResult | void>;
}

export interface PollerHandle {
  /** Cancela o próximo tick. Idempotente. */
  stop: () => void;
  /** Intervalo atual em ms — diagnóstico e teste. */
  currentDelayMs: () => number;
}

/** Lê um intervalo em ms de variável de ambiente, caindo no default se ausente ou inválida. */
export function envMs(name: string, defaultMs: number): number {
  const raw = process.env[name];
  if (!raw) return defaultMs;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultMs;
}

export function startPoller(opts: PollerOptions): PollerHandle {
  const { name, tick } = opts;
  const minMs     = Math.max(1_000, opts.minMs);
  const maxMs     = Math.max(minMs, opts.maxMs);
  const jitterPct = opts.jitterPct ?? 0.1;

  let delay   = minMs;
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  function withJitter(ms: number): number {
    const spread = ms * jitterPct;
    return Math.max(MIN_TIMER_MS, Math.round(ms + (Math.random() * 2 - 1) * spread));
  }

  /** `exact` = sono ditado pelo horizonte: agenda no instante pedido, sem jitter. */
  function schedule(ms: number, exact = false): void {
    if (stopped) return;
    // ms <= 0 (primeiro tick) roda imediatamente, sem jitter.
    timer = setTimeout(run, ms <= 0 ? 0 : exact ? ms : withJitter(ms));
    // unref(): um poller nunca deve segurar o processo vivo num shutdown.
    timer.unref?.();
  }

  async function run(): Promise<void> {
    if (stopped) return;
    let exact = false;
    try {
      const result = (await tick()) || {};
      // Achou trabalho → cadência mínima. Ocioso → dobra até o teto.
      delay = result.worked ? minMs : Math.min(delay * 2, maxMs);
      if (result.nextAt) {
        const untilNext = result.nextAt.getTime() - Date.now();
        if (untilNext <= 0) {
          // Agendamento que já venceu mas não entrou no lote de trabalho deste
          // tick: volta à cadência mínima em vez de virar sono de ~0ms.
          delay = minMs;
        } else if (untilNext < delay) {
          // Horizonte vence o backoff: dorme até o instante do agendamento.
          delay = Math.max(MIN_TIMER_MS, untilNext);
          exact = true;
        }
      }
    } catch (err: any) {
      // O tick já trata os próprios erros; isto é a rede de segurança. Falha
      // conta como ociosidade (aplica backoff) para não martelar um banco fora
      // do ar a cada `minMs`.
      logger.error(`[Poller:${name}] Erro não tratado no tick: ${err?.message ?? err}`);
      delay = Math.min(delay * 2, maxMs);
    }
    schedule(delay, exact);
  }

  logger.info(
    `[Poller:${name}] ativo — min ${Math.round(minMs / 1000)}s, max ${Math.round(maxMs / 1000)}s`,
  );
  schedule(opts.firstRunMs ?? 0);

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    currentDelayMs: () => delay,
  };
}
