import type { Metadata } from 'next';
import { Space_Grotesk, DM_Sans } from 'next/font/google';
import './globals.css';

/* next/font: self-hosted no build, sem requisição externa a fonts.googleapis.com
   (era render-blocking — impactava LCP mobile). Mesmos pesos que já eram carregados. */
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-space-grotesk',
  display: 'swap',
});
const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-dm-sans',
  display: 'swap',
});
import SupportWidget from '@/components/SupportWidget';
import { ThemeProvider } from '@/components/ThemeProvider';
import Analytics from '@/components/Analytics';
import UtmCapture from '@/components/UtmCapture';
import BreadcrumbServer from '@/components/BreadcrumbServer';
import SocialProofToast from '@/components/SocialProofToast';

export const metadata: Metadata = {
  title: {
    default:  'ZapScript WhatsApp — Conversão Inteligente de Áudios do WhatsApp',
    // "WhatsApp" no template ajuda o Google a desambiguar a marca de
    // zapscript.net (autopeças) e zaparoo.org (scripting tool), que hoje
    // dominam a busca pelo nome "ZapScript" isolado.
    template: '%s | ZapScript WhatsApp',
  },
  description: 'Converta áudios do WhatsApp em texto e resumo com IA. Grátis para começar. Para corretores, advogados e vendedores.',
  keywords:    'converter áudio whatsapp, transcrição whatsapp automática, resumo áudio ia, zapscript, whatsapp texto, converter áudio celular, transcrever áudio whatsapp grátis, conversão automática whatsapp, mensagem de voz texto, áudio para texto online, passar áudio para texto, ler áudio whatsapp, ia whatsapp, chatbot whatsapp ia, atendimento automático whatsapp',
  metadataBase: new URL('https://www.zapscript.me'),
  alternates: {
    canonical: 'https://www.zapscript.me',
    languages: { 'pt-BR': 'https://www.zapscript.me' },
  },
  authors:     [{ name: 'ZapScript', url: 'https://www.zapscript.me' }],
  creator:     'ZapScript',
  robots:      { index: true, follow: true },
  icons: {
    icon:    [{ url: '/icon.png', type: 'image/png' }],
    shortcut: '/icon.png',
    apple:    '/icon.png',
  },
  openGraph: {
    title:       'ZapScript — Conversão Inteligente de Áudios do WhatsApp',
    description: 'Transforme seus áudios do WhatsApp em textos, resumos e insights com IA. Comece grátis.',
    url:         'https://www.zapscript.me',
    siteName:    'ZapScript',
    locale:      'pt_BR',
    type:        'website',
    images: [{
      url:    '/opengraph-image',
      width:  1200,
      height: 630,
      alt:    'ZapScript — Conversão Inteligente de Áudios do WhatsApp',
    }],
  },
  twitter: {
    card:        'summary_large_image',
    title:       'ZapScript — Conversão Inteligente de Áudios do WhatsApp',
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

/* ── JSON-LD Organization + WebSite (global, injetado no <head>) ───── */
const orgSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'ZapScript',
  alternateName: ['ZapScript.me', 'ZapScript WhatsApp'],
  url: 'https://www.zapscript.me',
  logo: 'https://www.zapscript.me/logo.png',
  sameAs: [
    'https://linkedin.com/in/zapscript',
  ],
  foundingDate: '2025',
  founder: {
    '@type': 'Person',
    name: 'Roberto',
    jobTitle: 'Founder & Tech Lead',
  },
  contactPoint: {
    '@type': 'ContactPoint',
    email: 'contato@zapscript.me',
    contactType: 'customer support',
    availableLanguage: ['Portuguese'],
  },
  description: 'ZapScript converte automaticamente áudios do WhatsApp em texto e resumo com IA. Conecta no seu próprio número via QR Code — sem encaminhar, sem ouvir.',
};

const webSiteSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'ZapScript',
  url: 'https://www.zapscript.me',
  inLanguage: 'pt-BR',
  description: 'Conversão automática de áudios do WhatsApp em texto e resumo com IA.',
  potentialAction: {
    '@type': 'SearchAction',
    target: {
      '@type': 'EntryPoint',
      urlTemplate: 'https://www.zapscript.me/buscar?q={search_term_string}',
    },
    'query-input': 'required name=search_term_string',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${spaceGrotesk.variable} ${dmSans.variable}`}>
      <head>
        {/* No-flash theme initialiser — must run synchronously before render */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {/* JSON-LD Structured Data — Organization + WebSite (Knowledge Graph, sitelinks) */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(orgSchema) }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(webSiteSchema) }} />
        {/* hreflang — sinaliza ao Google o público-alvo (Brasil, português) */}
        <link rel="alternate" href="https://www.zapscript.me" hrefLang="pt-BR" />
        <link rel="alternate" href="https://www.zapscript.me" hrefLang="x-default" />
        <meta name="theme-color" content="#0c0c12" />
        <meta name="copyright" content="© 2026 ZapScript / FOX TecnologIA. Todos os direitos reservados." />
        <meta name="author" content="ZapScript — zapscript.me" />
        {/* BreadcrumbList JSON-LD dinâmico (SSR) — renderiza com base na URL atual */}
        <BreadcrumbServer />
      </head>
      <body className="font-sans bg-brand-bg text-brand-text antialiased">
        <ThemeProvider>
          {children}
          <SupportWidget />
          <SocialProofToast />
        </ThemeProvider>
        <Analytics />
        <UtmCapture />
      </body>
    </html>
  );
}
