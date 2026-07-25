/**
 * Testes do executor de comandos de voz — dispatch por intent, gate de módulo,
 * validação de campos obrigatórios e tratamento de colisão (P2002).
 */

jest.mock('../lib/prisma', () => ({
  prisma: {
    entitlement:   { findFirst: jest.fn() },
    crmStage:      { findFirst: jest.fn(), create: jest.fn(), findMany: jest.fn() },
    crmContact:    { create: jest.fn() },
    crmActivity:   { create: jest.fn(), count: jest.fn() },
    atendeKnowledgeBase: { create: jest.fn() },
    user:          { findUnique: jest.fn() },
    minuteBalance: { findUnique: jest.fn() },
  },
}));

jest.mock('../lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { prisma } from '../lib/prisma';
import { executeVoiceCommand } from '../services/voice-command-executor';

const userId = 'u1';

function p2002() {
  return Object.assign(new Error('Unique constraint failed on the fields: (`userId`,`phone`)'), { code: 'P2002' });
}

function moduleOwned() {
  (prisma.entitlement.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'ent1' });
}

function moduleMissing() {
  (prisma.entitlement.findFirst as jest.Mock).mockResolvedValueOnce(null);
}

beforeEach(() => jest.clearAllMocks());

describe('executeVoiceCommand — crm_create_lead', () => {
  it('cria contato com source voice_command quando módulo CRM está ativo', async () => {
    moduleOwned();
    (prisma.crmStage.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'stage1' });
    (prisma.crmContact.create as jest.Mock).mockResolvedValueOnce({ id: 'contact1' });

    const result = await executeVoiceCommand(userId, 'crm_create_lead', {
      nome: 'João Silva', telefone: '11988887777', empresa: 'Acme', valor: 5000,
    });

    expect(result.status).toBe('executed');
    expect(prisma.crmContact.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId, stageId: 'stage1', name: 'João Silva', phone: '11988887777',
        company: 'Acme', value: 5000, source: 'voice_command',
      }),
    }));
  });

  it('cria um CrmStage default quando usuário não tem nenhum estágio ainda', async () => {
    moduleOwned();
    (prisma.crmStage.findFirst as jest.Mock).mockResolvedValueOnce(null);
    (prisma.crmStage.create as jest.Mock).mockResolvedValueOnce({ id: 'stage-fallback' });
    (prisma.crmContact.create as jest.Mock).mockResolvedValueOnce({ id: 'contact1' });

    const result = await executeVoiceCommand(userId, 'crm_create_lead', { nome: 'Maria' });

    expect(prisma.crmStage.create).toHaveBeenCalled();
    expect(result.status).toBe('executed');
  });

  it('telefone ausente gera placeholder sintético (não bloqueia a criação)', async () => {
    moduleOwned();
    (prisma.crmStage.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'stage1' });
    (prisma.crmContact.create as jest.Mock).mockResolvedValueOnce({ id: 'contact1' });

    await executeVoiceCommand(userId, 'crm_create_lead', { nome: 'Sem Telefone' });

    const call = (prisma.crmContact.create as jest.Mock).mock.calls[0][0];
    expect(call.data.phone).toMatch(/^voz-/);
  });

  it('sem nome retorna failed sem tocar no banco', async () => {
    moduleOwned();

    const result = await executeVoiceCommand(userId, 'crm_create_lead', {});

    expect(result.status).toBe('failed');
    expect(prisma.crmContact.create).not.toHaveBeenCalled();
  });

  it('módulo CRM inativo retorna ignored com nudge, sem tocar no banco', async () => {
    moduleMissing();

    const result = await executeVoiceCommand(userId, 'crm_create_lead', { nome: 'João' });

    expect(result.status).toBe('ignored');
    expect(result.resultSummary).toMatch(/CRM/);
    expect(prisma.crmContact.create).not.toHaveBeenCalled();
  });

  it('colisão de telefone (P2002) retorna ignored, não failed', async () => {
    moduleOwned();
    (prisma.crmStage.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'stage1' });
    (prisma.crmContact.create as jest.Mock).mockRejectedValueOnce(p2002());

    const result = await executeVoiceCommand(userId, 'crm_create_lead', { nome: 'Duplicado', telefone: '11988887777' });

    expect(result.status).toBe('ignored');
    expect(result.resultSummary).toMatch(/já existe/i);
  });
});

describe('executeVoiceCommand — crm_query', () => {
  it('retorna contagem por estágio quando há leads', async () => {
    moduleOwned();
    (prisma.crmStage.findMany as jest.Mock).mockResolvedValueOnce([
      { name: 'Novo lead', _count: { contacts: 3 } },
      { name: 'Fechado', _count: { contacts: 1 } },
    ]);
    (prisma.crmActivity.count as jest.Mock).mockResolvedValueOnce(2);

    const result = await executeVoiceCommand(userId, 'crm_query', {});

    expect(result.status).toBe('executed');
    expect(result.resultSummary).toContain('4'); // total
    expect(result.resultSummary).toContain('2 lembrete'); // overdue
  });

  it('funil vazio retorna mensagem específica', async () => {
    moduleOwned();
    (prisma.crmStage.findMany as jest.Mock).mockResolvedValueOnce([{ name: 'Novo lead', _count: { contacts: 0 } }]);
    (prisma.crmActivity.count as jest.Mock).mockResolvedValueOnce(0);

    const result = await executeVoiceCommand(userId, 'crm_query', {});

    expect(result.status).toBe('executed');
    expect(result.resultSummary).toMatch(/vazio/i);
  });

  it('módulo CRM inativo retorna ignored', async () => {
    moduleMissing();

    const result = await executeVoiceCommand(userId, 'crm_query', {});

    expect(result.status).toBe('ignored');
    expect(prisma.crmStage.findMany).not.toHaveBeenCalled();
  });
});

describe('executeVoiceCommand — atende_add_kb', () => {
  it('cria entrada na base de conhecimento com pergunta e resposta', async () => {
    moduleOwned();
    (prisma.atendeKnowledgeBase.create as jest.Mock).mockResolvedValueOnce({ id: 'kb1' });

    const result = await executeVoiceCommand(userId, 'atende_add_kb', {
      pergunta: 'Qual o horário?', resposta: 'Seg-sex, 9h-18h',
    });

    expect(result.status).toBe('executed');
    expect(prisma.atendeKnowledgeBase.create).toHaveBeenCalledWith({
      data: { userId, question: 'Qual o horário?', answer: 'Seg-sex, 9h-18h' },
    });
  });

  it('faltando resposta retorna failed sem gravar', async () => {
    moduleOwned();

    const result = await executeVoiceCommand(userId, 'atende_add_kb', { pergunta: 'Qual o horário?' });

    expect(result.status).toBe('failed');
    expect(prisma.atendeKnowledgeBase.create).not.toHaveBeenCalled();
  });

  it('módulo Atende inativo retorna ignored', async () => {
    moduleMissing();

    const result = await executeVoiceCommand(userId, 'atende_add_kb', { pergunta: 'p', resposta: 'r' });

    expect(result.status).toBe('ignored');
  });
});

describe('executeVoiceCommand — stats_query', () => {
  it('calcula uso vs cota do plano free', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({ isTester: false, subscription: null });
    (prisma.minuteBalance.findUnique as jest.Mock).mockResolvedValueOnce({ audiosUsed: 5 });

    const result = await executeVoiceCommand(userId, 'stats_query', {});

    expect(result.status).toBe('executed');
    expect(result.resultSummary).toContain('Grátis');
    expect(result.resultSummary).toContain('5');
  });

  it('não depende de módulo (sem checagem de entitlement)', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({ isTester: true, subscription: null });
    (prisma.minuteBalance.findUnique as jest.Mock).mockResolvedValueOnce(null);

    const result = await executeVoiceCommand(userId, 'stats_query', {});

    expect(result.status).toBe('executed');
    expect(prisma.entitlement.findFirst).not.toHaveBeenCalled();
    expect(result.resultSummary).toContain('Pro');
  });
});

describe('executeVoiceCommand — erro inesperado', () => {
  it('erro de banco não-P2002 é capturado e vira status failed (nunca lança)', async () => {
    moduleOwned();
    (prisma.crmStage.findFirst as jest.Mock).mockRejectedValueOnce(new Error('conexão perdida'));

    const result = await executeVoiceCommand(userId, 'crm_create_lead', { nome: 'João' });

    expect(result.status).toBe('failed');
    expect(result.resultSummary).toBeNull();
  });
});
