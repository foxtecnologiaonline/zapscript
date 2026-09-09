import axios from 'axios';
import { logger } from '../lib/logger';

/**
 * Meta Graph API — envio de campanhas (mensagens de template fora da janela de 24h)
 * Credenciais são por cliente (WhatsappNumber.provider='meta'), nunca globais —
 * cada chamada recebe o token descriptografado do chamador (ver routes/modules/campanhas).
 */

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v23.0';
const GRAPH_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;

export interface MetaTemplate {
  id: string;
  name: string;
  status: string; // APPROVED | PENDING | REJECTED | PAUSED
  category: string;
  language: string;
  components: Array<{ type: string; text?: string; format?: string; example?: any }>;
}

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

/** Lista os templates de mensagem do WABA do cliente (para escolha na criação da campanha). */
export async function listTemplates(accessToken: string, wabaId: string): Promise<MetaTemplate[]> {
  try {
    const res = await axios.get(`${GRAPH_URL}/${wabaId}/message_templates`, {
      params: { fields: 'id,name,status,category,language,components', limit: 100 },
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 15_000,
    });
    return res.data?.data || [];
  } catch (error) {
    const msg = formatError(error);
    logger.error(`[Campanhas] listTemplates falhou: ${msg}`);
    throw new Error(`Falha ao listar templates da Meta: ${msg}`);
  }
}

export interface MetaPhoneNumberLimits {
  messagingLimitTier: string | null; // ex.: 'TIER_250' | 'TIER_1K' | 'TIER_10K' | 'TIER_100K' | 'TIER_UNLIMITED'
  qualityRating: string | null;      // 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN'
}

/**
 * Lê o tier de mensageria e o quality rating do número (Graph API) — usado pra
 * avisar/travar antes de um disparo grande (ver CAMPANHAS_ARQUITETURA.md §5.1/§9),
 * em vez de confiar só num aviso estático de UI. Nomes de campo confirmados na
 * versão do Graph em uso (`META_GRAPH_VERSION`) — a Meta já os renomeou antes;
 * se a resposta vier sem eles, retorna null (chamador decide o fallback).
 */
export async function getPhoneNumberLimits(accessToken: string, phoneNumberId: string): Promise<MetaPhoneNumberLimits> {
  try {
    const res = await axios.get(`${GRAPH_URL}/${phoneNumberId}`, {
      params: { fields: 'quality_rating,messaging_limit_tier' },
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 10_000,
    });
    return {
      messagingLimitTier: res.data?.messaging_limit_tier ?? null,
      qualityRating: res.data?.quality_rating ?? null,
    };
  } catch (error) {
    const msg = formatError(error);
    logger.error(`[Campanhas] getPhoneNumberLimits falhou: ${msg}`);
    throw new Error(`Falha ao consultar limites do número na Meta: ${msg}`);
  }
}

/**
 * Converte o tier textual da Meta num teto numérico de contatos únicos/24h.
 * Regex em vez de switch fixo: a Meta já mudou os nomes de tier antes, e isso
 * sobrevive a variações tipo 'TIER_10K' / 'TIER_10000' sem precisar de update.
 * Retorna null se não for possível interpretar (chamador não deve travar nesse caso).
 */
export function tierToNumericCap(tier: string | null | undefined): number | null {
  if (!tier) return null;
  const t = tier.toUpperCase();
  if (t.includes('UNLIMITED')) return Infinity;
  const match = t.match(/(\d+)(K)?/);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return match[2] ? n * 1000 : n;
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
    throw new Error(formatError(error));
  }
}
