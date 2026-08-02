import {
  PLAN_PRICING,
  PaidPlanName,
  annualFreeMonths,
  annualMonthlyEquivalent,
  resolveDisplayPrice,
} from '@/lib/planPricing';

const PLAN_NAMES = Object.keys(PLAN_PRICING) as PaidPlanName[];

describe('resolveDisplayPrice — preço exibido no checkout', () => {
  it.each(PLAN_NAMES)('ciclo mensal mostra o preço de aluguel de %s', (name) => {
    expect(resolveDisplayPrice(name, 'monthly', 'fallback')).toBe(PLAN_PRICING[name].monthly);
  });

  it.each(PLAN_NAMES)('ciclo anual mostra o preço de compra de %s (nunca o mensal)', (name) => {
    const price = resolveDisplayPrice(name, 'yearly', 'fallback');
    expect(price).toBe(PLAN_PRICING[name].annual);
    expect(price).not.toBe(PLAN_PRICING[name].monthly);
  });

  it('plano desconhecido usa o fallback', () => {
    expect(resolveDisplayPrice('inexistente', 'yearly', 'R$0')).toBe('R$0');
  });
});

describe('annualMonthlyEquivalent — equivalente mensal do plano anual', () => {
  it.each(PLAN_NAMES)('%s é sempre annualNum/12, nunca o preço de aluguel', (name) => {
    const { monthlyNum, annualNum } = PLAN_PRICING[name];
    const expected = `R$${Math.floor(annualNum / 12)}/mês`;
    expect(annualMonthlyEquivalent(name)).toBe(expected);
    // regressão: profissional/empresas já mostraram por engano o preço de
    // aluguel (R$49, R$99) em vez do equivalente anual real, bem mais baixo.
    expect(annualMonthlyEquivalent(name)).not.toBe(`R$${monthlyNum}/mês`);
  });
});

describe('annualFreeMonths — meses "grátis" reais da compra anual', () => {
  it('pro e executive equivalem a ~2 meses grátis', () => {
    expect(annualFreeMonths('pro')).toBe(2);
    expect(annualFreeMonths('executive')).toBe(2);
  });

  it('profissional e empresas equivalem a ~6 meses grátis (desconto bem maior)', () => {
    expect(annualFreeMonths('profissional')).toBe(6);
    expect(annualFreeMonths('empresas')).toBe(6);
  });
});
