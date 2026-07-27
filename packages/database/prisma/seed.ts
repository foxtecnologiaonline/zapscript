import { PrismaClient } from '@prisma/client';
// Fonte única da verdade do catálogo de módulos (ver MODULOS_ARQUITETURA.md).
import { MODULES } from '../../modules/catalog';

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
      priceBrl:        37,
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
      priceBrl:        67,
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
    // ── ZapScript 2.0 — Tiers anuais (SPEC Jul/2026) ──
    // Absorvem módulos existentes (ver TIER_MODULE_BUNDLES em billing.ts).
    // free/pro/executive acima continuam intocados; catálogo à parte.
    {
      name:            'atende',
      label:           'Atende',
      minutesPerMonth: 300,
      audiosPerMonth:  PRO_AUDIO_CAP,
      maxNumbers:      2,
      priceBrl:        59,
      features:        JSON.stringify([
        'Áudios ilimitados',
        '2 números WhatsApp',
        '🎙️ Conversão automática',
        '✨ Resumo com IA',
        '🤖 Atendimento automático 24/7 no WhatsApp',
        '📚 Base de conhecimento própria',
      ]),
    },
    {
      name:            'profissional',
      label:           'Profissional',
      minutesPerMonth: 400,
      audiosPerMonth:  PRO_AUDIO_CAP,
      maxNumbers:      3,
      priceBrl:        109,
      features:        JSON.stringify([
        'Tudo do Atende',
        '📊 CRM — funil de vendas no WhatsApp',
        '🗣️ Vendas — grave a visita, vira nota no CRM',
        '3 números WhatsApp',
      ]),
    },
    {
      name:            'empresas',
      label:           'Empresas',
      minutesPerMonth: 500,
      audiosPerMonth:  PRO_AUDIO_CAP,
      maxNumbers:      5,
      priceBrl:        179,
      features:        JSON.stringify([
        'Tudo do Profissional',
        '📣 Campanhas — disparo em massa via API oficial',
        '💰 Cobrança — lembrete automático de vencimento',
        '👥 Equipe — múltiplos usuários',
        '5 números WhatsApp',
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

  console.log(`✅ Planos: Grátis (R$0 / ${FREE_AUDIO_QUOTA} áudios), Pro (R$37 / ilimitado*${PRO_AUDIO_CAP}), Executive (R$67 / ilimitado*${PRO_AUDIO_CAP})`);

  // ── Catálogo de módulos (Product) — espelha packages/modules/catalog.ts ──
  console.log('🧩 Sincronizando catálogo de módulos...');
  for (const m of MODULES) {
    await prisma.product.upsert({
      where:  { key: m.key },
      update: { name: m.name, status: m.status, priceMonthly: m.priceMonthly, priceYearly: m.priceYearly, dependsOn: m.dependsOn },
      create: { key: m.key, name: m.name, status: m.status, priceMonthly: m.priceMonthly, priceYearly: m.priceYearly, dependsOn: m.dependsOn },
    });
    console.log(`  ✓ ${m.name} (${m.key}) — ${m.status}`);
  }

  // ── Backfill: todo usuário existente ganha o entitlement do módulo `core` ──
  // Idempotente (skipDuplicates + unique[userId,productKey]). O `core` tem tier
  // FREE, então dar acesso a todos é seguro; o tier segue governado por Plan.
  const users = await prisma.user.findMany({ where: { deletedAt: null }, select: { id: true } });
  if (users.length > 0) {
    const res = await prisma.entitlement.createMany({
      data: users.map((u) => ({ userId: u.id, productKey: 'core', source: 'bundle' as const })),
      skipDuplicates: true,
    });
    console.log(`✅ Backfill core: ${res.count} entitlement(s) criado(s) para ${users.length} usuário(s)`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
