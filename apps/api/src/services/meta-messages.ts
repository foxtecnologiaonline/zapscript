import axios from 'axios';
import { logger } from '../lib/logger';
import { ApiError, mapProviderError } from '../lib/apiErrors';
import { buildTemplateComponents, type TemplateHeaderMedia } from './template-components';

/**
 * Envio por número PRÓPRIO do cliente na Cloud API da Meta — a superfície que
 * a API de escrita (item 1) usa.
 *
 * Por que não reaproveitar services/whatsapp-official.ts: aquele lê
 * WHATSAPP_API_TOKEN/WHATSAPP_PHONE_NUMBER_ID do ambiente, isto é, UM número
 * global do ZapScript (sobrou do fluxo de App Review da Meta). A API pública é
 * multi-tenant: cada envio usa o token e o phoneNumberId do WhatsappNumber do
 * cliente. E, diferente de whatsapp-campaigns.ts, aqui toda falha sai como
 * ApiError com código do catálogo — é esse código que vai para o log de
 * mensagens, para o webhook e para a resposta da API.
 *
 * Copiado byte a byte em apps/worker/src/services/meta-messages.ts (api e
 * worker não compartilham packages/*). Teste garante que não divergem.
 * Logging só com string: os dois loggers têm assinaturas diferentes.
 */

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v23.0';
const GRAPH_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;
const TIMEOUT_MS = 15_000;

export interface MetaCredentials {
  accessToken: string;
  phoneNumberId: string;
}

export type MetaMediaKind = 'image' | 'audio' | 'video' | 'document';

export interface MetaMediaPayload {
  /** URL pública HTTPS (a Meta baixa) ou `id` de mídia já subida. */
  link?: string;
  id?: string;
  caption?: string;
  filename?: string;
}

async function postMessage(creds: MetaCredentials, payload: Record<string, any>): Promise<string> {
  try {
    const res = await axios.post(`${GRAPH_URL}/${creds.phoneNumberId}/messages`, payload, {
      headers: { Authorization: `Bearer ${creds.accessToken}` },
      timeout: TIMEOUT_MS,
    });
    const wamid = res.data?.messages?.[0]?.id;
    if (!wamid) {
      // 200 sem wamid não deveria acontecer; se acontecer, tratar como sucesso
      // seria pior — ficaríamos sem chave para correlacionar o status depois.
      throw new ApiError('provider.rejected', { message: 'A Meta respondeu 200 sem message id.' });
    }
    return String(wamid);
  } catch (err) {
    throw mapProviderError(err, { provider: 'meta' });
  }
}

function recipient(to: string) {
  return {
    messaging_product: 'whatsapp',
    recipient_type:    'individual',
    to:                String(to).replace(/\D/g, ''),
  };
}

/** Texto livre — só vale dentro da janela de 24h (fora dela a Meta devolve 131047). */
export async function sendMetaText(
  creds: MetaCredentials,
  to: string,
  text: string,
  opts: { previewUrl?: boolean } = {},
): Promise<string> {
  const wamid = await postMessage(creds, {
    ...recipient(to),
    type: 'text',
    text: { body: text, preview_url: Boolean(opts.previewUrl) },
  });
  logger.info(`[Meta] texto enviado para ${String(to).replace(/\D/g, '')} — ${wamid}`);
  return wamid;
}

/** Mídia por URL ou media id. Também só dentro da janela de 24h. */
export async function sendMetaMedia(
  creds: MetaCredentials,
  to: string,
  kind: MetaMediaKind,
  media: MetaMediaPayload,
): Promise<string> {
  if (!media.link && !media.id) {
    throw new ApiError('message.media_url_invalid', { message: 'Informe media.link ou media.id.' });
  }
  const body: Record<string, any> = media.id ? { id: media.id } : { link: media.link };
  // A Cloud API aceita caption só em image/video/document — em audio é erro.
  if (media.caption && kind !== 'audio') body.caption = media.caption;
  if (kind === 'document' && media.filename) body.filename = media.filename;

  const wamid = await postMessage(creds, { ...recipient(to), type: kind, [kind]: body });
  logger.info(`[Meta] ${kind} enviado para ${String(to).replace(/\D/g, '')} — ${wamid}`);
  return wamid;
}

/**
 * Template aprovado — único caminho válido fora da janela de 24h.
 * `header` monta o componente de header de mídia (item 8).
 */
export async function sendMetaTemplate(
  creds: MetaCredentials,
  to: string,
  template: {
    name: string;
    language: string;
    bodyVariables?: Array<string | number> | null;
    header?: TemplateHeaderMedia | null;
    staticComponents?: Array<Record<string, any>> | null;
  },
): Promise<string> {
  const components = buildTemplateComponents({
    header:           template.header ?? null,
    bodyVariables:    template.bodyVariables ?? null,
    staticComponents: template.staticComponents ?? null,
  });

  const wamid = await postMessage(creds, {
    ...recipient(to),
    type: 'template',
    template: {
      name:     template.name,
      language: { code: template.language },
      ...(components.length ? { components } : {}),
    },
  });
  logger.info(`[Meta] template "${template.name}" enviado para ${String(to).replace(/\D/g, '')} — ${wamid}`);
  return wamid;
}
