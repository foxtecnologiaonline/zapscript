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
jest.mock('../lib/prisma', () => ({
  prisma: { copilotoBriefing: { findMany: jest.fn(), update: jest.fn() } },
}));
jest.mock('../services/evolution', () => ({ sendMessageViaEvolution: jest.fn() }));
jest.mock('../services/copiloto-agent', () => ({ triageConversation: jest.fn(), buildBriefing: jest.fn() }));

import { prisma } from '../lib/prisma';
import { isQuietNow, renderBriefingMessage, renderReplyFooter, readMinConfidence, assignPendingLabel } from '../copiloto';

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
    { rank: 1, axis: 'avancar', title: 'Fechar com data', draft: 'Maria, entrego sábado 14h. Fecho?', technique: 'fechamento-assumido' },
    { rank: 2, axis: 'qualificar', title: 'Descobrir a real', draft: 'Maria, é pra quantas pessoas?', technique: 'qualificacao' },
  ];

  it('monta o briefing com opções e instruções de resposta', () => {
    const msg = renderBriefingMessage({ contactLabel: 'Maria Souza', briefing, offered, sensitive: false });

    expect(msg).toContain('*Maria Souza*');
    expect(msg).toContain('Perguntou preço pela 2ª vez');
    // Rótulo é o eixo fixo, não o título livre da IA nem a técnica.
    expect(msg).toContain('*1 · Avançar*');
    expect(msg).toContain('*2 · Qualificar*');
    expect(msg).not.toContain('Fechar com data');
    expect(msg).not.toContain('⟨fechamento-assumido⟩');
    // Temperatura/risco/trava saíram da mensagem — ficam só no banco/site.
    expect(msg).not.toContain('trava: preço');
    // Só oferece os números que sobreviveram aos guardrails.
    expect(msg).toContain('*1*, *2*');
    expect(msg).not.toContain('*3*');
  });

  it('avisa sobre sinal delicado', () => {
    const msg = renderBriefingMessage({ contactLabel: 'João', briefing, offered, sensitive: true });
    expect(msg).toContain('🕊️');
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

  it('inclui a citação verbatim do cliente, truncada', () => {
    const longQuote = 'a'.repeat(200);
    const msg = renderBriefingMessage({ contactLabel: 'Maria', lastQuote: longQuote, briefing, offered, sensitive: false });
    expect(msg).toContain('a'.repeat(139) + '…');
    expect(msg).not.toContain('a'.repeat(141));
  });

  it('omite o rodapé de resposta quando footer:false (compilação de rajada)', () => {
    const msg = renderBriefingMessage({ contactLabel: 'Maria', briefing, offered, sensitive: false, footer: false });
    expect(msg).not.toContain('envia');
    expect(msg).not.toContain('*1*, *2*');
  });
});

describe('renderReplyFooter', () => {
  it('lista os números oferecidos e as instruções de editar/ignorar', () => {
    const footer = renderReplyFooter([1, 2, 3]);
    expect(footer).toBe('*1*, *2*, *3* envia · *1e* edita · *0* ignora');
  });

  it('v2.1: com letra, prefixa cada número (inclusive o 0 de ignorar)', () => {
    const footer = renderReplyFooter([1, 2, 3], 'B');
    expect(footer).toBe('*B1*, *B2*, *B3* envia · *B1e* edita · *B0* ignora');
  });

  it('v2.1: label undefined/null se comporta como sem letra', () => {
    expect(renderReplyFooter([1, 2], null)).toBe(renderReplyFooter([1, 2]));
    expect(renderReplyFooter([1, 2], undefined)).toBe(renderReplyFooter([1, 2]));
  });
});

describe('renderBriefingMessage — pendingLabel/otherPending (v2.1)', () => {
  const briefing = {
    summary: 'Perguntou preço.',
    intent: 'fechar',
    temperature: 'quente',
    riskLevel: 'baixo',
    blocker: null,
    note: null,
  };
  const offered = [
    { rank: 1, axis: 'avancar', title: 'Fechar com data', draft: 'Oi, fecho?', technique: 'fechamento-assumido' },
  ];

  it('sem pendingLabel, opções e rodapé saem sem letra (comportamento v1 preservado)', () => {
    const msg = renderBriefingMessage({ contactLabel: 'Maria', briefing, offered, sensitive: false });
    expect(msg).toContain('*1 · Avançar*');
    expect(msg).toContain('*1e* edita');
    expect(msg).not.toMatch(/\*[A-Z]1 ·/);
  });

  it('com pendingLabel, prefixa a opção e o rodapé com a letra', () => {
    const msg = renderBriefingMessage({ contactLabel: 'Maria', briefing, offered, sensitive: false, pendingLabel: 'A' });
    expect(msg).toContain('*A1 · Avançar*');
    expect(msg).toContain('*A1* envia · *A1e* edita · *A0* ignora');
  });

  it('com otherPending, adiciona nota explicando a letra das outras conversas', () => {
    const msg = renderBriefingMessage({
      contactLabel: 'Maria',
      briefing,
      offered,
      sensitive: false,
      pendingLabel: 'B',
      otherPending: [{ label: 'A', contactLabel: 'Diogo Borges' }],
    });
    expect(msg).toContain('Você também tem pendente: A — Diogo Borges');
    expect(msg).toContain('ex.: A1');
  });

  it('sem otherPending, não adiciona a nota', () => {
    const msg = renderBriefingMessage({ contactLabel: 'Maria', briefing, offered, sensitive: false, pendingLabel: 'A' });
    expect(msg).not.toContain('também tem pendente');
  });
});

describe('readMinConfidence — piso de confiança por tipo (v2.1)', () => {
  it('lê o valor do tipo quando configurado', () => {
    expect(readMinConfidence({ oportunidade: 70 }, 'oportunidade')).toBe(70);
  });

  it('retorna null quando o tipo não está no mapa', () => {
    expect(readMinConfidence({ oportunidade: 70 }, 'pessoal')).toBeNull();
  });

  it('retorna null sem config nenhuma', () => {
    expect(readMinConfidence(null, 'comercial')).toBeNull();
    expect(readMinConfidence(undefined, 'comercial')).toBeNull();
  });

  it('retorna null sem tipo (triagem não classificou)', () => {
    expect(readMinConfidence({ comercial: 50 }, null)).toBeNull();
  });

  it('ignora valor não numérico (config corrompida não trava tudo)', () => {
    expect(readMinConfidence({ comercial: 'alto' }, 'comercial')).toBeNull();
    expect(readMinConfidence('nao-e-objeto', 'comercial')).toBeNull();
  });
});

describe('assignPendingLabel (v2.1)', () => {
  const mockFindMany = prisma.copilotoBriefing.findMany as jest.Mock;
  const mockUpdate = prisma.copilotoBriefing.update as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdate.mockResolvedValue({});
  });

  it('sem nenhuma pendência existente (1ª do número), não atribui letra', async () => {
    mockFindMany.mockResolvedValue([]);
    const { label, otherPending } = await assignPendingLabel('number-1');
    expect(label).toBeNull();
    expect(otherPending).toEqual([]);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('com 1 pendência existente sem letra ainda, atribui A a ela e B ao novo', async () => {
    mockFindMany.mockResolvedValue([
      { id: 'b-old', pendingLabel: null, conversation: { contactName: 'Diogo Borges', contactPhone: '5511111111111' } },
    ]);
    const { label, otherPending } = await assignPendingLabel('number-1');
    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: 'b-old' }, data: { pendingLabel: 'A' } });
    expect(otherPending).toEqual([{ label: 'A', contactLabel: 'Diogo Borges' }]);
    expect(label).toBe('B');
  });

  it('nunca realoca uma letra já atribuída — só preenche o que falta', async () => {
    mockFindMany.mockResolvedValue([
      { id: 'b-a', pendingLabel: 'A', conversation: { contactName: 'Victor', contactPhone: '5511222222222' } },
      { id: 'b-sem-letra', pendingLabel: null, conversation: { contactName: 'Ana', contactPhone: '5511333333333' } },
    ]);
    const { label, otherPending } = await assignPendingLabel('number-1');
    // 'A' já usado — não deve ser reatribuído a ninguém, nem tocado via update.
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: 'b-sem-letra' }, data: { pendingLabel: 'B' } });
    expect(otherPending).toEqual([
      { label: 'A', contactLabel: 'Victor' },
      { label: 'B', contactLabel: 'Ana' },
    ]);
    expect(label).toBe('C');
  });

  it('usa o telefone quando não há contactName', async () => {
    mockFindMany.mockResolvedValue([
      { id: 'b-old', pendingLabel: 'A', conversation: { contactName: null, contactPhone: '5511444444444' } },
    ]);
    const { otherPending } = await assignPendingLabel('number-1');
    expect(otherPending).toEqual([{ label: 'A', contactLabel: '5511444444444' }]);
  });
});
