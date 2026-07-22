import Image from 'next/image';
import Link from 'next/link';
import { ThemeToggleButton } from '@/components/ThemeProvider';
import { ChatDemo } from '@/components/ChatDemo';
import ConversationDemo from '@/components/ConversationDemo';
import WhatsAppSimulator from '@/components/WhatsAppSimulator';
import LiveStats from '@/components/LiveStats';
import PriceAnchor from '@/components/PriceAnchor';
import { FaqSection } from '@/components/FaqSection';
import { PricingInteractive } from '@/components/PricingInteractive';
import { Testimonials } from '@/components/Testimonials';
import { AffiliateCapture } from '@/components/AffiliateCapture';
import { SupportChatButton } from '@/components/SupportChatButton';
import { FAQ_ITEMS } from '@/data/faq';

/* ── Feature cards ── */
const FEATURES = [
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a3 3 0 013 3v7a3 3 0 11-6 0V5a3 3 0 013-3z"/>
        <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v3M8 22h8"/>
      </svg>
    ),
    iconBg: 'rgba(16,185,129,.15)', iconColor: 'rgb(52,211,153)',
    title: 'Leia em segundos',
    desc: 'Converta áudios longos em texto em segundos com alta precisão.',
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
      </svg>
    ),
    iconBg: 'rgba(245,158,11,.15)', iconColor: 'rgb(245,158,11)',
    title: 'Só o que importa',
    desc: 'Receba automaticamente o ponto principal de cada áudio — direto e objetivo.',
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
      </svg>
    ),
    iconBg: 'rgba(16,185,129,.10)', iconColor: 'rgb(52,211,153)',
    title: 'Ninguém vê seu áudio',
    desc: 'Áudio nunca armazenado. Conversões criptografadas no banco. Processamento via Whisper (OpenAI) e Claude (Anthropic).',
  },
];

const schemaOrg = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'ZapScript',
  alternateName: 'ZapScript.me',
  applicationCategory: 'ProductivityApplication',
  applicationSubCategory: 'Conversão de áudio do WhatsApp em texto e resumo com IA',
  operatingSystem: 'Web, iOS, Android',
  url: 'https://www.zapscript.me',
  inLanguage: 'pt-BR',
  description:
    'ZapScript converte automaticamente áudios do WhatsApp em texto e resumo com IA. Conecta no seu próprio número via QR Code e, a cada áudio recebido, entrega a transcrição completa e um resumo com os pontos principais — sem precisar ouvir nem encaminhar nada. Áudio nunca armazenado, criptografia AES-256, servidores no Brasil, conforme a LGPD.',
  featureList: [
    'Conversão automática de áudio do WhatsApp em texto',
    'Resumo inteligente com os pontos principais (pedidos, prazos, valores)',
    'Funciona no seu próprio número, sem encaminhar áudio para um bot',
    'Modo Privado',
    'Histórico pesquisável das conversões',
    'Criptografia AES-256 e servidores no Brasil (LGPD)',
  ],
  audience: {
    '@type': 'Audience',
    audienceType: 'Corretores, advogados, vendedores, contadores e profissionais que recebem muitos áudios no WhatsApp',
  },
  offers: [
    { '@type': 'Offer', price: '0', priceCurrency: 'BRL', name: 'Free', description: '15 áudios por mês, sem cartão' },
    { '@type': 'Offer', price: '37', priceCurrency: 'BRL', name: 'Pro', description: 'Áudios ilimitados, 2 números, resumo com IA, Modo Privado e histórico' },
  ],
  publisher: {
    '@type': 'Organization',
    name: 'FOX TecnologIA',
    url: 'https://www.zapscript.me',
    brand: 'ZapScript',
  },
};

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQ_ITEMS.map(item => ({
    '@type': 'Question',
    name: item.q,
    acceptedAnswer: { '@type': 'Answer', text: item.a },
  })),
};

export default function HomePage() {
  return (
    <div className="min-h-screen bg-mesh font-sans text-brand-text overflow-x-hidden">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schemaOrg) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />

      {/* Captura afiliado do ?aff= sem bloquear renderização */}
      <AffiliateCapture />

      <div className="landing-inner relative z-10 w-full max-w-[430px] sm:max-w-[500px] mx-auto bg-mesh min-h-screen">

        {/* ══ HEADER ══ */}
        <header className="relative pt-7 px-5 pb-16 overflow-hidden">
          <div className="absolute -top-10 -right-10 w-60 h-60 rounded-full blur-[90px] pointer-events-none"
            style={{ background: 'rgb(var(--color-primary)/.12)' }} />
          <div className="absolute bottom-0 -left-10 w-52 h-52 rounded-full blur-[70px] pointer-events-none"
            style={{ background: 'rgb(var(--color-accent)/.10)' }} />

          {/* Nav */}
          <div className="relative flex items-center gap-3 mb-7" style={{ animation: 'fadeInUp .6s ease .1s both' }}>
            <Image src="/logo.png" alt="ZapScript" width={148} height={32} className="object-contain object-left flex-1" style={{ minWidth: 0 }} />
            <div className="ml-auto flex items-center gap-2 flex-shrink-0">
              <ThemeToggleButton />
            </div>
          </div>

          {/* Hero */}
          <div className="relative">
            {/* Badge */}
            <div className="mb-4" style={{ animation: 'fadeInUp .6s ease .2s both' }}>
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold"
                style={{ background: 'rgba(var(--color-primary-light)/.6)', color: 'rgb(var(--color-primary))' }}>
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'rgb(var(--color-primary))' }} />
                Gente ocupada lê
              </span>
            </div>

            {/* H1 */}
            <h1 className="font-display font-bold leading-[1.06] tracking-tight mb-4"
              style={{ fontSize: 'clamp(26px, 7.5vw, 38px)', animation: 'fadeInUp .6s ease .25s both' }}>
              <span className="text-brand-text">Todo áudio do WhatsApp</span>{' '}
              <span className="text-gradient">vira texto e resumo, sozinho.</span>
            </h1>

            {/* Subtitle */}
            <p className="text-[15px] leading-relaxed mb-5"
              style={{ color: 'rgb(var(--color-text-secondary))', animation: 'fadeInUp .6s ease .3s both' }}>
              Conecte seu número e pronto. A cada áudio recebido, você lê a transcrição e o resumo na mesma conversa — sem ouvir, sem encaminhar, sem fazer nada.
            </p>

            {/* ══ SIMULADOR ANIMADO — entenda em 5 segundos ══ */}
            <div style={{ animation: 'fadeInUp .6s ease .38s both' }}>
              <WhatsAppSimulator className="mb-6" />
            </div>

            {/* CTAs */}
            <div className="flex flex-col gap-3" style={{ animation: 'fadeInUp .6s ease .45s both' }}>
              <div className="flex gap-2.5">
                <Link href="/cadastro" data-cta="home_hero_cadastro"
                  className="btn-primary flex-1 py-[14px] text-[15px] font-semibold flex items-center justify-center gap-2">
                  Quero ler em vez de ouvir
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M12 5l7 7-7 7"/>
                  </svg>
                </Link>
                <Link href="/transcrever-audio-gratis" data-cta="home_hero_demo"
                  className="py-[14px] px-5 text-[15px] font-semibold rounded-2xl flex items-center justify-center gap-2 transition-all duration-200 hover:opacity-80 active:scale-[.98] flex-shrink-0"
                  style={{
                    border: '1.5px solid rgb(var(--color-primary))',
                    color: 'rgb(var(--color-primary))',
                    background: 'rgba(var(--color-primary)/.08)',
                  }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                  </svg>
                  Ver funcionando
                </Link>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex-1 h-px" style={{ background: 'rgb(var(--color-border))' }} />
                <span className="text-[11px] font-medium select-none" style={{ color: 'rgb(var(--color-text-muted))' }}>ou</span>
                <div className="flex-1 h-px" style={{ background: 'rgb(var(--color-border))' }} />
              </div>

              <Link href="/login"
                className="w-full py-3 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-200 hover:opacity-80 active:scale-[.98]"
                style={{
                  border: '1.5px solid rgb(var(--color-border))',
                  color: 'rgb(var(--color-text-secondary))',
                  background: 'rgb(var(--color-surface))',
                }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.582-7 8-7s8 3 8 7"/>
                </svg>
                Entrar na minha conta
              </Link>
            </div>

            {/* Selos de confiança — acima da dobra */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-5" style={{ animation: 'fadeInUp .6s ease .4s both' }}>
              {['Grátis, sem cartão', 'Áudio nunca armazenado', 'Cancele em 1 clique'].map(t => (
                <span key={t} className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: 'rgb(var(--color-text-muted))' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgb(var(--color-primary))" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5"/>
                  </svg>
                  {t}
                </span>
              ))}
            </div>
          </div>
        </header>

        {/* ══ LIVE STATS — contador real de atividade ══ */}
        <section className="relative z-20 -mt-10 px-5" style={{ animation: 'fadeInUp .6s ease .4s both' }}>
          <div className="w-full">
            <div className="glass rounded-3xl p-5 border shadow-medium flex justify-around items-center"
              style={{ borderColor: 'rgb(var(--color-border-light))' }}>
              <LiveStats />
            </div>
          </div>
        </section>

        {/* ══ FEITO PRO SEU TRABALHO — roteia pra LP do nicho ══ */}
        <section className="px-5 pt-9">
          <p className="text-xs font-semibold mb-2.5" style={{ color: 'rgb(var(--color-text-secondary))' }}>
            <span className="mr-1">🎯</span> Feito pro seu trabalho:
          </p>
          <div className="flex flex-wrap gap-2">
            {[
              { label: '🏠 Corretores', href: '/corretores' },
              { label: '⚖️ Advogados', href: '/advogados' },
              { label: '💼 Vendas', href: '/vendas' },
              { label: '🧮 Contadores', href: '/para/contabilidade' },
              { label: '🦷 Dentistas', href: '/dentistas' },
            ].map(n => (
              <Link key={n.href} href={n.href} data-cta="home_nicho"
                className="inline-flex items-center px-3 py-2 rounded-full text-xs font-semibold transition-all hover:opacity-80 active:scale-[.97]"
                style={{ background: 'rgb(var(--color-surface-elevated))', border: '1px solid rgb(var(--color-border))', color: 'rgb(var(--color-text))' }}>
                {n.label}
              </Link>
            ))}
          </div>
        </section>

        {/* ══ PROVA SOCIAL — Stats numéricas ══ */}
        <section className="px-5 pt-12 pb-4">
          <div className="mb-5">
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgb(var(--color-accent))' }}>
              Resultados reais
            </span>
            <h2 className="font-display text-2xl font-bold mt-2 leading-tight tracking-tight">
              Profissionais que já leem em vez de ouvir
            </h2>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { n: '10x', label: 'Mais rápido', sub: 'que ouvir o áudio' },
              { n: '99%', label: 'Precisão', sub: 'em português BR' },
              { n: '+10h', label: 'Economizadas', sub: 'por mês, por usuário' },
            ].map(({ n, label, sub }) => (
              <div key={label} className="card rounded-2xl p-4 text-center">
                <p className="font-display text-2xl font-bold" style={{ color: 'rgb(var(--color-primary))' }}>{n}</p>
                <p className="text-xs font-semibold mt-1">{label}</p>
                <p className="text-[10px] mt-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>{sub}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ══ VEJA NA PRÁTICA — mockup real da conversa ══ */}
        <section className="px-5 pt-10 pb-2">
          <p className="text-xs font-semibold uppercase tracking-widest mb-2 text-center"
            style={{ color: 'rgb(var(--color-primary))' }}>
            Como aparece no seu WhatsApp
          </p>
          <p className="text-sm font-medium text-center mb-5" style={{ color: 'rgb(var(--color-text))' }}>
            O áudio chega e a transcrição + resumo voltam na mesma conversa — automaticamente, em segundos.
          </p>
          <ConversationDemo />
          <div className="relative mt-6 mb-1 h-px mx-6"
            style={{ background: 'linear-gradient(90deg, rgba(var(--color-primary)/.4), rgba(var(--color-primary)/.1))' }} />
        </section>

        {/* ══ INSIGHT — Áudio vs Texto ══ */}
        <section className="px-5 pt-8 pb-2">
          <div className="rounded-2xl p-5 text-center"
            style={{ background: 'rgb(var(--color-surface-elevated))', border: '1px solid rgba(var(--color-primary)/.18)' }}>
            <p className="font-display font-bold text-[15px] leading-snug">
              Áudio é ótimo pra quem manda.{' '}
              <span className="text-gradient">Pra quem recebe, ler é melhor.</span>
            </p>
            <p className="text-xs mt-2 font-light" style={{ color: 'rgb(var(--color-text-secondary))' }}>
              Por isso o ZapScript converte cada áudio — você lê o texto e o resumo sem perder tempo nem contexto.
            </p>
          </div>
        </section>

        {/* ══ FEATURES ══ */}
        <section className="relative z-10 py-10 px-5">
          <div className="mb-8" style={{ animation: 'fadeInUp .6s ease both' }}>
            <span className="text-xs font-semibold uppercase tracking-widest"
              style={{ color: 'rgb(var(--color-accent))' }}>
              Funcionalidades
            </span>
            <h2 className="font-display text-3xl font-bold mt-2 leading-tight">
              Por que usar o ZapScript?
            </h2>
          </div>
          <div className="space-y-5">
            {FEATURES.map((f, i) => (
              <div key={i} className="card rounded-2xl p-5 hover:-translate-y-0.5 hover:shadow-medium"
                style={{ borderRadius: '1rem' }}>
                <div className="flex gap-4 items-start">
                  <div className="w-[46px] h-[46px] rounded-[14px] flex items-center justify-center flex-shrink-0"
                    style={{ background: f.iconBg, color: f.iconColor }}>
                    {f.icon}
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-base mb-1.5 leading-tight">{f.title}</h3>
                    <p className="text-sm leading-relaxed font-light" style={{ color: 'rgb(var(--color-text-secondary))' }}>{f.desc}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ══ CHAT DEMO ══ */}
        <section className="px-5 pb-16">
          <ChatDemo />
        </section>

        {/* ══ SEGURANÇA & PRIVACIDADE ══ */}
        <section className="px-5 pb-16">
          <div className="mb-7">
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgb(var(--color-accent))' }}>
              Segurança &amp; Privacidade
            </span>
            <h2 className="font-display text-3xl font-bold mt-2 leading-tight tracking-tight">
              Seus áudios, protegidos
            </h2>
            <p className="text-sm mt-2 font-light" style={{ color: 'rgb(var(--color-text-secondary))' }}>
              Tratamos suas conversas com o cuidado que elas merecem — do recebimento ao histórico.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {[
              {
                icon: '🔒',
                title: 'Áudio nunca armazenado',
                desc: 'O áudio é processado e descartado. Guardamos apenas o texto e o resumo — nunca o arquivo original.',
              },
              {
                icon: '🛡️',
                title: 'Criptografia AES-256',
                desc: 'As conversões ficam criptografadas no banco de dados. Só você acessa o conteúdo da sua conta.',
              },
              {
                icon: '🇧🇷',
                title: 'Servidores no Brasil, conforme a LGPD',
                desc: 'Sua infraestrutura de processamento roda no Brasil, em conformidade com a Lei Geral de Proteção de Dados.',
              },
              {
                icon: '🤫',
                title: 'Modo Privado automático',
                desc: 'No plano pago, o resumo chega só no seu número — nunca na conversa de quem enviou o áudio. Vem ligado por padrão, e você desliga quando quiser.',
                href: '/privacidade',
                hook: 'Como funciona',
              },
            ].map((s) => {
              const inner = (
                <div className="flex gap-4 items-start">
                  <div className="w-[46px] h-[46px] rounded-[14px] flex items-center justify-center flex-shrink-0 text-xl"
                    style={{ background: 'rgba(16,185,129,.12)' }}>
                    {s.icon}
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-base mb-1.5 leading-tight">{s.title}</h3>
                    <p className="text-sm leading-relaxed font-light" style={{ color: 'rgb(var(--color-text-secondary))' }}>{s.desc}</p>
                    {'hook' in s && s.hook && (
                      <span className="inline-flex items-center gap-1 text-sm font-semibold mt-2 group-hover:gap-1.5 transition-all" style={{ color: 'rgb(var(--color-primary))' }}>
                        {s.hook} <span aria-hidden>→</span>
                      </span>
                    )}
                  </div>
                </div>
              );
              const cls = 'group card rounded-2xl p-5 block transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg';
              return 'href' in s && s.href ? (
                <Link key={s.title} href={s.href} className={cls} style={{ borderRadius: '1rem' }}>{inner}</Link>
              ) : (
                <div key={s.title} className={cls} style={{ borderRadius: '1rem' }}>{inner}</div>
              );
            })}
          </div>

          <p className="text-xs mt-4 text-center font-light" style={{ color: 'rgb(var(--color-text-secondary))' }}>
            Processamento de IA via Whisper (OpenAI) e Claude (Anthropic).{' '}
            <Link href="/privacidade" className="font-semibold hover:underline" style={{ color: 'rgb(var(--color-primary))' }}>
              Ler a Política de Privacidade →
            </Link>
          </p>
        </section>

        {/* ══ DEPOIMENTOS (renderiza só quando houver) ══ */}
        <Testimonials />

        {/* ══ PLANS ══ */}
        <section id="planos" className="px-5 pb-16">
          <div className="mb-8">
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgb(var(--color-accent))' }}>
              Planos
            </span>
            <h2 className="font-display text-3xl font-bold mt-2 leading-tight tracking-tight">Escolha seu plano</h2>
            <p className="text-sm mt-2 font-light" style={{ color: 'rgb(var(--color-text-secondary))' }}>
              Comece grátis. Sem cartão de crédito.
            </p>
          </div>
          <PricingInteractive />
        </section>

        {/* ══ FAQ ══ */}
        <section className="px-5 pb-16">
          <div className="mb-7">
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgb(var(--color-accent))' }}>
              FAQ
            </span>
            <h2 className="font-display text-3xl font-bold mt-2 leading-tight tracking-tight">
              Perguntas frequentes
            </h2>
          </div>
          <FaqSection />
        </section>

        {/* ══ FALE CONOSCO ══ */}
        <section className="px-5 pb-16">
          <div className="text-center mb-8">
            <span className="inline-block text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full mb-3"
              style={{ background: 'rgba(16,185,129,.1)', color: 'rgb(var(--color-primary))', border: '1px solid rgba(16,185,129,.2)' }}>
              Suporte
            </span>
            <h2 className="font-display font-bold text-2xl tracking-tight mb-2">Fale Conosco</h2>
            <p className="text-sm font-light" style={{ color: 'rgb(var(--color-text-secondary))' }}>
              Tem dúvidas, sugestões ou precisa de ajuda? Nossa equipe está aqui para você.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-4 max-w-lg mx-auto">
            <a
              href="mailto:contato@zapscript.me"
              className="flex items-center gap-4 rounded-2xl p-5 border transition-all hover:scale-[1.02]"
              style={{
                background: 'rgb(var(--color-surface-elevated))',
                borderColor: 'rgb(var(--color-border))',
              }}
            >
              <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(16,185,129,.1)', color: 'rgb(var(--color-primary))' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                  <rect x="2" y="4" width="20" height="16" rx="2"/>
                  <path d="M22 7l-10 7L2 7"/>
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider mb-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>E-mail</p>
                <p className="text-sm font-semibold truncate" style={{ color: 'rgb(var(--color-primary))' }}>
                  contato@zapscript.me
                </p>
                <p className="text-[10px] mt-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>Resposta em até 24h</p>
              </div>
            </a>

            <SupportChatButton />
          </div>
        </section>

        {/* ══ CTA FINAL ══ */}
        <section className="px-5 pb-14">
          <div className="rounded-[1.75rem] p-8 text-center"
            style={{
              background: 'linear-gradient(135deg, rgba(16,185,129,.15) 0%, rgba(245,158,11,.08) 100%)',
              border: '1px solid rgba(16,185,129,.2)',
            }}>
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5"
              style={{ background: 'rgba(16,185,129,.15)', color: 'rgb(var(--color-primary))' }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
              </svg>
            </div>
            <h2 className="font-display font-bold text-2xl mb-3 tracking-tight leading-tight">
              Leia seu próximo áudio em vez de ouvir.
            </h2>
            <p className="text-base leading-relaxed mb-7 font-light" style={{ color: 'rgb(var(--color-text-secondary))' }}>
              Comece gratuitamente e recupere as horas que você perde ouvindo áudio no WhatsApp.
            </p>
            <Link href="/cadastro" data-cta="home_footer_cadastro"
              className="btn-primary inline-flex items-center justify-center py-4 px-8 text-base gap-2">
              Converter grátis agora
            </Link>
            <PriceAnchor
              prefix="Plano Pro por "
              compare
              className="block text-sm mt-4"
              compareClassName="block text-xs mt-1 opacity-70"
            />
          </div>
        </section>

        {/* ══ FOOTER ══ */}
        <footer className="px-5 py-8 border-t text-center" style={{ borderColor: 'rgb(var(--color-border))' }}>
          <p className="text-xs font-medium" style={{ color: 'rgb(var(--color-text-muted))' }}>
            © 2026 ZapScript v2.0 · FOX TecnologIA · Todos os direitos reservados.
          </p>
          <p className="text-[11px] mt-1" style={{ color: 'rgb(var(--color-text-muted))', opacity: 0.6 }}>
            Código-fonte, design e marca protegidos pela Lei nº 9.610/1998. Reprodução proibida.
          </p>
          <div className="flex justify-center gap-4 mt-3">
            {[['Termos', '/termos'], ['Privacidade', '/privacidade'], ['Contrato', '/contrato']].map(([l, href]) => (
              <Link key={l} href={href}
                className="text-xs transition-colors hover:text-brand-text"
                style={{ color: 'rgb(var(--color-text-muted))' }}>
                {l}
              </Link>
            ))}
          </div>
        </footer>
      </div>
    </div>
  );
}
