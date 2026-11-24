import { prisma } from '../../lib/prisma';
import { getOrgSettings } from '../core/settings';
import { aggregate, getContractInfo, iqaByContractMonth, type Filters } from './metrics';
import { licensesInUse, loadUsage, ITEM_INFO } from './fiscal';
import { voiceTotals, voicePeakConcurrent } from './voice';
import { storeReportFile } from './schedule';
import { toCsv, validTz, zonedToUtc, describePeriod, type Period } from './util';
import { USAGE_ITEMS, type UsageItem } from '../core/types';

/** Relatório mensal da contratada (TR 8.2.9). */
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function buildMonthly(orgId: string, month: string, now = new Date()) {
  const tz = validTz((await getOrgSettings(orgId)).timezone);
  const [y, m] = month.split('-').map(Number);
  const period: Period = { from: zonedToUtc(y, m, 1, 0, 0, tz), to: zonedToUtc(y, m + 1, 1, 0, 0, tz), timezone: tz };
  const f: Filters = { orgId, period };
  const udFrom = new Date(Date.UTC(y, m - 1, 1)), udTo = new Date(Date.UTC(y, m, 0));

  const [kpi, byChannel, lic, usage, voice, peak, tasksByKind, tasksDone, contract] = await Promise.all([
    aggregate(f, [], ['total', 'closed', 'abandoned', 'tmeAvg', 'tmeP90', 'tmaAvg', 'tmaP90', 'tmrAvg', 'nps', 'npsResponses', 'csatAvg', 'fcrRate', 'slaRate', 'slaViolations', 'botContainmentRate', 'iqaRate']),
    aggregate(f, ['channel'], ['total', 'closed']),
    licensesInUse(orgId, period.from, period.to),
    loadUsage(orgId, udFrom, udTo),
    voiceTotals({ orgId, period }),
    voicePeakConcurrent({ orgId, period }),
    prisma.bvTask.groupBy({ by: ['kind', 'status'], where: { orgId, createdAt: { gte: period.from, lt: period.to } }, _count: { _all: true } }),
    prisma.bvTask.count({ where: { orgId, completedAt: { gte: period.from, lt: period.to } } }),
    getContractInfo(orgId, tz),
  ]);
  const iqa = await iqaByContractMonth({ orgId }, tz, new Date(Math.min(period.to.getTime(), now.getTime())));
  const cm = iqa.months.find((x) => new Date(x.from) <= period.from && new Date(x.to) >= period.to) ?? iqa.months.find((x) => new Date(x.from) <= period.from && new Date(x.to) > period.from) ?? null;

  const sum = (item: UsageItem) => [...usage.values()].reduce((s, d) => s + (d.get(item) ?? 0), 0);
  const max = (item: UsageItem) => Math.max(0, ...[...usage.values()].map((d) => d.get(item) ?? 0));
  const messaging = USAGE_ITEMS.filter((i) => !ITEM_INFO[i].gauge && i !== 'VOICE_MINUTES').map((i) => ({ item: i, trItem: ITEM_INFO[i].trItem, label: ITEM_INFO[i].label, quantity: sum(i) }));
  const kinds: Record<string, { total: number; byStatus: Record<string, number> }> = {};
  for (const t of tasksByKind) { const k = (kinds[t.kind] ??= { total: 0, byStatus: {} }); k.total += t._count._all; k.byStatus[t.status] = t._count._all; }

  return {
    kind: 'MONTHLY', month, generatedAt: now.toISOString(), period: describePeriod(period),
    licenses: { atendentes: lic.atendente, supervisores: lic.supervisor, administradores: lic.admin, fiscais: lic.fiscal, total: lic.total, criterio: 'usuários distintos com sessão, login ou atendimento no mês' },
    messaging,
    storage: { maxBytes: max('STORAGE_BYTES') },
    voice: { minutes: sum('VOICE_MINUTES'), peakChannelsRecorded: max('VOICE_PEAK_CHANNELS'), calls: voice.total, answered: voice.answered, abandoned: voice.abandoned, peakConcurrentCalls: peak },
    attendances: { total: kpi[0].total, closed: kpi[0].closed, abandoned: kpi[0].abandoned, byChannel: byChannel.map((r) => ({ channel: r.channel, total: r.total, closed: r.closed })) },
    indicators: {
      nps: kpi[0].nps, npsResponses: kpi[0].npsResponses, csatAvg: kpi[0].csatAvg, tmeAvgSec: kpi[0].tmeAvg, tmeP90Sec: kpi[0].tmeP90, tmaAvgSec: kpi[0].tmaAvg, tmaP90Sec: kpi[0].tmaP90,
      tmrAvgSec: kpi[0].tmrAvg, fcrRate: kpi[0].fcrRate, slaRate: kpi[0].slaRate, slaViolations: kpi[0].slaViolations, botContainmentRate: kpi[0].botContainmentRate,
      iqa: cm ? { contractMonth: cm.contractMonth, value: cm.value, goal: cm.goal, reachedGoal: cm.reachedGoal, glosaPct: cm.glosaPct, numerator: cm.numerator, base: cm.denominator, denominatorKind: cm.denominatorKind } : { value: kpi[0].iqaRate, note: 'mês fora da vigência do contrato configurado' },
    },
    serviceDesk: { createdByKind: kinds, completedInMonth: tasksDone },
    contractHours: contract.hours ?? {},
    contractStartDate: { value: contract.startDate, source: contract.source },
  };
}

/** Linhas planas (seção;item;valor;unidade) para o CSV do relatório mensal. */
export function monthlyRows(d: Awaited<ReturnType<typeof buildMonthly>>): Array<Record<string, unknown>> {
  const r: Array<Record<string, unknown>> = [];
  const add = (section: string, item: string, value: unknown, unit = '') => r.push({ section, item, value, unit });
  add('Período', 'Mês', d.month); add('Período', 'Fuso', d.period.timezone);
  add('Licenças', 'Atendentes em uso', d.licenses.atendentes, 'usuário'); add('Licenças', 'Supervisores em uso', d.licenses.supervisores, 'usuário');
  for (const m of d.messaging) add('Mensageria', `${m.trItem ? `Item ${m.trItem} — ` : ''}${m.label}`, m.quantity);
  add('Armazenamento', 'Máximo no mês', d.storage.maxBytes, 'byte');
  add('Voz', 'Minutos', d.voice.minutes, 'min'); add('Voz', 'Chamadas', d.voice.calls); add('Voz', 'Pico de chamadas simultâneas', d.voice.peakConcurrentCalls);
  add('Atendimentos', 'Iniciados', d.attendances.total); add('Atendimentos', 'Encerrados', d.attendances.closed); add('Atendimentos', 'Abandonados', d.attendances.abandoned);
  for (const c of d.attendances.byChannel) add('Atendimentos por canal', c.channel, c.total);
  add('Indicadores', 'NPS', d.indicators.nps); add('Indicadores', 'TME médio', d.indicators.tmeAvgSec, 's'); add('Indicadores', 'TMA médio', d.indicators.tmaAvgSec, 's');
  add('Indicadores', 'FCR', d.indicators.fcrRate, '%'); add('Indicadores', 'SLA cumprido', d.indicators.slaRate, '%');
  add('Indicadores', 'IQA', (d.indicators.iqa as any).value, '%'); add('Indicadores', 'IQA — meta', (d.indicators.iqa as any).goal ?? '', '%'); add('Indicadores', 'IQA — glosa', (d.indicators.iqa as any).glosaPct ?? '', '%');
  for (const [k, v] of Object.entries(d.serviceDesk.createdByKind)) { add('Service desk', `${k} — total`, v.total); for (const [s, n] of Object.entries(v.byStatus)) add('Service desk', `${k} — ${s}`, n); }
  add('Service desk', 'Concluídas no mês', d.serviceDesk.completedInMonth);
  for (const [k, v] of Object.entries(d.contractHours)) add('Horas contratuais', k, v, 'h');
  return r;
}
export const MONTHLY_COLUMNS = [{ key: 'section', label: 'Seção' }, { key: 'item', label: 'Item' }, { key: 'value', label: 'Valor' }, { key: 'unit', label: 'Unidade' }];

/** Gera o documento, grava JSON e CSV no storage e registra BvExportJob (JSON) com o CSV em params.csv. */
export async function generateMonthly(orgId: string, month: string, userId?: string | null) {
  const doc = await buildMonthly(orgId, month);
  const csv = toCsv(MONTHLY_COLUMNS, monthlyRows(doc));
  const csvStored = await storeReportFile(orgId, csv, 'CSV', { kind: 'MONTHLY_CSV', month }, userId);
  const jsonStored = await storeReportFile(orgId, JSON.stringify(doc, null, 2), 'JSON', { kind: 'MONTHLY', month, csvJobId: csvStored.jobId }, userId);
  return { document: doc, json: jsonStored, csv: csvStored };
}
