'use client';
import Script from 'next/script';
import { useEffect, Suspense } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { GA4_ID, GADS_ID, META_PIXEL_ID, analyticsEnabled, trackPageview, trackVisit, trackClick } from '@/lib/analytics';

/**
 * Dispara pageview a cada mudança de rota (Next App Router = SPA).
 * - GA/Pixel (trackPageview): só se houver provedor configurado.
 * - First-party (trackVisit): SEMPRE — alimenta o painel admin, independente de GA.
 */
function PageviewTracker() {
  const pathname = usePathname();
  const search   = useSearchParams();
  useEffect(() => {
    const url = pathname + (search?.toString() ? `?${search}` : '');
    if (analyticsEnabled) trackPageview(url);
    trackVisit(pathname); // só o path (sem query) p/ agrupar bem no painel
  }, [pathname, search]);
  return null;
}

/**
 * Listener delegado de cliques em CTAs principais (marcados com [data-cta]).
 * Captura no nível do documento — pega elementos adicionados dinamicamente.
 */
function CtaClickTracker() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const el = target?.closest?.('[data-cta]') as HTMLElement | null;
      if (!el) return;
      const name = el.getAttribute('data-cta');
      if (name) trackClick(name);
    };
    document.addEventListener('click', onClick, { capture: true });
    return () => document.removeEventListener('click', onClick, { capture: true });
  }, []);
  return null;
}

export default function Analytics() {
  // GA4 e Google Ads compartilham o mesmo gtag.js — carrega uma vez só.
  const gtagId = GA4_ID || GADS_ID;

  return (
    <>
      {gtagId && (
        <>
          <Script
            id="gtag-src"
            strategy="afterInteractive"
            src={`https://www.googletagmanager.com/gtag/js?id=${gtagId}`}
          />
          <Script id="gtag-init" strategy="afterInteractive">
            {`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              ${GA4_ID  ? `gtag('config', '${GA4_ID}', { send_page_view: false });` : ''}
              ${GADS_ID ? `gtag('config', '${GADS_ID}');` : ''}
            `}
          </Script>
        </>
      )}

      {META_PIXEL_ID && (
        <Script id="meta-pixel" strategy="afterInteractive">
          {`
            !function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window,document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', '${META_PIXEL_ID}');
            fbq('track', 'PageView');
          `}
        </Script>
      )}

      <Suspense fallback={null}>
        <PageviewTracker />
      </Suspense>
      <CtaClickTracker />
    </>
  );
}
