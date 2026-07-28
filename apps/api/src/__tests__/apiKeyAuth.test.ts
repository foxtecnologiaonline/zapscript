/**
 * Testes da autenticação por API key (Fase 3 — API pública do tier Empresas).
 * Foco: hashing determinístico, geração de token único, e o preHandler
 * requireApiKey (401 sem chave, 401 revogada/inexistente, 403 sem escopo,
 * sucesso grava req.apiKeyUserId).
 */
jest.mock('../lib/prisma', () => ({
  prisma: {
    apiKey: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
  },
}));

import { prisma } from '../lib/prisma';
import { generateApiKey, hashApiKey, requireApiKey } from '../lib/apiKeyAuth';

function mockReply() {
  const reply: any = {};
  reply.code = jest.fn().mockReturnValue(reply);
  reply.send = jest.fn().mockReturnValue(reply);
  return reply;
}

describe('generateApiKey / hashApiKey', () => {
  it('gera tokens únicos com prefixo zsk_live_', () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.token).toMatch(/^zsk_live_[0-9a-f]{48}$/);
    expect(a.token).not.toBe(b.token);
  });

  it('hashApiKey é determinístico e o hash não contém o token original', () => {
    const { token, keyHash } = generateApiKey();
    expect(hashApiKey(token)).toBe(keyHash);
    expect(keyHash).not.toContain(token);
  });

  it('keyPrefix é um prefixo real do token (exibição segura, sem expor o resto)', () => {
    const { token, keyPrefix } = generateApiKey();
    expect(token.startsWith(keyPrefix)).toBe(true);
    expect(keyPrefix.length).toBeLessThan(token.length);
  });
});

describe('requireApiKey', () => {
  beforeEach(() => jest.clearAllMocks());

  it('401 sem header X-Api-Key', async () => {
    const req: any = { headers: {} };
    const reply = mockReply();
    await requireApiKey([])(req, reply);
    expect(reply.code).toHaveBeenCalledWith(401);
    expect(prisma.apiKey.findUnique).not.toHaveBeenCalled();
  });

  it('401 quando a chave não existe no banco', async () => {
    (prisma.apiKey.findUnique as jest.Mock).mockResolvedValue(null);
    const req: any = { headers: { 'x-api-key': 'zsk_live_bogus' } };
    const reply = mockReply();
    await requireApiKey([])(req, reply);
    expect(reply.code).toHaveBeenCalledWith(401);
  });

  it('401 quando a chave existe mas está revogada', async () => {
    (prisma.apiKey.findUnique as jest.Mock).mockResolvedValue({
      id: 'k1', userId: 'u1', scopes: ['conversations:read'], revokedAt: new Date(),
    });
    const req: any = { headers: { 'x-api-key': 'zsk_live_xxx' } };
    const reply = mockReply();
    await requireApiKey([])(req, reply);
    expect(reply.code).toHaveBeenCalledWith(401);
  });

  it('403 quando falta escopo exigido pela rota', async () => {
    (prisma.apiKey.findUnique as jest.Mock).mockResolvedValue({
      id: 'k1', userId: 'u1', scopes: ['conversations:read'], revokedAt: null,
    });
    const req: any = { headers: { 'x-api-key': 'zsk_live_xxx' } };
    const reply = mockReply();
    await requireApiKey(['contacts:read'])(req, reply);
    expect(reply.code).toHaveBeenCalledWith(403);
    expect(req.apiKeyUserId).toBeUndefined();
  });

  it('sucesso: grava req.apiKeyUserId e não responde erro', async () => {
    (prisma.apiKey.findUnique as jest.Mock).mockResolvedValue({
      id: 'k1', userId: 'owner1', scopes: ['conversations:read', 'contacts:read'], revokedAt: null,
    });
    const req: any = { headers: { 'x-api-key': 'zsk_live_xxx' } };
    const reply = mockReply();
    const result = await requireApiKey(['conversations:read'])(req, reply);

    expect(result).toBeUndefined();
    expect(reply.code).not.toHaveBeenCalled();
    expect(req.apiKeyUserId).toBe('owner1');
    expect(prisma.apiKey.update).toHaveBeenCalledWith({ where: { id: 'k1' }, data: { lastUsedAt: expect.any(Date) } });
  });
});
