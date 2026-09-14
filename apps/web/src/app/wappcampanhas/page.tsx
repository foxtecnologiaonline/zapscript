import type { Metadata } from 'next';
import WappCampanhasClient from './WappCampanhasClient';

export const metadata: Metadata = {
  title:       'Crie Campanhas de WhatsApp em 3 Passos — ZapScript',
  description: 'Monte sua campanha de disparo em massa no WhatsApp com preview em tempo real: escreva a mensagem, importe contatos e dispare pela API oficial Meta, sem risco de banimento.',
  keywords:    'criar campanha whatsapp, disparo em massa whatsapp, mensagem em massa whatsapp api oficial, campanha whatsapp business',
  alternates:  { canonical: 'https://www.zapscript.me/wappcampanhas' },
  openGraph: {
    title:       'Crie Campanhas de WhatsApp em 3 Passos — ZapScript',
    description: 'Escreva a mensagem, importe contatos e dispare pela API oficial Meta — sem risco de banimento. Preview em tempo real.',
    url:         'https://www.zapscript.me/wappcampanhas',
    siteName:    'ZapScript',
    locale:      'pt_BR',
    type:        'website',
  },
  twitter: {
    card:        'summary_large_image',
    title:       'Crie Campanhas de WhatsApp em 3 Passos — ZapScript',
    description: 'Escreva a mensagem, importe contatos e dispare pela API oficial Meta — sem risco de banimento. Preview em tempo real.',
  },
};

export default function WappCampanhasPage() {
  return <WappCampanhasClient />;
}
