import type { Metadata } from 'next';
import CrmLandingClient from './CrmLandingClient';

export const metadata: Metadata = {
  title:       'CRM para WhatsApp — Organize Leads em um Funil Visual — ZapScript',
  description: 'Organize quem é lead novo, quem está negociando e quem já fechou — direto do WhatsApp. Funil visual, notas, lembretes e importação em 1 clique. A partir de R$39,90/mês.',
  keywords:    'crm whatsapp, funil de vendas whatsapp, organizar leads whatsapp, kanban whatsapp, crm para whatsapp, pipeline de vendas whatsapp',
  alternates:  { canonical: 'https://www.zapscript.me/crm' },
  openGraph: {
    title:       'ZapScript CRM — Funil de vendas dentro do WhatsApp',
    description: 'Organize seus leads em um funil visual sem sair do WhatsApp. Notas, lembretes e importação automática a partir do que você já transcreveu.',
    url:         'https://www.zapscript.me/crm',
    siteName:    'ZapScript',
    locale:      'pt_BR',
    type:        'website',
  },
};

export default function CrmLandingPage() {
  return <CrmLandingClient />;
}
