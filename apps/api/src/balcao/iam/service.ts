import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { passwordPolicyError } from '../core/passwords';
import { ROLES, type Role } from '../core/types';
import { hashPasswordAsync } from './passwordAsync';

/**
 * Regras de IAM compartilhadas entre rotas e CLIs. NÃO importar daqui nada que abra Redis/BullMQ
 * (core/http, core/session…): os CLIs (cli/*.ts) importam este módulo e precisam encerrar sozinhos.
 */

/** Erro de regra de negócio com status HTTP e código no padrão `dominio.codigo`. */
export class IamError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}

export const normalizeEmail = (e: string) => e.trim().toLowerCase();

/** Visão pública de um usuário (nunca expõe hash de senha nem segredo TOTP). */
export interface UserView {
  id: string; orgId: string; email: string; name: string; role: Role; active: boolean;
  sectorId: string | null; skills: string[]; maxConcurrent: number; presence: string; sipExtension: string | null;
  totpEnabled: boolean; mustChangePassword: boolean; lastLoginAt: Date | null; lockedUntil: Date | null; createdAt: Date;
}
export function userView(u: any): UserView {
  return {
    id: u.id, orgId: u.orgId, email: u.email, name: u.name, role: u.role, active: u.active, sectorId: u.sectorId ?? null,
    skills: u.skills ?? [], maxConcurrent: u.maxConcurrent, presence: u.presence, sipExtension: u.sipExtension ?? null,
    totpEnabled: u.totpEnabled, mustChangePassword: u.mustChangePassword, lastLoginAt: u.lastLoginAt ?? null,
    lockedUntil: u.lockedUntil ?? null, createdAt: u.createdAt,
  };
}

const PW_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Senha temporária forte (16 caracteres, letras+números sem ambíguos, começa com letra — segura em CSV/planilha). */
export function generateTempPassword(length = 16): string {
  for (;;) {
    let s = '';
    for (let i = 0; i < length; i++) s += PW_ALPHABET[crypto.randomInt(PW_ALPHABET.length)];
    if (/^[A-Za-z]/.test(s) && /\d/.test(s) && /[a-z]/.test(s) && /[A-Z]/.test(s)) return s;
  }
}

/** Campos do índice único violado (P2002) ou null se o erro for outro. */
export function uniqueTarget(err: any): string[] | null {
  if (err?.code !== 'P2002') return null;
  const t = err.meta?.target;
  return Array.isArray(t) ? t : typeof t === 'string' ? [t] : [];
}

export function conflictFromUnique(err: any): IamError | null {
  const t = uniqueTarget(err);
  if (!t) return null;
  const s = t.join(',');
  if (s.includes('sipExtension')) return new IamError(409, 'user.sip_taken', 'Este ramal SIP já está em uso neste órgão.');
  if (s.includes('email')) return new IamError(409, 'user.email_taken', 'Já existe um usuário com este e-mail neste órgão.');
  return new IamError(409, 'conflict', 'Registro duplicado.');
}

export interface NewUserInput {
  email: string; name: string; role: Role; skills?: string[]; maxConcurrent?: number;
  sectorId?: string | null; sipExtension?: string | null;
}

/** Garante que o setor pertence ao órgão. */
export async function assertSector(orgId: string, sectorId: string | null | undefined): Promise<void> {
  if (!sectorId) return;
  const s = await prisma.bvSector.findFirst({ where: { id: sectorId, orgId }, select: { id: true } });
  if (!s) throw new IamError(400, 'sector.not_found', 'Setor inexistente neste órgão.');
}

/** Cria usuário com senha temporária (devolvida UMA vez) e `mustChangePassword`. */
export async function createUserRecord(orgId: string, input: NewUserInput, opts: { skipSectorCheck?: boolean; password?: string; mustChangePassword?: boolean } = {}) {
  if (!opts.skipSectorCheck) await assertSector(orgId, input.sectorId);
  const temporaryPassword = opts.password ?? generateTempPassword();
  const passwordHash = await hashPasswordAsync(temporaryPassword);
  try {
    const user = await prisma.bvUser.create({
      data: {
        orgId, email: normalizeEmail(input.email), name: input.name.trim(), role: input.role, passwordHash,
        skills: dedupe(input.skills ?? []), maxConcurrent: input.maxConcurrent ?? 3, sectorId: input.sectorId ?? null,
        sipExtension: input.sipExtension ?? null, mustChangePassword: opts.mustChangePassword ?? true,
      },
    });
    return { user, temporaryPassword };
  } catch (err) {
    throw conflictFromUnique(err) ?? err;
  }
}

export const dedupe = (a: string[]) => [...new Set(a.map((s) => s.trim()).filter(Boolean))];

/** Perfis que exigem MFA, lidos do JSON bruto de settings (`security.requireMfaRoles`; padrão []). */
export async function getRequireMfaRoles(orgId: string): Promise<Role[]> {
  const org = await prisma.bvOrg.findUnique({ where: { id: orgId }, select: { settings: true } });
  const raw = (org?.settings as any)?.security?.requireMfaRoles;
  return Array.isArray(raw) ? raw.filter((r: unknown): r is Role => typeof r === 'string' && (ROLES as readonly string[]).includes(r)) : [];
}

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export interface CreateOrgInput { name: string; slug: string; adminEmail: string; adminPassword: string; adminName?: string; resetAdminPassword?: boolean }
export interface CreateOrgResult { orgId: string; orgCreated: boolean; adminId: string; adminCreated: boolean; adminPasswordSet: boolean }

/** Cria o órgão e o primeiro ADMIN. Idempotente: reexecutar reaproveita órgão/usuário (senha só muda com `resetAdminPassword`). */
export async function createOrgWithAdmin(input: CreateOrgInput): Promise<CreateOrgResult> {
  if (!SLUG_RE.test(input.slug)) throw new IamError(400, 'org.invalid_slug', 'Slug inválido: use 3 a 40 caracteres [a-z0-9-], começando e terminando com letra/número.');
  const policy = passwordPolicyError(input.adminPassword);
  if (policy) throw new IamError(400, 'password.weak', policy);
  const email = normalizeEmail(input.adminEmail);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new IamError(400, 'validation.failed', 'E-mail do administrador inválido.');
  if (!input.name.trim()) throw new IamError(400, 'validation.failed', 'Nome do órgão obrigatório.');

  let org = await prisma.bvOrg.findUnique({ where: { slug: input.slug } });
  const orgCreated = !org;
  if (!org) org = await prisma.bvOrg.create({ data: { name: input.name.trim(), slug: input.slug } });

  const existing = await prisma.bvUser.findUnique({ where: { orgId_email: { orgId: org.id, email } } });
  if (existing) {
    if (input.resetAdminPassword) {
      await prisma.bvUser.update({ where: { id: existing.id }, data: { passwordHash: await hashPasswordAsync(input.adminPassword), mustChangePassword: false, failedLogins: 0, lockedUntil: null, active: true, role: 'ADMIN' } });
    }
    return { orgId: org.id, orgCreated, adminId: existing.id, adminCreated: false, adminPasswordSet: !!input.resetAdminPassword };
  }
  const { user } = await createUserRecord(org.id, { email, name: input.adminName?.trim() || 'Administrador', role: 'ADMIN' }, { password: input.adminPassword, mustChangePassword: false });
  return { orgId: org.id, orgCreated, adminId: user.id, adminCreated: true, adminPasswordSet: true };
}
