import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Client } = require('../scripts_temp/node_modules/pg/lib/index.js');

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error('Defina DATABASE_URL no ambiente antes de rodar este script.'); process.exit(1); }
const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

// 1. Adicionar coluna (idempotente)
await client.query(`
  ALTER TABLE "Subscription"
  ADD COLUMN IF NOT EXISTS "testerRenewalsUsed" INTEGER NOT NULL DEFAULT 0
`);
console.log('✅ Coluna testerRenewalsUsed adicionada');

// 2. Registrar migration
const migrationName = '20260609_add_tester_renewals_used';
const sql = `ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "testerRenewalsUsed" INTEGER NOT NULL DEFAULT 0;`;
const { rowCount } = await client.query(
  `SELECT 1 FROM "_prisma_migrations" WHERE migration_name = $1`, [migrationName]
);
if (rowCount === 0) {
  await client.query(`
    INSERT INTO "_prisma_migrations"
      (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
    VALUES
      (replace(gen_random_uuid()::text,'-',''), 'manual', NOW(), $1, NULL, NULL, NOW(), 1)
  `, [migrationName]);
  console.log('✅ Migration registrada em _prisma_migrations');
} else {
  console.log('ℹ️  Migration já registrada');
}

// 3. Verificar
const { rows } = await client.query(`
  SELECT column_name, data_type, column_default
  FROM information_schema.columns
  WHERE table_name = 'Subscription' AND column_name = 'testerRenewalsUsed'
`);
console.log('Coluna verificada:', rows[0]);

await client.end();
