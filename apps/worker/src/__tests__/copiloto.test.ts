/**
 * Testes das funções puras do worker do Copiloto: janela de silêncio (que é o
 * principal freio de ruído) e a renderização da mensagem que o dono recebe.
 *
 * O módulo importa Prisma/BullMQ no topo (registra o worker como side-effect),
 * então mockamos as dependências de infra — o alvo aqui é a lógica, não a fila.
 */

jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn() })),
  Queue: jest.fn().mockImplementation(() => ({ add: jest.fn() })),
}));
jest.mock('../lib/queue', () => ({ redis: {} }));
jest.mock('../lib/prisma', () => ({ prisma: {} }));
jest.mock('../services/evolution', () => ({ sendMessageViaEvolution: jest.fn() }));
jest.mock('../services/copiloto-agent', () => ({ triageConversation: jest.fn(), buildBriefing: jest.fn() }));

import { isQuietNow, renderBriefingMessage } from '../copiloto';

describe('isQuietNow', () => {
  const TZ = 'America/Sao_Paulo';

  // Congela o relógio para uma hora conhecida em São Paulo (UTC-3).
  function atSaoPauloHour(hour: number) {
    const utcHour = (hour + 3) % 24;
    jest.useFakeTimers().setSystemTime(new Date(Date.UTC(2026, 8, 4, utcHour, 30, 0)));
  }

  afterEach(() => jest.useRealTimers());

  it('silencia às 23h na janela que cruza a meia-noite', () => {
    atSaoPauloHour(23);
    expect(isQuietNow('21:00', '07:00', TZ)).toBe(true);
  });

  it('silencia às 3h da manhã', () => {
    atSaoPauloHour(3);
    expect(isQuietNow('21:00', '07:00', TZ)).toBe(true);
  });

  it('não silencia às 14h', () => {
    atSaoPauloHour(14);
    expect(isQuietNow('21:00', '07:00', TZ)).toBe(false);
  });

  it('trata janela normal (sem cruzar meia-noite)', () => {
    atSaoPauloHour(13);
    expect(isQuietNow('12:00', '14:00', TZ)).toBe(true);
    expect(isQuietNow('14:00', '18:00', TZ)).toBe(false);
  });

  it('janela vazia significa sem silêncio', () => {
    atSaoPauloHour(23);
    expect(isQuietNow('09:00', '09:00', TZ)).toBe(false);
  });
});

describe('renderBriefingMessage', () => {
  const briefing = {
    summary: 'Perguntou preço pela 2ª vez e citou concorrente.',
    intent: 'fechar bolo de 2kg para sábado',
    temperature: 'quente',
    riskLevel: 'medio',
    blocker: 'preco',
    note: null,
  };

  const offered = [
    { rank: 1, title: 'Fechar com data', draft: 'Maria, entrego sábado 14h. Fecho?', technique: 'fechamento-assumido' },
    { rank: 2, title: 'Descobrir a real', draft: 'Maria, é pra quantas pessoas?', technique: 'qualificacao' },
  ];

  it('monta o briefing com opções e instruções de resposta', () => {
    const msg = renderBriefingMessage({ contactLabel: 'Maria Souza', briefing, offered, sensitive: false });

    expect(msg).toContain('*Maria Souza*');
    expect(msg).toContain('Perguntou preço pela 2ª vez');
    expect(msg).toContain('*1 · Fechar com data*');
    expect(msg).toContain('⟨fechamento-assumido⟩');
    expect(msg).toContain('trava: preço');
    // Só oferece os números que sobreviveram aos guardrails.
    expect(msg).toContain('*1*, *2*');
    expect(msg).not.toContain('*3*');
  });

  it('avisa sobre sinal delicado', () => {
    const msg = renderBriefingMessage({ contactLabel: 'João', briefing, offered, sensitive: true });
    expect(msg).toContain('Sinal delicado');
  });

  it('sem nenhuma opção aprovada, explica em vez de mandar lista vazia', () => {
    const msg = renderBriefingMessage({ contactLabel: 'João', briefing, offered: [], sensitive: false });
    expect(msg).toContain('Não gerei sugestão segura');
    expect(msg).not.toContain('pra enviar');
  });

  it('mostra a observação quando o certo é não agir agora', () => {
    const msg = renderBriefingMessage({
      contactLabel: 'João',
      briefing: { ...briefing, note: 'Ele disse que retorna segunda — cobrar hoje é ansiedade sua.' },
      offered,
      sensitive: false,
    });
    expect(msg).toContain('retorna segunda');
  });
});
