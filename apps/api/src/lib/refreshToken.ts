import crypto from 'crypto';
import { prisma } from './prisma';
import { logger } from './logger';

/**
 * Refresh token rotativo.
 *
 * O access token JWT caiu de 30 dias para 1 hora. A sessão longa que o
 * usuário espera passa a ser sustentada por este token opaco, que —
 * diferente do JWT — pode ser revogado. Antes, um JWT vazado valia 30 dias
 * e não havia como cortá-lo.
 *
 * Regras:
 *  - o valor em claro só existe na resposta HTTP; no banco fica o SHA-256;
 *  - todo uso ROTACIONA (o token apresentado é revogado e um novo é emitido);
 *  - reapresentar um token já revogado é sinal clássico de roubo, e derruba
 *    a família inteira (todas as sessões daquela cadeia).
 */

export const ACCESS_TOKEN_TTL  = '1h';
const REFRESH_TTL_DAYS = parseInt(process.env.REFRESH_TOKEN_TTL_DAYS || '30', 10);

/** SHA-256 é suficiente e é o certo aqui: o token já é 256 bits de entropia
 *  do CSPRNG, não uma senha de baixa entropia que precise de KDF lento. */
const hash = (raw: string) => crypto.createHash('sha256').update(raw).digest('hex');

export interface IssuedRefresh { token: string; expiresAt: Date; }

/** Emite um refresh token novo. `familyId` ausente inicia uma cadeia nova (login). */
export async function issueRefreshToken(userId: string, familyId?: string): Promise<IssuedRefresh> {
  const raw       = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.refreshToken.create({
    data: { userId, tokenHash: hash(raw), familyId: familyId || crypto.randomUUID(), expiresAt },
  });

  return { token: raw, expiresAt };
}

export type RotateResult =
  | { ok: true;  userId: string; refresh: IssuedRefresh }
  | { ok: false; reason: 'invalid' | 'expired' | 'reused' };

/**
 * Valida e rotaciona. Retorna o userId e o refresh token NOVO.
 *
 * A troca roda dentro de uma transação: sem ela, duas abas renovando ao mesmo
 * tempo poderiam revogar o mesmo token duas vezes e emitir duas cadeias
 * válidas — e uma delas ficaria órfã, derrubando a sessão do usuário do nada.
 */
export async function rotateRefreshToken(rawToken: string): Promise<RotateResult> {
  if (!rawToken || typeof rawToken !== 'string') return { ok: false, reason: 'invalid' };

  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash: hash(rawToken) } });
  if (!existing) return { ok: false, reason: 'invalid' };

  // Token já revogado reaparecendo = alguém está usando uma cópia. Não dá pra
  // saber se é o dono ou o atacante, então derruba a família inteira e obriga
  // login novo — é o comportamento padrão de detecção de reuso.
  if (existing.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { familyId: existing.familyId, revokedAt: null },
      data:  { revokedAt: new Date() },
    });
    logger.warn(
      { userId: existing.userId, familyId: existing.familyId },
      '[Auth] Refresh token reutilizado após revogação — família revogada por suspeita de roubo',
    );
    return { ok: false, reason: 'reused' };
  }

  if (existing.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'expired' };

  const raw       = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);

  try {
    await prisma.$transaction(async (tx) => {
      // updateMany com revokedAt:null no WHERE = trava otimista: se outra
      // requisição rotacionou primeiro, count vem 0 e abortamos.
      const claimed = await tx.refreshToken.updateMany({
        where: { id: existing.id, revokedAt: null },
        data:  { revokedAt: new Date(), lastUsedAt: new Date() },
      });
      if (claimed.count === 0) throw new Error('corrida-de-rotacao');

      const created = await tx.refreshToken.create({
        data: {
          userId:    existing.userId,
          tokenHash: hash(raw),
          familyId:  existing.familyId,   // mantém a cadeia
          expiresAt,
        },
      });
      await tx.refreshToken.update({ where: { id: existing.id }, data: { replacedBy: created.id } });
    });
  } catch {
    // Perdeu a corrida para outra aba: não é roubo nem erro do usuário.
    return { ok: false, reason: 'invalid' };
  }

  return { ok: true, userId: existing.userId, refresh: { token: raw, expiresAt } };
}

/** Logout: revoga o token apresentado (e só ele). */
export async function revokeRefreshToken(rawToken: string): Promise<void> {
  if (!rawToken) return;
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hash(rawToken), revokedAt: null },
    data:  { revokedAt: new Date() },
  });
}

/** Revoga TODAS as sessões do usuário (troca de senha, "sair de todos"). */
export async function revokeAllForUser(userId: string): Promise<number> {
  const r = await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data:  { revokedAt: new Date() },
  });
  return r.count;
}

/** Limpeza de expirados/revogados antigos — a tabela cresce 1 linha por renovação. */
export async function purgeExpiredRefreshTokens(): Promise<number> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const r = await prisma.refreshToken.deleteMany({
    where: { OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: cutoff } }] },
  });
  return r.count;
}
