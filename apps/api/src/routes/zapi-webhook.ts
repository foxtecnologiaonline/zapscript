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

  // ── Processamento assíncrono ─────────────────────────────────────
  async function processZapiEvent(body: any) {
    if (!body) return;

    const type      = body.type;
    const fromMe    = body.fromMe;
    const phone     = body.phone;       // remetente (quem enviou o áudio)
    const senderName = body.senderName || body.chatName || phone;
    const instanceId = body.instanceId || process.env.ZAPI_INSTANCE_ID;
    const messageId  = body.messageId  || `zapi_${Date.now()}`;

    // Ignorar eventos que não são mensagens recebidas
    if (type !== 'ReceivedCallback') return;

    // Ignorar mensagens enviadas pelo próprio número (fromMe = true)
    if (fromMe) return;

    // Ignorar mensagens sem remetente
    if (!phone) return;

    const cleanPhone = phone.replace(/\D/g, '');

    app.log.info(`[Z-API] ${type} de ${senderName} (${cleanPhone})`);

    // ── Encontrar usuário pelo instanceId da Z-API ────────────────
    // Modo 1: buscar por instanceId salvo no número cadastrado
    let whatsappNumber = await prisma.whatsappNumber.findFirst({
      where:   { zapiInstanceId: instanceId },
      include: { user: true },
    }).catch(() => null);

    // Modo 2: fallback para ZAPI_DEFAULT_USER_ID (sandbox / instância única)
    if (!whatsappNumber && process.env.ZAPI_DEFAULT_USER_ID) {
      whatsappNumber = await prisma.whatsappNumber.findFirst({
        where:   { userId: process.env.ZAPI_DEFAULT_USER_ID },
        include: { user: true },
      });
    }

    if (!whatsappNumber) {
      app.log.warn(`[Z-API] Instância ${instanceId} não mapeada para nenhum usuário. Configure ZAPI_DEFAULT_USER_ID.`);
      return;
    }

    const userId = whatsappNumber.userId;

    // ── Áudio (mensagem de voz / PTT) ─────────────────────────────
    if (body.audio?.audioUrl) {
      const audioUrl   = body.audio.audioUrl;
      const durationHint = body.audio.seconds || 0;

      app.log.info(`[Z-API] 🔊 Áudio de ${senderName} (${durationHint}s): ${audioUrl}`);

      await transcriptionQueue.add(
        'transcribe-zapi',
        {
          userId,
          senderPhone:  cleanPhone,
          senderName,
          audioUrl,
          durationHint, // duração reportada pela Z-API (backup se Whisper falhar)
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

    // ── Texto (resposta automática) ────────────────────────────────
    if (body.text?.message && !body.audio) {
      app.log.info(`[Z-API] 💬 Texto de ${senderName}: "${body.text.message.substring(0, 60)}"`);
      // Resposta automática para texto pode ser adicionada aqui
    }
  }
}
