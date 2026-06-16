import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { intakeMessage } from '../services/support-intake';

/**
 * Webhook do WhatsApp Business (Meta Cloud API) dedicado ao AGENTE DE SUPORTE.
 * Separado de /webhook/whatsapp (que é do produto de transcrição): aqui o número
 * é o canal de atendimento ao cliente, não um número de usuário.
 *
 * Mensagens recebidas → intakeMessage → agente classifica e gera rascunho que
 * fica aguardando aprovação humana no painel (nada é respondido automaticamente).
 *
 * ENV:
 *   SUPPORT_WHATSAPP_WEBHOOK_TOKEN — token de verificação (GET hub.verify_token)
 *   SUPPORT_WHATSAPP_APP_SECRET    — app secret p/ validar x-hub-signature-256
 */
export default async function suporteWhatsappRoutes(app: FastifyInstance) {
  const webhookToken = process.env.SUPPORT_WHATSAPP_WEBHOOK_TOKEN
    || process.env.WHATSAPP_WEBHOOK_TOKEN
    || 'webhook-token-not-set';
  const appSecret = process.env.SUPPORT_WHATSAPP_APP_SECRET || process.env.WHATSAPP_APP_SECRET;

  // GET — verificação inicial do webhook (Meta)
  app.get('/', async (req, reply) => {
    const query = req.query as Record<string, any>;
    const mode = query.hub_mode || query['hub.mode'];
    const token = query.hub_verify_token || query['hub.verify_token'];
    const challenge = query.hub_challenge || query['hub.challenge'];
    if (mode === 'subscribe' && token === webhookToken) {
      reply.type('text/plain').code(200);
      return reply.send(challenge);
    }
    return reply.code(403).send({ error: 'Invalid webhook token' });
  });

  // POST — mensagens recebidas
  app.post('/', async (req, reply) => {
    if (appSecret) {
      const signature = (req.headers['x-hub-signature-256'] as string | undefined)?.replace('sha256=', '');
      const rawBody = (req as any).rawBody?.toString() || JSON.stringify(req.body);
      const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
      if (!signature || !safeEqualHex(expected, signature)) {
        app.log.warn('[Suporte WhatsApp] Assinatura inválida — rejeitado');
        return reply.code(401).send({ error: 'Invalid signature' });
      }
    }

    const body = req.body as any;
    reply.code(200).send({ success: true });

    processSupportWebhook(body, app.log).catch(err =>
      app.log.error({ err: err.message }, '[Suporte WhatsApp] Erro ao processar')
    );
  });

  async function processSupportWebhook(body: any, log: any) {
    const value = body?.entry?.[0]?.changes?.[0]?.value;
    if (!value) return;

    const messages = value.messages || [];
    const contacts = value.contacts || [];

    for (const msg of messages) {
      const senderPhone = msg.from;
      const messageId = msg.id;
      const contact = contacts.find((c: any) => c.wa_id === senderPhone);
      const senderName = contact?.profile?.name || senderPhone;

      let texto: string | null = null;
      if (msg.type === 'text' && msg.text) {
        texto = msg.text.body;
      } else if (msg.type === 'audio') {
        // MVP: áudio é registrado e escalado. Transcrição via Whisper é o próximo passo.
        texto = '[Cliente enviou um áudio no WhatsApp — transcrição pendente]';
      } else if (msg.type === 'image') {
        texto = `[Cliente enviou uma imagem]${msg.image?.caption ? ` Legenda: ${msg.image.caption}` : ''}`;
      } else if (msg.type === 'document') {
        texto = `[Cliente enviou um documento: ${msg.document?.filename || 'arquivo'}]`;
      }

      if (!texto) {
        log.info(`[Suporte WhatsApp] Tipo não suportado: ${msg.type} — ignorado`);
        continue;
      }

      // Thread = canal+remetente (agrupa a conversa do cliente)
      const threadId = `whatsapp:${senderPhone}`;
      await intakeMessage({
        canal: 'whatsapp',
        mensagem: texto,
        clienteNome: senderName,
        clienteWhatsapp: senderPhone,
        canalExternoId: messageId,
        threadId,
      }, log);
    }
  }
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}
