import { prisma } from '../lib/prisma';
import { sendToOwnNumber } from './whatsapp-notify';

/* ── Onboarding automático via WhatsApp ────────────────────────────────────
   Espelha lifecycle-emails.ts, mas envia pelo canal WhatsApp (instância
   Evolution do próprio número conectado do usuário — mesmo path usado por
   notifyWelcome/notifyReconnected/notifyMinuteAlert em whatsapp-notify.ts).
   Só alcança quem já tem número conectado (zapiInstanceId + status
   'connected'); quem ainda não conectou continua recebendo os e-mails de
   ativação D1/D3 (lifecycle-emails.ts) — o WhatsApp assume a partir daí,
   porque é o canal mais direto para reforçar o hábito recém-criado.
   Idempotente via User.lifecycleWhatsappSent — uma tag por gatilho, gravada
   só depois do envio ter sucesso. ────────────────────────────────────────── */
const INTERVAL_MS  = 6 * 60 * 60 * 1000;  // a cada 6h (janelas mais curtas que o e-mail)
const FIRST_RUN_MS = 15 * 60 * 1000;      // 15 min após startup

/** Marca uma tag como enviada (idempotência) sem sobrescrever outras tags concorrentes. */
async function markSent(userId: string, tag: string) {
  await prisma.user.update({
    where: { id: userId },
    data:  { lifecycleWhatsappSent: { push: tag } },
  });
}

function firstNameOf(name: string | null): string {
  return name?.split(' ')[0] || '';
}

/* ── Passo 1: número conectado, mas nenhum áudio convertido ainda (2h–24h) ──
   O usuário acabou de escanear o QR (recebeu o áudio de boas-vindas via
   notifyWelcome). Se em 2–24h ainda não converteu nada, é o momento certo
   pra lembrar — direto no canal que ele acabou de conectar. ─────────────── */
async function runFirstAudioNudge(log: any) {
  const from = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const to   = new Date(Date.now() - 2  * 60 * 60 * 1000);
  const tag  = 'wa_first_audio_nudge';

  const numbers = await prisma.whatsappNumber.findMany({
    where: {
      status: 'connected',
      zapiInstanceId: { not: null },
      connectedAt: { gte: from, lte: to },
    },
    select: {
      zapiInstanceId: true, phoneNumber: true,
      user: { select: { id: true, name: true, lifecycleWhatsappSent: true, _count: { select: { transcriptions: true } } } },
    },
  }).catch(() => [] as any[]);

  let sent = 0;
  for (const n of numbers) {
    const u = n.user;
    if (!u || u.lifecycleWhatsappSent.includes(tag)) continue;
    if (u._count.transcriptions > 0) continue;

    const nome = firstNameOf(u.name);
    const msg = [
      `👋 ${nome ? `${nome}, seu` : 'Seu'} WhatsApp já está conectado ao ZapScript!`,
      '',
      'Falta só 1 passo: receba (ou envie) um áudio por aqui e em segundos eu devolvo o texto completo + resumo — sem precisar ouvir nada.',
      '',
      '💡 Dica: pode ser qualquer áudio que já esteja numa conversa sua.',
    ].join('\n');

    try {
      await sendToOwnNumber(n.zapiInstanceId!, n.phoneNumber!, msg);
      await markSent(u.id, tag);
      sent++;
    } catch (e: any) {
      log?.warn?.(`[LifecycleWA] Falha ao enviar ${tag} para ${u.id}: ${e.message}`);
    }
  }
  return sent;
}

/* ── Passo 2: 1ª conversão concluída → comemoração + próximo passo ────────
   Momento de maior engajamento: o usuário acabou de ver funcionar. Limitado
   a quem se cadastrou nos últimos 7 dias (mesma janela do e-mail equivalente
   em lifecycle-emails.ts) para não disparar em massa na base existente. ── */
async function runFirstTranscriptionCelebration(log: any) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const tag   = 'wa_first_transcription';

  const users = await prisma.user.findMany({
    where: {
      createdAt: { gte: since },
      deletedAt: null,
      transcriptions: { some: {} },
      numbers: { some: { status: 'connected', zapiInstanceId: { not: null } } },
    },
    select: {
      id: true, name: true, lifecycleWhatsappSent: true,
      numbers: { where: { status: 'connected', zapiInstanceId: { not: null } }, select: { zapiInstanceId: true, phoneNumber: true }, take: 1 },
    },
  }).catch(() => [] as any[]);

  let sent = 0;
  for (const u of users) {
    if (u.lifecycleWhatsappSent.includes(tag)) continue;
    const n = u.numbers[0];
    if (!n?.zapiInstanceId || !n?.phoneNumber) continue;

    const nome = firstNameOf(u.name);
    const msg = [
      `🎉 Funcionou${nome ? `, ${nome}` : ''}! Sua primeira conversão saiu.`,
      '',
      'A partir de agora isso acontece sozinho, 24h por dia — cada áudio que chegar aqui já sai convertido e resumido, sem você precisar abrir nada.',
      '',
      '📲 Todo o histórico fica no seu painel: zapscript.me/dashboard',
    ].join('\n');

    try {
      await sendToOwnNumber(n.zapiInstanceId, n.phoneNumber, msg);
      await markSent(u.id, tag);
      sent++;
    } catch (e: any) {
      log?.warn?.(`[LifecycleWA] Falha ao enviar ${tag} para ${u.id}: ${e.message}`);
    }
  }
  return sent;
}

/* ── Passo 3: D+3 a D+7 de conexão, já engajado → dica de funcionalidade ──
   Reforça um recurso que quem só usou o básico pode não ter notado ainda
   (etiqueta de prioridade). Só para quem já converteu ao menos 1 áudio. ── */
async function runFeatureTip(log: any) {
  const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const to   = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const tag  = 'wa_feature_tip_priority';

  const numbers = await prisma.whatsappNumber.findMany({
    where: {
      status: 'connected',
      zapiInstanceId: { not: null },
      connectedAt: { gte: from, lte: to },
    },
    select: {
      zapiInstanceId: true, phoneNumber: true,
      user: { select: { id: true, name: true, lifecycleWhatsappSent: true, _count: { select: { transcriptions: true } } } },
    },
  }).catch(() => [] as any[]);

  let sent = 0;
  for (const n of numbers) {
    const u = n.user;
    if (!u || u.lifecycleWhatsappSent.includes(tag)) continue;
    if (u._count.transcriptions === 0) continue;

    const nome = firstNameOf(u.name);
    const msg = [
      `💡 ${nome ? `${nome}, você` : 'Você'} sabia?`,
      '',
      'Cada áudio convertido já chega com uma etiqueta de prioridade (urgente, normal, etc.) — assim dá pra saber o que precisa de resposta rápida sem abrir tudo.',
      '',
      'Dá pra conectar até 2 números no plano Pro. Veja em zapscript.me/dashboard/numeros',
    ].join('\n');

    try {
      await sendToOwnNumber(n.zapiInstanceId!, n.phoneNumber!, msg);
      await markSent(u.id, tag);
      sent++;
    } catch (e: any) {
      log?.warn?.(`[LifecycleWA] Falha ao enviar ${tag} para ${u.id}: ${e.message}`);
    }
  }
  return sent;
}

async function runOnce(log: any) {
  try {
    const nudge = await runFirstAudioNudge(log);
    const celebration = await runFirstTranscriptionCelebration(log);
    const tip = await runFeatureTip(log);
    log?.info?.(`[LifecycleWA] Ciclo concluído — primeiro_audio=${nudge} primeira_transcricao=${celebration} dica_funcionalidade=${tip}`);
  } catch (e: any) {
    log?.error?.(`[LifecycleWA] Erro no ciclo de onboarding via WhatsApp: ${e.message}`);
  }
}

export function startLifecycleWhatsapp(log: any) {
  setTimeout(() => {
    runOnce(log);
    setInterval(() => runOnce(log), INTERVAL_MS);
  }, FIRST_RUN_MS);
}
