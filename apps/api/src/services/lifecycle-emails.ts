import { prisma } from '../lib/prisma';
import { sendEmail } from '../lib/mailer';

/* ── Configuração ──────────────────────────────────────────────────────────
   Roda 1x/dia (primeira execução pouco depois do boot). Cada e-mail é
   idempotente via User.lifecycleEmailsSent — uma tag por gatilho, gravada
   só depois do envio ter sucesso, então nunca dispara duas vezes. ────────── */
const INTERVAL_MS  = 24 * 60 * 60 * 1000; // 1x por dia
const FIRST_RUN_MS = 10 * 60 * 1000;      // 10 min após startup

const APP_URL = process.env.APP_URL || 'https://zapscript.me';

function btn(href: string, label: string): string {
  return `<div style="text-align:center;margin:24px 0">
    <a href="${href}" style="display:inline-block;background:#10b981;color:#04130c;padding:14px 36px;border-radius:12px;text-decoration:none;font-weight:800;font-size:16px">${label}</a>
  </div>`;
}

function wrapper(_firstName: string, title: string, body: string): string {
  return `<div style="font-family:'DM Sans',sans-serif;max-width:540px;margin:0 auto;background:#050a07;color:#d1fae5;padding:32px;border-radius:16px;border:1px solid rgba(16,185,129,.15)">
    <div style="font-size:28px;font-weight:900;color:#10b981;margin-bottom:8px">⚡ ZapScript</div>
    <h1 style="font-size:22px;font-weight:700;color:#fff;margin:0 0 12px">${title}</h1>
    ${body}
    <p style="color:#6b7280;font-size:12px;text-align:center;margin-top:24px">Dúvidas? Responda este e-mail ou fale em <a href="mailto:suporte@zapscript.me" style="color:#10b981">suporte@zapscript.me</a></p>
  </div>`;
}

function firstNameOf(name: string | null): string {
  return name?.split(' ')[0] || 'tudo bem';
}

/** Marca uma tag como enviada (idempotência) sem sobrescrever outras tags concorrentes. */
async function markSent(userId: string, tag: string) {
  await prisma.user.update({
    where: { id: userId },
    data:  { lifecycleEmailsSent: { push: tag } },
  });
}

/* ── D+1: cadastrou e ainda não conectou nenhum número ──────────────────── */
async function runActivationD1(log: any) {
  const from = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const to   = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const tag  = 'activation_d1';

  const users = await prisma.user.findMany({
    where: { createdAt: { gte: from, lte: to }, deletedAt: null },
    select: { id: true, email: true, name: true, lifecycleEmailsSent: true, numbers: { select: { status: true } } },
  }).catch(() => [] as any[]);

  for (const u of users) {
    if (u.lifecycleEmailsSent.includes(tag)) continue;
    const hasConnected = u.numbers.some((n: any) => n.status === 'connected');
    if (hasConnected) continue;

    const firstName = firstNameOf(u.name);
    try {
      await sendEmail(
        u.email,
        `${firstName}, falta 1 passo para sua 1ª transcrição`,
        wrapper(firstName, `Falta 1 passo, ${firstName}!`, `
          <p style="color:#a7f3d0;line-height:1.7;margin:0 0 20px">Você criou sua conta no ZapScript mas ainda não conectou seu WhatsApp. Sem isso, nenhum áudio é transcrito automaticamente.</p>
          <p style="color:#a7f3d0;line-height:1.7;margin:0 0 8px">Leva menos de 2 minutos: escaneie um QR Code (ou use o código de pareamento) e pronto — todo áudio recebido já chega transcrito e resumido por IA.</p>
          ${btn(`${APP_URL}/dashboard/numeros`, 'Conectar meu WhatsApp →')}
        `),
      );
      await markSent(u.id, tag);
    } catch (e: any) {
      log?.warn?.(`[Lifecycle] Falha ao enviar ${tag} para ${u.email}: ${e.message}`);
    }
  }
  return users.length;
}

/* ── Conexão iniciada mas não concluída (2h–24h) ──────────────────────────
   Usuário chegou a clicar em "Conectar novo número" (existe um registro
   WhatsappNumber) mas nunca chegou a status "connected". Dispara antes do
   D+1 genérico, porque aqui já sabemos que a intenção existiu. ────────── */
async function runConnectionIncomplete(log: any) {
  const from = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const to   = new Date(Date.now() - 2  * 60 * 60 * 1000);
  const tag  = 'connection_incomplete';

  const users = await prisma.user.findMany({
    where: {
      deletedAt: null,
      numbers: { some: { createdAt: { gte: from, lte: to }, status: { not: 'connected' } } },
    },
    select: {
      id: true, email: true, name: true, lifecycleEmailsSent: true,
      numbers: { select: { status: true, connectedAt: true } },
    },
  }).catch(() => [] as any[]);

  let sent = 0;
  for (const u of users) {
    if (u.lifecycleEmailsSent.includes(tag)) continue;
    const everConnected = u.numbers.some((n: any) => n.connectedAt || n.status === 'connected');
    if (everConnected) continue;

    const firstName = firstNameOf(u.name);
    try {
      await sendEmail(
        u.email,
        `${firstName}, sua conexão do WhatsApp ficou pela metade`,
        wrapper(firstName, `Faltou só terminar a conexão, ${firstName}`, `
          <p style="color:#a7f3d0;line-height:1.7;margin:0 0 20px">Vimos que você começou a conectar seu WhatsApp no ZapScript, mas a conexão não foi concluída. Pode ter sido o código que expirou ou a tela que fechou no meio do processo — é comum, e leva menos de 2 minutos para terminar.</p>
          <p style="color:#a7f3d0;line-height:1.7;margin:0 0 8px">Volte ao painel, gere um novo código e finalize no seu celular. Assim que conectar, todo áudio recebido já chega transcrito e resumido.</p>
          ${btn(`${APP_URL}/dashboard/numeros`, 'Terminar minha conexão →')}
        `),
      );
      await markSent(u.id, tag);
      sent++;
    } catch (e: any) {
      log?.warn?.(`[Lifecycle] Falha ao enviar ${tag} para ${u.email}: ${e.message}`);
    }
  }
  return sent;
}

/* ── D+3: número conectado mas zero transcrições ─────────────────────────── */
async function runActivationD3(log: any) {
  const from = new Date(Date.now() - 96 * 60 * 60 * 1000);
  const to   = new Date(Date.now() - 72 * 60 * 60 * 1000);
  const tag  = 'activation_d3';

  const users = await prisma.user.findMany({
    where:  { createdAt: { gte: from, lte: to }, deletedAt: null },
    select: {
      id: true, email: true, name: true, lifecycleEmailsSent: true,
      numbers: { select: { status: true } },
      _count: { select: { transcriptions: true } },
    },
  }).catch(() => [] as any[]);

  for (const u of users) {
    if (u.lifecycleEmailsSent.includes(tag)) continue;
    const hasConnected = u.numbers.some((n: any) => n.status === 'connected');
    if (!hasConnected || u._count.transcriptions > 0) continue;

    const firstName = firstNameOf(u.name);
    try {
      await sendEmail(
        u.email,
        `${firstName}, seu WhatsApp está conectado — falta só enviar um áudio`,
        wrapper(firstName, `Seu WhatsApp já está pronto, ${firstName}`, `
          <p style="color:#a7f3d0;line-height:1.7;margin:0 0 20px">Você já conectou seu número, mas ainda não recebeu nenhuma transcrição. Para o ZapScript funcionar, é só enviar (ou receber) um áudio pelo número conectado.</p>
          <p style="color:#a7f3d0;line-height:1.7;margin:0 0 8px">Em segundos, o texto e o resumo aparecem no seu painel — sem precisar abrir e ouvir nada.</p>
          ${btn(`${APP_URL}/dashboard/numeros`, 'Ver meus números →')}
        `),
      );
      await markSent(u.id, tag);
    } catch (e: any) {
      log?.warn?.(`[Lifecycle] Falha ao enviar ${tag} para ${u.email}: ${e.message}`);
    }
  }
  return users.length;
}

/* ── Free perto do limite mensal (≥80% usado) → oferta de upgrade ────────── */
async function runUpgradeByUsage(log: any) {
  const monthTag = new Date().toISOString().slice(0, 7); // "2026-06"
  const tag = `upgrade_usage_${monthTag}`;

  const users = await prisma.user.findMany({
    where: {
      deletedAt: null,
      subscription: { plan: { name: 'free' } },
      balance:      { isNot: null },
    },
    select: {
      id: true, email: true, name: true, lifecycleEmailsSent: true,
      balance:      { select: { availableMinutes: true } },
      subscription: { select: { plan: { select: { minutesPerMonth: true } } } },
    },
  }).catch(() => [] as any[]);

  let sent = 0;
  for (const u of users) {
    if (u.lifecycleEmailsSent.includes(tag)) continue;
    const total = u.subscription?.plan?.minutesPerMonth ?? 0;
    const available = u.balance?.availableMinutes ?? 0;
    if (total <= 0) continue;
    const usedPct = 1 - (available / total);
    if (usedPct < 0.8) continue;

    const firstName = firstNameOf(u.name);
    try {
      await sendEmail(
        u.email,
        `${firstName}, você já usou ${Math.round(usedPct * 100)}% dos seus minutos grátis`,
        wrapper(firstName, `Seus minutos grátis estão acabando`, `
          <p style="color:#a7f3d0;line-height:1.7;margin:0 0 20px">Você já usou ${Math.round(usedPct * 100)}% dos 20 minutos do plano Free deste mês. Para continuar transcrevendo sem interrupção, dá pra fazer upgrade para o Pro.</p>
          <p style="color:#a7f3d0;line-height:1.7;margin:0 0 8px">O Pro inclui 200 minutos por mês, 2 números e resumo com IA — por <strong style="color:#6ee7b7">R$19,90 no primeiro mês</strong>.</p>
          ${btn(`${APP_URL}/dashboard/plano`, 'Fazer upgrade para o Pro →')}
        `),
      );
      await markSent(u.id, tag);
      sent++;
    } catch (e: any) {
      log?.warn?.(`[Lifecycle] Falha ao enviar ${tag} para ${u.email}: ${e.message}`);
    }
  }
  return sent;
}

async function runOnce(log: any) {
  try {
    const [d1, d3, incomplete] = await Promise.all([runActivationD1(log), runActivationD3(log), runConnectionIncomplete(log)]);
    const upgrade = await runUpgradeByUsage(log);
    log?.info?.(`[Lifecycle] Ciclo concluído — candidatos d1=${d1} d3=${d3} conexao_incompleta_enviados=${incomplete} upgrades_enviados=${upgrade}`);
  } catch (e: any) {
    log?.error?.(`[Lifecycle] Erro no ciclo de e-mails: ${e.message}`);
  }
}

export function startLifecycleEmails(log: any) {
  setTimeout(() => {
    runOnce(log);
    setInterval(() => runOnce(log), INTERVAL_MS);
  }, FIRST_RUN_MS);
}
