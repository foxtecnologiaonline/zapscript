import type { Metadata } from 'next';
import LandingPageClient, { type Variant } from '../lp/LandingPageClient';

export const metadata: Metadata = {
  title:       'Transcrição de Áudios do WhatsApp para Corretores de Imóveis — ZapScript',
  description: 'Cliente mandou áudio de 5 minutos descrevendo o imóvel? O ZapScript transforma cada áudio em ficha de texto + resumo automático. Feito para corretores. Grátis para começar.',
  keywords:    'transcrever áudio cliente imóvel, corretor whatsapp áudio, transcrição imobiliária, ficha imóvel áudio whatsapp',
  alternates:  { canonical: 'https://zapscript.me/corretores' },
  openGraph: {
    title:       'ZapScript para Corretores — Áudio do cliente vira ficha do imóvel',
    description: 'Pare de ouvir áudios longos de clientes. Transcrição automática + resumo da intenção de compra. Comece grátis.',
    url:         'https://zapscript.me/corretores',
    siteName:    'ZapScript',
    locale:      'pt_BR',
    type:        'website',
  },
};

const variant: Variant = {
  badge:    '🏠 Feito para corretores de imóveis',
  headline: 'O cliente mandou áudio? Já vira a ficha do imóvel.',
  sub:      'Cada áudio de cliente descrevendo o imóvel dos sonhos vira texto + resumo automático: quartos, faixa de preço, bairro e urgência — sem você ouvir 5 minutos.',
  cta:      'Transcrever Grátis Agora',
  ctaHref:  '/cadastro?utm_source=seo&utm_campaign=corretores',
  audience: 'corretores de imóveis',
  pains: [
    { icon: '🎙️', title: 'Áudio vira ficha', desc: 'O relato em áudio do cliente vira texto organizado: tipo de imóvel, quartos, faixa de preço e bairro desejado.' },
    { icon: '⚡', title: 'Responda mais rápido', desc: 'Leia a intenção do cliente em segundos e responda na frente da concorrência — quem responde primeiro fecha.' },
    { icon: '🔍', title: 'Tudo pesquisável', desc: 'Histórico de todos os áudios transcritos, pesquisável por bairro, valor ou nome do cliente. Nada se perde.' },
  ],
};

export default function CorretoresPage() {
  return <LandingPageClient variant={variant} />;
}
