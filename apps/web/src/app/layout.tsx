import type { Metadata } from 'next';
import './globals.css';
import SupportWidget from '@/components/SupportWidget';
import { ThemeProvider } from '@/components/ThemeProvider';

export const metadata: Metadata = {
  title: {
    default:  'ZapScript — Transcrição Inteligente de Áudios do WhatsApp',
    template: '%s | ZapScript',
  },
  description: 'Transcrição automática, resumos inteligentes e etiquetas de prioridade para seus áudios do WhatsApp.',
  keywords:    'transcrição whatsapp, transcrição áudio, resumo áudio, ia, inteligência artificial, whatsapp, zapscript',
  metadataBase: new URL('https://zapscript.me'),
  authors:     [{ name: 'ZapScript', url: 'https://zapscript.me' }],
  creator:     'ZapScript',
  robots:      { index: true, follow: true },
  icons: {
    icon:             [{ url: '/icon.svg', type: 'image/svg+xml' }],
    shortcut:         '/icon.svg',
    apple:            '/icon.svg',
  },
  openGraph: {
    title:       'ZapScript — Transcrição Inteligente de Áudios do WhatsApp',
    description: 'Transforme seus áudios do WhatsApp em textos, resumos e insights com IA. Comece grátis.',
    url:         'https://zapscript.me',
    siteName:    'ZapScript',
    locale:      'pt_BR',
    type:        'website',
    images: [{
      url:    '/opengraph-image',
      width:  1200,
      height: 630,
      alt:    'ZapScript — Transcrição Inteligente de Áudios do WhatsApp',
    }],
  },
  twitter: {
    card:        'summary_large_image',
    title:       'ZapScript — Transcrição Inteligente de Áudios do WhatsApp',
    description: 'Transforme seus áudios do WhatsApp em textos, resumos e insights com IA. Comece grátis.',
    images:      ['/opengraph-image'],
  },
};

/* Inline script injected BEFORE first paint — eliminates theme flash */
const themeInitScript = `
(function(){
  try {
    var stored = localStorage.getItem('zs_theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (stored === 'dark' || (!stored && prefersDark)) {
      document.documentElement.classList.add('dark');
    }
  } catch(e){}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        {/* No-flash theme initialiser — must run synchronously before render */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&display=swap" rel="stylesheet" />
        <meta name="theme-color" content="#0c0c12" />
      </head>
      <body className="font-sans bg-brand-bg text-brand-text antialiased" style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}>
        <ThemeProvider>
          {children}
          <SupportWidget />
        </ThemeProvider>
      </body>
    </html>
  );
}
