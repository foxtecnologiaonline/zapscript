/**
 * Testes dos guardrails do Copiloto.
 *
 * Cobre o que decide se uma sugestão pode ou não chegar ao dono: preço/percentual
 * inventado (o pior erro possível — é preço dito em nome do negócio do cliente),
 * urgência fabricada, o agente se anunciando como robô, e os falsos positivos
 * que NÃO podem acontecer em conversa normal de WhatsApp.
 */

import { validateDraft, isOptOut, hasVulnerabilitySignal } from '../services/copiloto-guardrails';

const ctx = {
  allowedText: [
    'Bolo de festa 2kg sai por R$ 180,00 com entrega inclusa.',
    'Cliente: qual o valor do bolo de 2kg?',
    'Damos 10% de desconto para pagamento à vista.',
  ].join('\n'),
};

describe('validateDraft — ancoragem de valores', () => {
  it('aceita valor que existe no contexto', () => {
    const r = validateDraft('Maria, o bolo de 2kg sai R$ 180,00 com entrega. Fecho pra você?', ctx);
    expect(r.ok).toBe(true);
    expect(r.violations).toHaveLength(0);
  });

  it('bloqueia valor que a IA inventou', () => {
    const r = validateDraft('Maria, consigo fazer por R$ 150,00 pra você fechar hoje.', ctx);
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.includes('150'))).toBe(true);
  });

  it('aceita percentual que existe no contexto', () => {
    const r = validateDraft('À vista você tem 10% de desconto.', ctx);
    expect(r.ok).toBe(true);
  });

  it('bloqueia desconto inventado', () => {
    const r = validateDraft('Te dou 30% de desconto se fechar agora.', ctx);
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.includes('30%'))).toBe(true);
  });

  it('entende "reais" por extenso como valor', () => {
    const r = validateDraft('Fica 220 reais.', ctx);
    expect(r.ok).toBe(false);
  });

  it('não confunde data e horário com valor', () => {
    const r = validateDraft('Maria, entrego quinta, dia 12, às 14h. Confirmo?', ctx);
    expect(r.ok).toBe(true);
  });
});

describe('validateDraft — urgência e escassez', () => {
  it('bloqueia "só hoje"', () => {
    expect(validateDraft('Essa condição é só hoje, viu?', ctx).ok).toBe(false);
  });

  it('bloqueia "últimas vagas"', () => {
    expect(validateDraft('Corre que são as últimas vagas da semana.', ctx).ok).toBe(false);
  });

  it('bloqueia promessa absoluta', () => {
    expect(validateDraft('É 100% garantido, sem risco nenhum.', ctx).ok).toBe(false);
  });

  // Falso positivo que quebraria o produto em conversa normal.
  it('NÃO bloqueia "vi só agora"', () => {
    const r = validateDraft('Oi Maria, desculpa, vi só agora sua mensagem!', ctx);
    expect(r.ok).toBe(true);
  });
});

describe('validateDraft — o rascunho é do dono, não de um robô', () => {
  it('bloqueia menção a IA', () => {
    expect(validateDraft('Sou uma IA e vou te ajudar.', ctx).ok).toBe(false);
  });

  it('bloqueia "atendente virtual"', () => {
    expect(validateDraft('Aqui é o atendente virtual da loja.', ctx).ok).toBe(false);
  });

  it('rejeita rascunho vazio', () => {
    expect(validateDraft('   ', ctx).ok).toBe(false);
  });
});

describe('isOptOut', () => {
  it.each([
    'não quero mais receber',
    'para de mandar mensagem',
    'me tira dessa lista',
    'não me mande mais nada',
  ])('detecta recusa: %s', (text) => {
    expect(isOptOut(text)).toBe(true);
  });

  it('não confunde recusa de compra com recusa de contato', () => {
    expect(isOptOut('não quero o de 2kg, prefiro o menor')).toBe(false);
  });
});

describe('hasVulnerabilitySignal', () => {
  it('detecta luto', () => {
    expect(hasVulnerabilitySignal('meu pai faleceu ontem, vou precisar adiar')).toBe(true);
  });

  it('detecta aperto financeiro', () => {
    expect(hasVulnerabilitySignal('estou desempregado no momento')).toBe(true);
  });

  it('não dispara em conversa comum', () => {
    expect(hasVulnerabilitySignal('quero encomendar um bolo para sábado')).toBe(false);
  });
});
