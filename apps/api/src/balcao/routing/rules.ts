import { z } from 'zod';
import { CHANNELS } from '../core/types';
import type { DayKey } from '../core/settings';

/** Regras de roteamento (BvRoutingRule): condições, ação e avaliação. Funções puras — testáveis sem banco. */

export const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const satisfies readonly DayKey[];

const strList = z.array(z.string().trim().min(1).max(60)).max(50);

export const ruleConditionsSchema = z.strictObject({
  channels: z.array(z.enum(CHANNELS)).max(CHANNELS.length).optional(),
  contactCategories: strList.optional(),
  categories: strList.optional(),
  intents: strList.optional(),
  outsideHours: z.boolean().optional(),
  /** 0=domingo … 6=sábado, ou 'sun'…'sat'. */
  weekdays: z.array(z.union([z.number().int().min(0).max(6), z.enum(DAY_KEYS)])).max(7).optional(),
  minWaitSec: z.number().int().min(0).max(30 * 86400).optional(),
});
export type RuleConditions = z.infer<typeof ruleConditionsSchema>;

export const ruleActionSchema = z.strictObject({
  queueId: z.string().min(1).max(64),
  priorityBoost: z.number().int().min(-1000).max(1000).optional(),
  setCategory: z.string().trim().min(1).max(60).optional(),
});
export type RuleAction = z.infer<typeof ruleActionSchema>;

export interface RuleContext {
  channel: string;
  contactCategory?: string | null;
  category?: string | null;
  intent?: string | null;
  /** Instante avaliado está fora do horário comercial do órgão. */
  outsideHours: boolean;
  weekday: DayKey;
  /** Segundos que a conversa já espera na fila. */
  waitSec: number;
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
const inList = (list: string[] | undefined, value: string | null | undefined) =>
  !list || list.length === 0 || list.some((x) => norm(x) === norm(value));

const weekdayKey = (d: number | DayKey): DayKey => (typeof d === 'number' ? DAY_KEYS[d] : d);

/** A conversa satisfaz TODAS as condições informadas (condição ausente/vazia = não restringe). */
export function matchConditions(c: RuleConditions, ctx: RuleContext): boolean {
  if (c.channels?.length && !c.channels.includes(ctx.channel as (typeof CHANNELS)[number])) return false;
  if (!inList(c.contactCategories, ctx.contactCategory)) return false;
  if (!inList(c.categories, ctx.category)) return false;
  if (!inList(c.intents, ctx.intent)) return false;
  if (c.outsideHours !== undefined && c.outsideHours !== ctx.outsideHours) return false;
  if (c.weekdays?.length && !c.weekdays.map(weekdayKey).includes(ctx.weekday)) return false;
  if (c.minWaitSec !== undefined && ctx.waitSec < c.minWaitSec) return false;
  return true;
}

export interface RuleLike { id: string; name?: string; position: number; active: boolean; conditions: unknown; action: unknown; createdAt?: Date }
export interface ParsedRule { id: string; name: string; position: number; conditions: RuleConditions; action: RuleAction }

/** Lê regras do banco ignorando as com JSON inválido (nunca derruba o roteamento por regra mal formada). */
export function parseRules(rows: RuleLike[]): ParsedRule[] {
  const out: ParsedRule[] = [];
  for (const r of rows) {
    if (!r.active) continue;
    const c = ruleConditionsSchema.safeParse(r.conditions ?? {});
    const a = ruleActionSchema.safeParse(r.action);
    if (c.success && a.success) out.push({ id: r.id, name: r.name ?? r.id, position: r.position, conditions: c.data, action: a.data });
  }
  return out.sort((x, y) => x.position - y.position);
}

/** Regras que casam, na ordem de avaliação (`position`). O chamador usa a primeira cuja fila é válida. */
export function matchingRules(rules: ParsedRule[], ctx: RuleContext): ParsedRule[] {
  return rules.filter((r) => matchConditions(r.conditions, ctx));
}
