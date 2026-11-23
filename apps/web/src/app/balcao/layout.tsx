import type { Metadata } from 'next';
import './balcao.css';
import { BvProviders } from './providers';

export const metadata: Metadata = {
  title: { default: 'Balcão Virtual', template: '%s | Balcão Virtual' },
  description: 'Plataforma de atendimento omnichannel do Balcão Virtual.',
  robots: { index: false, follow: false },
};

export default function BalcaoLayout({ children }: { children: React.ReactNode }) {
  return <div className="bv-app min-h-screen" lang="pt-BR"><BvProviders>{children}</BvProviders></div>;
}
