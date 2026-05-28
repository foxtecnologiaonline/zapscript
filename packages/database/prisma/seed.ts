import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Atualizando planos ZapScript v2.0...');

  const plans = [
    {
      name:            'free',
      label:           'Grátis',
      minutesPerMonth: 20,
      maxNumbers:      1,
      priceBrl:        0,
      asaasProductId:  null,
      features:        JSON.stringify([
        '20 min/mês',
        '1 número WhatsApp',
        'Transcrição automática',
        'Resumo com pontos-chave IA',
      ]),
    },
    {
      name:            'pro',
      label:           'Pro',
      minutesPerMonth: 100,
      maxNumbers:      2,
      priceBrl:        39.90,
      asaasProductId:  null,
      features:        JSON.stringify([
        '100 min/mês',
        '2 números WhatsApp',
        'Transcrição automática',
        'Resumo com pontos-chave IA',
        'Histórico completo de transcrições',
      ]),
    },
    {
      name:            'ultra',
      label:           'Ultra',
      minutesPerMonth: 300,
      maxNumbers:      3,
      priceBrl:        69.90,
      asaasProductId:  null,
      features:        JSON.stringify([
        '300 min/mês',
        '3 números WhatsApp',
        'Transcrição automática',
        'Resumo com pontos-chave IA',
        'Histórico completo de transcrições',
        'Filtros por data e contato',
        'Busca no histórico',
      ]),
    },
    {
      name:            'executive',
      label:           'Executive',
      minutesPerMonth: 500,
      maxNumbers:      5,
      priceBrl:        89.90,
      asaasProductId:  null,
      features:        JSON.stringify([
        '500 min/mês',
        '5 números WhatsApp',
        'Transcrição automática',
        'Resumo com pontos-chave IA',
        'Histórico completo de transcrições',
        'Filtros por data e contato',
        'Busca no histórico',
      ]),
    },
  ];

  for (const plan of plans) {
    await prisma.plan.upsert({
      where:  { name: plan.name },
      update: {
        label:           plan.label,
        minutesPerMonth: plan.minutesPerMonth,
        maxNumbers:      plan.maxNumbers,
        priceBrl:        plan.priceBrl,
        features:        plan.features,
      },
      create: plan,
    });
  }

  console.log('✅ Planos v2.0: Grátis, Pro (R$39,90/100min), Ultra (R$69,90/300min), Executive (R$89,90/500min)');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
