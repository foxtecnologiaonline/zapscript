import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Criando planos ZapScript.me no banco...');

  await prisma.plan.createMany({
    data: [
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
          'Ponto chave IA',
        ]),
      },
      {
        name:            'pro',
        label:           'Pro',
        minutesPerMonth: 150,
        maxNumbers:      2,
        priceBrl:        29.90,
        asaasProductId:  null,
        features:        JSON.stringify([
          '150 min/mês',
          '2 números WhatsApp',
          'Transcrição automática',
          'Ponto chave IA',
        ]),
      },
      {
        name:            'ultra',
        label:           'Ultra',
        minutesPerMonth: 300,
        maxNumbers:      3,
        priceBrl:        59.90,
        asaasProductId:  null,
        features:        JSON.stringify([
          '300 min/mês',
          '3 números WhatsApp',
          'Transcrição automática',
          'Ponto chave IA',
          'Agenda Automática',
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
          'Ponto chave IA',
          'Agenda Automática',
          'Modo privado',
        ]),
      },
    ],
    skipDuplicates: true,
  });

  console.log('✅ Planos criados: Grátis, Pro (R$29,90), Ultra (R$59,90), Executive (R$89,90)');
  console.log('ℹ️  Asaas não usa price IDs pré-criados — valores passados direto na assinatura.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
