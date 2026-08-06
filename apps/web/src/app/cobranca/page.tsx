import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'ZapScript Cobrança — Lembrete automático de pagamento via WhatsApp',
  description:
    'Cadastre o cliente e o valor. No dia do vencimento e no primeiro dia de atraso, o ZapScript Cobrança manda um lembrete pelo WhatsApp, automaticamente. Sem planilha, sem esquecer, sem constrangimento. Incluso no plano Profissional.',
  keywords:
    'cobrança automática whatsapp, lembrete de pagamento whatsapp, cobrar cliente mei, lembrete de vencimento automático, inadimplência whatsapp, cobrança para autônomo',
  alternates: { canonical: 'https://www.zapscript.me/cobranca' },
  openGraph: {
    title: 'ZapScript Cobrança — O lembrete de pagamento que você não manda mais na mão',
    description:
      'Automatize o lembrete de cobrança pelo WhatsApp: no vencimento e no 1º dia de atraso. Reenvio manual em 1 clique. Incluso no plano Profissional, cancele quando quiser.',
    url: 'https://www.zapscript.me/cobranca',
    siteName: 'ZapScript',
    locale: 'pt_BR',
    type: 'website',
  },
};

const DORES = [
  {
    icon: '🙈',
    title: 'Cobrar dá vergonha',
    text: 'Você presta o serviço, entrega o produto — e trava na hora de mandar mensagem cobrando. Passa o dia, passa a semana, e o boleto continua sem ser lembrado.',
  },
  {
    icon: '📅',
    title: 'Vencimento passa batido',
    text: 'Sem uma lista centralizada, o controle vira mental ou numa planilha esquecida. Quando você lembra do cliente que venceu, já se foram dias — ou semanas.',
  },
  {
    icon: '💸',
    title: 'Inadimplência silenciosa',
    text: 'Ninguém cobrou, então ninguém pagou. Não é má-fé do cliente — é falta de lembrete. E cada cobrança que não sai é receita que não entra no seu caixa.',
  },
];

const BENEFICIOS = [
  {
    icon: '⏰',
    title: 'Lembrete no dia certo',
    text: 'No dia do vencimento e no primeiro dia de atraso, o ZapScript manda a mensagem sozinho — pelo mesmo número que você já usa.',
  },
  {
    icon: '🔁',
    title: 'Reenvio manual em 1 clique',
    text: 'Cliente pediu para mandar de novo? Um clique no painel reenvia o lembrete na hora, sem precisar redigitar nada.',
  },
  {
    icon: '🤝',
    title: 'Mensagem educada, no seu tom',
    text: 'Texto pronto e cordial — nunca agressivo. O cliente recebe um lembrete, não uma cobrança de agência.',
  },
  {
    icon: '📊',
    title: 'Painel simples',
    text: 'A receber, vencidas e recebido no mês, tudo num só lugar. Marque como paga com um clique quando o dinheiro cair.',
  },
  {
    icon: '🔒',
    title: 'Dados protegidos, LGPD',
    text: 'Cadastro de clientes e cobranças tratado com o mesmo cuidado dos seus áudios: criptografado e nunca compartilhado.',
  },
  {
    icon: '📱',
    title: 'Sem app novo, sem robô estranho',
    text: 'Usa o número WhatsApp que você já conectou no ZapScript. Não precisa instalar nada nem pedir para o cliente salvar outro contato.',
  },
];

const FAQS = [
  {
    q: 'O ZapScript Cobrança processa pagamentos?',
    a: 'Não. O módulo não é um gateway de pagamento — ele não cobra cartão nem gera boleto. Ele só envia um lembrete pelo WhatsApp no vencimento e no primeiro dia de atraso. Você continua recebendo do jeito que já recebe hoje (Pix, dinheiro, boleto à parte etc.) e marca a cobrança como paga manualmente no painel.',
  },
  {
    q: 'Quando o lembrete é enviado?',
    a: 'Automaticamente em dois momentos: no dia do vencimento e no primeiro dia após o vencimento, caso a cobrança ainda esteja em aberto. Você também pode reenviar manualmente a qualquer momento com um clique.',
  },
  {
    q: 'Preciso ter algum plano do ZapScript para usar o Cobrança?',
    a: 'Sim. Esse lembrete automático vem incluso no recurso de Avisos do plano Profissional (R$49/mês) e usa o mesmo número de WhatsApp que você já conecta na plataforma. Se ainda não tem conta, o cadastro no Core (grátis) leva menos de 2 minutos.',
  },
  {
    q: 'O cliente percebe que é uma mensagem automática?',
    a: 'A mensagem é enviada pelo seu próprio número, com um texto cordial e natural — não tem cara de robô nem de cobrança de agência. É o mesmo lembrete que você mandaria na mão, só que sem precisar lembrar de mandar.',
  },
  {
    q: 'Quantos clientes e cobranças posso cadastrar?',
    a: 'Não há limite de clientes nem de cobranças cadastradas no módulo.',
  },
  {
    q: 'Posso cancelar quando quiser?',
    a: 'Sim, sem fidelidade. Você cancela a assinatura do módulo a qualquer momento direto no painel.',
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
    { '@type': 'ListItem', position: 2, name: 'ZapScript Cobrança', item: 'https://www.zapscript.me/cobranca' },
  ],
};

/** Mockup estático — bolha de WhatsApp mostrando o lembrete que o cliente recebe. */
function CobrancaDemo() {
  return (
    <div className="mx-auto w-full max-w-[360px]">
      <div className="rounded-[2.25rem] p-2.5 shadow-2xl" style={{ background: '#0b141a', boxShadow: '0 24px 60px -12px rgba(0,0,0,.55)' }}>
        <div className="rounded-[1.85rem] overflow-hidden" style={{ background: '#efeae2' }}>
          <div className="flex items-center gap-2.5 px-3.5 py-2.5" style={{ background: '#075e54' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0" style={{ background: '#cfd8dc' }}>👤</div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-white truncate leading-tight">Marcos (Cliente)</div>
              <div className="text-[10px] leading-tight" style={{ color: 'rgba(255,255,255,.7)' }}>online</div>
            </div>
          </div>

          <div className="px-3 py-4 space-y-2" style={{ minHeight: 320, backgroundColor: '#efeae2', backgroundImage: 'radial-gradient(rgba(0,0,0,.035) 1px, transparent 1px)', backgroundSize: '18px 18px' }}>
            <div className="flex justify-center">
              <span className="text-[10px] px-2.5 py-1 rounded-md" style={{ background: '#ffffff', color: '#54656f', boxShadow: '0 1px 0 rgba(0,0,0,.05)' }}>
                HOJE
              </span>
            </div>

            <div className="flex justify-end">
              <div className="relative max-w-[85%] rounded-lg rounded-tr-none px-3 py-2 shadow-sm" style={{ background: '#d9fdd3' }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: '#1f7a3f', color: '#fff' }}>ZapScript Cobrança</span>
                </div>
                <p className="text-[12px] leading-snug" style={{ color: '#111b21' }}>
                  Olá, Marcos! Passando para lembrar que <strong>Manutenção mensal</strong> no valor de <strong>R$ 350,00</strong> vence hoje (14/07). Qualquer dúvida, é só responder por aqui. 🙂
                </p>
                <div className="flex items-center justify-end gap-1 mt-1">
                  <span className="text-[9px]" style={{ color: '#667781' }}>08:03</span>
                  <svg width="13" height="9" viewBox="0 0 16 11" fill="none"><path d="M1 5.5L4.5 9L11 1.5" stroke="#53bdeb" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M5 5.5L8.5 9L15 1.5" stroke="#53bdeb" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CobrancaPage() {
  return (
    <div className="min-h-screen bg-brand-bg text-brand-text">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />

      {/* Header */}
      <header className="border-b border-white/5 bg-brand-bg/95 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-bold text-lg">
            <span className="text-2xl">💰</span>
            <span className="text-white">ZapScript Cobrança</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/app?upsell=cobranca" className="hidden sm:inline text-sm text-brand-muted hover:text-white transition-colors">
              Já tenho conta
            </Link>
            <Link href="/cadastro?utm_source=lp&utm_campaign=cobranca" className="text-sm bg-brand-primary text-black font-bold px-4 py-2 rounded-xl hover:opacity-90 transition-opacity">
              Começar grátis →
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-16">

        {/* Hero */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 bg-brand-primary/10 border border-brand-primary/20 rounded-full px-4 py-1.5 text-sm font-medium text-brand-primary mb-6">
            💰 Feito para quem cobra sozinho
          </div>
          <h1 className="text-3xl sm:text-5xl font-bold text-white leading-tight mb-5">
            Você entrega o serviço. <br />
            <span className="text-brand-primary">O ZapScript Cobrança lembra o cliente de pagar.</span>
          </h1>
          <p className="text-lg text-brand-muted max-w-2xl mx-auto leading-relaxed">
            Cadastre o cliente e o valor combinado. No dia do vencimento e no primeiro dia de atraso, o lembrete sai sozinho pelo WhatsApp — educado, no seu tom, sem você precisar lembrar nem digitar nada.
          </p>
          <p className="text-brand-primary font-medium max-w-2xl mx-auto mt-4">
            Não é gateway de pagamento — é o lembrete que você não manda mais na mão.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href="/cadastro?utm_source=lp&utm_campaign=cobranca" className="inline-flex items-center gap-2 bg-brand-primary text-black font-bold text-lg px-8 py-4 rounded-2xl hover:opacity-90 transition-opacity">
              Criar conta grátis →
            </Link>
            <span className="text-xs text-brand-muted">✓ Incluso no plano Profissional · ✓ Sem fidelidade</span>
          </div>
        </div>

        {/* Dores */}
        <div className="mb-16">
          <h2 className="text-2xl font-bold text-white text-center mb-8">O dia a dia de quem cobra sozinho</h2>
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
          <h2 className="text-2xl font-bold text-white text-center mb-2">Veja o lembrete que o cliente recebe</h2>
          <p className="text-brand-muted text-center mb-8 max-w-xl mx-auto">
            Mensagem cordial, no vencimento e no primeiro dia de atraso — automaticamente, na conversa que você já tem com o cliente.
          </p>
          <div className="grid md:grid-cols-2 gap-8 items-center">
            <CobrancaDemo />
            <div className="space-y-5">
              <div className="flex gap-3">
                <span className="w-9 h-9 flex-shrink-0 rounded-full bg-brand-primary/15 text-brand-primary flex items-center justify-center text-lg">📋</span>
                <div>
                  <p className="font-semibold text-white">Cadastre cliente e cobrança</p>
                  <p className="text-sm text-brand-muted">Nome, telefone, descrição, valor e vencimento. Leva menos de 1 minuto.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <span className="w-9 h-9 flex-shrink-0 rounded-full bg-brand-primary/15 text-brand-primary flex items-center justify-center text-lg">🤖</span>
                <div>
                  <p className="font-semibold text-white">O lembrete sai sozinho</p>
                  <p className="text-sm text-brand-muted">No vencimento e no 1º dia de atraso, sem você precisar lembrar.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <span className="w-9 h-9 flex-shrink-0 rounded-full bg-brand-primary/15 text-brand-primary flex items-center justify-center text-lg">✅</span>
                <div>
                  <p className="font-semibold text-white">Marque como paga</p>
                  <p className="text-sm text-brand-muted">Cliente pagou? Um clique no painel encerra a cobrança. Precisa insistir? Reenvie na hora.</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Benefícios */}
        <div className="mb-16">
          <h2 className="text-2xl font-bold text-white text-center mb-8">Por que usar o ZapScript Cobrança</h2>
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
          <h2 className="text-2xl font-bold text-white mb-3">Incluso no plano Profissional</h2>
          <p className="text-brand-muted mb-6 max-w-xl mx-auto">
            <span className="text-brand-primary font-semibold">Comprar por R$295</span> (ou alugar por R$49), clientes e cobranças ilimitados, sem fidelidade. Cancele quando quiser, direto no painel.
          </p>
          <Link href="/cadastro?utm_source=lp&utm_campaign=cobranca" className="inline-flex items-center gap-2 bg-brand-primary text-black font-bold text-lg px-10 py-4 rounded-2xl hover:opacity-90 transition-opacity">
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
          <h2 className="text-2xl font-bold text-white mb-3">Pronto para parar de cobrar na mão?</h2>
          <p className="text-brand-muted mb-6">Cadastre o primeiro cliente e veja o lembrete funcionar sozinho.</p>
          <Link href="/cadastro?utm_source=lp&utm_campaign=cobranca" className="inline-flex items-center gap-2 bg-brand-primary text-black font-bold text-lg px-10 py-4 rounded-2xl hover:opacity-90 transition-opacity">
            Começar grátis agora →
          </Link>
          <p className="text-xs text-brand-muted mt-4">✓ Incluso no plano Profissional &nbsp;·&nbsp; ✓ Sem fidelidade &nbsp;·&nbsp; ✓ Cancele quando quiser</p>
        </div>
      </div>

      <footer className="border-t border-white/5 py-8 text-center text-xs text-brand-muted">
        <p>© {new Date().getFullYear()} ZapScript · <Link href="/" className="hover:text-brand-primary">Voltar ao site</Link> · <Link href="/privacidade" className="hover:text-brand-primary">Privacidade</Link></p>
        <p className="mt-1 text-brand-muted/50">Lembrete automático de cobrança via WhatsApp para autônomos e pequenos negócios. Servidores no Brasil, conformidade com a LGPD.</p>
      </footer>
    </div>
  );
}
