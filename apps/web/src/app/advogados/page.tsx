import type { Metadata } from 'next';
import LandingPageClient, { type Variant } from '../lp/LandingPageClient';

export const metadata: Metadata = {
  title:       'Conversão de Áudios do WhatsApp para Advogados — ZapScript',
  description: 'Relato do cliente em áudio vira texto organizado e pesquisável. Criptografia AES-256, LGPD, servidores no Brasil. Comece grátis.',
  keywords:    'converter áudio cliente whatsapp advogado, registro escrito relato cliente, conversão jurídica whatsapp, advogado áudio cliente texto',
  alternates:  { canonical: 'https://www.zapscript.me/advogados' },
  openGraph: {
    title:       'ZapScript para Advogados — Relato do cliente em texto pesquisável',
    description: 'Relato do cliente em áudio vira texto seguro. Criptografia padrão bancário, LGPD. Grátis.',
    url:         'https://www.zapscript.me/advogados',
    siteName:    'ZapScript',
    locale:      'pt_BR',
    type:        'website',
  },
};

const variant: Variant = {
  badge:    '⚖️ Feito para advogados e escritórios',
  headline: 'O relato do cliente em áudio, virado texto e organizado.',
  sub:      'Clientes relatam o caso por áudio. O ZapScript converte e resume cada um automaticamente — texto pesquisável, registrado e protegido, pronto para o processo.',
  cta:      'Começar Grátis',
  ctaHref:  '/cadastro?utm_source=seo&utm_campaign=advogados',
  audience: 'advogados e escritórios',
  slug: 'advogados',
  breadcrumbLabel: 'Advogados e Escritórios',
  pains: [
    { icon: '📄', title: 'Relato vira registro', desc: 'O áudio do cliente vira texto estruturado e pesquisável — fácil de anexar ao caso e consultar depois.' },
    { icon: '🔒', title: 'Sigilo garantido', desc: 'Conversões criptografadas com AES-256-GCM, servidores em São Paulo e conformidade total com a LGPD.' },
    { icon: '🔍', title: 'Encontre qualquer caso', desc: 'Busque por cliente, palavra-chave ou data em todo o histórico. O detalhe que importa nunca se perde.' },
  ],
  faqs: [
    { q: 'Como o ZapScript ajuda advogados e escritórios?', a: 'Clientes costumam relatar o caso por áudio no WhatsApp. O ZapScript converte e resume cada áudio automaticamente, transformando o relato em texto organizado e pesquisável — pronto para registrar, anexar ao caso e consultar quando precisar.' },
    { q: 'As conversões são seguras e sigilosas?', a: 'Sim. Todas as conversões são criptografadas com AES-256-GCM (padrão bancário), armazenadas em servidores no Brasil (São Paulo), com conformidade total à LGPD. O áudio original não é guardado — apenas o texto, sob sua conta.' },
    { q: 'Posso pesquisar relatos antigos de clientes?', a: 'Sim. Todo o histórico de conversões é pesquisável por nome do cliente, palavra-chave ou data. Encontrar um detalhe específico de um relato leva segundos.' },
    { q: 'Preciso instalar algo ou encaminhar áudios?', a: 'Não. Você conecta seu número via QR code uma vez e a conversão ocorre automaticamente em segundo plano para cada áudio recebido. Sem app no celular, sem encaminhar para bots.' },
    { q: 'Tem custo para testar?', a: 'Não. O plano Core é gratuito e inclui até 100 áudios de conversão por mês, sem cartão. Para volume maior de relatos, o plano Profissional (R$49/mês) oferece áudios ilimitados e atendimento automático por IA.' },
  ],
};

export default function AdvogadosPage() {
  return <LandingPageClient variant={variant} />;
}
