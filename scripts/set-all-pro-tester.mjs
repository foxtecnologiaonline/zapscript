/**
 * set-all-pro-tester.mjs
 *
 * Para cada usuário na base:
 *   1. isTester = true
 *   2. Subscription → Plano Pro (200 min, R$0 por 1 ano)
 *   3. currentPeriodEnd = createdAt + 365 dias
 *   4. MinuteBalance recalculado: 200 - minutos usados no ciclo atual
 *
 * Uso:
 *   node scripts/set-all-pro-tester.mjs              (aplica)
 *   node scripts/set-all-pro-tester.mjs --dry-run    (visualiza sem alterar)
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Client } = require('../scripts_temp/node_modules/pg/lib/index.js');

const DRY_RUN   = process.argv.includes('--dry-run');
const DB_URL    = 'postgresql://postgres.sqqmusijaovhtiufbzsa:691393%40rfts@aws-1-us-west-2.pooler.supabase.com:5432/postgres';
const PRO_MIN   = 200;

function fmt(d) {
  return d ? new Date(d).toLocaleDateString('pt-BR') : 'null';
}

const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log(`✅ Conectado${DRY_RUN ? ' — MODO DRY RUN' : ''}\n`);

// ── Buscar plano Pro ─────────────────────────────────────────────────────────
const { rows: [proPlan] } = await client.query(
  `SELECT id, name, "minutesPerMonth" FROM "Plan" WHERE name = 'pro'`
);
if (!proPlan) { console.error('❌ Plano pro não encontrado'); process.exit(1); }
console.log(`📋 Plano Pro: id=${proPlan.id} | ${proPlan.minutesPerMonth} min\n`);

// ── Buscar todos os usuários com subscription + balance ──────────────────────
const { rows: users } = await client.query(`
  SELECT
    u.id            AS "userId",
    u.email,
    u."isTester",
    u."createdAt",
    p.name          AS "planName",
    sub.id          AS "subId",
    sub."planId"    AS "currentPlanId",
    sub.status      AS "subStatus",
    sub."currentPeriodEnd",
    mb.id           AS "mbId",
    mb."availableMinutes",
    mb."resetAt"
  FROM "User" u
  LEFT JOIN "Subscription" sub ON sub."userId" = u.id
  LEFT JOIN "Plan" p           ON p.id = sub."planId"
  LEFT JOIN "MinuteBalance" mb ON mb."userId" = u.id
  ORDER BY u."createdAt"
`);

console.log(`👥 ${users.length} usuário(s) encontrados\n`);
console.log(
  `${'Email'.padEnd(40)} ${'Plano atual'.padEnd(14)} ${'Tester'} ${'Cadastro'.padEnd(12)} ${'Nova expiração'.padEnd(14)} ${'Min restará'}`
);
console.log('─'.repeat(110));

let updated = 0, skipped = 0;

for (const u of users) {
  // currentPeriodEnd = createdAt + 365 dias
  const newExpiry = new Date(u.createdAt);
  newExpiry.setFullYear(newExpiry.getFullYear() + 1);

  // Calcular minutos usados no ciclo atual (últimos 30 dias desde createdAt)
  const cycleStart = new Date(newExpiry.getTime() - 365 * 24 * 60 * 60 * 1000);
  // ciclo mensal atual = volta 30 dias a partir de hoje
  const monthAgo   = new Date(); monthAgo.setDate(monthAgo.getDate() - 30);

  const { rows: [{ minutesUsed }] } = await client.query(`
    SELECT COALESCE(SUM("durationSec") / 60.0, 0)::float AS "minutesUsed"
    FROM "Transcription"
    WHERE "userId" = $1 AND "createdAt" >= $2
  `, [u.userId, monthAgo]);

  const newAvail = Math.max(0, PRO_MIN - parseFloat(minutesUsed));

  const isPro      = u.planName === 'pro';
  const isTester   = u.isTester === true;
  const expiryOk   = u.currentPeriodEnd &&
    Math.abs(new Date(u.currentPeriodEnd) - newExpiry) < 24 * 60 * 60 * 1000;

  const alreadyOk  = isPro && isTester && expiryOk;

  console.log(
    u.email.padEnd(40),
    (u.planName || '?').padEnd(14),
    String(u.isTester).padEnd(8),
    fmt(u.createdAt).padEnd(12),
    fmt(newExpiry).padEnd(14),
    newAvail.toFixed(1) + (alreadyOk ? ' ✓' : ' ← atualizar')
  );

  if (DRY_RUN || alreadyOk) { skipped++; continue; }

  // ── Atualizar User.isTester ────────────────────────────────────────────────
  await client.query(
    `UPDATE "User" SET "isTester" = true WHERE id = $1`,
    [u.userId]
  );

  // ── Atualizar Subscription ─────────────────────────────────────────────────
  if (u.subId) {
    await client.query(`
      UPDATE "Subscription"
      SET "planId"           = $1,
          status             = 'active',
          "currentPeriodEnd" = $2,
          "updatedAt"        = NOW()
      WHERE id = $3
    `, [proPlan.id, newExpiry, u.subId]);
  } else {
    // Criar subscription se não existir
    await client.query(`
      INSERT INTO "Subscription" (id, "userId", "planId", status, "currentPeriodEnd", "createdAt", "updatedAt")
      VALUES (replace(gen_random_uuid()::text,'-',''), $1, $2, 'active', $3, NOW(), NOW())
    `, [u.userId, proPlan.id, newExpiry]);
  }

  // ── Atualizar MinuteBalance ────────────────────────────────────────────────
  // resetAt = próximo ciclo mensal baseado no createdAt
  const nextReset = new Date(u.createdAt);
  const now       = new Date();
  while (nextReset <= now) nextReset.setDate(nextReset.getDate() + 30);

  if (u.mbId) {
    await client.query(`
      UPDATE "MinuteBalance"
      SET "availableMinutes"   = $1,
          "accumulatedMinutes" = GREATEST("accumulatedMinutes", $2),
          "resetAt"            = $3,
          "updatedAt"          = NOW()
      WHERE "userId" = $4
    `, [newAvail, parseFloat(minutesUsed), nextReset, u.userId]);
  } else {
    await client.query(`
      INSERT INTO "MinuteBalance"
        (id, "userId", "availableMinutes", "accumulatedMinutes", "resetAt", "updatedAt")
      VALUES (replace(gen_random_uuid()::text,'-',''), $1, $2, $3, $4, NOW())
      ON CONFLICT ("userId") DO NOTHING
    `, [u.userId, newAvail, parseFloat(minutesUsed), nextReset]);
  }

  updated++;
}

console.log('\n' + '─'.repeat(110));
if (DRY_RUN) {
  console.log('\n⚠️  DRY RUN — nenhuma alteração aplicada.');
  console.log(`   ${users.length} usuários seriam atualizados.\n`);
} else {
  console.log(`\n✅ Concluído!`);
  console.log(`   Atualizados: ${updated}`);
  console.log(`   Já corretos: ${skipped}\n`);
}

await client.end();
