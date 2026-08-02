// Fonte única dos preços de aluguel (mensal) e compra (anual) dos planos
// pagos — consumida por dashboard/plano/page.tsx e CheckoutInline.tsx.
// Antes esses dois arquivos mantinham cópias separadas, o que já causou uma
// divergência real de preço exibido no checkout. Espelha PLAN_PRICES em
// apps/api/src/routes/billing.ts — qualquer mudança de preço real precisa
// ser replicada lá (fonte de verdade da cobrança).
export type PaidPlanName = 'pro' | 'executive' | 'profissional' | 'empresas';

export interface PlanPricing {
  monthly:    string;  // preço de aluguel mensal, ex. 'R$37'
  monthlyNum: number;
  annual:     string;  // preço de compra anual, ex. 'R$355'
  annualNum:  number;
}

export const PLAN_PRICING: Record<PaidPlanName, PlanPricing> = {
  pro:          { monthly: 'R$37', monthlyNum: 37, annual: 'R$355', annualNum: 355 },
  executive:    { monthly: 'R$67', monthlyNum: 67, annual: 'R$643', annualNum: 643 },
  profissional: { monthly: 'R$49', monthlyNum: 49, annual: 'R$295', annualNum: 295 },
  empresas:     { monthly: 'R$99', monthlyNum: 99, annual: 'R$595', annualNum: 595 },
};

export function isPaidPlanName(name: string): name is PaidPlanName {
  return name in PLAN_PRICING;
}

/** Equivalente mensal do plano anual, sempre derivado do preço anual real
 *  (evita o bug de reusar por engano o valor do aluguel mensal). */
export function annualMonthlyEquivalent(name: PaidPlanName): string {
  return `R$${Math.floor(PLAN_PRICING[name].annualNum / 12)}/mês`;
}

/** Quantos meses a compra anual "dá de graça" frente a 12x o aluguel mensal. */
export function annualFreeMonths(name: PaidPlanName): number {
  const { monthlyNum, annualNum } = PLAN_PRICING[name];
  return Math.round(12 - annualNum / monthlyNum);
}

export function annualFreeMonthsLabel(name: PaidPlanName): string {
  const months = annualFreeMonths(name);
  return `${months} ${months === 1 ? 'mês grátis' : 'meses grátis'}`;
}

/** Preço de exibição de acordo com o ciclo escolhido (aluguel/compra). */
export function resolveDisplayPrice(name: string, cycle: 'monthly' | 'yearly', fallbackMonthly: string): string {
  const pricing = isPaidPlanName(name) ? PLAN_PRICING[name] : undefined;
  if (!pricing) return fallbackMonthly;
  return cycle === 'yearly' ? pricing.annual : pricing.monthly;
}
