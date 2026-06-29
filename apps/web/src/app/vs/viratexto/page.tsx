import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'ZapScript vs ViraTexto — Comparativo completo de conversão WhatsApp',
  description: 'Comparação detalhada entre ZapScript e ViraTexto: preços, funcionalidades, precisão, privacidade e automação. Veja qual é a melhor opção para converter áudios do WhatsApp.',
  keywords: 'zapscript vs viratexto, alternativa viratexto, melhor app converter whatsapp, viratexto alternativa, conversão whatsapp automática',
  alternates: { canonical: 'https://www.zapscript.me/vs/viratexto' },
  openGraph: {
    title: 'ZapScript vs ViraTexto — Qual é o melhor para converter WhatsApp?',
    description: 'Compare funcionalidades, preço e privacidade. ZapScript oferece conversão automática, resumo com IA e Modo Privado — sem precisar encaminhar áudio para um bot.',
    url: 'https://www.zapscript.me/vs/viratexto',
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
      name: 'Qual a diferença entre ZapScript e ViraTexto?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'O ZapScript funciona de forma 100% automática — você conecta seu número via QR Code e toda mensagem de áudio é convertida automaticamente sem nenhuma ação. O ViraTexto exige que você encaminhe cada áudio manualmente para o bot. Além disso, o ZapScript inclui resumo por IA, Modo Privado e histórico pesquisável, sem necessidade de instalar nada no celular.',
      },
    },
    {
      '@type': 'Question',
      name: 'O ZapScript é mais caro que o ViraTexto?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'O ZapScript tem plano Free com 15 áudios por mês sem custo algum. O plano Pro custa R$39,90/mês (ou R$19,90 no primeiro mês em junho de 2026) e inclui áudios ilimitados, 2 números e funcionalidades que o ViraTexto não oferece, como resumo com IA, Modo Privado e exportação em PDF.',
      },
    },
    {
      '@type': 'Question',
      name: 'O ZapScript é seguro para dados pessoais?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Sim. Todas as conversões são criptografadas com AES-256-GCM — o mesmo padrão dos bancos. O áudio nunca é armazenado: é processado e descartado imediatamente. Os servidores ficam em São Paulo, com conformidade total com a LGPD.',
      },
    },
  ],
};

const ROWS = [
  { feature: 'Funcionamento',          zap: '100% automático',        vira: 'Manual (encaminhar áudio)' },
  { feature: 'Resumo com IA',          zap: '✅ Incluído',            vira: '❌ Não disponível' },
  { feature: 'Modo Privado',           zap: '✅ Incluído',            vira: '❌ Não disponível' },
  { feature: 'Histórico pesquisável',  zap: '✅ Incluído',            vira: '❌ Não disponível' },
  { feature: 'Exportar (PDF/Docx)',    zap: '✅ No plano Pro',        vira: '❌ Não disponível' },
  { feature: 'Instalar no celular',    zap: '❌ Não precisa',         vira: '✅ Necessário encaminhar' },
  { feature: 'Plano gratuito',         zap: '✅ 15 áudios/mês',       vira: '⚠️ Limitado' },
  { feature: 'Precisão PT-BR',         zap: '99% (Whisper OpenAI)',   vira: 'Variável' },
  { feature: 'Criptografia',           zap: 'AES-256-GCM',            vira: 'Não especificado' },
  { feature: 'Conformidade LGPD',      zap: '✅ Completo',            vira: '⚠️ Não documentado' },
  { feature: 'Servidores no Brasil',   zap: '✅ São Paulo',           vira: 'Não especificado' },
];

const FAQS = [
  {
    q: 'Qual a diferença entre ZapScript e ViraTexto?',
    a: 'O ZapScript funciona de forma 100% automática — você conecta seu número uma única vez via QR Code e todo áudio recebido é convertido sem nenhuma ação sua. O ViraTexto exige que você encaminhe cada áudio manualmente para o bot. Isso significa que, com o ZapScript, você nunca mais "esquece" de converter um áudio importante.',
  },
  {
    q: 'O ZapScript funciona com meu número pessoal?',
    a: 'Sim. O ZapScript suporta qualquer número WhatsApp — pessoal ou comercial. No plano Pro você pode conectar até 2 números simultaneamente.',
  },
  {
    q: 'Preciso instalar algo no celular para usar o ZapScript?',
    a: 'Não. O ZapScript funciona 100% via web. Você faz login no painel, conecta seu número escaneando um QR Code (igual ao WhatsApp Web) e pronto — nada é instalado no celular.',
  },
  {
    q: 'O áudio fica armazenado nos servidores do ZapScript?',
    a: 'Não. O áudio é processado e descartado imediatamente após a conversão. Apenas o texto e o resumo são salvos, criptografados com AES-256-GCM (padrão bancário), em servidores em São Paulo.',
  },
  {
    q: 'Como o ZapScript é mais barato que parece?',
    a: 'O plano Free inclui 15 áudios de conversão por mês sem custo algum e sem cartão de crédito. Para volume maior, o Pro custa R$39,90/mês e inclui áudios ilimitados, 2 números, resumo com IA, Modo Privado, histórico completo e exportação em PDF — funcionalidades que bots simples como o ViraTexto não oferecem.',
  },
];

const breadcrumbSchema = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Início',                item: 'https://www.zapscript.me' },
    { '@type': 'ListItem', position: 2, name: 'ZapScript vs ViraTexto', item: 'https://www.zapscript.me/vs/viratexto' },
  ],
};

export default function VsViratextoPage() {
  return (
    <div className="min-h-screen bg-brand-bg text-brand-text" style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />

      {/* Header */}
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

        {/* Hero */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 bg-brand-primary/10 border border-brand-primary/20 rounded-full px-4 py-1.5 text-sm font-medium text-brand-primary mb-6">
            Comparativo independente
          </div>
          <h1 className="text-3xl sm:text-5xl font-bold text-white leading-tight mb-5">
            ZapScript vs ViraTexto<br />
            <span className="text-brand-primary">Qual converte melhor?</span>
          </h1>
          <p className="text-lg text-brand-muted max-w-2xl mx-auto leading-relaxed">
            Comparamos as duas principais opções para converter áudios do WhatsApp em texto. Sem achismo — funcionalidade por funcionalidade.
          </p>
          <p className="text-brand-primary font-medium max-w-2xl mx-auto mt-4">
            Seu robô particular, convertendo áudio em texto 24 horas por dia — mesmo enquanto você dorme.
          </p>
        </div>

        {/* Veredicto rápido */}
        <div className="grid sm:grid-cols-2 gap-4 mb-16">
          <div className="rounded-2xl p-6 border border-brand-primary/30" style={{ background: 'rgba(16,185,129,.06)' }}>
            <div className="text-xs font-mono uppercase tracking-widest text-brand-primary mb-2">ZapScript</div>
            <div className="text-xl font-bold text-white mb-3">100% automático, IA incluída</div>
            <ul className="space-y-2 text-sm text-brand-muted">
              <li>✅ Nenhuma ação necessária — funciona sozinho</li>
              <li>✅ Resumo inteligente por IA (Claude Anthropic)</li>
              <li>✅ Modo Privado — sem "ouvido" no WhatsApp</li>
              <li>✅ Histórico pesquisável de todas as conversões</li>
              <li>✅ Criptografia AES-256, servidores em SP</li>
            </ul>
            <Link href="/cadastro" className="mt-5 block text-center bg-brand-primary text-black font-bold py-3 rounded-xl hover:opacity-90 transition-opacity">
              Começar grátis →
            </Link>
          </div>
          <div className="rounded-2xl p-6 border border-white/10 bg-white/3">
            <div className="text-xs font-mono uppercase tracking-widest text-brand-muted mb-2">ViraTexto</div>
            <div className="text-xl font-bold text-white mb-3">Manual, bot simples</div>
            <ul className="space-y-2 text-sm text-brand-muted">
              <li>⚠️ Exige encaminhar cada áudio manualmente</li>
              <li>❌ Sem resumo por IA</li>
              <li>❌ Sem Modo Privado</li>
              <li>❌ Sem histórico pesquisável</li>
              <li>❌ Privacidade não documentada</li>
            </ul>
          </div>
        </div>

        {/* Tabela comparativa */}
        <div className="mb-16">
          <h2 className="text-2xl font-bold text-white text-center mb-8">Comparativo funcionalidade a funcionalidade</h2>
          <div className="overflow-x-auto rounded-2xl border border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="px-5 py-4 text-left text-brand-muted font-medium">Recurso</th>
                  <th className="px-5 py-4 text-center font-bold text-brand-primary bg-brand-primary/5">ZapScript ⚡</th>
                  <th className="px-5 py-4 text-center text-brand-muted font-medium">ViraTexto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {ROWS.map((row, i) => (
                  <tr key={i}>
                    <td className="px-5 py-3.5 text-brand-text-secondary text-sm font-medium">{row.feature}</td>
                    <td className="px-5 py-3.5 text-center text-sm font-semibold text-brand-primary bg-brand-primary/3">{row.zap}</td>
                    <td className="px-5 py-3.5 text-center text-sm text-brand-muted">{row.vira}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Por que automático importa */}
        <div className="mb-16 rounded-2xl p-8 border border-white/10 bg-white/3">
          <h2 className="text-xl font-bold text-white mb-4">Por que "automático" faz toda a diferença?</h2>
          <div className="grid sm:grid-cols-2 gap-6 text-sm text-brand-muted leading-relaxed">
            <div>
              <p className="font-semibold text-white mb-2">Com o ViraTexto (manual)</p>
              <p>Você recebe o áudio → precisa lembrar de encaminhá-lo para o bot → espera a resposta → volta para a conversa original → lê o texto. São 4-5 passos para cada áudio, e você precisa ser você mesmo a iniciativa toda vez. Se esquecer, o áudio fica para trás.</p>
            </div>
            <div>
              <p className="font-semibold text-white mb-2">Com o ZapScript (automático)</p>
              <p>O áudio chega → o ZapScript converte em background → o texto e o resumo aparecem no painel em segundos. Zero ação sua. Nenhum áudio fica para trás — nem os que chegam enquanto você está em reunião, dirigindo ou dormindo.</p>
            </div>
          </div>
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
        <p className="mt-1 text-brand-muted/50">Esta página é um comparativo informativo independente. As informações sobre o ViraTexto são baseadas em uso público do serviço.</p>
      </footer>
    </div>
  );
}
