import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { can } from '../../core/permissions';
import { getOrgSettings, localParts } from '../../core/settings';
import type { Role } from '../../core/types';

/**
 * Política de discagem (click-to-call pelo tronco) por órgão, lida de `org.settings.voice` (JSON bruto — validado AQUI, no ponto de uso;
 * campo ausente/inválido cai no padrão):
 *  - `dialAllowPrefixes`      string[]  prefixos permitidos (só dígitos e "+", ex.: "+5563", "63", "0800"). Vazio/ausente = PADRÃO:
 *                             apenas números nacionais fixos/celulares do Brasil (DDD + número, com ou sem +55).
 *  - `dialMaxPerAgentPerDay`  number    ligações originadas por atendente por dia (fuso do órgão). Padrão 50. 0 = ninguém disca.
 *  - `dialRequirePermission`  boolean   padrão true: exige `conversation:reply` E presença ONLINE/BUSY (em atendimento).
 * Sempre bloqueados, mesmo com prefixos: 0900/0300 (premium/custo compartilhado) e códigos de serviço com `*`/`#`.
 */
export interface DialPolicy { dialAllowPrefixes: string[]; dialMaxPerAgentPerDay: number; dialRequirePermission: boolean }

export const DEFAULT_DIAL_POLICY: DialPolicy = { dialAllowPrefixes: [], dialMaxPerAgentPerDay: 50, dialRequirePermission: true };

const prefixRe = /^\+?[0-9]{1,20}$/;
const stripSeparators = (s: string) => s.replace(/[\s().-]/g, '');

export function resolveDialPolicy(raw: unknown): DialPolicy {
  const v = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const prefixes = z.array(z.unknown()).max(500).safeParse(v.dialAllowPrefixes);
  const max = z.number().int().min(0).max(100_000).safeParse(v.dialMaxPerAgentPerDay);
  const req = z.boolean().safeParse(v.dialRequirePermission);
  return {
    dialAllowPrefixes: prefixes.success
      ? prefixes.data.filter((p): p is string => typeof p === 'string').map(stripSeparators).filter((p) => prefixRe.test(p))
      : [],
    dialMaxPerAgentPerDay: max.success ? max.data : DEFAULT_DIAL_POLICY.dialMaxPerAgentPerDay,
    dialRequirePermission: req.success ? req.data : DEFAULT_DIAL_POLICY.dialRequirePermission,
  };
}

export async function loadDialPolicy(orgId: string): Promise<DialPolicy> {
  return resolveDialPolicy((await getOrgSettings(orgId) as unknown as { voice?: unknown }).voice);
}

// ── Número ───────────────────────────────────────────────────────────────────────────────────────────
export interface DialedNumber {
  /** Sequência normalizada (sem espaços/pontuação). */
  normalized: string;
  /** Nacional fixo/celular do Brasil: `+55DDNNNNNNNNN`. */
  e164: string | null;
  /** DDD+número (10 ou 11 dígitos) quando nacional. */
  national: string | null;
  international: boolean;
  premium: boolean;
  serviceCode: boolean;
}

const NATIONAL = /^[1-9][1-9](?:9[0-9]{8}|[2-5][0-9]{7})$/; // DDD 11–99 + celular (9xxxx-xxxx) ou fixo (2–5xxx-xxxx)

export function parseDialedNumber(raw: string): DialedNumber {
  const normalized = stripSeparators(raw);
  const out: DialedNumber = { normalized, e164: null, national: null, international: false, premium: false, serviceCode: /[*#]/.test(normalized), };
  if (out.serviceCode) return out;
  let digits = normalized;
  if (digits.startsWith('+')) {
    if (!digits.startsWith('+55')) { out.international = true; return out; }
    digits = digits.slice(3);
  } else if (digits.startsWith('00')) { out.international = true; return out; }
  else if (digits.startsWith('0')) {
    out.premium = /^0(?:900|300)/.test(digits);
    return out; // prefixo de tronco (0800, 0xx operadora…): só passa se o órgão listar o prefixo
  } else if (/^55[0-9]{10,11}$/.test(digits) && NATIONAL.test(digits.slice(2))) digits = digits.slice(2);
  if (/^(?:900|300)/.test(digits)) out.premium = true;
  if (NATIONAL.test(digits)) { out.national = digits; out.e164 = `+55${digits}`; }
  return out;
}

export type NumberVerdict = { ok: true; number: DialedNumber } | { ok: false; reason: 'premium' | 'service_code' | 'not_allowed'; number: DialedNumber };

/** Aplica a lista de prefixos (ou o padrão nacional BR) ao número. */
export function evaluateNumber(policy: Pick<DialPolicy, 'dialAllowPrefixes'>, raw: string): NumberVerdict {
  const number = parseDialedNumber(raw);
  if (number.serviceCode) return { ok: false, reason: 'service_code', number };
  if (number.premium) return { ok: false, reason: 'premium', number };
  if (policy.dialAllowPrefixes.length === 0) return number.national ? { ok: true, number } : { ok: false, reason: 'not_allowed', number };
  const candidates = [number.normalized, number.e164, number.national].filter((c): c is string => !!c);
  const hit = policy.dialAllowPrefixes.some((p) => candidates.some((c) => c.startsWith(p)));
  return hit ? { ok: true, number } : { ok: false, reason: 'not_allowed', number };
}

/** Número para auditoria/log: mantém só o início (país+DDD) e os 2 últimos dígitos. */
export function maskNumber(raw: string): string {
  const n = parseDialedNumber(raw);
  const s = n.e164 ?? n.normalized;
  const head = n.e164 ? 5 : 2;
  if (s.length <= head + 2) return '*'.repeat(s.length);
  return `${s.slice(0, head)}${'*'.repeat(s.length - head - 2)}${s.slice(-2)}`;
}

// ── Decisão completa (usada por AriController.dial) ─────────────────────────────────────────────────
export type DialDecision =
  | { ok: true; policy: DialPolicy; number: DialedNumber }
  | { ok: false; code: 'voice.dial_not_allowed' | 'voice.dial_limit'; status: 403 | 429; message: string; reason: string };

const MESSAGES: Record<string, string> = {
  premium: 'Discagem para números premium/custo compartilhado (0900/0300) não é permitida.',
  service_code: 'Códigos de serviço (* e #) não podem ser discados.',
  not_allowed: 'Este número não está autorizado pela política de discagem do órgão.',
  permission: 'Seu perfil não tem permissão para originar chamadas.',
  presence: 'Fique ONLINE (em atendimento) para originar chamadas.',
};

/** Início do dia (00:00) no fuso do órgão, como instante UTC. */
export function startOfLocalDay(timezone: string, at = new Date()): Date {
  const { minutes } = localParts(at, timezone);
  return new Date(at.getTime() - minutes * 60_000 - at.getUTCSeconds() * 1000 - at.getUTCMilliseconds());
}

export async function checkDialPolicy(input: { orgId: string; userId: string; role: Role; presence: string; number: string; now?: Date }): Promise<DialDecision> {
  const { orgId, userId, role, presence, number } = input;
  const policy = await loadDialPolicy(orgId);
  const deny = (reason: string, code: 'voice.dial_not_allowed' | 'voice.dial_limit' = 'voice.dial_not_allowed'): DialDecision =>
    ({ ok: false, code, status: code === 'voice.dial_limit' ? 429 : 403, message: MESSAGES[reason] ?? reason, reason });
  if (policy.dialRequirePermission) {
    if (!can(role, 'conversation:reply')) return deny('permission');
    if (presence !== 'ONLINE' && presence !== 'BUSY') return deny('presence');
  }
  const verdict = evaluateNumber(policy, number);
  if (!verdict.ok) return deny(verdict.reason);
  const settings = await getOrgSettings(orgId);
  const since = startOfLocalDay(settings.timezone, input.now);
  const used = await prisma.bvCall.count({ where: { orgId, agentUserId: userId, direction: 'OUT', startedAt: { gte: since } } });
  if (used >= policy.dialMaxPerAgentPerDay) {
    return { ok: false, code: 'voice.dial_limit', status: 429, reason: 'daily_limit', message: `Limite diário de ${policy.dialMaxPerAgentPerDay} ligações originadas atingido.` };
  }
  return { ok: true, policy, number: verdict.number };
}
