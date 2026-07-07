import { prisma } from '../lib/prisma';
import { sendEmail } from '../lib/mailer';
import { formatSavedTime } from '../lib/freemium';
import { PRODUCT } from '../lib/products';

/* ── Configuração ──────────────────────────────────────────────────────────
   Roda 1x/dia (primeira execução pouco depois do boot). Cada e-mail é
   idempotente via User.lifecycleEmailsSent — uma tag por gatilho, gravada
   só depois do envio ter sucesso, então nunca dispara duas vezes. ────────── */
const INTERVAL_MS  = 24 * 60 * 60 * 1000; // 1x por dia
const FIRST_RUN_MS = 10 * 60 * 1000;      // 10 min após startup

const APP_URL = process.env.APP_URL || 'https://zapscript.me';

/* ── Oferta permanente: 1º mês do Pro com 50% off (R$19,90) ──────────────────
   Fonte da verdade server-side (espelha apps/web/src/lib/promo.ts). Não expira. */
/** Frase de preço do Pro para usar dentro do corpo de e-mails. */
function proPriceLine(): string {
  return `por <strong style="color:#6ee7b7">R$19,90 no primeiro mês</strong> (depois R$39,90/mês)`;
}

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
        `${firstName}, falta 1 passo para sua 1ª conversão`,
        wrapper(firstName, `Falta 1 passo, ${firstName}!`, `
          <p style="color:#a7f3d0;line-height:1.7;margin:0 0 20px">Você criou sua conta no ZapScript mas ainda não conectou seu WhatsApp. Sem isso, nenhum áudio é convertido automaticamente.</p>
          <p style="color:#a7f3d0;line-height:1.7;margin:0 0 8px">Leva menos de 2 minutos: escaneie um QR Code (ou use o código de pareamento) e pronto — todo áudio recebido já chega convertido e resumido por IA.</p>
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
          <p style="color:#a7f3d0;line-height:1.7;margin:0 0 8px">Volte ao painel, gere um novo código e finalize no seu celular. Assim que conectar, todo áudio recebido já chega convertido e resumido.</p>
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

/* ── D+3: número conectado mas zero conversões ─────────────────────────── */
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
          <p style="color:#a7f3d0;line-height:1.7;margin:0 0 20px">Você já conectou seu número, mas ainda não recebeu nenhuma conversão. Para o ZapScript funcionar, é só enviar (ou receber) um áudio pelo número conectado.</p>
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
      subscriptions: { some: { productKey: PRODUCT.TRANSCRIPTION, plan: { name: 'free' } } },
      balance:       { isNot: null },
    },
    select: {
      id: true, email: true, name: true, lifecycleEmailsSent: true,
      balance:       { select: { audiosUsed: true } },
      subscriptions: { where: { productKey: PRODUCT.TRANSCRIPTION }, select: { plan: { select: { audiosPerMonth: true } } } },
    },
  }).catch(() => [] as any[]);

  let sent = 0;
  for (const u of users) {
    if (u.lifecycleEmailsSent.includes(tag)) continue;
    const total = u.subscriptions?.[0]?.plan?.audiosPerMonth ?? 0;
    const used  = u.balance?.audiosUsed ?? 0;
    if (total <= 0) continue;
    const usedPct = used / total;
    if (usedPct < 0.8) continue;

    const firstName = firstNameOf(u.name);
    try {
      await sendEmail(
        u.email,
        `${firstName}, você já usou ${Math.round(usedPct * 100)}% dos seus áudios grátis`,
        wrapper(firstName, `Seus áudios grátis estão acabando`, `
          <p style="color:#a7f3d0;line-height:1.7;margin:0 0 20px">Você já usou ${Math.round(usedPct * 100)}% dos ${total} áudios do plano Free deste mês. Para continuar convertendo sem interrupção, dá pra fazer upgrade para o Pro.</p>
          <p style="color:#a7f3d0;line-height:1.7;margin:0 0 8px">O Pro inclui áudios ilimitados, 2 números e resumo com IA — ${proPriceLine()}.</p>
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

/* ── 1ª conversão concluída → comemoração + reforço do valor "robô 24h" ────
   Momento de maior engajamento: o usuário acabou de ver o produto funcionar.
   Limitado a quem se cadastrou nos últimos 7 dias para não disparar em massa
   na base existente no primeiro deploy. ────────── */
async function runFirstTranscription(log: any) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const tag   = 'first_transcription';

  const users = await prisma.user.findMany({
    where:  { createdAt: { gte: since }, deletedAt: null, transcriptions: { some: {} } },
    select: { id: true, email: true, name: true, lifecycleEmailsSent: true },
  }).catch(() => [] as any[]);

  let sent = 0;
  for (const u of users) {
    if (u.lifecycleEmailsSent.includes(tag)) continue;

    const firstName = firstNameOf(u.name);
    try {
      await sendEmail(
        u.email,
        `${firstName}, seu robô já está trabalhando 24h por você 🎉`,
        wrapper(firstName, `Funcionou! Seu robô está no ar 🎉`, `
          <p style="color:#a7f3d0;line-height:1.7;margin:0 0 20px">Sua primeira conversão saiu — e a partir de agora isso acontece sozinho. O ZapScript fica de prontidão <strong>24 horas por dia</strong>, convertendo e resumindo cada áudio assim que ele chega, mesmo enquanto você dorme.</p>
          <p style="color:#a7f3d0;line-height:1.7;margin:0 0 8px">Você não precisa encaminhar nada nem abrir outro app. É só receber o áudio — o texto e o resumo aparecem prontos no seu painel.</p>
          ${btn(`${APP_URL}/dashboard`, 'Ver minhas conversões →')}
          <p style="color:#6ee7b7;line-height:1.7;margin:24px 0 4px;font-size:14px">💚 Gostou? Quem você conhece também vive afogado em áudio?</p>
          <p style="color:#a7f3d0;line-height:1.7;margin:0 0 8px;font-size:14px">Indique o ZapScript e ganhe recompensas a cada amigo que ativar — seu link pessoal está em <a href="${APP_URL}/indique" style="color:#34d399">zapscript.me/indique</a>.</p>
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

/* ── Win-back: assinatura Pro cancelada nos últimos 3–7 dias ──────────────────
   Após cancelar, a assinatura vira status 'canceled' (planId volta p/ free).
   Convida a voltar, reforçando o valor do robô e o custo por dia. ────────── */
async function runWinBack(log: any) {
  const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const to   = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const tag  = 'winback_canceled';

  const users = await prisma.user.findMany({
    where: {
      deletedAt: null,
      subscriptions: { some: { productKey: PRODUCT.TRANSCRIPTION, status: 'canceled', updatedAt: { gte: from, lte: to } } },
    },
    select: { id: true, email: true, name: true, lifecycleEmailsSent: true },
  }).catch(() => [] as any[]);

  let sent = 0;
  for (const u of users) {
    if (u.lifecycleEmailsSent.includes(tag)) continue;

    const firstName = firstNameOf(u.name);
    try {
      await sendEmail(
        u.email,
        `${firstName}, seu robô está em pausa — quer reativar?`,
        wrapper(firstName, `Seu robô está descansando, ${firstName}`, `
          <p style="color:#a7f3d0;line-height:1.7;margin:0 0 20px">Desde que você cancelou o Pro, os áudios voltaram a chegar — só que agora sem ninguém convertendo por você 24 horas por dia. Toda vez que chega um áudio longo, é você quem para pra ouvir.</p>
          <p style="color:#a7f3d0;line-height:1.7;margin:0 0 8px">Reativar leva 1 minuto: áudios ilimitados, 2 números e resumo com IA — ${proPriceLine()}. Menos de R$1,33 por dia para ter um robô lendo seus áudios.</p>
          ${btn(`${APP_URL}/dashboard/plano`, 'Reativar o Pro →')}
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

/* ── Free engajado mas longe do limite (D+7 a D+14) → mostrar o teto do Free ──
   Usuário que já provou valor (tem conversões) mas usa pouco, então o gatilho
   de "≥80% dos áudios" nunca dispara. Reforça que o hábito vai esbarrar nos
   15 áudios do Free e convida ao Pro. Janela de cadastro evita disparo em massa na
   base antiga; tag única (one-shot) garante idempotência. ────────── */
async function runUpgradeActiveFree(log: any) {
  const from = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const to   = new Date(Date.now() -  7 * 24 * 60 * 60 * 1000);
  const tag  = 'upgrade_active_free';

  const users = await prisma.user.findMany({
    where: {
      createdAt: { gte: from, lte: to },
      deletedAt: null,
      subscriptions:  { some: { productKey: PRODUCT.TRANSCRIPTION, plan: { name: 'free' } } },
      transcriptions: { some: {} },
    },
    select: {
      id: true, email: true, name: true, lifecycleEmailsSent: true,
      balance:       { select: { audiosUsed: true } },
      subscriptions: { where: { productKey: PRODUCT.TRANSCRIPTION }, select: { plan: { select: { audiosPerMonth: true } } } },
    },
  }).catch(() => [] as any[]);

  let sent = 0;
  for (const u of users) {
    if (u.lifecycleEmailsSent.includes(tag)) continue;
    // Quem já está perto do teto recebe o upgrade_usage (mais oportuno). Aqui só
    // os que usam pouco mas com constância — evita dois e-mails de upgrade.
    const total = u.subscriptions?.[0]?.plan?.audiosPerMonth ?? 0;
    const used  = u.balance?.audiosUsed ?? 0;
    if (total > 0 && (used / total) >= 0.8) continue;

    const firstName = firstNameOf(u.name);
    try {
      await sendEmail(
        u.email,
        `${firstName}, você já pegou o jeito do ZapScript`,
        wrapper(firstName, `Virou hábito, ${firstName} 👏`, `
          <p style="color:#a7f3d0;line-height:1.7;margin:0 0 20px">Você já está convertendo seus áudios pelo ZapScript — ótimo sinal de que virou parte da rotina. O plano Free dá conta do começo, mas são só <strong>15 áudios por mês</strong>: num dia mais corrido de áudios, eles acabam rápido.</p>
          <p style="color:#a7f3d0;line-height:1.7;margin:0 0 8px">No Pro são áudios ilimitados, 2 números e resumo com IA — ${proPriceLine()}. Assim seu robô nunca para no meio do mês.</p>
          ${btn(`${APP_URL}/dashboard/plano`, 'Conhecer o Pro →')}
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

/* ── D+6 do trial: véspera do fim → reforça economia + custo/dia ──────────────
   Trial de 7 dias. Disparamos quando faltam ~24h (último dia cheio de Pro),
   mostrando o tempo JÁ economizado no mês como prova de valor concreta.
   Tag one-shot (um usuário só faz trial uma vez). ────────── */
async function runTrialEndingD6(log: any) {
  const now     = new Date();
  const horizon = new Date(now.getTime() + 30 * 60 * 60 * 1000); // próximas ~30h
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const tag     = 'trial_ending';

  const users = await prisma.user.findMany({
    where: {
      deletedAt: null,
      subscriptions: { some: { productKey: PRODUCT.TRANSCRIPTION, status: 'trialing', trialEndsAt: { gt: now, lte: horizon } } },
    },
    select: {
      id: true, email: true, name: true, lifecycleEmailsSent: true,
      subscriptions: { where: { productKey: PRODUCT.TRANSCRIPTION }, select: { paymentMethod: true, asaasSubscriptionId: true } },
    },
  }).catch(() => [] as any[]);

  let sent = 0;
  for (const u of users) {
    if (u.lifecycleEmailsSent.includes(tag)) continue;

    // Cartão já garantido → não cobramos por upgrade; avisamos da cobrança automática.
    const cardOnFile = u.subscriptions?.[0]?.paymentMethod === 'credit_card' && !!u.subscriptions?.[0]?.asaasSubscriptionId;

    const agg = await prisma.transcription.aggregate({
      where:  { userId: u.id, createdAt: { gte: monthStart } },
      _sum:   { durationSec: true },
      _count: true,
    }).catch(() => null);
    const savedSec   = agg?._sum.durationSec || 0;
    const cnt        = agg?._count || 0;
    const savedLabel = formatSavedTime(savedSec);

    const firstName = firstNameOf(u.name);
    const savedLine = savedSec > 0
      ? `Nestes dias de Pro, você já economizou <strong style="color:#6ee7b7">${savedLabel}</strong>${cnt > 0 ? ` lendo ${cnt} áudio${cnt !== 1 ? 's' : ''} em vez de ouvir tudo` : ''} este mês.`
      : `Seu período de Pro está terminando.`;
    const subject = cardOnFile
      ? `${firstName}, seu cartão será cobrado amanhã`
      : savedSec > 0
        ? `${firstName}, você economizou ${savedLabel} este mês`
        : `${firstName}, seu Pro termina amanhã`;
    const bodyCta = cardOnFile
      ? `
          <p style="color:#a7f3d0;line-height:1.7;margin:0 0 20px">${savedLine}</p>
          <p style="color:#a7f3d0;line-height:1.7;margin:0 0 8px">Seu cartão será cobrado <strong>amanhã (R$39,90/mês)</strong> e seu Pro continua sem interrupção — áudios ilimitados e Modo Privado. Não precisa fazer nada.</p>
          <p style="color:#a7f3d0;line-height:1.7;margin:0 0 8px">Se preferir não continuar, <strong>cancele antes da cobrança e não paga nada</strong>.</p>
          ${btn(`${APP_URL}/dashboard/plano`, 'Ver meu plano →')}
        `
      : `
          <p style="color:#a7f3d0;line-height:1.7;margin:0 0 20px">${savedLine}</p>
          <p style="color:#a7f3d0;line-height:1.7;margin:0 0 8px">Para manter os áudios ilimitados e o Modo Privado sem interrupção, é <strong>menos de R$1,33 por dia</strong> — ${proPriceLine()}.</p>
          ${btn(`${APP_URL}/dashboard/plano`, 'Continuar com o Pro →')}
        `;
    try {
      await sendEmail(
        u.email,
        subject,
        wrapper(firstName, cardOnFile ? `Seu Pro continua amanhã, ${firstName}` : `Seu Pro termina amanhã, ${firstName}`, bodyCta),
      );
      await markSent(u.id, tag);
      sent++;
    } catch (e: any) {
      log?.warn?.(`[Lifecycle] Falha ao enviar ${tag} para ${u.email}: ${e.message}`);
    }
  }
  return sent;
}

/** Identificador de semana ISO (ex.: "2026-W26") para idempotência semanal. */
function isoWeekTag(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/* ── Resumo semanal (segundas) → reforço de valor recorrente ──────────────────
   Aproxima a cadência semanal rodando só às segundas. Só para quem teve ao
   menos 1 conversão nos últimos 7 dias (engajado) — não acorda base dormente.
   Idempotente por semana ISO.
   NOTA: a variante "ao próprio número via WhatsApp" (item 5c) fica pendente —
   exige o path de envio Evolution para o número conectado do usuário. ────────── */
async function runWeeklyDigest(log: any) {
  const now = new Date();
  if (now.getDay() !== 1) return 0; // só segundas-feiras
  const tag     = `digest_${isoWeekTag(now)}`;
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const users = await prisma.user.findMany({
    where: {
      deletedAt: null,
      transcriptions: { some: { createdAt: { gte: weekAgo } } },
      // Quem tem número conectado recebe o resumo via WhatsApp (worker, Lote B #5c).
      // Aqui o e-mail é só fallback para quem NÃO pode ser alcançado no WhatsApp.
      NOT: { numbers: { some: { status: 'connected', zapiInstanceId: { not: null } } } },
    },
    select: { id: true, email: true, name: true, lifecycleEmailsSent: true },
  }).catch(() => [] as any[]);

  let sent = 0;
  for (const u of users) {
    if (u.lifecycleEmailsSent.includes(tag)) continue;

    const agg = await prisma.transcription.aggregate({
      where:  { userId: u.id, createdAt: { gte: weekAgo } },
      _sum:   { durationSec: true },
      _count: true,
    }).catch(() => null);
    const cnt      = agg?._count || 0;
    if (cnt === 0) continue;
    const savedSec = agg?._sum.durationSec || 0;
    const savedLabel = formatSavedTime(savedSec);

    const firstName = firstNameOf(u.name);
    try {
      await sendEmail(
        u.email,
        `${firstName}, seu resumo da semana: ${cnt} áudio${cnt !== 1 ? 's' : ''} lido${cnt !== 1 ? 's' : ''}`,
        wrapper(firstName, `Sua semana no ZapScript 📊`, `
          <p style="color:#a7f3d0;line-height:1.7;margin:0 0 20px">Nos últimos 7 dias, o ZapScript leu <strong style="color:#6ee7b7">${cnt} áudio${cnt !== 1 ? 's' : ''}</strong> por você${savedSec > 0 ? ` e economizou <strong style="color:#6ee7b7">${savedLabel}</strong> que você não precisou passar ouvindo` : ''}.</p>
          <p style="color:#a7f3d0;line-height:1.7;margin:0 0 8px">Tudo já está no seu painel, em texto e com resumo — fácil de buscar quando precisar.</p>
          ${btn(`${APP_URL}/dashboard`, 'Ver minhas conversões →')}
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
    const upgrade   = await runUpgradeByUsage(log);
    const activeFree = await runUpgradeActiveFree(log);
    const firstTx   = await runFirstTranscription(log);
    const winback   = await runWinBack(log);
    const trialEnd  = await runTrialEndingD6(log);
    const digest    = await runWeeklyDigest(log);
    log?.info?.(`[Lifecycle] Ciclo concluído — candidatos d1=${d1} d3=${d3} conexao_incompleta_enviados=${incomplete} upgrades_enviados=${upgrade} upgrade_free_ativo=${activeFree} primeira_transcricao=${firstTx} winback=${winback} trial_ending=${trialEnd} resumo_semanal=${digest}`);
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
