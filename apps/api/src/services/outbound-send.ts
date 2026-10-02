import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { ApiError } from '../lib/apiErrors';
import { messagesOutQueue } from './queue';
import { decryptStr } from './encryption';
import { findTemplateByName } from './meta-templates';
import { assertTemplateSendable } from './template-components';
import {
  logQueuedOutbound, markMessageFailed, toPublicMessage,
  type MessageSource, type PublicMessage,
} from './message-log';
import type { SendMessageInput } from '../lib/validation';

/**
 * Aceite de um envio pela API pública (item 1 do escopo ZapScript × Twilio).
 *
 * "Aceite" e não "envio": aqui a mensagem é VALIDADA, registrada no log e
 * enfileirada; quem fala com o provedor é o worker (fila 'messages-out'). É o
 * mesmo contrato do Twilio — responde 202 com status `queued` e o ciclo de
 * vida chega por webhook/consulta.
 *
 * Tudo que dá para reprovar sem gastar chamada ao provedor é reprovado aqui,
 * com código do catálogo: número inexistente/desconectado, destinatário em
 * opt-out, template inexistente, variáveis em número errado, header de mídia
 * faltando. Antes, esse tipo de erro só aparecia DEPOIS, como um código opaco
 * da Meta, com a mensagem já marcada como falha.
 */

export interface AcceptOutboundArgs {
  userId: string;
  input: SendMessageInput;
  source?: MessageSource;
  idempotencyKey?: string | null;
}

/**
 * Escolhe de qual número sai a mensagem.
 *
 * Com mais de um número candidato e sem `numberId`, recusa em vez de
 * "escolher o mais recente": enviar do número errado é um erro que o cliente
 * não consegue desfazer — a mensagem já chegou com outro remetente.
 */
async function resolveNumber(userId: string, input: SendMessageInput) {
  if (input.numberId) {
    const number = await prisma.whatsappNumber.findFirst({
      where: { id: input.numberId, userId },
    });
    if (!number) {
      throw new ApiError('number.not_found', {
        message: `Número "${input.numberId}" não existe nesta conta.`,
      });
    }
    return number;
  }

  const all = await prisma.whatsappNumber.findMany({ where: { userId } });
  // Template só existe na Cloud API — não ofereça um número Evolution para ele.
  const candidates = input.type === 'template'
    ? all.filter((n: any) => n.provider === 'meta')
    : all;

  if (candidates.length === 0) {
    throw new ApiError('number.not_found', {
      message: input.type === 'template'
        ? 'Nenhum número oficial (Meta) conectado — template exige canal oficial.'
        : 'Nenhum número de WhatsApp conectado nesta conta.',
    });
  }
  if (candidates.length === 1) return candidates[0];

  const connected = candidates.filter((n: any) => n.status === 'connected');
  if (connected.length === 1) return connected[0];

  throw new ApiError('request.invalid', {
    message: 'Sua conta tem mais de um número — informe "numberId" para escolher o remetente.',
    details: {
      numbers: candidates.map((n: any) => ({
        id: n.id, phoneNumber: n.phoneNumber, provider: n.provider, status: n.status,
      })),
    },
  });
}

/** Destinatário que pediu para parar de receber nunca recebe por API. */
async function assertNotOptedOut(userId: string, phone: string) {
  const optOut = await prisma.campanhaOptOut.findUnique({
    where: { userId_phone: { userId, phone } },
  }).catch(() => null);
  if (optOut) {
    throw new ApiError('message.recipient_opted_out', {
      message: `${phone} pediu para não receber mensagens (${optOut.reason || 'opt-out'}).`,
      details: { optOutAt: optOut.createdAt },
    });
  }
}

/**
 * Confere o envio contra o template APROVADO na Meta antes de enfileirar.
 * Custa uma leitura da Graph API, com cache de 60s (services/meta-templates.ts)
 * — e economiza uma mensagem marcada como falha por erro evitável.
 */
async function validateTemplate(number: any, input: SendMessageInput) {
  if (input.type !== 'template' || !input.template) return;

  if (number.provider !== 'meta') {
    throw new ApiError('message.type_unsupported', {
      message: 'Templates só existem no canal oficial (Meta). Neste número, envie type=text.',
    });
  }
  if (!number.metaAccessTokenEnc || !number.metaWabaId) {
    throw new ApiError('number.missing_credentials', {
      message: 'O número oficial está sem credenciais da Meta — reconecte-o.',
    });
  }

  const token = decryptStr(number.metaAccessTokenEnc);
  const template = await findTemplateByName(
    token, number.metaWabaId, input.template.name, input.template.language,
  );
  if (!template) {
    throw new ApiError('template.not_found', {
      message: `Template "${input.template.name}" (${input.template.language}) não existe no WABA deste número.`,
      details: { name: input.template.name, language: input.template.language },
    });
  }

  assertTemplateSendable({
    template,
    header:        input.template.header ?? null,
    bodyVariables: input.template.variables ?? null,
  });
}

export async function acceptOutboundMessage(
  args: AcceptOutboundArgs,
): Promise<PublicMessage> {
  const { userId, input } = args;

  const number = await resolveNumber(userId, input);
  await assertNotOptedOut(userId, input.to);
  await validateTemplate(number, input);

  const channel: 'meta' | 'evolution' = number.provider === 'meta' ? 'meta' : 'evolution';

  const row = await logQueuedOutbound({
    userId,
    numberId:         number.id,
    channel,
    source:           args.source ?? 'api',
    toPhone:          input.to,
    fromPhone:        number.phoneNumber && number.phoneNumber !== 'pending' ? number.phoneNumber : null,
    type:             input.type,
    body:             input.type === 'text' ? input.text ?? null : input.media?.caption ?? null,
    templateName:     input.template?.name ?? null,
    templateLanguage: input.template?.language ?? null,
    mediaUrl:         input.media?.link ?? input.template?.header?.link ?? null,
    idempotencyKey:   args.idempotencyKey ?? null,
  });

  try {
    await messagesOutQueue.add(
      'send',
      {
        messageLogId: row.id,
        userId,
        numberId:     number.id,
        to:           input.to,
        type:         input.type,
        text:         input.text ?? null,
        previewUrl:   input.previewUrl ?? false,
        media:        input.media ?? null,
        template:     input.template ?? null,
      },
      // jobId = id do log: se o mesmo aceite for reenfileirado (retry interno,
      // replay de DLQ), o BullMQ descarta o duplicado em vez de enviar 2x.
      { jobId: row.id },
    );
  } catch (err: any) {
    // Fila indisponível: a mensagem NÃO saiu. Marcar como falha e devolver erro
    // retryable é melhor que deixá-la pendurada em 'queued' — e o registro de
    // idempotência é liberado, então o cliente pode reenviar de verdade.
    logger.error({ err: err?.message, messageLogId: row.id }, '[OutboundSend] falha ao enfileirar');
    const apiErr = new ApiError('provider.unavailable', {
      message: 'Não foi possível enfileirar o envio agora. Tente de novo.',
      retryable: true,
    });
    await markMessageFailed(row.id, apiErr);
    throw apiErr;
  }

  return toPublicMessage({ ...row, status: 'queued' });
}
