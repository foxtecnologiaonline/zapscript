import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'ZapScript vs Zapia — Qual é melhor para converter áudio do WhatsApp?',
  description: 'Comparação entre ZapScript e Zapia para converter áudios do WhatsApp: assistente geral vs ferramenta especializada, privacidade da conversão e recursos para uso profissional.',
  keywords: 'zapscript vs zapia, zapia transcrição whatsapp, alternativa zapia, converter audio whatsapp, zapia audio texto',
  alternates: { canonical: 'https://www.zapscript.me/vs/zapia' },
  openGraph: {
    title: 'ZapScript vs Zapia — Qual converte áudio do WhatsApp melhor?',
    description: 'O Zapia é um assistente de IA multifuncional; o ZapScript é especializado em conversão de áudio, com Modo Privado e automação para uso profissional.',
    url: 'https://www.zapscript.me/vs/zapia',
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
      name: 'Qual a diferença entre ZapScript e Zapia?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'O Zapia é um assistente de IA multifuncional para o WhatsApp (agenda compromissos, faz cotações, busca informações, entre outras dezenas de funções), e a transcrição de áudio é um recurso a mais dentro desse pacote. O ZapScript é especializado só em áudio do WhatsApp: conversão, resumo com IA, Modo Privado e, nos planos pagos, atendimento automático completo para quem usa o WhatsApp para trabalhar.',
      },
    },
    {
      '@type': 'Question',
      name: 'A transcrição do Zapia aparece para quem enviou o áudio?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Pelo que o Zapia divulga publicamente, quando um áudio é transcrito automaticamente, o texto é enviado de volta na própria conversa, com um aviso indicando que foi transcrito pelo Zapia — ou seja, a outra pessoa vê que o áudio dela virou texto. No ZapScript, o Modo Privado (ligado por padrão nos planos pagos) mantém o texto e o resumo visíveis só para você — quem mandou o áudio nunca sabe que ele foi convertido.',
      },
    },
    {
      '@type': 'Question',
      name: 'O Zapia serve para atendimento automático de clientes?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'O Zapia é voltado para uso pessoal (assistente do dia a dia). O ZapScript, no Plano Profissional, inclui atendimento automático por IA 24/7 no seu número comercial, com fila de conversas, base de conhecimento própria e métricas — um caso de uso diferente do que o Zapia propõe.',
      },
    },
  ],
};

const ROWS = [
  { feature: 'Foco do produto',         zap: 'Especializado em áudio do WhatsApp', other: 'Assistente de IA multifuncional (agenda, busca, cotação...)' },
  { feature: 'Conversão de áudio',      zap: 'Recurso principal, com resumo por IA', other: 'Um recurso entre dezenas de funções do app' },
  { feature: 'Visibilidade da transcrição', zap: '✅ Modo Privado — só você vê', other: '⚠️ Texto volta na conversa, visível a quem enviou' },
  { feature: 'Atendimento automático (negócio)', zap: '✅ Incluído no Plano Profissional', other: '❌ Não é o propósito do produto' },
  { feature: 'Exportação profissional', zap: '✅ PDF, Docx, CSV, Excel',   other: '❌ Não divulgado' },
  { feature: 'Histórico pesquisável de conversões', zap: '✅ Por data e contato', other: '❌ Não divulgado' },
  { feature: 'Preço',                   zap: 'Core grátis; Profissional R$49/mês', other: 'Gratuito (modelo de negócio amplo)' },
  { feature: 'Criptografia e servidores', zap: 'AES-256-GCM, servidores no Brasil (LGPD)', other: 'Não divulgado publicamente' },
];

const FAQS = [
  {
    q: 'Qual a diferença entre ZapScript e Zapia?',
    a: 'O Zapia é um assistente de IA para o dia a dia — agenda compromissos, faz buscas, cotações e mais de vinte outras funções, e a transcrição de áudio é uma delas. O ZapScript faz uma coisa só, muito bem feita: conversão de áudio do WhatsApp em texto e resumo, com foco em quem usa o WhatsApp para trabalhar (corretores, advogados, vendedores, clínicas, atendimento).',
  },
  {
    q: 'A pessoa que me manda áudio fica sabendo que eu converti?',
    a: 'Depende da ferramenta. Pelo que o Zapia divulga, a transcrição automática aparece de volta na conversa com um aviso visível para quem mandou o áudio. No ZapScript, o Modo Privado (padrão nos planos pagos) mantém a conversão só para você — quem te mandou o áudio não vê nada diferente do lado dele.',
  },
  {
    q: 'O Zapia serve para atender clientes no WhatsApp comercial?',
    a: 'O Zapia é pensado para assistência pessoal. Se você precisa de atendimento automático por IA para clientes — fila de conversas, base de conhecimento, métricas — isso é o que o Plano Profissional do ZapScript entrega, e não é o foco do Zapia.',
  },
  {
    q: 'Quanto custa o ZapScript?',
    a: 'O plano Core inclui até 200 áudios de conversão por mês, sem cartão. O Profissional (R$49/mês) tem áudios ilimitados, atendimento automático por IA, resumo com IA e Modo Privado automático.',
  },
];

const breadcrumbSchema = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Início',           item: 'https://www.zapscript.me' },
    { '@type': 'ListItem', position: 2, name: 'ZapScript vs Zapia', item: 'https://www.zapscript.me/vs/zapia' },
  ],
};

export default function VsZapiaPage() {
  return (
    <div className="min-h-screen bg-brand-bg text-brand-text">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />

      <header className="border-b border-white/5 bg-brand-bg/95 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-bold text-lg">
            <span className="text-2xl">⚡</span>
            <span className="text-white">ZapScript</span>
          </Link>
          <Link href="/cadastro" className="text-sm bg-brand-primary text-black font-bold px-4 py-2 rounded-xl hover:opacity-90 transition-opacity">
            Começar grátis →
          </Link>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-16">

        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 bg-brand-primary/10 border border-brand-primary/20 rounded-full px-4 py-1.5 text-sm font-medium text-brand-primary mb-6">
            Comparativo independente
          </div>
          <h1 className="text-3xl sm:text-5xl font-bold text-white leading-tight mb-5">
            ZapScript vs Zapia<br />
            <span className="text-brand-primary">Assistente geral ou ferramenta especializada?</span>
          </h1>
          <p className="text-lg text-brand-muted max-w-2xl mx-auto leading-relaxed">
            O Zapia é um assistente de IA para o dia a dia, com a transcrição como uma entre dezenas de funções. O ZapScript é feito só para converter áudio do WhatsApp — com privacidade e recursos para quem usa o WhatsApp para trabalhar.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 mb-16">
          <div className="rounded-2xl p-6 border border-brand-primary/30" style={{ background: 'rgba(16,185,129,.06)' }}>
            <div className="text-xs font-mono uppercase tracking-widest text-brand-primary mb-2">ZapScript</div>
            <div className="text-xl font-bold text-white mb-3">Especializado em áudio, com privacidade e automação</div>
            <ul className="space-y-2 text-sm text-brand-muted">
              <li>✅ Conversão e resumo com IA como foco único do produto</li>
              <li>✅ Modo Privado — a conversão fica só com você</li>
              <li>✅ Atendimento automático por IA no plano Profissional</li>
              <li>✅ Exportação profissional (PDF, Docx, CSV, Excel)</li>
              <li>✅ Criptografia AES-256, servidores no Brasil (LGPD)</li>
            </ul>
            <Link href="/cadastro" className="mt-5 block text-center bg-brand-primary text-black font-bold py-3 rounded-xl hover:opacity-90 transition-opacity">
              Começar grátis →
            </Link>
          </div>
          <div className="rounded-2xl p-6 border border-white/10 bg-white/3">
            <div className="text-xs font-mono uppercase tracking-widest text-brand-muted mb-2">Zapia</div>
            <div className="text-xl font-bold text-white mb-3">Assistente de IA multifuncional</div>
            <ul className="space-y-2 text-sm text-brand-muted">
              <li>⚠️ Transcrição é 1 de mais de 20 funções do app</li>
              <li>⚠️ Transcrição volta na conversa, visível a quem mandou o áudio</li>
              <li>❌ Não é voltado para atendimento de clientes/negócio</li>
              <li>❌ Sem exportação profissional divulgada</li>
              <li>❌ Infraestrutura/LGPD não divulgadas publicamente</li>
            </ul>
          </div>
        </div>

        <div className="mb-16">
          <h2 className="text-2xl font-bold text-white text-center mb-8">Comparativo funcionalidade a funcionalidade</h2>
          <div className="overflow-x-auto rounded-2xl border border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="px-5 py-4 text-left text-brand-muted font-medium">Recurso</th>
                  <th className="px-5 py-4 text-center font-bold text-brand-primary bg-brand-primary/5">ZapScript ⚡</th>
                  <th className="px-5 py-4 text-center text-brand-muted font-medium">Zapia</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {ROWS.map((row, i) => (
                  <tr key={i}>
                    <td className="px-5 py-3.5 text-brand-text-secondary text-sm font-medium">{row.feature}</td>
                    <td className="px-5 py-3.5 text-center text-sm font-semibold text-brand-primary bg-brand-primary/3">{row.zap}</td>
                    <td className="px-5 py-3.5 text-center text-sm text-brand-muted">{row.other}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mb-16 rounded-2xl p-8 border border-white/10 bg-white/3">
          <h2 className="text-xl font-bold text-white mb-4">Assistente pessoal vs ferramenta de trabalho</h2>
          <div className="grid sm:grid-cols-2 gap-6 text-sm text-brand-muted leading-relaxed">
            <div>
              <p className="font-semibold text-white mb-2">Com o Zapia</p>
              <p>Bom para quem quer um assistente único para várias tarefas do dia a dia, incluindo transcrever um áudio ocasional. A transcrição volta visível na própria conversa, e não há recursos voltados para atendimento comercial ou exportação de conversões.</p>
            </div>
            <div>
              <p className="font-semibold text-white mb-2">Com o ZapScript</p>
              <p>Pensado para quem recebe áudio de trabalho o dia inteiro: conversão automática no seu número, resumo com IA, Modo Privado por padrão, histórico pesquisável e, se precisar, atendimento automático completo para clientes no plano Profissional.</p>
            </div>
          </div>
        </div>

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
          <h2 className="text-2xl font-bold text-white mb-3">Comece grátis — sem cartão de crédito</h2>
          <p className="text-brand-muted mb-6">Até 200 áudios por mês grátis. Upgrade quando quiser. Cancele a qualquer hora.</p>
          <Link href="/cadastro" className="inline-flex items-center gap-2 bg-brand-primary text-black font-bold text-lg px-10 py-4 rounded-2xl hover:opacity-90 transition-opacity">
            Criar minha conta grátis →
          </Link>
          <p className="text-xs text-brand-muted mt-4">✓ Sem cartão &nbsp;·&nbsp; ✓ Sem fidelidade &nbsp;·&nbsp; ✓ Cancele quando quiser</p>
        </div>
      </div>

      <footer className="border-t border-white/5 py-8 text-center text-xs text-brand-muted">
        <p>© {new Date().getFullYear()} ZapScript · <Link href="/" className="hover:text-brand-primary">Voltar ao site</Link> · <Link href="/comparativos" className="hover:text-brand-primary">Outros comparativos</Link> · <Link href="/blog" className="hover:text-brand-primary">Blog</Link> · <Link href="/privacidade" className="hover:text-brand-primary">Privacidade</Link></p>
        <p className="mt-1 text-brand-muted/50">Esta página é um comparativo informativo independente. As informações sobre o Zapia são baseadas em divulgação pública do serviço e podem mudar.</p>
      </footer>
    </div>
  );
}
