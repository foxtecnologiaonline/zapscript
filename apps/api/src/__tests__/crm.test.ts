/**
 * Testes das rotas do módulo CRM — funil de vendas dentro do WhatsApp.
 * Cobre o gate de entitlement e as regras de negócio de cada handler
 * (limite de estágios, dedupe de telefone, semântica de mover contato
 * entre estágios, lembretes e importação do histórico de transcrições).
 */
import Fastify from 'fastify';
import jwt from '@fastify/jwt';

// ── Mocks ──────────────────────────────────────────────────────────
jest.mock('../lib/prisma', () => ({
  prisma: {
    crmStage:       { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), createMany: jest.fn(), update: jest.fn(), delete: jest.fn(), count: jest.fn() },
    crmContact:     { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn(), count: jest.fn() },
    crmActivity:    { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), groupBy: jest.fn() },
    atendeConversation: { count: jest.fn() },
    transcription:  { findMany: jest.fn() },
    entitlement:    { findMany: jest.fn() },
    product:        { findMany: jest.fn() },
    teamMember:     { findUnique: jest.fn() },
    team:           { findUnique: jest.fn() },
    $transaction:   jest.fn(async (ops: any[]) => Promise.all(ops)),
    $queryRaw:      jest.fn(),
  },
}));

// Redis mockado — evita conexão real (lazyConnect + retry infinito travaria o teste)
jest.mock('../services/queue', () => ({
  redis: { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK'), del: jest.fn().mockResolvedValue(1) },
}));

import { prisma } from '../lib/prisma';

async function buildApp() {
  const app = Fastify({ logger: false });
  app.register(jwt, { secret: 'test-secret' });
  app.decorate('authenticate', async (req: any, reply: any) => {
    try { await req.jwtVerify(); } catch { reply.code(401).send({ error: 'Unauthorized' }); }
  });
  await app.register(import('../routes/modules/crm'), { prefix: '/crm' });
  await app.ready();
  return app;
}

function makeToken(app: any, userId = 'u1') {
  return app.jwt.sign({ sub: userId, email: 'x@x.com' });
}

/** Faz o preHandler requireModuleShared('crm') passar — sem time (ownerId = próprio usuário) e com o módulo. */
function mockModuleOwned() {
  (prisma.teamMember.findUnique as jest.Mock).mockResolvedValueOnce(null);
  (prisma.entitlement.findMany as jest.Mock).mockResolvedValueOnce([{ productKey: 'crm' }]);
}

const userId = 'u1';

function makeStage(overrides: Record<string, any> = {}) {
  return {
    id: 'cstage0001', userId, name: 'Novo lead', order: 0, color: '#3b82f6',
    isWon: false, isLost: false, createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
}

const seededStages = [
  makeStage({ id: 'cstage0001', name: 'Novo lead',     order: 0, color: '#3b82f6' }),
  makeStage({ id: 'cstage0002', name: 'Contato feito', order: 1, color: '#eab308' }),
  makeStage({ id: 'cstage0003', name: 'Negociando',    order: 2, color: '#f97316' }),
  makeStage({ id: 'cstage0004', name: 'Fechado',       order: 3, color: '#22c55e', isWon: true }),
  makeStage({ id: 'cstage0005', name: 'Perdido',       order: 4, color: '#ef4444', isLost: true }),
];

function makeContact(overrides: Record<string, any> = {}) {
  return {
    id: 'ccontact001', userId, stageId: 'cstage0001', name: 'João Silva', phone: '11999990000',
    email: null, company: null, value: null, tags: [], numberId: null, source: 'manual',
    lostReason: null, lastActivityAt: new Date(), closedAt: null,
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
}

function p2002() {
  return Object.assign(new Error('Unique constraint failed on the fields: (`userId`,`phone`)'), { code: 'P2002' });
}

let app: Awaited<ReturnType<typeof buildApp>>;
let authHeader: { authorization: string };

beforeAll(async () => {
  app = await buildApp();
  authHeader = { authorization: `Bearer ${makeToken(app, userId)}` };
});
afterAll(async () => { await app.close(); });
beforeEach(() => jest.clearAllMocks());

// ── Gate de entitlement ───────────────────────────────────────────
describe('gate do módulo crm', () => {
  it('retorna 401 sem token', async () => {
    const res = await app.inject({ method: 'GET', url: '/crm/stages' });
    expect(res.statusCode).toBe(401);
  });

  it('retorna 402 quando o módulo crm não está contratado', async () => {
    (prisma.entitlement.findMany as jest.Mock).mockResolvedValueOnce([]);
    const res = await app.inject({ method: 'GET', url: '/crm/stages', headers: authHeader });
    expect(res.statusCode).toBe(402);
    expect(res.json().moduleRequired).toBe('crm');
  });
});

// ── Board ──────────────────────────────────────────────────────────
describe('GET /crm/board', () => {
  it('agrupa contatos por estágio', async () => {
    mockModuleOwned();
    (prisma.crmStage.findMany as jest.Mock).mockResolvedValueOnce(seededStages);
    (prisma.crmContact.findMany as jest.Mock).mockResolvedValueOnce([
      makeContact({ id: 'ccontact001', stageId: 'cstage0002' }),
    ]);

    const res = await app.inject({ method: 'GET', url: '/crm/board', headers: authHeader });
    expect(res.statusCode).toBe(200);
    const board = res.json();
    expect(board.stages).toHaveLength(5);
    const contatoFeito = board.stages.find((s: any) => s.id === 'cstage0002');
    expect(contatoFeito.contacts).toHaveLength(1);
    expect(board.stages.find((s: any) => s.id === 'cstage0001').contacts).toHaveLength(0);
  });
});

// ── Estágios ───────────────────────────────────────────────────────
describe('GET /crm/stages', () => {
  it('semeia os 5 estágios padrão no primeiro acesso', async () => {
    mockModuleOwned();
    (prisma.crmStage.findMany as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(seededStages);
    (prisma.crmStage.createMany as jest.Mock).mockResolvedValueOnce({ count: 5 });

    const res = await app.inject({ method: 'GET', url: '/crm/stages', headers: authHeader });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(5);
    expect(prisma.crmStage.createMany).toHaveBeenCalledTimes(1);
    expect((prisma.crmStage.createMany as jest.Mock).mock.calls[0][0].data).toHaveLength(5);
  });

  it('não re-semeia quando o usuário já tem estágios', async () => {
    mockModuleOwned();
    (prisma.crmStage.findMany as jest.Mock).mockResolvedValueOnce(seededStages);

    const res = await app.inject({ method: 'GET', url: '/crm/stages', headers: authHeader });
    expect(res.statusCode).toBe(200);
    expect(prisma.crmStage.createMany).not.toHaveBeenCalled();
  });
});

describe('POST /crm/stages', () => {
  it('retorna 400 com nome vazio', async () => {
    mockModuleOwned();
    const res = await app.inject({
      method: 'POST', url: '/crm/stages', headers: authHeader, payload: { name: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('retorna 400 ao atingir o limite de 20 estágios', async () => {
    mockModuleOwned();
    (prisma.crmStage.count as jest.Mock).mockResolvedValueOnce(20);

    const res = await app.inject({
      method: 'POST', url: '/crm/stages', headers: authHeader, payload: { name: 'Novo estágio' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/limite/i);
  });

  it('cria um estágio novo', async () => {
    mockModuleOwned();
    (prisma.crmStage.count as jest.Mock).mockResolvedValueOnce(5);
    (prisma.crmStage.create as jest.Mock).mockResolvedValueOnce(makeStage({ id: 'cstage0006', name: 'Proposta enviada', order: 5 }));

    const res = await app.inject({
      method: 'POST', url: '/crm/stages', headers: authHeader, payload: { name: 'Proposta enviada' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().name).toBe('Proposta enviada');
  });
});

describe('PATCH /crm/stages/:id', () => {
  it('retorna 404 quando o estágio não é do usuário', async () => {
    mockModuleOwned();
    (prisma.crmStage.findFirst as jest.Mock).mockResolvedValueOnce(null);
    const res = await app.inject({
      method: 'PATCH', url: '/crm/stages/cstage0001', headers: authHeader, payload: { name: 'Renomeado' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('atualiza o nome do estágio', async () => {
    mockModuleOwned();
    (prisma.crmStage.findFirst as jest.Mock).mockResolvedValueOnce(seededStages[0]);
    (prisma.crmStage.update as jest.Mock).mockResolvedValueOnce(makeStage({ name: 'Renomeado' }));

    const res = await app.inject({
      method: 'PATCH', url: '/crm/stages/cstage0001', headers: authHeader, payload: { name: 'Renomeado' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Renomeado');
  });
});

describe('DELETE /crm/stages/:id', () => {
  it('retorna 404 quando o estágio não existe', async () => {
    mockModuleOwned();
    (prisma.crmStage.findFirst as jest.Mock).mockResolvedValueOnce(null);
    const res = await app.inject({ method: 'DELETE', url: '/crm/stages/cstage0001', headers: authHeader });
    expect(res.statusCode).toBe(404);
  });

  it('retorna 400 quando é o único estágio do funil', async () => {
    mockModuleOwned();
    (prisma.crmStage.findFirst as jest.Mock).mockResolvedValueOnce(seededStages[0]);
    (prisma.crmStage.count as jest.Mock).mockResolvedValueOnce(1);
    const res = await app.inject({ method: 'DELETE', url: '/crm/stages/cstage0001', headers: authHeader });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/ao menos 1 estágio/i);
  });

  it('retorna 400 quando o estágio ainda tem contatos', async () => {
    mockModuleOwned();
    (prisma.crmStage.findFirst as jest.Mock).mockResolvedValueOnce(seededStages[0]);
    (prisma.crmStage.count as jest.Mock).mockResolvedValueOnce(5);
    (prisma.crmContact.count as jest.Mock).mockResolvedValueOnce(3);
    const res = await app.inject({ method: 'DELETE', url: '/crm/stages/cstage0001', headers: authHeader });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/mova/i);
  });

  it('exclui o estágio quando está vazio', async () => {
    mockModuleOwned();
    (prisma.crmStage.findFirst as jest.Mock).mockResolvedValueOnce(seededStages[0]);
    (prisma.crmStage.count as jest.Mock).mockResolvedValueOnce(5);
    (prisma.crmContact.count as jest.Mock).mockResolvedValueOnce(0);
    (prisma.crmStage.delete as jest.Mock).mockResolvedValueOnce(seededStages[0]);
    const res = await app.inject({ method: 'DELETE', url: '/crm/stages/cstage0001', headers: authHeader });
    expect(res.statusCode).toBe(204);
  });
});

describe('POST /crm/stages/reorder', () => {
  it('retorna 400 quando a lista não bate com os estágios existentes', async () => {
    mockModuleOwned();
    (prisma.crmStage.findMany as jest.Mock).mockResolvedValueOnce(seededStages.map((s) => ({ id: s.id })));
    const res = await app.inject({
      method: 'POST', url: '/crm/stages/reorder', headers: authHeader,
      payload: { order: ['cstage0001'] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('reordena os estágios', async () => {
    mockModuleOwned();
    (prisma.crmStage.findMany as jest.Mock).mockResolvedValueOnce(seededStages.map((s) => ({ id: s.id })));
    (prisma.$transaction as jest.Mock).mockResolvedValueOnce([]);
    const newOrder = [...seededStages].reverse().map((s) => s.id);

    const res = await app.inject({
      method: 'POST', url: '/crm/stages/reorder', headers: authHeader, payload: { order: newOrder },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});

// ── Contatos ───────────────────────────────────────────────────────
describe('GET /crm/contacts', () => {
  it('lista os contatos do usuário', async () => {
    mockModuleOwned();
    (prisma.crmContact.findMany as jest.Mock).mockResolvedValueOnce([makeContact()]);
    const res = await app.inject({ method: 'GET', url: '/crm/contacts', headers: authHeader });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });
});

describe('GET /crm/contacts/:id', () => {
  it('retorna 404 quando o contato não existe', async () => {
    mockModuleOwned();
    (prisma.crmContact.findFirst as jest.Mock).mockResolvedValueOnce(null);
    const res = await app.inject({ method: 'GET', url: '/crm/contacts/ccontact001', headers: authHeader });
    expect(res.statusCode).toBe(404);
  });

  it('retorna o contato com estágio e timeline', async () => {
    mockModuleOwned();
    (prisma.crmContact.findFirst as jest.Mock).mockResolvedValueOnce({ ...makeContact(), stage: seededStages[0], activities: [] });
    const res = await app.inject({ method: 'GET', url: '/crm/contacts/ccontact001', headers: authHeader });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe('ccontact001');
  });
});

describe('POST /crm/contacts', () => {
  it('retorna 400 com telefone inválido', async () => {
    mockModuleOwned();
    const res = await app.inject({
      method: 'POST', url: '/crm/contacts', headers: authHeader,
      payload: { name: 'Maria', phone: '123' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('retorna 400 quando o stageId informado não existe', async () => {
    mockModuleOwned();
    (prisma.crmStage.findMany as jest.Mock).mockResolvedValueOnce(seededStages);
    const res = await app.inject({
      method: 'POST', url: '/crm/contacts', headers: authHeader,
      payload: { name: 'Maria', phone: '11988887777', stageId: 'cbadstage1' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/estágio inválido/i);
  });

  it('cria contato no primeiro estágio quando stageId é omitido', async () => {
    mockModuleOwned();
    (prisma.crmStage.findMany as jest.Mock).mockResolvedValueOnce(seededStages);
    (prisma.crmContact.create as jest.Mock).mockResolvedValueOnce(makeContact({ stageId: 'cstage0001' }));

    const res = await app.inject({
      method: 'POST', url: '/crm/contacts', headers: authHeader,
      payload: { name: 'Maria', phone: '11988887777' },
    });
    expect(res.statusCode).toBe(201);
    expect((prisma.crmContact.create as jest.Mock).mock.calls[0][0].data.stageId).toBe('cstage0001');
    expect((prisma.crmContact.create as jest.Mock).mock.calls[0][0].data.source).toBe('manual');
  });

  it('retorna 409 quando o telefone já existe', async () => {
    mockModuleOwned();
    (prisma.crmStage.findMany as jest.Mock).mockResolvedValueOnce(seededStages);
    (prisma.crmContact.create as jest.Mock).mockRejectedValueOnce(p2002());

    const res = await app.inject({
      method: 'POST', url: '/crm/contacts', headers: authHeader,
      payload: { name: 'Maria', phone: '11988887777' },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('PATCH /crm/contacts/:id', () => {
  it('retorna 404 quando o contato não existe', async () => {
    mockModuleOwned();
    (prisma.crmContact.findFirst as jest.Mock).mockResolvedValueOnce(null);
    const res = await app.inject({
      method: 'PATCH', url: '/crm/contacts/ccontact001', headers: authHeader, payload: { name: 'Nova' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('retorna 409 quando a atualização colide com telefone existente', async () => {
    mockModuleOwned();
    (prisma.crmContact.findFirst as jest.Mock).mockResolvedValueOnce(makeContact());
    (prisma.crmContact.update as jest.Mock).mockRejectedValueOnce(p2002());
    const res = await app.inject({
      method: 'PATCH', url: '/crm/contacts/ccontact001', headers: authHeader, payload: { phone: '11988887777' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('atualiza campos do contato', async () => {
    mockModuleOwned();
    (prisma.crmContact.findFirst as jest.Mock).mockResolvedValueOnce(makeContact());
    (prisma.crmContact.update as jest.Mock).mockResolvedValueOnce(makeContact({ company: 'Acme' }));
    const res = await app.inject({
      method: 'PATCH', url: '/crm/contacts/ccontact001', headers: authHeader, payload: { company: 'Acme' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().company).toBe('Acme');
  });
});

describe('PATCH /crm/contacts/:id/move', () => {
  it('retorna 404 quando o contato não existe', async () => {
    mockModuleOwned();
    (prisma.crmContact.findFirst as jest.Mock).mockResolvedValueOnce(null);
    const res = await app.inject({
      method: 'PATCH', url: '/crm/contacts/ccontact001/move', headers: authHeader, payload: { stageId: 'cstage0002' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('retorna 400 quando o estágio destino é inválido', async () => {
    mockModuleOwned();
    (prisma.crmContact.findFirst as jest.Mock).mockResolvedValueOnce({ ...makeContact(), stage: seededStages[0] });
    (prisma.crmStage.findFirst as jest.Mock).mockResolvedValueOnce(null);
    const res = await app.inject({
      method: 'PATCH', url: '/crm/contacts/ccontact001/move', headers: authHeader, payload: { stageId: 'cbadstage1' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('é no-op quando o contato já está no estágio destino', async () => {
    mockModuleOwned();
    (prisma.crmContact.findFirst as jest.Mock).mockResolvedValueOnce({ ...makeContact({ stageId: 'cstage0001' }), stage: seededStages[0] });
    (prisma.crmStage.findFirst as jest.Mock).mockResolvedValueOnce(seededStages[0]);
    const res = await app.inject({
      method: 'PATCH', url: '/crm/contacts/ccontact001/move', headers: authHeader, payload: { stageId: 'cstage0001' },
    });
    expect(res.statusCode).toBe(200);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('move para estágio isWon e fecha o negócio', async () => {
    mockModuleOwned();
    (prisma.crmContact.findFirst as jest.Mock).mockResolvedValueOnce({ ...makeContact({ stageId: 'cstage0001' }), stage: seededStages[0] });
    (prisma.crmStage.findFirst as jest.Mock).mockResolvedValueOnce(seededStages[3]); // Fechado, isWon
    (prisma.$transaction as jest.Mock).mockResolvedValueOnce([
      makeContact({ stageId: 'cstage0004', closedAt: new Date() }),
      { id: 'cactivity01', type: 'stage_change' },
    ]);

    const res = await app.inject({
      method: 'PATCH', url: '/crm/contacts/ccontact001/move', headers: authHeader, payload: { stageId: 'cstage0004' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().stageId).toBe('cstage0004');
    expect(res.json().closedAt).not.toBeNull();

    const txOps = (prisma.$transaction as jest.Mock).mock.calls[0][0];
    expect(txOps).toHaveLength(2);
  });

  it('move para estágio isLost registrando o motivo', async () => {
    mockModuleOwned();
    (prisma.crmContact.findFirst as jest.Mock).mockResolvedValueOnce({ ...makeContact({ stageId: 'cstage0001' }), stage: seededStages[0] });
    (prisma.crmStage.findFirst as jest.Mock).mockResolvedValueOnce(seededStages[4]); // Perdido, isLost
    (prisma.$transaction as jest.Mock).mockResolvedValueOnce([
      makeContact({ stageId: 'cstage0005', closedAt: new Date(), lostReason: 'Escolheu concorrente' }),
      { id: 'cactivity02', type: 'stage_change' },
    ]);

    const res = await app.inject({
      method: 'PATCH', url: '/crm/contacts/ccontact001/move', headers: authHeader,
      payload: { stageId: 'cstage0005', lostReason: 'Escolheu concorrente' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().lostReason).toBe('Escolheu concorrente');
  });
});

describe('DELETE /crm/contacts/:id', () => {
  it('retorna 404 quando o contato não existe', async () => {
    mockModuleOwned();
    (prisma.crmContact.findFirst as jest.Mock).mockResolvedValueOnce(null);
    const res = await app.inject({ method: 'DELETE', url: '/crm/contacts/ccontact001', headers: authHeader });
    expect(res.statusCode).toBe(404);
  });

  it('exclui o contato', async () => {
    mockModuleOwned();
    (prisma.crmContact.findFirst as jest.Mock).mockResolvedValueOnce(makeContact());
    (prisma.crmContact.delete as jest.Mock).mockResolvedValueOnce(makeContact());
    const res = await app.inject({ method: 'DELETE', url: '/crm/contacts/ccontact001', headers: authHeader });
    expect(res.statusCode).toBe(204);
  });
});

// ── Atividades e lembretes ─────────────────────────────────────────
describe('POST /crm/contacts/:id/activities', () => {
  it('retorna 400 quando lembrete não tem dueAt', async () => {
    mockModuleOwned();
    const res = await app.inject({
      method: 'POST', url: '/crm/contacts/ccontact001/activities', headers: authHeader,
      payload: { type: 'reminder', content: 'Ligar amanhã' },
    });
    expect(res.statusCode).toBe(400);
    expect(prisma.crmContact.findFirst).not.toHaveBeenCalled();
  });

  it('retorna 404 quando o contato não existe', async () => {
    mockModuleOwned();
    (prisma.crmContact.findFirst as jest.Mock).mockResolvedValueOnce(null);
    const res = await app.inject({
      method: 'POST', url: '/crm/contacts/ccontact001/activities', headers: authHeader,
      payload: { type: 'note', content: 'Cliente confirmou reunião' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('cria uma nota e atualiza lastActivityAt', async () => {
    mockModuleOwned();
    (prisma.crmContact.findFirst as jest.Mock).mockResolvedValueOnce(makeContact());
    (prisma.$transaction as jest.Mock).mockResolvedValueOnce([
      { id: 'cactivity01', type: 'note', content: 'Cliente confirmou reunião' },
      makeContact({ lastActivityAt: new Date() }),
    ]);

    const res = await app.inject({
      method: 'POST', url: '/crm/contacts/ccontact001/activities', headers: authHeader,
      payload: { type: 'note', content: 'Cliente confirmou reunião' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().type).toBe('note');
  });

  it('cria um lembrete com dueAt', async () => {
    mockModuleOwned();
    (prisma.crmContact.findFirst as jest.Mock).mockResolvedValueOnce(makeContact());
    (prisma.$transaction as jest.Mock).mockResolvedValueOnce([
      { id: 'cactivity02', type: 'reminder', content: 'Retornar ligação', dueAt: new Date('2026-08-01') },
      makeContact(),
    ]);

    const res = await app.inject({
      method: 'POST', url: '/crm/contacts/ccontact001/activities', headers: authHeader,
      payload: { type: 'reminder', content: 'Retornar ligação', dueAt: '2026-08-01T10:00:00.000Z' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().type).toBe('reminder');
  });
});

describe('PATCH /crm/activities/:id/complete', () => {
  it('retorna 404 quando a atividade não existe', async () => {
    mockModuleOwned();
    (prisma.crmActivity.findFirst as jest.Mock).mockResolvedValueOnce(null);
    const res = await app.inject({ method: 'PATCH', url: '/crm/activities/cactivity01/complete', headers: authHeader });
    expect(res.statusCode).toBe(404);
  });

  it('retorna 400 quando a atividade não é um lembrete', async () => {
    mockModuleOwned();
    (prisma.crmActivity.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'cactivity01', type: 'note' });
    const res = await app.inject({ method: 'PATCH', url: '/crm/activities/cactivity01/complete', headers: authHeader });
    expect(res.statusCode).toBe(400);
  });

  it('completa um lembrete', async () => {
    mockModuleOwned();
    (prisma.crmActivity.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'cactivity01', type: 'reminder' });
    (prisma.crmActivity.update as jest.Mock).mockResolvedValueOnce({ id: 'cactivity01', type: 'reminder', completedAt: new Date() });
    const res = await app.inject({ method: 'PATCH', url: '/crm/activities/cactivity01/complete', headers: authHeader });
    expect(res.statusCode).toBe(200);
    expect(res.json().completedAt).not.toBeNull();
  });
});

describe('GET /crm/reminders', () => {
  it('lista lembretes pendentes', async () => {
    mockModuleOwned();
    (prisma.crmActivity.findMany as jest.Mock).mockResolvedValueOnce([
      { id: 'cactivity01', type: 'reminder', dueAt: new Date(), completedAt: null, contact: { id: 'ccontact001', name: 'João', phone: '11999990000', stageId: 'cstage0001' } },
    ]);
    const res = await app.inject({ method: 'GET', url: '/crm/reminders', headers: authHeader });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });
});

// ── Importar do WhatsApp ───────────────────────────────────────────
// CRM #2: agregação (última ocorrência por telefone + contagem + exclusão de
// quem já é contato) roda no banco via $queryRaw — o teste verifica que a
// rota repassa e mapeia corretamente o resultado (count bigint -> number),
// não a lógica de agregação em si (isso é responsabilidade do Postgres).
describe('GET /crm/import/suggestions', () => {
  it('agrega por telefone, ignora contatos já importados e ordena por recência', async () => {
    mockModuleOwned();
    (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([
      { phone: '11900000001', name: 'Ana', numberId: 'num1', lastAt: new Date('2026-07-10'), count: 2n },
    ]);

    const res = await app.inject({ method: 'GET', url: '/crm/import/suggestions', headers: authHeader });
    expect(res.statusCode).toBe(200);
    const { suggestions } = res.json();
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toEqual(expect.objectContaining({ phone: '11900000001', name: 'Ana', count: 2 }));
  });
});

describe('POST /crm/import', () => {
  it('retorna 400 com lista de telefones vazia', async () => {
    mockModuleOwned();
    const res = await app.inject({
      method: 'POST', url: '/crm/import', headers: authHeader, payload: { phones: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('importa quem tem histórico, pula quem não tem e quem já é contato', async () => {
    mockModuleOwned();
    (prisma.crmStage.findMany as jest.Mock).mockResolvedValueOnce(seededStages);
    (prisma.transcription.findMany as jest.Mock).mockResolvedValueOnce([
      { contactPhone: '11900000001', contactName: 'Ana',     numberId: 'num1', createdAt: new Date() },
      { contactPhone: '11900000003', contactName: 'Carlos',  numberId: 'num1', createdAt: new Date() },
    ]);
    (prisma.crmContact.create as jest.Mock)
      .mockResolvedValueOnce(makeContact({ id: 'ccontact002', name: 'Ana', phone: '11900000001', source: 'import_whatsapp' }))
      .mockRejectedValueOnce(p2002());
    (prisma.crmActivity.create as jest.Mock).mockResolvedValueOnce({ id: 'cactivity03', type: 'note' });

    const res = await app.inject({
      method: 'POST', url: '/crm/import', headers: authHeader,
      payload: { phones: ['11900000001', '11900000002', '11900000003'] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      imported: ['11900000001'],
      skipped:  ['11900000002', '11900000003'],
    });
    expect(prisma.crmContact.create).toHaveBeenCalledTimes(2);
    expect(prisma.crmActivity.create).toHaveBeenCalledTimes(1);
  });
});
