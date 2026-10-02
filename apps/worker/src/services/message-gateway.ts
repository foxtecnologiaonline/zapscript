import { prisma } from '../lib/prisma';
import { decryptStr } from './encryption';
import { ApiError, mapProviderError } from '../lib/apiErrors';
import { sendMetaText, sendMetaMedia, sendMetaTemplate, type MetaMediaKind } from './meta-messages';
import { sendMessageViaEvolution, sendMediaByUrlViaEvolution } from './evolution';
import type { TemplateHeaderMedia } from './template-components';

/**
 * Gateway de SAÍDA (o "Messaging Gateway" do Passo 1 de PLATAFORMA_BASE.md §6).
 *
 * Um só lugar que sabe escolher transporte: Cloud API da Meta quando o número
 * é `provider='meta'`, Evolution quando é `provider='evolution'`. Quem chama
 * descreve O QUE enviar (texto, mídia, template) e nunca COMO.
 *
 * Toda falha sai como ApiError com código do catálogo — é o que o log de
 * mensagens grava e o que decide se o job retenta (`retryable`) ou morre.
 */

export type OutboundType = 'text' | 'template' | 'image' | 'audio' | 'video' | 'document';

export interface OutboundSpec {
  userId: string;
  numberId: string;
  to: string;
  type: OutboundType;
  text?: string | null;
  previewUrl?: boolean;
  media?: { link?: string; id?: string; caption?: string; filename?: string } | null;
  template?: {
    name: string;
    language: string;
    variables?: Array<string | number> | null;
    header?: TemplateHeaderMedia | null;
  } | null;
}

export interface OutboundResult {
  providerMessageId: string | null;
  channel: 'meta' | 'evolution';
}

/**
 * Carrega o número do cliente e confere que ele PODE enviar. Falhar aqui, com
 * código específico, é muito melhor que deixar o provedor devolver um 401
 * genérico — o cliente precisa saber que o problema é reconectar o número.
 */
async function loadSendableNumber(userId: string, numberId: string) {
  const number = await prisma.whatsappNumber.findFirst({ where: { id: numberId, userId } });
  if (!number) throw new ApiError('number.not_found');

  if (number.provider === 'meta') {
    if (!number.metaAccessTokenEnc || !number.metaPhoneNumberId) {
      throw new ApiError('number.missing_credentials', {
        message: 'O número oficial (Meta) está sem token válido — reconecte-o em /dashboard/numeros.',
      });
    }
    return number;
  }

  if (!number.zapiInstanceId) {
    throw new ApiError('number.missing_credentials', {
      message: 'O número não tem instância da Evolution associada.',
    });
  }
  if (number.status !== 'connected') {
    throw new ApiError('number.disconnected', {
      message: `O número está "${number.status}" — reconecte-o antes de enviar.`,
      details: { status: number.status },
    });
  }
  return number;
}

export async function sendOutbound(spec: OutboundSpec): Promise<OutboundResult> {
  const number = await loadSendableNumber(spec.userId, spec.numberId);

  if (number.provider === 'meta') {
    const creds = {
      accessToken:   decryptStr(number.metaAccessTokenEnc!),
      phoneNumberId: number.metaPhoneNumberId!,
    };

    if (spec.type === 'template') {
      if (!spec.template?.name) {
        throw new ApiError('request.invalid', { message: 'template.name é obrigatório para type=template.' });
      }
      const wamid = await sendMetaTemplate(creds, spec.to, {
        name:          spec.template.name,
        language:      spec.template.language,
        bodyVariables: spec.template.variables ?? null,
        header:        spec.template.header ?? null,
      });
      return { providerMessageId: wamid, channel: 'meta' };
    }

    if (spec.type === 'text') {
      if (!spec.text) throw new ApiError('message.body_required');
      const wamid = await sendMetaText(creds, spec.to, spec.text, { previewUrl: spec.previewUrl });
      return { providerMessageId: wamid, channel: 'meta' };
    }

    const wamid = await sendMetaMedia(creds, spec.to, spec.type as MetaMediaKind, {
      link:     spec.media?.link,
      id:       spec.media?.id,
      caption:  spec.media?.caption ?? undefined,
      filename: spec.media?.filename ?? undefined,
    });
    return { providerMessageId: wamid, channel: 'meta' };
  }

  // ── Evolution (número não-oficial, sessão própria) ──────────────────────────
  // Template é um recurso da Cloud API: não existe na Evolution. Recusar com
  // código próprio evita que o cliente ache que "o template não existe".
  if (spec.type === 'template') {
    throw new ApiError('message.type_unsupported', {
      message: 'Templates só existem no canal oficial (Meta). Neste número, envie type=text.',
      details: { channel: 'evolution' },
    });
  }

  const instance = number.zapiInstanceId!;
  try {
    if (spec.type === 'text') {
      if (!spec.text) throw new ApiError('message.body_required');
      const res = await sendMessageViaEvolution(instance, spec.to, spec.text);
      return { providerMessageId: res.id, channel: 'evolution' };
    }

    // Evolution não aceita media id da Meta — só URL/base64.
    if (!spec.media?.link) {
      throw new ApiError('message.media_url_invalid', {
        message: 'Neste canal a mídia precisa vir como media.link (URL pública).',
      });
    }
    const res = await sendMediaByUrlViaEvolution(instance, spec.to, spec.type, spec.media.link, {
      caption:  spec.media.caption ?? undefined,
      fileName: spec.media.filename ?? undefined,
    });
    return { providerMessageId: res.id, channel: 'evolution' };
  } catch (err) {
    throw mapProviderError(err, { provider: 'evolution' });
  }
}
