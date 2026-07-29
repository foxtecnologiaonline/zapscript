/**
 * Testes do compartilhamento de dados de time (Fase 3 — RBAC do tier Empresas).
 * Foco: resolveTeamScope() resolve o dono correto dos dados + o papel efetivo,
 * e os preHandlers (requireModuleShared/requireTeamRole) aplicam o gate certo.
 */
jest.mock('../lib/prisma', () => ({
  prisma: {
    teamMember: { findUnique: jest.fn() },
    team:       { findUnique: jest.fn() },
    entitlement: { findMany: jest.fn() },
  },
}));

jest.mock('../services/queue', () => ({
  redis: { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK'), del: jest.fn().mockResolvedValue(1) },
}));

import { prisma } from '../lib/prisma';
import {
  resolveTeamScope,
  roleAtLeast,
  requireModuleShared,
  requireTeamRole,
} from '../lib/teamScope';

function mockReply() {
  const reply: any = {};
  reply.code = jest.fn().mockReturnValue(reply);
  reply.send = jest.fn().mockReturnValue(reply);
  return reply;
}

describe('resolveTeamScope', () => {
  beforeEach(() => jest.clearAllMocks());

  it('usuário sem time é dono dos próprios dados', async () => {
    (prisma.teamMember.findUnique as jest.Mock).mockResolvedValue(null);
    const scope = await resolveTeamScope('u1');
    expect(scope).toEqual({ ownerId: 'u1', role: 'owner' });
  });

  it('convite pendente (status != active) não concede acesso ao time', async () => {
    (prisma.teamMember.findUnique as jest.Mock).mockResolvedValue({ teamId: 't1', role: 'agent', status: 'invited' });
    const scope = await resolveTeamScope('u2');
    expect(scope).toEqual({ ownerId: 'u2', role: 'owner' });
  });

  it('dono do time vê os próprios dados (role owner)', async () => {
    (prisma.teamMember.findUnique as jest.Mock).mockResolvedValue({ teamId: 't1', role: 'owner', status: 'active' });
    const scope = await resolveTeamScope('owner1');
    expect(scope).toEqual({ ownerId: 'owner1', role: 'owner' });
  });

  it('membro ativo resolve para o dono do time, com o papel dele', async () => {
    (prisma.teamMember.findUnique as jest.Mock).mockResolvedValue({ teamId: 't1', role: 'manager', status: 'active' });
    (prisma.team.findUnique as jest.Mock).mockResolvedValue({ ownerId: 'owner1' });
    const scope = await resolveTeamScope('member1');
    expect(scope).toEqual({ ownerId: 'owner1', role: 'manager' });
  });

  it('papel legado desconhecido (ex.: "member") cai para agent, nunca escala privilégio', async () => {
    (prisma.teamMember.findUnique as jest.Mock).mockResolvedValue({ teamId: 't1', role: 'member', status: 'active' });
    (prisma.team.findUnique as jest.Mock).mockResolvedValue({ ownerId: 'owner1' });
    const scope = await resolveTeamScope('member1');
    expect(scope).toEqual({ ownerId: 'owner1', role: 'agent' });
  });
});

describe('roleAtLeast', () => {
  it('respeita a hierarquia agent < manager < admin < owner', () => {
    expect(roleAtLeast('agent', 'agent')).toBe(true);
    expect(roleAtLeast('agent', 'manager')).toBe(false);
    expect(roleAtLeast('manager', 'agent')).toBe(true);
    expect(roleAtLeast('admin', 'manager')).toBe(true);
    expect(roleAtLeast('owner', 'admin')).toBe(true);
    expect(roleAtLeast('manager', 'owner')).toBe(false);
  });
});

describe('requireModuleShared', () => {
  beforeEach(() => jest.clearAllMocks());

  it('401 sem usuário autenticado', async () => {
    const reply = mockReply();
    await requireModuleShared('atende')({ user: null } as any, reply);
    expect(reply.code).toHaveBeenCalledWith(401);
  });

  it('402 quando o DONO dos dados não tem o módulo — mesmo se quem pediu é um agent do time', async () => {
    (prisma.teamMember.findUnique as jest.Mock).mockResolvedValue({ teamId: 't1', role: 'agent', status: 'active' });
    (prisma.team.findUnique as jest.Mock).mockResolvedValue({ ownerId: 'owner1' });
    (prisma.entitlement.findMany as jest.Mock).mockResolvedValue([]); // dono não tem 'atende'

    const req: any = { user: { sub: 'member1' } };
    const reply = mockReply();
    await requireModuleShared('atende')(req, reply);

    expect(reply.code).toHaveBeenCalledWith(402);
    expect(req.teamScope).toEqual({ ownerId: 'owner1', role: 'agent' });
  });

  it('passa e grava req.teamScope quando o dono tem o módulo', async () => {
    (prisma.teamMember.findUnique as jest.Mock).mockResolvedValue({ teamId: 't1', role: 'manager', status: 'active' });
    (prisma.team.findUnique as jest.Mock).mockResolvedValue({ ownerId: 'owner1' });
    (prisma.entitlement.findMany as jest.Mock).mockResolvedValue([{ productKey: 'atende' }]);

    const req: any = { user: { sub: 'member1' } };
    const reply = mockReply();
    const result = await requireModuleShared('atende')(req, reply);

    expect(result).toBeUndefined();
    expect(reply.code).not.toHaveBeenCalled();
    expect(req.teamScope).toEqual({ ownerId: 'owner1', role: 'manager' });
  });
});

describe('requireTeamRole', () => {
  it('403 quando o papel do escopo é insuficiente', async () => {
    const req: any = { teamScope: { ownerId: 'owner1', role: 'agent' } };
    const reply = mockReply();
    await requireTeamRole('manager')(req, reply);
    expect(reply.code).toHaveBeenCalledWith(403);
  });

  it('passa quando o papel do escopo é suficiente', async () => {
    const req: any = { teamScope: { ownerId: 'owner1', role: 'admin' } };
    const reply = mockReply();
    const result = await requireTeamRole('manager')(req, reply);
    expect(result).toBeUndefined();
    expect(reply.code).not.toHaveBeenCalled();
  });

  it('403 quando req.teamScope não foi resolvido (ordem errada de preHandlers)', async () => {
    const req: any = {};
    const reply = mockReply();
    await requireTeamRole('agent')(req, reply);
    expect(reply.code).toHaveBeenCalledWith(403);
  });
});
