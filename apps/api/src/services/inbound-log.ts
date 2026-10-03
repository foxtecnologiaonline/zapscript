import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

/**
 * Registro das mensagens RECEBIDAS (item 5 do escopo ZapScript × Twilio — a
 * ponta de entrada, que a API pública v1 não cobria).
 *
 * Complementa, não substitui, o evento de webhook `message.received`: o evento
 * empurra na hora e serve para o integrador REAGIR; esta tabela guarda, e serve
 * para o dono CONSULTAR depois ("este contato me mandou alguma coisa?") e para
 * as métricas contarem volume de entrada.
 *
 * Regra que vale para tudo aqui: **registrar nunca pode atrapalhar a mensagem**.
 * O webhook do provedor tem orçamento de tempo curto e o pipeline que de fato
 * trata a mensagem (transcrição, Atende, Copiloto) vem depois — uma falha ao
 * gravar o log vira warn e segue. Por isso todas as chamadas são
 * fire-and-forget e o try/catch envolve a função inteira (uma exceção síncrona
 * num `void` viraria unhandled rejection).
 */

/** Teto do texto guardado. Mensagem de WhatsApp vai até 4096 caracteres. */
export const INBOUND_BODY_MAX = 4096;

export type InboundChannel = 'meta' | 'evolution';
export type InboundType = 'text' | 'image' | 'audio' | 'video' | 'document' | 'sticker';

export interface InboundLogInput {
  userId: string;
  numberId?: string | null;
  channel: InboundChannel;
  from: string;
  to?: string | null;
  type?: InboundType;
  body?: string | null;
  providerMessageId?: string | null;
}

const digits = (v: string | null | undefined) => (v ? String(v).replace(/\D/g, '') : null);

export function truncateInboundBody(text: string | null | undefined): string | null {
  if (!text) return null;
  return text.length > INBOUND_BODY_MAX ? text.slice(0, INBOUND_BODY_MAX) : text;
}

/**
 * Grava uma mensagem recebida. Reentrega do provedor não duplica: o unique
 * (channel, providerMessageId) resolve, e a colisão é ignorada em silêncio —
 * é o caso esperado, não um erro.
 */
export async function logInboundMessage(input: InboundLogInput): Promise<void> {
  try {
    await prisma.inboundMessage.create({
      data: {
        userId:            input.userId,
        numberId:          input.numberId ?? null,
        channel:           input.channel,
        from:              digits(input.from) ?? '',
        to:                digits(input.to),
        type:              input.type ?? 'text',
        body:              truncateInboundBody(input.body),
        providerMessageId: input.providerMessageId ?? null,
      },
    });
  } catch (err: any) {
    // P2002 = mesma mensagem chegando de novo (reentrega do webhook). Esperado.
    if (err?.code === 'P2002') return;
    logger.warn({ err: err?.message, channel: input.channel }, '[InboundLog] falha ao registrar entrada');
  }
}

/**
 * Retenção. INBOUND_RETENTION_DAYS=0 guarda para sempre.
 *
 * Teto de linhas por passada: numa conta movimentada o acumulado pode ser
 * grande, e um DELETE sem limite seguraria lock em tabela quente. A poda roda
 * de novo na próxima janela.
 */
export async function purgeOldInboundMessages(): Promise<number> {
  const days = Number(process.env.INBOUND_RETENTION_DAYS ?? 90);
  if (!Number.isFinite(days) || days <= 0) return 0;

  const cutoff = new Date(Date.now() - days * 86_400_000);
  const antigas = await prisma.inboundMessage.findMany({
    where:  { receivedAt: { lt: cutoff } },
    select: { id: true },
    take:   5_000,
  });
  if (antigas.length === 0) return 0;

  const { count } = await prisma.inboundMessage.deleteMany({
    where: { id: { in: antigas.map((r) => r.id) } },
  });
  if (count > 0) logger.info(`[InboundLog] ${count} entrada(s) acima de ${days} dias purgada(s)`);
  return count;
}
