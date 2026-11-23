import type { BvTask } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { can, type Permission } from '../core/permissions';
import { addBusinessSeconds, getHolidays, getOrgSettings, type BvOrgSettings } from '../core/settings';
import type { Role } from '../core/types';

/** Constantes, máquina de estados, controle de acesso e cálculo de SLA das tarefas (sem I/O de rede). */

export const KINDS = ['INTERNAL', 'DEMAND', 'SERVICE_REQUEST'] as const;
export const ORIGINS = ['CHATBOT', 'AGENT', 'BACKOFFICE', 'SYSTEM'] as const;
export const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export const STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING', 'DONE', 'CANCELLED'] as const;
export const LEVELS = ['L1', 'L2', 'L3', 'L4'] as const;
export const NOTIFY_CHANNELS = ['EMAIL', 'WHATSAPP'] as const;

export type Kind = (typeof KINDS)[number];
export type Origin = (typeof ORIGINS)[number];
export type Priority = (typeof PRIORITIES)[number];
export type Status = (typeof STATUSES)[number];
export type Level = (typeof LEVELS)[number];

export const OPEN_STATUSES: Status[] = ['OPEN', 'IN_PROGRESS', 'WAITING'];
export const CLOSED_STATUSES: Status[] = ['DONE', 'CANCELLED'];
export const isClosed = (s: string) => s === 'DONE' || s === 'CANCELLED';

/** Transições válidas. Reabrir (DONE/CANCELLED → OPEN) exige `task:manage` (verificado em service.changeStatus). */
export const TRANSITIONS: Record<Status, Status[]> = {
  OPEN: ['IN_PROGRESS', 'WAITING', 'CANCELLED'],
  IN_PROGRESS: ['WAITING', 'DONE', 'CANCELLED'],
  WAITING: ['IN_PROGRESS', 'DONE', 'CANCELLED'],
  DONE: ['OPEN'],
  CANCELLED: ['OPEN'],
};
export const isValidTransition = (from: string, to: string) => (TRANSITIONS[from as Status] ?? []).includes(to as Status);

export class TaskError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

// ── Ator e acesso ────────────────────────────────────────────────────────────
export interface Actor {
  /** null = sistema (bot, job). */
  userId: string | null;
  orgId: string;
  role: Role;
  via: 'jwt' | 'api-token' | 'system';
  scopes?: string[];
  sectorId: string | null;
  name?: string;
}

export const SYSTEM_ACTOR = (orgId: string): Actor => ({ userId: null, orgId, role: 'ADMIN', via: 'system', sectorId: null, name: 'Sistema' });

/** Permissão efetiva do ator: JWT usa o perfil; token de API usa escopos; sistema pode tudo. */
export function actorHas(a: Actor, perm: Permission): boolean {
  if (a.via === 'system') return true;
  if (a.via === 'api-token') return (a.scopes ?? []).includes(perm) || (a.scopes ?? []).includes('*');
  return can(a.role, perm);
}

/**
 * all    — supervisor/admin (task:manage): vê e gerencia tudo do órgão.
 * fiscal — só SERVICE_REQUEST + as que criou.
 * agent  — as suas, as que criou, as do seu setor e a caixa geral (sem responsável e sem setor).
 */
export type Scope = 'all' | 'fiscal' | 'agent';
export function scopeOf(a: Actor): Scope {
  if (actorHas(a, 'task:manage')) return 'all';
  if (a.role === 'FISCAL' || a.via === 'api-token') return 'fiscal';
  return 'agent';
}

type TaskAccessFields = Pick<BvTask, 'kind' | 'assigneeId' | 'creatorId' | 'sectorId'>;

export function canViewTask(a: Actor, t: TaskAccessFields): boolean {
  if (!actorHas(a, 'task:read')) return false;
  switch (scopeOf(a)) {
    case 'all': return true;
    case 'fiscal': return t.kind === 'SERVICE_REQUEST' || (!!a.userId && t.creatorId === a.userId);
    case 'agent':
      return (!!a.userId && (t.assigneeId === a.userId || t.creatorId === a.userId))
        || (!!a.sectorId && t.sectorId === a.sectorId)
        || (t.assigneeId === null && t.sectorId === null);
  }
}

export function canEditTask(a: Actor, t: TaskAccessFields): boolean {
  if (!actorHas(a, 'task:write')) return false;
  switch (scopeOf(a)) {
    case 'all': return true;
    case 'fiscal': return t.kind === 'SERVICE_REQUEST' && !!a.userId && t.creatorId === a.userId;
    case 'agent':
      return (!!a.userId && (t.assigneeId === a.userId || t.creatorId === a.userId)) || (!!a.sectorId && t.sectorId === a.sectorId);
  }
}

/** Filtro Prisma equivalente a `canViewTask` (usado nas listagens). */
export function visibilityWhere(a: Actor): Record<string, unknown> {
  switch (scopeOf(a)) {
    case 'all': return { orgId: a.orgId };
    case 'fiscal': return { orgId: a.orgId, OR: [{ kind: 'SERVICE_REQUEST' }, ...(a.userId ? [{ creatorId: a.userId }] : [])] };
    case 'agent': {
      const or: any[] = [{ assigneeId: null, sectorId: null }];
      if (a.userId) or.push({ assigneeId: a.userId }, { creatorId: a.userId });
      if (a.sectorId) or.push({ sectorId: a.sectorId });
      return { orgId: a.orgId, OR: or };
    }
  }
}

export async function loadActor(ctx: { userId: string; orgId: string; role: Role; via: 'jwt' | 'api-token'; scopes?: string[]; name?: string }): Promise<Actor> {
  let sectorId: string | null = null;
  if (ctx.via === 'jwt') {
    const u = await prisma.bvUser.findFirst({ where: { id: ctx.userId, orgId: ctx.orgId }, select: { sectorId: true } });
    sectorId = u?.sectorId ?? null;
  }
  return { userId: ctx.userId, orgId: ctx.orgId, role: ctx.role, via: ctx.via, scopes: ctx.scopes, sectorId, name: ctx.name };
}

// ── SLA ──────────────────────────────────────────────────────────────────────
/**
 * ANS do TR 8.2.8 (solicitações de serviço à contratada).
 *   ISA1 L1: 100% em 1 hora · ISA2 L2: 95% em 2 horas · ISA3 L3: 80% em 1 dia útil · ISA4 L4: 60% em 2 dias úteis.
 * Todos os prazos correm em TEMPO ÚTIL do órgão (horário comercial + feriados) — decisão a confirmar com o fiscal;
 * sobrescrevível em `BvOrg.settings.tasks.ans.<L>.{seconds,days,business,target}`.
 */
export interface AnsRule { seconds?: number; days?: number; business: boolean; target: number }
export const DEFAULT_ANS: Record<Level, AnsRule> = {
  L1: { seconds: 3600, business: true, target: 100 },
  L2: { seconds: 7200, business: true, target: 95 },
  L3: { days: 1, business: true, target: 80 },
  L4: { days: 2, business: true, target: 60 },
};
/** Metas de resposta (1ª resposta/início) por prioridade, em segundos úteis — não fixadas pelo edital. */
export const DEFAULT_RESPONSE_SEC: Record<Priority, number> = { URGENT: 900, HIGH: 3600, NORMAL: 14400, LOW: 28800 };
/** Faixas de glosa INDICATIVAS (não contratuais): até X pontos percentuais abaixo da meta → Y% de glosa. */
export const DEFAULT_GLOSA_BANDS: Array<{ upToPoints: number; percent: number }> = [
  { upToPoints: 0, percent: 0 }, { upToPoints: 5, percent: 1 }, { upToPoints: 10, percent: 2 }, { upToPoints: 20, percent: 5 }, { upToPoints: 100, percent: 10 },
];

export interface TasksOrgConfig {
  ans: Record<Level, AnsRule>;
  responseSec: Record<Priority, number>;
  glosaBands: Array<{ upToPoints: number; percent: number }>;
  /** Nota mínima (0–10) para a avaliação contar como "satisfatória" no IR. */
  ratingPassScore: number;
}

export async function getTasksConfig(orgId: string): Promise<{ cfg: TasksOrgConfig; settings: BvOrgSettings }> {
  const settings = await getOrgSettings(orgId);
  const raw = ((settings as any).tasks ?? {}) as Partial<{ ans: Record<string, Partial<AnsRule>>; responseSec: Record<string, number>; glosaBands: TasksOrgConfig['glosaBands']; ratingPassScore: number }>;
  const ans = { ...DEFAULT_ANS };
  for (const l of LEVELS) ans[l] = { ...DEFAULT_ANS[l], ...(raw.ans?.[l] ?? {}) };
  return {
    settings,
    cfg: {
      ans, responseSec: { ...DEFAULT_RESPONSE_SEC, ...(raw.responseSec ?? {}) },
      glosaBands: raw.glosaBands?.length ? raw.glosaBands : DEFAULT_GLOSA_BANDS, ratingPassScore: raw.ratingPassScore ?? 7,
    },
  };
}

/** Segundos úteis de um "dia útil" do órgão = maior soma de janelas entre os dias da semana (padrão 8 h). */
export function businessDaySeconds(settings: Pick<BvOrgSettings, 'businessHours'>): number {
  const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  let best = 0;
  for (const windows of Object.values(settings.businessHours)) {
    const sum = (windows ?? []).reduce((acc, [a, b]) => acc + Math.max(0, toMin(b) - toMin(a)), 0);
    best = Math.max(best, sum);
  }
  return (best || 480) * 60;
}

export const levelFromPriority = (p: string): Level => (p === 'URGENT' ? 'L1' : p === 'HIGH' ? 'L2' : p === 'LOW' ? 'L4' : 'L3');

export function ansSeconds(rule: AnsRule, settings: Pick<BvOrgSettings, 'businessHours'>): number {
  return rule.seconds ?? (rule.days ?? 1) * businessDaySeconds(settings);
}

export interface SlaDates { slaResponseDueAt: Date | null; slaResolutionDueAt: Date | null }

/**
 * Calcula os prazos de SLA a partir de `createdAt`.
 *  - SERVICE_REQUEST: resolução pelo nível (L1..L4); resposta = min(meta por prioridade, resolução).
 *  - DEMAND: resposta por prioridade; resolução = `dueAt` (se houver).
 *  - INTERNAL: só resolução = `dueAt` (sem SLA de resposta).
 */
export async function computeSla(orgId: string, t: Pick<BvTask, 'kind' | 'priority' | 'supportLevel' | 'dueAt' | 'createdAt'>): Promise<SlaDates> {
  const { cfg, settings } = await getTasksConfig(orgId);
  const holidays = await getHolidays(orgId);
  const add = (sec: number, business = true) => (business ? addBusinessSeconds(settings, t.createdAt, sec, holidays) : new Date(t.createdAt.getTime() + sec * 1000));
  if (t.kind === 'SERVICE_REQUEST') {
    const level = (t.supportLevel as Level) || levelFromPriority(t.priority);
    const rule = cfg.ans[level] ?? DEFAULT_ANS.L3;
    const resSec = ansSeconds(rule, settings);
    const respSec = Math.min(cfg.responseSec[t.priority as Priority] ?? DEFAULT_RESPONSE_SEC.NORMAL, resSec);
    return { slaResponseDueAt: add(respSec, rule.business), slaResolutionDueAt: add(resSec, rule.business) };
  }
  if (t.kind === 'DEMAND') return { slaResponseDueAt: add(cfg.responseSec[t.priority as Priority] ?? DEFAULT_RESPONSE_SEC.NORMAL), slaResolutionDueAt: t.dueAt ?? null };
  return { slaResponseDueAt: null, slaResolutionDueAt: t.dueAt ?? null };
}

/** Texto curto de histórico para valores (datas em ISO, listas por vírgula, textos truncados). */
export function histValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.join(',');
  return String(v).slice(0, 500);
}
