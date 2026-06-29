import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Atualizando planos ZapScript v3.0...');

  // FREE_AUDIO_QUOTA parametrizável por env (default 15). PRO = teto oculto 500.
  const FREE_AUDIO_QUOTA = parseInt(process.env.FREE_AUDIO_QUOTA || '15', 10);
  const PRO_AUDIO_CAP    = parseInt(process.env.PRO_AUDIO_CAP    || '500', 10);

  const plans = [
    {
      name:            'free',
      label:           'Grátis',
      minutesPerMonth: 20,
      audiosPerMonth:  FREE_AUDIO_QUOTA,
      maxNumbers:      1,
      priceBrl:        0,
      features:        JSON.stringify([
        `${FREE_AUDIO_QUOTA} áudios/mês`,
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
      audiosPerMonth:  PRO_AUDIO_CAP,
      maxNumbers:      2,
      priceBrl:        39.90,
      features:        JSON.stringify([
        'Áudios ilimitados',
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
      audiosPerMonth:  PRO_AUDIO_CAP,
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
        audiosPerMonth:  plan.audiosPerMonth,
        maxNumbers:      plan.maxNumbers,
        priceBrl:        plan.priceBrl,
        features:        plan.features,
      },
      create: plan,
    });
    console.log(`  ✓ ${plan.label} — R$${plan.priceBrl.toFixed(2)}/mês, ${plan.audiosPerMonth} áudios`);
  }

  console.log(`✅ Planos: Grátis (R$0 / ${FREE_AUDIO_QUOTA} áudios), Pro (R$39,90 / ilimitado*${PRO_AUDIO_CAP}), Executive (R$49,90 / ilimitado*${PRO_AUDIO_CAP})`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
