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

    // ── ConnectedCallback — WhatsApp conectado via QR ─────────────
    if (type === 'ConnectedCallback') {
      const connectedPhone = body.phone?.replace(/\D/g, '') || '';
      app.log.info(`[Z-API] ✅ Dispositivo conectado: ${connectedPhone} (instância ${instanceId})`);

      const number = await prisma.whatsappNumber.findFirst({
        where: { zapiInstanceId: instanceId },
      });

      if (number) {
        await prisma.whatsappNumber.update({
          where: { id: number.id },
          data: {
            status:      'connected',
            connectedAt: new Date(),
            ...(connectedPhone ? { phoneNumber: connectedPhone } : {}),
          },
        });
        app.log.info(`[Z-API] Número ${number.id} marcado como conectado`);
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

    // ── Encontrar usuário pelo instanceId da Z-API ─────────────────
    let whatsappNumber = await prisma.whatsappNumber.findFirst({
      where:   { zapiInstanceId: instanceId },
      include: { user: true },
    }).catch(() => null);

    // Fallback para ZAPI_DEFAULT_USER_ID (sandbox / instância única sem vínculo)
    if (!whatsappNumber && process.env.ZAPI_DEFAULT_USER_ID) {
      whatsappNumber = await prisma.whatsappNumber.findFirst({
        where:   { userId: process.env.ZAPI_DEFAULT_USER_ID },
        include: { user: true },
      });
    }

    if (!whatsappNumber) {
      app.log.warn(`[Z-API] Instância ${instanceId} não mapeada para nenhum usuário.`);
      return;
    }

    const userId = whatsappNumber.userId;

    // ── Áudio (mensagem de voz / PTT) ─────────────────────────────
    if (body.audio?.audioUrl) {
      const audioUrl     = body.audio.audioUrl;
      const durationHint = body.audio.seconds || 0;

      app.log.info(`[Z-API] 🔊 Áudio de ${senderName} (${durationHint}s)`);

      await transcriptionQueue.add(
        'transcribe-zapi',
        {
          userId,
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

    // ── Texto ─────────────────────────────────────────────────────
    if (body.text?.message) {
      app.log.info(`[Z-API] 💬 Texto de ${senderName}: "${body.text.message.substring(0, 60)}"`);
    }
  }
}
