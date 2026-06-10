import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Client } = require('../scripts_temp/node_modules/pg/lib/index.js');
const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error('Defina DATABASE_URL no ambiente antes de rodar este script.'); process.exit(1); }
const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
const PRO_FEATURES = ['200 min/mês','2 números WhatsApp','Transcrição automática','Resumo com IA','Histórico de transcrições','Filtros por data e contato','Upload de áudio no site','Busca por transcrição','Notas Pessoais de Voz','Modo Privado de transcrição','Exportação PDF · DOCX · CSV · XLS','Múltiplos idiomas (filtro)','Tags e categorização'];
const { rowCount } = await client.query(`UPDATE "Plan" SET features = $1 WHERE name = 'pro-tester'`, [JSON.stringify(PRO_FEATURES)]);
console.log('pro-tester atualizado:', rowCount, 'linha(s)');
await client.end();
