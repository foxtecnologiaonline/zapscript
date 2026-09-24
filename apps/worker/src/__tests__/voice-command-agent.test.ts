/**
 * Testes do classificador de intent do Comando de Voz Universal.
 * Cobre: classificação válida, limiar de confiança conservador (70),
 * fallback seguro 'none' quando todos os modelos falham, e texto curto
 * demais para sequer chamar a IA.
 */

// Cadeia atual (Opção 3 — custo/velocidade mínima): 1 modelo Anthropic +
// OpenAI/Groq/Gemini como rede de segurança cross-provider (ai-fallback.ts).
// Precisa das 3 API keys "configuradas" ANTES do import de voice-command-agent
// (que monta a cadeia no module load) pra buildModelChain não descartar os
// fallbacks — e do mock de 'openai' (Groq/Gemini reusam o mesmo client, só
// muda a baseURL) além do de '@anthropic-ai/sdk'.
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

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { classifyVoiceCommand } from '../services/voice-command-agent';

const claudeInstance = (Anthropic as unknown as jest.Mock).mock.results[0].value;
const createMock = claudeInstance.messages.create as jest.Mock;

// 3 instâncias OpenAI-compatíveis são criadas na ordem openai → groq → gemini
// (ai-fallback.ts) — cada uma com seu próprio mock de chat.completions.create.
const openaiInstances = (OpenAI as unknown as jest.Mock).mock.results.map((r: any) => r.value);
const [openaiCreateMock, groqCreateMock, geminiCreateMock] = openaiInstances.map(
  (i: any) => i.chat.completions.create as jest.Mock,
);

function respondWithCompat(mock: jest.Mock, json: object) {
  mock.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(json) } }] });
}

function respondWith(json: object) {
  createMock.mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify(json) }] });
}

describe('classifyVoiceCommand', () => {
  beforeEach(() => {
    createMock.mockReset();
    openaiCreateMock.mockReset();
    groqCreateMock.mockReset();
    geminiCreateMock.mockReset();
  });

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
    openaiCreateMock.mockRejectedValue(new Error('rate limited'));
    groqCreateMock.mockRejectedValue(new Error('rate limited'));
    geminiCreateMock.mockRejectedValue(new Error('rate limited'));

    const result = await classifyVoiceCommand('nota de voz qualquer que dispararia os 4 modelos');

    expect(result.intent).toBe('none');
    expect(result.confidence).toBe(0);
    // 1 por modelo em AGENT_MODELS (Opção 3: claude-haiku-4-5 → gpt-4o-mini → llama-3.3-70b-versatile → gemini-2.5-flash)
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(openaiCreateMock).toHaveBeenCalledTimes(1);
    expect(groqCreateMock).toHaveBeenCalledTimes(1);
    expect(geminiCreateMock).toHaveBeenCalledTimes(1);
  });

  it('resposta sem JSON válido no primeiro modelo (Claude) cai para o próximo da cadeia (OpenAI)', async () => {
    createMock.mockResolvedValueOnce({ content: [{ type: 'text', text: 'desculpe, não consigo ajudar' }] });
    respondWithCompat(openaiCreateMock, { intent: 'atende_add_kb', confianca: 80, dados: { pergunta: 'horário?', resposta: '9h-18h' } });

    const result = await classifyVoiceCommand('adiciona na base: quando perguntarem o horário, responde 9h às 18h');

    expect(result.intent).toBe('atende_add_kb');
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(openaiCreateMock).toHaveBeenCalledTimes(1);
  });
});
