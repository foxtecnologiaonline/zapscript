/**
 * Testes do guardrail determinístico do ZapScript ZapScreve
 * (ESCOPO_ZAPSCREVE.md §9): o modo rápido só pode mexer em FORMA — se o
 * refino (IA) mudar um número (preço/prazo/quantidade) ou cortar/inflar
 * demais o texto, a saída não é confiável e cai pro texto bruto do Whisper.
 *
 * O módulo importa BullMQ/Prisma/etc. no topo (registra o worker como
 * side-effect ao ser importado, igual copiloto.ts) — mockamos toda a infra,
 * o alvo aqui é só a lógica pura do guardrail.
 */
jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn() })),
}));
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => ({})) }));
jest.mock('ws', () => ({}));
jest.mock('../lib/queue', () => ({ redis: {} }));
jest.mock('../lib/prisma', () => ({ prisma: { zapScreveDraft: { update: jest.fn() } } }));
jest.mock('../lib/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../services/whisper', () => ({ transcribeAudio: jest.fn() }));
jest.mock('../services/audio', () => ({ convertToMp3: jest.fn() }));
jest.mock('../services/ai-fallback', () => ({
  buildModelChain: jest.fn(() => []),
  callAiWithFallback: jest.fn(),
}));

import { passesEntityGuardrail } from '../zapscreve';

describe('passesEntityGuardrail', () => {
  it('aceita quando só a forma muda e os números batem', () => {
    const raw = 'oi tudo bem eu queria confirmar pra amanha as 15h';
    const refined = 'Oi, tudo bem? Eu queria confirmar para amanhã às 15h.';
    expect(passesEntityGuardrail(raw, refined)).toBe(true);
  });

  it('rejeita quando um número muda (preço alterado)', () => {
    const raw = 'fica R$ 150 pra sexta';
    const refined = 'Fica R$ 200 para sexta.';
    expect(passesEntityGuardrail(raw, refined)).toBe(false);
  });

  it('rejeita quando um número some', () => {
    const raw = 'pode ser 15h ou 16h';
    const refined = 'Pode ser 16h.';
    expect(passesEntityGuardrail(raw, refined)).toBe(false);
  });

  it('rejeita quando dois números trocam de lugar (mesmo conjunto, ordem errada)', () => {
    // Comparar como multiset ordenado deixaria passar — {100, 5} é igual nos
    // dois lados. O guardrail precisa comparar NA ORDEM em que aparecem.
    const raw = 'fica R$100, entrego em 5 dias';
    const refined = 'Fica R$5, entrego em 100 dias.';
    expect(passesEntityGuardrail(raw, refined)).toBe(false);
  });

  it('rejeita texto refinado vazio', () => {
    expect(passesEntityGuardrail('oi tudo bem', '')).toBe(false);
    expect(passesEntityGuardrail('oi tudo bem', '   ')).toBe(false);
  });

  it('rejeita quando o texto encolhe demais (sinal de corte de conteúdo)', () => {
    const raw = 'Bom dia, eu queria saber se ainda tem vaga pra amanhã de manhã, por volta das 9h, porque eu preciso resolver uma coisa urgente antes.';
    const refined = 'Bom dia.';
    expect(passesEntityGuardrail(raw, refined)).toBe(false);
  });

  it('rejeita quando o texto cresce demais (sinal de conteúdo inventado)', () => {
    const raw = 'Eu chego lá umas 10h, tá bom?';
    const bloated = 'Bom dia! Eu queria avisar que, conforme a gente já tinha combinado antes, eu devo chegar por volta das 10 horas da manhã, então já fica de aviso, tudo bem pra você?';
    expect(passesEntityGuardrail(raw, bloated)).toBe(false);
  });
});
