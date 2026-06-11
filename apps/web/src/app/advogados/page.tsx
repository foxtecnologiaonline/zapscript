import type { Metadata } from 'next';
import LandingPageClient, { type Variant } from '../lp/LandingPageClient';

export const metadata: Metadata = {
  title:       'Transcrição de Áudios do WhatsApp para Advogados — ZapScript',
  description: 'Transforme o relato em áudio do cliente em texto pesquisável e organizado. Criptografia AES-256, conformidade LGPD, servidores no Brasil. Feito para advogados. Comece grátis.',
  keywords:    'transcrever áudio cliente whatsapp advogado, registro escrito relato cliente, transcrição jurídica whatsapp, advogado áudio cliente texto',
  alternates:  { canonical: 'https://zapscript.me/advogados' },
  openGraph: {
    title:       'ZapScript para Advogados — Relato do cliente em texto pesquisável',
    description: 'O relato em áudio do cliente vira texto organizado e seguro. Criptografia padrão bancário, LGPD. Comece grátis.',
    url:         'https://zapscript.me/advogados',
    siteName:    'ZapScript',
    locale:      'pt_BR',
    type:        'website',
  },
};

const variant: Variant = {
  badge:    '⚖️ Feito para advogados e escritórios',
  headline: 'O relato do cliente em áudio, virado texto e organizado.',
  sub:      'Clientes relatam o caso por áudio. O ZapScript transcreve e resume cada um automaticamente — texto pesquisável, registrado e protegido, pronto para o processo.',
  cta:      'Começar Grátis',
  ctaHref:  '/cadastro?utm_source=seo&utm_campaign=advogados',
  audience: 'advogados e escritórios',
  pains: [
    { icon: '📄', title: 'Relato vira registro', desc: 'O áudio do cliente vira texto estruturado e pesquisável — fácil de anexar ao caso e consultar depois.' },
    { icon: '🔒', title: 'Sigilo garantido', desc: 'Transcrições criptografadas com AES-256-GCM, servidores em São Paulo e conformidade total com a LGPD.' },
    { icon: '🔍', title: 'Encontre qualquer caso', desc: 'Busque por cliente, palavra-chave ou data em todo o histórico. O detalhe que importa nunca se perde.' },
  ],
  faqs: [
    { q: 'Como o ZapScript ajuda advogados e escritórios?', a: 'Clientes costumam relatar o caso por áudio no WhatsApp. O ZapScript transcreve e resume cada áudio automaticamente, transformando o relato em texto organizado e pesquisável — pronto para registrar, anexar ao caso e consultar quando precisar.' },
    { q: 'As transcrições são seguras e sigilosas?', a: 'Sim. Todas as transcrições são criptografadas com AES-256-GCM (padrão bancário), armazenadas em servidores no Brasil (São Paulo), com conformidade total à LGPD. O áudio original não é guardado — apenas o texto, sob sua conta.' },
    { q: 'Posso pesquisar relatos antigos de clientes?', a: 'Sim. Todo o histórico de transcrições é pesquisável por nome do cliente, palavra-chave ou data. Encontrar um detalhe específico de um relato leva segundos.' },
    { q: 'Preciso instalar algo ou encaminhar áudios?', a: 'Não. Você conecta seu número via QR code uma vez e a transcrição ocorre automaticamente em segundo plano para cada áudio recebido. Sem app no celular, sem encaminhar para bots.' },
    { q: 'Tem custo para testar?', a: 'Não. O plano Free é gratuito e inclui 20 minutos de transcrição por mês, sem cartão. Para volume maior de relatos, o plano Pro (R$39,90/mês) oferece 200 minutos e 2 números.' },
  ],
};

export default function AdvogadosPage() {
  return <LandingPageClient variant={variant} />;
}
