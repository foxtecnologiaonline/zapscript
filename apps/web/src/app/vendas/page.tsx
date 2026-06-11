import type { Metadata } from 'next';
import LandingPageClient, { type Variant } from '../lp/LandingPageClient';

export const metadata: Metadata = {
  title:       'Transcrição de Áudios do WhatsApp para Vendas e Atendimento — ZapScript',
  description: 'Cada áudio de lead não ouvido é uma venda perdida. O ZapScript transcreve e resume a intenção de compra de cada áudio automaticamente. Responda 3x mais rápido. Comece grátis.',
  keywords:    'responder áudio cliente whatsapp rápido, transcrição vendas whatsapp, áudio lead texto, atendimento whatsapp áudio',
  alternates:  { canonical: 'https://zapscript.me/vendas' },
  openGraph: {
    title:       'ZapScript para Vendas — Cada áudio de lead vira intenção de compra',
    description: 'Pare de perder vendas em áudios não ouvidos. Transcrição + resumo automático da intenção do lead. Comece grátis.',
    url:         'https://zapscript.me/vendas',
    siteName:    'ZapScript',
    locale:      'pt_BR',
    type:        'website',
  },
};

const variant: Variant = {
  badge:    '💼 Feito para vendas e atendimento',
  headline: 'Cada áudio de lead não ouvido é uma venda perdida.',
  sub:      'O lead manda áudio perguntando preço e condição — e você demora a ouvir. O ZapScript transcreve e resume a intenção de compra na hora, para você responder na frente e fechar mais.',
  cta:      'Vender Mais — Grátis',
  ctaHref:  '/cadastro?utm_source=seo&utm_campaign=vendas',
  audience: 'vendas e atendimento',
  pains: [
    { icon: '⏱️', title: 'Responda na hora', desc: 'O áudio do lead vira texto + resumo em segundos. Responda antes do concorrente — velocidade fecha venda.' },
    { icon: '🎯', title: 'Intenção de compra clara', desc: 'O resumo extrai o que o lead quer: produto, orçamento e urgência. Você já responde com a oferta certa.' },
    { icon: '📈', title: 'Nenhum lead esquecido', desc: 'Histórico pesquisável de todos os áudios. Acompanhe cada oportunidade sem ouvir tudo de novo.' },
  ],
};

export default function VendasPage() {
  return <LandingPageClient variant={variant} />;
}
