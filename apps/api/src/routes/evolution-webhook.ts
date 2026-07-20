import { FastifyInstance } from 'fastify';
import { transcriptionQueue, atendeQueue } from '../services/queue';
import { prisma } from '../lib/prisma';
import { notifyWelcome, notifyReconnected } from '../services/whatsapp-notify';
import { storeQr } from '../lib/qrStore';
import { getUserModules } from '../lib/moduleGate';
import { io } from '../index';


export default async function evolutionWebhookRoutes(app: FastifyInstance) {

  // POST /webhook/evolution
  app.post('/', async (req: any, reply) => {

    // ── Segurança: validar secret se configurado ─────────────────────────
    // Evolution API não suporta headers customizados em webhooks — envia o secret
    // como query param (?secret=...) na URL registrada via setWebhook/createInstance.
    // Aceitar também via header x-evolution-secret para flexibilidade futura.
    const secret         = (req.query as any)?.secret as string | undefined
                        || req.headers['x-evolution-secret'] as string | undefined;
    const expectedSecret = process.env.EVOLUTION_WEBHOOK_SECRET;
    if (expectedSecret) {
      // Timing-safe comparison para evitar timing attack (H2)
      const ok = secret
        ? (() => {
            try {
              const a = Buffer.from(secret);
              const b = Buffer.from(expectedSecret);
              return a.length === b.length && require('crypto').timingSafeEqual(a, b);
            } catch { return false; }
          })()
        : false;
      if (!ok) {
        app.log.warn('[Evolution] Secret inválido — requisição rejeitada');
        return reply.code(401).send({ error: 'Unauthorized' });
      }
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

  // Compara dois telefones com tolerância ao 9º dígito brasileiro: além da
  // igualdade exata, considera iguais quando os últimos 8 dígitos batem (o "core"
  // do número, sem DDD/9). Evita falso-negativo quando um lado tem 13 e o outro 12.
  function samePhone(a: string, b: string): boolean {
    const da = (a || '').replace(/\D/g, '');
    const db = (b || '').replace(/\D/g, '');
    if (!da || !db) return false;
    if (da === db) return true;
    return da.length >= 8 && db.length >= 8 && da.slice(-8) === db.slice(-8);
  }

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
    // JID do DONO da instância (o número conectado). Evolution envia em `sender`
    // no topo do body. É a fonte mais confiável para detectar self-chat, pois NÃO
    // depende de whatsappNumber.phoneNumber (que é opcional e costuma vir vazio).
    const ownerJid     = body.sender ?? data?.owner ?? null;
    const ownerDigits  = ownerJid
      ? String(ownerJid).replace('@s.whatsapp.net', '').replace('@c.us', '').replace(/\D/g, '')
      : '';

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
          const prevStatus = number.status; // 'pending' | 'connecting' | 'disconnected' | 'connected'

          // Só atualiza connectedAt se realmente mudou de estado
          const changed = prevStatus !== 'connected';
          await prisma.whatsappNumber.update({
            where: { id: number.id },
            data: {
              status:      'connected',
              connectedAt: changed ? new Date() : undefined,
            },
          });

          log.info(`[Evolution] ✅ Número ${number.id} (user: ${number.userId}) — prev:${prevStatus} → connected`);

          // Notificar frontend via Socket.IO → fecha modal de conexão automaticamente
          io.to(`user:${number.userId}`).emit('number:connected', { numberId: number.id });

          // Notificações: apenas quando muda de estado real
          // 'connected' → 'connected': evento redundante (keepalive/restart) — sem notificação
          // 'disconnected' → 'connected': reconexão real → notifyReconnected
          // qualquer outro → 'connected': primeira conexão → notifyWelcome
          if (prevStatus === 'disconnected') {
            notifyReconnected(number.id).catch(() => null);
          } else if (prevStatus !== 'connected') {
            notifyWelcome(number.id).catch(() => null);
          }
          // prevStatus === 'connected' → sem notificação (evento de keepalive/restart)
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

      // Ignorar grupos
      if (remoteJid.includes('@g.us')) return;

      // NÃO retornamos cedo em fromMe: áudios que o usuário encaminha para o
      // PRÓPRIO número (self-chat) devem ser convertidos (Feature 1). O filtro
      // de self-chat acontece abaixo, após resolver o número conectado, e só
      // áudio passa — respostas de texto do próprio bot caem no guard !isAudio
      // logo adiante, evitando loop.

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
        if ((messageType === 'conversation' || messageType === 'extendedTextMessage') && !fromMe) {
          const messageText: string | undefined =
            messageType === 'conversation'
              ? msg?.message?.conversation
              : msg?.message?.extendedTextMessage?.text;

          const number = messageText ? await findNumber(false) : null;
          const cfg = number
            ? await prisma.atendeConfig.findUnique({ where: { numberId: number.id } })
            : null;
          // Entitlement é a fonte da verdade (mesmo gate de requireModule('atende')) —
          // AtendeConfig.enabled sozinho não reflete cancelamento do módulo (billing.ts
          // só marca o Entitlement como 'canceled', nunca desliga o config).
          const hasAtende = (number && cfg?.enabled)
            ? (await getUserModules(number.userId)).includes('atende')
            : false;

          if (number && cfg?.enabled && hasAtende) {
            log.info(`[Evolution] 💬 Texto de ${senderName} → Atende habilitado, enfileirando resposta`);
            await atendeQueue.add(
              'atende-reply',
              {
                userId:       number.userId,
                numberId:     number.id,
                instanceName: instName,
                senderPhone,
                senderName,
                messageText,
                messageId,
              },
              { jobId: messageId, attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
            );
          } else if (number && cfg?.enabled && !hasAtende) {
            log.info(`[Evolution] 💬 Texto de ${senderName}: ignorado (módulo Atende não contratado/cancelado)`);
          } else {
            log.info(`[Evolution] 💬 Texto de ${senderName}: ignorado`);
          }
        }
        return;
      }

      // ── Metadados de encaminhamento/origem (Feature 1) ────────────────────
      // O contextInfo fica no nó do áudio/documento. `forwardingScore`>0 indica
      // encaminhamento; `participant` traz o remetente original APENAS quando a
      // mensagem é uma citação — num forward puro o WhatsApp não expõe a origem.
      const audioNode = msg?.message?.audioMessage
                      ?? msg?.message?.pttMessage
                      ?? msg?.message?.documentMessage
                      ?? msg?.message?.documentWithCaptionMessage?.message?.documentMessage;
      const ctx        = audioNode?.contextInfo ?? msg?.contextInfo;
      const forwarded  = (ctx?.forwardingScore ?? 0) > 0 || ctx?.isForwarded === true;
      const originJid  = ctx?.participant ?? null;
      const originPhone = originJid
        ? String(originJid).replace('@s.whatsapp.net', '').replace('@c.us', '').replace(/\D/g, '')
        : null;

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

      // ── Backfill do phoneNumber a partir do JID do dono ───────────────────
      // phoneNumber é opcional na criação e costuma vir vazio. Quando o webhook
      // expõe o dono da instância (ownerDigits), gravamos no banco — habilita o
      // modo privado e o auto-preenchimento do pairing code, e torna o self-chat
      // detectável mesmo sem `body.sender` em eventos futuros.
      const storedDigits = String(whatsappNumber.phoneNumber ?? '').replace(/\D/g, '');
      if (ownerDigits && ownerDigits !== 'pending' && storedDigits !== ownerDigits) {
        prisma.whatsappNumber.update({
          where: { id: whatsappNumber.id },
          data:  { phoneNumber: ownerDigits },
        }).then(() => log.info(`[Evolution] ☎️  phoneNumber sincronizado (${whatsappNumber!.id}) ← ${ownerDigits}`))
          .catch(() => null);
      }

      // ── Gate de self-chat para fromMe (Feature 1) ─────────────────────────
      // Áudios enviados pelo próprio usuário só são processados quando vão para
      // o PRÓPRIO número (conversa "Você"). Áudios que o usuário manda a
      // terceiros são ignorados (privacidade + custo).
      // Fonte primária = ownerDigits (JID do dono no webhook); fallback = phoneNumber
      // do banco. Comparação tolerante ao 9º dígito BR via samePhone().
      const isSelfNote = fromMe === true;
      if (isSelfNote) {
        const selfRef    = ownerDigits || storedDigits;
        const isSelfChat = !!selfRef && selfRef !== 'pending' && samePhone(senderPhone, selfRef);
        if (!isSelfChat) {
          log.info(`[Evolution] ↪️  Áudio fromMe para terceiro — ignorado (sender=${senderPhone}, dono=${selfRef || 'desconhecido'})`);
          return;
        }
        log.info(`[Evolution] 📝 Self-note: áudio encaminhado ao próprio número${forwarded ? ' (encaminhado)' : ''}${originPhone ? ` de ${originPhone}` : ''}`);
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
          isSelfNote,                           // Feature 1: áudio para o próprio número
          forwarded,                            // selo de encaminhamento
          originPhone,                          // remetente original (só via citação)
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
