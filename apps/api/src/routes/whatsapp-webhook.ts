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
    const mode = req.query.hub_mode as string;
    const token = req.query.hub_verify_token as string;
    const challenge = req.query.hub_challenge as string;

    console.log(`[WhatsApp Webhook] Verificação: mode=${mode}, token=${token ? '✓' : '✗'}`);

    if (mode === 'subscribe' && token === webhookToken) {
      console.log('[WhatsApp Webhook] ✅ Webhook verificado com sucesso');
      return challenge; // Meta espera receber o challenge de volta
    }

    console.error('[WhatsApp Webhook] ❌ Token de webhook inválido');
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
      console.error('[WhatsApp Webhook] Erro ao processar:', err);
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
        console.log(`[WhatsApp] Status de ${status.recipient_id}: ${status.status}`);
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

        console.log(`[WhatsApp] Mensagem de ${senderName} (${senderPhone}) - tipo: ${msg.type}`);

        // Encontrar usuário que possui este número
        const whatsappNumber = await prisma.whatsappNumber.findFirst({
          where: { phoneNumber: senderPhone },
          include: { user: true },
        });

        if (!whatsappNumber) {
          console.warn(`[WhatsApp] Número ${senderPhone} não registrado no sistema`);
          return;
        }

        const userId = whatsappNumber.userId;

        // ─────────────────────────────────
        // Processar áudio
        // ─────────────────────────────────
        if (msg.type === 'audio' && msg.audio) {
          const audio = msg.audio;
          console.log(`[WhatsApp] 🔊 Áudio recebido: ${audio.id}`);

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
          } catch (err) {
            console.error('[WhatsApp] Erro ao marcar áudio como lido:', err);
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
          console.log(`[WhatsApp] 💬 Texto: "${text}"`);

          // Responder com mensagem genérica (opcional)
          try {
            await whatsappAPI.sendMessage(
              senderPhone,
              'Olá! Envie um áudio para transcrição e resumo automático. 🎙️'
            );
          } catch (err) {
            console.error('[WhatsApp] Erro ao responder:', err);
          }

          // Marcar como lido
          try {
            await whatsappAPI.markAsRead(messageId);
          } catch (err) {
            console.error('[WhatsApp] Erro ao marcar texto como lido:', err);
          }
        }

        // ─────────────────────────────────
        // Processar imagem
        // ─────────────────────────────────
        if (msg.type === 'image' && msg.image) {
          const image = msg.image;
          console.log(`[WhatsApp] 🖼️ Imagem recebida: ${image.id}`);

          try {
            await whatsappAPI.markAsRead(messageId);
          } catch (err) {
            console.error('[WhatsApp] Erro ao marcar imagem como lida:', err);
          }
        }

        // ─────────────────────────────────
        // Processar documento
        // ─────────────────────────────────
        if (msg.type === 'document' && msg.document) {
          const document = msg.document;
          console.log(`[WhatsApp] 📄 Documento recebido: ${document.filename}`);

          try {
            await whatsappAPI.markAsRead(messageId);
          } catch (err) {
            console.error('[WhatsApp] Erro ao marcar documento como lido:', err);
          }
        }
      }
    } catch (error) {
      console.error('[WhatsApp Webhook] Erro ao processar webhook:', error);
    }
  }
}
