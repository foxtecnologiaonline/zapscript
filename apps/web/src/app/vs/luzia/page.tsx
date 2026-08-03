import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'ZapScript vs LuzIA — Qual converte áudio do WhatsApp melhor?',
  description: 'Comparação entre ZapScript e LuzIA para converter áudios do WhatsApp: automação, preço, privacidade e resumo com IA. Veja qual é a melhor opção para o seu uso.',
  keywords: 'zapscript vs luzia, luzia converter audio, alternativa luzia, luzia whatsapp conversão, melhor app converter whatsapp',
  alternates: { canonical: 'https://www.zapscript.me/vs/luzia' },
  openGraph: {
    title: 'ZapScript vs LuzIA — Qual é o melhor para converter WhatsApp?',
    description: 'Compare automação, preço e privacidade. O ZapScript converte todo áudio recebido automaticamente, sem precisar encaminhar nada para um bot.',
    url: 'https://www.zapscript.me/vs/luzia',
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
      name: 'Qual a diferença entre ZapScript e LuzIA para converter áudio?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'A LuzIA é uma assistente de IA multifunção (chat, imagens, resumos) que também converte áudio quando você encaminha a mensagem para ela. O ZapScript é especializado: conecta diretamente no seu número e converte automaticamente todo áudio recebido, sem precisar encaminhar nada.',
      },
    },
    {
      '@type': 'Question',
      name: 'A LuzIA converte áudio automaticamente?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Não. Para usar a LuzIA, você precisa encaminhar manualmente cada áudio para o contato/bot da LuzIA. O ZapScript funciona no seu próprio número conectado — todo áudio que chega já é convertido sozinho, sem ação manual.',
      },
    },
    {
      '@type': 'Question',
      name: 'O ZapScript é mais barato que a LuzIA?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'O ZapScript tem plano Core com até 100 áudios por mês sem custo. O plano Profissional custa R$49/mês (ou R$295/ano) e inclui áudios ilimitados, atendimento automático por IA, resumo com IA e Modo Privado.',
      },
    },
  ],
};

const ROWS = [
  { feature: 'Funcionamento',          zap: '100% automático no seu número', luzia: 'Manual (encaminhar para o bot)' },
  { feature: 'Foco do produto',        zap: 'Especializado em conversão', luzia: 'Assistente multifunção (chat, imagens, texto)' },
  { feature: 'Resumo com IA',          zap: '✅ Incluído em toda conversão', luzia: '⚠️ Depende do uso manual' },
  { feature: 'Modo Privado',           zap: '✅ Incluído',            luzia: '❌ Não aplicável' },
  { feature: 'Histórico pesquisável',  zap: '✅ Incluído',            luzia: '❌ Não disponível' },
  { feature: 'Conecta no seu número',  zap: '✅ Sim, via QR Code',     luzia: '❌ Você fala com o contato da LuzIA' },
  { feature: 'Plano gratuito',         zap: '✅ 100 áudios/mês',      luzia: '⚠️ Limites variam por funcionalidade' },
  { feature: 'Criptografia',           zap: 'AES-256-GCM',            luzia: 'Não documentado para esse uso' },
  { feature: 'Conformidade LGPD',      zap: '✅ Completo',            luzia: 'Não documentado para esse uso' },
  { feature: 'Servidores no Brasil',   zap: '✅ São Paulo',           luzia: 'Não especificado' },
];

const FAQS = [
  {
    q: 'Qual a diferença entre ZapScript e LuzIA?',
    a: 'A LuzIA é uma assistente de IA multifunção — você conversa com ela, pede imagens, resumos e também pode encaminhar áudios para converter. O ZapScript faz uma coisa só, e faz automático: conecta no SEU número de WhatsApp e converte todo áudio recebido sem você precisar encaminhar nada para ninguém.',
  },
  {
    q: 'Preciso encaminhar o áudio para o ZapScript, como faço com a LuzIA?',
    a: 'Não. Essa é a principal diferença. Com o ZapScript, você conecta seu número uma única vez (via QR Code) e o sistema passa a converter automaticamente cada áudio que chega — não existe etapa de encaminhar nada.',
  },
  {
    q: 'A LuzIA serve para outras coisas além de converter áudio?',
    a: 'Sim, a LuzIA é uma assistente de propósito geral (perguntas, imagens, resumos de texto). Se seu objetivo é só nunca mais perder tempo ouvindo áudio no WhatsApp, um produto especializado como o ZapScript tende a resolver isso de forma mais direta e automática.',
  },
  {
    q: 'O ZapScript funciona com meu número pessoal ou comercial?',
    a: 'Sim, qualquer número WhatsApp — pessoal ou comercial. No plano Pro você pode conectar até 2 números simultaneamente.',
  },
  {
    q: 'Quanto custa o ZapScript comparado a usar a LuzIA para isso?',
    a: 'O plano Core do ZapScript inclui até 100 áudios de conversão por mês sem custo e sem cartão. O Profissional custa R$49/mês (ou R$295/ano) e inclui áudios ilimitados, atendimento automático por IA, resumo com IA, Modo Privado e histórico completo.',
  },
];

const breadcrumbSchema = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Início',            item: 'https://www.zapscript.me' },
    { '@type': 'ListItem', position: 2, name: 'ZapScript vs LuzIA', item: 'https://www.zapscript.me/vs/luzia' },
  ],
};

export default function VsLuziaPage() {
  return (
    <div className="min-h-screen bg-brand-bg text-brand-text">
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
            ZapScript vs LuzIA<br />
            <span className="text-brand-primary">Qual converte melhor?</span>
          </h1>
          <p className="text-lg text-brand-muted max-w-2xl mx-auto leading-relaxed">
            A LuzIA é uma assistente multifunção; o ZapScript é especializado em converter áudio do WhatsApp automaticamente. Veja a diferença na prática.
          </p>
          <p className="text-brand-primary font-medium max-w-2xl mx-auto mt-4">
            Seu robô particular, convertendo áudio em texto 24 horas por dia — mesmo enquanto você dorme.
          </p>
        </div>

        {/* Veredicto rápido */}
        <div className="grid sm:grid-cols-2 gap-4 mb-16">
          <div className="rounded-2xl p-6 border border-brand-primary/30" style={{ background: 'rgba(16,185,129,.06)' }}>
            <div className="text-xs font-mono uppercase tracking-widest text-brand-primary mb-2">ZapScript</div>
            <div className="text-xl font-bold text-white mb-3">Especializado e 100% automático</div>
            <ul className="space-y-2 text-sm text-brand-muted">
              <li>✅ Conecta no seu próprio número — sem encaminhar nada</li>
              <li>✅ Resumo inteligente por IA em toda conversão</li>
              <li>✅ Modo Privado — sem "ouvido" no WhatsApp</li>
              <li>✅ Histórico pesquisável de todas as conversões</li>
              <li>✅ Criptografia AES-256, servidores em SP</li>
            </ul>
            <Link href="/cadastro" className="mt-5 block text-center bg-brand-primary text-black font-bold py-3 rounded-xl hover:opacity-90 transition-opacity">
              Começar grátis →
            </Link>
          </div>
          <div className="rounded-2xl p-6 border border-white/10 bg-white/3">
            <div className="text-xs font-mono uppercase tracking-widest text-brand-muted mb-2">LuzIA</div>
            <div className="text-xl font-bold text-white mb-3">Assistente multifunção, manual</div>
            <ul className="space-y-2 text-sm text-brand-muted">
              <li>⚠️ Exige encaminhar cada áudio para o contato da LuzIA</li>
              <li>⚠️ Foco em chat/imagens, não em conversão contínua</li>
              <li>❌ Sem Modo Privado dedicado a conversão</li>
              <li>❌ Sem histórico pesquisável de conversões</li>
              <li>❌ Privacidade não documentada para esse uso específico</li>
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
                  <th className="px-5 py-4 text-center text-brand-muted font-medium">LuzIA</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {ROWS.map((row, i) => (
                  <tr key={i}>
                    <td className="px-5 py-3.5 text-brand-text-secondary text-sm font-medium">{row.feature}</td>
                    <td className="px-5 py-3.5 text-center text-sm font-semibold text-brand-primary bg-brand-primary/3">{row.zap}</td>
                    <td className="px-5 py-3.5 text-center text-sm text-brand-muted">{row.luzia}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Por que automático importa */}
        <div className="mb-16 rounded-2xl p-8 border border-white/10 bg-white/3">
          <h2 className="text-xl font-bold text-white mb-4">Assistente geral vs ferramenta especializada</h2>
          <div className="grid sm:grid-cols-2 gap-6 text-sm text-brand-muted leading-relaxed">
            <div>
              <p className="font-semibold text-white mb-2">Com a LuzIA (multifunção)</p>
              <p>Você recebe o áudio → abre a conversa com a LuzIA → encaminha o áudio → espera a resposta → volta para a conversa original. Funciona, mas exige uma ação sua a cada áudio — e a conversão é só uma das muitas funções do produto.</p>
            </div>
            <div>
              <p className="font-semibold text-white mb-2">Com o ZapScript (especializado)</p>
              <p>O áudio chega no seu número conectado → o ZapScript converte em background → o texto e o resumo aparecem no painel em segundos. Zero ação sua, e o produto inteiro é desenhado só para isso.</p>
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
          <p className="text-brand-muted mb-6">Até 100 áudios por mês grátis. Upgrade quando quiser. Cancele a qualquer hora.</p>
          <Link href="/cadastro" className="inline-flex items-center gap-2 bg-brand-primary text-black font-bold text-lg px-10 py-4 rounded-2xl hover:opacity-90 transition-opacity">
            Criar minha conta grátis →
          </Link>
          <p className="text-xs text-brand-muted mt-4">✓ Sem cartão &nbsp;·&nbsp; ✓ Sem fidelidade &nbsp;·&nbsp; ✓ Cancele quando quiser</p>
        </div>
      </div>

      <footer className="border-t border-white/5 py-8 text-center text-xs text-brand-muted">
        <p>© {new Date().getFullYear()} ZapScript · <Link href="/" className="hover:text-brand-primary">Voltar ao site</Link> · <Link href="/privacidade" className="hover:text-brand-primary">Privacidade</Link></p>
        <p className="mt-1 text-brand-muted/50">Esta página é um comparativo informativo independente. As informações sobre a LuzIA são baseadas em uso público do serviço.</p>
      </footer>
    </div>
  );
}
