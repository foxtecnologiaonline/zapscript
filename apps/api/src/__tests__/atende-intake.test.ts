/**
 * Testes do intake do Atende: roteamento multi-tenant (gate por AtendeConfig),
 * idempotência por messageId e o guardrail de categoria sensível (nunca
 * auto-enviar), incluindo o opt-in de auto-envio.
 */

// Evita bootar o servidor (io) ao importar o intake.
jest.mock('../index', () => ({ io: { to: () => ({ emit: () => {} }) } }));

jest.mock('../lib/prisma', () => ({
  prisma: {
    atendeConfig:    { findUnique: jest.fn() },
    atendeMensagem:  { findFirst: jest.fn(), create: jest.fn() },
    atendeConversa:  { upsert: jest.fn(), update: jest.fn() },
    atendePendencia: { createMany: jest.fn() },
  },
}));

// Mantém decideAutonomia/isSensitive reais; só o modelo (runAtendeAgent) é mockado.
jest.mock('../services/atende-agent', () => {
  const actual = jest.requireActual('../services/atende-agent');
  return { ...actual, runAtendeAgent: jest.fn() };
});

jest.mock('../services/atende-send', () => ({ sendAtendeReply: jest.fn() }));

import { atendeIntake } from '../services/atende-intake';
import { prisma } from '../lib/prisma';
import { runAtendeAgent } from '../services/atende-agent';
import { sendAtendeReply } from '../services/atende-send';

const p = prisma as any;
const mockAgent = runAtendeAgent as jest.Mock;
const mockSend = sendAtendeReply as jest.Mock;

const baseInput = {
  numberId: 'num1', userId: 'tenantA', remoteJid: '5511999998888@s.whatsapp.net',
  clienteNome: 'Cliente', mensagem: 'oi', messageId: 'msg-1',
};

function agentResult(over: any = {}) {
  return {
    classificacao: {
      categoria: 'duvida', urgencia: 'baixa', sentimento: 'neutro',
      confianca_resposta: 90, topicos_identificados: [], pendencias: [],
      ...over,
    },
    rascunho: 'Olá! Nosso horário é das 9h às 18h.',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  p.atendeMensagem.findFirst.mockResolvedValue(null);
  p.atendeConversa.upsert.mockResolvedValue({ id: 'conv1', resumoAtual: '' });
  p.atendeMensagem.create.mockImplementation((args: any) => Promise.resolve({ id: 'm1', ...args.data }));
  p.atendeConversa.update.mockResolvedValue({});
  p.atendePendencia.createMany.mockResolvedValue({});
  mockSend.mockResolvedValue(undefined);
});

describe('Atende intake — roteamento multi-tenant (gate)', () => {
  it('pula quando o tenant não tem AtendeConfig', async () => {
    p.atendeConfig.findUnique.mockResolvedValue(null);
    const r = await atendeIntake(baseInput);
    expect(r.status).toBe('skipped');
    expect(p.atendeMensagem.create).not.toHaveBeenCalled();
  });

  it('pula quando AtendeConfig.ativo = false', async () => {
    p.atendeConfig.findUnique.mockResolvedValue({ ativo: false, autoEnvioAtivo: true, categoriasSensiveis: [] });
    const r = await atendeIntake(baseInput);
    expect(r.status).toBe('skipped');
    expect(mockAgent).not.toHaveBeenCalled();
  });
});

describe('Atende intake — idempotência por messageId', () => {
  it('ignora mensagem já processada', async () => {
    p.atendeConfig.findUnique.mockResolvedValue({ ativo: true, autoEnvioAtivo: false, categoriasSensiveis: [] });
    p.atendeMensagem.findFirst.mockResolvedValue({ id: 'existing' });
    const r = await atendeIntake(baseInput);
    expect(r.status).toBe('duplicate');
    expect(r.mensagemId).toBe('existing');
    expect(mockAgent).not.toHaveBeenCalled();
    expect(p.atendeMensagem.create).not.toHaveBeenCalled();
  });
});

describe('Atende intake — auto-envio (verde) só com opt-in', () => {
  it('caso verde COM autoEnvioAtivo → envia e marca sent', async () => {
    p.atendeConfig.findUnique.mockResolvedValue({ ativo: true, autoEnvioAtivo: true, categoriasSensiveis: [] });
    mockAgent.mockResolvedValue(agentResult());
    const r = await atendeIntake(baseInput);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(r.status).toBe('sent');
    const created = p.atendeMensagem.create.mock.calls[0][0].data;
    expect(created.status).toBe('sent');
    expect(created.respostaFinal).toBeTruthy();
  });

  it('caso verde SEM autoEnvioAtivo → fila, não envia', async () => {
    p.atendeConfig.findUnique.mockResolvedValue({ ativo: true, autoEnvioAtivo: false, categoriasSensiveis: [] });
    mockAgent.mockResolvedValue(agentResult());
    const r = await atendeIntake(baseInput);
    expect(mockSend).not.toHaveBeenCalled();
    expect(r.status).toBe('pending_approval');
  });
});

describe('Atende intake — guardrail de categoria sensível', () => {
  it('categoria sensível do tenant NUNCA é auto-enviada, mesmo com autoEnvioAtivo', async () => {
    p.atendeConfig.findUnique.mockResolvedValue({ ativo: true, autoEnvioAtivo: true, categoriasSensiveis: ['contrato'] });
    mockAgent.mockResolvedValue(agentResult({ confianca_resposta: 99, topicos_identificados: ['contrato'] }));
    const r = await atendeIntake({ ...baseInput, mensagem: 'quero rever meu contrato' });
    expect(mockSend).not.toHaveBeenCalled();
    expect(r.status).not.toBe('sent');
    const created = p.atendeMensagem.create.mock.calls[0][0].data;
    expect(created.categoriaSensivel).toBe(true);
    expect(created.requerEscalacao).toBe(true);
  });

  it('piso jurídico (reembolso) nunca é auto-enviado, mesmo sem categorias do tenant', async () => {
    p.atendeConfig.findUnique.mockResolvedValue({ ativo: true, autoEnvioAtivo: true, categoriasSensiveis: [] });
    mockAgent.mockResolvedValue(agentResult({ confianca_resposta: 99 }));
    const r = await atendeIntake({ ...baseInput, mensagem: 'exijo reembolso imediato' });
    expect(mockSend).not.toHaveBeenCalled();
    expect(r.status).not.toBe('sent');
  });
});
