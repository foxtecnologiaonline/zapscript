'use client';

/* ─────────────────────────────────────────────────────────────────
   PriceAnchor — token de preço padronizado para CTAs.

   Nunca exibe "R$39,90" puro: emoldura o valor em algo cotidiano e
   barato (café/dia/estacionamento) e faz A/B entre as 3 molduras,
   estável por visitante. A variante é reportada no analytics
   first-party para medir qual converte melhor.

   <PriceAnchor />                         → "menos de R$1,33 por dia"
   <PriceAnchor prefix="Continue por " />  → "Continue por menos de R$1,33 por dia"
   <PriceAnchor compare />                 → também mostra a âncora comparativa
─────────────────────────────────────────────────────────────── */

import { useEffect, useState } from 'react';
import { PRICE_ANCHORS, PRICE_ANCHOR_COMPARE } from '@/lib/promo';
import { pickVariant, trackClick } from '@/lib/analytics';

export default function PriceAnchor({
  prefix = '',
  suffix = '',
  compare = false,
  className = '',
  compareClassName = '',
}: {
  prefix?: string;
  suffix?: string;
  compare?: boolean;
  className?: string;
  compareClassName?: string;
}) {
  // SSR/1ª render usa a 1ª variante (R$1,33/dia) p/ evitar flash/hidratação divergente.
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const i = pickVariant('price_anchor', PRICE_ANCHORS.length);
    setIdx(i);
    // impressão da variante (uma vez por visitante por sessão de montagem)
    try { trackClick(`price_anchor_view:${PRICE_ANCHORS[i].key}`); } catch { /* noop */ }
  }, []);

  const label = PRICE_ANCHORS[idx]?.label ?? PRICE_ANCHORS[0].label;

  return (
    <span className={className}>
      {prefix}
      <span className="font-semibold">{label}</span>
      {suffix}
      {compare && (
        <span className={compareClassName || 'block text-sm text-brand-muted mt-1'}>
          {PRICE_ANCHOR_COMPARE}
        </span>
      )}
    </span>
  );
}
