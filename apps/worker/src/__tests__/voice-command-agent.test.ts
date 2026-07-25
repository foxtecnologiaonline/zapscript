/**
 * Testes do classificador de intent do Comando de Voz Universal.
 * Cobre: classificação válida, limiar de confiança conservador (70),
 * fallback seguro 'none' quando todos os modelos falham, e texto curto
 * demais para sequer chamar a IA.
 */

jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: { create: jest.fn() },
  }));
});

import Anthropic from '@anthropic-ai/sdk';
import { classifyVoiceCommand } from '../services/voice-command-agent';

const claudeInstance = (Anthropic as unknown as jest.Mock).mock.results[0].value;
const createMock = claudeInstance.messages.create as jest.Mock;

function respondWith(json: object) {
  createMock.mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify(json) }] });
}

describe('classifyVoiceCommand', () => {
  beforeEach(() => createMock.mockReset());

  it('classifica crm_create_lead com confiança alta', async () => {
    respondWith({
      intent: 'crm_create_lead',
      confianca: 92,
      dados: { nome: 'João Silva', telefone: '11988887777', empresa: 'Acme' },
    });

    const result = await classifyVoiceCommand('cria um lead pro João Silva da Acme, telefone 11988887777');

    expect(result.intent).toBe('crm_create_lead');
    expect(result.confidence).toBe(92);
    expect(result.data.nome).toBe('João Silva');
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('classifica stats_query com dados vazio', async () => {
    respondWith({ intent: 'stats_query', confianca: 85, dados: {} });

    const result = await classifyVoiceCommand('quantos áudios eu já usei esse mês');

    expect(result.intent).toBe('stats_query');
    expect(result.data).toEqual({});
  });

  it('confiança abaixo do limiar (70) cai para "none" mesmo com intent reconhecido', async () => {
    respondWith({ intent: 'crm_create_lead', confianca: 55, dados: { nome: 'Maria' } });

    const result = await classifyVoiceCommand('acho que talvez seja um lead? não sei');

    expect(result.intent).toBe('none');
    expect(result.confidence).toBe(0);
    expect(result.data).toEqual({});
  });

  it('texto curto demais (<3 chars) não chama a IA e retorna "none"', async () => {
    const result = await classifyVoiceCommand('ok');

    expect(result.intent).toBe('none');
    expect(createMock).not.toHaveBeenCalled();
  });

  it('todos os modelos falhando retorna fallback seguro "none" (nunca lança erro)', async () => {
    createMock.mockRejectedValue(new Error('rate limited'));

    const result = await classifyVoiceCommand('nota de voz qualquer que dispararia os 3 modelos');

    expect(result.intent).toBe('none');
    expect(result.confidence).toBe(0);
    expect(createMock).toHaveBeenCalledTimes(3); // um por modelo em AGENT_MODELS
  });

  it('resposta sem JSON válido no primeiro modelo cai para o próximo modelo', async () => {
    createMock.mockResolvedValueOnce({ content: [{ type: 'text', text: 'desculpe, não consigo ajudar' }] });
    respondWith({ intent: 'atende_add_kb', confianca: 80, dados: { pergunta: 'horário?', resposta: '9h-18h' } });

    const result = await classifyVoiceCommand('adiciona na base: quando perguntarem o horário, responde 9h às 18h');

    expect(result.intent).toBe('atende_add_kb');
    expect(createMock).toHaveBeenCalledTimes(2);
  });
});
