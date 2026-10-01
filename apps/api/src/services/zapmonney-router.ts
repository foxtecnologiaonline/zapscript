import { zapmonneyQueue, redis } from './queue';
import { sendText } from './evolution';

/**
 * ZapMonney — porta de entrada do número dedicado ao assistente financeiro.
 *
 * Chamado pelo webhook da Evolution (routes/evolution-webhook.ts) quando o
 * evento vem da instância em ZAPMONNEY_INSTANCE, ANTES de qualquer lógica B2B:
 * aqui não existe Atende, Copiloto, Campanhas, Entitlement nem dono de número —
 * o número é nosso e quem escreve é identificado pelo próprio telefone.
 *
 * Responsabilidade é só triagem: extrair texto/áudio, barrar abuso e enfileirar.
 * Toda a conversa acontece no worker (apps/worker/src/zapmonney.ts).
 */

const AUDIO_TYPES = new Set(['audioMessage', 'pttMessage']);
const TEXT_TYPES  = new Set(['conversation', 'extendedTextMessage']);

// Mídia que uma pessoa mandou de propósito e merece explicação de volta. O que
// NÃO está aqui (reação, protocolMessage de mensagem apagada, atualização de
// enquete, recibo) é ruído de protocolo: responder a isso mandaria "só entendo
// texto e áudio" sem ninguém ter escrito nada.
const MEDIA_TYPES = new Set([
  'imageMessage', 'videoMessage', 'stickerMessage', 'documentMessage',
  'documentWithCaptionMessage', 'locationMessage', 'contactMessage', 'contactsArrayMessage',
]);

// Teto diário por telefone. O número é público: sem isso, um único remetente
// em loop paga LLM + Whisper à nossa custa indefinidamente.
// Valor inválido na env cai no default em vez de virar NaN: com NaN,
// `count <= DAILY_LIMIT` é sempre falso E `count === DAILY_LIMIT + 1` também,
// então o número ficaria mudo para todo mundo sem nem mandar o aviso.
const DAILY_LIMIT = Number.parseInt(process.env.ZAPMONNEY_DAILY_LIMIT || '', 10) || 60;

/** Dia no fuso de São Paulo (UTC-3 fixo) — a janela precisa virar à meia-noite
 *  de quem está conversando, senão a mensagem "a gente continua amanhã" libera
 *  às 21h de hoje. */
function dayKey(): string {
  return new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * Conta a mensagem e diz se passa. Devolve o total do dia para o chamador
 * avisar a pessoa exatamente uma vez ao estourar, em vez de a cada mensagem.
 */
async function rateLimit(phone: string): Promise<{ allowed: boolean; count: number }> {
  const key = `zm:rl:${phone}:${dayKey()}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 36 * 3_600); // cobre o dia inteiro com folga
    return { allowed: count <= DAILY_LIMIT, count };
  } catch {
    // Redis fora do ar não pode calar o produto — a fila é o próximo gargalo
    // de qualquer forma, e o custo de uma janela sem teto é menor que o de
    // ficar mudo para todo mundo.
    return { allowed: true, count: 0 };
  }
}

export async function routeZapMonneyMessage(instName: string, data: any, log: any): Promise<void> {
  const msg = data;
  const key = msg?.key;

  // fromMe = eco das nossas próprias respostas. Processar isso é loop infinito.
  if (!key || key.fromMe) return;

  const remoteJid = key.remoteJid as string | undefined;
  if (!remoteJid || remoteJid.endsWith('@g.us')) return;  // grupo não é conversa financeira de ninguém

  const phone     = remoteJid.replace('@s.whatsapp.net', '').replace('@c.us', '').replace(/\D/g, '');
  const messageId = key.id as string | undefined;
  if (!phone || !messageId) return;

  const pushName    = msg?.pushName ?? null;
  const messageType = msg?.messageType;

  const isAudio = AUDIO_TYPES.has(messageType);
  const isText  = TEXT_TYPES.has(messageType);

  // Ruído de protocolo sai antes do contador: não é mensagem de ninguém.
  if (!isAudio && !isText && !MEDIA_TYPES.has(messageType)) return;

  const text = isText
    ? (messageType === 'conversation'
        ? msg?.message?.conversation
        : msg?.message?.extendedTextMessage?.text) ?? ''
    : '';

  if (isText && !text.trim()) return;

  // Antes do desvio por tipo: mídia também consome cota, senão sobra um caminho
  // em que spam continua nos custando envio de WhatsApp sem teto.
  const { allowed, count } = await rateLimit(phone);
  if (!allowed) {
    log.warn(`[ZapMonney] 🚦 Limite diário estourado por ${phone} (${count})`);
    if (count === DAILY_LIMIT + 1) {
      await sendText(
        instName, phone,
        '🚦 Você atingiu o limite de mensagens de hoje. A gente continua amanhã!',
      ).catch(() => null);
    }
    return;
  }

  if (!isAudio && !isText) {
    log.info(`[ZapMonney] Mídia não suportada (${messageType}) de ${phone}`);
    await sendText(
      instName, phone,
      '📎 Por aqui eu entendo texto e áudio. Me conta em palavras o que você quer registrar.',
    ).catch(() => null);
    return;
  }

  await zapmonneyQueue.add(
    'message',
    {
      instanceName: instName,
      phone,
      pushName,
      messageId,
      kind: isAudio ? 'audio' : 'text',
      text: isText ? text : undefined,
      messageData: isAudio ? msg : undefined,
    },
    // jobId = messageId: reentrega do webhook (a Evolution reenvia quando não
    // recebe 200 rápido) não gera segunda resposta para a mesma mensagem.
    { jobId: `zm-${messageId}` },
  );

  log.info(`[ZapMonney] 💰 Mensagem de ${phone} enfileirada (${isAudio ? 'áudio' : 'texto'})`);
}
