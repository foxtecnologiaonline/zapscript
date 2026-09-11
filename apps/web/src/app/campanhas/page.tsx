import type { Metadata } from 'next';
import CampanhasLandingClient from './CampanhasLandingClient';

export const metadata: Metadata = {
  title: 'ZapScript Campanhas — Disparo em Massa WhatsApp 55-79% Mais Barato que Meta Direto',
  description:
    'Dispare em massa pelo WhatsApp usando API oficial da Meta — 55-79% mais barato que comprar direto. Templates aprovados, opt-out automático, sem risco de banimento. Grátis com 30 msgs/mês. Implanta em 90 minutos.',
  keywords:
    'disparo em massa whatsapp, campanhas whatsapp barato, api oficial whatsapp business, whatsapp business platform, campanha whatsapp segura, lista de transmissao whatsapp, alternativa bot whatsapp, whatsapp marketing automatizado, disparo em massa mais barato',
  alternates: { canonical: 'https://www.zapscript.me/campanhas' },
  openGraph: {
    title: 'ZapScript Campanhas — 55-79% Mais Barato que Meta Direto',
    description:
      'Disparo em massa WhatsApp pela API oficial da Meta. 55-79% de desconto vs comprar direto. Seguro, rápido (90 min), com templates aprovados.',
    url: 'https://www.zapscript.me/campanhas',
    siteName: 'ZapScript',
    locale: 'pt_BR',
    type: 'website',
    images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: 'ZapScript Campanhas' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ZapScript Campanhas — 55-79% Mais Barato',
    description: 'Disparo em massa WhatsApp 55-79% mais barato que Meta. API oficial, sem risco de banimento, grátis com 30 msgs/mês.',
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
    price: '0',
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
      name: 'Quanto custa o ZapScript Campanhas vs Meta direto?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'ZapScript é 55-79% mais barato que comprar direto da Meta. Exemplos: 1.000 mensagens custam R$150 no ZapScript vs R$330 da Meta (55% de desconto). 5.000 mensagens custam R$450 vs R$1.650 (73% de desconto). Ilimitado custa R$699/mês vs R$3.300/mês (79% de desconto). ZapScript revende a API oficial da Meta com subsídio.',
      },
    },
    {
      '@type': 'Question',
      name: 'É realmente mais barato que SMS?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'O custo por mensagem é similar (R$ 0,33 WhatsApp vs R$ 0,15-0,30 SMS), mas WhatsApp tem ROI muito melhor: taxa de abertura de 75% vs 12% no SMS. Mesmo mensagem mais cara, você vende 6x mais. É sobre ROI, não só preço.',
      },
    },
    {
      '@type': 'Question',
      name: 'Quanto custa o ZapScript Campanhas?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'A ferramenta é gratuita para todos os usuários da plataforma ZapScript, e todo mundo tem 30 mensagens grátis por mês. Acima disso: Pré-Pago 1 (1.000 mensagens por R$150, válido 90 dias), Pré-Pago 5 (5.000 mensagens por R$450, válido 120 dias) ou Mensal Ilimitado (R$699/mês, sem limite). Tarifas de mensagem cobradas diretamente pela Meta, conforme categoria do template e política vigente, ficam de fora.',
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
