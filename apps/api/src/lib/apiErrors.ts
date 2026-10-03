/**
 * Catálogo canônico de códigos de erro da plataforma ZapScript.
 *
 * ESTE ARQUIVO É PURO DE PROPÓSITO (zero import de Fastify/Prisma): o worker
 * precisa do mesmo catálogo para carimbar `errorCode` no log de mensagens e
 * decidir retry, e os Dockerfiles de api e worker não compartilham
 * packages/* (ver comentário em apps/api/src/services/ai-fallback.ts). Então
 * ele é COPIADO byte a byte em apps/worker/src/lib/apiErrors.ts, e um teste
 * (apps/api/src/__tests__/apiErrors.test.ts) falha se as duas cópias
 * divergirem. O que depende de Fastify vive em lib/httpErrors.ts.
 *
 * Por que isto existe (item 6 do escopo ZapScript × Twilio): até aqui cada rota
 * devolvia `{ error: '<frase em português>' }`. Serve para o painel, mas é
 * inútil para quem integra por API — a frase muda com qualquer revisão de
 * texto e não há como programar `if (erro === X) tratar assim`. Um integrador
 * precisa de um identificador ESTÁVEL, de um HTTP status coerente e de saber
 * se vale a pena tentar de novo.
 *
 * Contrato público (vale para /public/v1/*, para o log de mensagens e para o
 * payload dos eventos de webhook):
 *
 *   {
 *     "error": {
 *       "code":       "message.outside_window",   // ESTÁVEL — pode virar if/switch
 *       "message":    "...",                      // humano, pode mudar a qualquer momento
 *       "docUrl":    "https://.../erros/message.outside_window",
 *       "requestId": "req-1",                     // casa com o log do servidor
 *       "retryable":  false,                      // tentar de novo pode funcionar?
 *       "details":    { ... }                     // opcional (ex.: erros de validação)
 *     }
 *   }
 *
 * REGRA: nunca renomeie nem remova um código já publicado — é API pública.
 * Códigos novos podem ser acrescentados a qualquer momento; o cliente deve
 * tratar código desconhecido pelo prefixo de domínio (`message.`, `template.`…)
 * ou pelo status HTTP.
 *
 * As rotas antigas do painel (autenticadas por JWT) seguem com `{ error: '...' }`
 * — não foram migradas de propósito, para não quebrar o front.
 */

export interface ErrorSpec {
  /** HTTP status devolvido quando o erro nasce numa requisição. */
  status: number;
  /** Mensagem padrão (pt-BR). O chamador pode sobrepor com algo mais específico. */
  message: string;
  /**
   * true = a MESMA requisição, repetida, pode dar certo (indisponibilidade,
   * throttle, timeout). Usado pelo worker para decidir entre retentar o job e
   * marcar como falha definitiva — e exposto ao integrador no envelope.
   */
  retryable?: boolean;
}

export const ERROR_CATALOG = {
  // ── Autenticação / autorização da API pública ─────────────────────────────
  'auth.key_missing':          { status: 401, message: 'Envie a chave no header X-Api-Key.' },
  'auth.key_invalid':          { status: 401, message: 'Chave inválida ou revogada.' },
  'auth.scope_missing':        { status: 403, message: 'Esta chave não tem o escopo necessário.' },
  'auth.plan_required':        { status: 402, message: 'A API pública é exclusiva do tier Empresas.' },

  // ── Requisição ────────────────────────────────────────────────────────────
  'request.invalid':           { status: 400, message: 'Requisição inválida.' },
  'request.not_found':         { status: 404, message: 'Recurso não encontrado.' },
  'request.conflict':          { status: 409, message: 'Conflito com o estado atual do recurso.' },
  'request.rate_limited':      { status: 429, message: 'Limite de requisições excedido. Tente de novo em instantes.', retryable: true },

  // ── Idempotência ──────────────────────────────────────────────────────────
  'idempotency.key_invalid':   { status: 400, message: 'Idempotency-Key deve ter entre 8 e 255 caracteres.' },
  'idempotency.request_mismatch': {
    status: 422,
    message: 'Esta Idempotency-Key já foi usada com um corpo diferente. Use uma chave nova para uma requisição nova.',
  },
  'idempotency.in_progress':   { status: 409, message: 'Uma requisição com esta Idempotency-Key ainda está sendo processada.', retryable: true },

  // ── Número de WhatsApp ────────────────────────────────────────────────────
  'number.not_found':          { status: 404, message: 'Número de WhatsApp não encontrado nesta conta.' },
  'number.disconnected':       { status: 409, message: 'O número não está conectado.' },
  'number.missing_credentials': { status: 409, message: 'O número não tem credenciais válidas para envio — reconecte-o.' },
  'number.not_registered':     { status: 400, message: 'O número remetente não está registrado na Meta.' },

  // ── Envio de mensagem ─────────────────────────────────────────────────────
  'message.invalid_recipient': { status: 400, message: 'Destinatário inválido ou sem WhatsApp.' },
  'message.body_required':     { status: 400, message: 'Informe o conteúdo da mensagem.' },
  'message.type_unsupported':  { status: 400, message: 'Tipo de mensagem não suportado neste canal.' },
  'message.media_url_invalid': { status: 400, message: 'A URL da mídia é inválida ou inacessível pelo WhatsApp.' },
  'message.recipient_opted_out': { status: 409, message: 'O destinatário pediu para não receber mensagens (opt-out).' },
  'message.outside_window':    { status: 409, message: 'Fora da janela de 24h: use uma mensagem de template aprovado.' },
  'message.undeliverable':     { status: 400, message: 'A Meta não conseguiu entregar a mensagem a este destinatário.' },
  'message.throttled':         { status: 429, message: 'Limite de mensageria do número atingido.', retryable: true },
  'message.not_found':         { status: 404, message: 'Mensagem não encontrada.' },

  // ── Templates (Meta) ──────────────────────────────────────────────────────
  'template.not_found':        { status: 400, message: 'Template não encontrado no WABA deste número.' },
  'template.not_approved':     { status: 409, message: 'O template não está aprovado (pausado, desabilitado ou em análise).' },
  'template.param_mismatch':   { status: 400, message: 'As variáveis enviadas não casam com o template aprovado.' },
  'template.header_media_required': { status: 400, message: 'Este template tem header de mídia — informe template.header.' },
  'template.header_media_unsupported': { status: 400, message: 'Este template não aceita header de mídia.' },
  'template.create_failed':    { status: 502, message: 'A Meta recusou a criação do template.' },
  'template.delete_failed':    { status: 502, message: 'A Meta recusou a exclusão do template.' },
  'template.media_upload_unavailable': {
    status: 501,
    message: 'Upload de mídia para template indisponível — META_APP_ID/META_APP_SECRET não configurados no servidor.',
  },

  // ── Webhooks de saída (sistema de eventos) ────────────────────────────────
  'webhook.url_invalid':       { status: 400, message: 'URL de webhook inválida.' },
  'webhook.url_blocked':       { status: 400, message: 'URL de webhook aponta para um endereço interno não permitido.' },
  'webhook.endpoint_not_found': { status: 404, message: 'Endpoint de webhook não encontrado.' },
  'webhook.limit_reached':     { status: 400, message: 'Limite de endpoints de webhook atingido.' },
  'webhook.event_unknown':     { status: 400, message: 'Tipo de evento desconhecido.' },
  'webhook.delivery_failed':   { status: 502, message: 'O endpoint não respondeu com sucesso.', retryable: true },

  // ── Conta / saldo ─────────────────────────────────────────────────────────
  'account.restricted':        { status: 403, message: 'A conta de WhatsApp Business está restrita pela Meta.' },
  'account.balance_insufficient': { status: 402, message: 'Saldo insuficiente para enviar.' },

  // ── Provedor / infra ──────────────────────────────────────────────────────
  'provider.unavailable':      { status: 502, message: 'O provedor de WhatsApp está indisponível.', retryable: true },
  'provider.timeout':          { status: 504, message: 'O provedor de WhatsApp não respondeu no tempo esperado.', retryable: true },
  'provider.rejected':         { status: 502, message: 'O provedor de WhatsApp recusou a requisição.' },
  'internal.error':            { status: 500, message: 'Erro interno. Tente de novo; se persistir, fale com o suporte.', retryable: true },
} as const satisfies Record<string, ErrorSpec>;

export type ErrorCode = keyof typeof ERROR_CATALOG;

/**
 * Mesma tabela, vista como Record<ErrorCode, ErrorSpec>. O `as const` acima
 * serve para inferir ErrorCode a partir das chaves; esta view é para LER os
 * campos (sem ela, `retryable` só existe nas entradas que o declaram).
 */
const CATALOG: Record<ErrorCode, ErrorSpec> = ERROR_CATALOG;

/** Base da documentação de erros (sobreponível por env em ambientes de teste). */
const DOCS_BASE = (process.env.DOCS_ERRORS_BASE_URL || 'https://zapscript.me/docs/erros').replace(/\/+$/, '');

export function errorDocUrl(code: ErrorCode | string): string {
  return `${DOCS_BASE}/${code}`;
}

export function errorSpec(code: ErrorCode): ErrorSpec {
  return CATALOG[code];
}

/** true quando repetir a mesma requisição/job pode dar certo. */
export function isRetryable(code: ErrorCode | string): boolean {
  const spec = (CATALOG as Record<string, ErrorSpec | undefined>)[code];
  return Boolean(spec?.retryable);
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    docUrl: string;
    retryable: boolean;
    requestId?: string;
    details?: unknown;
  };
}

/**
 * Erro com código do catálogo. Serve tanto para abortar uma rota (o handler
 * traduz em HTTP) quanto para carregar o código até o log de mensagens e o
 * payload dos eventos.
 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: unknown;
  /** Código cru devolvido pelo provedor (ex.: 131047 da Meta) — só para debug. */
  readonly providerCode?: string;

  constructor(
    code: ErrorCode,
    opts: { message?: string; details?: unknown; providerCode?: string; retryable?: boolean } = {},
  ) {
    const spec = CATALOG[code];
    super(opts.message || spec.message);
    this.name = 'ApiError';
    this.code = code;
    this.status = spec.status;
    this.retryable = opts.retryable ?? Boolean(spec.retryable);
    this.details = opts.details;
    this.providerCode = opts.providerCode;
  }

  toEnvelope(requestId?: string): ApiErrorEnvelope {
    return {
      error: {
        code:      this.code,
        message:   this.message,
        docUrl:    errorDocUrl(this.code),
        retryable: this.retryable,
        ...(requestId ? { requestId } : {}),
        ...(this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError || (err as any)?.name === 'ApiError';
}

// ─────────────────────────────────────────────────────────────────────────────
// Tradução de erro de provedor → código ZapScript
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Códigos de erro da Cloud API da Meta → código ZapScript.
 *
 * Fonte: "Cloud API error codes" (developers.facebook.com). Mapeia só o que
 * muda a decisão de quem integra; o resto cai no fallback por faixa/status.
 * Um código novo da Meta nunca quebra nada — vira `provider.rejected`.
 */
const META_ERROR_MAP: Record<number, ErrorCode> = {
  0:      'number.missing_credentials',   // AuthException
  3:      'auth.plan_required',           // capability/permission ausente no app
  33:     'request.not_found',
  100:    'request.invalid',
  190:    'number.missing_credentials',   // token expirado/invalidado
  368:    'account.restricted',           // bloqueio temporário por política
  4:      'message.throttled',            // too many calls (app level)
  80007:  'message.throttled',            // rate limit do WABA
  130429: 'message.throttled',            // rate limit de mensageria
  131056: 'message.throttled',            // pair rate limit (par remetente/destinatário)
  130472: 'message.undeliverable',        // destinatário fora do experimento
  131000: 'provider.unavailable',
  131005: 'account.restricted',
  131008: 'request.invalid',              // parâmetro obrigatório ausente
  131009: 'request.invalid',              // valor de parâmetro inválido
  131016: 'provider.unavailable',         // serviço indisponível
  131021: 'message.invalid_recipient',    // remetente == destinatário
  131026: 'message.undeliverable',        // não entregável (sem WhatsApp, bloqueado…)
  131031: 'account.restricted',           // conta bloqueada
  131042: 'account.balance_insufficient', // problema de pagamento/elegibilidade
  131045: 'number.missing_credentials',   // certificado/registro incorreto
  131047: 'message.outside_window',       // exige re-engajamento por template
  131051: 'message.type_unsupported',
  131052: 'message.media_url_invalid',    // falha ao baixar a mídia
  131053: 'message.media_url_invalid',    // falha ao subir a mídia
  132000: 'template.param_mismatch',      // nº de parâmetros diferente do template
  132001: 'template.not_found',
  132005: 'template.param_mismatch',      // texto hidratado maior que o limite
  132007: 'template.param_mismatch',      // violação de política de formato
  132012: 'template.param_mismatch',      // formato do parâmetro não casa
  132015: 'template.not_approved',        // template pausado
  132016: 'template.not_approved',        // template desabilitado
  132068: 'template.not_approved',        // flow bloqueado
  133010: 'number.not_registered',
  135000: 'request.invalid',
};

/** Erros da Evolution API vêm como texto livre — casamos por padrão. */
const EVOLUTION_PATTERNS: Array<[RegExp, ErrorCode]> = [
  [/connection\s*closed|connection\s*lost|not\s*connected|close[d]?\s*state/i, 'number.disconnected'],
  [/instance\s*(does\s*not\s*exist|not\s*found)|does\s*not\s*exist/i,          'number.disconnected'],
  [/exists["'\s:]*false|number\s*(does\s*not\s*exist|not\s*exists?)|invalid\s*(jid|number)/i, 'message.invalid_recipient'],
  [/rate\s*limit|too\s*many\s*requests/i,                                      'request.rate_limited'],
  [/timeout|timed\s*out/i,                                                      'provider.timeout'],
  [/unauthorized|invalid\s*api\s*key|forbidden/i,                               'number.missing_credentials'],
];

function pickStatusFallback(httpStatus?: number): ErrorCode {
  if (!httpStatus) return 'provider.unavailable';
  if (httpStatus === 401 || httpStatus === 403) return 'number.missing_credentials';
  if (httpStatus === 404) return 'request.not_found';
  if (httpStatus === 408) return 'provider.timeout';
  if (httpStatus === 429) return 'request.rate_limited';
  if (httpStatus >= 500)  return 'provider.unavailable';
  if (httpStatus >= 400)  return 'provider.rejected';
  return 'provider.unavailable';
}

export interface ProviderErrorShape {
  /** Status HTTP da resposta do provedor, quando houver. */
  httpStatus?: number;
  /** Corpo da resposta (data do axios) — lido sem assumir formato. */
  body?: any;
  /** Código de erro de rede do Node (ECONNRESET, ETIMEDOUT…). */
  errno?: string;
  /** Mensagem final, caso nada acima exista. */
  message?: string;
}

/** Extrai o formato acima de um erro do axios (ou de um Error qualquer). */
export function describeProviderError(err: unknown): ProviderErrorShape {
  const anyErr = err as any;
  const response = anyErr?.response;
  return {
    httpStatus: typeof response?.status === 'number' ? response.status : undefined,
    body:       response?.data,
    errno:      typeof anyErr?.code === 'string' ? anyErr.code : undefined,
    message:    typeof anyErr?.message === 'string' ? anyErr.message : String(err ?? ''),
  };
}

/** Texto humano mais útil que conseguirmos extrair da resposta do provedor. */
export function providerErrorMessage(err: unknown): string {
  const { body, message } = describeProviderError(err);
  return (
    body?.error?.error_user_msg ||
    body?.error?.message ||
    body?.message ||
    body?.response?.message ||
    (typeof body === 'string' ? body : '') ||
    message ||
    'Erro desconhecido do provedor'
  );
}

/**
 * Converte a falha de um provedor (Meta Graph API / Evolution API / rede) num
 * ApiError com código do catálogo. É o ponto em que "erro de terceiro" passa a
 * ter identidade nossa — e por onde o log de mensagens e os eventos de webhook
 * ganham um `error_code` programável em vez de uma frase da Meta.
 */
export function mapProviderError(
  err: unknown,
  opts: { provider?: 'meta' | 'evolution'; fallback?: ErrorCode } = {},
): ApiError {
  if (isApiError(err)) return err as ApiError;

  const { httpStatus, body, errno, message } = describeProviderError(err);
  const text = providerErrorMessage(err);

  // Rede/timeout antes de qualquer resposta: nunca é culpa do payload.
  if (errno === 'ECONNABORTED' || errno === 'ETIMEDOUT' || /timeout|timed out/i.test(message || '')) {
    return new ApiError('provider.timeout', { message: text, providerCode: errno });
  }
  if (errno === 'ECONNREFUSED' || errno === 'ENOTFOUND' || errno === 'ECONNRESET' || errno === 'EAI_AGAIN') {
    return new ApiError('provider.unavailable', { message: text, providerCode: errno });
  }

  // Meta: código numérico na resposta (o campo mais confiável que ela dá).
  const rawMetaCode = body?.error?.code;
  const metaCode = typeof rawMetaCode === 'number' || typeof rawMetaCode === 'string'
    ? Number(rawMetaCode)
    : NaN;
  if (Number.isFinite(metaCode)) {
    const mapped = META_ERROR_MAP[metaCode];
    if (mapped) {
      return new ApiError(mapped, { message: text, providerCode: String(metaCode) });
    }
  }

  // Evolution (e qualquer provedor sem código): casamento por texto.
  if (opts.provider !== 'meta') {
    for (const [pattern, code] of EVOLUTION_PATTERNS) {
      if (pattern.test(text)) {
        return new ApiError(code, { message: text });
      }
    }
  }

  const fallback = opts.fallback || pickStatusFallback(httpStatus);
  return new ApiError(fallback, {
    message: text,
    providerCode: Number.isFinite(metaCode) ? String(metaCode) : undefined,
  });
}
