import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'ZapScript vs ZapVox — Automação real ou extensão manual para o WhatsApp?',
  description: 'Compare ZapScript e ZapVox para converter áudio do WhatsApp em texto: automação direto no número vs. extensão de navegador com clique manual. Preço, funcionamento e privacidade.',
  keywords: 'zapscript vs zapvox, zapvox alternativa, zapvox preço, zapvoxia, transcrever áudio whatsapp extensão navegador',
  alternates: { canonical: 'https://www.zapscript.me/vs/zapvox' },
  openGraph: {
    title: 'ZapScript vs ZapVox — Automação real ou extensão manual?',
    description: 'O ZapVox é uma extensão que transcreve áudio do WhatsApp Web, um clique por vez. O ZapScript converte automaticamente todo áudio do seu número, sem navegador aberto.',
    url: 'https://www.zapscript.me/vs/zapvox',
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
      name: 'Qual a diferença entre ZapScript e ZapVox?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'O ZapVox é uma extensão de navegador: você abre o WhatsApp Web e clica em cada áudio para transcrever manualmente. O ZapScript conecta direto no seu número de WhatsApp e converte automaticamente todo áudio recebido, sem precisar abrir navegador nem clicar em nada.',
      },
    },
    {
      '@type': 'Question',
      name: 'O ZapVox funciona sem estar com o WhatsApp Web aberto?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Não. Por ser uma extensão de navegador, o ZapVox só funciona enquanto o WhatsApp Web está aberto e ativo. O ZapScript roda direto no número conectado, 24 horas por dia, mesmo com o computador desligado.',
      },
    },
    {
      '@type': 'Question',
      name: 'Qual é mais barato, ZapScript ou ZapVox?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Em mensalidade, o ZapVox Pro (R$29,90/mês) é mais barato que o ZapScript Profissional (R$49/mês). A diferença está no que cada um exige: no ZapVox, é preciso abrir o WhatsApp Web e clicar em cada áudio; no ZapScript, a conversão acontece sozinha, para todo áudio, sem clique nem navegador aberto — para quem recebe muitos áudios, o tempo economizado costuma compensar a diferença de preço.',
      },
    },
    {
      '@type': 'Question',
      name: 'O ZapVox funciona no celular?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Só através do WhatsApp Web aberto em um navegador — não há automação dentro do aplicativo do celular. O ZapScript funciona direto no número do WhatsApp, então o texto e o resumo aparecem em qualquer aparelho onde você acessa a conversa.',
      },
    },
  ],
};

const ROWS = [
  { feature: 'Foco do produto',              zap: 'Áudio do WhatsApp',                  other: 'Extensão para WhatsApp Web' },
  { feature: 'Funcionamento',                zap: '100% automático no seu número',      other: 'Manual — clique por áudio' },
  { feature: 'Precisa do WhatsApp Web aberto', zap: '❌ Não precisa',                    other: '✅ Sim, sempre' },
  { feature: 'Roda em segundo plano, 24h',   zap: '✅ Sim',                              other: '❌ Só com o navegador ativo' },
  { feature: 'Funciona sem depender de PC',  zap: '✅ Sim',                              other: '❌ Depende do WhatsApp Web' },
  { feature: 'Resumo com IA',                zap: '✅ Incluído em toda conversão',       other: '✅ Sim' },
  { feature: 'Tradução de áudio',            zap: '—',                                   other: '✅ Sim' },
  { feature: 'Preço',                        zap: 'Core grátis, Profissional R$49/mês', other: 'Free 10/dia, Pro R$29,90/mês' },
  { feature: 'Modo Privado',                 zap: '✅ Incluído',                         other: 'Não informado' },
  { feature: 'Servidores no Brasil / LGPD',  zap: '✅ São Paulo, LGPD',                  other: 'Não informado publicamente' },
];

const FAQS = [
  {
    q: 'Qual a diferença entre ZapScript e ZapVox?',
    a: 'O ZapVox é uma extensão de navegador: você abre o WhatsApp Web e clica em cada áudio para transcrever manualmente, um de cada vez. O ZapScript conecta direto no seu número — todo áudio recebido já chega convertido, sem clique e sem navegador aberto.',
  },
  {
    q: 'Preciso ficar com o WhatsApp Web aberto para usar o ZapVox?',
    a: 'Sim, sempre — é assim que uma extensão de navegador funciona. Se o navegador fechar ou o computador desligar, o ZapVox para. O ZapScript continua convertendo mesmo sem nenhum aparelho seu ligado, porque roda direto no número.',
  },
  {
    q: 'Qual é mais barato?',
    a: 'O ZapVox Pro custa R$29,90/mês, abaixo do Profissional do ZapScript (R$49/mês). A diferença de preço reflete a diferença de esforço: um exige clique manual por áudio, o outro converte tudo sozinho. Para quem recebe poucos áudios pontuais, o ZapVox pode bastar; para volume alto, a automação do ZapScript costuma compensar.',
  },
  {
    q: 'O ZapVox funciona no celular?',
    a: 'Não como automação — só via WhatsApp Web em um navegador. O ZapScript funciona no número do WhatsApp diretamente, então o resultado aparece em qualquer dispositivo, sem precisar de navegador nem extensão.',
  },
];

const breadcrumbSchema = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Início',              item: 'https://www.zapscript.me' },
    { '@type': 'ListItem', position: 2, name: 'ZapScript vs ZapVox', item: 'https://www.zapscript.me/vs/zapvox' },
  ],
};

export default function VsZapVoxPage() {
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
            ZapScript vs ZapVox<br />
            <span className="text-brand-primary">Automação real ou extensão manual?</span>
          </h1>
          <p className="text-lg text-brand-muted max-w-2xl mx-auto leading-relaxed">
            O ZapVox é uma extensão de navegador que transcreve áudio do WhatsApp Web, um clique por vez. O ZapScript conecta direto no seu número e converte automaticamente, sem depender de navegador aberto. Veja a diferença na prática.
          </p>
          <p className="text-brand-primary font-medium max-w-2xl mx-auto mt-4">
            Seu robô particular, convertendo áudio em texto 24 horas por dia — mesmo enquanto você dorme.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 mb-16">
          <div className="rounded-2xl p-6 border border-brand-primary/30" style={{ background: 'rgba(16,185,129,.06)' }}>
            <div className="text-xs font-mono uppercase tracking-widest text-brand-primary mb-2">ZapScript</div>
            <div className="text-xl font-bold text-white mb-3">Automação real, direto no seu número</div>
            <ul className="space-y-2 text-sm text-brand-muted">
              <li>✅ Conecta no seu número — funciona sem navegador aberto</li>
              <li>✅ Roda 24h em segundo plano, mesmo com o PC desligado</li>
              <li>✅ Resumo inteligente por IA em toda conversão</li>
              <li>✅ Modo Privado e histórico pesquisável</li>
              <li>✅ Criptografia AES-256, servidores em SP (LGPD)</li>
            </ul>
            <Link href="/cadastro" className="mt-5 block text-center bg-brand-primary text-black font-bold py-3 rounded-xl hover:opacity-90 transition-opacity">
              Começar grátis →
            </Link>
          </div>
          <div className="rounded-2xl p-6 border border-white/10 bg-white/3">
            <div className="text-xs font-mono uppercase tracking-widest text-brand-muted mb-2">ZapVox</div>
            <div className="text-xl font-bold text-white mb-3">Extensão manual para WhatsApp Web</div>
            <ul className="space-y-2 text-sm text-brand-muted">
              <li>⚠️ Precisa abrir o WhatsApp Web e clicar em cada áudio</li>
              <li>⚠️ Só funciona com o navegador aberto e ativo</li>
              <li>✅ Também traduz áudios, além de resumir</li>
              <li>❌ Não roda em segundo plano nem no celular</li>
              <li>❌ Sem informação pública sobre criptografia/servidores</li>
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
                  <th className="px-5 py-4 text-center text-brand-muted font-medium">ZapVox</th>
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
          <h2 className="text-xl font-bold text-white mb-4">Clique manual vs conexão automática no WhatsApp</h2>
          <div className="grid sm:grid-cols-2 gap-6 text-sm text-brand-muted leading-relaxed">
            <div>
              <p className="font-semibold text-white mb-2">Com o ZapVox</p>
              <p>Bom para transcrever um áudio pontual enquanto você já está no WhatsApp Web, sem instalar nada além da extensão. Para quem recebe muitos áudios ao longo do dia, porém, significa clicar um por um — e nada acontece se o navegador estiver fechado.</p>
            </div>
            <div>
              <p className="font-semibold text-white mb-2">Com o ZapScript</p>
              <p>O áudio chega no seu número conectado → o ZapScript converte em segundo plano → texto e resumo aparecem em segundos, com ou sem o computador ligado. Zero clique, feito para quem recebe áudio o dia inteiro.</p>
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
        <p className="mt-1 text-brand-muted/50">Esta página é um comparativo informativo independente. As informações sobre o ZapVox são baseadas em uso público do serviço (zapvoxia.com.br) e podem mudar.</p>
      </footer>
    </div>
  );
}
