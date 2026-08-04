import type { Metadata } from 'next';
import LandingPageClient, { type Variant } from '../lp/LandingPageClient';

export const metadata: Metadata = {
  title:       'Conversão de Áudios do WhatsApp para Dentistas e Clínicas — ZapScript',
  description: 'Pacientes mandam áudio com sintomas e dúvidas. ZapScript converte e resume automaticamente — registro pesquisável, LGPD, sem app. Grátis.',
  keywords:    'transcrever áudio paciente whatsapp, converter áudio whatsapp clínica, dentista áudio whatsapp texto, prontuário relato paciente whatsapp',
  alternates:  { canonical: 'https://www.zapscript.me/dentistas' },
  openGraph: {
    title:       'ZapScript para Dentistas e Clínicas — Relato do paciente em texto',
    description: 'O áudio do paciente vira texto e resumo automaticamente. Criptografia AES-256, LGPD, sem app. Comece grátis.',
    url:         'https://www.zapscript.me/dentistas',
    siteName:    'ZapScript',
    locale:      'pt_BR',
    type:        'website',
  },
};

const variant: Variant = {
  badge:    '🦷 Feito para dentistas e clínicas',
  headline: 'O áudio do paciente, virado texto em segundos.',
  sub:      'Pacientes relatam sintoma, remarcam consulta e tiram dúvida por áudio. O ZapScript converte e resume cada um automaticamente — sem precisar ouvir nada entre um atendimento e outro.',
  cta:      'Começar Grátis',
  ctaHref:  '/cadastro?utm_source=seo&utm_campaign=dentistas',
  audience: 'dentistas e clínicas',
  slug: 'dentistas',
  breadcrumbLabel: 'Dentistas e Clínicas',
  pains: [
    { icon: '🩺', title: 'Sintoma vira registro', desc: 'O relato em áudio do paciente vira texto organizado — fácil de ler entre um atendimento e outro, sem fone de ouvido.' },
    { icon: '🔒', title: 'Sigilo do paciente', desc: 'Conversões criptografadas com AES-256-GCM, servidores no Brasil e conformidade com a LGPD.' },
    { icon: '📅', title: 'Remarcação sem perder tempo', desc: 'Áudio de "quero remarcar" ou "posso chegar atrasado" vira texto direto no painel — sem precisar parar para ouvir.' },
  ],
  faqs: [
    { q: 'Como o ZapScript ajuda dentistas e clínicas?', a: 'Pacientes costumam mandar áudio para relatar sintomas, confirmar ou remarcar consultas. O ZapScript converte e resume cada áudio automaticamente, virando texto organizado no seu painel — sem precisar parar o atendimento para ouvir.' },
    { q: 'É seguro para dados de pacientes?', a: 'Sim. Todas as conversões são criptografadas com AES-256-GCM (padrão bancário), armazenadas em servidores no Brasil (São Paulo), com conformidade total à LGPD. O áudio original não é guardado — apenas o texto, sob sua conta.' },
    { q: 'Funciona para a recepção e para o dentista?', a: 'Sim. O número pode ser o da recepção/clínica; toda a equipe pode acompanhar o texto convertido no painel, sem precisar redistribuir áudios.' },
    { q: 'Preciso instalar algo ou encaminhar áudios?', a: 'Não. Você conecta o número via QR code uma vez e a conversão ocorre automaticamente em segundo plano para cada áudio recebido.' },
    { q: 'Tem custo para testar?', a: 'Não. O plano Core é gratuito e inclui até 200 áudios de conversão por mês, sem cartão. Para mais volume, o plano Profissional (R$49/mês) oferece áudios ilimitados e atendimento automático por IA.' },
  ],
};

export default function DentistasPage() {
  return <LandingPageClient variant={variant} />;
}
