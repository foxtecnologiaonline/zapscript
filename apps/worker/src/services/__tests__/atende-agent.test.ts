import { runAtendeAgent } from '../atende-agent';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';

jest.mock('../../lib/prisma', () => ({
  prisma: {
    atendeKnowledgeBase: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('../../lib/logger', () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../ai-fallback', () => ({
  buildModelChain: jest.fn(() => []),
  callAiWithFallback: jest.fn(),
}));

const { callAiWithFallback } = require('../ai-fallback');

describe('atende-agent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('runAtendeAgent', () => {
    it('should return a valid AtendeAgentResult with confidence and reply', async () => {
      const mockKb = [
        { question: 'Qual o horário?', answer: 'Abrimos às 8h' },
        { question: 'Qual o telefone?', answer: '11 99999-9999' },
      ];

      (prisma.atendeKnowledgeBase.findMany as jest.Mock).mockResolvedValueOnce(mockKb);

      callAiWithFallback.mockResolvedValueOnce({
        resposta: 'Abrimos às 8h.',
        confianca: 95,
        precisa_humano: false,
      });

      const result = await runAtendeAgent({
        userId: 'test-user-123',
        config: {
          businessContext: 'Loja de roupas',
          tone: 'profissional-amigavel',
          confidenceLevel: 'equilibrado',
        },
        message: 'Qual o horário?',
        contactName: 'João',
      });

      expect(result.reply).toBe('Abrimos às 8h.');
      expect(result.confidence).toBe(95);
      expect(result.needsHuman).toBe(false);
    });

    it('should mark needsHuman=true when confidence < threshold', async () => {
      (prisma.atendeKnowledgeBase.findMany as jest.Mock).mockResolvedValueOnce([]);

      callAiWithFallback.mockResolvedValueOnce({
        resposta: 'Não tenho certeza.',
        confianca: 40, // < 60 (equilibrado threshold)
        precisa_humano: false,
      });

      const result = await runAtendeAgent({
        userId: 'test-user-123',
        config: {
          businessContext: 'Negócio',
          tone: 'profissional-amigavel',
          confidenceLevel: 'equilibrado',
        },
        message: 'Pergunta difícil?',
      });

      expect(result.needsHuman).toBe(true);
    });

    it('should mark needsHuman=true when AI sets precisa_humano flag', async () => {
      (prisma.atendeKnowledgeBase.findMany as jest.Mock).mockResolvedValueOnce([]);

      callAiWithFallback.mockResolvedValueOnce({
        resposta: 'Deixa eu verificar com o dono.',
        confianca: 75,
        precisa_humano: true, // AI explicitly flagged
      });

      const result = await runAtendeAgent({
        userId: 'test-user-123',
        config: {
          businessContext: 'Negócio',
          tone: 'profissional-amigavel',
          confidenceLevel: 'equilibrado',
        },
        message: 'Decisão que precisa de humano',
      });

      expect(result.needsHuman).toBe(true);
    });

    it('should use conservador threshold (80%) when confidenceLevel is conservador', async () => {
      (prisma.atendeKnowledgeBase.findMany as jest.Mock).mockResolvedValueOnce([]);

      callAiWithFallback.mockResolvedValueOnce({
        resposta: 'Resposta com 75% de certeza',
        confianca: 75, // >= 60 (equilibrado) but < 80 (conservador)
        precisa_humano: false,
      });

      const result = await runAtendeAgent({
        userId: 'test-user-123',
        config: {
          businessContext: 'Negócio sensível',
          tone: 'formal',
          confidenceLevel: 'conservador',
        },
        message: 'Pergunta crítica',
      });

      expect(result.needsHuman).toBe(true); // Should escalate due to conservador threshold
    });

    it('should use autonomo threshold (40%) when confidenceLevel is autonomo', async () => {
      (prisma.atendeKnowledgeBase.findMany as jest.Mock).mockResolvedValueOnce([]);

      callAiWithFallback.mockResolvedValueOnce({
        resposta: 'Resposta com 50% de certeza',
        confianca: 50, // >= 40 (autonomo)
        precisa_humano: false,
      });

      const result = await runAtendeAgent({
        userId: 'test-user-123',
        config: {
          businessContext: 'FAQ simples',
          tone: 'descontraido',
          confidenceLevel: 'autonomo',
        },
        message: 'Pergunta básica',
      });

      expect(result.needsHuman).toBe(false); // Should NOT escalate (autonomo is lenient)
    });

    it('should mark needsHuman=true when reply is empty', async () => {
      (prisma.atendeKnowledgeBase.findMany as jest.Mock).mockResolvedValueOnce([]);

      callAiWithFallback.mockResolvedValueOnce({
        resposta: '', // Empty reply
        confianca: 90,
        precisa_humano: false,
      });

      const result = await runAtendeAgent({
        userId: 'test-user-123',
        config: {
          businessContext: 'Negócio',
          tone: 'profissional-amigavel',
          confidenceLevel: 'equilibrado',
        },
        message: 'Teste',
      });

      expect(result.needsHuman).toBe(true);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should log warning when AI returns invalid confidence type', async () => {
      (prisma.atendeKnowledgeBase.findMany as jest.Mock).mockResolvedValueOnce([]);

      callAiWithFallback.mockResolvedValueOnce({
        resposta: 'Resposta ok',
        confianca: 'ninety', // Invalid: string instead of number
        precisa_humano: false,
      });

      const result = await runAtendeAgent({
        userId: 'test-user-123',
        config: {
          businessContext: 'Negócio',
          tone: 'profissional-amigavel',
          confidenceLevel: 'equilibrado',
        },
        message: 'Teste',
      });

      expect(result.confidence).toBe(0); // Defaults to 0
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Confiança inválida'),
      );
    });

    it('should log warning when latency exceeds 5 seconds', async () => {
      (prisma.atendeKnowledgeBase.findMany as jest.Mock).mockResolvedValueOnce([]);

      callAiWithFallback.mockImplementationOnce(async () => {
        // Simulate slow AI response
        await new Promise((resolve) => setTimeout(resolve, 100));
        return {
          resposta: 'Resposta lenta',
          confianca: 80,
          precisa_humano: false,
        };
      });

      // Mock Date.now to simulate slow execution
      const originalDateNow = Date.now;
      let callCount = 0;
      jest.spyOn(Date, 'now').mockImplementation(() => {
        callCount++;
        if (callCount === 1) return 0; // startTime
        if (callCount === 2) return 100; // aiStartTime
        if (callCount === 3) return 5100; // aiEndTime (5100ms total)
        return originalDateNow();
      });

      const result = await runAtendeAgent({
        userId: 'test-user-123',
        config: {
          businessContext: 'Negócio',
          tone: 'profissional-amigavel',
          confidenceLevel: 'equilibrado',
        },
        message: 'Teste',
      });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/Agente lento.*ms total/),
      );

      jest.restoreAllMocks();
    });

    it('should select relevant KB entries based on message', async () => {
      const mockKb = [
        { question: 'Horário de funcionamento?', answer: 'Seg-sex 9h-18h' },
        { question: 'Qual é o CNPJ?', answer: '12.345.678/0001-99' },
        { question: 'Telefone de contato?', answer: '11 99999-9999' },
      ];

      (prisma.atendeKnowledgeBase.findMany as jest.Mock).mockResolvedValueOnce(mockKb);

      callAiWithFallback.mockResolvedValueOnce({
        resposta: 'Abrimos seg-sex de 9h às 18h.',
        confianca: 95,
        precisa_humano: false,
      });

      await runAtendeAgent({
        userId: 'test-user-123',
        config: {
          businessContext: 'Negócio',
          tone: 'profissional-amigavel',
          confidenceLevel: 'equilibrado',
        },
        message: 'Qual é o horário?',
      });

      // Verify that KB was queried
      expect(prisma.atendeKnowledgeBase.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: 'test-user-123',
            active: true,
          },
        }),
      );
    });

    it('should handle KB retrieval failure gracefully', async () => {
      (prisma.atendeKnowledgeBase.findMany as jest.Mock).mockRejectedValueOnce(
        new Error('Database error'),
      );

      callAiWithFallback.mockResolvedValueOnce({
        resposta: 'Resposta genérica',
        confianca: 50,
        precisa_humano: true,
      });

      const result = await runAtendeAgent({
        userId: 'test-user-123',
        config: {
          businessContext: 'Negócio',
          tone: 'profissional-amigavel',
          confidenceLevel: 'equilibrado',
        },
        message: 'Teste',
      });

      expect(result.reply).toBe('Resposta genérica');
      // Should not crash, KB defaults to empty array
    });

    it('should trim reply whitespace', async () => {
      (prisma.atendeKnowledgeBase.findMany as jest.Mock).mockResolvedValueOnce([]);

      callAiWithFallback.mockResolvedValueOnce({
        resposta: '   Resposta com espaços   \n',
        confianca: 85,
        precisa_humano: false,
      });

      const result = await runAtendeAgent({
        userId: 'test-user-123',
        config: {
          businessContext: 'Negócio',
          tone: 'profissional-amigavel',
          confidenceLevel: 'equilibrado',
        },
        message: 'Teste',
      });

      expect(result.reply).toBe('Resposta com espaços');
    });

    it('should use default equilibrado threshold when confidenceLevel is missing', async () => {
      (prisma.atendeKnowledgeBase.findMany as jest.Mock).mockResolvedValueOnce([]);

      callAiWithFallback.mockResolvedValueOnce({
        resposta: 'Resposta',
        confianca: 65, // > 60 (equilibrado)
        precisa_humano: false,
      });

      const result = await runAtendeAgent({
        userId: 'test-user-123',
        config: {
          businessContext: 'Negócio',
          tone: 'profissional-amigavel',
          // confidenceLevel omitted
        },
        message: 'Teste',
      });

      expect(result.needsHuman).toBe(false);
    });

    it('should include contact name in AI prompt when provided', async () => {
      (prisma.atendeKnowledgeBase.findMany as jest.Mock).mockResolvedValueOnce([]);

      callAiWithFallback.mockResolvedValueOnce({
        resposta: 'Olá João!',
        confianca: 90,
        precisa_humano: false,
      });

      await runAtendeAgent({
        userId: 'test-user-123',
        config: {
          businessContext: 'Negócio',
          tone: 'descontraido',
          confidenceLevel: 'equilibrado',
        },
        message: 'Oi!',
        contactName: 'João',
      });

      // Verify AI was called with contact name
      expect(callAiWithFallback).toHaveBeenCalledWith(
        expect.objectContaining({
          user: expect.stringContaining('Nome do cliente: João'),
        }),
      );
    });

    it('should include conversation history in AI prompt when provided', async () => {
      (prisma.atendeKnowledgeBase.findMany as jest.Mock).mockResolvedValueOnce([]);

      callAiWithFallback.mockResolvedValueOnce({
        resposta: 'Continuando...',
        confianca: 85,
        precisa_humano: false,
      });

      const history = 'Cliente: Olá\nBot: Oi!';

      await runAtendeAgent({
        userId: 'test-user-123',
        config: {
          businessContext: 'Negócio',
          tone: 'profissional-amigavel',
          confidenceLevel: 'equilibrado',
        },
        message: 'Qual é o preço?',
        history,
      });

      expect(callAiWithFallback).toHaveBeenCalledWith(
        expect.objectContaining({
          user: expect.stringContaining('Histórico recente da conversa'),
        }),
      );
    });
  });
});
