import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Campanhas WhatsApp para Varejo e E-commerce — Oficial e Seguro',
  description:
    'Dispare promoções, cupons e notificações de pedido direto no WhatsApp. API oficial Meta, templates aprovados, sem risco de banimento. Para lojas online, boutiques e varejistas.',
  keywords:
    'campanha whatsapp varejo, promocao whatsapp loja, notificacao pedido whatsapp, cupom whatsapp, lista de transmissao whatsapp loja, marketing whatsapp ecommerce',
  alternates: { canonical: 'https://www.zapscript.me/campanhas/varejo' },
  openGraph: {
    title: 'Campanhas WhatsApp para Varejo e E-commerce',
    description: 'Dispare promoções, cupons e notificações direto no WhatsApp com segurança oficial.',
    url: 'https://www.zapscript.me/campanhas/varejo',
    type: 'website',
  },
};

const softwareSchema = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'ZapScript Campanhas para Varejo',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  url: 'https://www.zapscript.me/campanhas/varejo',
  description: 'Plataforma para disparar campanhas no WhatsApp via API oficial Meta, voltada para varejistas e e-commerce.',
  inLanguage: 'pt-BR',
  featureList: [
    'Disparo de promoções e cupons',
    'Notificação automática de pedidos (confirmar, separar, pronto, entregue)',
    'Segmentação por histórico de compra',
    'Links rastreáveis de promoção',
    'Recuperação de carrinho abandonado',
    'Opt-out automático (LGPD)',
  ],
};

const breadcrumbSchema = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'ZapScript', item: 'https://www.zapscript.me' },
    { '@type': 'ListItem', position: 2, name: 'Campanhas', item: 'https://www.zapscript.me/campanhas' },
    { '@type': 'ListItem', position: 3, name: 'Para Varejo', item: 'https://www.zapscript.me/campanhas/varejo' },
  ],
};

export default function CampanhasVarejoPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
        <div className="mx-auto max-w-4xl px-6 py-16 sm:py-24">
          {/* Hero */}
          <div className="mb-12 text-center">
            <h1 className="mb-4 text-4xl font-bold sm:text-5xl">
              Campanhas WhatsApp para <span className="text-green-600">Varejo e E-commerce</span>
            </h1>
            <p className="mb-6 text-xl text-slate-600 dark:text-slate-300">
              Envie promoções, cupons e notificações de pedido direto no WhatsApp — oficial, seguro e sem risco de banimento.
            </p>
            <div className="flex flex-col gap-4 sm:flex-row sm:justify-center">
              <Link
                href="https://app.zapscript.me/cadastro"
                className="inline-block rounded-lg bg-green-600 px-8 py-3 font-semibold text-white hover:bg-green-700"
              >
                Começar Grátis
              </Link>
              <Link
                href="/campanhas"
                className="inline-block rounded-lg border border-slate-300 px-8 py-3 font-semibold hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800"
              >
                Voltar para Campanhas
              </Link>
            </div>
          </div>

          {/* Por que não SMS */}
          <div className="mb-16 rounded-lg bg-yellow-50 p-8 dark:bg-yellow-950">
            <h2 className="mb-4 text-2xl font-bold">Por que WhatsApp e não SMS?</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-2 font-semibold text-yellow-900 dark:text-yellow-100">WhatsApp (ZapScript)</p>
                <ul className="space-y-1 text-sm text-yellow-800 dark:text-yellow-200">
                  <li>✅ R$ 0,03 a 0,08 por mensagem*</li>
                  <li>✅ Abertura: 70%+ em 2 horas</li>
                  <li>✅ Respostas imediatas</li>
                  <li>✅ Mídia e links interativos</li>
                  <li>✅ Cliente já usa (conforto)</li>
                </ul>
              </div>
              <div>
                <p className="mb-2 font-semibold text-yellow-900 dark:text-yellow-100">SMS</p>
                <ul className="space-y-1 text-sm text-yellow-800 dark:text-yellow-200">
                  <li>❌ R$ 0,15 a 0,30 por mensagem</li>
                  <li>❌ Abertura: 10-20%</li>
                  <li>❌ Sem resposta direta</li>
                  <li>❌ Só texto</li>
                  <li>❌ Número genérico</li>
                </ul>
              </div>
            </div>
            <p className="mt-4 text-sm text-yellow-700 dark:text-yellow-300">*Tarifas da Meta; ZapScript é gratuito</p>
          </div>

          {/* Casos de Uso */}
          <div className="mb-16">
            <h2 className="mb-8 text-3xl font-bold">Casos de Uso para Varejistas</h2>
            <div className="grid gap-6 sm:grid-cols-2">
              {[
                {
                  icon: '🎁',
                  title: 'Promoção Flash',
                  desc: 'Desconto por 6 horas? Dispare em 30 segundos para toda base. Taxa de clique 5x maior que email.',
                },
                {
                  icon: '🏷️',
                  title: 'Cupom Exclusivo',
                  desc: 'Cada cliente recebe cupom único. Rastreie quem usou, quanto gastou, repetição.',
                },
                {
                  icon: '📦',
                  title: 'Notificação de Pedido',
                  desc: 'Pedido confirmado → separando → pronto → saiu na entrega → entregue. Automático e rastreável.',
                },
                {
                  icon: '🛒',
                  title: 'Carrinho Abandonado',
                  desc: 'Cliente saiu sem comprar? Envie o link do carrinho 2h depois. Recupere vendas perdidas.',
                },
                {
                  icon: '⭐',
                  title: 'Avaliação & Review',
                  desc: 'Após entrega: peça avaliação. Respostas diretas no WhatsApp (não precisa abrir site).',
                },
                {
                  icon: '👥',
                  title: 'VIP & Fidelidade',
                  desc: 'Clientes que gastaram mais recebem ofertas exclusivas. Segmente por valor gasto.',
                },
              ].map((use, i) => (
                <div key={i} className="rounded-lg border border-slate-200 p-6 dark:border-slate-700">
                  <div className="mb-3 text-3xl">{use.icon}</div>
                  <h3 className="mb-2 font-semibold">{use.title}</h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400">{use.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Resultados */}
          <div className="mb-16 rounded-lg border-2 border-green-200 bg-green-50 p-8 dark:border-green-900 dark:bg-green-950">
            <h2 className="mb-6 text-2xl font-bold">Resultados Típicos (Lojas do ZapScript)</h2>
            <div className="grid gap-6 sm:grid-cols-3">
              {[
                { metric: 'Taxa de Abertura', value: '75%+' },
                { metric: 'Tempo até leitura', value: '4 minutos' },
                { metric: 'Cliques em links', value: '25-35%' },
              ].map((r, i) => (
                <div key={i} className="text-center">
                  <p className="text-sm text-green-600 dark:text-green-400">{r.metric}</p>
                  <p className="text-3xl font-bold text-green-900 dark:text-green-100">{r.value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Segmentação */}
          <div className="mb-16">
            <h2 className="mb-6 text-3xl font-bold">Segmente Inteligentemente</h2>
            <p className="mb-6 text-slate-600 dark:text-slate-400">
              Não envie a mesma promoção para todos. O ZapScript permite:
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                '📍 Por localização (cidade/bairro)',
                '💰 Por faixa de gasto',
                '📅 Por última compra (há quanto?)',
                '🏷️ Por categoria do produto',
                '👕 Por tamanho/cor (guardaroupa)',
                '🛒 Por frequência de compra',
              ].map((seg, i) => (
                <div key={i} className="rounded-lg bg-slate-100 p-4 text-sm dark:bg-slate-800">
                  {seg}
                </div>
              ))}
            </div>
          </div>

          {/* Preços */}
          <div className="mb-16">
            <h2 className="mb-8 text-3xl font-bold">Preços — Quanto Você Economiza?</h2>
            <div className="mb-6 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-slate-200 dark:border-slate-700">
                    <th className="px-4 py-3 text-left">Plan</th>
                    <th className="px-4 py-3 text-left">Mensagens</th>
                    <th className="px-4 py-3 text-left">Custo ZapScript</th>
                    <th className="px-4 py-3 text-left">Vs SMS*</th>
                  </tr>
                </thead>
                <tbody className="text-xs sm:text-sm">
                  <tr className="border-b border-slate-200 dark:border-slate-700">
                    <td className="px-4 py-3 font-semibold">Grátis</td>
                    <td className="px-4 py-3">30/mês</td>
                    <td className="px-4 py-3">R$ 0</td>
                    <td className="px-4 py-3 text-green-600">Economiza R$ 9</td>
                  </tr>
                  <tr className="border-b border-slate-200 dark:border-slate-700">
                    <td className="px-4 py-3 font-semibold">Pré-Pago 1</td>
                    <td className="px-4 py-3">1.000 (90 dias)</td>
                    <td className="px-4 py-3">R$ 150</td>
                    <td className="px-4 py-3 text-green-600">Economiza R$ 150</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-semibold">Ilimitado</td>
                    <td className="px-4 py-3">Sem limite/mês</td>
                    <td className="px-4 py-3">R$ 699/mês</td>
                    <td className="px-4 py-3 text-green-600">Economiza 2-3k+/mês</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              *Comparação com SMS a R$ 0,20/msg. Tarifas de mensagem da Meta (enviadas) não incluem custo ZapScript (gratuito).
            </p>
          </div>

          {/* FAQ */}
          <div className="mb-16">
            <h2 className="mb-8 text-3xl font-bold">Perguntas Frequentes</h2>
            <div className="space-y-4">
              {[
                {
                  q: 'Consigo enviar fotos de produtos?',
                  a: 'Sim! Templates aprovados podem incluir imagem, botões interativos e links diretos para o produto.',
                },
                {
                  q: 'Meus clientes podem responder?',
                  a: 'Sim. Mensagens chegam no seu WhatsApp. ZapScript também integra com atendimento automático (IA) se quiser responder em massa.',
                },
                {
                  q: 'Posso automatizar por gatilho (ex: comprou)?',
                  a: 'Ainda não é automático de forma nativa, mas permite mandar em segundos. Integração com e-commerce vem em breve.',
                },
                {
                  q: 'Funciona em WhatsApp Web?',
                  a: 'Não. Precisa do app oficial de Business no seu número. ZapScript gerencia a API — você só conecta e pronto.',
                },
              ].map((qa, i) => (
                <div key={i} className="rounded-lg border border-slate-200 p-6 dark:border-slate-700">
                  <h3 className="mb-2 font-semibold">{qa.q}</h3>
                  <p className="text-slate-600 dark:text-slate-400">{qa.a}</p>
                </div>
              ))}
            </div>
          </div>

          {/* CTA Final */}
          <div className="rounded-lg bg-green-600 p-8 text-center text-white">
            <h2 className="mb-4 text-3xl font-bold">Comece a Economizar Agora</h2>
            <p className="mb-6">Dispare 30 campanhas grátis este mês e veja o retorno.</p>
            <Link
              href="https://app.zapscript.me/cadastro"
              className="inline-block rounded-lg bg-white px-8 py-3 font-semibold text-green-600 hover:bg-slate-100"
            >
              Criar Conta Grátis
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
