import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  downloadMediaMessage,
  proto,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import path from 'path';
import fs from 'fs';
import { prisma } from '../lib/prisma';
import { encrypt, decrypt } from './encryption';
import { transcriptionQueue } from './queue';
import { io } from '../index';

// ── In-memory session map ─────────────────────────────────
const sessions = new Map<string, ReturnType<typeof makeWASocket>>();

// ── Exponential backoff por número ────────────────────────
const reconnectAttempts = new Map<string, number>();
const MAX_RECONNECT_DELAY_MS = 300_000; // 5 minutos

// ── Pending QR cache (fixes race condition: socket joins AFTER QR emitted) ──
const pendingQRs = new Map<string, { numberId: string; qr: string }>();

/** Returns a cached QR for userId if one exists (socket join handler uses this) */
export function getPendingQR(userId: string) {
  return pendingQRs.get(userId) ?? null;
}

// ─────────────────────────────────────────────────────────────────────
//  SHARED HANDLER SETUP — used by both QR and pairing-code flows
// ─────────────────────────────────────────────────────────────────────

function attachCommonHandlers(
  sock: ReturnType<typeof makeWASocket>,
  {
    numberId,
    userId,
    saveCreds,
    state,
  }: {
    numberId: string;
    userId: string;
    saveCreds: () => Promise<void>;
    state: Awaited<ReturnType<typeof useMultiFileAuthState>>['state'];
  }
) {
  // ── Persist credentials to disk + DB ──────────────────
  sock.ev.on('creds.update', async () => {
    await saveCreds();
    try {
      const encrypted = encrypt(state.creds as unknown as object);
      await prisma.whatsappNumber.update({
        where: { id: numberId },
        data: { sessionEncrypted: encrypted },
      });
    } catch (err) {
      console.error(`[WhatsApp] Falha ao salvar credenciais para ${numberId}:`, err);
    }
  });

  // ── Connection state ───────────────────────────────────
  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      const phone = sock.user?.id?.split(':')[0] || '';
      reconnectAttempts.delete(numberId);
      pendingQRs.delete(userId);
      await prisma.whatsappNumber.update({
        where: { id: numberId },
        data: { status: 'connected', connectedAt: new Date(), phoneNumber: phone },
      });
      io.to(`user:${userId}`).emit('wa_connected', { numberId, phone });
      console.log(`[WhatsApp] Conectado: ${numberId} (${phone})`);
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
        pendingQRs.delete(userId);
        await prisma.whatsappNumber.update({
          where: { id: numberId },
          data: { status: 'disconnected', sessionEncrypted: null },
        });
        io.to(`user:${userId}`).emit('wa_disconnected', { numberId });
      }
    }
  });

  // ── Incoming audio messages → transcription queue ─────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;

      const isAudio = !!msg.message?.audioMessage || !!msg.message?.ptvMessage;
      if (!isAudio) continue;

      const contactJid = msg.key.remoteJid!;
      const audio      = msg.message?.audioMessage || msg.message?.ptvMessage;
      const duration   = audio?.seconds || 0;

      await transcriptionQueue.add(
        'transcribe',
        { numberId, userId, msg, contactJid, duration },
        { jobId: `${numberId}-${msg.key.id}` }
      );
    }
  });
}

// ─────────────────────────────────────────────────────────────────────
//  CREATE SESSION — QR Code flow
// ─────────────────────────────────────────────────────────────────────
export async function createWASession(numberId: string, userId: string) {
  const sessionDir = path.join(process.cwd(), '.sessions', numberId);
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: ['ZapScript', 'Chrome', '1.0.0'],
  });

  sessions.set(numberId, sock);

  // QR-specific: emit QR to frontend via Socket.IO + cache it
  sock.ev.on('connection.update', async ({ qr }) => {
    if (qr) {
      pendingQRs.set(userId, { numberId, qr });
      try {
        io.to(`user:${userId}`).emit('qr_code', { numberId, qr });
        console.log(`[WhatsApp] QR emitido para user:${userId} número:${numberId}`);
      } catch (err) {
        console.error('[WhatsApp] Falha ao emitir QR via Socket.IO:', err);
      }
      await prisma.whatsappNumber.update({
        where: { id: numberId },
        data:  { status: 'connecting' },
      });
    }
  });

  attachCommonHandlers(sock, { numberId, userId, saveCreds, state });

  return sock;
}

// ─────────────────────────────────────────────────────────────────────
//  REQUEST PAIRING CODE — Phone-number flow
//  Returns an 8-char code (e.g. "ABCD-1234") that the user types
//  in WhatsApp → Dispositivos Conectados → Vincular por número
// ─────────────────────────────────────────────────────────────────────
export async function requestWAPairingCode(
  numberId: string,
  userId: string,
  phoneNumber: string
): Promise<string> {
  // Close any existing session first
  const existing = sessions.get(numberId);
  if (existing) {
    try { existing.end(undefined as any); } catch {}
    sessions.delete(numberId);
  }

  const sessionDir = path.join(process.cwd(), '.sessions', numberId);
  // Remove old creds so we start fresh (avoids "already registered" error)
  const credsPath = path.join(sessionDir, 'creds.json');
  if (fs.existsSync(credsPath)) fs.unlinkSync(credsPath);

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: ['ZapScript', 'Chrome', '1.0.0'],
  });

  sessions.set(numberId, sock);

  await prisma.whatsappNumber.update({
    where: { id: numberId },
    data:  { status: 'connecting', phoneNumber: phoneNumber.replace(/\D/g, '') },
  });

  attachCommonHandlers(sock, { numberId, userId, saveCreds, state });

  // Request pairing code — phone must be digits only, with country code
  // e.g. "5511999999999" (Brazil: 55 + DDD + number)
  const cleanPhone = phoneNumber.replace(/\D/g, '');
  const code = await sock.requestPairingCode(cleanPhone);

  // Emit to Socket.IO so frontend can display it immediately if already connected
  io.to(`user:${userId}`).emit('pairing_code', { numberId, code });
  console.log(`[WhatsApp] Pairing code gerado para ${numberId}: ${code}`);

  return code;
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

// ── Restore encrypted creds from DB to disk ──────────────
function restoreSessionToDisk(numberId: string, sessionEncrypted: string): void {
  const sessionDir = path.join(process.cwd(), '.sessions', numberId);
  const credsPath  = path.join(sessionDir, 'creds.json');

  if (fs.existsSync(credsPath)) return;

  const creds = decrypt(sessionEncrypted);
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(credsPath, JSON.stringify(creds), 'utf8');
}

// ── Reconnect all sessions on startup ────────────────────
export async function reconnectAllSessions() {
  const numbers = await prisma.whatsappNumber.findMany({
    where:   { status: 'connected' },
    include: { user: true },
  });

  for (const n of numbers) {
    try {
      if (n.sessionEncrypted) {
        restoreSessionToDisk(n.id, n.sessionEncrypted);
      }
      await createWASession(n.id, n.userId);
    } catch (err) {
      console.error(`[WhatsApp] Falha ao reconectar ${n.phoneNumber}:`, err);
      await prisma.whatsappNumber.update({
        where: { id: n.id },
        data:  { status: 'disconnected' },
      });
    }
  }
}
