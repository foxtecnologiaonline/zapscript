import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { whatsappAPI, WhatsAppIncomingMessage } from '../services/whatsapp-official';
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

  /**
   * GET /webhook - Verificação inicial do webhook
   * Meta chama isso para confirmar que você é o dono do webhook
   */
  app.get('/webhook', async (req, reply) => {
    const query = req.query as Record<string, any>;
    const mode = query.hub_mode as string;
    const token = query.hub_verify_token as string;
    const challenge = query.hub_challenge as string;

    app.log.info(`[WhatsApp Webhook] Verificação: mode=${mode}, token=${token ? '✓' : '✗'}`);

    if (mode === 'subscribe' && token === webhookToken) {
      app.log.info('[WhatsApp Webhook] ✅ Webhook verificado com sucesso');
      return challenge; // Meta espera receber o challenge de volta
    }

    app.log.error('[WhatsApp Webhook] ❌ Token de webhook inválido');
    reply.code(403).send({ error: 'Invalid webhook token' });
  });

  /**
   * POST /webhook - Receber mensagens
   */
  app.post('/webhook', async (req, reply) => {
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
      const messages = value.messages || [];
      const contacts = value.contacts || [];
      const statuses = value.statuses || [];

      // ─────────────────────────────────
      // Processar confirmação de entrega
      // ─────────────────────────────────
      for (const status of statuses) {
        app.log.info(`[WhatsApp] Status de ${status.recipient_id}: ${status.status}`);
        // Aqui você pode atualizar logs de delivery
      }

      // ─────────────────────────────────
      // Processar mensagens recebidas
      // ─────────────────────────────────
      for (const msg of messages) {
        const senderPhone = msg.from;
        const messageId = msg.id;
        const timestamp = msg.timestamp;

        const contact = contacts.find((c: any) => c.wa_id === senderPhone);
        const senderName = contact?.profile?.name || senderPhone;

        app.log.info(`[WhatsApp] Mensagem de ${senderName} (${senderPhone}) - tipo: ${msg.type}`);

        // Encontrar usuário que possui este número
        const whatsappNumber = await prisma.whatsappNumber.findFirst({
          where: { phoneNumber: senderPhone },
          include: { user: true },
        });

        if (!whatsappNumber) {
          app.log.warn(`[WhatsApp] Número ${senderPhone} não registrado no sistema`);
          return;
        }

        const userId = whatsappNumber.userId;

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

          // Responder com mensagem genérica (opcional)
          try {
            await whatsappAPI.sendMessage(
              senderPhone,
              'Olá! Envie um áudio para transcrição e resumo automático. 🎙️'
            );
          } catch (err: any) {
            app.log.error({ err: err.message }, '[WhatsApp] Erro ao responder texto');
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
