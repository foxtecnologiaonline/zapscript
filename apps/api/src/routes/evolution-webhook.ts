import { FastifyInstance } from 'fastify';
import { transcriptionQueue } from '../services/queue';
import { prisma } from '../lib/prisma';
import { notifyWelcome, notifyReconnected } from '../services/whatsapp-notify';
import { storeQr } from '../lib/qrStore';
import { io } from '../index';

export default async function evolutionWebhookRoutes(app: FastifyInstance) {

  // POST /webhook/evolution
  app.post('/', async (req: any, reply) => {

    // ── Segurança: validar secret se configurado ─────────────────────────
    // Secret pode vir como query param (?secret=...) ou header x-evolution-secret
    const secret         = (req.query as any)?.secret as string | undefined
                        || req.headers['x-evolution-secret'] as string | undefined;
    const expectedSecret = process.env.EVOLUTION_WEBHOOK_SECRET;
    if (expectedSecret && secret !== expectedSecret) {
      app.log.warn('[Evolution] Secret inválido — requisição rejeitada');
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    // Responder 200 imediatamente — Evolution reenvia se não receber resposta rápida
    reply.code(200).send({ received: true });

    // Processar em background
    processEvolutionEvent(req.body, app.log).catch(err =>
      app.log.error({ err: err.message }, '[Evolution] Erro ao processar evento')
    );
  });

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const AUDIO_TYPES = new Set([
    'audioMessage', 'pttMessage',  // PTT e áudio gravado
  ]);

  const AUDIO_MIME_PREFIXES = ['audio/'];
  const AUDIO_EXTENSIONS    = ['.mp3', '.m4a', '.ogg', '.opus', '.wav', '.aac', '.flac', '.amr'];

  function isAudioDocument(doc: any): boolean {
    if (!doc) return false;
    if (typeof doc.mimetype === 'string' && AUDIO_MIME_PREFIXES.some(p => doc.mimetype.startsWith(p))) return true;
    const fname = doc.fileName ?? doc.title ?? '';
    if (typeof fname === 'string') {
      const lower = fname.toLowerCase();
      if (AUDIO_EXTENSIONS.some(ext => lower.endsWith(ext))) return true;
    }
    return false;
  }

  // ── Processamento assíncrono ─────────────────────────────────────────────────
  async function processEvolutionEvent(body: any, log: any) {
    if (!body) { log.warn('[Evolution] Webhook com body vazio'); return; }

    const event        = body.event;          // 'connection.update', 'messages.upsert', 'qrcode.updated'
    const instName     = body.instance;       // nome da instância (ex: 'zs-abc123')
    const data         = body.data;

    log.info({ event, instance: instName }, '[Evolution] Evento recebido');

    if (!instName) { log.warn('[Evolution] Evento sem instance name'); return; }

    // ── Encontrar número no banco pelo nome da instância ─────────────────────
    // instanceName = 'zs-{numberId}' — armazenado em zapiInstanceId por compatibilidade
    async function findNumber(requireConnected = false) {
      const where: any = { zapiInstanceId: instName };
      if (requireConnected) where.status = 'connected';
      return (prisma as any).whatsappNumber.findFirst({
        where,
        include: { user: true },
        orderBy: { connectedAt: 'desc' },
      }).catch(() => null);
    }

    // ── connection.update ─────────────────────────────────────────────────────
    if (event === 'connection.update') {
      const state  = data?.state;        // 'open' | 'close' | 'connecting'
      const reason = data?.statusReason ?? '';

      log.info({ state, reason, instance: instName }, '[Evolution] connection.update');

      if (state === 'open') {
        // WhatsApp conectado — atualizar banco
        const number = await findNumber();
        if (number) {
          const wasConnected = number.status === 'connected';
          await prisma.whatsappNumber.update({
            where: { id: number.id },
            data: {
              status:      'connected',
              connectedAt: new Date(),
            },
          });
          log.info(`[Evolution] ✅ Número ${number.id} (user: ${number.userId}) conectado`);
          // Notificar frontend via Socket.IO → fecha modal de conexão automaticamente
          io.to(`user:${number.userId}`).emit('number:connected', { numberId: number.id });
          // Boas-vindas na primeira conexão; reconexão em conexões subsequentes
          if (!wasConnected) {
            notifyWelcome(number.id).catch(() => null);
          } else {
            notifyReconnected(number.id).catch(() => null);
          }
        } else {
          log.warn(`[Evolution] connection.update open: nenhum número encontrado para instância ${instName}`);
        }
        return;
      }

      if (state === 'close') {
        // Aguardar 8s antes de confirmar desconexão (evita falso positivo)
        log.info(`[Evolution] ⚠️ Desconexão recebida (${instName}) — aguardando 8s para confirmar...`);
        await new Promise(r => setTimeout(r, 8_000));

        // Verificar estado real antes de confirmar
        try {
          const checkRes = await fetch(
            `${process.env.EVOLUTION_API_URL?.replace(/\/$/, '')}/instance/connectionState/${instName}`,
            { headers: { 'apikey': process.env.EVOLUTION_API_KEY || '' }, signal: AbortSignal.timeout(5_000) }
          );
          if (checkRes.ok) {
            const checkData = await checkRes.json() as any;
            const realState = checkData?.instance?.state ?? checkData?.state;
            if (realState === 'open') {
              log.info(`[Evolution] ✅ Desconexão ignorada — Evolution confirmou que ainda está online (${instName})`);
              return;
            }
          }
        } catch { /* se verificação falhar, prosseguir com desconexão */ }

        log.warn(`[Evolution] ⚠️ Desconexão confirmada (${instName}) — atualizando banco`);
        await (prisma as any).whatsappNumber.updateMany({
          where: { zapiInstanceId: instName },
          data:  { status: 'disconnected' },
        });
        return;
      }

      // state === 'connecting' → apenas logar
      if (state === 'connecting') {
        log.info(`[Evolution] 🔄 Conectando... (${instName})`);
      }
      return;
    }

    // ── qrcode.updated ───────────────────────────────────────────────────────
    if (event === 'qrcode.updated') {
      const qrBase64 = data?.qrcode?.base64 ?? data?.base64 ?? data?.qr?.base64;
      log.info(`[Evolution] QR atualizado instância=${instName} temBase64=${!!qrBase64}`);
      if (qrBase64) {
        storeQr(instName, qrBase64);
        const num = await findNumber(false);
        if (num) {
          io.to(`user:${num.userId}`).emit('qr:updated', { numberId: num.id, qr: qrBase64 });
          log.info(`[Evolution] QR emitido via Socket.IO → user:${num.userId}`);
        }
      }
      return;
    }

    // ── messages.upsert ──────────────────────────────────────────────────────
    if (event === 'messages.upsert') {
      const msg         = data;
      const key         = msg?.key;
      const fromMe      = key?.fromMe;
      const remoteJid   = key?.remoteJid ?? '';  // '5511999999999@s.whatsapp.net'
      const messageType = msg?.messageType;       // 'audioMessage', 'pttMessage', 'documentMessage', 'textMessage'
      const messageId   = key?.id ?? `evo_${Date.now()}`;

      // Ignorar mensagens enviadas pelo próprio número ou de grupos
      if (fromMe) return;
      if (remoteJid.includes('@g.us')) return;  // grupo — ignorar

      // Extrair número limpo do remetente
      const senderPhone = remoteJid.replace('@s.whatsapp.net', '').replace('@c.us', '').replace(/\D/g, '');
      const senderName  = msg?.pushName || senderPhone;

      log.info({ messageType, senderPhone, instance: instName }, '[Evolution] messages.upsert');

      // ── Verificar se é áudio ───────────────────────────────────────────────
      let isAudio    = false;
      let durationHint = 0;

      if (AUDIO_TYPES.has(messageType)) {
        isAudio     = true;
        const audio = msg?.message?.audioMessage ?? msg?.message?.pttMessage;
        durationHint = audio?.seconds ?? 0;
      } else if (messageType === 'documentMessage' && isAudioDocument(msg?.message?.documentMessage)) {
        isAudio     = true;
      } else if (messageType === 'documentWithCaptionMessage') {
        const doc = msg?.message?.documentWithCaptionMessage?.message?.documentMessage;
        if (isAudioDocument(doc)) isAudio = true;
      }

      if (!isAudio) {
        if (messageType === 'conversation' || messageType === 'extendedTextMessage') {
          log.info(`[Evolution] 💬 Texto de ${senderName}: ignorado`);
        }
        return;
      }

      // ── Encontrar número e usuário pelo nome da instância ─────────────────
      let whatsappNumber = await findNumber(true);  // status=connected

      // Fallback: qualquer número com esta instância (status pode estar defasado)
      if (!whatsappNumber) {
        whatsappNumber = await findNumber(false);
        if (whatsappNumber) {
          log.warn(`[Evolution] ⚠️ Auto-corrigindo status para 'connected' (número ${whatsappNumber.id})`);
          await prisma.whatsappNumber.update({
            where: { id: whatsappNumber.id },
            data:  { status: 'connected', connectedAt: new Date() },
          }).catch(() => null);
          whatsappNumber.status = 'connected';
        }
      }

      if (!whatsappNumber) {
        log.warn(`[Evolution] ❌ Nenhum número encontrado para instância ${instName}`);
        return;
      }

      log.info(`[Evolution] 🔊 Áudio de ${senderName} (${durationHint}s) → enfileirando job`);

      await transcriptionQueue.add(
        'transcribe-evolution',
        {
          userId:        whatsappNumber.userId,
          numberId:      whatsappNumber.id,
          instanceName:  instName,              // para buscar o áudio via Evolution API
          senderPhone,
          senderName,
          messageKey:    key,                   // { remoteJid, fromMe, id }
          messageData:   msg,                   // objeto completo para getBase64FromMediaMessage
          durationHint,
          messageId,
          source: 'whatsapp-evolution',
        },
        {
          jobId:    messageId,
          attempts: 3,
          backoff:  { type: 'exponential', delay: 2000 },
        }
      );
      return;
    }

    // Eventos não tratados — apenas logar
    log.info(`[Evolution] Evento não tratado: ${event}`);
  }
}
