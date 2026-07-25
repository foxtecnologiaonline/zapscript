import type { Metadata } from 'next';
import CampanhasLandingClient from './CampanhasLandingClient';

export const metadata: Metadata = {
  title: 'ZapScript Campanhas — Disparo em Massa Oficial no WhatsApp (API Meta)',
  description:
    'Perdeu o disparo em massa depois que a Meta reforçou o combate a bots não autorizados? O ZapScript Campanhas dispara pela API oficial da Meta — templates aprovados, opt-out automático, sem risco de banimento. R$67/mês.',
  keywords:
    'disparo em massa whatsapp, api oficial whatsapp business, whatsapp business platform, campanha whatsapp compliant, envio em massa whatsapp, bot whatsapp banido, alternativa bot whatsapp',
  alternates: { canonical: 'https://www.zapscript.me/campanhas' },
  openGraph: {
    title: 'ZapScript Campanhas — Disparo em Massa Oficial no WhatsApp',
    description:
      'Dispare em massa pela API oficial da Meta. Templates aprovados, entrega rastreada e opt-out automático — sem risco de banimento.',
    url: 'https://www.zapscript.me/campanhas',
    siteName: 'ZapScript',
    locale: 'pt_BR',
    type: 'website',
    images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: 'ZapScript Campanhas' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ZapScript Campanhas — Disparo em Massa Oficial no WhatsApp',
    description: 'Dispare em massa pela API oficial da Meta, sem risco de banimento. R$67/mês.',
    images: ['/opengraph-image'],
  },
};

const softwareSchema = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'ZapScript Campanhas',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  url: 'https://www.zapscript.me/campanhas',
  inLanguage: 'pt-BR',
  description:
    'Disparo em massa no WhatsApp pela API oficial da Meta (WhatsApp Business Platform), com templates aprovados, acompanhamento de entrega em tempo real e opt-out automático conforme a LGPD.',
  featureList: [
    'Envio em massa pela API oficial da Meta (WhatsApp Business Platform)',
    'Templates de mensagem aprovados pela Meta',
    'Importação de contatos via CSV',
    'Acompanhamento de entrega em tempo real (enviado, entregue, lido, falhou)',
    'Opt-out automático por palavra-chave (LGPD)',
  ],
  offers: {
    '@type': 'Offer',
    price: '67',
    priceCurrency: 'BRL',
    name: 'ZapScript Campanhas',
  },
  publisher: {
    '@type': 'Organization',
    name: 'FOX TecnologIA',
    url: 'https://www.zapscript.me',
  },
};

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'O que aconteceu com os bots não autorizados no WhatsApp?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'A Meta reforçou o combate a automações não autorizadas (fora da API oficial) usadas para disparo em massa — números que dependiam desse tipo de bot passaram a correr risco real de banimento.',
      },
    },
    {
      '@type': 'Question',
      name: 'O ZapScript Campanhas corre esse mesmo risco?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Não. O envio é feito pela API oficial da Meta (WhatsApp Business Platform) — a mesma usada por grandes empresas, com número registrado e mensagens em templates aprovados pela própria Meta.',
      },
    },
    {
      '@type': 'Question',
      name: 'O que são "templates aprovados"?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'São modelos de mensagem cadastrados no Gerenciador de Negócios da Meta e aprovados antes de poder ser usados em disparos. É uma exigência da própria Meta para evitar spam.',
      },
    },
    {
      '@type': 'Question',
      name: 'Como funciona o opt-out?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Contatos que respondem PARAR, SAIR, STOP, CANCELAR ou UNSUBSCRIBE são excluídos automaticamente de futuras campanhas, conforme a LGPD.',
      },
    },
    {
      '@type': 'Question',
      name: 'Quanto custa o ZapScript Campanhas?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'R$67/mês pela plataforma ZapScript Campanhas. Tarifas de mensagem cobradas diretamente pela Meta, conforme categoria do template e política vigente, não estão incluídas nesse valor.',
      },
    },
  ],
};

const breadcrumbSchema = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'ZapScript', item: 'https://www.zapscript.me' },
    { '@type': 'ListItem', position: 2, name: 'Campanhas', item: 'https://www.zapscript.me/campanhas' },
  ],
};

export default function CampanhasPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />
      <CampanhasLandingClient />
    </>
  );
}
