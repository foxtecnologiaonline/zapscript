import { FastifyInstance } from 'fastify';
import { transcriptionQueue } from '../services/queue';
import { prisma } from '../lib/prisma';

/**
 * Webhook para receber eventos da Z-API (protocolo WhatsApp Web / dispositivo adicional).
 *
 * Z-API envia JSON via POST para cada evento da instância conectada.
 * Documentação: https://developer.z-api.io/webhooks/on-message-received
 */
export default async function zapiWebhookRoutes(app: FastifyInstance) {

  // POST /webhook/zapi
  app.post('/', async (req: any, reply) => {

    // ── Segurança: validar Client-Token se configurado ────────────
    const clientToken  = req.headers['client-token'] as string | undefined;
    const expectedToken = process.env.ZAPI_WEBHOOK_CLIENT_TOKEN;

    if (expectedToken && clientToken !== expectedToken) {
      app.log.warn('[Z-API] Client-Token inválido — requisição rejeitada');
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    // Responder imediatamente (Z-API reenvia se não receber 200 rápido)
    reply.code(200).send({ received: true });

    // Processar em background
    processZapiEvent(req.body).catch(err =>
      app.log.error({ err: err.message }, '[Z-API] Erro ao processar evento')
    );
  });

  // ── Extensões e MIME types de áudio aceitos ──────────────────────
  const AUDIO_EXTENSIONS = ['.mp3', '.m4a', '.ogg', '.opus', '.wav', '.aac', '.flac', '.wma', '.amr'];
  const AUDIO_MIME_PREFIX = 'audio/';

  function isAudioDocument(doc: any): boolean {
    if (!doc) return false;
    // Verificar pelo MIME type
    if (typeof doc.mimeType === 'string' && doc.mimeType.startsWith(AUDIO_MIME_PREFIX)) return true;
    // Verificar pela extensão do arquivo (cobre casos com mimeType genérico)
    if (typeof doc.fileName === 'string') {
      const lower = doc.fileName.toLowerCase();
      if (AUDIO_EXTENSIONS.some(ext => lower.endsWith(ext))) return true;
    }
    if (typeof doc.title === 'string') {
      const lower = doc.title.toLowerCase();
      if (AUDIO_EXTENSIONS.some(ext => lower.endsWith(ext))) return true;
    }
    return false;
  }

  // ── Processamento assíncrono ─────────────────────────────────────
  async function processZapiEvent(body: any) {
    if (!body) { app.log.warn('[Z-API] Webhook com body vazio'); return; }

    const type       = body.type;
    const instanceId = body.instanceId || process.env.ZAPI_INSTANCE_ID;

    // Log completo para diagnóstico (truncado para não poluir)
    app.log.info({
      type, instanceId, fromMe: body.fromMe, phone: body.phone,
      hasAudio:    !!body.audio?.audioUrl,
      hasDocument: !!body.document?.documentUrl,
      docMime:     body.document?.mimeType ?? null,
      forwarded:   !!body.forwarded,
      hasText:     !!body.text?.message,
    }, `[Z-API] Evento recebido`);

    // ── ConnectedCallback — WhatsApp conectado via QR ou código ───
    if (type === 'ConnectedCallback') {
      const connectedPhone = body.phone?.replace(/\D/g, '') || '';
      app.log.info(`[Z-API] ✅ Dispositivo conectado: ${connectedPhone} (instância ${instanceId})`);

      // ISOLAMENTO: prioridade para quem está 'connecting' (usuário que iniciou agora),
      // senão pega o 'connected' mais recente. Ordena por updatedAt desc para garantir
      // que o mais recente vence — evita retornar número de outro usuário.
      const number = await (prisma as any).whatsappNumber.findFirst({
        where: {
          zapiInstanceId: instanceId,
          status: { in: ['connecting', 'connected'] },
        },
        orderBy: { updatedAt: 'desc' }, // quem iniciou a conexão mais recentemente
      });

      if (number) {
        // Antes de conectar: desconectar TODOS os outros números desta instância
        const displaced = await (prisma as any).whatsappNumber.updateMany({
          where: { zapiInstanceId: instanceId, id: { not: number.id } },
          data:  { status: 'disconnected' },
        });
        if (displaced.count > 0) {
          app.log.warn(`[Z-API] ⚠️  ConnectedCallback: ${displaced.count} número(s) de outros usuários desconectados da instância ${instanceId}`);
        }

        // Agora confirmar conexão do número correto
        await prisma.whatsappNumber.update({
          where: { id: number.id },
          data: {
            status:      'connected',
            connectedAt: new Date(),
            ...(connectedPhone ? { phoneNumber: connectedPhone } : {}),
          },
        });
        app.log.info(`[Z-API] ✅ Número ${number.id} (user: ${number.userId}) marcado como conectado com telefone ${connectedPhone}`);
      } else {
        app.log.warn(`[Z-API] ConnectedCallback: nenhum número em 'connecting'/'connected' para instância ${instanceId}`);
      }
      return;
    }

    // ── DisconnectedCallback — WhatsApp desconectado ───────────────
    if (type === 'DisconnectedCallback') {
      app.log.info(`[Z-API] ⚠️ Dispositivo desconectado (instância ${instanceId})`);
      await prisma.whatsappNumber.updateMany({
        where: { zapiInstanceId: instanceId },
        data:  { status: 'disconnected' },
      });
      return;
    }

    // ── Somente ReceivedCallback a partir daqui ───────────────────
    if (type !== 'ReceivedCallback') return;

    const fromMe     = body.fromMe;
    const phone      = body.phone;
    const senderName = body.senderName || body.chatName || phone;
    const messageId  = body.messageId || `zapi_${Date.now()}`;

    // Ignorar mensagens enviadas pelo próprio número ou sem remetente
    if (fromMe || !phone) return;

    const cleanPhone = phone.replace(/\D/g, '');
    app.log.info(`[Z-API] ReceivedCallback de ${senderName} (${cleanPhone})`);

    // ── Encontrar número pelo instanceId + status 'connected' ─────
    // ISOLAMENTO CRÍTICO: filtrar por status: 'connected' garante que apenas
    // o número ativamente conectado receba as mensagens — nunca o de outro usuário.
    let whatsappNumber = await (prisma as any).whatsappNumber.findFirst({
      where:   { zapiInstanceId: instanceId, status: 'connected' },
      include: { user: true },
      orderBy: { connectedAt: 'desc' }, // mais recentemente conectado = dono atual
    }).catch(() => null);

    // Fallback: ZAPI_DEFAULT_USER_ID (apenas para instâncias sem vínculo explícito)
    if (!whatsappNumber && process.env.ZAPI_DEFAULT_USER_ID) {
      whatsappNumber = await prisma.whatsappNumber.findFirst({
        where:   { userId: process.env.ZAPI_DEFAULT_USER_ID, status: 'connected' },
        include: { user: true },
      }).catch(() => null);
    }

    if (!whatsappNumber) {
      app.log.warn(
        `[Z-API] ❌ Nenhum número CONECTADO encontrado para instância ${instanceId}. ` +
        `O número pode ter sido desconectado ou não pertence a esta instância.`
      );
      return;
    }

    app.log.info(`[Z-API] ✅ Número identificado: ${whatsappNumber.id} (user: ${whatsappNumber.userId}, phone: ${whatsappNumber.phoneNumber})`);

    // ── Resolver URL e duração do áudio (voz, encaminhado ou arquivo) ───────
    // Caso 1: PTT / voz gravada no momento — body.audio.audioUrl
    // Caso 2: Áudio encaminhado (PTT) — mesmo campo, body.forwarded = true
    // Caso 3: Arquivo de áudio encaminhado (mp3, m4a, ogg, wav) — body.document com mimeType audio/*
    let audioUrl:     string | null = null;
    let durationHint: number        = 0;
    let audioKind:    string        = '';

    if (body.audio?.audioUrl) {
      audioUrl     = body.audio.audioUrl;
      durationHint = body.audio.seconds || 0;
      audioKind    = body.forwarded ? 'voz encaminhada' : 'voz gravada';
    } else if (body.document?.documentUrl && isAudioDocument(body.document)) {
      audioUrl  = body.document.documentUrl;
      audioKind = `arquivo encaminhado (${body.document.mimeType ?? body.document.fileName})`;
    }

    if (audioUrl) {
      app.log.info(`[Z-API] 🔊 ${audioKind} de ${senderName} (${durationHint}s) → enfileirando job`);

      await transcriptionQueue.add(
        'transcribe-zapi',
        {
          userId:       whatsappNumber.userId,
          numberId:     whatsappNumber.id,
          senderPhone:  cleanPhone,
          senderName,
          audioUrl,
          durationHint,
          messageId,
          source: 'whatsapp-zapi',
        },
        {
          jobId:    messageId,
          attempts: 3,
          backoff:  { type: 'exponential', delay: 2000 },
        }
      );
      return;
    }

    // ── Texto (ignorado por ora) ──────────────────────────────────
    if (body.text?.message) {
      app.log.info(`[Z-API] 💬 Texto de ${senderName}: "${body.text.message.substring(0, 60)}"`);
    }
  }
}
