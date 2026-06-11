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
};

export default function AdvogadosPage() {
  return <LandingPageClient variant={variant} />;
}
