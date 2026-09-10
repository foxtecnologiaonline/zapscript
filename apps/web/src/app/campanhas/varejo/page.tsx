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
            <p className="mb-3 text-xl text-slate-600 dark:text-slate-300">
              Envie promoções, cupons e notificações direto no WhatsApp — oficial, seguro e sem risco.
            </p>
            <div className="mb-6 rounded-lg bg-green-100 px-4 py-2 text-lg font-bold text-green-800 dark:bg-green-900 dark:text-green-200">
              💰 55-79% MAIS BARATO que Meta direto
            </div>
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

          {/* Economia comparada */}
          <div className="mb-16 rounded-lg bg-green-50 p-8 dark:bg-green-950">
            <h2 className="mb-4 text-2xl font-bold text-green-900 dark:text-green-100">💸 Economia — ZapScript vs Meta vs SMS</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                {
                  title: '1.000 Mensagens',
                  meta: 'Meta: R$ 330',
                  zapscript: 'ZapScript: R$ 150',
                  economia: '55% de desconto',
                  sms: 'SMS: ~R$ 200'
                },
                {
                  title: '5.000 Mensagens',
                  meta: 'Meta: R$ 1.650',
                  zapscript: 'ZapScript: R$ 450',
                  economia: '73% de desconto',
                  sms: 'SMS: ~R$ 1.000'
                },
                {
                  title: '10.000/mês (Ilimitado)',
                  meta: 'Meta: R$ 3.300/mês',
                  zapscript: 'ZapScript: R$ 699/mês',
                  economia: '79% de desconto',
                  sms: 'SMS: ~R$ 2.500-3k'
                },
              ].map((item, i) => (
                <div key={i} className="rounded-lg border-2 border-green-300 bg-white p-4 dark:border-green-700 dark:bg-slate-800">
                  <p className="mb-3 font-bold text-green-700 dark:text-green-300">{item.title}</p>
                  <div className="space-y-1 text-sm">
                    <p className="text-slate-600 dark:text-slate-400">{item.meta}</p>
                    <p className="font-semibold text-green-600 dark:text-green-400">✅ {item.zapscript}</p>
                    <p className="text-orange-600 dark:text-orange-400">{item.sms}</p>
                    <p className="mt-2 border-t border-green-200 pt-2 font-bold text-green-700 dark:border-green-700 dark:text-green-300">
                      💰 {item.economia}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* WhatsApp vs SMS — Foco em ROI */}
          <div className="mb-16 rounded-lg bg-blue-50 p-8 dark:bg-blue-950">
            <h2 className="mb-4 text-2xl font-bold">WhatsApp vs SMS — Qual dá mais Retorno?</h2>
            <div className="mb-6 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-2 font-semibold text-blue-900 dark:text-blue-100">WhatsApp (ZapScript Campanhas)</p>
                <ul className="space-y-1 text-sm text-blue-800 dark:text-blue-200">
                  <li>💰 R$ 0,33 por mensagem (Meta)</li>
                  <li>👁️ Abertura: 75%+ em 2 horas</li>
                  <li>💬 Respostas imediatas</li>
                  <li>📱 Mídia, botões, links interativos</li>
                  <li>🔐 API oficial (sem banimento)</li>
                </ul>
              </div>
              <div>
                <p className="mb-2 font-semibold text-blue-900 dark:text-blue-100">SMS</p>
                <ul className="space-y-1 text-sm text-blue-800 dark:text-blue-200">
                  <li>💰 R$ 0,15-0,30 por mensagem</li>
                  <li>👁️ Abertura: 10-15%</li>
                  <li>❌ Sem resposta direta</li>
                  <li>📄 Só texto, sem mídia</li>
                  <li>⚠️ Número genérico</li>
                </ul>
              </div>
            </div>

            {/* ROI Example */}
            <div className="rounded-lg bg-white p-4 dark:bg-slate-800">
              <p className="mb-3 font-semibold text-blue-900 dark:text-blue-100">📊 Exemplo Real: 10.000 clientes</p>
              <div className="grid gap-4 text-sm sm:grid-cols-2">
                <div className="border-l-4 border-green-500 pl-3">
                  <p className="font-semibold">WhatsApp ZapScript</p>
                  <p className="text-xs text-slate-600 dark:text-slate-400">Custo: 10k × R$ 0,33 = R$ 3.300</p>
                  <p className="text-xs text-slate-600 dark:text-slate-400">Abertura: 75% = 7.500 pessoas veem</p>
                  <p className="text-xs text-slate-600 dark:text-slate-400">Conversão 5% = 375 vendas</p>
                  <p className="mt-2 font-bold text-green-600">ROI: 375 vendas por R$ 3.300 = R$ 8,80/venda</p>
                </div>
                <div className="border-l-4 border-orange-500 pl-3">
                  <p className="font-semibold">SMS</p>
                  <p className="text-xs text-slate-600 dark:text-slate-400">Custo: 10k × R$ 0,25 = R$ 2.500</p>
                  <p className="text-xs text-slate-600 dark:text-slate-400">Abertura: 12% = 1.200 pessoas veem</p>
                  <p className="text-xs text-slate-600 dark:text-slate-400">Conversão 0,5% = 60 vendas</p>
                  <p className="mt-2 font-bold text-orange-600">ROI: 60 vendas por R$ 2.500 = R$ 41,67/venda</p>
                </div>
              </div>
              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                ⚠️ <strong>Resultado:</strong> WhatsApp custa 32% a mais, mas converte 6x melhor. Lucro final: ~6x maior com WhatsApp.
              </p>
            </div>
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
            <h2 className="mb-8 text-3xl font-bold">Planos de Campanhas — Economize até 79%</h2>
            <div className="mb-6 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                    <th className="px-4 py-3 text-left">Plano</th>
                    <th className="px-4 py-3 text-left">Você Paga</th>
                    <th className="px-4 py-3 text-left">Meta Cobraria</th>
                    <th className="px-4 py-3 text-left">💰 Economiza</th>
                  </tr>
                </thead>
                <tbody className="text-xs sm:text-sm">
                  <tr className="border-b border-slate-200 dark:border-slate-700">
                    <td className="px-4 py-3 font-semibold">Grátis</td>
                    <td className="px-4 py-3">R$ 0</td>
                    <td className="px-4 py-3">R$ 10 (30 msgs)</td>
                    <td className="px-4 py-3 font-bold text-green-600">R$ 10 (100%)</td>
                  </tr>
                  <tr className="border-b border-slate-200 bg-green-50 dark:border-slate-700 dark:bg-green-950">
                    <td className="px-4 py-3 font-semibold">Pré-Pago 1</td>
                    <td className="px-4 py-3 font-bold text-green-700">R$ 150</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">R$ 330 (1k msgs)</td>
                    <td className="px-4 py-3 font-bold text-green-600">R$ 180 (55%)</td>
                  </tr>
                  <tr className="border-b border-slate-200 bg-green-50 dark:border-slate-700 dark:bg-green-950">
                    <td className="px-4 py-3 font-semibold">Pré-Pago 5</td>
                    <td className="px-4 py-3 font-bold text-green-700">R$ 450</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">R$ 1.650 (5k msgs)</td>
                    <td className="px-4 py-3 font-bold text-green-600">R$ 1.200 (73%)</td>
                  </tr>
                  <tr className="bg-green-50 dark:border-slate-700 dark:bg-green-950">
                    <td className="px-4 py-3 font-semibold">Ilimitado</td>
                    <td className="px-4 py-3 font-bold text-green-700">R$ 699/mês</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">R$ 3.300 (10k msgs)</td>
                    <td className="px-4 py-3 font-bold text-green-600">R$ 2.601/mês (79%)</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              *Tarifa Meta: R$ 0,33 por mensagem. ZapScript revende com desconto. Você economiza a diferença.
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
