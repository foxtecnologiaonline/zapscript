// Fonte única da verdade da oferta comercial do Pro.
// Oferta permanente: 1º mês com 50% off (R$19,90), depois R$39,90/mês.
// Substituiu a promo "Junho/2026" de preço fixo com data de expiração.

export const PRO_FULL_PRICE = 'R$39,90';
export const PRO_PROMO_PRICE = 'R$19,90';

/** Desconto do 1º mês está ativo? Oferta permanente — sempre true. */
export function isJunePromoActive(_now: Date = new Date()): boolean {
  return true;
}

/** Preço do Pro a exibir: 1º mês com desconto, sempre. */
export function getProPrice(now: Date = new Date()): string {
  return isJunePromoActive(now) ? PRO_PROMO_PRICE : PRO_FULL_PRICE;
}
