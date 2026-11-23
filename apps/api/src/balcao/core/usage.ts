import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { GAUGE_ITEMS, type UsageItem } from './types';

const dayOf = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Incrementa o consumo do dia (contadores). Nunca lança. */
export async function recordUsage(orgId: string, item: UsageItem, qty = 1, at: Date = new Date()): Promise<void> {
  try {
    const day = dayOf(at);
    await prisma.bvUsageDaily.upsert({
      where: { orgId_day_item: { orgId, day, item } },
      create: { orgId, day, item, quantity: BigInt(qty) },
      update: { quantity: { increment: BigInt(qty) } },
    });
  } catch (err: any) { logger.error({ err: err?.message, item }, '[balcao] recordUsage falhou'); }
}

/** Para medidores (gauge): grava o valor do dia — `max` mantém o pico (ex.: canais simultâneos). */
export async function setUsageGauge(orgId: string, item: UsageItem, value: number, mode: 'set' | 'max' = 'set', at: Date = new Date()): Promise<void> {
  try {
    const day = dayOf(at);
    const row = await prisma.bvUsageDaily.findUnique({ where: { orgId_day_item: { orgId, day, item } } });
    const v = BigInt(Math.round(value));
    const next = mode === 'max' && row && row.quantity > v ? row.quantity : v;
    await prisma.bvUsageDaily.upsert({ where: { orgId_day_item: { orgId, day, item } }, create: { orgId, day, item, quantity: next }, update: { quantity: next } });
  } catch (err: any) { logger.error({ err: err?.message, item }, '[balcao] setUsageGauge falhou'); }
}

/** Consumo de um item no intervalo [from, to] (UTC). Gauges: retorna o MAIOR valor do período. */
export async function getUsage(orgId: string, item: UsageItem, from: Date, to: Date): Promise<number> {
  const rows = await prisma.bvUsageDaily.findMany({ where: { orgId, item, day: { gte: dayOf(from), lte: dayOf(to) } }, select: { quantity: true } });
  if (GAUGE_ITEMS.includes(item)) return Number(rows.reduce((m, r) => (r.quantity > m ? r.quantity : m), 0n));
  return Number(rows.reduce((s, r) => s + r.quantity, 0n));
}

export function periodRange(period: 'DAY' | 'MONTH', at = new Date()): { from: Date; to: Date } {
  const to = dayOf(at);
  const from = period === 'DAY' ? to : new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  return { from, to };
}

export interface QuotaStatus { item: UsageItem; period: 'DAY' | 'MONTH'; limit: number; used: number; pct: number; action: 'ALERT' | 'BLOCK'; allowed: boolean; alert: boolean }

/** Situação das cotas do item. `allowed=false` só quando a cota é BLOCK e foi atingida. Sem cota definida → allowed. */
export async function checkQuota(orgId: string, item: UsageItem, requested = 1): Promise<QuotaStatus[]> {
  const quotas = await prisma.bvQuota.findMany({ where: { orgId, item } });
  const out: QuotaStatus[] = [];
  for (const q of quotas) {
    const { from, to } = periodRange(q.period as 'DAY' | 'MONTH');
    const used = await getUsage(orgId, item, from, to);
    const limit = Number(q.limit);
    out.push({
      item, period: q.period as 'DAY' | 'MONTH', limit, used, pct: limit ? Math.round((used / limit) * 100) : 0,
      action: q.action as 'ALERT' | 'BLOCK', allowed: !(q.action === 'BLOCK' && used + requested > limit), alert: limit > 0 && used / limit * 100 >= q.alertAtPct,
    });
  }
  return out;
}

export class QuotaExceededError extends Error {
  constructor(public item: UsageItem, public status: QuotaStatus) { super(`Cota excedida para ${item} (${status.period})`); }
}

/** Lança QuotaExceededError se alguma cota BLOCK impedir o consumo. */
export async function assertQuota(orgId: string, item: UsageItem, requested = 1): Promise<void> {
  const blocked = (await checkQuota(orgId, item, requested)).find((s) => !s.allowed);
  if (blocked) throw new QuotaExceededError(item, blocked);
}
