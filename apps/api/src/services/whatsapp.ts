import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  downloadMediaMessage,
  proto,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import path from 'path';
import { prisma } from '../lib/prisma';
import { encrypt, decrypt } from './encryption';
import { transcriptionQueue } from './queue';
import { io } from '../index';

// ── In-memory session map ─────────────────────────────────
const sessions = new Map<string, ReturnType<typeof makeWASocket>>();

// ── Exponential backoff por número ────────────────────────
const reconnectAttempts = new Map<string, number>();
const MAX_RECONNECT_DELAY_MS = 300_000; // 5 minutos

// ── Create / restore session ──────────────────────────────
export async function createWASession(numberId: string, userId: string) {
  const sessionDir = path.join(process.cwd(), '.sessions', numberId);
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: ['ZapScript', 'Chrome', '1.0.0'],
  });

  sessions.set(numberId, sock);

  // ── Save creds on update ──────────────────────────────
  sock.ev.on('creds.update', async () => {
    await saveCreds();
    try {
      const encrypted = encrypt(state.creds as unknown as object);
      await prisma.whatsappNumber.update({
        where: { id: numberId },
        data:  { sessionEncrypted: encrypted },
      });
    } catch (err) {
      console.error(`[WhatsApp] Falha ao salvar credenciais no banco para ${numberId}:`, err);
    }
  });

  // ── Connection state ──────────────────────────────────
  sock.ev.on('connection.update', async ({ qr, connection, lastDisconnect }) => {
    if (qr) {
      // Emit QR to dashboard via WebSocket
      io.to(`user:${userId}`).emit('qr_code', { numberId, qr });
      await prisma.whatsappNumber.update({
        where: { id: numberId },
        data:  { status: 'connecting' },
      });
    }

    if (connection === 'open') {
      const phone = sock.user?.id?.split(':')[0] || '';
      reconnectAttempts.delete(numberId); // resetar backoff após conexão bem-sucedida
      await prisma.whatsappNumber.update({
        where: { id: numberId },
        data:  { status: 'connected', connectedAt: new Date(), phoneNumber: phone },
      });
      io.to(`user:${userId}`).emit('wa_connected', { numberId, phone });
    }

    if (connection === 'close') {
      const code = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;

      sessions.delete(numberId);

      if (shouldReconnect) {
        const attempts = (reconnectAttempts.get(numberId) || 0) + 1;
        reconnectAttempts.set(numberId, attempts);
        const delayMs = Math.min(5000 * Math.pow(2, attempts - 1), MAX_RECONNECT_DELAY_MS);
        console.log(`[WhatsApp] Reconectando ${numberId} em ${delayMs / 1000}s (tentativa ${attempts})`);
        setTimeout(() => createWASession(numberId, userId), delayMs);
      } else {
        reconnectAttempts.delete(numberId);
        await prisma.whatsappNumber.update({
          where: { id: numberId },
          data:  { status: 'disconnected', sessionEncrypted: null },
        });
        io.to(`user:${userId}`).emit('wa_disconnected', { numberId });
      }
    }
  });

  // ── Listen for incoming messages ──────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;

      const isAudio =
        !!msg.message?.audioMessage ||
        !!msg.message?.pttMessage;

      if (!isAudio) continue;

      const contactJid = msg.key.remoteJid!;
      const audio      = msg.message?.audioMessage || msg.message?.pttMessage;
      const duration   = audio?.seconds || 0;

      await transcriptionQueue.add(
        'transcribe',
        { numberId, userId, msg, contactJid, duration },
        { jobId: `${numberId}-${msg.key.id}` }
      );
    }
  });

  return sock;
}

// ── Get active session ────────────────────────────────────
export function getSession(numberId: string) {
  return sessions.get(numberId);
}

// ── Disconnect ────────────────────────────────────────────
export async function disconnectWASession(numberId: string) {
  const sock = sessions.get(numberId);
  if (sock) {
    try { await sock.logout(); } catch (_) {}
    sessions.delete(numberId);
  }
  reconnectAttempts.delete(numberId);
}

// ── Send formatted transcription ─────────────────────────
export async function sendTranscription(
  sock: ReturnType<typeof makeWASocket>,
  jid: string,
  data: { bullets: string[]; originalText: string; refCode: string }
) {
  const { bullets, originalText, refCode } = data;
  const bulletLines = bullets.map((b) => `- ${b}`).join('\n');

  const text =
    `*_✨ Transcrição automática do seu áudio:_*\n\n` +
    `*Resumo:*\n${bulletLines}\n\n` +
    `*Original:*\n_${originalText}_\n\n` +
    `⚡ Transcreva seus áudios com o _zapscript.me/?ref=${refCode}_`;

  await sock.sendMessage(jid, { text });
}

// ── Reconnect all sessions on startup ────────────────────
export async function reconnectAllSessions() {
  const numbers = await prisma.whatsappNumber.findMany({
    where:   { status: 'connected' },
    include: { user: true },
  });

  for (const n of numbers) {
    try {
      await createWASession(n.id, n.userId);
      console.log(`📱 Reconectado: ${n.displayName || n.phoneNumber}`);
    } catch (err) {
      console.error(`❌ Falha ao reconectar ${n.phoneNumber}:`, err);
      await prisma.whatsappNumber.update({
        where: { id: n.id },
        data:  { status: 'disconnected' },
      });
    }
  }
}
