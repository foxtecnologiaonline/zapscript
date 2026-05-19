/**
 * whatsapp-notify.ts
 *
 * Envia mensagens WhatsApp ao próprio usuário nos eventos:
 * 1. Boas-vindas ao adicionar número
 * 2. Aviso ao desconectar número
 * 3. Alerta de 50% dos minutos consumidos
 * 4. Alerta de 80% dos minutos consumidos
 * 5. Alerta de 100% dos minutos (saldo esgotado)
 */

import { prisma } from '../lib/prisma';
import { sendText } from './evolution';

async function sendToOwnNumber(instanceName: string, phone: string, message: string): Promise<void> {
  const clean = phone.replace(/\D/g, '');
  if (!clean || clean.length < 10) return;
  await sendText(instanceName, clean, message);
}

// ── 1. Boas-vindas ao adicionar número ────────────────────────────────────
export async function notifyWelcome(numberId: string): Promise<void> {
  try {
    const n = await (prisma as any).whatsappNumber.findUnique({
      where:   { id: numberId },
      include: { user: true },
    });
    if (!n?.zapiInstanceId || !n?.phoneNumber) return;

    const msg = [
      `👋 Olá${n.user?.name ? `, *${n.user.name}*` : ''}!`,
      '',
      '✅ *ZapScript* ativado e conectado!',
      '',
      'A configuração está pronta, e seus áudios do WhatsApp agora são transcritos e resumidos automaticamente.',
      '',
      '🔒 Privado · Criptografado · Sem armazenamento de áudio.',
      '',
      '📊 Painel: zapscript.me/dashboard',
    ].join('\n');

    await sendToOwnNumber(n.zapiInstanceId, n.phoneNumber, msg);
  } catch { /* não crítico */ }
}

// ── 1b. Reconexão (número já havia sido conectado antes) ─────────────────
export async function notifyReconnected(numberId: string): Promise<void> {
  try {
    const n = await (prisma as any).whatsappNumber.findUnique({
      where:   { id: numberId },
      include: { user: true },
    });
    if (!n?.zapiInstanceId || !n?.phoneNumber) return;

    const msg = [
      `✅ *ZapScript* — Número reconectado`,
      '',
      `Seu número *${n.phoneNumber}* voltou a ficar ativo no ZapScript.`,
      '',
      '🎙️ As transcrições automáticas estão *retomadas*!',
      '',
      '👉 https://ZapScript.me/dashboard',
    ].join('\n');

    await sendToOwnNumber(n.zapiInstanceId, n.phoneNumber, msg);
  } catch { /* não crítico */ }
}

// ── 2. Aviso ao desconectar número ────────────────────────────────────────
export async function notifyDisconnected(numberId: string): Promise<void> {
  try {
    const n = await (prisma as any).whatsappNumber.findUnique({
      where:   { id: numberId },
      include: { user: true },
    });
    if (!n?.zapiInstanceId || !n?.phoneNumber) return;

    const msg = [
      `⚠️ *ZapScript* — Número desconectado`,
      '',
      `Seu número *${n.phoneNumber}* foi desconectado do ZapScript.`,
      '',
      '📵 Enquanto desconectado, os áudios *não serão transcritos*.',
      '',
      '🔄 Para reconectar, acesse:',
      '👉 https://ZapScript.me/dashboard/numeros',
    ].join('\n');

    await sendToOwnNumber(n.zapiInstanceId, n.phoneNumber, msg);
  } catch { /* não crítico */ }
}

// ── 3-5. Alertas de consumo de minutos ───────────────────────────────────
export async function notifyMinuteAlert(
  userId: string,
  pct: 50 | 80 | 100,
): Promise<void> {
  try {
    const n = await (prisma as any).whatsappNumber.findFirst({
      where:   { userId, status: 'connected', zapiInstanceId: { not: null } },
      include: { user: true },
    });
    if (!n?.zapiInstanceId || !n?.phoneNumber) return;

    const msgs: Record<number, string> = {
      50: [
        `📊 *ZapScript* — 50% dos minutos usados`,
        '',
        `Você já usou *metade dos seus minutos* do mês.`,
        '',
        '💡 Confira seu saldo e considere fazer upgrade para não perder nenhum áudio:',
        '👉 https://ZapScript.me/dashboard/plano',
      ].join('\n'),
      80: [
        `⚠️ *ZapScript* — 80% dos minutos usados`,
        '',
        `Seus minutos estão quase esgotando! Restam apenas *20%*.`,
        '',
        '🚀 Faça upgrade agora e continue transcrevendo sem interrupção:',
        '👉 https://ZapScript.me/dashboard/plano',
      ].join('\n'),
      100: [
        `🔴 *ZapScript* — Minutos esgotados`,
        '',
        `Você atingiu *100% dos seus minutos* deste mês.`,
        '',
        '📵 As transcrições foram *pausadas* até o próximo ciclo ou upgrade.',
        '',
        '⚡ Faça upgrade agora para retomar imediatamente:',
        '👉 https://ZapScript.me/dashboard/plano',
      ].join('\n'),
    };

    await sendToOwnNumber(n.zapiInstanceId, n.phoneNumber, msgs[pct]);
  } catch { /* não crítico */ }
}
