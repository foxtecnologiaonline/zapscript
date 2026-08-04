import type { Metadata } from 'next';
import LandingPageClient, { type Variant } from '../lp/LandingPageClient';

export const metadata: Metadata = {
  title:       'Conversão de Áudios do WhatsApp para Corretores de Imóveis — ZapScript',
  description: 'Cliente manda áudio do imóvel? ZapScript converte e resume cada áudio automaticamente. Corretor lê em segundos e responde primeiro. Grátis.',
  keywords:    'converter áudio cliente imóvel, corretor whatsapp áudio, conversão imobiliária, ficha imóvel áudio whatsapp',
  alternates:  { canonical: 'https://www.zapscript.me/corretores' },
  openGraph: {
    title:       'ZapScript para Corretores — Áudio do cliente vira ficha do imóvel',
    description: 'Pare de ouvir áudios longos de clientes. Conversão automática + resumo da intenção de compra. Comece grátis.',
    url:         'https://www.zapscript.me/corretores',
    siteName:    'ZapScript',
    locale:      'pt_BR',
    type:        'website',
  },
};

const variant: Variant = {
  badge:    '🏠 Feito para corretores de imóveis',
  headline: 'O cliente mandou áudio? Já vira a ficha do imóvel.',
  sub:      'Cada áudio de cliente descrevendo o imóvel dos sonhos vira texto + resumo automático: quartos, faixa de preço, bairro e urgência — sem você ouvir 5 minutos.',
  cta:      'Converter Grátis Agora',
  ctaHref:  '/cadastro?utm_source=seo&utm_campaign=corretores',
  audience: 'corretores de imóveis',
  slug: 'corretores',
  breadcrumbLabel: 'Corretores de Imóveis',
  pains: [
    { icon: '🎙️', title: 'Áudio vira ficha', desc: 'O relato em áudio do cliente vira texto organizado: tipo de imóvel, quartos, faixa de preço e bairro desejado.' },
    { icon: '⚡', title: 'Responda mais rápido', desc: 'Leia a intenção do cliente em segundos e responda na frente da concorrência — quem responde primeiro fecha.' },
    { icon: '🔍', title: 'Tudo pesquisável', desc: 'Histórico de todos os áudios convertidos, pesquisável por bairro, valor ou nome do cliente. Nada se perde.' },
  ],
  faqs: [
    { q: 'Como o ZapScript ajuda corretores de imóveis?', a: 'Quando o cliente manda um áudio descrevendo o imóvel que procura, o ZapScript converte e resume automaticamente: tipo de imóvel, número de quartos, faixa de preço e bairro. Você lê em segundos em vez de ouvir 5 minutos, e responde mais rápido.' },
    { q: 'Funciona com vários clientes ao mesmo tempo?', a: 'Sim. Todos os áudios recebidos no seu número conectado são convertidos automaticamente e ficam organizados no histórico, pesquisáveis por nome do cliente, bairro ou valor. Nenhum lead se perde.' },
    { q: 'Preciso encaminhar o áudio para algum bot?', a: 'Não. Você conecta seu número via QR code uma única vez e a conversão acontece em segundo plano, automaticamente, para cada áudio que chega. Nada é instalado no celular.' },
    { q: 'Meus contatos de clientes ficam seguros?', a: 'Sim. Todas as conversões são criptografadas com AES-256-GCM, servidores em São Paulo e conformidade total com a LGPD. O áudio não é armazenado — apenas o texto.' },
    { q: 'Quanto custa para começar?', a: 'Grátis. O plano Core inclui até 200 áudios de conversão por mês, sem cartão de crédito. Para volume maior, o plano Profissional (R$49/mês) oferece áudios ilimitados e atendimento automático por IA.' },
  ],
};

export default function CorretoresPage() {
  return <LandingPageClient variant={variant} />;
}
