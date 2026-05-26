/* ──────────────────────────────────────────────────────────
   Proration — cálculo de cobrança proporcional em upgrades
   ────────────────────────────────────────────────────────── */

export interface ProrateResult {
  /** Valor a cobrar agora (diferença proporcional) */
  proratedAmount: number;
  /** Dias restantes no ciclo atual */
  remainingDays: number;
  /** Dias totais usados no cálculo (30) */
  totalDays: number;
  /** true quando proratedAmount >= R$1,00 (mínimo Asaas) */
  shouldCharge: boolean;
}

/**
 * Calcula o valor proporcional de um upgrade de plano.
 *
 * Fórmula:
 *   proratedAmount = (newPrice - currentPrice) * (remainingDays / 30)
 *
 * @param currentMonthlyPrice  Preço mensal do plano atual (R$)
 * @param newMonthlyPrice      Preço mensal do plano destino (R$)
 * @param currentPeriodEnd     Data de fim do ciclo atual (ou null)
 */
export function calculateProration(
  currentMonthlyPrice: number,
  newMonthlyPrice: number,
  currentPeriodEnd: Date | null,
): ProrateResult {
  const TOTAL_DAYS   = 30;
  const MIN_CHARGE   = 1.00; // Asaas não aceita cobranças abaixo de R$1,00

  if (!currentPeriodEnd) {
    // Sem ciclo definido → cobra o preço completo do novo plano
    return {
      proratedAmount: newMonthlyPrice,
      remainingDays:  TOTAL_DAYS,
      totalDays:      TOTAL_DAYS,
      shouldCharge:   true,
    };
  }

  const now           = new Date();
  const msPerDay      = 24 * 60 * 60 * 1000;
  const remainingMs   = currentPeriodEnd.getTime() - now.getTime();
  const remainingDays = Math.max(0, Math.ceil(remainingMs / msPerDay));

  const dailyDiff      = (newMonthlyPrice - currentMonthlyPrice) / TOTAL_DAYS;
  const raw            = dailyDiff * remainingDays;
  const proratedAmount = Math.round(Math.max(0, raw) * 100) / 100; // arredonda para centavos

  return {
    proratedAmount,
    remainingDays,
    totalDays:   TOTAL_DAYS,
    shouldCharge: proratedAmount >= MIN_CHARGE,
  };
}

/** Formata valor em BRL para exibição (ex: "R$ 24,00") */
export function fmtBrl(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
