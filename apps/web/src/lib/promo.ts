// Fonte única da verdade da oferta comercial do Pro.
// Oferta permanente: 1º mês com 50% off (R$18), depois R$37/mês.
// Substituiu a promo "Junho/2026" de preço fixo com data de expiração.

export const PRO_FULL_PRICE = 'R$37';
export const PRO_PROMO_PRICE = 'R$18';

/** Desconto do 1º mês está ativo? Oferta permanente — sempre true. */
export function isJunePromoActive(_now: Date = new Date()): boolean {
  return true;
}

/** Preço do Pro a exibir: 1º mês com desconto, sempre. */
export function getProPrice(now: Date = new Date()): string {
  return isJunePromoActive(now) ? PRO_PROMO_PRICE : PRO_FULL_PRICE;
}

/* ─────────────────────────────────────────────────────────────────────────
   Âncora de preço — token padronizado de CTA.
   Regra: nunca exibir "R$37" puro num CTA. Sempre emoldurar o valor em
   algo cotidiano e barato. R$37/mês ÷ 30 = ~R$1,23/dia.
   ───────────────────────────────────────────────────────────────────────── */

/** Custo diário equivalente do Pro (R$37/mês ÷ 30). */
export const PRO_PER_DAY = 'R$1,23/dia';

/** Variantes de âncora para A/B. A ordem é o índice persistido por visitante. */
export const PRICE_ANCHORS = [
  { key: 'dia',           label: 'menos de R$1,23 por dia' },
  { key: 'cafe',          label: 'menos que um café por semana' },
  { key: 'estacionamento',label: 'menos que 1 hora de estacionamento' },
] as const;

export type PriceAnchorKey = (typeof PRICE_ANCHORS)[number]['key'];

/** Âncora comparativa (valor do tempo > preço). */
export const PRICE_ANCHOR_COMPARE = 'Uma hora ouvindo áudio vale mais que R$1,23?';
