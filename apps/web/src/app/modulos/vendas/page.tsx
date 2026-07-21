import type { Metadata } from 'next';
import VendasLandingClient from './VendasLandingClient';

export const metadata: Metadata = {
  title:       'ZapScript Vendas — Grave a visita, vire nota de CRM automaticamente',
  description: 'Grave a visita ou ligação comercial e receba transcrição + resumo com valores, objeções e próximo passo em segundos. Módulo ZapScript Vendas.',
  keywords:    'registro de visita comercial, transcrever ligação de vendas, resumo de visita cliente, nota de crm automática, vendedor externo whatsapp',
  alternates:  { canonical: 'https://www.zapscript.me/modulos/vendas' },
  openGraph: {
    title:       'ZapScript Vendas — a visita gravada vira nota de CRM sozinha',
    description: 'Grave, envie, e receba o resumo comercial da visita em segundos: valores, objeções e o combinado.',
    url:         'https://www.zapscript.me/modulos/vendas',
    siteName:    'ZapScript',
    locale:      'pt_BR',
    type:        'website',
  },
};

export default function VendasModulePage() {
  return <VendasLandingClient />;
}
