import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Atualizando planos ZapScript v3.0...');

  const plans = [
    {
      name:            'free',
      label:           'Grátis',
      minutesPerMonth: 20,
      maxNumbers:      1,
      priceBrl:        0,
      features:        JSON.stringify([
        '20 min/mês',
        '1 número WhatsApp',
        '🎙️ Transcrição automática',
        '✨ Resumo com IA',
        '📋 Histórico de transcrições',
        '📅 Filtros por data e contato',
        '🔍 Busca por transcrição',
      ]),
    },
    {
      name:            'pro',
      label:           'Pro',
      minutesPerMonth: 200,
      maxNumbers:      2,
      priceBrl:        39.90,
      features:        JSON.stringify([
        '200 min/mês',
        '2 números WhatsApp',
        '🎙️ Transcrição automática',
        '🖥️ Transcrição de áudios no site',
        '✨ Resumo com IA',
        '📋 Histórico de transcrições',
        '📅 Filtros por data e contato',
        '🔍 Busca por transcrição',
        '📤 Exportar áudios em PDF, Docx, Csv e Excel',
        '📄 Transcrição Profissional (PDF com marcação temporal)',
        '🔒 Modo Privado de transcrição',
      ]),
    },
    {
      name:            'executive',
      label:           'Executive',
      minutesPerMonth: 300,
      maxNumbers:      3,
      priceBrl:        49.90,
      features:        JSON.stringify([
        '300 min/mês',
        '3 números WhatsApp',
        'Transcrição automática',
        'Transcrição de áudios no site',
        'Resumo com IA',
        'Histórico completo de transcrições',
        'Filtros por data e contato',
        'Busca no histórico',
        'Exportação PDF · DOCX · CSV · XLS',
        'Modo Privado de transcrição',
        'Webhook personalizado',
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
    console.log(`  ✓ ${plan.label} — R$${plan.priceBrl.toFixed(2)}/mês, ${plan.minutesPerMonth} min`);
  }

  console.log('✅ Planos v4.0: Grátis (R$0/20min), Pro (R$39,90/200min), Executive (R$49,90/300min)');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
