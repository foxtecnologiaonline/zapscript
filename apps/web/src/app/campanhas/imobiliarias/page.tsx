import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Campanhas WhatsApp para Imobiliárias — Sem Banimento',
  description:
    'Dispare campanhas de listas de transmissão no WhatsApp de forma oficial e segura. Oferta de imóvel, agendamento de visita, follow-up de cliente — sem risco de banimento.',
  keywords:
    'campanhas whatsapp imobiliarias, disparo em massa imobiliario, lista de transmissao whatsapp, oferta de imovel whatsapp, agendar visita whatsapp, follow-up cliente imobiliaria',
  alternates: { canonical: 'https://www.zapscript.me/campanhas/imobiliarias' },
  openGraph: {
    title: 'Campanhas WhatsApp para Imobiliárias',
    description: 'Dispare campanhas na lista de transmissão do WhatsApp com segurança oficial. Ofertas, agendamentos, follow-up.',
    url: 'https://www.zapscript.me/campanhas/imobiliarias',
    type: 'website',
  },
};

const softwareSchema = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'ZapScript Campanhas para Imobiliárias',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  url: 'https://www.zapscript.me/campanhas/imobiliarias',
  description: 'Plataforma para disparar campanhas no WhatsApp via API oficial Meta (WhatsApp Business Platform), voltada para imobiliárias.',
  inLanguage: 'pt-BR',
  featureList: [
    'Disparo em massa de ofertas de imóveis',
    'Templates aprovados pela Meta',
    'Segmentação por região, tipo de imóvel, valor',
    'Acompanhamento de cliques e engajamento',
    'Opt-out automático (LGPD)',
    'Integração com CRM do ZapScript',
  ],
};

const breadcrumbSchema = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'ZapScript', item: 'https://www.zapscript.me' },
    { '@type': 'ListItem', position: 2, name: 'Campanhas', item: 'https://www.zapscript.me/campanhas' },
    { '@type': 'ListItem', position: 3, name: 'Para Imobiliárias', item: 'https://www.zapscript.me/campanhas/imobiliarias' },
  ],
};

export default function CampanhasImobiliariasPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
        <div className="mx-auto max-w-4xl px-6 py-16 sm:py-24">
          {/* Hero */}
          <div className="mb-12 text-center">
            <h1 className="mb-4 text-4xl font-bold sm:text-5xl">
              Campanhas WhatsApp para <span className="text-blue-600">Imobiliárias</span>
            </h1>
            <p className="mb-6 text-xl text-slate-600 dark:text-slate-300">
              Dispare ofertas de imóveis, confirmações de visita e follow-up direto no WhatsApp — oficial, seguro e sem risco de banimento.
            </p>
            <div className="flex flex-col gap-4 sm:flex-row sm:justify-center">
              <Link
                href="https://app.zapscript.me/cadastro"
                className="inline-block rounded-lg bg-blue-600 px-8 py-3 font-semibold text-white hover:bg-blue-700"
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

          {/* Problemas & Soluções */}
          <div className="mb-16 grid gap-8 sm:grid-cols-2">
            <div className="rounded-lg border border-red-200 bg-red-50 p-6 dark:border-red-900 dark:bg-red-950">
              <h3 className="mb-2 font-bold text-red-700 dark:text-red-300">❌ Problema</h3>
              <ul className="space-y-2 text-sm text-red-600 dark:text-red-200">
                <li>• Bots não autorizados sendo banidos pela Meta</li>
                <li>• SMS caro (R$ 0,10 a 0,30 por mensagem)</li>
                <li>• Perda de contatos por desorganização</li>
                <li>• Sem acompanhamento de resultados</li>
              </ul>
            </div>

            <div className="rounded-lg border border-green-200 bg-green-50 p-6 dark:border-green-900 dark:bg-green-950">
              <h3 className="mb-2 font-bold text-green-700 dark:text-green-300">✅ Solução</h3>
              <ul className="space-y-2 text-sm text-green-600 dark:text-green-200">
                <li>• API oficial Meta (WhatsApp Business Platform)</li>
                <li>• Campanhas ilimitadas sem sobretaxa</li>
                <li>• Segmentação inteligente por localização/tipo</li>
                <li>• Dashboard com métricas em tempo real</li>
              </ul>
            </div>
          </div>

          {/* Casos de Uso */}
          <div className="mb-16">
            <h2 className="mb-8 text-3xl font-bold">Casos de Uso para Imobiliárias</h2>
            <div className="grid gap-6 sm:grid-cols-2">
              {[
                {
                  icon: '🏢',
                  title: 'Oferta de Imóvel',
                  desc: 'Nova propriedade? Dispare para seus clientes prontos para comprar com template aprovado pela Meta.',
                },
                {
                  icon: '📅',
                  title: 'Confirmação de Visita',
                  desc: 'Lembre clientes da agendamento de tour 24h antes. Reduz no-shows.',
                },
                {
                  icon: '🔔',
                  title: 'Follow-up Automático',
                  desc: 'Após visita: envie resumo do imóvel, financiamento e dúvidas frequentes.',
                },
                {
                  icon: '💬',
                  title: 'Pesquisa de Satisfação',
                  desc: 'Saiba como foi a experiência. Feedback direto via WhatsApp.',
                },
                {
                  icon: '🎯',
                  title: 'Segmentação Regional',
                  desc: 'Separe clientes por bairro/cidade. Envie só ofertas relevantes.',
                },
                {
                  icon: '📊',
                  title: 'Relatórios & Análise',
                  desc: 'Qual template converte melhor? Qual horário tem maior abertura? Dados completos.',
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

          {/* Preços */}
          <div className="mb-16">
            <h2 className="mb-8 text-3xl font-bold">Preços Simples e Transparentes</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                { title: 'Grátis', msg: '30 msgs/mês', price: 'R$ 0' },
                { title: 'Pré-Pago 1', msg: '1.000 msgs, 90 dias', price: 'R$ 150' },
                { title: 'Ilimitado', msg: 'Sem limite/mês', price: 'R$ 699/mês' },
              ].map((plan, i) => (
                <div key={i} className="rounded-lg border border-slate-200 p-6 text-center dark:border-slate-700">
                  <h3 className="mb-2 font-bold">{plan.title}</h3>
                  <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">{plan.msg}</p>
                  <p className="text-2xl font-bold">{plan.price}</p>
                </div>
              ))}
            </div>
            <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
              *Tarifas de mensagem cobradas pela Meta conforme categoria do template. ZapScript Campanhas é gratuito.
            </p>
          </div>

          {/* FAQ */}
          <div className="mb-16">
            <h2 className="mb-8 text-3xl font-bold">Perguntas Frequentes</h2>
            <div className="space-y-4">
              {[
                {
                  q: 'Posso enviar para lista de transmissão?',
                  a: 'Sim! A lista de transmissão do WhatsApp é o jeito mais seguro. Você envia para um grupo que a Meta reconhece como autorizado.',
                },
                {
                  q: 'E se o cliente responder PARAR?',
                  a: 'Automático. Qualquer um que responda PARAR, SAIR, STOP, CANCELAR ou UNSUBSCRIBE é excluído de futuras campanhas.',
                },
                {
                  q: 'Preciso de API Key ou número de Business?',
                  a: 'Não. ZapScript gerencia tudo. Você conecta uma vez e pronto — gerenciamos a API e templates com a Meta.',
                },
                {
                  q: 'Qual é o limite de destinatários?',
                  a: 'Sem limite. Envie para 10 ou 10 mil contatos — o dashboard mostra status de cada um.',
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
          <div className="rounded-lg bg-blue-600 p-8 text-center text-white">
            <h2 className="mb-4 text-3xl font-bold">Pronto para começar?</h2>
            <p className="mb-6">Crie sua conta e envie 30 campanhas grátis este mês.</p>
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
