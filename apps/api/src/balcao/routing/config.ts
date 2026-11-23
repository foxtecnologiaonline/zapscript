import type { BvOrgSettings } from '../core/settings';

/**
 * Parâmetros do roteamento. Podem vir de `settings.routing` do órgão (chave opcional, ainda fora do tipo
 * BvOrgSettings do core) ou de variáveis de ambiente (BV_ROUTING_*). Prioridade: órgão > ambiente > padrão.
 */
export interface RoutingConfig {
  /** Peso somado à prioridade conforme a categoria do contato (cidadão, advogado, MP...). */
  categoryWeights: Record<string, number>;
  /** Horas de inatividade para encerrar conversas BOT/WAITING com TIMEOUT. 0 desliga. */
  timeoutHours: number;
  /** Aumento de prioridade quando a espera passa de maxWaitSec e a fila não tem overflowQueueId. */
  overflowPriorityBoost: number;
}

export const DEFAULT_CATEGORY_WEIGHTS: Record<string, number> = {
  MP: 3, DEFENSORIA: 3, ADVOGADO: 2, SERVIDOR: 1, CIDADAO: 0, OUTRO: 0,
};

const num = (v: unknown, fallback: number): number => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : fallback;
};

export function routingConfig(settings: BvOrgSettings): RoutingConfig {
  const over = ((settings as unknown as { routing?: Partial<RoutingConfig> }).routing ?? {}) as Partial<RoutingConfig>;
  const weights = { ...DEFAULT_CATEGORY_WEIGHTS };
  if (over.categoryWeights && typeof over.categoryWeights === 'object') {
    for (const [k, v] of Object.entries(over.categoryWeights)) if (Number.isFinite(Number(v))) weights[k.toUpperCase()] = Number(v);
  }
  return {
    categoryWeights: weights,
    timeoutHours: Math.max(0, num(over.timeoutHours, num(process.env.BV_ROUTING_TIMEOUT_HOURS, 24))),
    overflowPriorityBoost: Math.max(0, num(over.overflowPriorityBoost, num(process.env.BV_ROUTING_OVERFLOW_BOOST, 5))),
  };
}

export const sweepIntervalMs = (): number => Math.max(1000, num(process.env.BV_ROUTING_SWEEP_MS, 15_000));
export const sweepBatchSize = (): number => Math.max(10, num(process.env.BV_ROUTING_SWEEP_BATCH, 500));
