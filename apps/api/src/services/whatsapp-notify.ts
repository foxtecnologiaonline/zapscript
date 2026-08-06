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

import { readFileSync } from 'fs';
import { join } from 'path';
import { prisma } from '../lib/prisma';
import { sendText, sendPtt } from './evolution';

export async function sendToOwnNumber(instanceName: string, phone: string, message: string): Promise<void> {
  const clean = phone.replace(/\D/g, '');
  if (!clean || clean.length < 10) return;
  await sendText(instanceName, clean, message);
}

// Caminho do áudio resolvido a partir do próprio arquivo compilado (__dirname),
// não de process.cwd() — este último varia com o comando/CMD usado pra subir o
// processo (ex.: `cd apps/api && node dist/index.js` vs `node apps/api/dist/index.js`
// direto de /app no Docker) e por isso é frágil. dist/services/ → sobe 2 níveis → apps/api/.
let cachedAudioBase64: string | undefined;
function getWelcomeAudioBase64(): string {
  if (cachedAudioBase64 !== undefined) return cachedAudioBase64;
  const audioPath = join(__dirname, '../../private/welcome.mp3');
  const base64 = readFileSync(audioPath).toString('base64');
  cachedAudioBase64 = base64;
  return base64;
}

// ── 1. Boas-vindas ao adicionar/conectar número (qualquer transição para
//    "conectado" vinda de um estado não-conectado — número novo, readicionado
//    ou reconectado após queda) ────────────────────────────────────────────
export async function notifyWelcome(numberId: string): Promise<void> {
  try {
    const n = await (prisma as any).whatsappNumber.findUnique({
      where:   { id: numberId },
      include: { user: true },
    });
    if (!n?.zapiInstanceId || !n?.phoneNumber) return;

    await sendPtt(n.zapiInstanceId, n.phoneNumber, getWelcomeAudioBase64());
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
      '🎙️ As conversões automáticas estão *retomadas*!',
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
      '📵 Enquanto desconectado, os áudios *não serão convertidos*.',
      '',
      '🔄 Para reconectar, acesse:',
      '👉 https://ZapScript.me/dashboard/numeros',
    ].join('\n');

    await sendToOwnNumber(n.zapiInstanceId, n.phoneNumber, msg);
  } catch { /* não crítico */ }
}

// ── 3-5. Alertas de consumo de áudios ────────────────────────────────────
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
        `📊 *ZapScript* — 50% dos áudios usados`,
        '',
        `Você já usou *metade dos seus áudios* do mês.`,
        '',
        '💡 Confira seu saldo e considere fazer upgrade para não perder nenhum áudio:',
        '👉 https://ZapScript.me/dashboard/plano',
      ].join('\n'),
      80: [
        `⚠️ *ZapScript* — 80% dos áudios usados`,
        '',
        `Seus áudios estão quase esgotando! Restam apenas *20%*.`,
        '',
        '🚀 Faça upgrade agora e continue convertendo sem interrupção:',
        '👉 https://ZapScript.me/dashboard/plano',
      ].join('\n'),
      100: [
        `🔴 *ZapScript* — Áudios esgotados`,
        '',
        `Você atingiu *100% dos seus áudios* deste mês.`,
        '',
        '📵 As conversões foram *pausadas* até o próximo ciclo ou upgrade.',
        '',
        '⚡ Faça upgrade agora para retomar imediatamente:',
        '👉 https://ZapScript.me/dashboard/plano',
      ].join('\n'),
    };

    await sendToOwnNumber(n.zapiInstanceId, n.phoneNumber, msgs[pct]);
  } catch { /* não crítico */ }
}

// ── 6. Módulo Cobrança: cliente pode ter avisado que já pagou (#6) ───────
export async function notifyCobrancaPossiblePayment(
  userId: string,
  clientePhone: string,
  messageText: string,
): Promise<void> {
  try {
    const cliente = await (prisma as any).cobrancaCliente.findFirst({
      where:   { userId, telefone: clientePhone, deletedAt: null },
      include: { cobrancas: { where: { status: 'pendente', deletedAt: null }, orderBy: { vencimento: 'asc' } } },
    });
    if (!cliente || cliente.cobrancas.length === 0) return;

    const n = await (prisma as any).whatsappNumber.findFirst({
      where: { userId, status: 'connected', zapiInstanceId: { not: null } },
    });
    if (!n?.zapiInstanceId || !n?.phoneNumber) return;

    const c = cliente.cobrancas[0];
    const valorFmt = c.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const dataFmt = new Date(c.vencimento).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
    const extra = cliente.cobrancas.length > 1 ? ` (+${cliente.cobrancas.length - 1} outra(s) em aberto)` : '';
    const primeiroNome = cliente.nome.trim().split(' ')[0] || cliente.nome;

    const msg = [
      `💬 *Cobrança* — possível confirmação de pagamento`,
      '',
      `*${cliente.nome}* respondeu sobre a cobrança de *${valorFmt}* (vence ${dataFmt})${extra} e pode estar avisando que já pagou:`,
      '',
      `"${messageText.slice(0, 200)}"`,
      '',
      `Confirme pelo painel ou diga por voz: "marca como paga a cobrança do ${primeiroNome}".`,
    ].join('\n');

    await sendToOwnNumber(n.zapiInstanceId, n.phoneNumber, msg);
  } catch { /* não crítico */ }
}
