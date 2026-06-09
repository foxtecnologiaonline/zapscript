/**
 * sync-pro-minutes.mjs
 * Sincroniza MinuteBalance para todos os usuários Pro:
 *   1. Cria MinuteBalance (200 min) para usuários sem registro
 *   2. Garante que todos Pro tenham >= 200 min disponíveis (GREATEST)
 *   3. Corrige resetAt e Subscription.currentPeriodEnd baseados no createdAt do usuário
 *
 * Uso:
 *   node scripts/sync-pro-minutes.mjs
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Client } = require('../scripts_temp/node_modules/pg/lib/index.js');

// Novo banco SP (sa-east-1)
const DB_URL = 'postgresql://postgres.iqesoqtqnzczlnvoqwnp:ntPY9hMRwAmlK6zO@aws-1-sa-east-1.pooler.supabase.com:6543/postgres';

function nextCycleDate(createdAt) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const created = new Date(createdAt);

  // Número de ciclos de 30 dias desde o cadastro
  const diffMs = today - created;
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  const cyclesPassed = Math.floor(diffDays / 30);

  // Próxima renovação = createdAt + (cyclesPassed + 1) * 30 dias
  const next = new Date(created);
  next.setDate(next.getDate() + (cyclesPassed + 1) * 30);
  return next;
}

async function main() {
  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('✅ Conectado ao banco de produção (SP)');

  // Buscar todos os usuários Pro com info de subscription e balance
  const { rows: proUsers } = await client.query(`
    SELECT
      u.id            AS "userId",
      u."createdAt",
      u.email,
      sub.id          AS "subId",
      sub."currentPeriodEnd",
      mb.id           AS "mbId",
      mb."availableMinutes",
      mb."resetAt"
    FROM "User" u
    JOIN "Subscription" sub ON sub."userId" = u.id
    JOIN "Plan" p ON p.id = sub."planId"
    LEFT JOIN "MinuteBalance" mb ON mb."userId" = u.id
    WHERE p.name = 'pro'
    ORDER BY u."createdAt"
  `);

  console.log(`\n📋 ${proUsers.length} usuário(s) Pro encontrado(s)\n`);

  let created = 0;
  let updated = 0;
  let subFixed = 0;

  for (const user of proUsers) {
    const resetAt = nextCycleDate(user.createdAt);
    const email = user.email;

    if (!user.mbId) {
      // Criar MinuteBalance com 200 minutos
      await client.query(`
        INSERT INTO "MinuteBalance" (id, "userId", "availableMinutes", "accumulatedMinutes", "resetAt", "updatedAt")
        VALUES (
          replace(gen_random_uuid()::text, '-', ''),
          $1, 200, 0, $2, NOW()
        )
        ON CONFLICT ("userId") DO NOTHING
      `, [user.userId, resetAt]);
      console.log(`  ➕ ${email} — MinuteBalance criado (200 min, reset: ${resetAt.toLocaleDateString('pt-BR')})`);
      created++;
    } else {
      // Garantir >= 200 min disponíveis (GREATEST)
      const newBalance = Math.max(parseFloat(user.availableMinutes) || 0, 200);
      await client.query(`
        UPDATE "MinuteBalance"
        SET "availableMinutes" = $1,
            "resetAt" = CASE WHEN "resetAt" < NOW() THEN $2 ELSE "resetAt" END,
            "updatedAt" = NOW()
        WHERE id = $3
      `, [newBalance, resetAt, user.mbId]);
      console.log(`  🔄 ${email} — MinuteBalance: ${parseFloat(user.availableMinutes).toFixed(1)} → ${newBalance} min, reset: ${resetAt.toLocaleDateString('pt-BR')}`);
      updated++;
    }

    // Corrigir currentPeriodEnd na Subscription se null ou passado
    const periodEnd = user.currentPeriodEnd ? new Date(user.currentPeriodEnd) : null;
    const needsFix = !periodEnd || periodEnd < new Date();
    if (needsFix) {
      await client.query(`
        UPDATE "Subscription"
        SET "currentPeriodEnd" = $1, "updatedAt" = NOW()
        WHERE id = $2
      `, [resetAt, user.subId]);
      console.log(`  📅 ${email} — Subscription.currentPeriodEnd → ${resetAt.toLocaleDateString('pt-BR')}`);
      subFixed++;
    }
  }

  await client.end();
  console.log(`\n✅ Concluído!`);
  console.log(`   MinuteBalance criados:   ${created}`);
  console.log(`   MinuteBalance atualizados: ${updated}`);
  console.log(`   Subscriptions corrigidas:  ${subFixed}`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
