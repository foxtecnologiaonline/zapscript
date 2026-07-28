/**
 * migrate-users-to-core.mjs
 *
 * Migra TODOS os usuários atuais (free, pro, executive — e qualquer um já
 * nos tiers novos) para o plano Core (= "free" no banco). Isso é um
 * DOWNGRADE REAL para quem hoje paga Pro/Executive/Profissional/Empresas:
 * perdem os benefícios pagos e a assinatura recorrente no Asaas é cancelada.
 *
 * O que o script faz por usuário (numa única transação — tudo ou nada):
 *   1. Cancela a assinatura no Asaas (DELETE /subscriptions/:id), se houver.
 *      (Fora da transação — é uma chamada externa; se falhar, segue com o
 *      resto e fica marcado no log para revisão manual.)
 *   2. Subscription → plano "free" (Core), status 'canceled' (mesma
 *      semântica de POST /billing/cancel e do cron de past_due no worker).
 *   3. Revoga Entitlement(source='bundle') — módulos que vieram de um tier pago.
 *   4. MinuteBalance recalculado pra cota do Core (availableMinutes, resetAt
 *      +30d, lastAlertSent limpo — mesmos campos tocados por /billing/cancel).
 *   5. Clawback de comissão de afiliado se a conversão foi há ≤30 dias
 *      (mesma regra de clawbackAffiliateCommissionOnCancel em lib/affiliate.ts).
 *   6. Invalida o cache Redis de entitlements (best-effort — se REDIS_URL
 *      não estiver setado ou a conexão falhar, ignora; o cache expira
 *      sozinho em 60s de qualquer forma).
 *   7. Grava uma linha em scripts_temp/migration-log-<timestamp>.csv — trilha
 *      de auditoria de quem foi migrado, plano anterior e resultado do
 *      cancelamento no Asaas. Escrito incrementalmente (linha por linha),
 *      então mesmo uma interrupção no meio do processo deixa rastro do que
 *      já rodou.
 *
 * O que o script NÃO faz (decisão de negócio, fora de escopo daqui):
 *   - Não envia e-mail avisando o cliente da mudança. Comunicar ANTES de
 *     rodar com --apply é essencial — ver seção "Antes de rodar" abaixo.
 *   - Não roda sozinho em nenhum deploy — é 100% manual, com todos os
 *     freios abaixo.
 *   - Não faz corte proporcional por ciclo — quem pagou o mês/ano é
 *     cortado imediatamente ao aplicar (mesmo comportamento de
 *     POST /billing/cancel). Se a decisão de negócio for "só no fim do
 *     ciclo pago", isso precisa de um mecanismo novo (não existe hoje no
 *     schema um campo de "downgrade agendado") — avaliar antes de rodar em
 *     massa se isso importa para a base atual.
 *
 * Antes de rodar:
 *   1. Rode sem --apply (dry-run é o padrão) e revise a tabela e o resumo
 *      financeiro (quantos assinantes pagantes perdem acesso, MRR afetado).
 *   2. Avise os clientes pagantes afetados (e-mail/WhatsApp) ANTES de aplicar.
 *   3. Rode em horário de baixo tráfego, com o time de suporte de prontidão.
 *   4. Teste em lote pequeno primeiro: --apply --limit=5 ... e confira o CSV.
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
 *
 * Dependências: assim como os demais scripts em scripts/ (ver
 * add-tester-renewals-field.mjs, sync-pro-minutes.mjs etc.), este script usa
 * o driver `pg` instalado à parte em scripts_temp/ (não é dependência do
 * monorepo). Antes de rodar pela primeira vez:
 *   npm install pg --prefix scripts_temp
 * REDIS_URL é opcional — se setado, o script invalida o cache de
 * entitlements dos usuários migrados (mesma chave usada por moduleGate.ts).
 */

import { createRequire } from 'module';
import { writeFileSync, appendFileSync, mkdirSync } from 'fs';
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
const REDIS_URL    = process.env.REDIS_URL;
const CLAWBACK_DAYS = 30; // espelha COMMISSION.CANCEL_CLAWBACK_DAYS em apps/api/src/lib/affiliate.ts

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

// ── Redis (best-effort — invalida o cache de entitlements dos migrados) ──
let redis = null;
if (APPLY && REDIS_URL) {
  try {
    let IORedis;
    try { IORedis = require('../apps/worker/node_modules/ioredis/built/index.js').default; }
    catch { IORedis = require('../node_modules/ioredis/built/index.js').default; }
    redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: 1, enableReadyCheck: false, lazyConnect: true });
    await redis.connect();
    console.log('✅ Redis conectado (cache de entitlements será invalidado por usuário migrado)');
  } catch (e) {
    console.warn(`⚠️  Redis indisponível (${e.message}) — cache expira sozinho em 60s, seguindo sem invalidar.`);
    redis = null;
  }
}

// ── Log de auditoria (CSV incremental) ──
let csvPath = null;
if (APPLY) {
  mkdirSync('scripts_temp', { recursive: true });
  csvPath = `scripts_temp/migration-log-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
  writeFileSync(csvPath, 'userId,email,oldPlan,oldPrice,asaasSubscriptionId,asaasCancelResult,affiliateClawback,dbResult,timestamp\n');
  console.log(`📝 Log de auditoria: ${csvPath}\n`);
}
function logCsvRow(fields) {
  if (!csvPath) return;
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  appendFileSync(csvPath, fields.map(esc).join(',') + '\n');
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

let migrated = 0, asaasCanceled = 0, asaasFailed = 0, dbFailed = 0;
const nextReset = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

for (const u of toMigrate) {
  // 1. Cancelamento no Asaas — fora da transação de banco (chamada externa,
  //    não pode dar rollback nela). Se falhar, segue e marca no log.
  let asaasResult = 'sem assinatura Asaas';
  if (u.asaasSubscriptionId) {
    const ok = await cancelAsaasSubscription(u.asaasSubscriptionId);
    if (ok) { asaasCanceled++; asaasResult = 'cancelada'; }
    else     { asaasFailed++; asaasResult = 'FALHOU — revisar manualmente'; console.warn(`⚠️  Falha ao cancelar assinatura Asaas de ${u.email} (${u.asaasSubscriptionId})`); }
  }

  // 2-4. Escrita no banco — tudo ou nada por usuário.
  let dbResult = 'ok';
  try {
    await client.query('BEGIN');

    if (u.subId) {
      await client.query(`
        UPDATE "Subscription"
        SET "planId" = $1, status = 'canceled', "asaasSubscriptionId" = NULL,
            "currentPeriodEnd" = NULL, "comboDiscountPct" = NULL, "updatedAt" = NOW()
        WHERE id = $2
      `, [freePlan.id, u.subId]);
    } else {
      await client.query(`
        INSERT INTO "Subscription" (id, "userId", "planId", status, "createdAt", "updatedAt")
        VALUES (replace(gen_random_uuid()::text,'-',''), $1, $2, 'canceled', NOW(), NOW())
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
      SET "availableMinutes" = $1, "resetAt" = $2, "lastAlertSent" = NULL, "updatedAt" = NOW()
      WHERE "userId" = $3
    `, [freePlan.minutesPerMonth, nextReset, u.userId]);

    await client.query('COMMIT');
    migrated++;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    dbResult = `FALHOU — ${err.message}`;
    dbFailed++;
    console.error(`❌ Erro migrando ${u.email}, revertido (nada foi alterado para este usuário): ${err.message}`);
  }

  // 5. Clawback de comissão de afiliado (best-effort, fora da transação de
  //    migração — falha aqui não deve reverter a migração do usuário).
  let clawbackResult = '—';
  if (dbResult === 'ok') {
    try {
      const { rows: [referral] } = await client.query(`
        SELECT id, "affiliateId", "convertedAt" FROM "AffiliateReferral" WHERE "referredUserId" = $1
      `, [u.userId]);
      if (referral?.convertedAt) {
        const daysSinceConversion = (Date.now() - new Date(referral.convertedAt).getTime()) / (24 * 60 * 60 * 1000);
        if (daysSinceConversion <= CLAWBACK_DAYS) {
          const { rowCount } = await client.query(`
            UPDATE "AffiliateCommission" SET status = 'canceled'
            WHERE "affiliateId" = $1 AND "referredUserId" = $2 AND status = 'pending'
          `, [referral.affiliateId, u.userId]);
          clawbackResult = rowCount > 0 ? `${rowCount} comissão(ões) zerada(s)` : 'sem comissão pendente';
        }
      }
    } catch { /* tabela de afiliados pode não existir em todo ambiente — ignora */ }
  }

  // 6. Invalida cache de entitlements (best-effort).
  if (redis) {
    await redis.del(`ent:${u.userId}`).catch(() => {});
  }

  logCsvRow([u.userId, u.email, u.planName, u.priceBrl, u.asaasSubscriptionId, asaasResult, clawbackResult, dbResult, new Date().toISOString()]);
}

console.log(`\n✅ Concluído! ${migrated} usuário(s) migrado(s) para o Core${dbFailed ? ` (${dbFailed} falharam — ver log)` : ''}.`);
console.log(`   Assinaturas Asaas canceladas: ${asaasCanceled}${asaasFailed ? ` (${asaasFailed} falharam — revisar manualmente no painel Asaas)` : ''}`);
if (csvPath) console.log(`   Log completo: ${csvPath}\n`);

if (redis) await redis.quit().catch(() => {});
await client.end();
