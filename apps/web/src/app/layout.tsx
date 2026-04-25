import type { Metadata } from 'next';
import './globals.css';
import SupportWidget from '@/components/SupportWidget';

export const metadata: Metadata = {
  title:       'ZapScript — Transcrição Inteligente de Áudios do WhatsApp',
  description: 'Transcrição automática, resumos inteligentes e etiquetas de prioridade para seus áudios do WhatsApp.',
  keywords:    'transcrição whatsapp, transcrição áudio, resumo áudio, ia, whatsapp, zapscript',
  metadataBase: new URL('https://zapscript.me'),
  openGraph: {
    title:       'ZapScript — Transcrição Inteligente',
    description: 'Transforme seus áudios do WhatsApp em textos, resumos e insights com IA.',
    url:         'https://zapscript.me',
    siteName:    'ZapScript',
    locale:      'pt_BR',
    type:        'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&display=swap" rel="stylesheet" />
        <meta name="theme-color" content="#0c0c12" />
      </head>
      <body className="font-sans bg-brand-bg text-brand-text antialiased" style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}>
        {children}
        <SupportWidget />
      </body>
    </html>
  );
}
