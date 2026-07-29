import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'ZapScript vs Transkriptor — Qual converte áudio do WhatsApp melhor?',
  description: 'Comparação entre ZapScript e Transkriptor para converter áudios do WhatsApp: automação no seu número, português do Brasil, preço em real, privacidade e resumo com IA.',
  keywords: 'zapscript vs transkriptor, transkriptor whatsapp, alternativa transkriptor, transkriptor em portugues, transkriptor preço brasil',
  alternates: { canonical: 'https://www.zapscript.me/vs/transkriptor' },
  openGraph: {
    title: 'ZapScript vs Transkriptor — Qual é o melhor para o WhatsApp?',
    description: 'O Transkriptor transcreve arquivos enviados manualmente; o ZapScript converte automaticamente os áudios do seu WhatsApp, em português, no seu próprio número.',
    url: 'https://www.zapscript.me/vs/transkriptor',
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
      name: 'Qual a diferença entre ZapScript e Transkriptor?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'O Transkriptor é uma ferramenta genérica de transcrição de arquivos de áudio e vídeo, com upload manual. O ZapScript é especializado em WhatsApp: conecta no seu número e converte automaticamente todo áudio recebido em texto e resumo, em português do Brasil, com preço em real.',
      },
    },
    {
      '@type': 'Question',
      name: 'O Transkriptor converte áudio do WhatsApp automaticamente?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Não. No Transkriptor você precisa baixar o áudio do WhatsApp e subir manualmente para cada transcrição. O ZapScript funciona direto no seu número conectado — todo áudio que chega já é convertido sozinho, sem nenhuma ação manual.',
      },
    },
    {
      '@type': 'Question',
      name: 'O ZapScript tem plano gratuito como o Transkriptor?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Sim. O ZapScript tem plano Core com até 100 áudios de conversão por mês, sem cartão de crédito, com preço em real e suporte total ao português do Brasil.',
      },
    },
  ],
};

const ROWS = [
  { feature: 'Foco do produto',        zap: 'Áudio do WhatsApp', other: 'Upload genérico de áudio/vídeo' },
  { feature: 'Funcionamento',          zap: '100% automático no seu número', other: 'Manual (baixar e subir o arquivo)' },
  { feature: 'Idioma principal',       zap: 'Português do Brasil', other: 'Multilíngue genérico' },
  { feature: 'Conecta no WhatsApp',    zap: '✅ Sim, via QR Code', other: '❌ Não nativo' },
  { feature: 'Resumo com IA',          zap: '✅ Incluído em toda conversão', other: '✅ Em planos pagos' },
  { feature: 'Preço',                  zap: 'Em real (R$), plano Free', other: 'Em dólar (US$), por créditos/minutos' },
  { feature: 'Modo Privado',           zap: '✅ Incluído',         other: '❌ Não aplicável' },
  { feature: 'Criptografia',           zap: 'AES-256-GCM',         other: 'Documentada (foco internacional)' },
  { feature: 'Servidores no Brasil',   zap: '✅ São Paulo',        other: '❌ Exterior' },
  { feature: 'Conformidade LGPD',      zap: '✅ Completo',         other: 'Foco em GDPR/EUA' },
];

const FAQS = [
  {
    q: 'Qual a diferença entre ZapScript e Transkriptor?',
    a: 'O Transkriptor é uma ferramenta de transcrição genérica: você sobe um arquivo de áudio ou vídeo e recebe o texto. O ZapScript faz uma coisa só: conecta no SEU número de WhatsApp e converte automaticamente todo áudio recebido, sem precisar baixar e subir nada.',
  },
  {
    q: 'Dá para usar o Transkriptor para áudio do WhatsApp?',
    a: 'Daria, mas de forma manual: você precisaria salvar cada áudio recebido e fazer upload um por um. Com o ZapScript, você conecta o número uma única vez e a conversão acontece automaticamente para cada novo áudio.',
  },
  {
    q: 'O ZapScript é melhor em português?',
    a: 'O ZapScript é feito para o português do Brasil e para a linguagem natural de áudio de WhatsApp (gírias, abreviações, ruído de fundo). Ferramentas genéricas como o Transkriptor têm foco multilíngue, sem otimização específica para esse contexto.',
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
    { '@type': 'ListItem', position: 1, name: 'Início',                  item: 'https://www.zapscript.me' },
    { '@type': 'ListItem', position: 2, name: 'ZapScript vs Transkriptor', item: 'https://www.zapscript.me/vs/transkriptor' },
  ],
};

export default function VsTranskriptorPage() {
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
            ZapScript vs Transkriptor<br />
            <span className="text-brand-primary">Qual converte melhor?</span>
          </h1>
          <p className="text-lg text-brand-muted max-w-2xl mx-auto leading-relaxed">
            O Transkriptor transcreve arquivos enviados manualmente; o ZapScript converte automaticamente os áudios do seu WhatsApp, em português do Brasil. Veja a diferença na prática.
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
              <li>✅ Conecta no seu número — sem baixar e subir arquivo</li>
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
            <div className="text-xs font-mono uppercase tracking-widest text-brand-muted mb-2">Transkriptor</div>
            <div className="text-xl font-bold text-white mb-3">Transcrição genérica de arquivos</div>
            <ul className="space-y-2 text-sm text-brand-muted">
              <li>⚠️ Foco em upload manual de áudio/vídeo</li>
              <li>⚠️ Multilíngue genérico; preço em dólar</li>
              <li>❌ Não conecta nativamente no WhatsApp</li>
              <li>❌ Áudio de WhatsApp exigiria baixar e subir manual</li>
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
                  <th className="px-5 py-4 text-center text-brand-muted font-medium">Transkriptor</th>
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
          <h2 className="text-xl font-bold text-white mb-4">Upload manual vs conexão automática no WhatsApp</h2>
          <div className="grid sm:grid-cols-2 gap-6 text-sm text-brand-muted leading-relaxed">
            <div>
              <p className="font-semibold text-white mb-2">Com o Transkriptor</p>
              <p>Bom para transcrever arquivos avulsos de áudio ou vídeo. Para áudio de WhatsApp, porém, você precisaria salvar cada arquivo manualmente e fazer upload — sem automação nem conexão direta com o número.</p>
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
          <p className="text-brand-muted mb-6">Até 100 áudios por mês grátis. Upgrade quando quiser. Cancele a qualquer hora.</p>
          <Link href="/cadastro" className="inline-flex items-center gap-2 bg-brand-primary text-black font-bold text-lg px-10 py-4 rounded-2xl hover:opacity-90 transition-opacity">
            Criar minha conta grátis →
          </Link>
          <p className="text-xs text-brand-muted mt-4">✓ Sem cartão &nbsp;·&nbsp; ✓ Sem fidelidade &nbsp;·&nbsp; ✓ Cancele quando quiser</p>
        </div>
      </div>

      <footer className="border-t border-white/5 py-8 text-center text-xs text-brand-muted">
        <p>© {new Date().getFullYear()} ZapScript · <Link href="/" className="hover:text-brand-primary">Voltar ao site</Link> · <Link href="/privacidade" className="hover:text-brand-primary">Privacidade</Link></p>
        <p className="mt-1 text-brand-muted/50">Esta página é um comparativo informativo independente. As informações sobre o Transkriptor são baseadas em uso público do serviço e podem mudar.</p>
      </footer>
    </div>
  );
}
