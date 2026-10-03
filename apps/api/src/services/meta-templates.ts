import axios from 'axios';
import { redis } from './queue';
import { logger } from '../lib/logger';
import { ApiError, mapProviderError } from '../lib/apiErrors';
import { templateHeaderFormat, templateBodyVarCount, type MetaTemplateLike } from './template-components';

/**
 * Gestão de templates direto no app (item 4 do escopo ZapScript × Twilio).
 *
 * Antes: o cliente só conseguia LISTAR templates aprovados (GET
 * /modules/campanhas/templates) e precisava sair do ZapScript, entrar no
 * Business Manager da Meta e criar o template lá — com o nosso onboarding
 * parando no meio. Criar, acompanhar análise, ver o motivo de uma rejeição e
 * apagar passam a acontecer aqui.
 *
 * Também centraliza o cache: a validação do envio por API precisa da definição
 * do template a cada POST /messages, e sem cache seria uma chamada à Graph API
 * por mensagem enviada.
 */

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v23.0';
const GRAPH_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;
const TIMEOUT_MS = 15_000;

/** TTL do cache da listagem. Curto: status de template muda sozinho (análise da Meta). */
const CACHE_TTL_SECONDS = Math.max(0, Number(process.env.META_TEMPLATES_CACHE_SECONDS ?? 60));

export type TemplateStatus = 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED' | 'DISABLED' | string;

export interface MetaTemplateDetail extends MetaTemplateLike {
  id: string;
  name: string;
  status: TemplateStatus;
  category: string;
  language: string;
  components: Array<{ type: string; format?: string; text?: string; example?: any; buttons?: any[] }>;
  /** Preenchido pela Meta quando status=REJECTED — é a informação que o cliente precisa ler. */
  rejectedReason?: string | null;
  qualityScore?: any;
}

/** Forma pública (o que a API devolve) — inclui o que o cliente precisa para ENVIAR. */
export interface PublicTemplate {
  id: string;
  name: string;
  language: string;
  status: TemplateStatus;
  category: string;
  /** 'NONE' | 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'LOCATION' */
  headerFormat: string;
  /** true = exige `template.header` no envio (item 8). */
  requiresHeaderMedia: boolean;
  /** Quantas variáveis {{n}} o corpo espera — evita o 132000 da Meta. */
  bodyVariableCount: number;
  bodyText: string | null;
  footerText: string | null;
  buttons: any[];
  rejectedReason: string | null;
  components: any[];
}

export function toPublicTemplate(t: MetaTemplateDetail): PublicTemplate {
  const comp = (type: string) =>
    t.components?.find((c) => String(c.type).toUpperCase() === type);
  return {
    id:                  t.id,
    name:                t.name,
    language:            t.language,
    status:              t.status,
    category:            t.category,
    headerFormat:        templateHeaderFormat(t),
    requiresHeaderMedia: ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(templateHeaderFormat(t)),
    bodyVariableCount:   templateBodyVarCount(t),
    bodyText:            comp('BODY')?.text ?? null,
    footerText:          comp('FOOTER')?.text ?? null,
    buttons:             comp('BUTTONS')?.buttons ?? [],
    rejectedReason:      t.rejectedReason ?? null,
    components:          t.components ?? [],
  };
}

const FIELDS = 'id,name,status,category,language,components,rejected_reason,quality_score';

function cacheKey(wabaId: string) {
  return `meta:templates:${wabaId}`;
}

function normalize(raw: any): MetaTemplateDetail {
  return {
    id:             String(raw?.id ?? ''),
    name:           String(raw?.name ?? ''),
    status:         String(raw?.status ?? 'UNKNOWN'),
    category:       String(raw?.category ?? ''),
    language:       String(raw?.language ?? ''),
    components:     Array.isArray(raw?.components) ? raw.components : [],
    rejectedReason: raw?.rejected_reason ?? null,
    qualityScore:   raw?.quality_score ?? null,
  };
}

/**
 * Lista os templates do WABA. Pagina até o fim (um WABA maduro passa dos 100
 * que caberiam numa página) e guarda em cache por CACHE_TTL_SECONDS.
 */
export async function listTemplates(
  accessToken: string,
  wabaId: string,
  opts: { useCache?: boolean } = {},
): Promise<MetaTemplateDetail[]> {
  const useCache = opts.useCache !== false && CACHE_TTL_SECONDS > 0;

  if (useCache) {
    const cached = await redis.get(cacheKey(wabaId)).catch(() => null);
    if (cached) {
      try { return JSON.parse(cached) as MetaTemplateDetail[]; } catch { /* cache corrompido: segue para a Meta */ }
    }
  }

  const out: MetaTemplateDetail[] = [];
  let url: string | null = `${GRAPH_URL}/${wabaId}/message_templates`;
  let params: Record<string, any> | undefined = { fields: FIELDS, limit: 100 };

  try {
    // Teto de 10 páginas (1.000 templates): sem ele, um `after` que não avança
    // viraria laço infinito segurando um request HTTP.
    for (let page = 0; page < 10 && url; page++) {
      const res: any = await axios.get(url, {
        params,
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: TIMEOUT_MS,
      });
      for (const raw of res.data?.data || []) out.push(normalize(raw));
      url = res.data?.paging?.next ?? null;
      params = undefined; // a URL de `next` já carrega os query params
    }
  } catch (err) {
    throw mapProviderError(err, { provider: 'meta', fallback: 'provider.unavailable' });
  }

  if (useCache) {
    await redis.set(cacheKey(wabaId), JSON.stringify(out), 'EX', CACHE_TTL_SECONDS).catch(() => null);
  }
  return out;
}

/** Invalida o cache — chamado depois de criar/apagar template. */
export async function invalidateTemplateCache(wabaId: string): Promise<void> {
  await redis.del(cacheKey(wabaId)).catch(() => null);
}

/**
 * Busca um template por nome (e idioma, quando informado).
 *
 * Por que por nome: é o que o cliente usa no envio (`template.name`), já que o
 * id da Meta não aparece em lugar nenhum do fluxo dele. Quando há o mesmo nome
 * em vários idiomas, sem `language` devolve o aprovado — é o único que pode
 * ser enviado, então é a escolha útil.
 */
export async function findTemplateByName(
  accessToken: string,
  wabaId: string,
  name: string,
  language?: string | null,
): Promise<MetaTemplateDetail | null> {
  const all = await listTemplates(accessToken, wabaId);
  const byName = all.filter((t) => t.name === name);
  if (byName.length === 0) return null;
  if (language) {
    return byName.find((t) => t.language === language) ?? null;
  }
  return byName.find((t) => t.status.toUpperCase() === 'APPROVED') ?? byName[0];
}

// ─────────────────────────────────────────────────────────────────────────────
//  Criação / exclusão
// ─────────────────────────────────────────────────────────────────────────────

export type TemplateCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';

export interface CreateTemplateInput {
  name: string;
  language: string;
  category: TemplateCategory;
  /** Componentes no formato da Graph API (HEADER/BODY/FOOTER/BUTTONS). */
  components: Array<Record<string, any>>;
}

/**
 * Cria o template no WABA do cliente. A Meta responde com status PENDING — a
 * aprovação é assíncrona (minutos a horas) e o cliente acompanha relistando.
 */
export async function createTemplate(
  accessToken: string,
  wabaId: string,
  input: CreateTemplateInput,
): Promise<{ id: string; status: string; category: string }> {
  try {
    const res = await axios.post(
      `${GRAPH_URL}/${wabaId}/message_templates`,
      {
        name:       input.name,
        language:   input.language,
        category:   input.category,
        components: input.components,
      },
      { headers: { Authorization: `Bearer ${accessToken}` }, timeout: TIMEOUT_MS },
    );
    await invalidateTemplateCache(wabaId);
    logger.info(`[Templates] criado "${input.name}" (${input.language}) no WABA ${wabaId}`);
    return {
      id:       String(res.data?.id ?? ''),
      status:   String(res.data?.status ?? 'PENDING'),
      category: String(res.data?.category ?? input.category),
    };
  } catch (err) {
    throw mapProviderError(err, { provider: 'meta', fallback: 'template.create_failed' });
  }
}

/**
 * Apaga o template por nome. A Meta apaga TODAS as traduções com esse nome
 * quando não se informa o id — por isso `hsmId` é aceito para apagar só uma.
 */
export async function deleteTemplate(
  accessToken: string,
  wabaId: string,
  name: string,
  hsmId?: string | null,
): Promise<void> {
  try {
    await axios.delete(`${GRAPH_URL}/${wabaId}/message_templates`, {
      params:  { name, ...(hsmId ? { hsm_id: hsmId } : {}) },
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: TIMEOUT_MS,
    });
    await invalidateTemplateCache(wabaId);
    logger.info(`[Templates] apagado "${name}" do WABA ${wabaId}`);
  } catch (err) {
    throw mapProviderError(err, { provider: 'meta', fallback: 'template.delete_failed' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Upload de mídia de exemplo (header_handle) — necessário para CRIAR template
//  com header de mídia (item 8)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A Meta não aceita URL como exemplo de header de mídia na criação do
 * template: exige um `header_handle`, obtido pela Resumable Upload API, que
 * roda no app (APP_ID + app access token) e não no WABA.
 *
 * Quando META_APP_ID/META_APP_SECRET não estão configurados, devolvemos
 * `template.media_upload_unavailable` (501) em vez de um erro opaco da Meta —
 * é falta de configuração do servidor, não erro do cliente.
 */
export async function uploadTemplateHeaderHandle(
  file: { buffer: Buffer; mimeType: string },
): Promise<string> {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) throw new ApiError('template.media_upload_unavailable');

  const appToken = `${appId}|${appSecret}`;

  try {
    // 1) sessão de upload
    const session = await axios.post(
      `${GRAPH_URL}/${appId}/uploads`,
      null,
      {
        params:  { file_length: file.buffer.length, file_type: file.mimeType },
        headers: { Authorization: `OAuth ${appToken}` },
        timeout: TIMEOUT_MS,
      },
    );
    const sessionId = String(session.data?.id ?? '');
    if (!sessionId) throw new ApiError('template.media_upload_unavailable', {
      message: 'A Meta não devolveu id de sessão de upload.',
    });

    // 2) envia os bytes (file_offset=0 — arquivo pequeno, uma tacada)
    const upload = await axios.post(`${GRAPH_URL}/${sessionId}`, file.buffer, {
      headers: {
        Authorization:  `OAuth ${appToken}`,
        file_offset:    '0',
        'Content-Type': 'application/octet-stream',
      },
      timeout: 60_000,
      maxBodyLength: Infinity,
    });

    const handle = upload.data?.h;
    if (!handle) throw new ApiError('template.create_failed', {
      message: 'A Meta não devolveu o header_handle do upload.',
    });
    return String(handle);
  } catch (err) {
    throw mapProviderError(err, { provider: 'meta', fallback: 'template.create_failed' });
  }
}
