import 'dotenv/config';
import cron from 'node-cron';
import Anthropic from '@anthropic-ai/sdk';
import nodemailer from 'nodemailer';
import https from 'https';
import http from 'http';
import { logger } from './lib/logger';

// ── E-mail de alerta ─────────────────────────────────────────────────
async function sendAlertEmail(subject: string, html: string) {
  if (!process.env.SMTP_HOST || !process.env.ALERT_EMAIL) return;

  const transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   Number(process.env.SMTP_PORT) || 587,
    secure: false,
    auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  await transporter.sendMail({
    from:    process.env.SMTP_USER,
    to:      process.env.ALERT_EMAIL,
    subject,
    html,
  });
}

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
  logger.info('📊 Verificando alertas de consumo...');
  try {
    const res = await fetch(`${API_BASE}/internal/status`, {
      headers: { 'x-internal-token': INTERNAL_TOKEN }
    });
    if (!res.ok) { logger.info('API não acessível para alertas'); return; }

    // Buscar usuários via API
    const resp = await fetch(`${API_BASE}/admin/users?limit=500`, {
      headers: { 'x-admin-token': process.env.ADMIN_TOKEN || '' }
    });
    if (!resp.ok) return;
    const body = await resp.json().catch(() => null);
    const { users } = body || {};
    if (!users) { logger.info('Resposta inesperada ao buscar usuários'); return; }

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
        logger.info(`  ✅ Alerta ${alertLevel}% enviado para usuário ${user.id}`);
      }
    }
  } catch (err: any) {
    logger.error('Erro nos alertas de consumo', { err: err.message });
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
  logger.info(`\n🔍 [${ts}] Iniciando varredura...`);

  const results = await Promise.all(ENDPOINTS.map(e => checkUrl(e.url, e.label)));
  const passed  = results.filter(r => r.ok).length;
  const score   = Math.round((passed / results.length) * 100);

  results.forEach(r => logger.info(`  ${r.ok ? '✅' : '❌'} ${r.label}: ${r.ok ? `HTTP ${r.statusCode} em ${r.latencyMs}ms` : r.error}`));
  logger.info(`  📊 Score: ${score}%`);

  let aiAnalysis = 'Análise não disponível (Claude indisponível)';
  try { aiAnalysis = await analyzeWithClaude(results, score); } catch (err: any) {
    logger.error('Erro na análise com Claude', { err: err.message });
  }

  logger.info('\n─── Análise ───\n' + aiAnalysis + '\n───────────────\n');

  if (score < 100 && process.env.ALERT_EMAIL) {
    const ts       = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const failures = results.filter(r => !r.ok);
    const rows     = results.map(r =>
      `<tr>
        <td style="padding:8px;border:1px solid #e5e7eb">${r.label}</td>
        <td style="padding:8px;border:1px solid #e5e7eb;color:${r.ok ? '#10b981' : '#ef4444'}">${r.ok ? '✓ OK' : `✗ ${r.error}`}</td>
        <td style="padding:8px;border:1px solid #e5e7eb">${r.latencyMs != null ? `${r.latencyMs}ms` : '—'}</td>
      </tr>`
    ).join('');

    const html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
        <h2 style="color:#ef4444;margin-bottom:4px">🚨 ZapScript — Alerta de Saúde</h2>
        <p style="color:#6b7280;margin-top:0">${ts} &bull; Score: <strong>${score}%</strong> &bull; ${failures.length} falha(s)</p>

        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <thead>
            <tr style="background:#f3f4f6">
              <th style="padding:8px;border:1px solid #e5e7eb;text-align:left">Endpoint</th>
              <th style="padding:8px;border:1px solid #e5e7eb;text-align:left">Status</th>
              <th style="padding:8px;border:1px solid #e5e7eb;text-align:left">Latência</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>

        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin-top:16px">
          <h3 style="color:#dc2626;margin-top:0">Análise</h3>
          <pre style="white-space:pre-wrap;font-size:13px;color:#374151">${aiAnalysis}</pre>
        </div>

        <p style="color:#9ca3af;font-size:12px;margin-top:24px">
          ZapScript Monitor — gerado automaticamente
        </p>
      </div>
    `;

    try {
      await sendAlertEmail(`🚨 ZapScript Health ${score}% — ${failures.length} falha(s)`, html);
      logger.info(`📧 Alerta de saúde enviado para ${process.env.ALERT_EMAIL}`);
    } catch (err: any) {
      logger.error('Erro ao enviar e-mail de alerta', { err: err.message });
    }
  }
}

// ── CRON SCHEDULES ───────────────────────────────────────────────────
// Varredura 3x por dia: 08h, 14h, 20h BRT (= 11h, 17h, 23h UTC)
cron.schedule('0 11 * * *', () => runScan(),         { timezone: 'UTC' });
cron.schedule('0 17 * * *', () => runScan(),         { timezone: 'UTC' });
cron.schedule('0 23 * * *', () => runScan(),         { timezone: 'UTC' });

// Alertas de consumo 1x por dia: 12h BRT (= 15h UTC)
cron.schedule('0 15 * * *', () => sendUsageAlerts(), { timezone: 'UTC' });

logger.info('🚀 ZapScript Monitor iniciado');
logger.info('📅 Varreduras: 08h, 14h, 20h BRT');
logger.info('📊 Alertas de consumo: 12h BRT');
logger.info(`🔗 Monitorando ${ENDPOINTS.length} endpoint(s)`);

if (process.argv.includes('--now')) {
  logger.info('▶ Executando imediatamente (--now)...');
  runScan();
}
if (process.argv.includes('--alerts')) {
  logger.info('▶ Enviando alertas de consumo agora (--alerts)...');
  sendUsageAlerts();
}

process.on('SIGTERM', () => { logger.info('Monitor encerrando...'); process.exit(0); });
