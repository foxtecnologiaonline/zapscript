/**
 * migrate-users-to-core.mjs
 *
 * Migra TODOS os usuários atuais (free, pro, executive — e qualquer um já
 * nos tiers novos) para o plano Core (= "free" no banco). Isso é um
 * DOWNGRADE REAL para quem hoje paga Pro/Executive: perdem os benefícios
 * pagos e a assinatura recorrente no Asaas é cancelada.
 *
 * O que o script faz por usuário:
 *   1. Cancela a assinatura no Asaas (DELETE /subscriptions/:id), se houver.
 *   2. Subscription → plano "free" (Core), status 'active'.
 *   3. Revoga Entitlement(source='bundle') — módulos que vieram de um tier pago.
 *   4. MinuteBalance recalculado pra cota do Core.
 *
 * O que o script NÃO faz (decisão de negócio, fora de escopo daqui):
 *   - Não envia e-mail avisando o cliente da mudança. Comunicar ANTES de
 *     rodar com --apply é essencial — ver seção "Antes de rodar" abaixo.
 *   - Não roda sozinho em nenhum deploy — é 100% manual, com todos os
 *     freios abaixo.
 *
 * Antes de rodar:
 *   1. Rode sem --apply (dry-run é o padrão) e revise a tabela e o resumo
 *      financeiro (quantos assinantes pagantes perdem acesso, MRR afetado).
 *   2. Avise os clientes pagantes afetados (e-mail/WhatsApp) ANTES de aplicar.
 *   3. Rode em horário de baixo tráfego, com o time de suporte de prontidão.
 *
 * Uso:
 *   DATABASE_URL=... node scripts/migrate-users-to-core.mjs
 *     → dry-run (padrão): só mostra o que seria feito, nada é alterado.
 *
 *   DATABASE_URL=... ASAAS_API_KEY=... node scripts/migrate-users-to-core.mjs \
 *     --apply --i-understand-this-cancels-paid-subscriptions
 *     → aplica de verdade. As DUAS flags são obrigatórias quando existem
 *       assinantes pagantes na base — trava proposital contra execução
 *       acidental (ver checagem abaixo).
 *
 *   --limit=N   → processa só os primeiros N usuários (teste em batch pequeno antes do rollout completo)
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Client } = require('../scripts_temp/node_modules/pg/lib/index.js');

const APPLY  = process.argv.includes('--apply');
const CONFIRM_PAID_CANCEL = process.argv.includes('--i-understand-this-cancels-paid-subscriptions');
const LIMIT_ARG = process.argv.find(a => a.startsWith('--limit='));
const LIMIT  = LIMIT_ARG ? parseInt(LIMIT_ARG.split('=')[1], 10) : null;

const DB_URL       = process.env.DATABASE_URL;
const ASAAS_KEY    = process.env.ASAAS_API_KEY;
const ASAAS_BASE   = process.env.ASAAS_BASE_URL || (process.env.NODE_ENV === 'production'
  ? 'https://api.asaas.com/api/v3'
  : 'https://sandbox.asaas.com/api/v3');

if (!DB_URL) { console.error('❌ Defina DATABASE_URL no ambiente antes de rodar este script.'); process.exit(1); }
if (APPLY && !ASAAS_KEY) {
  console.error('❌ ASAAS_API_KEY é obrigatório com --apply (precisa cancelar assinaturas reais).');
  process.exit(1);
}

function fmtBrl(v) { return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }

async function cancelAsaasSubscription(id) {
  const res = await fetch(`${ASAAS_BASE}/subscriptions/${id}`, {
    method: 'DELETE',
    headers: { 'access_token': ASAAS_KEY },
  }).catch((e) => ({ ok: false, _err: e.message }));
  return res?.ok !== false;
}

const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log(`✅ Conectado${APPLY ? ' — MODO APLICAR' : ' — MODO DRY RUN (padrão, nada será alterado)'}\n`);

const { rows: [freePlan] } = await client.query(`SELECT id, "minutesPerMonth" FROM "Plan" WHERE name = 'free'`);
if (!freePlan) { console.error('❌ Plano "free" (Core) não encontrado. Rode o seed antes.'); process.exit(1); }

const { rows: users } = await client.query(`
  SELECT
    u.id AS "userId", u.email, u."createdAt",
    p.name AS "planName", p."priceBrl",
    sub.id AS "subId", sub.status AS "subStatus",
    sub."asaasSubscriptionId", sub."asaasCustomerId"
  FROM "User" u
  LEFT JOIN "Subscription" sub ON sub."userId" = u.id
  LEFT JOIN "Plan" p           ON p.id = sub."planId"
  WHERE u."deletedAt" IS NULL
  ORDER BY u."createdAt"
  ${LIMIT ? `LIMIT ${LIMIT}` : ''}
`);

const alreadyCore = users.filter(u => !u.planName || u.planName === 'free');
const toMigrate   = users.filter(u => u.planName && u.planName !== 'free');
const paying      = toMigrate.filter(u => (u.priceBrl || 0) > 0);
const mrrAffected = paying.reduce((sum, u) => sum + parseFloat(u.priceBrl || 0), 0);

console.log(`👥 ${users.length} usuário(s) na base${LIMIT ? ` (limitado a ${LIMIT})` : ''}`);
console.log(`   ${alreadyCore.length} já estão no Core (nada a fazer)`);
console.log(`   ${toMigrate.length} serão migrados para o Core`);
console.log(`   ${paying.length} são ASSINANTES PAGANTES — terão a assinatura Asaas cancelada`);
console.log(`   MRR afetado: ${fmtBrl(mrrAffected)}/mês\n`);

if (paying.length > 0) {
  console.log('─'.repeat(90));
  console.log(`${'Email'.padEnd(40)} ${'Plano'.padEnd(14)} ${'Preço'.padEnd(12)} ${'Asaas sub'}`);
  console.log('─'.repeat(90));
  for (const u of paying) {
    console.log(u.email.padEnd(40), u.planName.padEnd(14), fmtBrl(u.priceBrl).padEnd(12), u.asaasSubscriptionId || '(sem assinatura Asaas)');
  }
  console.log('─'.repeat(90) + '\n');
}

if (!APPLY) {
  console.log('⚠️  DRY RUN — nenhuma alteração aplicada. Rode com --apply (+ a flag de confirmação) para migrar de verdade.\n');
  await client.end();
  process.exit(0);
}

if (paying.length > 0 && !CONFIRM_PAID_CANCEL) {
  console.error(`❌ ${paying.length} assinante(s) pagante(s) seriam afetados (MRR ${fmtBrl(mrrAffected)}/mês).`);
  console.error('   Isso cancela assinaturas reais no Asaas. Só roda com a flag:');
  console.error('   --apply --i-understand-this-cancels-paid-subscriptions\n');
  await client.end();
  process.exit(1);
}

let migrated = 0, asaasCanceled = 0, asaasFailed = 0;

for (const u of toMigrate) {
  if (u.asaasSubscriptionId) {
    const ok = await cancelAsaasSubscription(u.asaasSubscriptionId);
    if (ok) asaasCanceled++; else { asaasFailed++; console.warn(`⚠️  Falha ao cancelar assinatura Asaas de ${u.email} (${u.asaasSubscriptionId}) — siga mesmo assim, revisar manualmente depois.`); }
  }

  if (u.subId) {
    await client.query(`
      UPDATE "Subscription"
      SET "planId" = $1, status = 'active', "asaasSubscriptionId" = NULL,
          "currentPeriodEnd" = NULL, "comboDiscountPct" = NULL, "updatedAt" = NOW()
      WHERE id = $2
    `, [freePlan.id, u.subId]);
  } else {
    await client.query(`
      INSERT INTO "Subscription" (id, "userId", "planId", status, "createdAt", "updatedAt")
      VALUES (replace(gen_random_uuid()::text,'-',''), $1, $2, 'active', NOW(), NOW())
    `, [u.userId, freePlan.id]);
  }

  // Revoga módulos que vieram de bundle de tier (source='bundle') — mesma
  // regra usada em /billing/cancel e no cron de past_due (billing.ts).
  await client.query(`
    UPDATE "Entitlement" SET status = 'canceled', "canceledAt" = NOW()
    WHERE "userId" = $1 AND source = 'bundle' AND status IN ('active', 'trialing')
  `, [u.userId]);

  await client.query(`
    UPDATE "MinuteBalance"
    SET "availableMinutes" = $1, "updatedAt" = NOW()
    WHERE "userId" = $2
  `, [freePlan.minutesPerMonth, u.userId]);

  migrated++;
}

console.log(`\n✅ Concluído! ${migrated} usuário(s) migrado(s) para o Core.`);
console.log(`   Assinaturas Asaas canceladas: ${asaasCanceled}${asaasFailed ? ` (${asaasFailed} falharam — revisar manualmente no painel Asaas)` : ''}\n`);

await client.end();
