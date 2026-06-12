/**
 * sync-pro-minutes.mjs — v3
 *
 * Sincroniza MinuteBalance dos usuários Pro de forma PRECISA:
 *   0. Atualiza o plano Pro para 200 min/R$39,90 no banco (caso migration ainda não aplicada)
 *   1. Para cada usuário Pro, determina o início do ciclo atual (resetAt - 30 dias)
 *   2. Soma os minutos usados neste ciclo a partir das Transcriptions reais
 *   3. Define availableMinutes = max(0, 200 - minutesUsedThisCycle)
 *   4. Garante que resetAt está ancorado no createdAt do usuário (ciclos de 30 dias)
 *   5. Corrige Subscription.currentPeriodEnd para coincidir com resetAt
 *
 * Uso:
 *   node scripts/sync-pro-minutes.mjs              (aplica)
 *   node scripts/sync-pro-minutes.mjs --dry-run    (visualiza sem alterar)
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Client } = require('../scripts_temp/node_modules/pg/lib/index.js');

const DRY_RUN    = process.argv.includes('--dry-run');
// ⚠️ Banco correto de produção (US West, sqqmusijaovhtiufbzsa) — mesma URL do zapscript.env
const DB_URL     = process.env.DATABASE_URL;
if (!DB_URL) { console.error('Defina DATABASE_URL no ambiente antes de rodar este script.'); process.exit(1); }
const PRO_MINUTES     = 200;  // minutos do plano Pro (será atualizado de 150)
const EXEC_MINUTES    = 300;  // minutos do plano Executive

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Calcula o próximo resetAt a partir da data de cadastro (ciclos de 30 dias) */
function nextResetFromCreatedAt(createdAt) {
  const created  = new Date(createdAt);
  const now      = new Date();
  const diffDays = (now - created) / (1000 * 60 * 60 * 24);
  const cycles   = Math.floor(diffDays / 30);
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
  console.log(`✅ Conectado ao banco de produção (US West)${DRY_RUN ? ' — MODO DRY RUN' : ''}\n`);

  // ── PASSO 0: Garantir que o plano Pro está com 200 min ──────────────────────
  const { rows: planRows } = await client.query(`
    SELECT id, name, "minutesPerMonth", "priceBrl"
    FROM "Plan" WHERE name = 'pro'
  `);
  const proPlan = planRows[0];
  if (!proPlan) { console.error('❌ Plano Pro não encontrado no banco!'); process.exit(1); }

  const needsPlanFix = proPlan.minutesPerMonth !== PRO_MINUTES;
  console.log(`📋 Plano Pro: ${proPlan.minutesPerMonth} min → ${needsPlanFix ? `${PRO_MINUTES} ⚠️ ATUALIZAR` : `${PRO_MINUTES} ✓`}`);

  if (!DRY_RUN && needsPlanFix) {
    await client.query(`
      UPDATE "Plan"
      SET "minutesPerMonth" = $1,
          "priceBrl"        = 39.90,
          "features"        = $2::jsonb
      WHERE name = 'pro'
    `, [PRO_MINUTES, JSON.stringify([
      '🎙️ Transcrição automática',
      '🖥️ Transcrição de áudios no site',
      '✨ Resumo com IA',
      '📋 Histórico de transcrições',
      '📅 Filtros por data e contato',
      '🔍 Busca por transcrição',
      '🔇 Modo Privado (2 números)',
      '📤 Exportação PDF · DOCX · CSV · XLS',
      '🌐 Múltiplos idiomas',
      '🧠 Tags e categorização',
    ])]);
    console.log(`  ✅ Plano Pro atualizado para ${PRO_MINUTES} min\n`);
  } else if (DRY_RUN && needsPlanFix) {
    console.log(`  ℹ️  (dry-run) Plan.minutesPerMonth seria atualizado para ${PRO_MINUTES}\n`);
  } else {
    console.log(`  ✓ Já correto\n`);
  }

  // ── PASSO 1: Buscar usuários Pro ────────────────────────────────────────────
  const { rows: proUsers } = await client.query(`
    SELECT
      u.id              AS "userId",
      u.email,
      u."createdAt",
      p.name            AS "planName",
      sub.id            AS "subId",
      sub."currentPeriodEnd",
      mb.id             AS "mbId",
      mb."availableMinutes",
      mb."accumulatedMinutes",
      mb."resetAt"
    FROM "User" u
    JOIN "Subscription" sub ON sub."userId" = u.id
    JOIN "Plan" p           ON p.id = sub."planId"
    LEFT JOIN "MinuteBalance" mb ON mb."userId" = u.id
    WHERE p.name IN ('pro', 'executive')
    ORDER BY u."createdAt"
  `);

  console.log(`📋 ${proUsers.length} usuário(s) Pro/Executive\n`);
  console.log(
    `${'Email'.padEnd(42)} ${'Ciclo início'.padEnd(14)} ${'Usado'.padEnd(9)} ${'Restará'.padEnd(9)} ${'Antes'.padEnd(9)} Reset em`
  );
  console.log('─'.repeat(115));

  let created = 0, updated = 0, subFixed = 0;

  for (const user of proUsers) {
    const resetAt    = nextResetFromCreatedAt(user.createdAt);
    const cycleStart = new Date(resetAt.getTime() - 30 * 24 * 60 * 60 * 1000);

    // ── Calcular minutos usados neste ciclo ───────────────────────────────────
    const { rows: usageRows } = await client.query(`
      SELECT COALESCE(SUM("durationSec") / 60.0, 0)::float AS "minutesUsed"
      FROM "Transcription"
      WHERE "userId" = $1 AND "createdAt" >= $2
    `, [user.userId, cycleStart]);

    const minutesUsed   = parseFloat(usageRows[0]?.minutesUsed || 0);
    const planLimit     = user.planName === 'executive' ? EXEC_MINUTES : PRO_MINUTES;
    const newAvailable  = Math.max(0, planLimit - minutesUsed);
    const oldAvailable  = parseFloat(user.availableMinutes || 0);

    console.log(
      `${user.email.padEnd(42)} ${fmt(cycleStart).padEnd(14)} ` +
      `${minutesUsed.toFixed(1).padEnd(9)} ${newAvailable.toFixed(1).padEnd(9)} ` +
      `${oldAvailable.toFixed(1).padEnd(9)} ${fmt(resetAt)}`
    );

    if (!DRY_RUN) {
      if (!user.mbId) {
        await client.query(`
          INSERT INTO "MinuteBalance"
            (id, "userId", "availableMinutes", "accumulatedMinutes", "resetAt", "updatedAt")
          VALUES
            (replace(gen_random_uuid()::text, '-', ''), $1, $2, $3, $4, NOW())
          ON CONFLICT ("userId") DO NOTHING
        `, [user.userId, newAvailable, minutesUsed, resetAt]);
        created++;
      } else {
        await client.query(`
          UPDATE "MinuteBalance"
          SET "availableMinutes"   = $1,
              "accumulatedMinutes" = GREATEST("accumulatedMinutes", $2),
              "resetAt"            = $3,
              "updatedAt"          = NOW()
          WHERE "userId" = $4
        `, [newAvailable, minutesUsed, resetAt, user.userId]);
        updated++;
      }

      // Corrigir Subscription.currentPeriodEnd se diferente do resetAt
      const needsFix = !user.currentPeriodEnd ||
        Math.abs(new Date(user.currentPeriodEnd) - resetAt) > 24 * 60 * 60 * 1000;
      if (needsFix) {
        await client.query(`
          UPDATE "Subscription"
          SET "currentPeriodEnd" = $1, "updatedAt" = NOW()
          WHERE id = $2
        `, [resetAt, user.subId]);
        subFixed++;
      }
    }
  }

  console.log('\n' + '─'.repeat(115));

  if (DRY_RUN) {
    console.log('\n⚠️  DRY RUN — nenhuma alteração aplicada.\n');
  } else {
    console.log(`\n✅ Concluído!`);
    console.log(`   Plano Pro:               ${needsPlanFix ? `${PRO_MINUTES} min ✓` : 'já correto'}`);
    console.log(`   MinuteBalance criados:   ${created}`);
    console.log(`   MinuteBalance atualizados: ${updated}`);
    console.log(`   Subscriptions corrigidas:  ${subFixed}`);
  }

  await client.end();
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
