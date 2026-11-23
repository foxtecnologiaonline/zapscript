import { getOrgSettings } from '../core/settings';

/**
 * Configurações de segurança do órgão, lidas do JSON bruto `settings.security` (campos extras além do tipo
 * `BvOrgSettings` — o merge profundo do core preserva chaves desconhecidas):
 *   security.requireMfaRoles  perfis que exigem MFA (gerido pela frente iam)
 *   security.legalHold        guarda legal: suspende retenção, anonimização e exclusão
 */
export interface LegalHold { active: boolean; basis?: string; since?: string; until?: string | null }

export interface SecuritySettings { requireMfaRoles: string[]; legalHold: LegalHold | null }

export async function getSecuritySettings(orgId: string): Promise<SecuritySettings> {
  const s = (await getOrgSettings(orgId)) as any;
  const raw = s?.security ?? {};
  const h = raw.legalHold;
  return {
    requireMfaRoles: Array.isArray(raw.requireMfaRoles) ? raw.requireMfaRoles.filter((r: unknown) => typeof r === 'string') : [],
    legalHold: h && typeof h === 'object' ? { active: h.active === true, basis: typeof h.basis === 'string' ? h.basis : undefined, since: h.since, until: h.until ?? null } : null,
  };
}

/** Guarda legal vigente (ativa e dentro do prazo, se houver) ou null. */
export function activeLegalHold(h: LegalHold | null, now = new Date()): LegalHold | null {
  if (!h || !h.active) return null;
  if (h.until) {
    const t = Date.parse(h.until);
    if (Number.isFinite(t) && t < now.getTime()) return null;
  }
  return h;
}

/** Mínimo de retenção da trilha de auditoria, em dias (BV_AUDIT_MIN_DAYS; padrão 365). */
export function minAuditDays(): number {
  const n = Number(process.env.BV_AUDIT_MIN_DAYS);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 365;
}

export const DAY_MS = 86_400_000;
