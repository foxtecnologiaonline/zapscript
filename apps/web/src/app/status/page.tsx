import type { Metadata } from 'next';
import StatusClient from './StatusClient';

export const metadata: Metadata = {
  title:       'Status & Progresso — ZapScript',
  description: 'Acompanhe o que já está pronto e o que está em desenvolvimento no ZapScript, por área (autenticação, API, frontend, segurança, infraestrutura, monitoramento).',
  alternates:  { canonical: 'https://www.zapscript.me/status' },
  openGraph: {
    title:       'Status & Progresso — ZapScript',
    description: 'Acompanhe o que já está pronto e o que está em desenvolvimento no ZapScript.',
    url:         'https://www.zapscript.me/status',
    siteName:    'ZapScript',
    locale:      'pt_BR',
    type:        'website',
  },
};

export default function StatusPage() {
  return <StatusClient />;
}
