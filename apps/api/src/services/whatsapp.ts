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

// ── Pending QR cache (keyed by numberId to support multiple numbers per user) ──
const pendingQRs = new Map<string, { qr: string; timestamp: number }>();
const pendingPairingCodes = new Map<string, { code: string; timestamp: number }>();

// Cache cleanup interval - remove entries older than 90s
setInterval(() => {
  const now = Date.now();
  for (const [numberId, entry] of pendingQRs.entries()) {
    if (now - entry.timestamp > 90_000) pendingQRs.delete(numberId);
  }
  for (const [numberId, entry] of pendingPairingCodes.entries()) {
    if (now - entry.timestamp > 60_000) pendingPairingCodes.delete(numberId);
  }
}, 10_000); // cleanup every 10s

/** Returns a cached QR for numberId if one exists */
export function getPendingQR(numberId: string) {
  return pendingQRs.get(numberId)?.qr ?? null;
}

/** Returns a cached pairing code for numberId if one exists */
export function getPendingPairingCode(numberId: string) {
  return pendingPairingCodes.get(numberId)?.code ?? null;
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

  // ── Connection state (handles QR, connection open/close) ──
  sock.ev.on('connection.update', async ({ qr, connection, lastDisconnect, isOnline }) => {
    // Debug: Log all connection state changes
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[WhatsApp] connection.update - numberId: ${numberId}, qr: ${!!qr}, connection: ${connection}, isOnline: ${isOnline}`);
    }

    // QR Code event — cache it for REST polling
    if (qr) {
      pendingQRs.set(numberId, { qr, timestamp: Date.now() });
      try {
        io.to(`user:${userId}`).emit('qr_code', { numberId, qr });
        console.log(`[WhatsApp] QR emitido para number:${numberId} (user:${userId})`);
      } catch (err) {
        console.error('[WhatsApp] Falha ao emitir QR via Socket.IO:', err);
      }
      await prisma.whatsappNumber.update({
        where: { id: numberId },
        data:  { status: 'connecting' },
      }).catch(err => console.error(`[WhatsApp] Erro ao atualizar status para connecting: ${err}`));
    }

    // Connection open event
    if (connection === 'open') {
      const phone = sock.user?.id?.split(':')[0] || '';
      reconnectAttempts.delete(numberId);
      pendingQRs.delete(numberId);
      pendingPairingCodes.delete(numberId);
      await prisma.whatsappNumber.update({
        where: { id: numberId },
        data: { status: 'connected', connectedAt: new Date(), phoneNumber: phone },
      });
      io.to(`user:${userId}`).emit('wa_connected', { numberId, phone });
      console.log(`[WhatsApp] Conectado: ${numberId} (${phone})`);
    }

    // Connection close event
    if (connection === 'close') {
      const code = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const errorMessage = (lastDisconnect?.error as any)?.message || 'Unknown error';
      console.error(`[WhatsApp] Conexão fechada para ${numberId}: code=${code}, error=${errorMessage}`);

      const shouldReconnect = code !== DisconnectReason.loggedOut;

      sessions.delete(numberId);

      if (shouldReconnect) {
        const attempts = (reconnectAttempts.get(numberId) || 0) + 1;
        reconnectAttempts.set(numberId, attempts);
        const delayMs = Math.min(5000 * Math.pow(2, attempts - 1), MAX_RECONNECT_DELAY_MS);
        console.log(`[WhatsApp] Reconectando ${numberId} em ${delayMs / 1000}s (tentativa ${attempts})`);
        setTimeout(() => createWASession(numberId, userId, false), delayMs);
      } else {
        reconnectAttempts.delete(numberId);
        pendingQRs.delete(numberId);
        pendingPairingCodes.delete(numberId);
        await prisma.whatsappNumber.update({
          where: { id: numberId },
          data: { status: 'disconnected', sessionEncrypted: null },
        });
        io.to(`user:${userId}`).emit('wa_disconnected', { numberId });
      }
    }
  });

  // ── Socket errors (catch Noise protocol failures, network issues, etc.) ──
  sock.ws?.on('error', (err) => {
    const errorMsg = err?.message || String(err);
    console.error(`[WhatsApp] WebSocket error para ${numberId}:`, errorMsg);

    // If it's a Noise protocol error, log extra details for debugging
    if (errorMsg.includes('Connection Failure') || errorMsg.includes('decodeFrame')) {
      console.error(`[WhatsApp] ⚠️ Noise protocol frame decoding error detected. This may indicate:`);
      console.error(`  - WhatsApp server protocol version mismatch`);
      console.error(`  - Baileys library incompatibility`);
      console.error(`  - Network interference with encrypted frames`);
    }
  });

  sock.ev.on('connection.update', (update) => {
    // Check for error field in connection update (non-standard but sometimes emitted)
    if (update.error) {
      const errorMsg = update.error?.message || String(update.error);
      console.error(`[WhatsApp] Erro na connection.update para ${numberId}:`, errorMsg);
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
export async function createWASession(numberId: string, userId: string, fresh = false) {
  console.log(`[WhatsApp] Iniciando createWASession para ${numberId} (fresh=${fresh})`);

  // On a manual fresh connect, wipe stale session files so WA always sends a new QR
  if (fresh) {
    console.log(`[WhatsApp] Limpando session dir para ${numberId}`);
    clearSessionDir(numberId);
  }

  const sessionDir = path.join(process.cwd(), '.sessions', numberId);
  console.log(`[WhatsApp] Session dir: ${sessionDir}`);

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  console.log(`[WhatsApp] Auth state carregado para ${numberId}`);

  // Use a realistic browser identifier that WhatsApp recognizes
  // Falls back to generic browser if issues persist
  const browserConfig = process.env.WHATSAPP_BROWSER_ID || 'Chrome';

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: [
      'ZapScript',      // App name
      browserConfig,    // Browser type (Chrome/Firefox/Edge)
      '1.0.0',          // Version
    ],
    // Reduce initial sync overhead — helps with connection stability
    syncFullHistory: false,
    // Disable aggressive features that can cause timeout
    generateHighQualityLinkPreview: false,
    // Mark as mobile Web client (more compatible with current WhatsApp)
    mobile: false,
    // Use a simpler logger to avoid issues on Render
    logger: {
      trace: () => {},
      debug: () => {},
      info:  (...args) => console.log('[Baileys]', ...args),
      warn:  (...args) => console.warn('[Baileys]', ...args),
      error: (...args) => console.error('[Baileys]', ...args),
    } as any,
    // Extended timeout for initial handshake
    connectTimeoutMs: 60_000,
    // Retry failed connections with backoff
    retryRequestDelayMs: 100,
    // Don't disconnect on receiving empty messages
    shouldIgnoreJid: () => false,
  });
  console.log(`[WhatsApp] Socket criado para ${numberId}`);

  sessions.set(numberId, sock);

  // Attach all handlers (including QR handling)
  console.log(`[WhatsApp] Attachando handlers para ${numberId}`);
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

  // Clear ALL session files — stale state causes "Connection Closed"
  clearSessionDir(numberId);

  const sessionDir = path.join(process.cwd(), '.sessions', numberId);
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const cleanPhone = phoneNumber.replace(/\D/g, '');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: ['ZapScript', 'Chrome', '1.0.0'],
  });
  sessions.set(numberId, sock);

  await prisma.whatsappNumber.update({
    where: { id: numberId },
    data:  { status: 'connecting', phoneNumber: cleanPhone },
  });

  // ── Wait for Baileys to signal "ready" (QR event), THEN request the
  //    pairing code — avoids "Connection Closed" race condition ──────────
  return new Promise<string>((resolve, reject) => {
    let settled = false;

    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.ev.off('connection.update', onUpdate);
      fn();
    };

    const timer = setTimeout(() => {
      done(() => reject(
        new Error('Timeout: WhatsApp não respondeu em 45s. Isso pode indicar: (1) Conexão lenta - aguarde e tente novamente; (2) WhatsApp bloqueou sua conta - aguarde 1 hora; (3) Problema de rede no servidor.')
      ));
    }, 45_000);

    const onUpdate = ({ qr, connection }: { qr?: string; connection?: string }) => {
      if (qr) {
        // QR event = WA handshake complete; intercept to request pairing code instead
        done(() => {
          console.log(`[WhatsApp] Socket pronto para ${numberId}, iniciando requestPairingCode com: ${cleanPhone}`);
          sock.requestPairingCode(cleanPhone)
            .then(code => {
              console.log(`[WhatsApp] requestPairingCode sucesso para ${numberId}, código: ${code}`);
              // Cache pairing code for REST fallback
              pendingPairingCodes.set(numberId, { code, timestamp: Date.now() });
              // Full session handlers only after code is generated
              attachCommonHandlers(sock, { numberId, userId, saveCreds, state });
              io.to(`user:${userId}`).emit('pairing_code', { numberId, code });
              console.log(`[WhatsApp] Pairing code emitido para ${numberId}: ${code}`);
              resolve(code);
            })
            .catch(err => {
              console.error(`[WhatsApp] requestPairingCode FALHOU para ${numberId}:`, err);
              pendingPairingCodes.delete(numberId);
              prisma.whatsappNumber.update({
                where: { id: numberId },
                data: { status: 'disconnected' },
              }).catch(() => {});
              reject(new Error(
                `Não foi possível gerar o código: ${err.message}. ` +
                `Confirme que o número tem conta WhatsApp ativa e tente novamente.`
              ));
            });
        });
        return;
      }

      if (connection === 'open') {
        // Already authenticated with fresh creds — shouldn't happen, handle gracefully
        done(() => {
          console.log(`[WhatsApp] Erro: sessão ${numberId} já aberta durante pairing code attempt`);
          attachCommonHandlers(sock, { numberId, userId, saveCreds, state });
          reject(new Error('Sessão já autenticada. Use Desconectar antes de gerar um novo código.'));
        });
        return;
      }

      if (connection === 'close') {
        console.log(`[WhatsApp] Conexão fechada durante pairing code para ${numberId}`);
        done(() => {
          prisma.whatsappNumber.update({
            where: { id: numberId },
            data: { status: 'disconnected' },
          }).catch(() => {});
          reject(new Error(
            'WhatsApp recusou a conexão. ' +
            'Verifique: (1) número com DDI, ex: 5511987654321; ' +
            '(2) aguarde 2 minutos entre tentativas; ' +
            '(3) o número deve ter conta WhatsApp ativa.'
          ));
        });
      }
    };

    sock.ev.on('connection.update', onUpdate);
  });
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

  try {
    const creds = decrypt(sessionEncrypted);
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(credsPath, JSON.stringify(creds), 'utf8');
    console.log(`[WhatsApp] Sessão restaurada do banco para ${numberId}`);
  } catch (err) {
    console.error(`[WhatsApp] Falha ao restaurar sessão para ${numberId}:`, err);
    // Re-throw so caller can decide whether to continue
    throw err;
  }
}

// ── Clear all files in a session directory ───────────────
function clearSessionDir(numberId: string): void {
  const sessionDir = path.join(process.cwd(), '.sessions', numberId);
  if (!fs.existsSync(sessionDir)) return;
  try {
    for (const file of fs.readdirSync(sessionDir)) {
      fs.unlinkSync(path.join(sessionDir, file));
    }
    console.log(`[WhatsApp] Sessão limpa para ${numberId}`);
  } catch (err) {
    console.warn(`[WhatsApp] Não foi possível limpar sessão de ${numberId}:`, err);
  }
}

// ── Reconnect all sessions on startup ────────────────────
export async function reconnectAllSessions() {
  const numbers = await prisma.whatsappNumber.findMany({
    where:   { status: 'connected' },
    include: { user: true },
  });

  console.log(`[WhatsApp] Iniciando reconexão de ${numbers.length} número(s)`);

  for (const n of numbers) {
    try {
      // Always clear old session files first to avoid corruption issues
      clearSessionDir(n.id);

      if (n.sessionEncrypted) {
        try {
          restoreSessionToDisk(n.id, n.sessionEncrypted);
        } catch (restoreErr) {
          console.warn(`[WhatsApp] Falha ao restaurar sessão para ${n.phoneNumber}, criando nova:`, restoreErr);
          // Continue anyway — will trigger new QR code generation
        }
      }
      await createWASession(n.id, n.userId);
    } catch (err) {
      console.error(`[WhatsApp] Falha ao reconectar ${n.phoneNumber}:`, err);
      await prisma.whatsappNumber.update({
        where: { id: n.id },
        data:  { status: 'disconnected' },
      }).catch(() => {});
    }
  }

  console.log(`[WhatsApp] Reconexão de sessões concluída`);
}
