import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Criando planos ZapScript.me no banco...');

  await prisma.plan.createMany({
    data: [
      {
        name:            'free',
        label:           'Grátis',
        minutesPerMonth: 10,
        maxNumbers:      1,
        priceBrl:        0,
        asaasProductId:  null, // plano gratuito, sem cobrança
        features:        JSON.stringify([
          '10 min/mês',
          '1 número WhatsApp',
          'Painel simples',
          'Resumos e transcrições',
        ]),
      },
      {
        name:            'pro',
        label:           'Pro',
        minutesPerMonth: 200,
        maxNumbers:      2,
        priceBrl:        29.90,
        asaasProductId:  null, // Asaas não pré-cria IDs — valor passado na criação da assinatura
        features:        JSON.stringify([
          '200 min/mês',
          '2 números WhatsApp',
          'Painel avançado',
          'Resumos e transcrições',
          'Alertas de consumo',
        ]),
      },
      {
        name:            'ultra',
        label:           'Ultra',
        minutesPerMonth: 500,
        maxNumbers:      99,
        priceBrl:        59.90,
        asaasProductId:  null,
        features:        JSON.stringify([
          '500 min/mês',
          '3+ números WhatsApp',
          'Painel avançado',
          'Marcação de prioridade',
          'Resumos e transcrições',
          'Alertas de consumo',
          'Suporte prioritário',
        ]),
      },
    ],
    skipDuplicates: true,
  });

  console.log('✅ Planos criados: Grátis, Pro (R$29,90), Ultra (R$59,90)');
  console.log('ℹ️  Asaas não usa price IDs pré-criados — valores passados direto na assinatura.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
