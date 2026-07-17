import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'ZapScript Legendas — Legenda automática para Reels, Stories e Shorts',
  description: 'Envie o vídeo e receba a legenda pronta em .srt e .vtt em minutos, via IA (Whisper). Sem editar na mão, sem plugin de vídeo. R$34,90/mês.',
  keywords: 'legenda automática vídeo, legenda reels, legenda stories, gerar srt automatico, legenda shorts, transcrição de vídeo ia',
  alternates: { canonical: 'https://www.zapscript.me/legendas' },
  openGraph: {
    title: 'ZapScript Legendas — Legenda automática para Reels e Stories',
    description: 'Envie o vídeo, a IA transcreve e você baixa a legenda pronta em .srt ou .vtt. Sem editar na mão.',
    url: 'https://www.zapscript.me/legendas',
    siteName: 'ZapScript',
    locale: 'pt_BR',
    type: 'website',
  },
};

const schema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'Como funciona o ZapScript Legendas?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Você envia o vídeo (MP4, MOV, WebM, MKV, 3GP ou AVI, até 500MB). Nossa IA (Whisper) transcreve a fala automaticamente com marcação de tempo, e você baixa a legenda pronta nos formatos .srt e .vtt — prontos para importar no editor ou direto no Instagram/TikTok/YouTube.',
      },
    },
    {
      '@type': 'Question',
      name: 'Quais formatos de legenda o ZapScript Legendas gera?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Geramos .srt (o formato mais aceito por editores de vídeo e redes sociais) e .vtt (usado em players web). Os dois já vêm com timestamps sincronizados com a fala do vídeo.',
      },
    },
    {
      '@type': 'Question',
      name: 'Quanto custa o ZapScript Legendas?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'R$34,90 por mês, com uso ilimitado de envios dentro da sua conta. Pagamento via Pix ou cartão, sem fidelidade — cancele quando quiser.',
      },
    },
    {
      '@type': 'Question',
      name: 'Preciso editar o vídeo depois?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Não. A legenda já sai sincronizada com o áudio do vídeo. Basta importar o arquivo .srt no seu editor (CapCut, Premiere, InShot) ou usar o .vtt direto em players web.',
      },
    },
  ],
};

const breadcrumbSchema = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Início', item: 'https://www.zapscript.me' },
    { '@type': 'ListItem', position: 2, name: 'ZapScript Legendas', item: 'https://www.zapscript.me/legendas' },
  ],
};

const STEPS = [
  { n: '1', title: 'Envie o vídeo', desc: 'Arraste o arquivo (MP4, MOV, WebM, MKV, 3GP ou AVI) — upload direto, até 500MB.' },
  { n: '2', title: 'A IA transcreve', desc: 'O Whisper identifica a fala e marca o tempo de cada trecho automaticamente.' },
  { n: '3', title: 'Baixe a legenda', desc: 'Arquivos .srt e .vtt prontos para o editor ou para postar direto na rede social.' },
];

const PAINS = [
  { icon: '✂️', title: 'Sem editar na mão', desc: 'Nada de digitar frase por frase e ajustar tempo manualmente no editor.' },
  { icon: '⚡', title: 'Pronto em minutos', desc: 'Envie o vídeo e receba a legenda sincronizada sem depender de terceiros.' },
  { icon: '📱', title: 'Feito para redes sociais', desc: 'Formato ideal para Reels, Stories, TikTok e Shorts — onde a legenda aumenta o alcance.' },
  { icon: '🇧🇷', title: 'Português do Brasil', desc: 'Reconhece o jeito que se fala em vídeo curto — gírias, ritmo acelerado, cortes.' },
];

const FAQS = [
  { q: 'Como funciona o ZapScript Legendas?', a: 'Você envia o vídeo (MP4, MOV, WebM, MKV, 3GP ou AVI, até 500MB). A IA transcreve a fala automaticamente com marcação de tempo, e você baixa a legenda pronta em .srt e .vtt.' },
  { q: 'Quais formatos de legenda são gerados?', a: 'Geramos .srt (aceito pela maioria dos editores e redes sociais) e .vtt (usado em players web), ambos já sincronizados com o áudio do vídeo.' },
  { q: 'Quanto custa?', a: 'R$34,90/mês, com uso ilimitado de envios. Pix ou cartão, sem fidelidade — cancele quando quiser direto no painel.' },
  { q: 'Preciso editar o vídeo depois?', a: 'Não. Basta importar o .srt no seu editor (CapCut, Premiere, InShot) ou usar o .vtt direto em players web — a legenda já vem sincronizada.' },
  { q: 'Funciona com qualquer tamanho de vídeo?', a: 'Aceitamos arquivos de até 500MB nos formatos MP4, MOV, WebM, MKV, 3GP e AVI — suficiente para a maioria dos Reels, Stories e Shorts.' },
];

export default function LegendasPage() {
  return (
    <div className="min-h-screen bg-brand-bg text-brand-text" style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />

      <header className="border-b border-white/5 bg-brand-bg/95 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-bold text-lg">
            <span className="text-2xl">⚡</span>
            <span className="text-white">ZapScript</span>
          </Link>
          <Link href="/cadastro?utm_source=seo&utm_campaign=legendas" className="text-sm bg-brand-primary text-black font-bold px-4 py-2 rounded-xl hover:opacity-90 transition-opacity">
            Criar conta grátis →
          </Link>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-16">

        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 bg-brand-primary/10 border border-brand-primary/20 rounded-full px-4 py-1.5 text-sm font-medium text-brand-primary mb-6">
            🎬 Novo módulo ZapScript
          </div>
          <h1 className="text-3xl sm:text-5xl font-bold text-white leading-tight mb-5">
            Legenda automática<br />
            <span className="text-brand-primary">para Reels, Stories e Shorts</span>
          </h1>
          <p className="text-lg text-brand-muted max-w-2xl mx-auto leading-relaxed">
            Envie o vídeo e receba a legenda pronta em .srt e .vtt em minutos — via IA, sem editar frase por frase na mão.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href="/cadastro?utm_source=seo&utm_campaign=legendas" className="inline-flex items-center gap-2 bg-brand-primary text-black font-bold text-base px-8 py-3.5 rounded-2xl hover:opacity-90 transition-opacity">
              Criar conta e testar →
            </Link>
            <span className="text-sm text-brand-muted">R$34,90/mês · Pix ou cartão · cancele quando quiser</span>
          </div>
        </div>

        {/* Como funciona */}
        <div className="mb-16">
          <h2 className="text-2xl font-bold text-white text-center mb-10">Como funciona</h2>
          <div className="grid sm:grid-cols-3 gap-5">
            {STEPS.map((s) => (
              <div key={s.n} className="rounded-2xl p-6 border border-white/10 bg-white/3 text-center">
                <div className="w-10 h-10 rounded-full bg-brand-primary/15 border border-brand-primary/30 text-brand-primary font-bold flex items-center justify-center mx-auto mb-4">
                  {s.n}
                </div>
                <div className="font-bold text-white mb-2">{s.title}</div>
                <p className="text-sm text-brand-muted leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Dores / benefícios */}
        <div className="mb-16 grid sm:grid-cols-2 gap-4">
          {PAINS.map((p) => (
            <div key={p.title} className="rounded-2xl p-6 border border-white/10 bg-white/3 flex gap-4">
              <div className="text-3xl shrink-0">{p.icon}</div>
              <div>
                <div className="font-bold text-white mb-1">{p.title}</div>
                <p className="text-sm text-brand-muted leading-relaxed">{p.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Pricing */}
        <div className="mb-16 rounded-2xl p-8 border border-brand-primary/30 text-center" style={{ background: 'rgba(16,185,129,.06)' }}>
          <div className="text-xs font-mono uppercase tracking-widest text-brand-primary mb-3">ZapScript Legendas</div>
          <div className="flex items-baseline justify-center gap-1 mb-2">
            <span className="text-4xl font-black text-white">R$34,90</span>
            <span className="text-brand-muted">/mês</span>
          </div>
          <p className="text-sm text-brand-muted mb-6">Envios ilimitados dentro da sua conta · sem fidelidade</p>
          <ul className="space-y-2 text-sm text-brand-muted text-left max-w-sm mx-auto mb-6">
            <li>✅ Legenda automática via IA (Whisper)</li>
            <li>✅ Formatos .srt e .vtt prontos para uso</li>
            <li>✅ Upload direto — vídeos de até 500MB</li>
            <li>✅ Mesmo login da sua conta ZapScript</li>
          </ul>
          <Link href="/cadastro?utm_source=seo&utm_campaign=legendas" className="inline-flex items-center gap-2 bg-brand-primary text-black font-bold px-8 py-3.5 rounded-2xl hover:opacity-90 transition-opacity">
            Criar conta e contratar →
          </Link>
        </div>

        {/* FAQ */}
        <div className="mb-16">
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

        <div className="text-center py-12 rounded-2xl border border-brand-primary/20" style={{ background: 'rgba(16,185,129,.05)' }}>
          <h2 className="text-2xl font-bold text-white mb-3">Pare de legendar na mão</h2>
          <p className="text-brand-muted mb-6">Crie sua conta ZapScript e contrate o módulo Legendas em menos de 2 minutos.</p>
          <Link href="/cadastro?utm_source=seo&utm_campaign=legendas" className="inline-flex items-center gap-2 bg-brand-primary text-black font-bold text-lg px-10 py-4 rounded-2xl hover:opacity-90 transition-opacity">
            Criar minha conta →
          </Link>
          <p className="text-xs text-brand-muted mt-4">✓ Mesmo login de todos os módulos ZapScript &nbsp;·&nbsp; ✓ Cancele quando quiser</p>
        </div>
      </div>

      <footer className="border-t border-white/5 py-8 text-center text-xs text-brand-muted">
        <p>© {new Date().getFullYear()} ZapScript · <Link href="/" className="hover:text-brand-primary">Voltar ao site</Link> · <Link href="/privacidade" className="hover:text-brand-primary">Privacidade</Link></p>
      </footer>
    </div>
  );
}
