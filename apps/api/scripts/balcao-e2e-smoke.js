/**
 * Teste de fluxo ponta a ponta do Balcão Virtual no navegador (Playwright).
 * Pré-requisitos: API em :3001 com BV_DEV_SIMULATORS=1, web em :3000 (next dev, p/ CSP de ws://localhost) e o órgão demo
 * (cli/seed-demo.ts com BV_DEMO_PASSWORD='DemoSenha12345'). Roda: `node apps/api/scripts/balcao-e2e-smoke.js`.
 * Etapas: login → WhatsApp simulado → bot/roteamento → console do atendente responde → 15 telas sem erro de console/rede.
 * ATENÇÃO: altera o horário comercial do órgão demo para 24 h (somente para o teste).
 */
const { chromium } = require('playwright');
const API = 'http://localhost:3001/balcao', WEB = 'http://localhost:3000';
const SHOTS = process.env.SHOTS_DIR || './balcao-e2e-shots';
require('fs').mkdirSync(SHOTS, { recursive: true });
const PASS = 'DemoSenha12345';
const out = { steps: [], errors: [] };
const ok = (n, d = '') => { out.steps.push(`OK   ${n} ${d}`); console.log('OK  ', n, d); };
const bad = (n, d = '') => { out.steps.push(`FAIL ${n} ${d}`); console.log('FAIL', n, d); };

async function api(method, path, token, body) {
  const r = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}
const login = async (email) => (await api('POST', '/auth/login', null, { email: `${email}@demo.balcao.local`, password: PASS, orgSlug: 'demo' })).body;

async function uiLogin(page, email) {
  await page.goto(`${WEB}/balcao/login`);
  await page.getByLabel('E-mail institucional').fill(email);
  await page.getByLabel('Senha').fill(PASS);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForTimeout(1500);
  const sel = page.getByLabel(/Órgão/).first();
  if (await sel.count() && await sel.isVisible().catch(() => false)) { await sel.selectOption('demo'); await page.getByRole('button', { name: 'Entrar' }).click(); }
}

(async () => {
  // ── preparação via API ──
  const admin = await login('admin'); const ag1 = await login('atendente1');
  if (!admin?.accessToken || !ag1?.accessToken) { bad('login API'); process.exit(1); }
  ok('login via API (admin e atendente1)');
  const cfg = await api('PUT', '/whatsapp/config', admin.accessToken, { mock: true, accessToken: 'EAAGmockaccesstoken123456', phoneNumberId: '111222333444', wabaId: '555666777888', appSecret: 'mocksecret1234567890', verifyToken: 'mockverify1234567' });
  cfg.status < 300 ? ok('WhatsApp (modo mock) configurado') : bad('config whatsapp', JSON.stringify(cfg.body).slice(0, 200));
  const all = ['sun','mon','tue','wed','thu','fri','sat']; const bh = {}; all.forEach((d) => (bh[d] = [['00:00', '23:59']]));
  const org = await api('PATCH', '/admin/org', admin.accessToken, { businessHours: bh });
  org.status < 300 ? ok('horário comercial 24h (teste)') : bad('PATCH org', JSON.stringify(org.body).slice(0, 200));
  await api('PUT', '/agents/me/presence', ag1.accessToken, { presence: 'ONLINE' });
  const sim = await api('POST', '/whatsapp/dev/simulate-inbound', admin.accessToken, { from: '5563999990001', name: 'Maria Teste', text: 'Quero falar com um atendente sobre meu processo' });
  sim.status < 300 ? ok('mensagem WhatsApp simulada', JSON.stringify(sim.body).slice(0, 120)) : bad('simulate-inbound', JSON.stringify(sim.body).slice(0, 200));
  await new Promise((r) => setTimeout(r, 4000));

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR', deviceScaleFactor: 1 });
  await ctx.grantPermissions(['microphone']);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`console: ${m.text().slice(0, 200)}`); });
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/_next/')) errs.push(`HTTP ${r.status()} ${r.request().method()} ${r.url().replace('http://localhost:3001', '')}`); });

  // ── login pela UI como atendente ──
  await uiLogin(page, 'atendente1@demo.balcao.local');
  await page.waitForURL(/balcao\/(atendimento|conta)/, { timeout: 20000 }).catch(() => {});
  const url1 = page.url();
  /(atendimento|conta)/.test(url1) ? ok('login pela UI', url1) : bad('login pela UI', url1);
  if (/conta/.test(url1)) { await page.screenshot({ path: `${SHOTS}/01-conta-forcada.png` }); }
  await page.goto(`${WEB}/balcao/atendimento`); await page.waitForTimeout(3500);
  await page.screenshot({ path: `${SHOTS}/02-atendimento.png` });
  const body1 = await page.locator('body').innerText();
  /Maria Teste|BV-2026/.test(body1) ? ok('conversa simulada aparece no console do atendente') : bad('conversa no console', body1.slice(0, 200).replace(/\n/g, ' | '));

  // abre a conversa e responde
  const item = page.getByText(/Maria Teste|BV-2026/).first();
  if (await item.count()) {
    await item.click(); await page.waitForTimeout(1500);
    const composer = page.locator('textarea').first();
    if (await composer.count()) {
      await composer.fill('Olá Maria, sou o atendente. Em que posso ajudar com o processo?');
      await page.keyboard.press('Control+Enter'); await page.waitForTimeout(2500);
      await page.screenshot({ path: `${SHOTS}/03-conversa-respondida.png` });
      (await page.locator('body').innerText()).includes('sou o atendente') ? ok('resposta do atendente enviada e exibida') : bad('resposta não exibida');
    } else bad('composer não encontrado');
  }

  // ── percorre telas como admin ──
  await page.evaluate(() => localStorage.clear()); await page.context().clearCookies();
  await uiLogin(page, 'admin@demo.balcao.local');
  await page.waitForURL(/balcao\/(admin|conta)/, { timeout: 20000 }).catch(() => {});
  const routes = ['/balcao/supervisor', '/balcao/relatorios', '/balcao/fiscal', '/balcao/chamadas', '/balcao/tarefas', '/balcao/conhecimento',
    '/balcao/admin/usuarios', '/balcao/admin/filas', '/balcao/admin/ura', '/balcao/admin/curadoria', '/balcao/admin/integracoes', '/balcao/admin/orgao', '/balcao/admin/auditoria', '/balcao/admin/seguranca', '/balcao/atendimento'];
  let i = 10;
  for (const r of routes) {
    errs.length = 0;
    const res = await page.goto(WEB + r, { waitUntil: 'domcontentloaded' }).catch((e) => ({ status: () => 0, e }));
    await page.waitForTimeout(5000);
    const h1 = (await page.locator('h1').first().innerText().catch(() => '')).trim();
    const text = await page.locator('main').innerText().catch(() => '');
    const crashed = /Application error|Unhandled Runtime Error|This page could not be found/i.test(text) || res.status() >= 400;
    await page.screenshot({ path: `${SHOTS}/${i++}-${r.replace(/\W+/g, '_')}.png` });
    if (crashed || errs.length) bad(`tela ${r}`, `h1="${h1}" ${crashed ? 'CRASH ' : ''}${errs.slice(0, 3).join(' || ')}`);
    else ok(`tela ${r}`, `h1="${h1}"`);
  }
  // widget do site
  const w = await page.goto(`${API}/webchat/demo?org=demo`).catch(() => null);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/90-widget-demo.png` });
  w && w.status() === 200 ? ok('página de demonstração do widget') : bad('widget demo', String(w && w.status()));
  await browser.close();
  const fails = out.steps.filter((s) => s.startsWith('FAIL')).length;
  console.log(`\nRESUMO: ${out.steps.length - fails} ok, ${fails} falhas`);
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(2); });
