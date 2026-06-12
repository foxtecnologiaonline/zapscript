/**
 * update-plan-features.mjs
 * Atualiza o campo features dos planos Free e Pro no banco.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Client } = require('../scripts_temp/node_modules/pg/lib/index.js');

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error('Defina DATABASE_URL no ambiente antes de rodar este script.'); process.exit(1); }

const FREE_FEATURES = [
  '20 min/mês',
  '1 número WhatsApp',
  '🎙️ Transcrição automática',
  '✨ Resumo com IA',
  '📋 Histórico de transcrições',
  '📅 Filtros por data e contato',
  '🔍 Busca por transcrição',
];

const PRO_FEATURES = [
  '200 min/mês',
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
];

const EXECUTIVE_FEATURES = [
  '300 min/mês',
  '3 números WhatsApp',
  'Transcrição automática',
  'Resumo com IA',
  'Histórico de transcrições',
  'Filtros por data e contato',
  'Upload de áudio no site',
  'Busca por transcrição',
  'Exportação PDF · DOCX · CSV · XLS',
  'Modo Privado de transcrição',
  'Múltiplos idiomas (filtro)',
  'Tags e categorização',
];

const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log('✅ Conectado\n');

const plans = [
  { name: 'free',       features: FREE_FEATURES },
  { name: 'pro',        features: PRO_FEATURES },
  { name: 'pro-tester', features: PRO_FEATURES }, // espelha o Pro
  { name: 'executive',  features: EXECUTIVE_FEATURES },
];

for (const p of plans) {
  const { rowCount } = await client.query(
    `UPDATE "Plan" SET features = $1 WHERE name = $2`,
    [JSON.stringify(p.features), p.name]
  );
  console.log(`📋 ${p.name}: ${rowCount} linha(s) atualizada(s) — ${p.features.length} features`);
}

// Verificar resultado
const { rows } = await client.query(`SELECT name, features FROM "Plan" ORDER BY name`);
console.log('\n── Resultado ──');
for (const r of rows) {
  console.log(`\n[${r.name}]`);
  const feats = Array.isArray(r.features) ? r.features : JSON.parse(r.features || '[]');
  feats.forEach(f => console.log(`  • ${f}`));
}

await client.end();
console.log('\n✅ Concluído!');
