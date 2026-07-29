import type { Metadata } from 'next';
import Link from 'next/link';
import { PROFISSIONAL_PRICE_MONTHLY } from '@/lib/promo';
import ConversationDemo from '@/components/ConversationDemo';

export const metadata: Metadata = {
  title: 'ZapScript para Contabilidade — Converta os áudios dos seus clientes automaticamente',
  description:
    'Escritórios de contabilidade recebem dezenas de áudios por dia de clientes. O ZapScript converte e resume tudo automaticamente, criando um registro pesquisável — sem ouvir, sem esquecer prazo. Comece grátis.',
  keywords:
    'conversão whatsapp contabilidade, áudio whatsapp escritório contábil, converter áudio cliente, contador whatsapp, atendimento contábil whatsapp, registro de áudio cliente',
  alternates: { canonical: 'https://www.zapscript.me/para/contabilidade' },
  openGraph: {
    title: 'ZapScript para Contabilidade — Nunca mais perca um áudio de cliente',
    description:
      'Conversão automática + resumo com IA de cada áudio do WhatsApp. Registro pesquisável de tudo que o cliente pediu. Servidores no Brasil, conformidade LGPD.',
    url: 'https://www.zapscript.me/para/contabilidade',
    siteName: 'ZapScript',
    locale: 'pt_BR',
    type: 'website',
  },
};

const proPriceLabel = `${PROFISSIONAL_PRICE_MONTHLY}/mês`;

const DORES = [
  {
    icon: '🎧',
    title: 'Áudios de todos os lados',
    text: 'Cliente manda dúvida fiscal por áudio, sócio manda orientação, departamento pessoal manda demanda. São dezenas por dia, de gente diferente — e tudo vira fila para ouvir.',
  },
  {
    icon: '⏰',
    title: 'Prazo que escapa',
    text: 'Um áudio de 4 minutos com "preciso da guia até quinta" some no meio da conversa. Quando você lembra, o prazo já passou — e a responsabilidade é do escritório.',
  },
  {
    icon: '📂',
    title: 'Nada fica registrado',
    text: 'O que o cliente pediu ficou só no áudio. Sem registro escrito, fica a palavra de um contra a do outro — e nada para anexar ao histórico do cliente.',
  },
];

const BENEFICIOS = [
  {
    icon: '⚡',
    title: 'Conversão automática, 24h',
    text: 'Conecte o número do escritório uma vez. Todo áudio que chega vira texto em segundos, sozinho — mesmo fora do horário comercial.',
  },
  {
    icon: '🧠',
    title: 'Resumo com os pontos do cliente',
    text: 'Além do texto completo, a IA destaca o que importa: o que o cliente pediu, prazos citados e documentos mencionados. Você bate o olho e já sabe o que fazer.',
  },
  {
    icon: '🔎',
    title: 'Histórico pesquisável',
    text: 'Cada solicitação vira texto pesquisável e exportável em PDF. Precisou comprovar o que foi combinado? Está tudo escrito, com data e hora.',
  },
  {
    icon: '🔒',
    title: 'Sigilo e LGPD',
    text: 'Criptografia AES-256, servidores em São Paulo e o áudio descartado logo após a conversão. O sigilo dos dados do seu cliente é tratado como prioridade.',
  },
  {
    icon: '👥',
    title: 'Vários números do escritório',
    text: 'No plano Pro você conecta mais de um número — atendimento, fiscal e pessoal, cada equipe com seu fluxo convertido automaticamente.',
  },
  {
    icon: '🚫',
    title: 'Sem instalar nada',
    text: 'Funciona 100% pela web. Conecta via QR Code (igual ao WhatsApp Web) e pronto — nada instalado no celular da equipe.',
  },
];

const FAQS = [
  {
    q: 'Como o ZapScript ajuda um escritório de contabilidade?',
    a: 'Escritórios contábeis recebem um volume alto de áudios — clientes mandam dúvidas fiscais, solicitações e prazos por mensagem de voz. O ZapScript conecta ao número do escritório e converte automaticamente cada áudio recebido, gerando texto completo e um resumo com os pontos principais. Assim a equipe lê em segundos o que antes levava minutos para ouvir, e nada fica para trás.',
  },
  {
    q: 'A conversão serve como registro do que o cliente solicitou?',
    a: 'Sim. Cada áudio convertido fica salvo como texto pesquisável, com data e hora, e pode ser exportado em PDF. Isso cria um registro escrito do que foi solicitado, útil para o histórico do cliente e para evitar mal-entendidos sobre o que foi combinado.',
  },
  {
    q: 'Os dados dos clientes ficam seguros?',
    a: 'Sim. Todas as conversões são criptografadas com AES-256-GCM, o mesmo padrão usado por bancos. O áudio é processado e descartado imediatamente — nunca armazenado. Os servidores ficam em São Paulo, com conformidade total com a LGPD.',
  },
  {
    q: 'Dá para usar em mais de um número do escritório?',
    a: `Sim. O plano Pro (${proPriceLabel}) permite conectar mais de um número, ideal para separar atendimento, fiscal e departamento pessoal. Cada número tem seu fluxo de conversão automática.`,
  },
  {
    q: 'Preciso instalar algo nos celulares da equipe?',
    a: 'Não. O ZapScript funciona 100% via web. Você faz login no painel, conecta o número escaneando um QR Code (como no WhatsApp Web) e a conversão começa a funcionar sozinha. Nada é instalado no celular.',
  },
  {
    q: 'Posso testar sem custo?',
    a: 'Pode. O plano gratuito (Core) inclui até 100 áudios de conversão por mês, sem cartão de crédito. É o suficiente para sentir o ganho de tempo antes de decidir pelo plano Profissional.',
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

const breadcrumbSchema = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Início', item: 'https://www.zapscript.me' },
    { '@type': 'ListItem', position: 2, name: 'ZapScript para Contabilidade', item: 'https://www.zapscript.me/para/contabilidade' },
  ],
};

export default function ParaContabilidadePage() {
  return (
    <div className="min-h-screen bg-brand-bg text-brand-text" style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />

      {/* Header */}
      <header className="border-b border-white/5 bg-brand-bg/95 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-bold text-lg">
            <span className="text-2xl">⚡</span>
            <span className="text-white">ZapScript</span>
          </Link>
          <Link href="/cadastro?utm_source=lp&utm_campaign=contabilidade" className="text-sm bg-brand-primary text-black font-bold px-4 py-2 rounded-xl hover:opacity-90 transition-opacity">
            Começar grátis →
          </Link>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-16">

        {/* Hero */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 bg-brand-primary/10 border border-brand-primary/20 rounded-full px-4 py-1.5 text-sm font-medium text-brand-primary mb-6">
            🧮 Feito para escritórios de contabilidade
          </div>
          <h1 className="text-3xl sm:text-5xl font-bold text-white leading-tight mb-5">
            Seus clientes mandam tudo por áudio.<br />
            <span className="text-brand-primary">O ZapScript lê por você.</span>
          </h1>
          <p className="text-lg text-brand-muted max-w-2xl mx-auto leading-relaxed">
            Dúvidas fiscais, prazos, solicitações — o cliente grava e manda. O ZapScript conecta ao WhatsApp do escritório e converte cada áudio automaticamente, com resumo dos pontos principais. Você nunca mais perde um prazo escondido num áudio de 5 minutos.
          </p>
          <p className="text-brand-primary font-medium max-w-2xl mx-auto mt-4">
            Um robô convertendo os áudios do seu escritório 24 horas por dia — mesmo enquanto você dorme.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href="/cadastro?utm_source=lp&utm_campaign=contabilidade" className="inline-flex items-center gap-2 bg-brand-primary text-black font-bold text-lg px-8 py-4 rounded-2xl hover:opacity-90 transition-opacity">
              Testar grátis no meu escritório →
            </Link>
            <span className="text-xs text-brand-muted">✓ Sem cartão · ✓ 100 áudios/mês grátis</span>
          </div>
        </div>

        {/* Dores */}
        <div className="mb-16">
          <h2 className="text-2xl font-bold text-white text-center mb-8">O dia a dia de quem atende cliente por WhatsApp</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            {DORES.map((d, i) => (
              <div key={i} className="rounded-2xl p-6 border border-white/10 bg-white/3">
                <div className="text-3xl mb-3">{d.icon}</div>
                <div className="text-lg font-bold text-white mb-2">{d.title}</div>
                <p className="text-sm text-brand-muted leading-relaxed">{d.text}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Como aparece no WhatsApp */}
        <div className="mb-16 rounded-2xl p-8 border border-brand-primary/20" style={{ background: 'rgba(16,185,129,.05)' }}>
          <h2 className="text-2xl font-bold text-white text-center mb-2">Veja como aparece no seu WhatsApp</h2>
          <p className="text-brand-muted text-center mb-8 max-w-xl mx-auto">
            O áudio do cliente chega e a transcrição com resumo volta sozinha — na mesma conversa, em segundos.
          </p>
          <div className="grid md:grid-cols-2 gap-8 items-center">
            <ConversationDemo contactName="Cliente — Documentos do mês" audioDuration="1:12" />
            <div className="space-y-5">
              <div className="flex gap-3">
                <span className="w-9 h-9 flex-shrink-0 rounded-full bg-brand-primary/15 text-brand-primary flex items-center justify-center text-lg">📱</span>
                <div>
                  <p className="font-semibold text-white">Conecte uma vez</p>
                  <p className="text-sm text-brand-muted">Escaneie o QR Code, como no WhatsApp Web. Leva 2 minutos.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <span className="w-9 h-9 flex-shrink-0 rounded-full bg-brand-primary/15 text-brand-primary flex items-center justify-center text-lg">🎤</span>
                <div>
                  <p className="font-semibold text-white">Receba o áudio normalmente</p>
                  <p className="text-sm text-brand-muted">O cliente manda o áudio como sempre — você não muda nada.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <span className="w-9 h-9 flex-shrink-0 rounded-full bg-brand-primary/15 text-brand-primary flex items-center justify-center text-lg">⚡</span>
                <div>
                  <p className="font-semibold text-white">A transcrição volta sozinha</p>
                  <p className="text-sm text-brand-muted">Texto + resumo com os pontos principais, sem você ouvir nada.</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Benefícios */}
        <div className="mb-16">
          <h2 className="text-2xl font-bold text-white text-center mb-8">Por que escritórios contábeis escolhem o ZapScript</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {BENEFICIOS.map((b, i) => (
              <div key={i} className="rounded-2xl p-6 border border-white/10 bg-white/3 flex gap-4">
                <div className="text-2xl shrink-0">{b.icon}</div>
                <div>
                  <div className="font-bold text-white mb-1">{b.title}</div>
                  <p className="text-sm text-brand-muted leading-relaxed">{b.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Preço */}
        <div className="mb-16 text-center">
          <h2 className="text-2xl font-bold text-white mb-3">Comece grátis, evolua quando precisar</h2>
          <p className="text-brand-muted mb-6 max-w-xl mx-auto">
            Até 100 áudios por mês no plano gratuito (Core), sem cartão. Para o volume de um escritório, o plano Profissional sai por <span className="text-brand-primary font-semibold">{proPriceLabel}</span> — com áudios ilimitados, atendimento automático por IA, resumo com IA e exportação em PDF.
          </p>
          <Link href="/cadastro?utm_source=lp&utm_campaign=contabilidade" className="inline-flex items-center gap-2 bg-brand-primary text-black font-bold text-lg px-10 py-4 rounded-2xl hover:opacity-90 transition-opacity">
            Criar conta grátis →
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

        {/* CTA final */}
        <div className="text-center py-12 rounded-2xl border border-brand-primary/20" style={{ background: 'rgba(16,185,129,.05)' }}>
          <h2 className="text-2xl font-bold text-white mb-3">Pronto para parar de ouvir áudio de cliente?</h2>
          <p className="text-brand-muted mb-6">Conecte o número do escritório e veja a conversão funcionar em minutos.</p>
          <Link href="/cadastro?utm_source=lp&utm_campaign=contabilidade" className="inline-flex items-center gap-2 bg-brand-primary text-black font-bold text-lg px-10 py-4 rounded-2xl hover:opacity-90 transition-opacity">
            Começar grátis agora →
          </Link>
          <p className="text-xs text-brand-muted mt-4">✓ Sem cartão &nbsp;·&nbsp; ✓ Sem fidelidade &nbsp;·&nbsp; ✓ Cancele quando quiser</p>
        </div>
      </div>

      <footer className="border-t border-white/5 py-8 text-center text-xs text-brand-muted">
        <p>© {new Date().getFullYear()} ZapScript · <Link href="/" className="hover:text-brand-primary">Voltar ao site</Link> · <Link href="/privacidade" className="hover:text-brand-primary">Privacidade</Link></p>
        <p className="mt-1 text-brand-muted/50">Conversão automática de áudios do WhatsApp para escritórios de contabilidade. Servidores no Brasil, conformidade com a LGPD.</p>
      </footer>
    </div>
  );
}
