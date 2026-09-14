import type { Metadata } from 'next';
import AfiliadosClient from './AfiliadosClient';

export const metadata: Metadata = {
  title:       'Programa de Afiliados — Indique o ZapScript e Ganhe Crédito',
  description: 'Toda conta já nasce com link de indicação, sem aplicação nem aprovação. Ganhe 20% recorrente em cada pagamento de quem você indicar, enquanto continuar assinante.',
  keywords:    'programa de afiliados zapscript, indicar zapscript, ganhar dinheiro indicando whatsapp, afiliado whatsapp ia, comissão recorrente saas',
  alternates:  { canonical: 'https://www.zapscript.me/afiliados' },
  openGraph: {
    title:       'Programa de Afiliados ZapScript — Ganhe crédito todo mês',
    description: 'Link de indicação automático, sem aplicação. 20% recorrente em cada pagamento de quem você indicar, enquanto continuar assinante.',
    url:         'https://www.zapscript.me/afiliados',
    siteName:    'ZapScript',
    locale:      'pt_BR',
    type:        'website',
  },
  twitter: {
    card:        'summary_large_image',
    title:       'Programa de Afiliados ZapScript — Ganhe crédito todo mês',
    description: 'Link de indicação automático, sem aplicação. 20% recorrente em cada pagamento de quem você indicar, enquanto continuar assinante.',
  },
};

export default function AfiliadosPage() {
  return <AfiliadosClient />;
}
