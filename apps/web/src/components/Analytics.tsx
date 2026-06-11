'use client';
import Script from 'next/script';
import { useEffect, Suspense } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { GA4_ID, GADS_ID, META_PIXEL_ID, analyticsEnabled, trackPageview } from '@/lib/analytics';

/** Dispara pageview a cada mudança de rota (Next App Router = SPA). */
function PageviewTracker() {
  const pathname = usePathname();
  const search   = useSearchParams();
  useEffect(() => {
    const url = pathname + (search?.toString() ? `?${search}` : '');
    trackPageview(url);
  }, [pathname, search]);
  return null;
}

export default function Analytics() {
  if (!analyticsEnabled) return null;

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
    </>
  );
}
