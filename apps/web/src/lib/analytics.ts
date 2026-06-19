'use client';
/**
 * Camada única de rastreamento de conversão.
 *
 * Dispara os MESMOS eventos de funil para GA4, Google Ads e Meta Pixel,
 * para que cada plataforma otimize entrega para quem realmente converte.
 *
 * Tudo é gated por env vars públicas — se um ID não estiver configurado,
 * aquele provedor simplesmente não carrega (zero erro, zero peso).
 *
 *   NEXT_PUBLIC_GA4_ID        → ex: G-XXXXXXXXXX        (GA4)
 *   NEXT_PUBLIC_GADS_ID       → ex: AW-XXXXXXXXXX       (Google Ads)
 *   NEXT_PUBLIC_GADS_SIGNUP   → label de conversão "cadastro"   (AW-XXX/abc)
 *   NEXT_PUBLIC_GADS_ACTIVATE → label de conversão "ativação"
 *   NEXT_PUBLIC_GADS_SUBSCRIBE→ label de conversão "assinatura"
 *   NEXT_PUBLIC_META_PIXEL_ID → ex: 1234567890          (Meta Pixel)
 */

export const GA4_ID        = process.env.NEXT_PUBLIC_GA4_ID || '';
export const GADS_ID       = process.env.NEXT_PUBLIC_GADS_ID || '';
export const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID || '';

const GADS_LABELS = {
  signup:    process.env.NEXT_PUBLIC_GADS_SIGNUP || '',
  activation:process.env.NEXT_PUBLIC_GADS_ACTIVATE || '',
  subscribe: process.env.NEXT_PUBLIC_GADS_SUBSCRIBE || '',
} as const;

export const analyticsEnabled = Boolean(GA4_ID || GADS_ID || META_PIXEL_ID);

type FunnelEvent = 'signup' | 'activation' | 'subscribe';

// Nomes canônicos por plataforma (semântica padrão de e-commerce/SaaS)
const META_EVENT: Record<FunnelEvent, string> = {
  signup:     'CompleteRegistration',
  activation: 'StartTrial',     // 1ª transcrição = começou a usar de fato
  subscribe:  'Subscribe',
};
const GA4_EVENT: Record<FunnelEvent, string> = {
  signup:     'sign_up',
  activation: 'activation',
  subscribe:  'purchase',
};

declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
    fbq?: (...args: any[]) => void;
    dataLayer?: any[];
  }
}

/** Dispara um evento de funil para todas as plataformas configuradas. */
export function track(event: FunnelEvent, params?: {
  value?: number; currency?: string; transactionId?: string;
  utmSource?: string; utmCampaign?: string; utmMedium?: string;
}) {
  if (typeof window === 'undefined') return;
  const value = params?.value;
  const currency = params?.currency || 'BRL';
  // Dimensões de origem — permitem segmentar conversão por LP/campanha no GA4/Ads
  const utmDims = {
    ...(params?.utmSource   ? { campaign_source:   params.utmSource }   : {}),
    ...(params?.utmCampaign ? { campaign_name:     params.utmCampaign } : {}),
    ...(params?.utmMedium   ? { campaign_medium:   params.utmMedium }   : {}),
  };

  try {
    // GA4
    if (GA4_ID && window.gtag) {
      window.gtag('event', GA4_EVENT[event], {
        ...(value != null ? { value, currency } : {}),
        ...(params?.transactionId ? { transaction_id: params.transactionId } : {}),
        ...utmDims,
      });
    }
    // Google Ads — conversão com label dedicado
    if (GADS_ID && GADS_LABELS[event] && window.gtag) {
      window.gtag('event', 'conversion', {
        send_to: `${GADS_ID}/${GADS_LABELS[event]}`,
        ...(value != null ? { value, currency } : {}),
        ...(params?.transactionId ? { transaction_id: params.transactionId } : {}),
      });
    }
    // Meta Pixel
    if (META_PIXEL_ID && window.fbq) {
      window.fbq('track', META_EVENT[event], {
        ...(value != null ? { value, currency } : {}),
        ...utmDims,
      });
    }
  } catch { /* nunca quebrar a UI por causa de tracking */ }
}

/** Pageview manual (SPA) — chamado a cada mudança de rota. */
export function trackPageview(url: string) {
  if (typeof window === 'undefined') return;
  try {
    if (GA4_ID && window.gtag)        window.gtag('event', 'page_view', { page_path: url });
    if (META_PIXEL_ID && window.fbq)  window.fbq('track', 'PageView');
  } catch { /* noop */ }
}

/**
 * Dispara um evento no máximo uma vez por navegador (guard em localStorage).
 * Usado para "ativação", que é detectada por estado (não por ação pontual).
 */
export function trackOnce(key: string, event: FunnelEvent, params?: Parameters<typeof track>[1]) {
  if (typeof window === 'undefined') return;
  try {
    const flag = `zs_evt_${key}`;
    if (localStorage.getItem(flag)) return;
    localStorage.setItem(flag, '1');
    track(event, params);
  } catch {
    track(event, params); // se localStorage falhar, ainda dispara
  }
}
