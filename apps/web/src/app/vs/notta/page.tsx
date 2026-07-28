import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'ZapScript vs Notta — Qual converte áudio do WhatsApp melhor?',
  description: 'Comparação entre ZapScript e Notta para converter áudios do WhatsApp: automação no seu número, português do Brasil, preço em real, privacidade e resumo com IA.',
  keywords: 'zapscript vs notta, notta whatsapp, alternativa notta, converter audio whatsapp portugues, notta em portugues',
  alternates: { canonical: 'https://www.zapscript.me/vs/notta' },
  openGraph: {
    title: 'ZapScript vs Notta — Qual é o melhor para o WhatsApp?',
    description: 'A Notta é um app de transcrição de reuniões e arquivos; o ZapScript converte automaticamente os áudios do seu WhatsApp, em português, no seu próprio número.',
    url: 'https://www.zapscript.me/vs/notta',
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
      name: 'Qual a diferença entre ZapScript e Notta?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'A Notta é um app geral de transcrição de reuniões e upload de arquivos de áudio/vídeo. O ZapScript é especializado em WhatsApp: conecta no seu número e converte automaticamente todo áudio recebido em texto e resumo, em português do Brasil, com preço em real e foco em LGPD.',
      },
    },
    {
      '@type': 'Question',
      name: 'A Notta converte áudio do WhatsApp automaticamente?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Não automaticamente. Na Notta você precisaria exportar cada áudio do WhatsApp e fazer upload manual. O ZapScript funciona direto no seu número conectado — todo áudio que chega já é convertido sozinho, sem upload.',
      },
    },
    {
      '@type': 'Question',
      name: 'O ZapScript tem servidores no Brasil?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Sim. O ZapScript processa em servidores em São Paulo, com criptografia AES-256 e conformidade LGPD, e nunca armazena o áudio. A Notta opera com infraestrutura internacional.',
      },
    },
  ],
};

const ROWS = [
  { feature: 'Foco do produto',        zap: 'Áudio do WhatsApp', other: 'Reuniões e upload de arquivos' },
  { feature: 'Funcionamento',          zap: '100% automático no seu número', other: 'Upload/gravação manual' },
  { feature: 'Idioma',                 zap: 'Português do Brasil nativo', other: 'Multi-idioma genérico' },
  { feature: 'Conecta no WhatsApp',    zap: '✅ Sim, via QR Code', other: '❌ Não nativo' },
  { feature: 'Resumo com IA',          zap: '✅ Incluído em toda conversão', other: '✅ Em planos pagos' },
  { feature: 'Preço',                  zap: 'Em real (R$), plano Free', other: 'Em dólar (US$)' },
  { feature: 'Modo Privado',           zap: '✅ Incluído',         other: '❌ Não aplicável' },
  { feature: 'Áudio armazenado',       zap: '❌ Nunca (descartado)', other: 'Arquivos ficam na nuvem' },
  { feature: 'Servidores no Brasil',   zap: '✅ São Paulo',        other: '❌ Exterior' },
  { feature: 'Conformidade LGPD',      zap: '✅ Completo',         other: 'Foco internacional' },
];

const FAQS = [
  {
    q: 'Qual a diferença entre ZapScript e Notta?',
    a: 'A Notta é um transcritor de uso geral — reuniões online e upload de arquivos de áudio/vídeo. O ZapScript faz uma coisa só, muito bem: conecta no SEU WhatsApp e converte automaticamente todo áudio recebido em texto e resumo, em português do Brasil.',
  },
  {
    q: 'Dá para usar a Notta para áudio do WhatsApp?',
    a: 'Daria, mas manualmente: você teria que salvar cada áudio e fazer upload na Notta. Com o ZapScript, você conecta o número uma vez e a conversão acontece sozinha, sem upload e sem encaminhar nada.',
  },
  {
    q: 'O que acontece com o meu áudio?',
    a: 'No ZapScript o áudio é processado e descartado — nunca fica armazenado. As conversões são criptografadas (AES-256-GCM) e os servidores ficam em São Paulo, com conformidade LGPD.',
  },
  {
    q: 'Quanto custa o ZapScript?',
    a: 'O plano Core inclui até 100 áudios de conversão por mês, em real, sem cartão. O Profissional custa R$49/mês (ou R$295/ano) com áudios ilimitados, atendimento automático por IA, resumo com IA, Modo Privado e histórico.',
  },
];

const breadcrumbSchema = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Início',            item: 'https://www.zapscript.me' },
    { '@type': 'ListItem', position: 2, name: 'ZapScript vs Notta', item: 'https://www.zapscript.me/vs/notta' },
  ],
};

export default function VsNottaPage() {
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
            ZapScript vs Notta<br />
            <span className="text-brand-primary">Qual converte melhor?</span>
          </h1>
          <p className="text-lg text-brand-muted max-w-2xl mx-auto leading-relaxed">
            A Notta é um transcritor de uso geral (reuniões e upload de arquivos); o ZapScript converte automaticamente os áudios do seu WhatsApp, em português do Brasil. Veja a diferença na prática.
          </p>
          <p className="text-brand-primary font-medium max-w-2xl mx-auto mt-4">
            Seu robô particular, convertendo áudio em texto 24 horas por dia — sem upload, sem encaminhar nada.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 mb-16">
          <div className="rounded-2xl p-6 border border-brand-primary/30" style={{ background: 'rgba(16,185,129,.06)' }}>
            <div className="text-xs font-mono uppercase tracking-widest text-brand-primary mb-2">ZapScript</div>
            <div className="text-xl font-bold text-white mb-3">Especializado em WhatsApp, em português</div>
            <ul className="space-y-2 text-sm text-brand-muted">
              <li>✅ Conecta no seu número — sem upload</li>
              <li>✅ Português do Brasil, preço em real</li>
              <li>✅ Resumo inteligente por IA em toda conversão</li>
              <li>✅ Áudio nunca armazenado, Modo Privado</li>
              <li>✅ Criptografia AES-256, servidores em SP (LGPD)</li>
            </ul>
            <Link href="/cadastro" className="mt-5 block text-center bg-brand-primary text-black font-bold py-3 rounded-xl hover:opacity-90 transition-opacity">
              Começar grátis →
            </Link>
          </div>
          <div className="rounded-2xl p-6 border border-white/10 bg-white/3">
            <div className="text-xs font-mono uppercase tracking-widest text-brand-muted mb-2">Notta</div>
            <div className="text-xl font-bold text-white mb-3">Transcrição geral de reuniões e arquivos</div>
            <ul className="space-y-2 text-sm text-brand-muted">
              <li>⚠️ Foco em reuniões e upload de arquivos</li>
              <li>⚠️ Multi-idioma genérico; preço em dólar</li>
              <li>❌ Não conecta nativamente no WhatsApp</li>
              <li>❌ Áudio de WhatsApp exigiria upload manual</li>
              <li>❌ Infraestrutura no exterior</li>
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
                  <th className="px-5 py-4 text-center text-brand-muted font-medium">Notta</th>
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
          <h2 className="text-xl font-bold text-white mb-4">Upload manual vs conversão automática</h2>
          <div className="grid sm:grid-cols-2 gap-6 text-sm text-brand-muted leading-relaxed">
            <div>
              <p className="font-semibold text-white mb-2">Com a Notta</p>
              <p>Boa para transcrever reuniões e arquivos que você sobe. Para um áudio recebido no WhatsApp, é preciso salvar e fazer upload de cada um — e os arquivos ficam armazenados na nuvem deles.</p>
            </div>
            <div>
              <p className="font-semibold text-white mb-2">Com o ZapScript</p>
              <p>O áudio chega no seu número conectado → o ZapScript converte em background → texto e resumo aparecem em segundos. Sem upload, sem encaminhar, e o áudio nunca é armazenado.</p>
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
          <p className="text-brand-muted mb-6">Até 100 áudios por mês grátis. Upgrade quando quiser. Cancele a qualquer hora.</p>
          <Link href="/cadastro" className="inline-flex items-center gap-2 bg-brand-primary text-black font-bold text-lg px-10 py-4 rounded-2xl hover:opacity-90 transition-opacity">
            Criar minha conta grátis →
          </Link>
          <p className="text-xs text-brand-muted mt-4">✓ Sem cartão &nbsp;·&nbsp; ✓ Sem fidelidade &nbsp;·&nbsp; ✓ Cancele quando quiser</p>
        </div>
      </div>

      <footer className="border-t border-white/5 py-8 text-center text-xs text-brand-muted">
        <p>© {new Date().getFullYear()} ZapScript · <Link href="/" className="hover:text-brand-primary">Voltar ao site</Link> · <Link href="/privacidade" className="hover:text-brand-primary">Privacidade</Link></p>
        <p className="mt-1 text-brand-muted/50">Esta página é um comparativo informativo independente. As informações sobre a Notta são baseadas em uso público do serviço e podem mudar.</p>
      </footer>
    </div>
  );
}
