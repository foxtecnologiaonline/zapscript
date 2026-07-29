// Fonte única da verdade da oferta comercial do Pro (plano LEGADO — não
// vendido a usuários novos, mas ainda suportado para quem já assina; usado
// hoje só no fluxo de troca de plano em dashboard/plano/page.tsx).
// Oferta permanente: 1º mês com 50% off (R$18), depois R$37/mês.
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
   ZapScript 2.0 — tiers atuais (Core/Profissional/Empresas). Preço citado
   no marketing público (LP, home, funil de cadastro). Espelha
   PLAN_PRICES/PLAN_PRICES_YEARLY em apps/api/src/routes/billing.ts.
   Sem oferta de 1º mês — preço flat, "aluguel" (mensal) ou "compra" (anual).
   ───────────────────────────────────────────────────────────────────────── */
export const CORE_AUDIO_QUOTA = 100; // espelha FREE_AUDIO_QUOTA (seed.ts)

export const PROFISSIONAL_PRICE_MONTHLY = 'R$49';
export const PROFISSIONAL_PRICE_YEARLY = 'R$295';

export const EMPRESAS_PRICE_MONTHLY = 'R$99';
export const EMPRESAS_PRICE_YEARLY = 'R$595';

/* ─────────────────────────────────────────────────────────────────────────
   Âncora de preço — token padronizado de CTA.
   Regra: nunca exibir "R$49" puro num CTA. Sempre emoldurar o valor em
   algo cotidiano e barato. R$49/mês ÷ 30 ≈ R$1,63/dia (Profissional).
   ───────────────────────────────────────────────────────────────────────── */

/** Variantes de âncora para A/B. A ordem é o índice persistido por visitante. */
export const PRICE_ANCHORS = [
  { key: 'dia',           label: 'menos de R$1,63 por dia' },
  { key: 'cafe',          label: 'menos que um café por semana' },
  { key: 'estacionamento',label: 'menos que 1 hora de estacionamento' },
] as const;

export type PriceAnchorKey = (typeof PRICE_ANCHORS)[number]['key'];

/** Âncora comparativa (valor do tempo > preço). */
export const PRICE_ANCHOR_COMPARE = 'Uma hora ouvindo áudio vale mais que R$1,63?';
