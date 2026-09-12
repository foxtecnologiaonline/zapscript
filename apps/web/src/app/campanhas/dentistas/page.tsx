import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Campanhas WhatsApp para Consultórios e Clínicas Dentárias — Confirmação Automática',
  description:
    'Automatize confirmação de consultas, lembre pacientes de agendamentos e reduza faltas com WhatsApp. API oficial Meta, seguro e 55-79% mais barato que Meta direto.',
  keywords:
    'confirmação consulta whatsapp dentista, agendamento dentário whatsapp, lembrança consulta whatsapp, clinica dentaria whatsapp, reduzir falta consulta, recall paciente dentista',
  alternates: { canonical: 'https://www.zapscript.me/campanhas/dentistas' },
  openGraph: {
    title: 'Campanhas WhatsApp para Consultórios Dentários',
    description: 'Confirmação de consultas, lembrança automática e redução de faltas no WhatsApp.',
    url: 'https://www.zapscript.me/campanhas/dentistas',
    type: 'website',
  },
};

const softwareSchema = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'ZapScript Campanhas para Dentistas',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  url: 'https://www.zapscript.me/campanhas/dentistas',
  description: 'Plataforma para automatizar comunicação com pacientes via WhatsApp — confirmação de consultas, lembrança de agendamentos, redução de faltas.',
  inLanguage: 'pt-BR',
  featureList: [
    'Confirmação automática de consultas 48h antes',
    'Lembrança de agendamento (recall)',
    'Notificação de resultado de exame',
    'Promoção de tratamentos',
    'Recuperação de pacientes inativos',
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
      name: 'Posso enviar para lista de transmissão?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Sim! A lista de transmissão do WhatsApp é segura. Você envia para um grupo que a Meta reconhece como autorizado — perfeito para confirmar consultas.',
      },
    },
    {
      '@type': 'Question',
      name: 'Quanto reduz a taxa de falta de consultas?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Empresas relatam redução de 30-50% nas faltas. Lembrança 24-48h antes aumenta comparecimento. Alguns consultórios economizam mais com redução de faltas do que gastam com campanhas.',
      },
    },
    {
      '@type': 'Question',
      name: 'Posso automatizar baseado na agenda?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Você pode disparar manualmente em segundos ou integrar com sua agenda (em breve). Por enquanto, basta um clique para enviar lembrança de todos com consulta amanhã.',
      },
    },
    {
      '@type': 'Question',
      name: 'E se o paciente quiser desmarcar?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Ele pode responder direto no WhatsApp. Mensagens chegam no seu número. Integração com atendimento automático (IA) vem em breve para responder automaticamente.',
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
    { '@type': 'ListItem', position: 3, name: 'Para Dentistas', item: 'https://www.zapscript.me/campanhas/dentistas' },
  ],
};

export default function CampanhasDentistasPage() {
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
              Campanhas WhatsApp para <span className="text-blue-600">Consultórios Dentários</span>
            </h1>
            <p className="mb-3 text-xl text-slate-600 dark:text-slate-300">
              Confirme consultas, reduza faltas e recupere pacientes inativos — tudo automatizado no WhatsApp.
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
                <li>• 20-40% de faltas em consultas agendadas</li>
                <li>• Atendente gastando tempo confirmando por telefone</li>
                <li>• Pacientes esquecendo consulta sem aviso prévio</li>
                <li>• Impossível recuperar pacientes inativos em massa</li>
                <li>• Sem visibilidade de quem confirmou/cancelou</li>
              </ul>
            </div>

            <div className="rounded-lg border border-green-200 bg-green-50 p-6 dark:border-green-900 dark:bg-green-950">
              <h3 className="mb-2 font-bold text-green-700 dark:text-green-300">✅ Solução Automática</h3>
              <ul className="space-y-2 text-sm text-green-600 dark:text-green-200">
                <li>• Confirmação automática 48h antes (reduz faltas 30-50%)</li>
                <li>• Um clique para enviar lembrança a todos agendados</li>
                <li>• Pacientes confirmam ou cancelam direto no WhatsApp</li>
                <li>• Campanhas de recall automático para inativos</li>
                <li>• Dashboard com taxa de confirmação em tempo real</li>
              </ul>
            </div>
          </div>

          {/* Casos de Uso */}
          <div className="mb-16">
            <h2 className="mb-8 text-3xl font-bold">Casos de Uso para Consultórios</h2>
            <div className="grid gap-6 sm:grid-cols-2">
              {[
                {
                  icon: '📅',
                  title: 'Confirmação de Consulta',
                  desc: 'Envie lembrança 24-48h antes. Paciente confirma ou cancela direto. Reduz no-shows automaticamente.',
                },
                {
                  icon: '🔔',
                  title: 'Recall Automático',
                  desc: 'Recupere pacientes com última consulta > 6 meses. Envie promoção de limpeza, check-up ou tratamento.',
                },
                {
                  icon: '📋',
                  title: 'Resultado de Exame',
                  desc: 'Notifique quando resultado fica pronto. Paciente agendar consulta de retorno sem ligação.',
                },
                {
                  icon: '💬',
                  title: 'Pós-Operatório',
                  desc: 'Envie instruções pós-cirurgia, dúvidas frequentes e agendamento de retorno 7/14 dias depois.',
                },
                {
                  icon: '🎯',
                  title: 'Promoção de Serviço',
                  desc: 'Segmente por tipo de tratamento. Ofereça branqueamento só a pacientes sem. Implante só a pacientes adequados.',
                },
                {
                  icon: '📊',
                  title: 'Análise de Comparecimento',
                  desc: 'Veja qual turno tem mais faltas, qual dentista tem melhor taxa. Dados para otimizar agenda.',
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

          {/* Economia ROI */}
          <div className="mb-16 rounded-lg bg-slate-100 p-6 dark:bg-slate-800">
            <h2 className="mb-6 text-2xl font-bold">Economia Real — Consultório de 50 pacientes/semana</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg bg-white p-4 dark:bg-slate-700">
                <p className="text-xs text-slate-500 dark:text-slate-400">Sem ZapScript</p>
                <p className="mb-2 font-bold">Faltas/semana: ~10 (20%)</p>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Perda: 10 × R$ 150 (ticket médio) = <span className="font-bold text-red-600">R$ 1.500/semana</span>
                </p>
              </div>
              <div className="rounded-lg border-2 border-green-400 bg-green-50 p-4 dark:border-green-600 dark:bg-green-950">
                <p className="text-xs text-slate-500 dark:text-slate-400">Com ZapScript</p>
                <p className="mb-2 font-bold">Faltas/semana: ~3 (redução 70%)</p>
                <p className="text-xs text-green-700 dark:text-green-300">
                  Ganho: 7 consultas × R$ 150 = <span className="font-bold">R$ 1.050/semana</span>
                </p>
              </div>
              <div className="rounded-lg bg-blue-50 p-4 dark:bg-blue-950">
                <p className="text-xs text-slate-500 dark:text-slate-400">Custo/mês</p>
                <p className="mb-2 font-bold">~R$ 20 (100 msgs/dia)</p>
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  ROI: +<span className="font-bold">R$ 4.000/mês</span> vs investimento 0.5%
                </p>
              </div>
            </div>
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
                  q: 'Funciona com múltiplos dentistas?',
                  a: 'Sim. Você controla a campanha por dentista, horário ou tipo de procedimento. Todos recebem lembrança personalizada.',
                },
                {
                  q: 'Pacientes veem que é automático?',
                  a: 'Não. Mensagem chega como se fosse da clínica. Você customiza o texto. Parece pessoal, é automático.',
                },
                {
                  q: 'E se o paciente responder?',
                  a: 'Mensagens chegam no seu WhatsApp. Você pode responder direto. Integração com atendimento IA vem em breve.',
                },
                {
                  q: 'Preciso de agenda integrada?',
                  a: 'Por enquanto não. Você dispara manualmente (1 clique). Integração com sistemas de agenda vem em breve.',
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
            <h2 className="mb-4 text-3xl font-bold">Comece a Reduzir Faltas Hoje</h2>
            <p className="mb-6">Envie 30 confirmações de consulta grátis este mês e veja o impacto.</p>
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
