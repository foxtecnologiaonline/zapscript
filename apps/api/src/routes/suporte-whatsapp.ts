import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { intakeMessage } from '../services/support-intake';

/**
 * Webhook do WhatsApp dedicado ao AGENTE DE SUPORTE — via EVOLUTION API (QR).
 *
 * Separado de /webhook/evolution (que é do produto de transcrição): aqui o número
 * é o canal de ATENDIMENTO ao cliente (uma instância Evolution dedicada, conectada
 * por QR Code), não um número de usuário.
 *
 * Mensagens recebidas → intakeMessage → o agente classifica e gera um rascunho que
 * fica aguardando aprovação humana no painel (nada é respondido automaticamente).
 *
 * Configuração no Evolution (instância de suporte):
 *   Webhook URL: https://SEU_DOMINIO/webhook/suporte/whatsapp?secret=SEGREDO
 *   Eventos: MESSAGES_UPSERT
 *
 * ENV:
 *   SUPPORT_EVOLUTION_INSTANCE        — nome da instância Evolution de suporte (ex: 'zs-suporte')
 *   SUPPORT_EVOLUTION_WEBHOOK_SECRET  — segredo do webhook (?secret=) — fallback p/ EVOLUTION_WEBHOOK_SECRET
 */
export default async function suporteWhatsappRoutes(app: FastifyInstance) {
  const expectedSecret = process.env.SUPPORT_EVOLUTION_WEBHOOK_SECRET
    || process.env.EVOLUTION_WEBHOOK_SECRET;

  // POST — eventos do Evolution (a instância de suporte chama esta URL)
  app.post('/', async (req: any, reply) => {
    // ── Segurança: validar secret se configurado ────────────────────────────
    // Evolution envia o segredo como query param (?secret=...). Aceitar também via
    // header x-evolution-secret para flexibilidade.
    if (expectedSecret) {
      const secret = (req.query as any)?.secret as string | undefined
        || (req.headers['x-evolution-secret'] as string | undefined);
      const ok = secret ? safeCompare(secret, expectedSecret) : false;
      if (!ok) {
        app.log.warn('[Suporte WhatsApp] Secret inválido — requisição rejeitada');
        return reply.code(401).send({ error: 'Unauthorized' });
      }
    }

    // Responder 200 imediatamente — Evolution reenvia se não receber resposta rápida
    reply.code(200).send({ received: true });

    processSupportEvent(req.body, app.log).catch(err =>
      app.log.error({ err: err.message }, '[Suporte WhatsApp] Erro ao processar evento')
    );
  });

  async function processSupportEvent(body: any, log: any) {
    if (!body) return;

    const event    = body.event;       // esperado: 'messages.upsert'
    const instName = body.instance;
    if (event !== 'messages.upsert') {
      // O canal de suporte só reage a mensagens recebidas. Demais eventos
      // (connection.update, qrcode.updated) são tratados no fluxo de conexão.
      return;
    }

    const msg         = body.data;
    const key         = msg?.key;
    const fromMe      = key?.fromMe;
    const remoteJid   = key?.remoteJid ?? '';
    const messageType = msg?.messageType;
    const messageId   = key?.id ?? `evo_${Date.now()}`;

    // Ignorar grupos e mensagens enviadas pelo próprio número de suporte
    if (remoteJid.includes('@g.us')) return;
    if (fromMe === true) return;

    const senderPhone = remoteJid.replace('@s.whatsapp.net', '').replace('@c.us', '').replace(/\D/g, '');
    const senderName  = msg?.pushName || senderPhone;
    if (!senderPhone) return;

    // ── Extrair o texto da mensagem ──────────────────────────────────────────
    let texto: string | null = null;
    if (messageType === 'conversation') {
      texto = msg?.message?.conversation ?? null;
    } else if (messageType === 'extendedTextMessage') {
      texto = msg?.message?.extendedTextMessage?.text ?? null;
    } else if (messageType === 'audioMessage' || messageType === 'pttMessage') {
      // MVP: áudio é registrado e escalado. Transcrição via Whisper = próximo passo.
      texto = '[Cliente enviou um áudio no WhatsApp — transcrição pendente]';
    } else if (messageType === 'imageMessage') {
      const cap = msg?.message?.imageMessage?.caption;
      texto = `[Cliente enviou uma imagem]${cap ? ` Legenda: ${cap}` : ''}`;
    } else if (messageType === 'documentMessage') {
      const fn = msg?.message?.documentMessage?.fileName;
      texto = `[Cliente enviou um documento: ${fn || 'arquivo'}]`;
    }

    if (!texto || !texto.trim()) {
      log.info(`[Suporte WhatsApp] Tipo não suportado/sem texto: ${messageType} — ignorado`);
      return;
    }

    // Thread = canal+remetente (agrupa a conversa do cliente)
    const threadId = `whatsapp:${senderPhone}`;
    log.info({ instance: instName, senderPhone, messageType }, '[Suporte WhatsApp] Mensagem recebida → intake');

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

function safeCompare(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}
