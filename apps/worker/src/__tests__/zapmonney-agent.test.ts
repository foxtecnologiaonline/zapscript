/**
 * Testes do agente do ZapMonney.
 *
 * Duas frentes:
 * 1. Partes puras (valor em pt-BR, categoria, atalho de confirmação) — é aqui
 *    que um erro vira dinheiro errado no saldo da pessoa.
 * 2. Cadeia multimodelo — ZAPMONNEY_AGENT_MODEL aceita lista, e a cadeia
 *    percorre modelo a modelo e depois provedor a provedor até alguém devolver
 *    JSON válido.
 */

// A cadeia é montada no module load de zapmonney-agent, então as API keys e a
// lista de modelos precisam existir ANTES do import — senão buildModelChain
// descarta os provedores sem key e sobra um modelo só.
process.env.ZAPMONNEY_AGENT_MODEL = 'claude-haiku-4-5,claude-sonnet-5';
process.env.OPENAI_API_KEY = 'test-openai-key';
process.env.GROQ_API_KEY   = 'test-groq-key';
process.env.GEMINI_API_KEY = 'test-gemini-key';

jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: { create: jest.fn() },
  }));
});

jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: { completions: { create: jest.fn() } },
  }));
});

jest.mock('../lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../lib/aiUsage', () => ({ logAiUsage: jest.fn() }));

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import {
  parseAmount, normalizeCategory, matchQuickReply, ZM_CATEGORIES,
  classifyZapMonneyMessage,
} from '../services/zapmonney-agent';

const claudeCreate = (Anthropic as unknown as jest.Mock).mock.results[0].value.messages.create as jest.Mock;
const openaiCreate = (OpenAI as unknown as jest.Mock).mock.results[0].value.chat.completions.create as jest.Mock;

const CLASSIFY_OPTS = { todayBrt: '2026-10-01', hasPending: false };

function anthropicAnswers(json: object) {
  claudeCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text: JSON.stringify(json) }],
    usage:   { input_tokens: 10, output_tokens: 5 },
  });
}

function openaiAnswers(json: object) {
  openaiCreate.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(json) } }] });
}

beforeEach(() => jest.clearAllMocks());

describe('parseAmount — convenção pt-BR', () => {
  it('aceita número puro', () => {
    expect(parseAmount(50)).toBe(50);
    expect(parseAmount(32.9)).toBe(32.9);
  });

  it('trata vírgula como decimal', () => {
    expect(parseAmount('32,90')).toBe(32.9);
    expect(parseAmount('1.200,50')).toBe(1200.5);
  });

  it('trata ponto como milhar quando sobram 3 casas', () => {
    expect(parseAmount('1.200')).toBe(1200);
    expect(parseAmount('12.000')).toBe(12000);
  });

  it('trata ponto como decimal quando sobram até 2 casas', () => {
    expect(parseAmount('18.50')).toBe(18.5);
    expect(parseAmount('18.5')).toBe(18.5);
  });

  it('ignora símbolo de moeda e espaços', () => {
    expect(parseAmount('R$ 50')).toBe(50);
    expect(parseAmount(' R$ 1.200,50 ')).toBe(1200.5);
  });

  it('rejeita valor ausente, zero, negativo ou não numérico', () => {
    expect(parseAmount(undefined)).toBeNull();
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount(0)).toBeNull();
    expect(parseAmount(-10)).toBeNull();
  });
});

describe('normalizeCategory', () => {
  it('força Receita em entrada, qualquer que seja o palpite do modelo', () => {
    expect(normalizeCategory('Lazer', 'income')).toBe('Receita');
    expect(normalizeCategory(undefined, 'income')).toBe('Receita');
  });

  it('casa categoria válida ignorando caixa', () => {
    expect(normalizeCategory('alimentação', 'expense')).toBe('Alimentação');
    expect(normalizeCategory('TRANSPORTE', 'expense')).toBe('Transporte');
  });

  it('cai em Outros quando o modelo inventa categoria', () => {
    expect(normalizeCategory('Criptomoeda', 'expense')).toBe('Outros');
    expect(normalizeCategory(null, 'expense')).toBe('Outros');
  });

  it('devolve sempre um valor de ZM_CATEGORIES', () => {
    for (const guess of ['Moradia', 'xyz', '', 'saúde']) {
      expect(ZM_CATEGORIES).toContain(normalizeCategory(guess, 'expense'));
    }
  });
});

describe('matchQuickReply — atalho sem IA', () => {
  it('reconhece confirmação curta', () => {
    for (const t of ['sim', 'SIM', 'Isso', 'ok', 'confirma', 'certo', '👍', 'sim.']) {
      expect(matchQuickReply(t)).toBe('confirm');
    }
  });

  it('reconhece recusa curta', () => {
    for (const t of ['não', 'nao', 'NÃO', 'cancela', 'errado', '❌']) {
      expect(matchQuickReply(t)).toBe('cancel');
    }
  });

  it('devolve null quando a mensagem tem mais do que sim/não — modelo decide', () => {
    expect(matchQuickReply('sim, mas era 80')).toBeNull();
    expect(matchQuickReply('não foi no mercado, foi na farmácia')).toBeNull();
    expect(matchQuickReply('gastei 50 no mercado')).toBeNull();
  });
});

describe('classifyZapMonneyMessage', () => {
  it('extrai despesa e normaliza o valor em string pt-BR', async () => {
    anthropicAnswers({
      intent: 'add_expense',
      confianca: 90,
      dados: { valor: '32,90', categoria: 'Alimentação', descricao: 'almoço', data: '2026-10-01' },
    });

    const r = await classifyZapMonneyMessage('almoço 32,90', CLASSIFY_OPTS);

    expect(r.intent).toBe('add_expense');
    expect(r.data.valor).toBe(32.9);
    expect(r.data.categoria).toBe('Alimentação');
  });

  it('cai em none quando a confiança fica abaixo do limiar', async () => {
    anthropicAnswers({ intent: 'add_expense', confianca: 20, dados: { valor: 50 } });

    const r = await classifyZapMonneyMessage('talvez uns 50', CLASSIFY_OPTS);

    expect(r.intent).toBe('none');
  });

  it('percorre a lista de modelos Anthropic antes de trocar de provedor', async () => {
    claudeCreate.mockRejectedValueOnce(new Error('overloaded'));
    anthropicAnswers({ intent: 'query_balance', confianca: 95, dados: { periodo: 'mes_atual' } });

    const r = await classifyZapMonneyMessage('qual meu saldo', CLASSIFY_OPTS);

    expect(claudeCreate).toHaveBeenCalledTimes(2);
    expect(claudeCreate.mock.calls[0][0].model).toBe('claude-haiku-4-5');
    expect(claudeCreate.mock.calls[1][0].model).toBe('claude-sonnet-5');
    expect(openaiCreate).not.toHaveBeenCalled();
    expect(r.intent).toBe('query_balance');
  });

  it('cai para outro provedor quando a cadeia Anthropic inteira falha', async () => {
    claudeCreate.mockRejectedValue(new Error('sem crédito'));
    openaiAnswers({ intent: 'help', confianca: 99, dados: {} });

    const r = await classifyZapMonneyMessage('como funciona', CLASSIFY_OPTS);

    expect(claudeCreate).toHaveBeenCalledTimes(2);
    expect(openaiCreate).toHaveBeenCalledTimes(1);
    expect(r.intent).toBe('help');
  });

  it('devolve none sem chamar IA quando a mensagem é curta demais', async () => {
    const r = await classifyZapMonneyMessage('a', CLASSIFY_OPTS);

    expect(r.intent).toBe('none');
    expect(claudeCreate).not.toHaveBeenCalled();
  });
});
