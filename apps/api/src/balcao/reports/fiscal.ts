import fs from 'fs';
import path from 'path';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { checkQuota, setUsageGauge } from '../core/usage';
import { emitToUser } from '../core/realtime';
import { registerJob } from '../core/scheduler';
import { storageRoot } from '../core/storage';
import { USAGE_ITEMS, type UsageItem } from '../core/types';
import { daysInMonth, pad2, projectMonthEnd, round } from './util';

/** Painel do Fiscal do Contrato (TR 1.1.3.1.8.1): consumo por item, valores estimados, cotas, alertas e projeção. */

export interface ItemInfo { item: UsageItem; trItem: string | null; label: string; unit: string; gauge: boolean }
export const ITEM_INFO: Record<UsageItem, ItemInfo> = {
  WA_SERVICE: { item: 'WA_SERVICE', trItem: '7', label: 'WhatsApp — conversas de serviço', unit: 'conversa', gauge: false },
  WA_UTILITY: { item: 'WA_UTILITY', trItem: '8', label: 'WhatsApp — conversas de utilidade', unit: 'conversa', gauge: false },
  WA_MARKETING: { item: 'WA_MARKETING', trItem: '9', label: 'WhatsApp — conversas de marketing', unit: 'conversa', gauge: false },
  STORAGE_BYTES: { item: 'STORAGE_BYTES', trItem: '10', label: 'Armazenamento', unit: 'byte', gauge: true },
  VOICE_MINUTES: { item: 'VOICE_MINUTES', trItem: '11', label: 'Voz — minutos', unit: 'minuto', gauge: false },
  VOICE_PEAK_CHANNELS: { item: 'VOICE_PEAK_CHANNELS', trItem: '11', label: 'Voz — pico de canais simultâneos', unit: 'canal', gauge: true },
  EMAIL_IN: { item: 'EMAIL_IN', trItem: null, label: 'E-mails recebidos', unit: 'e-mail', gauge: false },
  EMAIL_OUT: { item: 'EMAIL_OUT', trItem: null, label: 'E-mails enviados', unit: 'e-mail', gauge: false },
  WEBCHAT_MSG: { item: 'WEBCHAT_MSG', trItem: null, label: 'Mensagens de webchat', unit: 'mensagem', gauge: false },
  AI_CALLS: { item: 'AI_CALLS', trItem: null, label: 'Chamadas de IA', unit: 'chamada', gauge: false },
  AI_TOKENS: { item: 'AI_TOKENS', trItem: null, label: 'Tokens de IA', unit: 'token', gauge: false },
};
export const TB = 1e12; // 1 TB = 10^12 bytes (configurável via interpretação do contrato; ver docs)

/** Preços unitários ESTIMADOS (R$). Padrões do TR; sobrescritos por org.settings.billing.unitPrices. */
export interface UnitPrices { WA_SERVICE: number; WA_UTILITY: number; WA_MARKETING: number; STORAGE_TB_MONTH: number; VOICE_CHANNEL_MONTH: number; [k: string]: number }
export const DEFAULT_UNIT_PRICES: UnitPrices = { WA_SERVICE: 0.11, WA_UTILITY: 0.11, WA_MARKETING: 0.46, STORAGE_TB_MONTH: 493, VOICE_CHANNEL_MONTH: 365 };

export async function getUnitPrices(orgId: string): Promise<UnitPrices> {
  const org = await prisma.bvOrg.findUnique({ where: { id: orgId }, select: { settings: true } });
  const raw = ((org?.settings ?? {}) as any)?.billing?.unitPrices;
  const out: UnitPrices = { ...DEFAULT_UNIT_PRICES };
  if (raw && typeof raw === 'object') for (const [k, v] of Object.entries(raw)) if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = v;
  return out;
}

/** Custo estimado de um item em UM mês (qtd = soma do mês para contadores; máximo do mês para gauges). */
export function monthlyCost(item: UsageItem, qty: number, prices: UnitPrices): number {
  if (item === 'STORAGE_BYTES') return (qty / TB) * prices.STORAGE_TB_MONTH;
  if (item === 'VOICE_PEAK_CHANNELS') return qty * prices.VOICE_CHANNEL_MONTH;
  return qty * (prices[item] ?? 0);
}

const dayStr = (d: Date) => d.toISOString().slice(0, 10);

export type UsageMatrix = Map<string, Map<UsageItem, number>>; // dia (YYYY-MM-DD, UTC) → item → qty

export async function loadUsage(orgId: string, from: Date, to: Date): Promise<UsageMatrix> {
  const rows = await prisma.bvUsageDaily.findMany({ where: { orgId, day: { gte: from, lte: to } }, select: { day: true, item: true, quantity: true } });
  const m: UsageMatrix = new Map();
  for (const r of rows) {
    const k = dayStr(r.day);
    if (!m.has(k)) m.set(k, new Map());
    m.get(k)!.set(r.item as UsageItem, Number(r.quantity));
  }
  return m;
}

const monthKey = (day: string) => day.slice(0, 7);

/** Licenças em uso no intervalo: usuários DISTINTOS com sessão, login ou atribuição de conversa. */
export async function licensesInUse(orgId: string, from: Date, to: Date): Promise<{ atendente: number; supervisor: number; admin: number; fiscal: number; total: number }> {
  const [sessions, logins, assigned, calls] = await Promise.all([
    prisma.bvSession.findMany({ where: { createdAt: { gte: from, lt: to }, user: { orgId } }, select: { userId: true }, distinct: ['userId'] }),
    prisma.bvUser.findMany({ where: { orgId, lastLoginAt: { gte: from, lt: to } }, select: { id: true } }),
    prisma.bvConversation.findMany({ where: { orgId, assignedAt: { gte: from, lt: to }, assignedUserId: { not: null } }, select: { assignedUserId: true }, distinct: ['assignedUserId'] }),
    prisma.bvCall.findMany({ where: { orgId, startedAt: { gte: from, lt: to }, agentUserId: { not: null } }, select: { agentUserId: true }, distinct: ['agentUserId'] }),
  ]);
  const ids = new Set<string>([...sessions.map((s) => s.userId), ...logins.map((l) => l.id), ...assigned.map((a) => a.assignedUserId!), ...calls.map((c) => c.agentUserId!)]);
  const users = ids.size ? await prisma.bvUser.findMany({ where: { orgId, id: { in: [...ids] } }, select: { role: true } }) : [];
  const c = (r: string) => users.filter((u) => u.role === r).length;
  return { atendente: c('ATENDENTE'), supervisor: c('SUPERVISOR'), admin: c('ADMIN'), fiscal: c('FISCAL'), total: users.length };
}

export interface ConsumptionOpts { period: 'DAY' | 'MONTH'; from: Date; to: Date; now?: Date }

/** `from`/`to` são DIAS (UTC, como BvUsageDaily), inclusivos. */
export async function consumption(orgId: string, o: ConsumptionOpts) {
  const prices = await getUnitPrices(orgId);
  const matrix = await loadUsage(orgId, o.from, o.to);
  const days: string[] = [];
  for (let t = o.from.getTime(); t <= o.to.getTime(); t += 86400_000) days.push(dayStr(new Date(t)));

  const items = USAGE_ITEMS.map((item) => {
    const info = ITEM_INFO[item];
    const perDay = days.map((d) => ({ day: d, quantity: matrix.get(d)?.get(item) ?? 0 }));
    const perMonth = new Map<string, number>();
    for (const p of perDay) {
      const mk = monthKey(p.day);
      perMonth.set(mk, info.gauge ? Math.max(perMonth.get(mk) ?? 0, p.quantity) : (perMonth.get(mk) ?? 0) + p.quantity);
    }
    const monthly = [...perMonth.entries()].map(([month, quantity]) => ({ month, quantity, estimatedCost: round(monthlyCost(item, quantity, prices), 2) ?? 0 }));
    const quantity = info.gauge ? Math.max(0, ...monthly.map((m) => m.quantity)) : monthly.reduce((s, m) => s + m.quantity, 0);
    const estimatedCost = round(monthly.reduce((s, m) => s + m.estimatedCost, 0), 2) ?? 0;
    const unitPrice = item === 'STORAGE_BYTES' ? prices.STORAGE_TB_MONTH : item === 'VOICE_PEAK_CHANNELS' ? prices.VOICE_CHANNEL_MONTH : prices[item] ?? 0;
    return {
      item, trItem: info.trItem, label: info.label, unit: info.unit, aggregation: info.gauge ? 'MAX' : 'SUM', quantity,
      unitPrice, unitPriceUnit: item === 'STORAGE_BYTES' ? 'R$/TB·mês' : item === 'VOICE_PEAK_CHANNELS' ? 'R$/canal·mês' : `R$/${info.unit}`,
      estimatedCost, series: o.period === 'DAY' ? perDay : monthly,
    };
  });

  // licenças por mês (uma consulta por mês do intervalo, limitado)
  const months = [...new Set(days.map(monthKey))].slice(0, 24);
  const licenses = [] as Array<{ month: string; atendente: number; supervisor: number; admin: number; fiscal: number; total: number; estimatedCost: number }>;
  for (const mk of months) {
    const [y, m] = mk.split('-').map(Number);
    const l = await licensesInUse(orgId, new Date(Date.UTC(y, m - 1, 1)), new Date(Date.UTC(y, m, 1)));
    licenses.push({ month: mk, ...l, estimatedCost: round(l.atendente * (prices.LICENSE_ATENDENTE ?? 0) + l.supervisor * (prices.LICENSE_SUPERVISOR ?? 0), 2) ?? 0 });
  }
  const total = round(items.reduce((s, i) => s + i.estimatedCost, 0) + licenses.reduce((s, l) => s + l.estimatedCost, 0), 2) ?? 0;
  return {
    period: o.period, from: dayStr(o.from), to: dayStr(o.to), currency: 'BRL', items, licenses,
    totals: { estimatedCost: total },
    notes: 'Valores ESTIMADOS (preços unitários do TR ou de org.settings.billing.unitPrices); não substituem a fatura. Dias de consumo em UTC.',
  };
}

// ── Cotas ────────────────────────────────────────────────────────────────────
export async function listQuotas(orgId: string) {
  const quotas = await prisma.bvQuota.findMany({ where: { orgId }, orderBy: [{ item: 'asc' }, { period: 'asc' }] });
  const out = [];
  for (const q of quotas) {
    const st = (await checkQuota(orgId, q.item as UsageItem)).find((s) => s.period === q.period);
    out.push({ id: q.id, item: q.item, period: q.period, limit: Number(q.limit), action: q.action, alertAtPct: q.alertAtPct, updatedAt: q.updatedAt, status: st ? { used: st.used, pct: st.pct, allowed: st.allowed, alert: st.alert } : null });
  }
  return out;
}

// ── Dashboard + projeção ─────────────────────────────────────────────────────
export async function dashboard(orgId: string, now = new Date()) {
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  const first = new Date(Date.UTC(y, m, 1));
  const today = new Date(Date.UTC(y, m, now.getUTCDate()));
  const dim = daysInMonth(y, m + 1);
  const prices = await getUnitPrices(orgId);
  const matrix = await loadUsage(orgId, first, today);
  const quotas = await prisma.bvQuota.findMany({ where: { orgId } });
  const items = USAGE_ITEMS.map((item) => {
    const info = ITEM_INFO[item];
    const daily: number[] = [];
    let carry = 0;
    for (let d = 1; d <= now.getUTCDate(); d++) {
      const v = matrix.get(`${y}-${pad2(m + 1)}-${pad2(d)}`)?.get(item);
      if (info.gauge) { if (v != null) carry = v; daily.push(carry); } else daily.push(v ?? 0);
    }
    const used = info.gauge ? Math.max(0, ...daily) : daily.reduce((s, v) => s + v, 0);
    const todayQty = daily[daily.length - 1] ?? 0;
    const proj = projectMonthEnd(daily, dim, info.gauge);
    const itemQuotas = quotas.filter((q) => q.item === item).map((q) => {
      const limit = Number(q.limit);
      const base = q.period === 'DAY' ? todayQty : used;
      const projected = q.period === 'DAY' ? todayQty : proj.projected;
      return { id: q.id, period: q.period, limit, action: q.action, alertAtPct: q.alertAtPct, used: base, pct: limit ? round((base / limit) * 100, 1) : 0, projectedAtMonthEnd: projected, willExceed: q.period === 'MONTH' ? projected > limit : null };
    });
    return {
      item, trItem: info.trItem, label: info.label, unit: info.unit, today: todayQty, monthToDate: used,
      projection: { monthEnd: proj.projected, method: proj.method, slopePerDay: round(proj.slopePerDay, 2) },
      estimatedCostToDate: round(monthlyCost(item, used, prices), 2) ?? 0, projectedCost: round(monthlyCost(item, proj.projected, prices), 2) ?? 0,
      quotas: itemQuotas,
    };
  });
  const lic = await licensesInUse(orgId, first, new Date(Date.UTC(y, m + 1, 1)));
  const alerts = await prisma.bvNotification.findMany({ where: { orgId, type: 'QUOTA_ALERT' }, orderBy: { createdAt: 'desc' }, take: 20, distinct: ['title'], select: { title: true, body: true, createdAt: true, data: true } });
  return {
    month: `${y}-${pad2(m + 1)}`, daysElapsed: now.getUTCDate(), daysInMonth: dim, currency: 'BRL', items, licenses: lic,
    totals: { estimatedCostToDate: round(items.reduce((s, i) => s + i.estimatedCostToDate, 0), 2), projectedCost: round(items.reduce((s, i) => s + i.projectedCost, 0), 2) },
    recentAlerts: alerts,
  };
}

// ── Alertas de cota ──────────────────────────────────────────────────────────
/**
 * Para cada cota: se o consumo cruzou alertAtPct ou 100%, cria UMA notificação por usuário FISCAL/ADMIN por
 * (cota, período corrente, limiar). Idempotente: a chave de deduplicação fica em BvNotification.data.dedupKey.
 */
export async function runQuotaAlerts(orgId?: string, now = new Date()): Promise<{ created: number }> {
  const quotas = await prisma.bvQuota.findMany({ where: orgId ? { orgId } : {}, take: 5000 });
  let created = 0;
  const recipientsCache = new Map<string, string[]>();
  for (const q of quotas) {
    const limit = Number(q.limit);
    if (limit <= 0) continue;
    const st = (await checkQuota(q.orgId, q.item as UsageItem)).find((s) => s.period === q.period);
    if (!st) continue;
    const pctNow = (st.used / limit) * 100;
    const periodKey = q.period === 'DAY' ? now.toISOString().slice(0, 10) : now.toISOString().slice(0, 7);
    const levels: Array<{ level: 'ALERT' | 'LIMIT'; at: number }> = [{ level: 'ALERT', at: q.alertAtPct }, { level: 'LIMIT', at: 100 }];
    for (const lv of levels) {
      if (pctNow < lv.at) continue;
      const dedupKey = `quota:${q.id}:${periodKey}:${lv.level}`;
      let users = recipientsCache.get(q.orgId);
      if (!users) {
        users = (await prisma.bvUser.findMany({ where: { orgId: q.orgId, active: true, role: { in: ['FISCAL', 'ADMIN'] } }, select: { id: true } })).map((u) => u.id);
        recipientsCache.set(q.orgId, users);
      }
      if (!users.length) continue;
      const existing = await prisma.bvNotification.findMany({ where: { userId: { in: users }, type: 'QUOTA_ALERT', data: { path: ['dedupKey'], equals: dedupKey } }, select: { userId: true } });
      const has = new Set(existing.map((e) => e.userId));
      const info = ITEM_INFO[q.item as UsageItem];
      const title = lv.level === 'LIMIT' ? `Cota ${q.period === 'DAY' ? 'diária' : 'mensal'} atingida: ${info.label}` : `Cota ${q.period === 'DAY' ? 'diária' : 'mensal'} em ${Math.floor(pctNow)}%: ${info.label}`;
      const body = `Consumo ${st.used} de ${limit} ${info.unit}(s) (${Math.floor(pctNow)}%). Ação da cota: ${q.action === 'BLOCK' ? 'bloquear' : 'alertar'}.`;
      for (const uid of users) {
        if (has.has(uid)) continue;
        const n = await prisma.bvNotification.create({ data: { orgId: q.orgId, userId: uid, type: 'QUOTA_ALERT', title, body, data: { dedupKey, quotaId: q.id, item: q.item, period: q.period, periodKey, level: lv.level, used: st.used, limit, pct: Math.floor(pctNow), action: q.action } } });
        created++;
        emitToUser(uid, 'notification', { id: n.id, type: n.type, title, body, data: n.data });
      }
    }
  }
  return { created };
}

// ── Armazenamento (item 10) ──────────────────────────────────────────────────
export interface StorageMeasure { bytes: number; files: number; truncated: boolean; diskBytes: number; recordingsDbBytes: number }

async function walk(dir: string, acc: { bytes: number; files: number; entries: number }, maxEntries: number, deadline: number): Promise<boolean> {
  let d: fs.Dir;
  try { d = await fs.promises.opendir(dir); } catch { return true; }
  for await (const e of d) {
    if (++acc.entries > maxEntries || Date.now() > deadline) return false;
    if (e.isSymbolicLink()) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!(await walk(p, acc, maxEntries, deadline))) return false; }
    else if (e.isFile()) { try { acc.bytes += (await fs.promises.stat(p)).size; acc.files++; } catch { /* sumiu durante a varredura */ } }
  }
  return true;
}

/**
 * Soma o tamanho dos arquivos sob `<storageRoot>/<orgId>/` (sem seguir symlinks; limite de entradas e de tempo).
 * Se a pasta `recordings` não existe no disco (ex.: backend S3), soma BvCall.recordingSizeBytes.
 */
export async function measureOrgStorage(orgId: string, opts: { maxEntries?: number; maxMs?: number } = {}): Promise<StorageMeasure> {
  const root = path.join(storageRoot(), orgId);
  const acc = { bytes: 0, files: 0, entries: 0 };
  const complete = await walk(root, acc, opts.maxEntries ?? Number(process.env.BV_STORAGE_SCAN_MAX || 500_000), Date.now() + (opts.maxMs ?? 120_000));
  let recordingsOnDisk = false;
  try { recordingsOnDisk = (await fs.promises.stat(path.join(root, 'recordings'))).isDirectory(); } catch { /* ausente */ }
  let dbBytes = 0;
  if (!recordingsOnDisk) {
    const agg = await prisma.bvCall.aggregate({ where: { orgId, recordingKey: { not: null } }, _sum: { recordingSizeBytes: true } });
    dbBytes = Number(agg._sum.recordingSizeBytes ?? 0n);
  }
  return { bytes: acc.bytes + dbBytes, files: acc.files, truncated: !complete, diskBytes: acc.bytes, recordingsDbBytes: dbBytes };
}

export async function runStorageMeasure(orgId?: string): Promise<Array<{ orgId: string; bytes: number; truncated: boolean }>> {
  const orgs = await prisma.bvOrg.findMany({ where: orgId ? { id: orgId } : {}, select: { id: true }, take: 1000 });
  const out = [];
  for (const o of orgs) {
    try {
      const r = await measureOrgStorage(o.id);
      if (r.truncated) { logger.warn({ orgId: o.id }, '[balcao] medição de armazenamento truncada; gauge não atualizado'); out.push({ orgId: o.id, bytes: r.bytes, truncated: true }); continue; }
      await setUsageGauge(o.id, 'STORAGE_BYTES', r.bytes, 'set');
      out.push({ orgId: o.id, bytes: r.bytes, truncated: false });
    } catch (err: any) { logger.error({ err: err?.message, orgId: o.id }, '[balcao] medição de armazenamento falhou'); }
  }
  return out;
}

export function registerFiscalJobs(): void {
  registerJob('balcao.fiscal.alerts', { intervalMs: 60_000, lockTtlSec: 120 }, async () => { await runQuotaAlerts(); });
  registerJob('balcao.fiscal.storage', { intervalMs: 6 * 3600_000, lockTtlSec: 1800, runOnStart: true }, async () => { await runStorageMeasure(); });
}


