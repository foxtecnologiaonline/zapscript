import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'ZapScript vs Otter.ai — Qual converte áudio do WhatsApp melhor?',
  description: 'Comparação entre ZapScript e Otter.ai para converter áudios do WhatsApp: automação no seu número, português do Brasil, preço em real, privacidade e resumo com IA.',
  keywords: 'zapscript vs otter, otter.ai whatsapp, alternativa otter.ai, converter audio whatsapp portugues, otter.ai em portugues',
  alternates: { canonical: 'https://www.zapscript.me/vs/otter' },
  openGraph: {
    title: 'ZapScript vs Otter.ai — Qual é o melhor para o WhatsApp?',
    description: 'O Otter.ai é focado em reuniões em inglês; o ZapScript converte automaticamente os áudios do seu WhatsApp, em português, no seu próprio número.',
    url: 'https://www.zapscript.me/vs/otter',
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
      name: 'Qual a diferença entre ZapScript e Otter.ai?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'O Otter.ai é uma ferramenta de transcrição de reuniões (Zoom, Google Meet, Teams), otimizada para o inglês. O ZapScript é especializado em WhatsApp: conecta no seu número e converte automaticamente todo áudio recebido em texto e resumo, em português do Brasil, com preço em real.',
      },
    },
    {
      '@type': 'Question',
      name: 'O Otter.ai converte áudio do WhatsApp automaticamente?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Não. No Otter.ai você precisaria exportar e enviar manualmente cada arquivo de áudio. O ZapScript funciona direto no seu número conectado — todo áudio que chega no WhatsApp já é convertido sozinho.',
      },
    },
    {
      '@type': 'Question',
      name: 'O ZapScript funciona melhor em português que o Otter.ai?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'O ZapScript é construído para o português do Brasil e para o jeito que se fala em áudio de WhatsApp. O Otter.ai tem foco histórico no inglês, com suporte mais limitado a outros idiomas.',
      },
    },
  ],
};

const ROWS = [
  { feature: 'Foco do produto',        zap: 'Áudio do WhatsApp', other: 'Reuniões (Zoom, Meet, Teams)' },
  { feature: 'Funcionamento',          zap: '100% automático no seu número', other: 'Manual (enviar/conectar reunião)' },
  { feature: 'Idioma principal',       zap: 'Português do Brasil', other: 'Inglês (outros idiomas limitados)' },
  { feature: 'Conecta no WhatsApp',    zap: '✅ Sim, via QR Code', other: '❌ Não nativo' },
  { feature: 'Resumo com IA',          zap: '✅ Incluído em toda conversão', other: '✅ Em planos pagos' },
  { feature: 'Preço',                  zap: 'Em real (R$), plano Free', other: 'Em dólar (US$)' },
  { feature: 'Modo Privado',           zap: '✅ Incluído',         other: '❌ Não aplicável' },
  { feature: 'Criptografia',           zap: 'AES-256-GCM',         other: 'Documentada (foco corporativo)' },
  { feature: 'Servidores no Brasil',   zap: '✅ São Paulo',        other: '❌ Exterior' },
  { feature: 'Conformidade LGPD',      zap: '✅ Completo',         other: 'Foco em GDPR/EUA' },
];

const FAQS = [
  {
    q: 'Qual a diferença entre ZapScript e Otter.ai?',
    a: 'O Otter.ai nasceu para transcrever reuniões em inglês (Zoom, Meet, Teams) e é ótimo nisso. O ZapScript faz uma coisa só: conecta no SEU número de WhatsApp e converte automaticamente todo áudio recebido em texto e resumo, em português do Brasil.',
  },
  {
    q: 'Dá para usar o Otter.ai para áudio do WhatsApp?',
    a: 'Daria, mas de forma manual: você teria que salvar cada áudio e enviar para o Otter. Com o ZapScript, você conecta o número uma vez e nunca mais precisa encaminhar nada — a conversão acontece sozinha.',
  },
  {
    q: 'O ZapScript é melhor em português?',
    a: 'O ZapScript é feito para o português do Brasil e para a linguagem de áudio de WhatsApp (gírias, abreviações, ruído). O Otter.ai tem foco no inglês, com suporte mais restrito a outros idiomas.',
  },
  {
    q: 'Quanto custa o ZapScript?',
    a: 'O plano Free inclui 15 áudios de conversão por mês, em real, sem cartão. O Pro custa R$37/mês (R$18 no 1º mês) com áudios ilimitados, 2 números, resumo com IA, Modo Privado e histórico.',
  },
];

const breadcrumbSchema = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Início',              item: 'https://www.zapscript.me' },
    { '@type': 'ListItem', position: 2, name: 'ZapScript vs Otter.ai', item: 'https://www.zapscript.me/vs/otter' },
  ],
};

export default function VsOtterPage() {
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
            ZapScript vs Otter.ai<br />
            <span className="text-brand-primary">Qual converte melhor?</span>
          </h1>
          <p className="text-lg text-brand-muted max-w-2xl mx-auto leading-relaxed">
            O Otter.ai é especializado em reuniões em inglês; o ZapScript converte automaticamente os áudios do seu WhatsApp, em português do Brasil. Veja a diferença na prática.
          </p>
          <p className="text-brand-primary font-medium max-w-2xl mx-auto mt-4">
            Seu robô particular, convertendo áudio em texto 24 horas por dia — mesmo enquanto você dorme.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 mb-16">
          <div className="rounded-2xl p-6 border border-brand-primary/30" style={{ background: 'rgba(16,185,129,.06)' }}>
            <div className="text-xs font-mono uppercase tracking-widest text-brand-primary mb-2">ZapScript</div>
            <div className="text-xl font-bold text-white mb-3">Especializado em WhatsApp, em português</div>
            <ul className="space-y-2 text-sm text-brand-muted">
              <li>✅ Conecta no seu número — sem encaminhar nada</li>
              <li>✅ Português do Brasil, preço em real</li>
              <li>✅ Resumo inteligente por IA em toda conversão</li>
              <li>✅ Modo Privado e histórico pesquisável</li>
              <li>✅ Criptografia AES-256, servidores em SP (LGPD)</li>
            </ul>
            <Link href="/cadastro" className="mt-5 block text-center bg-brand-primary text-black font-bold py-3 rounded-xl hover:opacity-90 transition-opacity">
              Começar grátis →
            </Link>
          </div>
          <div className="rounded-2xl p-6 border border-white/10 bg-white/3">
            <div className="text-xs font-mono uppercase tracking-widest text-brand-muted mb-2">Otter.ai</div>
            <div className="text-xl font-bold text-white mb-3">Transcrição de reuniões, em inglês</div>
            <ul className="space-y-2 text-sm text-brand-muted">
              <li>⚠️ Foco em reuniões (Zoom, Meet, Teams)</li>
              <li>⚠️ Otimizado para inglês; preço em dólar</li>
              <li>❌ Não conecta nativamente no WhatsApp</li>
              <li>❌ Áudio de WhatsApp exigiria envio manual</li>
              <li>❌ Foco em GDPR/EUA, não LGPD/Brasil</li>
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
                  <th className="px-5 py-4 text-center text-brand-muted font-medium">Otter.ai</th>
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
          <h2 className="text-xl font-bold text-white mb-4">Reuniões em inglês vs áudio de WhatsApp em português</h2>
          <div className="grid sm:grid-cols-2 gap-6 text-sm text-brand-muted leading-relaxed">
            <div>
              <p className="font-semibold text-white mb-2">Com o Otter.ai</p>
              <p>Excelente para gravar e transcrever reuniões em inglês. Para um áudio recebido no WhatsApp, porém, você precisaria salvar o arquivo e subir manualmente — e a precisão em português é menor.</p>
            </div>
            <div>
              <p className="font-semibold text-white mb-2">Com o ZapScript</p>
              <p>O áudio chega no seu número conectado → o ZapScript converte em background → texto e resumo aparecem em segundos, em português do Brasil. Zero ação sua, produto desenhado só para isso.</p>
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
          <p className="text-brand-muted mb-6">15 áudios por mês grátis. Upgrade quando quiser. Cancele a qualquer hora.</p>
          <Link href="/cadastro" className="inline-flex items-center gap-2 bg-brand-primary text-black font-bold text-lg px-10 py-4 rounded-2xl hover:opacity-90 transition-opacity">
            Criar minha conta grátis →
          </Link>
          <p className="text-xs text-brand-muted mt-4">✓ Sem cartão &nbsp;·&nbsp; ✓ Sem fidelidade &nbsp;·&nbsp; ✓ Cancele quando quiser</p>
        </div>
      </div>

      <footer className="border-t border-white/5 py-8 text-center text-xs text-brand-muted">
        <p>© {new Date().getFullYear()} ZapScript · <Link href="/" className="hover:text-brand-primary">Voltar ao site</Link> · <Link href="/privacidade" className="hover:text-brand-primary">Privacidade</Link></p>
        <p className="mt-1 text-brand-muted/50">Esta página é um comparativo informativo independente. As informações sobre o Otter.ai são baseadas em uso público do serviço e podem mudar.</p>
      </footer>
    </div>
  );
}
