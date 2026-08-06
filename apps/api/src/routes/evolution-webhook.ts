import { FastifyInstance } from 'fastify';
import { transcriptionQueue, atendeQueue } from '../services/queue';
import { prisma } from '../lib/prisma';
import { notifyWelcome, notifyReconnected, notifyCobrancaPossiblePayment } from '../services/whatsapp-notify';
import { handleOfficialNumberText, closeLeadOnConnected } from '../services/onboarding-whatsapp';
import { storeQr } from '../lib/qrStore';
import { sendText } from '../services/evolution';
import { getUserModules } from '../lib/moduleGate';
import { isAtendeOwnerCommand, handleAtendeOwnerCommand } from '../services/atende-commands';
import { io } from '../index';

// Módulo Cobrança (#6): heurística leve p/ detectar cliente avisando que já
// pagou — sem LLM aqui (o webhook precisa responder rápido); a mensagem
// original vai junto na notificação ao dono, que confirma com contexto.
const COBRANCA_PAGAMENTO_KEYWORDS = /pague?i|\bpago\b|\bpaga\b|quitei|quitad[oa]|comprovante|fiz\s+o\s+pix|mandei\s+o\s+pix|enviei\s+o\s+pix|efetuei|transferi|dep[oó]sit/i;


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

  // ── Consulta administrativa por texto: saques pendentes (Programa de Afiliados) ──
  // Permite ao admin perguntar algo como "quantos saques pendentes?" pelo WhatsApp
  // e receber a resposta na hora — reaproveita o webhook do produto (sem instância
  // dedicada). Só responde quando o texto bate no padrão E o remetente é o telefone
  // cadastrado em AdminAlertConfig["alertPhone"] (mesmo config dos alertas de infra);
  // qualquer outro texto/remetente segue ignorado normalmente. "Saques pendentes" é
  // definido pragmaticamente como afiliados com payoutRequestedAt setado e ao menos
  // uma comissão 'pending' — não existe modelo dedicado de solicitação de saque.
  const PAYOUT_QUERY_RE = /saque/i;

  async function handleAdminPayoutQuery(instanceNameStr: string, senderPhone: string, text: string): Promise<boolean> {
    if (!PAYOUT_QUERY_RE.test(text)) return false;

    const cfgRow: any = await (prisma as any).adminAlertConfig
      .findUnique({ where: { key: 'alertPhone' } })
      .catch(() => null);
    const alertPhone = cfgRow?.value && cfgRow.value !== 'null' ? String(cfgRow.value) : null;
    if (!alertPhone || !samePhone(senderPhone, alertPhone)) return false;

    const payoutAffiliates: any[] = await (prisma as any).affiliate.findMany({
      where: {
        payoutRequestedAt: { not: null },
        commissions: { some: { status: 'pending' } },
      },
      select: {
        id:          true,
        user:        { select: { name: true, email: true } },
        commissions: { where: { status: 'pending' }, select: { commissionAmount: true } },
      },
    }).catch(() => []);

    const fmtBRL   = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const amountOf = (a: any) => a.commissions.reduce((s: number, c: any) => s + c.commissionAmount, 0);
    const count    = payoutAffiliates.length;
    const total    = payoutAffiliates.reduce((sum: number, a: any) => sum + amountOf(a), 0);

    let reply: string;
    if (count === 0) {
      reply = '💸 *Saques pendentes*\n\nNenhum saque pendente no momento.';
    } else {
      const lines = payoutAffiliates
        .slice(0, 10)
        .map((a: any) => `• ${a.user?.name || a.user?.email || a.id} — ${fmtBRL(amountOf(a))}`);
      const APP_URL = process.env.APP_URL || 'https://zapscript.me';
      reply = `💸 *Saques pendentes*\n\n${count} afiliado(s) — total ${fmtBRL(total)}:\n\n${lines.join('\n')}`
            + (count > 10 ? `\n\n…e mais ${count - 10}.` : '')
            + `\n\nPainel: ${APP_URL}/g5r8t2`;
    }

    await sendText(instanceNameStr, senderPhone, reply);
    return true;
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
          // qualquer outro → 'connected': número novo, readicionado ou reconectado — sempre
          // manda o áudio de boas-vindas; se for reconexão de fato, manda também o texto
          // extra explicando que as conversões foram retomadas.
          if (prevStatus !== 'connected') {
            notifyWelcome(number.id).catch(() => null);
            if (prevStatus === 'disconnected') {
              notifyReconnected(number.id).catch(() => null);
            }
          }
          // prevStatus === 'connected' → sem notificação (evento de keepalive/restart)

          // Fecha o onboarding conversacional via WhatsApp (site ou número oficial),
          // se este número tiver um lead em andamento — idempotente, no-op se não houver.
          closeLeadOnConnected(number.id).catch(() => null);
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
        if (messageType === 'conversation' || messageType === 'extendedTextMessage') {
          const messageText: string | undefined =
            messageType === 'conversation'
              ? msg?.message?.conversation
              : msg?.message?.extendedTextMessage?.text;

          // Consulta admin de saques pendentes (texto, restrito ao telefone cadastrado
          // em AdminAlertConfig) — fora do contexto de número/cliente específico, então
          // roda antes do fluxo normal do Atende/self-chat abaixo.
          const handledPayoutQuery = await handleAdminPayoutQuery(instName, senderPhone, messageText ?? '').catch((err: any) => {
            log.error({ err: err?.message }, '[Evolution] Erro ao processar consulta admin');
            return false;
          });
          if (handledPayoutQuery) {
            log.info(`[Evolution] 🔐 Consulta admin de saques respondida (${senderPhone})`);
            return;
          }

          if (!fromMe) {
            const number = messageText ? await findNumber(false) : null;

            // Número oficial (isPublic) + texto de alguém que não é o dono: cadastro
            // e onboarding conversacional via WhatsApp (site simultâneo ou início
            // direto por aqui). Tem prioridade sobre o fluxo padrão do Atende —
            // o número oficial não é um número de Atende de cliente algum.
            if (number?.isPublic && messageText) {
              const handled = await handleOfficialNumberText(instName, senderPhone, senderName, messageText, messageId)
                .catch((err: any) => {
                  log.error({ err: err?.message }, '[Evolution] Erro no onboarding via número oficial');
                  return false;
                });
              if (handled) return;
            }

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

            // ── Módulo Cobrança (#6): cliente pode estar avisando que já pagou ──
            // Independente do Atende (canal separado: aqui quem é avisado é o
            // DONO, não o cliente). Fire-and-forget — não atrasa o ACK do webhook.
            if (number && messageText && COBRANCA_PAGAMENTO_KEYWORDS.test(messageText)) {
              getUserModules(number.userId)
                .then((mods) => {
                  if (mods.includes('cobranca')) {
                    notifyCobrancaPossiblePayment(number.userId, senderPhone, messageText).catch(() => null);
                  }
                })
                .catch(() => null);
            }
          } else if (messageText) {
            const number = await findNumber(false);

            // Feature 8: comando do dono via self-chat ("atende status/ligar/desligar/...").
            // Mesma detecção de self-chat do áudio (Feature 1) — aqui em texto, e só
            // dispara com o prefixo "atende" pra nunca sequestrar uma nota pessoal comum.
            const selfRef    = ownerDigits || String(number?.phoneNumber ?? '').replace(/\D/g, '');
            const isSelfChat = !!number && !!selfRef && selfRef !== 'pending' && samePhone(senderPhone, selfRef);

            if (isSelfChat && isAtendeOwnerCommand(messageText)) {
              const hasAtende = (await getUserModules(number!.userId)).includes('atende');
              if (hasAtende) {
                await handleAtendeOwnerCommand({
                  userId:       number!.userId,
                  numberId:     number!.id,
                  instanceName: instName,
                  selfPhone:    senderPhone,
                  text:         messageText,
                });
                log.info(`[Evolution] 🛠️ Comando do dono processado (Atende, número ${number!.id})`);
              } else {
                log.info(`[Evolution] 🛠️ Comando "atende" ignorado — módulo não contratado (número ${number!.id})`);
              }
              return;
            }

            // Resposta real do dono (fromMe), mandada pelo próprio WhatsApp enquanto a
            // conversa está sob takeover — captura como AtendeMessage humanAuthored.
            // Alimenta Feature 5 (sugestões a partir do histórico real) e Feature 6
            // (promover resposta de escalação a item de KB) sem precisar de UI própria
            // de envio dentro do ZapScript.
            const conversation = number
              ? await prisma.atendeConversation.findFirst({
                  where: { numberId: number.id, contactPhone: senderPhone, humanTakeover: true },
                })
              : null;
            if (conversation) {
              await prisma.atendeMessage.create({
                data: {
                  conversationId: conversation.id,
                  direction: 'out',
                  content: messageText,
                  humanAuthored: true,
                },
              });
              await prisma.atendeConversation.update({
                where: { id: conversation.id },
                data: { lastMessageAt: new Date() },
              });
              log.info(`[Evolution] 📝 Resposta humana capturada (Atende, conversa ${conversation.id})`);
            }
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

      // ═══════════════════════════════════════════════════════════════════════
      // 🆕 NÚMERO PÚBLICO — Zero-friction first use via WhatsApp
      //
      // Quando um número é marcado como `isPublic` e um ESTRANHO (não-usuário)
      // envia áudio: transcrever, responder com demo + CTA de cadastro.
      // SEM custo de quota — custeia o custo de aquisição (CAC via API).
      // ═══════════════════════════════════════════════════════════════════════
      const isPublicNumber = whatsappNumber.isPublic === true;
      const isStranger = fromMe === false && isPublicNumber;  // estranho = não é o dono, é o público

      if (isStranger) {
        log.info(`[Evolution] 🆕 Número público: áudio de estranho ${senderPhone} → demo grátis`);

        // Enfileirar job de transcrição pública (worker existente trata)
        await transcriptionQueue.add(
          'transcribe-evolution',
          {
            userId:        whatsappNumber.userId,
            numberId:      whatsappNumber.id,
            instanceName:  instName,
            senderPhone,
            senderName,
            messageKey:    key,
            messageData:   msg,
            durationHint,
            messageId,
            source:        'whatsapp-public',   // sinaliza worker: é demo pública
            isSelfNote:    false,
            forwarded:     false,
            originPhone:   null,
            isPublicDemo:  true,                 // 🆕 flag para worker: responder com CTA
          },
          {
            jobId:    messageId,
            attempts: 3,
            backoff:  { type: 'exponential', delay: 2000 },
          }
        );
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

      // ── Feature 10: áudio do CLIENTE → Atende responde direto ─────────────
      // Roteamento exclusivo: se o número tem Atende habilitado + contratado,
      // este áudio vai para a fila do Atende (resposta conversacional) em vez
      // da fila de transcrição (resumo). Nunca as duas — evitaria responder
      // duas vezes e confundiria o dono de qual registro pertence a qual fluxo.
      // Mesmo double-gate do texto (cfg.enabled + entitlement real, já que o
      // cancelamento de billing só mexe no Entitlement, nunca no AtendeConfig).
      if (!isSelfNote) {
        const cfg = await prisma.atendeConfig.findUnique({ where: { numberId: whatsappNumber.id } });
        const hasAtende = cfg?.enabled
          ? (await getUserModules(whatsappNumber.userId)).includes('atende')
          : false;

        if (cfg?.enabled && hasAtende) {
          log.info(`[Evolution] 🔊🤖 Áudio de ${senderName} (${durationHint}s) → Atende`);
          await atendeQueue.add(
            'atende-reply',
            {
              userId:       whatsappNumber.userId,
              numberId:     whatsappNumber.id,
              instanceName: instName,
              senderPhone,
              senderName,
              audio:        { messageData: msg, durationHint },
              messageId,
            },
            { jobId: messageId, attempts: 3, backoff: { type: 'exponential', delay: 5000 } }
          );
          return;
        }
        if (cfg?.enabled && !hasAtende) {
          log.info(`[Evolution] 🔊 Áudio de ${senderName}: módulo Atende não contratado/cancelado — segue fluxo padrão`);
        }
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
