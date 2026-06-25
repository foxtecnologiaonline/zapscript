import type { Metadata } from 'next';
import Link from 'next/link';
import { DemoTranscribe } from '@/components/DemoTranscribe';

export const metadata: Metadata = {
  title: 'Converter Áudio do WhatsApp Grátis — Online, sem instalar | ZapScript',
  description:
    'Converta um áudio do WhatsApp em texto de graça, online e na hora. Sem instalar nada, sem cadastro para testar. Envie o áudio e receba o texto completo + resumo com IA em segundos.',
  keywords:
    'converter áudio whatsapp grátis, converter áudio em texto, áudio para texto online, converter áudio em texto grátis, conversão de áudio whatsapp, passar áudio para texto, ouvir áudio do whatsapp em texto',
  alternates: { canonical: 'https://www.zapscript.me/transcrever-audio-gratis' },
  openGraph: {
    title: 'Converter Áudio do WhatsApp Grátis — Online, na hora',
    description:
      'Envie um áudio e receba o texto completo + resumo com IA em segundos. Grátis, online, sem instalar nada.',
    url: 'https://www.zapscript.me/transcrever-audio-gratis',
    siteName: 'ZapScript',
    locale: 'pt_BR',
    type: 'website',
  },
};

const FAQS = [
  {
    q: 'Como converter um áudio do WhatsApp em texto?',
    a: 'Baixe ou compartilhe o áudio do WhatsApp para o seu computador, envie o arquivo aqui nesta página e em segundos você recebe o texto completo convertido, mais um resumo com os pontos principais. Não precisa instalar nenhum aplicativo nem criar conta para testar.',
  },
  {
    q: 'É realmente grátis?',
    a: 'Sim. Você pode converter um áudio gratuitamente aqui na página para ver a qualidade. Para converter vários áudios automaticamente — tudo que chega no seu WhatsApp vira texto sozinho — basta criar uma conta gratuita, que inclui 20 minutos de conversão por mês sem cartão de crédito.',
  },
  {
    q: 'Quais formatos de áudio funcionam?',
    a: 'Funciona com os formatos mais comuns de áudio: .ogg e .opus (formato padrão do WhatsApp), além de mp3, m4a, mp4, wav, aac e flac. O arquivo de teste pode ter até 4 MB.',
  },
  {
    q: 'Meu áudio fica armazenado?',
    a: 'Não. O áudio é processado para gerar a conversão e descartado imediatamente depois — nunca é armazenado. As conversões na sua conta são criptografadas com AES-256, e os servidores ficam no Brasil, em conformidade com a LGPD.',
  },
  {
    q: 'Dá para converter áudios automaticamente, sem enviar um por um?',
    a: 'Sim — esse é o diferencial do ZapScript. Criando uma conta, você conecta o seu número do WhatsApp escaneando um QR Code (igual ao WhatsApp Web) e, a partir daí, todo áudio que chega é convertido automaticamente, 24 horas por dia, sem você fazer nada.',
  },
];

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQS.map((f) => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
};

const howToSchema = {
  '@context': 'https://schema.org',
  '@type': 'HowTo',
  name: 'Como converter um áudio do WhatsApp em texto grátis',
  step: [
    { '@type': 'HowToStep', position: 1, name: 'Envie o áudio', text: 'Selecione ou arraste o arquivo de áudio do WhatsApp para a área de upload.' },
    { '@type': 'HowToStep', position: 2, name: 'Aguarde a conversão', text: 'A IA converte o áudio em texto em poucos segundos.' },
    { '@type': 'HowToStep', position: 3, name: 'Leia o texto e o resumo', text: 'Receba o texto completo e um resumo com os pontos principais do áudio.' },
  ],
};

const breadcrumbSchema = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Início', item: 'https://www.zapscript.me' },
    { '@type': 'ListItem', position: 2, name: 'Converter áudio do WhatsApp grátis', item: 'https://www.zapscript.me/transcrever-audio-gratis' },
  ],
};

export default function ConverterAudioGratisPage() {
  return (
    <div className="min-h-screen bg-brand-bg text-brand-text" style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(howToSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />

      {/* Header */}
      <header className="border-b border-white/5 bg-brand-bg/95 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-bold text-lg">
            <span className="text-2xl">⚡</span>
            <span className="text-white">ZapScript</span>
          </Link>
          <Link href="/cadastro?utm_source=lp&utm_campaign=converter-gratis" className="text-sm bg-brand-primary text-black font-bold px-4 py-2 rounded-xl hover:opacity-90 transition-opacity">
            Criar conta grátis →
          </Link>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-14">

        {/* Hero */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 bg-brand-primary/10 border border-brand-primary/20 rounded-full px-4 py-1.5 text-sm font-medium text-brand-primary mb-6">
            🎧 Ferramenta grátis
          </div>
          <h1 className="text-3xl sm:text-5xl font-bold text-white leading-tight mb-5">
            Converter áudio do WhatsApp em texto, <span className="text-brand-primary">grátis</span>
          </h1>
          <p className="text-lg text-brand-muted max-w-2xl mx-auto leading-relaxed">
            Envie um áudio e receba o texto completo mais um resumo com os pontos principais — em segundos.
            Online, sem instalar nada e sem precisar de cadastro para testar.
          </p>
        </div>

        {/* Ferramenta */}
        <div className="mb-14">
          <DemoTranscribe />
        </div>

        {/* Como funciona */}
        <div className="mb-14 rounded-2xl p-8 border border-brand-primary/20" style={{ background: 'rgba(16,185,129,.05)' }}>
          <h2 className="text-2xl font-bold text-white text-center mb-8">Como converter um áudio em 3 passos</h2>
          <div className="grid sm:grid-cols-3 gap-6 text-center">
            <div>
              <div className="w-12 h-12 mx-auto rounded-full bg-brand-primary/15 text-brand-primary flex items-center justify-center text-xl font-bold mb-3">1</div>
              <p className="font-semibold text-white mb-1">Envie o áudio</p>
              <p className="text-sm text-brand-muted">Arraste ou selecione o arquivo de áudio do WhatsApp.</p>
            </div>
            <div>
              <div className="w-12 h-12 mx-auto rounded-full bg-brand-primary/15 text-brand-primary flex items-center justify-center text-xl font-bold mb-3">2</div>
              <p className="font-semibold text-white mb-1">A IA converte</p>
              <p className="text-sm text-brand-muted">Em segundos o áudio vira texto, sozinho.</p>
            </div>
            <div>
              <div className="w-12 h-12 mx-auto rounded-full bg-brand-primary/15 text-brand-primary flex items-center justify-center text-xl font-bold mb-3">3</div>
              <p className="font-semibold text-white mb-1">Leia texto + resumo</p>
              <p className="text-sm text-brand-muted">Texto completo e um resumo com os pontos principais.</p>
            </div>
          </div>
        </div>

        {/* Upsell automação */}
        <div className="mb-14 text-center">
          <h2 className="text-2xl font-bold text-white mb-3">Cansado de converter um por um?</h2>
          <p className="text-brand-muted mb-6 max-w-xl mx-auto leading-relaxed">
            Crie uma conta gratuita, conecte o seu WhatsApp uma vez e <span className="text-brand-primary font-semibold">todo áudio que chegar vira texto automaticamente</span> — 24 horas por dia, sem enviar nada manualmente. O plano grátis inclui 20 minutos por mês, sem cartão.
          </p>
          <Link href="/cadastro?utm_source=lp&utm_campaign=converter-gratis" className="inline-flex items-center gap-2 bg-brand-primary text-black font-bold text-lg px-10 py-4 rounded-2xl hover:opacity-90 transition-opacity">
            Converter automaticamente →
          </Link>
          <p className="text-xs text-brand-muted mt-4">✓ Sem cartão &nbsp;·&nbsp; ✓ 20 min/mês grátis &nbsp;·&nbsp; ✓ Cancele quando quiser</p>
        </div>

        {/* FAQ */}
        <div className="mb-10">
          <h2 className="text-2xl font-bold text-white text-center mb-8">Perguntas frequentes</h2>
          <div className="space-y-3 max-w-2xl mx-auto">
            {FAQS.map((faq, i) => (
              <details key={i} className="border border-white/10 rounded-xl overflow-hidden group">
                <summary className="px-6 py-4 cursor-pointer font-semibold text-white hover:bg-white/5 transition-colors list-none flex items-center justify-between">
                  {faq.q}
                  <span className="text-brand-primary text-xl ml-4 shrink-0 group-open:rotate-45 transition-transform duration-200">+</span>
                </summary>
                <div className="px-6 pb-5 text-brand-muted leading-relaxed border-t border-white/5 pt-4 text-sm">
                  {faq.a}
                </div>
              </details>
            ))}
          </div>
        </div>
      </div>

      <footer className="border-t border-white/5 py-8 text-center text-xs text-brand-muted">
        <p>© {new Date().getFullYear()} ZapScript · <Link href="/" className="hover:text-brand-primary">Voltar ao site</Link> · <Link href="/privacidade" className="hover:text-brand-primary">Privacidade</Link></p>
        <p className="mt-1 text-brand-muted/50">Converter áudio do WhatsApp em texto grátis, online e sem instalar. Servidores no Brasil, conformidade com a LGPD.</p>
      </footer>
    </div>
  );
}
