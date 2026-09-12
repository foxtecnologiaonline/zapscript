import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Campanhas WhatsApp para Farmácias, Clínicas e Consultórios de Saúde',
  description:
    'Notifique pacientes sobre retirada de receita, agendamento de consulta e acompanhamento. WhatsApp oficial, seguro e 55-79% mais barato que Meta direto.',
  keywords:
    'notificação farmácia whatsapp, retirada receita whatsapp, agendamento médico whatsapp, farmacia campanha whatsapp, clinica saude whatsapp',
  alternates: { canonical: 'https://www.zapscript.me/campanhas/saude' },
  openGraph: {
    title: 'Campanhas WhatsApp para Saúde e Farmácias',
    description: 'Notificações de receita, agendamentos e acompanhamento via WhatsApp.',
    url: 'https://www.zapscript.me/campanhas/saude',
    type: 'website',
  },
};

const softwareSchema = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'ZapScript Campanhas para Saúde',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  url: 'https://www.zapscript.me/campanhas/saude',
  description: 'Plataforma para farmácias e clínicas comunicarem com pacientes via WhatsApp — notificações de receita, agendamentos e acompanhamento.',
  inLanguage: 'pt-BR',
  featureList: [
    'Notificação de receita pronta para retirada',
    'Agendamento de consulta automático',
    'Lembrete de medicação',
    'Acompanhamento pós-operatório',
    'Aviso de vencimento de medicação',
    'Opt-out automático (LGPD)',
  ],
};

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'Quanto economizo vs Meta direto?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: '55-79% de desconto. Exemplos: 1.000 mensagens custam R$150 no ZapScript vs R$330 da Meta (55% desconto). 5.000 custa R$450 vs R$1.650 (73% desconto). Ilimitado custa R$699/mês vs R$3.300/mês (79% desconto).',
      },
    },
    {
      '@type': 'Question',
      name: 'É legal enviar notificações via WhatsApp?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Sim. Pacientes consentem ao fornecer número. Você dispara via API oficial da Meta (não é spam). Automático opt-out com PARAR, SAIR, STOP.',
      },
    },
    {
      '@type': 'Question',
      name: 'Posso enviar lembrete de medicação?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Sim! Você pode agendar mensagens recorrentes. Exemplo: "Não esqueça de tomar o medicamento hoje às 8h".',
      },
    },
    {
      '@type': 'Question',
      name: 'Funciona para receitas digitais?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Perfeitamente. Notifique paciente quando receita chega no sistema (1 clique). Paciente vem retirar no mesmo dia.',
      },
    },
    {
      '@type': 'Question',
      name: 'Pacientes podem responder com dúvidas?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Sim. Mensagens chegam no WhatsApp da clínica/farmácia. Você responde direto. Atendimento IA para respostas automáticas vem em breve.',
      },
    },
  ],
};

const breadcrumbSchema = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'ZapScript', item: 'https://www.zapscript.me' },
    { '@type': 'ListItem', position: 2, name: 'Campanhas', item: 'https://www.zapscript.me/campanhas' },
    { '@type': 'ListItem', position: 3, name: 'Para Saúde', item: 'https://www.zapscript.me/campanhas/saude' },
  ],
};

export default function CampanhasSaudePage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
        <div className="mx-auto max-w-4xl px-6 py-16 sm:py-24">
          {/* Hero */}
          <div className="mb-12 text-center">
            <h1 className="mb-4 text-4xl font-bold sm:text-5xl">
              Campanhas WhatsApp para <span className="text-blue-600">Farmácias e Clínicas</span>
            </h1>
            <p className="mb-3 text-xl text-slate-600 dark:text-slate-300">
              Notifique pacientes sobre receita pronta, agendamentos e medicações — sem ligações, sem SMS caro.
            </p>
            <div className="mb-6 rounded-lg bg-blue-100 px-4 py-2 text-lg font-bold text-blue-800 dark:bg-blue-900 dark:text-blue-200">
              💰 Economize 55-79% vs Meta direto
            </div>
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

          {/* Problema & Solução */}
          <div className="mb-16 grid gap-8 sm:grid-cols-2">
            <div className="rounded-lg border border-red-200 bg-red-50 p-6 dark:border-red-900 dark:bg-red-950">
              <h3 className="mb-2 font-bold text-red-700 dark:text-red-300">❌ Desafios Atuais</h3>
              <ul className="space-y-2 text-sm text-red-600 dark:text-red-200">
                <li>• Pacientes ligam perguntando se receita está pronta</li>
                <li>• SMS caro (R$ 0,15-0,30/msg) com taxa abertura de 12%</li>
                <li>• Pacientes esquecem de retirar medicação na farmácia</li>
                <li>• Sem histórico de comunicação com paciente</li>
                <li>• Sem visibilidade de quem leu/recebeu mensagem</li>
              </ul>
            </div>

            <div className="rounded-lg border border-green-200 bg-green-50 p-6 dark:border-green-900 dark:bg-green-950">
              <h3 className="mb-2 font-bold text-green-700 dark:text-green-300">✅ Solução Automática</h3>
              <ul className="space-y-2 text-sm text-green-600 dark:text-green-200">
                <li>• Notificação automática quando receita fica pronta</li>
                <li>• WhatsApp tem 75% taxa de abertura vs 12% SMS</li>
                <li>• Paciente clica e vem retirar no mesmo dia</li>
                <li>• Histórico completo de comunicação</li>
                <li>• Dashboard com taxa de leitura e retirada</li>
              </ul>
            </div>
          </div>

          {/* Casos de Uso */}
          <div className="mb-16">
            <h2 className="mb-8 text-3xl font-bold">Casos de Uso para Saúde</h2>
            <div className="grid gap-6 sm:grid-cols-2">
              {[
                {
                  icon: '💊',
                  title: 'Notificação de Receita',
                  desc: 'Receita pronta na farmácia? Avise paciente por WhatsApp em 1 clique. Retirada no mesmo dia.',
                },
                {
                  icon: '📅',
                  title: 'Agendamento de Consulta',
                  desc: 'Envie link ou botão para agendar próxima consulta. Paciente clica e marca tudo pelo WhatsApp.',
                },
                {
                  icon: '🔔',
                  title: 'Lembrete de Medicação',
                  desc: 'Mensagem diária (ou semanal) para tomar medicação. Sem esquecer, melhor aderência.',
                },
                {
                  icon: '⏰',
                  title: 'Acompanhamento Pós-Operatório',
                  desc: 'Instruções de cuidado, dúvidas frequentes e agendamento de retorno 7/14 dias depois.',
                },
                {
                  icon: '⚠️',
                  title: 'Aviso de Vencimento',
                  desc: 'Medicação vencida? Avise paciente e ofereça renovação. Alguns precisam de receita nova.',
                },
                {
                  icon: '📊',
                  title: 'Análise de Adesão',
                  desc: 'Qual paciente retirou receita? Quem faltou consulta? Dados para follow-up automático.',
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

          {/* Comparação SMS vs WhatsApp */}
          <div className="mb-16 rounded-lg border-2 border-blue-200 bg-blue-50 p-6 dark:border-blue-900 dark:bg-blue-950">
            <h2 className="mb-6 text-2xl font-bold">WhatsApp vs SMS — Qual vale mais a pena?</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-blue-300">
                    <th className="px-4 py-3 text-left font-semibold">Métrica</th>
                    <th className="px-4 py-3 text-left font-semibold">SMS</th>
                    <th className="px-4 py-3 text-left font-semibold">WhatsApp</th>
                    <th className="px-4 py-3 text-left font-semibold">Vantagem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-blue-200">
                  <tr>
                    <td className="px-4 py-3 font-semibold">Custo/msg</td>
                    <td className="px-4 py-3">R$ 0,20-0,30</td>
                    <td className="px-4 py-3">R$ 0,33 (ZapScript R$ 0,15)</td>
                    <td className="px-4 py-3 font-bold text-green-700">WhatsApp (com ZapScript)</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-semibold">Taxa abertura</td>
                    <td className="px-4 py-3">12%</td>
                    <td className="px-4 py-3">75%</td>
                    <td className="px-4 py-3 font-bold text-green-700">6x melhor WhatsApp</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-semibold">Resposta</td>
                    <td className="px-4 py-3">Não (SMS unidirecional)</td>
                    <td className="px-4 py-3">Sim (bidirecional)</td>
                    <td className="px-4 py-3 font-bold text-green-700">WhatsApp ganha</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-semibold">1.000 mensagens</td>
                    <td className="px-4 py-3">R$ 250</td>
                    <td className="px-4 py-3">R$ 150 (55% off)</td>
                    <td className="px-4 py-3 font-bold text-green-700">R$ 100 economiza</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-sm text-blue-800 dark:text-blue-200">
              <strong>Resultado:</strong> WhatsApp não é só mais barato, é 6x melhor em engajamento. Mesma receita, muito mais retiradas.
            </p>
          </div>

          {/* Preços */}
          <div className="mb-16">
            <h2 className="mb-8 text-3xl font-bold">Planos — Economize até 79%</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                {
                  title: 'Grátis',
                  voce: 'R$ 0',
                  meta: 'R$ 10 (30 msgs)',
                  economia: '100%',
                  msgs: '30/mês'
                },
                {
                  title: 'Pré-Pago 1',
                  voce: 'R$ 150',
                  meta: 'R$ 330 (1k msgs)',
                  economia: '55%',
                  msgs: '1.000 msgs'
                },
                {
                  title: 'Ilimitado',
                  voce: 'R$ 699/mês',
                  meta: 'R$ 3.300/mês',
                  economia: '79%',
                  msgs: 'Sem limite'
                },
              ].map((plan, i) => (
                <div key={i} className={`rounded-lg border-2 p-6 text-center ${
                  plan.economia === '100%' || plan.economia === '55%' || plan.economia === '79%'
                    ? 'border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-950'
                    : 'border-slate-200 dark:border-slate-700'
                }`}>
                  <h3 className="mb-1 text-lg font-bold">{plan.title}</h3>
                  <p className="mb-3 text-xs text-slate-600 dark:text-slate-400">{plan.msgs}</p>
                  <div className="space-y-2 rounded bg-white p-2 dark:bg-slate-800">
                    <div>
                      <p className="text-xs text-slate-500 dark:text-slate-500">Você paga</p>
                      <p className="font-bold text-green-700 dark:text-green-300">{plan.voce}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 dark:text-slate-500">Meta cobraria</p>
                      <p className="text-xs text-slate-600 dark:text-slate-400">{plan.meta}</p>
                    </div>
                  </div>
                  <p className="mt-3 border-t-2 border-green-300 pt-2 font-bold text-green-700 dark:border-green-700 dark:text-green-300">
                    💰 {plan.economia} off
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* FAQ */}
          <div className="mb-16">
            <h2 className="mb-8 text-3xl font-bold">Perguntas Frequentes</h2>
            <div className="space-y-4">
              {[
                {
                  q: 'Preciso integrar com meu sistema de farmácia?',
                  a: 'Não é obrigatório. Você pode disparar manualmente (1 clique). Integração com sistemas legados vem em breve.',
                },
                {
                  q: 'E se o paciente quiser cancelar?',
                  a: 'Ele responde PARAR, SAIR, STOP ou CANCELAR. Automático opt-out conforme LGPD. Nunca mais recebe.',
                },
                {
                  q: 'Posso agendar mensagens recorrentes?',
                  a: 'Sim. Exemplo: "Lembrete medicação" toda segunda às 8h. Você configura uma vez, automático todo mês.',
                },
                {
                  q: 'Funciona para clínicas multiprofissionais?',
                  a: 'Perfeitamente. Você separa por especialidade, dentista ou médico. Cada paciente recebe só mensagens relevantes.',
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
            <h2 className="mb-4 text-3xl font-bold">Avise Pacientes Hoje</h2>
            <p className="mb-6">Envie 30 notificações grátis este mês — sem cartão, sem compromisso.</p>
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
