import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'ZapScript vs WhatsApp Business Platform — Qual a Diferença?',
  description:
    'Comparação real: usar API do WhatsApp Business direto vs ZapScript. Custo, complexidade, tempo de integração e qual escolher.',
  keywords:
    'whatsapp business api, whatsapp business platform, zapscript vs whatsapp business, api whatsapp complexidade',
  alternates: { canonical: 'https://www.zapscript.me/vs/whatsapp-business' },
  openGraph: {
    title: 'ZapScript vs WhatsApp Business Platform',
    description: 'Qual a diferença? Quando usar a API direto? Quando usar ZapScript?',
    url: 'https://www.zapscript.me/vs/whatsapp-business',
    type: 'website',
  },
};

const breadcrumbSchema = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'ZapScript', item: 'https://www.zapscript.me' },
    { '@type': 'ListItem', position: 2, name: 'Comparativos', item: 'https://www.zapscript.me/comparativos' },
    { '@type': 'ListItem', position: 3, name: 'vs WhatsApp Business', item: 'https://www.zapscript.me/vs/whatsapp-business' },
  ],
};

export default function VsWhatsappBusinessPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
        <div className="mx-auto max-w-4xl px-6 py-16 sm:py-24">
          {/* Hero */}
          <div className="mb-12 text-center">
            <h1 className="mb-4 text-4xl font-bold sm:text-5xl">
              ZapScript vs WhatsApp Business API
            </h1>
            <p className="mb-6 text-xl text-slate-600 dark:text-slate-300">
              Entenda as diferenças. Qual escolher para seu negócio?
            </p>
          </div>

          {/* TL;DR */}
          <div className="mb-12 rounded-lg border-2 border-blue-200 bg-blue-50 p-6 dark:border-blue-900 dark:bg-blue-950">
            <h2 className="mb-4 font-bold text-blue-900 dark:text-blue-100">🎯 TL;DR (Quick Answer)</h2>
            <div className="space-y-2 text-sm text-blue-800 dark:text-blue-200">
              <p>
                <span className="font-semibold">Se precisa de:</span> Dashboard simples, envio em minutos, sem dev
                → <span className="font-bold">ZapScript</span>
              </p>
              <p>
                <span className="font-semibold">Se precisa de:</span> Automação nativa no seu app, escalabilidade
                extrema, integração customizada → <span className="font-bold">API Direct</span>
              </p>
              <p className="mt-3 text-xs italic">
                Dica: 90% das empresas escolhem ZapScript (mais fácil e mais barato)
              </p>
            </div>
          </div>

          {/* Comparison Table */}
          <div className="mb-12 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-slate-300 bg-slate-100 dark:border-slate-700 dark:bg-slate-800">
                  <th className="px-4 py-3 text-left font-semibold">Aspecto</th>
                  <th className="px-4 py-3 text-left font-semibold">ZapScript Campanhas</th>
                  <th className="px-4 py-3 text-left font-semibold">API WhatsApp Direct</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                <tr>
                  <td className="px-4 py-3 font-semibold">Tempo para começar</td>
                  <td className="px-4 py-3">
                    <span className="rounded-lg bg-green-100 px-2 py-1 text-green-800 dark:bg-green-900 dark:text-green-200">
                      5 minutos
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-lg bg-orange-100 px-2 py-1 text-orange-800 dark:bg-orange-900 dark:text-orange-200">
                      2-4 semanas
                    </span>
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-semibold">Curva de aprendizado</td>
                  <td className="px-4 py-3 text-green-600">Nenhuma — UI visual</td>
                  <td className="px-4 py-3 text-orange-600">Desenvolvedores precisam</td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-semibold">Custo Setup</td>
                  <td className="px-4 py-3 text-green-600">R$ 0</td>
                  <td className="px-4 py-3 text-orange-600">
                    R$ 2k-10k (dev) + infraestrutura
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-semibold">Custo/mensagem</td>
                  <td className="px-4 py-3 text-green-600">
                    R$ 0,03-0,08* <br />
                    <span className="text-xs">(dependendo do template)</span>
                  </td>
                  <td className="px-4 py-3 text-orange-600">
                    R$ 0,03-0,15* <br />
                    <span className="text-xs">(cobrado direto pela Meta)</span>
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-semibold">Envio em massa</td>
                  <td className="px-4 py-3 text-green-600">Sim, interface simples</td>
                  <td className="px-4 py-3 text-slate-600">Sim, mas precisa implementar</td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-semibold">Segmentação/targeting</td>
                  <td className="px-4 py-3 text-green-600">Pronta (região, valor, categoria)</td>
                  <td className="px-4 py-3 text-slate-600">Você implementa</td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-semibold">Dashboard analytics</td>
                  <td className="px-4 py-3 text-green-600">Sim, em tempo real</td>
                  <td className="px-4 py-3 text-orange-600">Você constrói</td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-semibold">Templates aprovados</td>
                  <td className="px-4 py-3 text-green-600">ZapScript gerencia com Meta</td>
                  <td className="px-4 py-3 text-slate-600">Você aprova diretamente</td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-semibold">Suporte técnico</td>
                  <td className="px-4 py-3 text-green-600">ZapScript (PT-BR 24/7)</td>
                  <td className="px-4 py-3 text-orange-600">Só Meta (genérico)</td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-semibold">Escalabilidade</td>
                  <td className="px-4 py-3 text-green-600">
                    Até 100k msg/mês <br />
                    <span className="text-xs">(e além sem problema)</span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">Ilimitada (infraestrutura própria)</td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-semibold">Integração com seu app</td>
                  <td className="px-4 py-3 text-orange-600">API (não nativa)</td>
                  <td className="px-4 py-3 text-green-600">Nativa e customizável</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Quando usar cada */}
          <div className="mb-12 grid gap-8 sm:grid-cols-2">
            <div className="rounded-lg border-2 border-green-200 bg-green-50 p-6 dark:border-green-900 dark:bg-green-950">
              <h3 className="mb-4 text-xl font-bold text-green-900 dark:text-green-100">
                ✅ Use ZapScript quando...
              </h3>
              <ul className="space-y-2 text-sm text-green-800 dark:text-green-200">
                <li>• Quer começar HOJE (sem dev)</li>
                <li>• Precisa de UI visual e fácil</li>
                <li>• Quer economizar (R$ 0 de setup)</li>
                <li>• Dispara campanhas ocasionais</li>
                <li>• Precisa de suporte em português</li>
                <li>• Quer evitar gerenciar infra</li>
                <li>• Já usa ZapScript para outro uso</li>
              </ul>
            </div>

            <div className="rounded-lg border-2 border-orange-200 bg-orange-50 p-6 dark:border-orange-900 dark:bg-orange-950">
              <h3 className="mb-4 text-xl font-bold text-orange-900 dark:text-orange-100">
                ⚙️ Use API Direto quando...
              </h3>
              <ul className="space-y-2 text-sm text-orange-800 dark:text-orange-200">
                <li>• Integração nativa no seu app</li>
                <li>• Automações complexas (webhooks)</li>
                <li>• Escala de milhões de msg/mês</li>
                <li>• Lógica customizada por cliente</li>
                <li>• Quer controlar tudo (zero overhead)</li>
                <li>• Dispara 24/7 automaticamente</li>
                <li>• Tem time dev dedicado</li>
              </ul>
            </div>
          </div>

          {/* Real Example */}
          <div className="mb-12 rounded-lg bg-slate-100 p-6 dark:bg-slate-800">
            <h2 className="mb-4 text-2xl font-bold">Exemplo Real: Loja Online</h2>
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <h3 className="mb-3 font-semibold">Com ZapScript:</h3>
                <ul className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
                  <li>
                    <strong>Seg 10h:</strong> Loja cria campanha com fotos de produtos
                  </li>
                  <li>
                    <strong>Seg 10:15:</strong> Segmenta clientes por região
                  </li>
                  <li>
                    <strong>Seg 10:30:</strong> Dispara para 5 mil clientes
                  </li>
                  <li>
                    <strong>Seg 11h:</strong> Dashboard mostra 75% abriu + cliques
                  </li>
                  <li className="text-green-600">Total: 90 minutos. Custo: R$ 0 setup.</li>
                </ul>
              </div>

              <div>
                <h3 className="mb-3 font-semibold">Com API Direto:</h3>
                <ul className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
                  <li>
                    <strong>Semana 1:</strong> Contratar dev (R$ 5k) + planejar
                  </li>
                  <li>
                    <strong>Semana 2:</strong> Dev integra API + webhooks
                  </li>
                  <li>
                    <strong>Semana 3:</strong> QA + testes + deploy
                  </li>
                  <li>
                    <strong>Semana 4:</strong> Finalmente dispara primeira campanha
                  </li>
                  <li className="text-orange-600">Total: 4 semanas. Custo: R$ 5k+ dev.</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Pricing Comparison */}
          <div className="mb-12">
            <h2 className="mb-6 text-2xl font-bold">Comparação de Custo (1 ano, 50k msg/mês)</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                {
                  name: 'ZapScript',
                  setup: 'R$ 0',
                  perMonth: 'R$ 699 (ilimitado)',
                  yearlyMeta: 'R$ 0 (incluído)',
                  total: 'R$ 8.388/ano',
                  highlight: true,
                },
                {
                  name: 'API Direto + Dev',
                  setup: 'R$ 5.000',
                  perMonth: 'R$ 0',
                  yearlyMeta: 'R$ 3.000 (aprox.)',
                  total: 'R$ 8.000/ano',
                  highlight: false,
                },
              ].map((plan, i) => (
                <div
                  key={i}
                  className={`rounded-lg p-6 ${
                    plan.highlight
                      ? 'border-2 border-green-400 bg-green-50 dark:border-green-600 dark:bg-green-950'
                      : 'border border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <h3 className="mb-4 font-bold">{plan.name}</h3>
                  <div className="space-y-2 text-sm">
                    <p>
                      <span className="font-semibold">Setup:</span> {plan.setup}
                    </p>
                    <p>
                      <span className="font-semibold">Plataforma/mês:</span> {plan.perMonth}
                    </p>
                    <p>
                      <span className="font-semibold">Tarifas Meta/ano:</span> {plan.yearlyMeta}
                    </p>
                    <div className="border-t border-slate-300 pt-2 dark:border-slate-600">
                      <p className="font-bold">
                        <span className="font-semibold">Total/ano:</span> {plan.total}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
              *Cálculo simplificado. API Direto pode custar mais com infra, manutenção e atualizações.
            </p>
          </div>

          {/* CTA */}
          <div className="rounded-lg bg-blue-600 p-8 text-center text-white">
            <h2 className="mb-4 text-3xl font-bold">Pronto para Começar?</h2>
            <p className="mb-6">ZapScript é 90% mais rápido e 10x mais barato para começar.</p>
            <Link
              href="https://app.zapscript.me/cadastro"
              className="inline-block rounded-lg bg-white px-8 py-3 font-semibold text-blue-600 hover:bg-slate-100"
            >
              Criar Conta Grátis
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
