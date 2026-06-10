/**
 * migrate-pro-tester-monthly.mjs
 *
 * Migra usuários Pro Tester EXISTENTES para o modelo de ciclo mensal:
 *   0. Garante que o plano 'pro-tester' está com 200 min, R$0, 2 números
 *   1. Re-ancora MinuteBalance.resetAt no ciclo MENSAL a partir do createdAt
 *      (antes ficava em +365 dias — impedia o reset mensal e a contagem das 12 isenções)
 *   2. availableMinutes = max(0, 200 - minutos usados neste ciclo) — preserva o já consumido
 *   3. Subscription.currentPeriodEnd = NULL  → dashboard cai no resetAt mensal;
 *      isenção de pagamento controlada por testerRenewalsUsed (máx 12, tratada pelo cron)
 *
 * Itens da spec: ciclo mensal a partir do cadastro, isenção 12 meses, 200 min com
 * desconto dos minutos já usados no ciclo.
 *
 * Uso:
 *   node scripts/migrate-pro-tester-monthly.mjs              (aplica)
 *   node scripts/migrate-pro-tester-monthly.mjs --dry-run    (visualiza sem alterar)
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Client } = require('../scripts_temp/node_modules/pg/lib/index.js');

const DRY_RUN = process.argv.includes('--dry-run');
const DB_URL  = process.env.DATABASE_URL;
if (!DB_URL) { console.error('Defina DATABASE_URL no ambiente antes de rodar este script.'); process.exit(1); }
const PT_MINUTES = 200;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Próximo resetAt mensal (ciclos de 30 dias) ancorado na data de cadastro */
function nextResetFromCreatedAt(createdAt) {
  const created  = new Date(createdAt);
  const now      = new Date();
  const diffDays = (now - created) / (1000 * 60 * 60 * 24);
  const cycles   = Math.max(0, Math.floor(diffDays / 30));
  const next     = new Date(created);
  next.setDate(next.getDate() + (cycles + 1) * 30);
  next.setHours(created.getHours(), created.getMinutes(), created.getSeconds(), 0);
  return next;
}

function fmt(d) {
  return d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'null';
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log(`✅ Conectado ao banco${DRY_RUN ? ' — MODO DRY RUN' : ''}\n`);

  // ── PASSO 0: Garantir plano pro-tester com 200 min ──────────────────────────
  const { rows: planRows } = await client.query(`
    SELECT id, name, "minutesPerMonth", "priceBrl", "maxNumbers"
    FROM "Plan" WHERE name = 'pro-tester'
  `);
  const ptPlan = planRows[0];
  if (!ptPlan) {
    console.error('❌ Plano pro-tester não encontrado. Rode primeiro o endpoint admin /upgrade-pro-tester (ele faz o upsert do plano).');
    process.exit(1);
  }
  const needsPlanFix = ptPlan.minutesPerMonth !== PT_MINUTES;
  console.log(`📋 Plano pro-tester: ${ptPlan.minutesPerMonth} min → ${needsPlanFix ? `${PT_MINUTES} ⚠️ ATUALIZAR` : `${PT_MINUTES} ✓`}`);
  if (!DRY_RUN && needsPlanFix) {
    await client.query(`
      UPDATE "Plan"
      SET "minutesPerMonth" = $1, "priceBrl" = 0, "maxNumbers" = 2
      WHERE name = 'pro-tester'
    `, [PT_MINUTES]);
    console.log(`  ✅ Plano pro-tester atualizado para ${PT_MINUTES} min\n`);
  } else {
    console.log('');
  }

  // ── PASSO 1: Buscar usuários no plano pro-tester ────────────────────────────
  const { rows: users } = await client.query(`
    SELECT
      u.id              AS "userId",
      u.email,
      u."createdAt",
      sub.id            AS "subId",
      sub."currentPeriodEnd",
      sub."testerRenewalsUsed",
      mb.id             AS "mbId",
      mb."availableMinutes",
      mb."accumulatedMinutes",
      mb."resetAt"
    FROM "User" u
    JOIN "Subscription" sub ON sub."userId" = u.id
    JOIN "Plan" p           ON p.id = sub."planId"
    LEFT JOIN "MinuteBalance" mb ON mb."userId" = u.id
    WHERE p.name = 'pro-tester'
    ORDER BY u."createdAt"
  `);

  console.log(`📋 ${users.length} usuário(s) Pro Tester\n`);
  console.log(
    `${'Email'.padEnd(40)} ${'Ciclo início'.padEnd(13)} ${'Usado'.padEnd(8)} ${'Restará'.padEnd(8)} ${'Antes'.padEnd(8)} ${'Renov.'.padEnd(7)} Reset em`
  );
  console.log('─'.repeat(120));

  let created = 0, updated = 0, subFixed = 0;

  for (const u of users) {
    const resetAt    = nextResetFromCreatedAt(u.createdAt);
    const cycleStart = new Date(resetAt.getTime() - 30 * 24 * 60 * 60 * 1000);

    const { rows: [{ minutesUsed }] } = await client.query(`
      SELECT COALESCE(SUM("durationSec") / 60.0, 0)::float AS "minutesUsed"
      FROM "Transcription"
      WHERE "userId" = $1 AND "createdAt" >= $2
    `, [u.userId, cycleStart]);

    const used         = parseFloat(minutesUsed || 0);
    const newAvailable = Math.max(0, PT_MINUTES - used);
    const oldAvailable = parseFloat(u.availableMinutes || 0);
    const renewals     = u.testerRenewalsUsed ?? 0;

    console.log(
      `${u.email.padEnd(40)} ${fmt(cycleStart).padEnd(13)} ` +
      `${used.toFixed(1).padEnd(8)} ${newAvailable.toFixed(1).padEnd(8)} ` +
      `${oldAvailable.toFixed(1).padEnd(8)} ${String(renewals + '/12').padEnd(7)} ${fmt(resetAt)}`
    );

    if (DRY_RUN) continue;

    // ── MinuteBalance: re-ancora resetAt mensal + saldo descontando o usado ────
    if (!u.mbId) {
      await client.query(`
        INSERT INTO "MinuteBalance"
          (id, "userId", "availableMinutes", "accumulatedMinutes", "resetAt", "updatedAt")
        VALUES
          (replace(gen_random_uuid()::text, '-', ''), $1, $2, $3, $4, NOW())
        ON CONFLICT ("userId") DO NOTHING
      `, [u.userId, newAvailable, used, resetAt]);
      created++;
    } else {
      await client.query(`
        UPDATE "MinuteBalance"
        SET "availableMinutes"   = $1,
            "accumulatedMinutes" = GREATEST("accumulatedMinutes", $2),
            "resetAt"            = $3,
            "updatedAt"          = NOW()
        WHERE "userId" = $4
      `, [newAvailable, used, resetAt, u.userId]);
      updated++;
    }

    // ── Subscription: zerar currentPeriodEnd (ciclo mensal via resetAt) ────────
    if (u.currentPeriodEnd !== null) {
      await client.query(`
        UPDATE "Subscription"
        SET "currentPeriodEnd" = NULL, "updatedAt" = NOW()
        WHERE id = $1
      `, [u.subId]);
      subFixed++;
    }
  }

  console.log('\n' + '─'.repeat(120));
  if (DRY_RUN) {
    console.log('\n⚠️  DRY RUN — nenhuma alteração aplicada.\n');
  } else {
    console.log(`\n✅ Concluído!`);
    console.log(`   Plano pro-tester:           ${needsPlanFix ? `${PT_MINUTES} min ✓` : 'já correto'}`);
    console.log(`   MinuteBalance criados:      ${created}`);
    console.log(`   MinuteBalance atualizados:  ${updated}`);
    console.log(`   currentPeriodEnd zerados:   ${subFixed}`);
  }

  await client.end();
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
