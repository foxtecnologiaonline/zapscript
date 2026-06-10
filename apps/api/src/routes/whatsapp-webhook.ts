import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { whatsappAPI } from '../services/whatsapp-official';
import { transcriptionQueue } from '../services/queue';
import { prisma } from '../lib/prisma';
import { io } from '../index';

/**
 * Webhook para receber mensagens do WhatsApp via Meta API
 *
 * Meta envia:
 * 1. GET com hub_mode=subscribe (verificação inicial)
 * 2. POST com mensagens quando chegam
 */
export default async function whatsappWebhookRoutes(app: FastifyInstance) {
  const webhookToken = process.env.WHATSAPP_WEBHOOK_TOKEN || 'webhook-token-not-set';
  const appSecret    = process.env.WHATSAPP_APP_SECRET;

  /**
   * GET /webhook - Verificação inicial do webhook
   * Meta chama isso para confirmar que você é o dono do webhook
   */
  app.get('/', async (req, reply) => {
    try {
      const query = req.query as Record<string, any>;

      // Meta pode enviar com ponto (hub.verify_token) ou underscore (hub_verify_token)
      const mode      = query.hub_mode      || query['hub.mode']         as string;
      const token     = query.hub_verify_token || query['hub.verify_token'] as string;
      const challenge = query.hub_challenge  || query['hub.challenge']   as string;

      app.log.info(`[WhatsApp Webhook GET] mode=${mode}, token_match=${token === webhookToken}`);

      if (mode === 'subscribe' && token === webhookToken) {
        app.log.info('[WhatsApp Webhook] ✅ Validação bem-sucedida');
        reply.type('text/plain').code(200);
        return reply.send(challenge);
      }

      app.log.warn('[WhatsApp Webhook] ❌ Token de verificação inválido');
      return reply.code(403).send({ error: 'Invalid webhook token' });
    } catch (error: any) {
      app.log.error({ err: error.message }, '[WhatsApp Webhook GET] Erro inesperado');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /webhook - Receber mensagens
   * Valida assinatura x-hub-signature-256 da Meta antes de processar
   */
  app.post('/', async (req, reply) => {
    // Validar assinatura HMAC-SHA256 se WHATSAPP_APP_SECRET configurado
    if (appSecret) {
      const signature = (req.headers['x-hub-signature-256'] as string | undefined)?.replace('sha256=', '');
      if (!signature) {
        app.log.warn('[WhatsApp Webhook] Requisição sem assinatura x-hub-signature-256 rejeitada');
        return reply.code(401).send({ error: 'Missing signature' });
      }
      const rawBody = (req as any).rawBody?.toString() || JSON.stringify(req.body);
      const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
      if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
        app.log.warn('[WhatsApp Webhook] Assinatura inválida — possível payload forjado');
        return reply.code(401).send({ error: 'Invalid signature' });
      }
    }

    const body = req.body as any;

    // Responder rapidamente para Meta (ela quer 200 OK em menos de 30s)
    reply.code(200).send({ success: true });

    // Processar em background
    processWebhookMessage(body).catch((err) => {
      app.log.error({ err: err.message }, '[WhatsApp Webhook] Erro ao processar');
    });
  });

  /**
   * Processar mensagem recebida do webhook
   */
  async function processWebhookMessage(body: any) {
    try {
      // Estrutura do webhook da Meta:
      // body.entry[0].changes[0].value.messages
      const entry = body.entry?.[0];
      if (!entry) return;

      const change = entry.changes?.[0];
      if (!change) return;

      const value = change.value;
      const messages   = value.messages  || [];
      const contacts   = value.contacts  || [];
      const statuses   = value.statuses  || [];
      // Identificadores da conta Business que recebeu as mensagens (metadata do webhook Meta).
      // phone_number_id é a chave estável de roteamento multi-tenant; display_phone_number é fallback legado.
      const metaPhoneId   = value.metadata?.phone_number_id as string | undefined;
      const businessPhone = value.metadata?.display_phone_number as string | undefined;

      // ─────────────────────────────────
      // Processar confirmação de entrega
      // ─────────────────────────────────
      for (const status of statuses) {
        app.log.info(`[WhatsApp] Status de ${status.recipient_id}: ${status.status}`);
      }

      // ─────────────────────────────────
      // Roteamento: encontrar o número/usuário pelo phone_number_id (Meta) ou
      // pelo display_phone_number (fallback). Constante para todas as mensagens deste change.
      // ─────────────────────────────────
      let whatsappNumber = null as Awaited<ReturnType<typeof prisma.whatsappNumber.findFirst>> | null;
      if (metaPhoneId) {
        whatsappNumber = await prisma.whatsappNumber.findFirst({
          where: { metaPhoneId } as any,
        });
      }
      if (!whatsappNumber && businessPhone) {
        const cleanBusiness = businessPhone.replace(/\D/g, '');
        whatsappNumber = await prisma.whatsappNumber.findFirst({
          where: { phoneNumber: cleanBusiness },
        });
      }
      if (!whatsappNumber) {
        app.log.warn(`[WhatsApp] Conta Business não registrada (phone_number_id=${metaPhoneId}, display=${businessPhone})`);
        return;
      }
      const userId   = whatsappNumber.userId;
      const numberId = whatsappNumber.id;

      // ─────────────────────────────────
      // Processar mensagens recebidas
      // ─────────────────────────────────
      for (const msg of messages) {
        const senderPhone = msg.from;
        const messageId   = msg.id;

        const contact    = contacts.find((c: any) => c.wa_id === senderPhone);
        const senderName = contact?.profile?.name || senderPhone;

        app.log.info(`[WhatsApp] Mensagem de ${senderName} (${senderPhone}) - tipo: ${msg.type}`);

        // ─────────────────────────────────
        // Processar áudio
        // ─────────────────────────────────
        if (msg.type === 'audio' && msg.audio) {
          const audio = msg.audio;
          app.log.info(`[WhatsApp] 🔊 Áudio recebido: ${audio.id}`);

          // Adicionar à fila de transcrição
          await transcriptionQueue.add(
            'transcribe-official',
            {
              userId,
              numberId,
              senderPhone,
              senderName,
              mediaId: audio.id,
              messageId,
              contactPhone: senderPhone,
            },
            {
              jobId: messageId,
              attempts: 3,
              backoff: { type: 'exponential', delay: 2000 },
            }
          );

          // Marcar como lido
          try {
            await whatsappAPI.markAsRead(messageId);
          } catch (err: any) {
            app.log.error({ err: err.message }, '[WhatsApp] Erro ao marcar áudio como lido');
          }

          // Notificar frontend via Socket.IO
          io.to(`user:${userId}`).emit('audio_received', {
            from: senderName,
            phone: senderPhone,
            messageId,
            status: 'processing',
          });
        }

        // ─────────────────────────────────
        // Processar texto
        // ─────────────────────────────────
        if (msg.type === 'text' && msg.text) {
          const text = msg.text.body;
          app.log.info(`[WhatsApp] 💬 Texto de ${senderName}: "${text.substring(0, 50)}"`);

          // Resposta automática apenas se WHATSAPP_AUTO_REPLY=true
          if (process.env.WHATSAPP_AUTO_REPLY === 'true') {
            try {
              await whatsappAPI.sendMessage(
                senderPhone,
                'Olá! Envie um áudio para transcrição e resumo automático. 🎙️'
              );
            } catch (err: any) {
              app.log.error({ err: err.message }, '[WhatsApp] Erro ao responder texto');
            }
          }

          // Marcar como lido
          try {
            await whatsappAPI.markAsRead(messageId);
          } catch (err: any) {
            app.log.error({ err: err.message }, '[WhatsApp] Erro ao marcar texto como lido');
          }
        }

        // ─────────────────────────────────
        // Processar imagem
        // ─────────────────────────────────
        if (msg.type === 'image' && msg.image) {
          const image = msg.image;
          app.log.info(`[WhatsApp] 🖼️ Imagem recebida: ${image.id}`);

          try {
            await whatsappAPI.markAsRead(messageId);
          } catch (err: any) {
            app.log.error({ err: err.message }, '[WhatsApp] Erro ao marcar imagem como lida');
          }
        }

        // ─────────────────────────────────
        // Processar documento
        // ─────────────────────────────────
        if (msg.type === 'document' && msg.document) {
          const document = msg.document;
          app.log.info(`[WhatsApp] 📄 Documento recebido: ${document.filename}`);

          try {
            await whatsappAPI.markAsRead(messageId);
          } catch (err: any) {
            app.log.error({ err: err.message }, '[WhatsApp] Erro ao marcar documento como lido');
          }
        }
      }
    } catch (error: any) {
      app.log.error({ err: error.message }, '[WhatsApp Webhook] Erro ao processar webhook');
    }
  }
}
