/**
 * migrate-pro-tester-monthly.mjs
 *
 * Modelo de 2 planos (Free/Pro). Testers ficam no plano Pro com isTester=true e
 * recebem 12 meses de isenção de mensalidade (sem cobrança nesse período).
 *
 * Migra usuários com isTester=true para o ciclo mensal correto:
 *   0. Confirma que o plano 'pro' está com 200 min
 *   1. Garante que o tester está no plano 'pro' (sem cobrança: asaasSubscriptionId=null)
 *   2. Re-ancora MinuteBalance.resetAt no ciclo MENSAL a partir do createdAt
 *      (antes ficava em +365 dias — impedia o reset mensal e a contagem das 12 isenções)
 *   3. availableMinutes = max(0, 200 - minutos usados neste ciclo) — preserva o já consumido
 *   4. Subscription.currentPeriodEnd = NULL → dashboard mostra a renovação mensal (resetAt);
 *      a isenção de 12 meses é controlada por testerRenewalsUsed (máx 12, tratada pelo cron)
 *
 * Não mexe em usuários no plano 'executive' (legado superior).
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

  // ── PASSO 0: Confirmar plano pro ────────────────────────────────────────────
  const { rows: [proPlan] } = await client.query(`
    SELECT id, name, "minutesPerMonth" FROM "Plan" WHERE name = 'pro'
  `);
  if (!proPlan) { console.error('❌ Plano pro não encontrado.'); process.exit(1); }
  const PRO_MINUTES = proPlan.minutesPerMonth;
  console.log(`📋 Plano Pro: ${PRO_MINUTES} min (id=${proPlan.id})\n`);

  // ── PASSO 1: Buscar usuários isTester (exceto executive) ────────────────────
  const { rows: users } = await client.query(`
    SELECT
      u.id              AS "userId",
      u.email,
      u."createdAt",
      p.name            AS "planName",
      sub.id            AS "subId",
      sub."currentPeriodEnd",
      sub."testerRenewalsUsed",
      mb.id             AS "mbId",
      mb."availableMinutes",
      mb."accumulatedMinutes",
      mb."resetAt"
    FROM "User" u
    JOIN "Subscription" sub ON sub."userId" = u.id
    LEFT JOIN "Plan" p      ON p.id = sub."planId"
    LEFT JOIN "MinuteBalance" mb ON mb."userId" = u.id
    WHERE u."isTester" = true AND u."deletedAt" IS NULL
      AND (p.name IS NULL OR p.name <> 'executive')
    ORDER BY u."createdAt"
  `);

  console.log(`📋 ${users.length} usuário(s) tester (isTester=true)\n`);
  console.log(
    `${'Email'.padEnd(40)} ${'Plano'.padEnd(8)} ${'Ciclo início'.padEnd(13)} ${'Usado'.padEnd(8)} ${'Restará'.padEnd(8)} ${'Antes'.padEnd(8)} ${'Renov.'.padEnd(7)} Reset em`
  );
  console.log('─'.repeat(125));

  let planFixed = 0, created = 0, updated = 0, subFixed = 0;

  for (const u of users) {
    const resetAt    = nextResetFromCreatedAt(u.createdAt);
    const cycleStart = new Date(resetAt.getTime() - 30 * 24 * 60 * 60 * 1000);

    const { rows: [{ minutesUsed }] } = await client.query(`
      SELECT COALESCE(SUM("durationSec") / 60.0, 0)::float AS "minutesUsed"
      FROM "Transcription"
      WHERE "userId" = $1 AND "createdAt" >= $2
    `, [u.userId, cycleStart]);

    const used         = parseFloat(minutesUsed || 0);
    const newAvailable = Math.max(0, PRO_MINUTES - used);
    const oldAvailable = parseFloat(u.availableMinutes || 0);
    const renewals     = u.testerRenewalsUsed ?? 0;
    const onPro        = u.planName === 'pro';

    console.log(
      `${u.email.padEnd(40)} ${(u.planName || '?').padEnd(8)} ${fmt(cycleStart).padEnd(13)} ` +
      `${used.toFixed(1).padEnd(8)} ${newAvailable.toFixed(1).padEnd(8)} ` +
      `${oldAvailable.toFixed(1).padEnd(8)} ${String(renewals + '/12').padEnd(7)} ${fmt(resetAt)}`
    );

    if (DRY_RUN) continue;

    // ── Subscription: garante plano pro, sem cobrança, ciclo mensal ───────────
    await client.query(`
      UPDATE "Subscription"
      SET "planId"              = $1,
          status                = 'active',
          "asaasSubscriptionId" = NULL,
          "currentPeriodEnd"    = NULL,
          "updatedAt"           = NOW()
      WHERE id = $2
    `, [proPlan.id, u.subId]);
    if (!onPro) planFixed++;
    if (u.currentPeriodEnd !== null) subFixed++;

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
  }

  console.log('\n' + '─'.repeat(125));
  if (DRY_RUN) {
    console.log('\n⚠️  DRY RUN — nenhuma alteração aplicada.\n');
  } else {
    console.log(`\n✅ Concluído!`);
    console.log(`   Planos ajustados → pro:     ${planFixed}`);
    console.log(`   MinuteBalance criados:      ${created}`);
    console.log(`   MinuteBalance atualizados:  ${updated}`);
    console.log(`   currentPeriodEnd zerados:   ${subFixed}`);
  }

  await client.end();
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
