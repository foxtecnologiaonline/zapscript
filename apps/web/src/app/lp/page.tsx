import type { Metadata } from 'next';
import LandingPageClient, { type Variant } from './LandingPageClient';

/* ── Variantes por campanha ─────────────────────────────────────────
   ?v=transcricao   → Campanha 1 (Audio Automatico)
   ?v=concorrentes  → Campanha 2 (vs ViraTexto / Ouvir Audio)
   ?v=b2b           → Campanha 3 (Empresas / Equipes)
   ?v=problema      → Campanha 4 (Chega de ouvir audio)
   sem ?v           → Campanha 5 (Geral / Brand)
──────────────────────────────────────────────────────────────────── */
const VARIANTS: Record<string, Variant> = {
  transcricao: {
    badge:   '⚡ Transcrição automática por IA',
    headline:'Transcreva Áudios do WhatsApp Automaticamente',
    sub:     'Cada áudio que chega vira texto + resumo em menos de 30 segundos. Sem escutar, sem encaminhar. Funciona em segundo plano — automático e silencioso.',
    cta:     'Transcrever Grátis Agora',
    ctaHref: '/cadastro?utm_source=google&utm_campaign=transcricao',
  },
  concorrentes: {
    badge:   '🏆 Mais completo que qualquer alternativa',
    headline:'Melhor que o ViraTexto: Automático, com Resumo e Modo Privado',
    sub:     'Sem precisar encaminhar o áudio para um bot. Transcrição automática e silenciosa, resumo com IA e modo privado — tudo incluso no plano grátis.',
    cta:     'Testar Grátis — Sem Cartão',
    ctaHref: '/cadastro?utm_source=google&utm_campaign=concorrentes',
  },
  b2b: {
    badge:   '🏢 Para equipes e empresas',
    headline:'Sua Empresa Perde Horas com Áudios do WhatsApp?',
    sub:     'Vendedores, atendentes e gestores perdem em média 2h/dia ouvindo áudios. O ZapScript transcreve e resume tudo automaticamente — para qualquer número da equipe.',
    cta:     'Começar Grátis Para Minha Empresa',
    ctaHref: '/cadastro?utm_source=google&utm_campaign=b2b',
  },
  problema: {
    badge:   '😮‍💨 Chega de perder tempo',
    headline:'Chega de Ouvir Áudios. Leia Tudo em Segundos.',
    sub:     'Por que ouvir 5 minutos de áudio quando você pode ler o ponto principal em 10 segundos? Transcrição automática + resumo por IA para cada áudio do WhatsApp.',
    cta:     'Parar de Ouvir Áudios — Grátis',
    ctaHref: '/cadastro?utm_source=google&utm_campaign=problema',
  },
  default: {
    badge:   '⚡ Tecnologia IA para WhatsApp',
    headline:'Transcrição Automática de Áudios do WhatsApp com IA',
    sub:     'Conecte seu número e receba cada áudio convertido em texto com resumo inteligente. 95%+ de precisão em português. Grátis para começar.',
    cta:     'Criar Conta Grátis',
    ctaHref: '/cadastro?utm_source=google&utm_campaign=brand',
  },
};

/* ── Metadata dinâmica por variante ─────────────────────────────── */
const META: Record<string, { title: string; description: string }> = {
  transcricao: {
    title:       'Transcrição Automática de Áudios do WhatsApp — ZapScript',
    description: 'Transforme cada áudio do WhatsApp em texto + resumo em até 30 segundos. Automático, sem encaminhar. Comece grátis.',
  },
  concorrentes: {
    title:       'Alternativa ao ViraTexto: Transcrição Automática + Resumo IA — ZapScript',
    description: 'ZapScript é mais completo: transcrição automática, resumo por IA e modo privado — sem precisar encaminhar áudios para bots. Grátis.',
  },
  b2b: {
    title:       'Transcrição de Áudios WhatsApp para Empresas — ZapScript',
    description: 'Equipes de vendas e atendimento perdem horas com áudios. ZapScript transcreve e resume tudo automaticamente. Planos a partir de R$29,90/mês.',
  },
  problema: {
    title:       'Para de Ouvir Áudios do WhatsApp — Leia o Texto em Segundos — ZapScript',
    description: 'Chega de ouvir áudios longos. O ZapScript transcreve e resume cada mensagem automaticamente com IA. Comece grátis.',
  },
  default: {
    title:       'ZapScript — Transcrição Automática de Áudios do WhatsApp com IA',
    description: 'Conecte seu WhatsApp e receba transcrições automáticas com resumo por IA. 95%+ precisão em PT-BR. Grátis para começar.',
  },
};

export async function generateMetadata(
  { searchParams }: { searchParams: { v?: string } }
): Promise<Metadata> {
  const key = (searchParams.v ?? 'default') as string;
  const meta = META[key] ?? META['default'];

  return {
    title:       meta.title,
    description: meta.description,
    robots:      { index: false, follow: false }, // LP de Ads — sem indexação
    openGraph: {
      title:       meta.title,
      description: meta.description,
      url:         `https://zapscript.me/lp${key !== 'default' ? `?v=${key}` : ''}`,
      type:        'website',
      siteName:    'ZapScript',
    },
  };
}

/* ── Page ────────────────────────────────────────────────────────── */
export default function LandingPage(
  { searchParams }: { searchParams: { v?: string } }
) {
  const key = (searchParams.v ?? 'default') as string;
  const variant = VARIANTS[key] ?? VARIANTS['default'];

  return <LandingPageClient variant={variant} />;
}
