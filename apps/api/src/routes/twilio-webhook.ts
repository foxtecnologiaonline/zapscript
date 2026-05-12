import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { transcriptionQueue } from '../services/queue';
import { prisma } from '../lib/prisma';

/**
 * Valida a assinatura do Twilio (HMAC-SHA1 sobre URL + params ordenados).
 * https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
function validateTwilioSignature(
  authToken:  string,
  url:        string,
  params:     Record<string, string>,
  signature:  string
): boolean {
  const sortedKeys = Object.keys(params).sort();
  const str        = url + sortedKeys.map(k => k + params[k]).join('');
  const expected   = crypto.createHmac('sha1', authToken).update(str).digest('base64');
  return expected === signature;
}

export default async function twilioWebhookRoutes(app: FastifyInstance) {

  // POST /webhook/twilio — recebe mensagens WhatsApp via Twilio
  // Twilio envia application/x-www-form-urlencoded (não JSON)
  app.post('/', async (req: any, reply) => {

    // ── Validar assinatura Twilio ────────────────────────────────
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (authToken) {
      const signature = req.headers['x-twilio-signature'] as string | undefined;
      const url       = `${process.env.APP_URL || 'https://zapscript.me'}/webhook/twilio`;
      const params    = (req.body || {}) as Record<string, string>;

      if (!signature || !validateTwilioSignature(authToken, url, params, signature)) {
        app.log.warn('[Twilio] Assinatura inválida — requisição rejeitada');
        return reply.type('text/xml').code(403).send('<Response></Response>');
      }
    }

    const body       = (req.body || {}) as Record<string, string>;
    const rawFrom    = body.From || '';   // ex: "whatsapp:+5534999990000"
    const rawTo      = body.To   || '';   // ex: "whatsapp:+14155238886" (sandbox)
    const numMedia   = parseInt(body.NumMedia || '0', 10);
    const messageId  = body.MessageSid || `twilio_${Date.now()}`;
    const senderName = body.ProfileName || rawFrom.replace('whatsapp:', '');

    const senderPhone = rawFrom.replace('whatsapp:', '').replace(/\D/g, '');
    const toPhone     = rawTo.replace('whatsapp:', '').replace(/\D/g, '');

    app.log.info(`[Twilio] Mensagem de ${senderPhone} para ${toPhone} — ${numMedia} mídia(s)`);

    // Responder imediatamente (Twilio exige resposta em < 15s)
    reply.type('text/xml').code(200).send('<Response></Response>');

    // Processar em background
    processTwilioMessage({ senderPhone, toPhone, senderName, numMedia, messageId, body })
      .catch(err => app.log.error({ err: err.message }, '[Twilio] Erro ao processar mensagem'));
  });

  // ── Processamento assíncrono ─────────────────────────────────────
  async function processTwilioMessage(ctx: {
    senderPhone: string;
    toPhone:     string;
    senderName:  string;
    numMedia:    number;
    messageId:   string;
    body:        Record<string, string>;
  }) {
    const { senderPhone, toPhone, senderName, numMedia, messageId, body } = ctx;

    // 1. Rota por número de destino (modo BSP com número dedicado por usuário)
    let whatsappNumber = await prisma.whatsappNumber.findFirst({
      where:   { phoneNumber: toPhone },
      include: { user: true },
    });

    // 2. Fallback: sandbox — rotear para usuário padrão de testes
    if (!whatsappNumber && process.env.TWILIO_DEFAULT_USER_ID) {
      whatsappNumber = await prisma.whatsappNumber.findFirst({
        where:   { userId: process.env.TWILIO_DEFAULT_USER_ID },
        include: { user: true },
      });
    }

    if (!whatsappNumber) {
      app.log.warn(`[Twilio] Nenhum usuário mapeado para o número ${toPhone}. Configure TWILIO_DEFAULT_USER_ID para sandbox.`);
      return;
    }

    const userId = whatsappNumber.userId;

    // ── Áudio ──────────────────────────────────────────────────────
    if (numMedia > 0 && body.MediaContentType0?.startsWith('audio/')) {
      const mediaUrl = body.MediaUrl0;
      app.log.info(`[Twilio] 🔊 Áudio recebido: ${mediaUrl}`);

      await transcriptionQueue.add(
        'transcribe-twilio',
        {
          userId,
          senderPhone,
          senderName,
          mediaUrl,
          twilioFrom: toPhone,  // número Twilio que recebeu (usado para responder)
          messageId,
          source: 'whatsapp-twilio',
        },
        {
          jobId:    messageId,
          attempts: 3,
          backoff:  { type: 'exponential', delay: 2000 },
        }
      );
    }

    // ── Texto ──────────────────────────────────────────────────────
    if (body.Body && numMedia === 0) {
      app.log.info(`[Twilio] 💬 Texto de ${senderName}: "${body.Body.substring(0, 60)}"`);
      // Resposta automática pode ser adicionada via Twilio API se necessário
    }
  }
}
