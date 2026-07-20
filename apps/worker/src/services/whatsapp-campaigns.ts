import axios from 'axios';
import { logger } from '../lib/logger';

/**
 * Meta Graph API — envio de campanhas (mensagens de template fora da janela de 24h).
 * Espelha apps/api/src/services/whatsapp-campaigns.ts — api e worker são deploys
 * separados sem pacote compartilhado de lógica de negócio (só packages/database).
 * Credenciais são por cliente (WhatsappNumber.provider='meta'), nunca globais.
 */

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v23.0';
const GRAPH_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;

function formatError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    return (
      (error.response?.data as any)?.error?.message ||
      (error.response?.data as any)?.message ||
      error.message
    );
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Envia uma mensagem de template para um destinatário (permitido fora da janela de 24h).
 * `components` segue o formato da Graph API (ex: [{type:'body', parameters:[{type:'text', text:'João'}]}]).
 */
export async function sendTemplateMessage(
  accessToken: string,
  phoneNumberId: string,
  to: string,
  templateName: string,
  language: string,
  components?: Array<Record<string, any>>,
): Promise<string> {
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: to.replace(/\D/g, ''),
    type: 'template',
    template: {
      name: templateName,
      language: { code: language },
      ...(components && components.length ? { components } : {}),
    },
  };

  try {
    const res = await axios.post(`${GRAPH_URL}/${phoneNumberId}/messages`, payload, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 15_000,
    });
    const wamid = res.data?.messages?.[0]?.id;
    if (!wamid) throw new Error('Resposta da Meta sem message id');
    return wamid as string;
  } catch (error) {
    const msg = formatError(error);
    logger.error(`[Campanhas] sendTemplateMessage falhou: ${msg}`);
    throw new Error(msg);
  }
}
