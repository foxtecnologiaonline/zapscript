import { z } from 'zod';
import { CHANNELS, CLOSE_REASONS } from '../core/types';
import {
  DIMENSIONS, DIM_KEYS, METRICS, METRIC_KEYS, aggregate, GRANULARITIES, type Filters,
} from './metrics';
import { PRESETS, presetPeriod, resolvePeriod, describePeriod, type CsvColumn, type Period } from './util';

/**
 * Relatórios personalizáveis. A definição é validada contra ALLOWLISTS (métricas, dimensões, filtros);
 * qualquer campo fora delas é rejeitado (schema estrito). Nunca existe SQL livre.
 */
const ids = z.array(z.string().min(1).max(64)).max(50);
export const customDefinitionSchema = z.strictObject({
  metrics: z.array(z.enum(METRIC_KEYS)).min(1).max(20),
  groupBy: z.array(z.enum(DIM_KEYS)).max(2).default([]),
  filters: z.strictObject({
    channel: z.array(z.enum(CHANNELS)).max(4).optional(),
    queueId: ids.optional(),
    agentId: ids.optional(),
    category: z.array(z.string().min(1).max(80)).max(50).optional(),
    closeReason: z.array(z.enum(CLOSE_REASONS)).max(5).optional(),
    status: z.array(z.enum(['BOT', 'WAITING', 'ACTIVE', 'CLOSED'])).max(4).optional(),
  }).default({}),
  period: z.strictObject({
    preset: z.enum(PRESETS).optional(),
    from: z.string().max(40).optional(),
    to: z.string().max(40).optional(),
  }).default({ preset: 'LAST_30_DAYS' }),
  orderBy: z.strictObject({ key: z.string().max(40), dir: z.enum(['asc', 'desc']).default('desc') }).optional(),
  limit: z.number().int().min(1).max(5000).default(1000),
  name: z.string().max(120).optional(),
}).refine((d) => !d.orderBy || d.metrics.includes(d.orderBy.key) || d.groupBy.includes(d.orderBy.key), { message: 'orderBy.key deve ser uma métrica ou dimensão selecionada', path: ['orderBy', 'key'] });
export type CustomDefinition = z.infer<typeof customDefinitionSchema>;

/** Catálogo exposto em GET /reports/definitions. */
export function definitionsCatalog() {
  return {
    source: 'conversations',
    cohort: 'Conversas iniciadas (startedAt) dentro do período, no fuso do órgão',
    metrics: Object.values(METRICS).map((m) => ({ key: m.key, label: m.label, unit: m.unit, description: m.description })),
    dimensions: Object.values(DIMENSIONS).map((d) => ({ key: d.key, label: d.label, time: !!d.time })),
    filters: [
      { key: 'channel', type: 'enum[]', values: [...CHANNELS] },
      { key: 'queueId', type: 'id[]' }, { key: 'agentId', type: 'id[]' }, { key: 'category', type: 'string[]' },
      { key: 'closeReason', type: 'enum[]', values: [...CLOSE_REASONS] }, { key: 'status', type: 'enum[]', values: ['BOT', 'WAITING', 'ACTIVE', 'CLOSED'] },
    ],
    periods: { presets: [...PRESETS], custom: 'from/to (YYYY-MM-DD no fuso do órgão, ou ISO 8601)' },
    granularities: [...GRANULARITIES],
    limits: { maxMetrics: 20, maxGroupBy: 2, maxRows: 5000 },
  };
}

export function periodOf(def: CustomDefinition['period'], tz: string, now = new Date()): Period {
  if (def.from || def.to) return resolvePeriod({ from: def.from, to: def.to }, tz, now);
  return presetPeriod(def.preset ?? 'LAST_30_DAYS', tz, now);
}

export async function runCustom(orgId: string, def: CustomDefinition, tz: string, now = new Date()) {
  const period = periodOf(def.period, tz, now);
  const f: Filters = { orgId, period, ...def.filters };
  const rows = await aggregate(f, def.groupBy, def.metrics, { orderBy: def.orderBy, limit: def.limit });
  const columns: Array<CsvColumn & { unit?: string }> = [];
  for (const g of def.groupBy) {
    columns.push({ key: g, label: DIMENSIONS[g].label });
    if (g === 'queue') columns.push({ key: 'queueName', label: 'Nome da fila' });
    if (g === 'agent') columns.push({ key: 'agentName', label: 'Nome do atendente' });
  }
  for (const m of def.metrics) columns.push({ key: m, label: METRICS[m].label, unit: METRICS[m].unit });
  return { definition: def, period: describePeriod(period), columns, rows };
}
