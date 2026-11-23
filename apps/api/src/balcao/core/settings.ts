import { prisma } from '../../lib/prisma';

export type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';
/** Janelas "HH:mm" por dia da semana. Dia ausente/vazio = fechado. */
export type BusinessHours = Partial<Record<DayKey, Array<[string, string]>>>;

export interface BvOrgSettings {
  timezone: string;
  businessHours: BusinessHours;
  protocolPrefix: string;
  language: string;
  contactCategories: string[];
  recordingNotice: string;
  outsideHoursMessage: string;
  retention: { messagesDays: number; recordingsDays: number; auditDays: number; logsDays: number };
  sla: { firstResponseSec: number; resolutionSec: number };
  ai: {
    enabled: boolean;
    /** ASSISTED: IA sugere ao atendente. PROGRESSIVE: IA responde sozinha quando confiante (TR 8.8.2). */
    mode: 'ASSISTED' | 'PROGRESSIVE';
    confidenceThreshold: number;
    welcomeMessage: string;
    escalationKeywords: string[];
    maxBotTurns: number;
  };
  csat: { enabled: boolean; prompt: string };
  webchat: { allowedOrigins: string[]; title: string; primaryColor: string; offlineMessage: string };
  whatsapp: { windowHours: number };
  reopenWindowSec: number;
}

export const DEFAULT_SETTINGS: BvOrgSettings = {
  timezone: 'America/Araguaina', // Tocantins (UTC-3, sem horário de verão)
  businessHours: {
    mon: [['08:00', '18:00']], tue: [['08:00', '18:00']], wed: [['08:00', '18:00']],
    thu: [['08:00', '18:00']], fri: [['08:00', '18:00']],
  },
  protocolPrefix: 'BV',
  language: 'pt-BR',
  contactCategories: ['CIDADAO', 'ADVOGADO', 'SERVIDOR', 'MP', 'DEFENSORIA', 'OUTRO'],
  recordingNotice: 'Esta chamada poderá ser gravada para fins de qualidade e registro.',
  outsideHoursMessage: 'Nosso atendimento humano funciona em dias úteis. Deixe sua mensagem que responderemos assim que possível.',
  // Retenção: prazo legal do órgão a confirmar; default conservador de 5 anos para conteúdo/gravações.
  retention: { messagesDays: 1825, recordingsDays: 1825, auditDays: 1825, logsDays: 90 },
  sla: { firstResponseSec: 300, resolutionSec: 86400 },
  ai: {
    enabled: true, mode: 'ASSISTED', confidenceThreshold: 0.75,
    welcomeMessage: 'Olá! Sou o assistente virtual do Balcão Virtual. Como posso ajudar?',
    escalationKeywords: ['atendente', 'humano', 'falar com alguém', 'reclamação'],
    maxBotTurns: 6,
  },
  csat: { enabled: true, prompt: 'De 0 a 10, qual a chance de você recomendar nosso atendimento?' },
  webchat: { allowedOrigins: [], title: 'Balcão Virtual', primaryColor: '#1f4e9c', offlineMessage: 'Estamos fora do horário de atendimento.' },
  whatsapp: { windowHours: 24 },
  reopenWindowSec: 24 * 3600,
};

function deepMerge<T>(base: T, over: any): T {
  if (over === null || typeof over !== 'object' || Array.isArray(over)) return (over === undefined ? base : over) as T;
  const out: any = { ...(base as any) };
  for (const k of Object.keys(over)) {
    out[k] = k in (base as any) && typeof (base as any)[k] === 'object' && !Array.isArray((base as any)[k])
      ? deepMerge((base as any)[k], over[k]) : over[k];
  }
  return out;
}

const cache = new Map<string, { at: number; v: BvOrgSettings }>();
const TTL_MS = 30_000;

export async function getOrgSettings(orgId: string): Promise<BvOrgSettings> {
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.v;
  const org = await prisma.bvOrg.findUnique({ where: { id: orgId }, select: { settings: true } });
  const v = deepMerge(DEFAULT_SETTINGS, org?.settings ?? {});
  cache.set(orgId, { at: Date.now(), v });
  return v;
}

export function invalidateOrgSettings(orgId?: string) {
  if (orgId) cache.delete(orgId); else cache.clear();
}

/** Aplica um patch parcial em `settings` (merge profundo) e invalida o cache. Auditoria/versionamento: responsabilidade do chamador. */
export async function updateOrgSettings(orgId: string, patch: Partial<BvOrgSettings>): Promise<BvOrgSettings> {
  const org = await prisma.bvOrg.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  const merged = deepMerge((org.settings ?? {}) as any, patch);
  await prisma.bvOrg.update({ where: { id: orgId }, data: { settings: merged as any } });
  invalidateOrgSettings(orgId);
  return getOrgSettings(orgId);
}

// ── Horário comercial ────────────────────────────────────────────────────────
interface LocalParts { day: DayKey; minutes: number; ymd: string }

export function localParts(at: Date, timezone: string): LocalParts {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour12: false, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  const day = ({ Sun: 'sun', Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat' } as Record<string, DayKey>)[p.weekday];
  return { day, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute), ymd: `${p.year}-${p.month}-${p.day}` };
}

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

const holidayCache = new Map<string, { at: number; days: Set<string> }>();
export async function getHolidays(orgId: string): Promise<Set<string>> {
  const hit = holidayCache.get(orgId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.days;
  const rows = await prisma.bvHoliday.findMany({ where: { orgId }, select: { day: true }, take: 2000 });
  const days = new Set(rows.map((r) => r.day.toISOString().slice(0, 10)));
  holidayCache.set(orgId, { at: Date.now(), days });
  return days;
}
export function invalidateHolidays(orgId: string) { holidayCache.delete(orgId); }

/** O instante `at` cai dentro do horário comercial (considerando fuso e feriados)? `hoursOverride` vem de BvQueue.businessHours. */
export function isWithinBusinessHours(
  settings: Pick<BvOrgSettings, 'timezone' | 'businessHours'>, at: Date = new Date(),
  holidays: Set<string> = new Set(), hoursOverride?: BusinessHours | null,
): boolean {
  const { day, minutes, ymd } = localParts(at, settings.timezone);
  if (holidays.has(ymd)) return false;
  const windows = (hoursOverride ?? settings.businessHours)[day] ?? [];
  return windows.some(([a, b]) => minutes >= toMin(a) && minutes < toMin(b));
}

/**
 * Soma `seconds` de tempo ÚTIL a partir de `from` (usado nos prazos de SLA). Varre minuto a minuto por
 * janelas, no máximo 60 dias à frente; se estourar, devolve from + seconds corridos.
 */
export function addBusinessSeconds(
  settings: Pick<BvOrgSettings, 'timezone' | 'businessHours'>, from: Date, seconds: number,
  holidays: Set<string> = new Set(), hoursOverride?: BusinessHours | null,
): Date {
  let remaining = seconds;
  let cursor = from.getTime();
  const limit = from.getTime() + 60 * 86400_000;
  while (remaining > 0 && cursor < limit) {
    if (isWithinBusinessHours(settings, new Date(cursor), holidays, hoursOverride)) {
      const step = Math.min(remaining, 60 - Math.floor((cursor / 1000) % 60));
      cursor += step * 1000; remaining -= step;
    } else {
      cursor += 60_000 - (cursor % 60_000); // pula para o próximo minuto cheio
    }
  }
  return remaining > 0 ? new Date(from.getTime() + seconds * 1000) : new Date(cursor);
}
