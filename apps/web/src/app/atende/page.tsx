import type { Metadata } from 'next';
import AtendeLandingClient from './AtendeLandingClient';

export const metadata: Metadata = {
  title:       'ZapScript Atende — Atendimento automático no WhatsApp com IA',
  description: 'Responda seus clientes no WhatsApp 24/7 com IA treinada no seu negócio. Escalonamento humano quando a IA não sabe responder. Ative sobre o número que você já tem.',
  keywords:    'atendimento automático whatsapp, chatbot whatsapp ia, responder cliente whatsapp automatico, atendimento 24 horas whatsapp',
  alternates:  { canonical: 'https://www.zapscript.me/atende' },
  openGraph: {
    title:       'ZapScript Atende — Atendimento automático no WhatsApp com IA',
    description: 'IA treinada no seu negócio responde clientes na hora, 24/7. Escalonamento humano quando não sabe responder.',
    url:         'https://www.zapscript.me/atende',
    siteName:    'ZapScript',
    locale:      'pt_BR',
    type:        'website',
  },
};

export default function AtendePage() {
  return <AtendeLandingClient />;
}
