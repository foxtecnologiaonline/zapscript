import { ApiError } from '../lib/apiErrors';

/**
 * Componentes de template da Cloud API — inclusive HEADER DE MÍDIA (item 8 do
 * escopo ZapScript × Twilio).
 *
 * Contexto: a Campanha já guardava `templateComponents` como JSON cru, então
 * tecnicamente um header de mídia "cabia". Na prática não existia: nada
 * montava o componente, nada validava a URL e nada checava se o template
 * aprovado esperava mídia no header. O resultado era o pior possível — a Meta
 * recusava o envio com um erro genérico (132012 / 131009) DEPOIS de a campanha
 * já estar rodando, contato por contato.
 *
 * Aqui o header de mídia passa a ser um campo de primeira classe, validado
 * ANTES do disparo contra a definição do template aprovado.
 *
 * Copiado byte a byte em apps/worker/src/services/template-components.ts
 * (api e worker não compartilham packages/*). Teste garante que não divergem.
 */

export type HeaderMediaType = 'image' | 'video' | 'document';

export interface TemplateHeaderMedia {
  type: HeaderMediaType;
  /** URL pública HTTPS da mídia, ou `id` de mídia já subida na Meta. */
  link?: string;
  /** Media ID da Meta (alternativa ao link — não expira em CDN de terceiro). */
  id?: string;
  /** Só para document: nome exibido ao destinatário. */
  filename?: string;
}

/** Formato do header declarado no template aprovado. */
export type TemplateHeaderFormat = 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'LOCATION' | 'NONE';

export interface MetaTemplateComponentLike {
  type: string;
  format?: string;
  text?: string;
  example?: any;
  buttons?: any[];
}

export interface MetaTemplateLike {
  name: string;
  status?: string;
  language?: string;
  components?: MetaTemplateComponentLike[];
}

/** Extensões que a Meta aceita por tipo de header (usado para barrar erro óbvio antes do envio). */
const ALLOWED_EXTENSIONS: Record<HeaderMediaType, string[]> = {
  image:    ['jpg', 'jpeg', 'png'],
  video:    ['mp4', '3gp'],
  document: ['pdf'],
};

/** Qual formato de header o template aprovado declara. */
export function templateHeaderFormat(template: MetaTemplateLike | null | undefined): TemplateHeaderFormat {
  const header = template?.components?.find((c) => String(c.type).toUpperCase() === 'HEADER');
  if (!header) return 'NONE';
  const format = String(header.format || 'TEXT').toUpperCase();
  return (['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT', 'LOCATION'].includes(format)
    ? format
    : 'TEXT') as TemplateHeaderFormat;
}

/** true quando o template exige mídia no header (image/video/document). */
export function templateRequiresHeaderMedia(template: MetaTemplateLike | null | undefined): boolean {
  return ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(templateHeaderFormat(template));
}

/**
 * Quantas variáveis {{n}} DISTINTAS um texto usa.
 *
 * Distintas, não ocorrências: "Olá {{1}}, seu pedido {{2}} chegou, {{1}}" usa
 * duas variáveis e espera dois parâmetros — contar ocorrências pediria três e
 * a Meta recusaria com 132000.
 */
export function countTextVariables(text: string | null | undefined): number {
  if (!text) return 0;
  const found = new Set<string>();
  for (const m of text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) found.add(m[1]);
  return found.size;
}

/** Quantas variáveis {{n}} o corpo do template aprovado espera. */
export function templateBodyVarCount(template: MetaTemplateLike | null | undefined): number {
  const body = template?.components?.find((c) => String(c.type).toUpperCase() === 'BODY');
  return countTextVariables(body?.text);
}

/** Quantas variáveis {{n}} o header de TEXTO do template espera. */
export function templateHeaderVarCount(template: MetaTemplateLike | null | undefined): number {
  if (templateHeaderFormat(template) !== 'TEXT') return 0;
  const header = template?.components?.find((c) => String(c.type).toUpperCase() === 'HEADER');
  return countTextVariables(header?.text);
}

/**
 * Valida a mídia do header antes de chamar a Meta. Erro aqui é 400 com código
 * nosso (`message.media_url_invalid`), não um 132012 opaco no meio do disparo.
 */
export function validateHeaderMedia(header: TemplateHeaderMedia): void {
  if (!header || typeof header !== 'object') {
    throw new ApiError('request.invalid', { message: 'template.header deve ser um objeto.' });
  }
  if (!['image', 'video', 'document'].includes(header.type)) {
    throw new ApiError('template.header_media_unsupported', {
      message: `Tipo de header de mídia inválido: "${header.type}". Use image, video ou document.`,
    });
  }
  if (!header.link && !header.id) {
    throw new ApiError('message.media_url_invalid', {
      message: 'Informe template.header.link (URL HTTPS pública) ou template.header.id (media id da Meta).',
    });
  }
  if (header.id && !header.link) return; // media id já validado pela Meta no upload

  let url: URL;
  try {
    url = new URL(header.link!);
  } catch {
    throw new ApiError('message.media_url_invalid', { message: 'template.header.link não é uma URL válida.' });
  }
  // HTTPS obrigatório: a Meta baixa a mídia pela internet pública e recusa http.
  if (url.protocol !== 'https:') {
    throw new ApiError('message.media_url_invalid', {
      message: 'A URL da mídia do header precisa ser HTTPS — a Meta não baixa de http://.',
    });
  }

  const ext = (url.pathname.split('.').pop() || '').toLowerCase();
  const allowed = ALLOWED_EXTENSIONS[header.type];
  // Sem extensão na URL (comum em links assinados/CDN) não é erro — quem decide
  // é o Content-Type que a Meta vai ler. Extensão ERRADA, sim, é erro certo.
  if (ext && ext.length <= 5 && !allowed.includes(ext)) {
    throw new ApiError('message.media_url_invalid', {
      message: `Header do tipo ${header.type} aceita ${allowed.join(', ')} — recebido ".${ext}".`,
      details: { allowed },
    });
  }
  if (header.type === 'document' && !header.filename) {
    // Sem filename o WhatsApp mostra a URL inteira como nome do arquivo.
    throw new ApiError('request.invalid', {
      message: 'Header de documento exige template.header.filename (nome exibido ao destinatário).',
    });
  }
}

/** Componente `header` no formato da Graph API. */
export function buildHeaderComponent(header: TemplateHeaderMedia): Record<string, any> {
  const media: Record<string, any> = header.id ? { id: header.id } : { link: header.link };
  if (header.type === 'document' && header.filename) media.filename = header.filename;
  return { type: 'header', parameters: [{ type: header.type, [header.type]: media }] };
}

/** Componente `body` com as variáveis posicionais ({{1}}, {{2}}…). */
export function buildBodyComponent(variables: Array<string | number>): Record<string, any> {
  return {
    type: 'body',
    parameters: variables.map((v) => ({ type: 'text', text: String(v ?? '') })),
  };
}

/**
 * Monta a lista final de componentes.
 *
 * `staticComponents` é o que já estava salvo na Campanha (botões com URL
 * dinâmica, header de texto…). Componentes montados aqui SOBREPÕEM os
 * estáticos do mesmo tipo — se o chamador informou um header de mídia, é ele
 * que vale, não um header antigo gravado no rascunho da campanha.
 *
 * A saída sai na ordem canônica header → body → demais, preservando a ordem
 * relativa dos estáticos restantes. A Graph API não exige ordem (ela lê o
 * campo `type`), mas manter esta é o que faz o payload continuar idêntico ao
 * de antes para as campanhas que já existem — e é a ordem que qualquer um
 * espera ao ler o log de um envio.
 */
export function buildTemplateComponents(opts: {
  header?: TemplateHeaderMedia | null;
  bodyVariables?: Array<string | number> | null;
  staticComponents?: Array<Record<string, any>> | null;
}): Array<Record<string, any>> {
  const typeOf = (comp: any) => String(comp?.type || '').toLowerCase();

  const generated = new Map<string, Record<string, any>>();
  if (opts.header) {
    validateHeaderMedia(opts.header);
    generated.set('header', buildHeaderComponent(opts.header));
  }
  if (opts.bodyVariables && opts.bodyVariables.length > 0) {
    generated.set('body', buildBodyComponent(opts.bodyVariables));
  }

  // Estáticos sobrepostos por um componente gerado saem fora.
  const statics = (opts.staticComponents || []).filter((c) => {
    const type = typeOf(c);
    return Boolean(type) && !generated.has(type);
  });

  const out: Array<Record<string, any>> = [];
  const header = generated.get('header') ?? statics.find((c) => typeOf(c) === 'header');
  if (header) out.push(header);
  const body = generated.get('body') ?? statics.find((c) => typeOf(c) === 'body');
  if (body) out.push(body);
  for (const comp of statics) {
    const type = typeOf(comp);
    if (type === 'header' || type === 'body') continue;
    out.push(comp);
  }

  return out;
}

/**
 * Checa o envio contra a definição do template aprovado, ANTES de chamar a
 * Meta. É o que troca "131009 Parameter value is not valid" por um erro nosso
 * que diz exatamente o que falta.
 */
export function assertTemplateSendable(opts: {
  template: MetaTemplateLike | null | undefined;
  header?: TemplateHeaderMedia | null;
  bodyVariables?: Array<string | number> | null;
}): void {
  const { template, header } = opts;
  if (!template) throw new ApiError('template.not_found');

  if (template.status && template.status.toUpperCase() !== 'APPROVED') {
    throw new ApiError('template.not_approved', {
      message: `O template "${template.name}" está em ${template.status} — só APPROVED pode ser enviado.`,
      details: { status: template.status },
    });
  }

  const requiresMedia = templateRequiresHeaderMedia(template);
  if (requiresMedia && !header) {
    throw new ApiError('template.header_media_required', {
      message: `O template "${template.name}" tem header de ${templateHeaderFormat(template).toLowerCase()} — informe template.header.`,
      details: { headerFormat: templateHeaderFormat(template) },
    });
  }
  if (!requiresMedia && header) {
    throw new ApiError('template.header_media_unsupported', {
      message: `O template "${template.name}" não tem header de mídia (header: ${templateHeaderFormat(template)}).`,
      details: { headerFormat: templateHeaderFormat(template) },
    });
  }
  if (requiresMedia && header) {
    const expected = templateHeaderFormat(template).toLowerCase();
    if (header.type !== expected) {
      throw new ApiError('template.header_media_unsupported', {
        message: `O header do template é ${expected}, mas foi enviado ${header.type}.`,
        details: { expected, received: header.type },
      });
    }
    validateHeaderMedia(header);
  }

  const expectedVars = templateBodyVarCount(template);
  const receivedVars = opts.bodyVariables?.length ?? 0;
  if (expectedVars !== receivedVars) {
    throw new ApiError('template.param_mismatch', {
      message: `O template "${template.name}" espera ${expectedVars} variável(is) no corpo — recebidas ${receivedVars}.`,
      details: { expected: expectedVars, received: receivedVars },
    });
  }
}
