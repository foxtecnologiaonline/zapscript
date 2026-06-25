import type { Metadata } from 'next';
import LandingPageClient, { type Variant } from '../lp/LandingPageClient';

export const metadata: Metadata = {
  title:       'Conversão de Áudios do WhatsApp para Vendas e Atendimento — ZapScript',
  description: 'Cada áudio de lead não ouvido é uma venda perdida. O ZapScript converte e resume a intenção de compra de cada áudio automaticamente. Responda 3x mais rápido. Comece grátis.',
  keywords:    'responder áudio cliente whatsapp rápido, conversão vendas whatsapp, áudio lead texto, atendimento whatsapp áudio',
  alternates:  { canonical: 'https://www.zapscript.me/vendas' },
  openGraph: {
    title:       'ZapScript para Vendas — Cada áudio de lead vira intenção de compra',
    description: 'Pare de perder vendas em áudios não ouvidos. Conversão + resumo automático da intenção do lead. Comece grátis.',
    url:         'https://www.zapscript.me/vendas',
    siteName:    'ZapScript',
    locale:      'pt_BR',
    type:        'website',
  },
};

const variant: Variant = {
  badge:    '💼 Feito para vendas e atendimento',
  headline: 'Cada áudio de lead não ouvido é uma venda perdida.',
  sub:      'O lead manda áudio perguntando preço e condição — e você demora a ouvir. O ZapScript converte e resume a intenção de compra na hora, para você responder na frente e fechar mais.',
  cta:      'Vender Mais — Grátis',
  ctaHref:  '/cadastro?utm_source=seo&utm_campaign=vendas',
  audience: 'vendas e atendimento',
  slug: 'vendas',
  breadcrumbLabel: 'Vendas e Atendimento',
  pains: [
    { icon: '⏱️', title: 'Responda na hora', desc: 'O áudio do lead vira texto + resumo em segundos. Responda antes do concorrente — velocidade fecha venda.' },
    { icon: '🎯', title: 'Intenção de compra clara', desc: 'O resumo extrai o que o lead quer: produto, orçamento e urgência. Você já responde com a oferta certa.' },
    { icon: '📈', title: 'Nenhum lead esquecido', desc: 'Histórico pesquisável de todos os áudios. Acompanhe cada oportunidade sem ouvir tudo de novo.' },
  ],
  faqs: [
    { q: 'Como o ZapScript ajuda quem trabalha com vendas?', a: 'Leads frequentemente mandam áudio perguntando preço, condição e disponibilidade. O ZapScript converte e resume cada áudio na hora, destacando a intenção de compra — produto, orçamento e urgência — para você responder rápido e com a oferta certa.' },
    { q: 'Por que a velocidade de resposta importa tanto?', a: 'Em vendas, quem responde primeiro geralmente fecha. Cada áudio que fica sem ser ouvido é uma oportunidade esfriando. Com a conversão automática, você lê a intenção do lead em segundos em vez de parar tudo para ouvir minutos de áudio.' },
    { q: 'Consigo acompanhar todos os leads que mandaram áudio?', a: 'Sim. Todas as conversões ficam salvas e pesquisáveis por nome, produto ou data. Você acompanha cada oportunidade sem precisar reouvir os áudios.' },
    { q: 'Funciona para a minha equipe de atendimento?', a: 'O plano Pro permite conectar 2 números. Um plano Empresas multi-usuário (com webhook para integrar ao CRM) está a caminho, ideal para times de vendas e atendimento.' },
    { q: 'Quanto custa para começar?', a: 'Grátis. O plano Free inclui 20 minutos de conversão por mês, sem cartão de crédito. O plano Pro (R$39,90/mês) oferece 200 minutos e 2 números conectados.' },
  ],
};

export default function VendasPage() {
  return <LandingPageClient variant={variant} />;
}
