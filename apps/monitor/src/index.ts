import 'dotenv/config';
import cron from 'node-cron';
import Anthropic from '@anthropic-ai/sdk';
import https from 'https';
import http from 'http';

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const API_BASE = process.env.API_URL
  ? process.env.API_URL.replace('/health', '')
  : 'https://zapscript-api.railway.app';

const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN!;

// ── URL check ────────────────────────────────────────────────────────
interface CheckResult {
  url: string; label: string; ok: boolean;
  statusCode: number | null; latencyMs: number | null; error: string | null;
}

function checkUrl(url: string, label: string): Promise<CheckResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const lib   = url.startsWith('https') ? https : http;
    const req   = lib.get(url, { timeout: 10000 }, (res) => {
      res.resume();
      const ok = (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 400;
      resolve({ url, label, ok, statusCode: res.statusCode || null, latencyMs: Date.now() - start, error: ok ? null : `HTTP ${res.statusCode}` });
    });
    req.on('timeout', () => { req.destroy(); resolve({ url, label, ok: false, statusCode: null, latencyMs: null, error: 'Timeout (>10s)' }); });
    req.on('error',   (e) => { resolve({ url, label, ok: false, statusCode: null, latencyMs: Date.now() - start, error: e.message }); });
  });
}

// ── AI analysis ──────────────────────────────────────────────────────
async function analyzeWithClaude(results: CheckResult[], score: number): Promise<string> {
  const summary = results.map(r =>
    `- ${r.label}: ${r.ok ? `✓ HTTP ${r.statusCode} em ${r.latencyMs}ms` : `✗ FALHOU — ${r.error}`}`
  ).join('\n');

  const res = await claude.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 500,
    messages: [{ role: 'user', content: `Você é um engenheiro de plantão. Analise em português, de forma concisa:
Score: ${score}%\n${summary}
Gere: 1.STATUS GERAL 2.PROBLEMAS (se houver) 3.CAUSA PROVÁVEL 4.AÇÃO RECOMENDADA` }],
  });
  return (res.content[0] as any).text;
}

// ── Alertas de consumo ───────────────────────────────────────────────
async function sendUsageAlerts() {
  console.log('📊 Verificando alertas de consumo...');
  try {
    const res = await fetch(`${API_BASE}/internal/status`, {
      headers: { 'x-internal-token': INTERNAL_TOKEN }
    });
    if (!res.ok) { console.log('API não acessível para alertas'); return; }

    // Buscar usuários via API
    const resp = await fetch(`${API_BASE}/admin/users?limit=500`, {
      headers: { 'x-admin-token': process.env.ADMIN_TOKEN || '' }
    });
    if (!resp.ok) return;
    const body = await resp.json().catch(() => null);
    const { users } = body || {};
    if (!users) { console.log('Resposta inesperada ao buscar usuários'); return; }

    for (const user of users) {
      const balance = user.balance;
      const plan    = user.subscription?.plan;
      if (!balance || !plan || plan.minutesPerMonth === 0) continue;

      const total = plan.minutesPerMonth;
      const avail = balance.availableMinutes;
      const used  = total - avail;
      const pct   = (used / total) * 100;
      const lastAlert = balance.lastAlertSent;

      // Encontrar número conectado
      const connectedNumber = (user.numbers || []).find((n: any) => n.status === 'connected');
      if (!connectedNumber) continue;

      let alertLevel: string | null = null;
      let msg = '';

      if (pct >= 100 && lastAlert !== '100') {
        alertLevel = '100';
        msg = `⛔ *Seus minutos ZapScript acabaram!*\n\nVocê utilizou 100% do seu plano ${plan.label}.\n\nFaça upgrade agora para continuar recebendo transcrições:\n👉 _zapscript.me/dashboard/plano_`;
      } else if (pct >= 80 && lastAlert !== '80' && lastAlert !== '100') {
        alertLevel = '80';
        msg = `⚠️ *Atenção: 80% dos seus minutos usados*\n\nVocê usou ${Math.round(pct)}% do plano ${plan.label}.\nRestam apenas *${avail.toFixed(0)} minutos*.\n\nFaça upgrade antes de acabar:\n👉 _zapscript.me/dashboard/plano_`;
      } else if (pct >= 50 && !lastAlert) {
        alertLevel = '50';
        msg = `📊 *Uso do ZapScript: ${Math.round(pct)}%*\n\nVocê já usou metade do seu plano ${plan.label}.\nRestam *${avail.toFixed(0)} minutos* este mês.\n\n_ZapScript.me_`;
      }

      if (alertLevel && msg) {
        await fetch(`${API_BASE}/internal/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-token': INTERNAL_TOKEN },
          body: JSON.stringify({
            numberId: connectedNumber.id,
            jid:      `${connectedNumber.phoneNumber}@s.whatsapp.net`,
            text:     msg,
          }),
        });
        console.log(`  ✅ Alerta ${alertLevel}% enviado para usuário ${user.id}`);
      }
    }
  } catch (err: any) {
    console.error('Erro nos alertas de consumo:', err.message);
  }
}

// ── Scan function ────────────────────────────────────────────────────
const ENDPOINTS = [
  { url: process.env.API_URL        || `${API_BASE}/health`, label: 'API Health'   },
  { url: process.env.APP_URL        || 'https://zapscript.me', label: 'Landing Page' },
  { url: process.env.DASHBOARD_URL  || 'https://zapscript.me/dashboard', label: 'Dashboard' },
];

async function runScan() {
  const ts = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  console.log(`\n🔍 [${ts}] Iniciando varredura...`);

  const results = await Promise.all(ENDPOINTS.map(e => checkUrl(e.url, e.label)));
  const passed  = results.filter(r => r.ok).length;
  const score   = Math.round((passed / results.length) * 100);

  results.forEach(r => console.log(`  ${r.ok ? '✅' : '❌'} ${r.label}: ${r.ok ? `HTTP ${r.statusCode} em ${r.latencyMs}ms` : r.error}`));
  console.log(`  📊 Score: ${score}%`);

  let aiAnalysis = 'Análise não disponível (Claude indisponível)';
  try { aiAnalysis = await analyzeWithClaude(results, score); } catch (err: any) {
    console.error('Erro na análise com Claude:', err.message);
  }

  console.log('\n─── Análise ───\n' + aiAnalysis + '\n───────────────\n');

  if (score < 100 && process.env.ALERT_EMAIL) {
    console.log('🚨 Problemas detectados — enviando alerta por e-mail...');
    // Email sending via nodemailer (similar to support.ts)
  }
}

// ── CRON SCHEDULES ───────────────────────────────────────────────────
// Varredura 3x por dia: 08h, 14h, 20h BRT (= 11h, 17h, 23h UTC)
cron.schedule('0 11 * * *', () => runScan(),         { timezone: 'UTC' });
cron.schedule('0 17 * * *', () => runScan(),         { timezone: 'UTC' });
cron.schedule('0 23 * * *', () => runScan(),         { timezone: 'UTC' });

// Alertas de consumo 1x por dia: 12h BRT (= 15h UTC)
cron.schedule('0 15 * * *', () => sendUsageAlerts(), { timezone: 'UTC' });

console.log('🚀 ZapScript Monitor iniciado');
console.log('📅 Varreduras: 08h, 14h, 20h BRT');
console.log('📊 Alertas de consumo: 12h BRT');
console.log(`🔗 Monitorando ${ENDPOINTS.length} endpoint(s)`);

if (process.argv.includes('--now')) {
  console.log('▶ Executando imediatamente (--now)...');
  runScan();
}
if (process.argv.includes('--alerts')) {
  console.log('▶ Enviando alertas de consumo agora (--alerts)...');
  sendUsageAlerts();
}

process.on('SIGTERM', () => { console.log('Monitor encerrando...'); process.exit(0); });
