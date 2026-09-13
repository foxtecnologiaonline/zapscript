/**
 * Testes do agente do Copiloto v2.0 — cobre a expansão de escopo de "só
 * comercial" para 5 tipos (comercial/pessoal/admin/crise/oportunidade).
 *
 * Mesma estratégia de mock de atende-agent.test.ts: callAiWithFallback nunca é
 * chamado de verdade — o teste garante que triageConversation/buildBriefing
 * normalizam corretamente o que a IA (mockada) devolve, não a qualidade da IA.
 */

jest.mock('../../lib/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

jest.mock('../ai-fallback', () => ({
  buildModelChain: jest.fn(() => []),
  callAiWithFallback: jest.fn(),
}));

const { callAiWithFallback } = require('../ai-fallback');
import { triageConversation, buildBriefing } from '../copiloto-agent';

describe('copiloto-agent v2.0', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('triageConversation — classificação de tipo', () => {
    const baseParams = {
      userId: 'user-1',
      newMessages: [{ direction: 'in', content: 'oi' }],
    };

    it('classifica comercial e propaga confidence/motivo', async () => {
      callAiWithFallback.mockResolvedValueOnce({
        decisao: 'briefing', tipo: 'comercial', remetente: 'cliente_novo',
        motivo: 'pergunta de preço', confianca: 90,
      });
      const result = await triageConversation(baseParams);
      expect(result.shouldBrief).toBe(true);
      expect(result.tipo).toBe('comercial');
      expect(result.remetente).toBe('cliente_novo');
      expect(result.confidence).toBe(90);
    });

    it('classifica pessoal', async () => {
      callAiWithFallback.mockResolvedValueOnce({
        decisao: 'briefing', tipo: 'pessoal', remetente: 'ativo', motivo: 'elogio', confianca: 80,
      });
      const result = await triageConversation(baseParams);
      expect(result.shouldBrief).toBe(true);
      expect(result.tipo).toBe('pessoal');
    });

    it('classifica admin', async () => {
      callAiWithFallback.mockResolvedValueOnce({
        decisao: 'briefing', tipo: 'admin', remetente: 'ativo', motivo: 'boleto', confianca: 85,
      });
      const result = await triageConversation(baseParams);
      expect(result.tipo).toBe('admin');
    });

    it('classifica crise', async () => {
      callAiWithFallback.mockResolvedValueOnce({
        decisao: 'briefing', tipo: 'crise', remetente: 'ativo', motivo: 'reclamação forte', confianca: 95,
      });
      const result = await triageConversation(baseParams);
      expect(result.tipo).toBe('crise');
    });

    it('classifica oportunidade', async () => {
      callAiWithFallback.mockResolvedValueOnce({
        decisao: 'briefing', tipo: 'oportunidade', remetente: 'parceiro', motivo: 'proposta de parceria', confianca: 75,
      });
      const result = await triageConversation(baseParams);
      expect(result.tipo).toBe('oportunidade');
      expect(result.remetente).toBe('parceiro');
    });

    it('rejeita confirmação pura (ignorar)', async () => {
      callAiWithFallback.mockResolvedValueOnce({
        decisao: 'ignorar', tipo: null, motivo: 'confirmação simples', confianca: 95,
      });
      const result = await triageConversation(baseParams);
      expect(result.shouldBrief).toBe(false);
      expect(result.tipo).toBeNull();
      expect(result.remetente).toBeNull();
    });

    it('tipo inválido/desconhecido vira null mesmo com shouldBrief=true', async () => {
      callAiWithFallback.mockResolvedValueOnce({
        decisao: 'briefing', tipo: 'algo-que-nao-existe', motivo: 'x', confianca: 60,
      });
      const result = await triageConversation(baseParams);
      expect(result.shouldBrief).toBe(true);
      expect(result.tipo).toBeNull();
    });

    it('remetente ausente vira "outro" quando shouldBrief=true', async () => {
      callAiWithFallback.mockResolvedValueOnce({
        decisao: 'briefing', tipo: 'comercial', motivo: 'x', confianca: 60,
      });
      const result = await triageConversation(baseParams);
      expect(result.remetente).toBe('outro');
    });

    it('falha fechada quando a IA falha (não interrompe o dono)', async () => {
      callAiWithFallback.mockRejectedValueOnce(new Error('todos os provedores falharam'));
      const result = await triageConversation(baseParams);
      expect(result.shouldBrief).toBe(false);
      expect(result.tipo).toBeNull();
      expect(result.remetente).toBeNull();
    });
  });

  describe('buildBriefing — contexto-aware por tipo', () => {
    const baseParams = {
      userId: 'user-1',
      history: [{ direction: 'in', content: 'quanto custa?' }],
    };

    function mockOpcoes() {
      return {
        resumo: 'resumo', intencao: 'intencao', temperatura: 'morno', trava: null,
        risco: 'baixo', sensivel: false, observacao: null,
        opcoes: [
          { eixo: 'avancar', titulo: 'T1', rascunho: 'Rascunho 1', porque: 'p1', risco: null, tecnica: 'proximo-passo', confianca: 80, compromisso: null },
          { eixo: 'qualificar', titulo: 'T2', rascunho: 'Rascunho 2', porque: 'p2', risco: null, tecnica: 'qualificacao', confianca: 70, compromisso: null },
          { eixo: 'posicionar', titulo: 'T3', rascunho: 'Rascunho 3', porque: 'p3', risco: null, tecnica: 'ancoragem', confianca: 60, compromisso: null },
        ],
      };
    }

    it('gera as 3 opções nos eixos canônicos independente do tipo', async () => {
      callAiWithFallback.mockResolvedValueOnce(mockOpcoes());
      const brief = await buildBriefing({ ...baseParams, tipo: 'pessoal', remetente: 'ativo' });
      expect(brief.options).toHaveLength(3);
      expect(brief.options.map((o) => o.axis)).toEqual(['avancar', 'qualificar', 'posicionar']);
    });

    it('sem tipo informado, assume comercial (compat retroativa)', async () => {
      callAiWithFallback.mockResolvedValueOnce(mockOpcoes());
      await buildBriefing(baseParams as any);
      const userMsg = callAiWithFallback.mock.calls[0][0].user as string;
      expect(userMsg).toContain('Tipo de conversa: comercial');
    });

    it('injeta tipo e remetente na mensagem enviada à IA', async () => {
      callAiWithFallback.mockResolvedValueOnce(mockOpcoes());
      await buildBriefing({ ...baseParams, tipo: 'crise', remetente: 'ativo' });
      const userMsg = callAiWithFallback.mock.calls[0][0].user as string;
      expect(userMsg).toContain('crise');
      expect(userMsg).toContain('Remetente: ativo');
    });

    it('aceita técnicas novas de tipos v2.0', async () => {
      const opcoes = mockOpcoes();
      opcoes.opcoes[0].tecnica = 'responsabilidade-imediata';
      callAiWithFallback.mockResolvedValueOnce(opcoes);
      const brief = await buildBriefing({ ...baseParams, tipo: 'crise' });
      expect(brief.options[0].technique).toBe('responsabilidade-imediata');
    });

    it('técnica desconhecida cai no fallback proximo-passo', async () => {
      const opcoes = mockOpcoes();
      opcoes.opcoes[0].tecnica = 'tecnica-inventada-pela-ia';
      callAiWithFallback.mockResolvedValueOnce(opcoes);
      const brief = await buildBriefing({ ...baseParams, tipo: 'pessoal' });
      expect(brief.options[0].technique).toBe('proximo-passo');
    });
  });
});
