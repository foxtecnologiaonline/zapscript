// Fonte única da verdade da promoção de lançamento.
// Oferta de junho/2026: 1º mês do Pro por R$19,90 (depois R$39,90/mês).
// Encerra 30/06/2026 23:59:59 (horário de Brasília, UTC-3).

export const PRO_FULL_PRICE = 'R$39,90';
export const PRO_PROMO_PRICE = 'R$19,90';
export const PROMO_END = new Date('2026-06-30T23:59:59-03:00').getTime();

/** Promoção de junho está ativa? (avaliado no momento da chamada) */
export function isJunePromoActive(now: Date = new Date()): boolean {
  return now.getTime() <= PROMO_END;
}

/** Preço do Pro a exibir: promocional enquanto a oferta estiver ativa, senão cheio. */
export function getProPrice(now: Date = new Date()): string {
  return isJunePromoActive(now) ? PRO_PROMO_PRICE : PRO_FULL_PRICE;
}
