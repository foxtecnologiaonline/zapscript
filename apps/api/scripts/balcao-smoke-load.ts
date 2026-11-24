/**
 * Smoke/carga leve do Balcão Virtual (fetch nativo, Node >= 18) — mede P50/P95/P99 e taxa de erro.
 *
 *   cd apps/api
 *   npx ts-node scripts/balcao-smoke-load.ts --base https://api.zapscript.me \
 *        --email atendente@orgao.gov.br --org slug-do-orgao --concurrency 20 --requests 1000
 *   # senha: variável BV_SMOKE_PASSWORD (preferível a --password: não fica no histórico do shell)
 *
 * Opções (ou variáveis BV_SMOKE_*): --base URL | --email | --password | --org (orgSlug) | --token (JWT já obtido; pula o login)
 *   --concurrency N (10)  --requests N por cenário (300)  --duration S (usa tempo em vez de contagem)
 *   --login-samples N (5; o login tem rate limit de 20 tentativas/10 min por IP+órgão — não faça login a cada requisição)
 *   --timeout-ms (10000)  --max-error-rate % (1)  --p95-ms (1000)  --json (saída em JSON)
 *
 * Cenários: (1) GET /balcao/health  (2) POST /balcao/auth/login (amostras sequenciais)  (3) GET /balcao/conversations
 * autenticado, com o token do login. Sem credenciais, só o cenário 1 roda.
 * Saída 0 = dentro dos limites; 1 = acima de --max-error-rate ou --p95-ms; 2 = uso incorreto.
 * Nunca imprime senha nem token. Rode contra homologação/produção em horário combinado: gera carga real.
 */
type Args = Record<string, string | boolean>;
function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[k] = true; else { out[k] = next; i++; }
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const str = (k: string, env: string): string | undefined => (typeof args[k] === 'string' ? (args[k] as string) : process.env[env] || undefined);
const num = (k: string, d: number): number => { const v = Number(args[k]); return Number.isFinite(v) && v > 0 ? v : d; };

const base = (str('base', 'BV_SMOKE_BASE') ?? '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(base) || args.help) {
  console.error('Uso: ts-node scripts/balcao-smoke-load.ts --base https://host [--email E --org SLUG] (senha em BV_SMOKE_PASSWORD) [--concurrency 10] [--requests 300 | --duration 30]');
  process.exit(2);
}
const email = str('email', 'BV_SMOKE_EMAIL');
const password = str('password', 'BV_SMOKE_PASSWORD');
const org = str('org', 'BV_SMOKE_ORG');
let token = str('token', 'BV_SMOKE_TOKEN');
const concurrency = Math.min(num('concurrency', 10), 500);
const requests = num('requests', 300);
const durationS = typeof args.duration === 'string' ? num('duration', 0) : 0;
const loginSamples = num('login-samples', 5);
const timeoutMs = num('timeout-ms', 10_000);
const maxErrorRate = num('max-error-rate', 1);
const p95Limit = num('p95-ms', 1000);

interface Sample { ms: number; status: number }
interface Report { name: string; total: number; ok: number; errors: number; errorRatePct: number; rps: number; seconds: number; minMs: number; meanMs: number; p50: number; p95: number; p99: number; maxMs: number; statuses: Record<string, number> }

async function timed(url: string, init: RequestInit = {}): Promise<{ sample: Sample; body?: any }> {
  const t0 = performance.now();
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    let body: any;
    try { body = await res.json(); } catch { /* corpo não-JSON */ }
    return { sample: { ms: performance.now() - t0, status: res.status }, body };
  } catch (e: any) {
    return { sample: { ms: performance.now() - t0, status: e?.name === 'TimeoutError' ? -2 : -1 }, body: undefined }; // -1 rede, -2 timeout
  }
}

const pct = (sorted: number[], p: number): number => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))] : 0);
function summarize(name: string, samples: Sample[], seconds: number): Report {
  const ms = samples.map((s) => s.ms).sort((a, b) => a - b);
  const ok = samples.filter((s) => s.status >= 200 && s.status < 400).length;
  const statuses: Record<string, number> = {};
  for (const s of samples) { const k = s.status === -1 ? 'rede' : s.status === -2 ? 'timeout' : String(s.status); statuses[k] = (statuses[k] ?? 0) + 1; }
  const sum = ms.reduce((a, b) => a + b, 0);
  return {
    name, total: samples.length, ok, errors: samples.length - ok, errorRatePct: samples.length ? ((samples.length - ok) / samples.length) * 100 : 0,
    rps: seconds > 0 ? samples.length / seconds : 0, seconds, minMs: ms[0] ?? 0, meanMs: ms.length ? sum / ms.length : 0, p50: pct(ms, 50), p95: pct(ms, 95), p99: pct(ms, 99), maxMs: ms[ms.length - 1] ?? 0, statuses,
  };
}

/** N trabalhadores em paralelo chamando `one()` até esgotar a contagem (ou o tempo). */
async function run(name: string, one: () => Promise<Sample>): Promise<Report> {
  const samples: Sample[] = [];
  let started = 0;
  const t0 = performance.now();
  const deadline = durationS ? t0 + durationS * 1000 : Infinity;
  const worker = async () => {
    for (;;) {
      if (durationS ? performance.now() >= deadline : started >= requests) return;
      started++;
      samples.push(await one());
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return summarize(name, samples, (performance.now() - t0) / 1000);
}

async function main() {
  const reports: Report[] = [];
  const notes: string[] = [];

  reports.push(await run('GET /balcao/health', async () => (await timed(`${base}/balcao/health`)).sample));

  if (!token && email && password) {
    const logins: Sample[] = [];
    const t0 = performance.now();
    for (let i = 0; i < loginSamples; i++) {
      const r = await timed(`${base}/balcao/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, ...(org ? { orgSlug: org } : {}) }) });
      logins.push(r.sample);
      if (r.sample.status === 200 && r.body?.accessToken) token = r.body.accessToken;
      else if (r.body?.mfaToken) { notes.push('Usuário exige MFA (TOTP): use um usuário de teste sem MFA ou passe --token.'); break; }
    }
    reports.push(summarize('POST /balcao/auth/login (amostras)', logins, (performance.now() - t0) / 1000));
  } else if (!token) notes.push('Sem credenciais (--email + BV_SMOKE_PASSWORD, ou --token): fluxo autenticado não executado.');

  if (token) {
    const auth = { authorization: `Bearer ${token}` };
    reports.push(await run('GET /balcao/conversations (autenticado)', async () => (await timed(`${base}/balcao/conversations`, { headers: auth })).sample));
  } else if (email && password) notes.push('Login não obteve token: cenário autenticado não executado (ver status do login).');

  const failed = reports.filter((r) => r.errorRatePct > maxErrorRate || (r.total > 0 && r.p95 > p95Limit && r.name !== 'POST /balcao/auth/login (amostras)'));
  if (args.json) {
    console.log(JSON.stringify({ base: new URL(base).origin, concurrency, requests: durationS ? undefined : requests, durationS: durationS || undefined, reports, notes, pass: failed.length === 0 }, null, 2));
  } else {
    console.log(`Balcão smoke/carga — ${new URL(base).origin} — concorrência ${concurrency} — ${durationS ? `${durationS}s/cenário` : `${requests} req/cenário`}\n`);
    const h = ['cenário'.padEnd(42), 'n'.padStart(6), 'erro%'.padStart(7), 'rps'.padStart(8), 'min'.padStart(7), 'média'.padStart(7), 'P50'.padStart(7), 'P95'.padStart(7), 'P99'.padStart(7), 'max'.padStart(7)];
    console.log(h.join(' '));
    for (const r of reports) {
      console.log([r.name.padEnd(42), String(r.total).padStart(6), r.errorRatePct.toFixed(2).padStart(7), r.rps.toFixed(1).padStart(8), ...[r.minMs, r.meanMs, r.p50, r.p95, r.p99, r.maxMs].map((v) => v.toFixed(0).padStart(7))].join(' '));
      if (r.errors) console.log(`  status: ${Object.entries(r.statuses).map(([k, v]) => `${k}×${v}`).join('  ')}`);
    }
    console.log('\n(latências em ms)');
    for (const n of notes) console.log(`aviso: ${n}`);
    console.log(failed.length ? `\nRESULTADO: FALHOU (limites: erro ≤ ${maxErrorRate}%, P95 ≤ ${p95Limit} ms) em: ${failed.map((f) => f.name).join('; ')}` : `\nRESULTADO: OK (erro ≤ ${maxErrorRate}%, P95 ≤ ${p95Limit} ms)`);
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error('Falha:', e?.message ?? e); process.exit(2); });
