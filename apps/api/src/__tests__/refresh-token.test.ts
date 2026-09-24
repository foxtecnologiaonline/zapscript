process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0'.repeat(64);

import {
  issueRefreshToken, rotateRefreshToken, revokeRefreshToken,
  revokeAllForUser, purgeExpiredRefreshTokens,
} from '../lib/refreshToken';
import { prisma } from '../lib/prisma';

jest.mock('../lib/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));

let userId: string;

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: `refresh-${Date.now()}@test.com`, emailVerified: true },
  });
  userId = u.id;
});
afterAll(async () => {
  await prisma.refreshToken.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } }).catch(() => null);
});
beforeEach(async () => { await prisma.refreshToken.deleteMany({ where: { userId } }); });

test('token cru NUNCA é persistido — só o hash', async () => {
  const { token } = await issueRefreshToken(userId);
  const rows = await prisma.refreshToken.findMany({ where: { userId } });
  expect(rows).toHaveLength(1);
  expect(rows[0].tokenHash).not.toBe(token);
  expect(rows[0].tokenHash).toHaveLength(64);           // sha256 hex
});

test('rotação devolve token novo e revoga o antigo, mantendo a família', async () => {
  const first = await issueRefreshToken(userId);
  const r = await rotateRefreshToken(first.token);
  expect(r.ok).toBe(true);
  if (!r.ok) return;

  expect(r.userId).toBe(userId);
  expect(r.refresh.token).not.toBe(first.token);

  const rows = await prisma.refreshToken.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
  expect(rows).toHaveLength(2);
  expect(rows[0].revokedAt).not.toBeNull();             // antigo revogado
  expect(rows[1].revokedAt).toBeNull();                 // novo ativo
  expect(rows[1].familyId).toBe(rows[0].familyId);      // mesma cadeia
  expect(rows[0].replacedBy).toBe(rows[1].id);          // cadeia auditável
});

test('reusar token já rotacionado derruba a família inteira (detecção de roubo)', async () => {
  const first  = await issueRefreshToken(userId);
  const second = await rotateRefreshToken(first.token);
  expect(second.ok).toBe(true);

  // atacante apresenta o token antigo
  const reuse = await rotateRefreshToken(first.token);
  expect(reuse).toEqual({ ok: false, reason: 'reused' });

  // e o token legítimo que estava ativo também morre
  const ativos = await prisma.refreshToken.findMany({ where: { userId, revokedAt: null } });
  expect(ativos).toHaveLength(0);
  if (second.ok) {
    expect((await rotateRefreshToken(second.refresh.token)).ok).toBe(false);
  }
});

test('token expirado é recusado sem derrubar a família', async () => {
  const { token } = await issueRefreshToken(userId);
  await prisma.refreshToken.updateMany({
    where: { userId }, data: { expiresAt: new Date(Date.now() - 1000) },
  });
  expect(await rotateRefreshToken(token)).toEqual({ ok: false, reason: 'expired' });
});

test('token desconhecido é invalid', async () => {
  expect(await rotateRefreshToken('nao-existe')).toEqual({ ok: false, reason: 'invalid' });
  expect(await rotateRefreshToken('')).toEqual({ ok: false, reason: 'invalid' });
});

test('duas abas rotacionando junto: uma ganha, a outra falha sem derrubar a sessão', async () => {
  const { token } = await issueRefreshToken(userId);
  const [a, b] = await Promise.all([rotateRefreshToken(token), rotateRefreshToken(token)]);

  const ok = [a, b].filter(r => r.ok);
  expect(ok).toHaveLength(1);                            // exatamente uma vence

  // A perdedora não pode ter sido tratada como roubo — a sessão segue viva.
  const perdedora = [a, b].find(r => !r.ok) as any;
  expect(perdedora.reason).toBe('invalid');
  const ativos = await prisma.refreshToken.findMany({ where: { userId, revokedAt: null } });
  expect(ativos).toHaveLength(1);
});

test('revokeRefreshToken (logout) invalida só aquele token', async () => {
  const a = await issueRefreshToken(userId);
  const b = await issueRefreshToken(userId);            // outro dispositivo
  await revokeRefreshToken(a.token);
  expect((await rotateRefreshToken(a.token)).ok).toBe(false);
  expect((await rotateRefreshToken(b.token)).ok).toBe(true);
});

test('revokeAllForUser encerra todas as sessões', async () => {
  await issueRefreshToken(userId);
  await issueRefreshToken(userId);
  expect(await revokeAllForUser(userId)).toBe(2);
  expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);
});

test('purge remove expirados e mantém os válidos', async () => {
  const vivo = await issueRefreshToken(userId);
  const { token: morto } = await issueRefreshToken(userId);
  await prisma.refreshToken.updateMany({
    where: { userId, tokenHash: { not: undefined } , expiresAt: { gt: new Date() }, createdAt: { gte: new Date(Date.now() - 60000) } },
    data: {},
  });
  // expira só o segundo
  const rows = await prisma.refreshToken.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
  await prisma.refreshToken.update({ where: { id: rows[1].id }, data: { expiresAt: new Date(Date.now() - 1000) } });

  await purgeExpiredRefreshTokens();
  expect((await rotateRefreshToken(vivo.token)).ok).toBe(true);
  expect(await prisma.refreshToken.findFirst({ where: { id: rows[1].id } })).toBeNull();
  expect(morto).toBeTruthy();
});
