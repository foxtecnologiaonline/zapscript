import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { hashToken } from '../core/crypto';

/**
 * Códigos de recuperação do MFA (uso único). Formato `XXXX-XXXX`, alfabeto de 32 símbolos sem ambiguidade
 * (sem I, O, 0, 1) → 40 bits por código. No banco só vai o hash (`hashToken` do core); o código em claro
 * é mostrado UMA vez (enable/regenerate). Nunca logar nem auditar o código.
 */
export const RECOVERY_CODE_COUNT = 10;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Aceita com/sem hífen, minúsculas e espaços; devolve a forma canônica `XXXX-XXXX` ou null se o formato for inválido. */
export function normalizeRecoveryCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, '');
  if (!/^[A-Z0-9]{8}$/.test(s)) return null;
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export const hashRecoveryCode = (canonical: string): string => hashToken(`mfa-recovery:${canonical}`);

function randomCode(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Gera `n` códigos únicos entre si: `codes` (em claro, para mostrar uma vez) e `hashes` (para guardar). */
export function generateRecoveryCodes(n = RECOVERY_CODE_COUNT): { codes: string[]; hashes: string[] } {
  const set = new Set<string>();
  while (set.size < n) set.add(randomCode());
  const codes = [...set];
  return { codes, hashes: codes.map(hashRecoveryCode) };
}

/** Comparação em tempo constante com TODOS os hashes (sem sair no primeiro acerto). */
export function recoveryHashMatches(stored: string[], candidateHash: string): boolean {
  const cand = Buffer.from(candidateHash, 'hex');
  let hit = false;
  for (const h of stored) {
    const b = Buffer.from(h, 'hex');
    if (b.length === cand.length && crypto.timingSafeEqual(b, cand)) hit = true;
  }
  return hit;
}

/**
 * Consome o código de forma atômica (uso único, seguro contra corrida): remove o hash do array só se ainda estiver lá.
 * Retorna `{ ok, remaining }`; `ok=false` se o código não existe/já foi usado.
 */
export async function consumeRecoveryCode(userId: string, stored: string[], canonical: string): Promise<{ ok: boolean; remaining: number }> {
  const h = hashRecoveryCode(canonical);
  if (!recoveryHashMatches(stored, h)) return { ok: false, remaining: stored.length };
  const rows = await prisma.$queryRaw<Array<{ remaining: number }>>`UPDATE "BvUser" SET "mfaRecoveryHashes" = array_remove("mfaRecoveryHashes", ${h}) WHERE id = ${userId} AND ${h} = ANY("mfaRecoveryHashes") RETURNING cardinality("mfaRecoveryHashes")::int AS remaining`;
  if (rows.length !== 1) return { ok: false, remaining: stored.length };
  return { ok: true, remaining: Number(rows[0].remaining) };
}
