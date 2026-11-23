/**
 * Templates do WhatsApp: validação local dos componentes (antes de submeter à Meta), montagem dos parâmetros de envio
 * e renderização do texto (para o histórico da conversa). Sem dependência de rede.
 */
export const TEMPLATE_CATEGORIES = ['UTILITY', 'MARKETING', 'AUTHENTICATION'] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export const TEMPLATE_NAME_RE = /^[a-z0-9_]{1,512}$/;
export const TEMPLATE_LANG_RE = /^[a-z]{2,3}(_[A-Z]{2})?$/;

const VAR_RE = /\{\{\s*(\d+)\s*\}\}/g;
const MEDIA_FORMATS = ['IMAGE', 'VIDEO', 'DOCUMENT'] as const;

export class TemplateParamError extends Error {}

export function variablesOf(text: string | undefined | null): number[] {
  return [...(text ?? '').matchAll(VAR_RE)].map((m) => Number(m[1]));
}
const countVars = (text: string | undefined | null): number => new Set(variablesOf(text)).size;

function checkVars(label: string, text: string, errors: string[], max = Infinity): number {
  const vars = variablesOf(text);
  const n = new Set(vars).size;
  const seq = [...new Set(vars)].sort((a, b) => a - b);
  if (seq.some((v, i) => v !== i + 1)) errors.push(`${label}: as variáveis devem ser sequenciais a partir de {{1}}`);
  if (n > max) errors.push(`${label}: no máximo ${max} variável(is)`);
  if (n > 0 && (/^\s*\{\{/.test(text) || /\}\}\s*$/.test(text))) errors.push(`${label}: o texto não pode começar nem terminar com variável`);
  return n;
}

export function validateTemplateComponents(components: unknown, category: string): string[] {
  const errors: string[] = [];
  if (!Array.isArray(components) || components.length === 0) return ['components deve ser uma lista não vazia'];
  const byType = new Map<string, any[]>();
  for (const c of components as any[]) {
    const t = String(c?.type ?? '').toUpperCase();
    if (!['HEADER', 'BODY', 'FOOTER', 'BUTTONS'].includes(t)) { errors.push(`Componente com tipo inválido: ${String(c?.type)}`); continue; }
    byType.set(t, [...(byType.get(t) ?? []), c]);
  }
  for (const [t, list] of byType) if (list.length > 1) errors.push(`Componente ${t} duplicado`);
  const body = byType.get('BODY')?.[0];
  if (!body) errors.push('BODY é obrigatório');
  else {
    const text = String(body.text ?? '');
    if (!text.trim()) errors.push('BODY: texto obrigatório');
    else {
      if (text.length > 1024) errors.push('BODY: no máximo 1024 caracteres');
      const n = checkVars('BODY', text, errors);
      if (n > 0 && category !== 'AUTHENTICATION') {
        const ex = body.example?.body_text?.[0];
        if (!Array.isArray(ex) || ex.length !== n) errors.push(`BODY: informe example.body_text com ${n} exemplo(s) (a Meta exige exemplos para variáveis)`);
      }
    }
  }
  const header = byType.get('HEADER')?.[0];
  if (header) {
    const fmt = String(header.format ?? 'TEXT').toUpperCase();
    if (fmt === 'TEXT') {
      const text = String(header.text ?? '');
      if (!text.trim()) errors.push('HEADER: texto obrigatório');
      if (text.length > 60) errors.push('HEADER: no máximo 60 caracteres');
      const n = checkVars('HEADER', text, errors, 1);
      if (n > 0 && !(Array.isArray(header.example?.header_text) && header.example.header_text.length === n)) errors.push('HEADER: informe example.header_text');
    } else if ((MEDIA_FORMATS as readonly string[]).includes(fmt)) {
      if (!Array.isArray(header.example?.header_handle) || !header.example.header_handle.length) errors.push(`HEADER ${fmt}: informe example.header_handle (handle da mídia de exemplo)`);
    } else errors.push(`HEADER: formato inválido (${fmt})`);
  }
  const footer = byType.get('FOOTER')?.[0];
  if (footer) {
    const text = String(footer.text ?? '');
    if (!text.trim()) errors.push('FOOTER: texto obrigatório');
    if (text.length > 60) errors.push('FOOTER: no máximo 60 caracteres');
    if (variablesOf(text).length) errors.push('FOOTER: não aceita variáveis');
  }
  const buttons = byType.get('BUTTONS')?.[0];
  if (buttons) {
    const list: any[] = Array.isArray(buttons.buttons) ? buttons.buttons : [];
    if (!list.length) errors.push('BUTTONS: informe ao menos um botão');
    if (list.length > 10) errors.push('BUTTONS: no máximo 10 botões');
    list.forEach((b, i) => {
      const bt = String(b?.type ?? '').toUpperCase();
      const label = `BUTTONS[${i}]`;
      if (!String(b?.text ?? '').trim() && bt !== 'OTP') errors.push(`${label}: texto obrigatório`);
      if (String(b?.text ?? '').length > 25) errors.push(`${label}: texto com no máximo 25 caracteres`);
      if (bt === 'URL') {
        if (!/^https:\/\//i.test(String(b.url ?? ''))) errors.push(`${label}: url https obrigatória`);
        if (variablesOf(b.url).length > 1) errors.push(`${label}: url aceita no máximo 1 variável`);
        if (variablesOf(b.url).length === 1 && !(Array.isArray(b.example) && b.example.length)) errors.push(`${label}: informe example para url com variável`);
      } else if (bt === 'PHONE_NUMBER') {
        if (!/^\+?\d{8,15}$/.test(String(b.phone_number ?? ''))) errors.push(`${label}: phone_number inválido`);
      } else if (!['QUICK_REPLY', 'OTP', 'COPY_CODE', 'FLOW'].includes(bt)) errors.push(`${label}: tipo de botão inválido (${String(b?.type)})`);
    });
  }
  return errors;
}

// ── Parâmetros de envio ──────────────────────────────────────────────────────
export type HeaderMediaParam = { type: 'image' | 'video' | 'document'; link?: string; id?: string; filename?: string };
export interface TemplateSendParams {
  header?: string[] | HeaderMediaParam;
  body?: string[];
  buttons?: Array<{ index: number; type: 'url' | 'quick_reply'; param: string }>;
}
export interface TemplateSendMeta {
  templateName?: string;
  language?: string;
  params?: string[] | TemplateSendParams;
  /** Componentes já no formato da Graph (substitui `params`). */
  components?: any[];
}

/** A Meta recusa parâmetros com quebra de linha/tab ou 4+ espaços seguidos (erro 132018). */
export const sanitizeParam = (v: unknown): string => String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim().slice(0, 1024);

function normParams(meta: TemplateSendMeta): TemplateSendParams {
  const p = meta.params;
  if (Array.isArray(p)) return { body: p };
  return p ?? {};
}

const find = (components: any[], type: string) => (Array.isArray(components) ? components : []).find((c) => String(c?.type).toUpperCase() === type);

/** Monta `template.components` da Graph; valida contagens contra o template aprovado. */
export function buildTemplateComponents(stored: unknown, meta: TemplateSendMeta): any[] {
  if (Array.isArray(meta.components) && meta.components.length) {
    for (const c of meta.components) if (!c || typeof c !== 'object' || !c.type) throw new TemplateParamError('components inválido');
    return meta.components;
  }
  const params = normParams(meta);
  const out: any[] = [];
  const header = find(stored as any[], 'HEADER');
  const fmt = String(header?.format ?? 'TEXT').toUpperCase();
  if (header) {
    if (fmt === 'TEXT') {
      const need = countVars(header.text);
      const got = Array.isArray(params.header) ? params.header : [];
      if (got.length !== need) throw new TemplateParamError(`HEADER espera ${need} parâmetro(s), recebeu ${got.length}`);
      if (need) out.push({ type: 'header', parameters: got.map((t) => ({ type: 'text', text: sanitizeParam(t) })) });
    } else {
      const h = params.header as HeaderMediaParam | undefined;
      if (!h || Array.isArray(h) || !(h.link || h.id) || h.type?.toUpperCase() !== fmt) throw new TemplateParamError(`HEADER ${fmt} exige params.header = { type: '${fmt.toLowerCase()}', link|id }`);
      const t = fmt.toLowerCase();
      out.push({ type: 'header', parameters: [{ type: t, [t]: { ...(h.id ? { id: h.id } : { link: h.link }), ...(t === 'document' && h.filename ? { filename: h.filename } : {}) } }] });
    }
  }
  const body = find(stored as any[], 'BODY');
  const needBody = countVars(body?.text);
  const gotBody = params.body ?? [];
  if (gotBody.length !== needBody) throw new TemplateParamError(`BODY espera ${needBody} parâmetro(s), recebeu ${gotBody.length}`);
  if (needBody) out.push({ type: 'body', parameters: gotBody.map((t) => ({ type: 'text', text: sanitizeParam(t) })) });
  const btns = find(stored as any[], 'BUTTONS');
  const dynamic = (Array.isArray(btns?.buttons) ? btns.buttons : []).map((b: any, i: number) => ({ b, i })).filter((x: any) => String(x.b?.type).toUpperCase() === 'URL' && variablesOf(x.b.url).length > 0);
  const given = params.buttons ?? [];
  if (given.length !== dynamic.length) throw new TemplateParamError(`BUTTONS: esperado(s) ${dynamic.length} parâmetro(s) de botão, recebeu ${given.length}`);
  for (const g of given) {
    if (!dynamic.some((d: any) => d.i === g.index)) throw new TemplateParamError(`BUTTONS: índice ${g.index} não aceita parâmetro`);
    out.push({ type: 'button', sub_type: g.type === 'quick_reply' ? 'quick_reply' : 'url', index: String(g.index), parameters: [{ type: g.type === 'quick_reply' ? 'payload' : 'text', [g.type === 'quick_reply' ? 'payload' : 'text']: sanitizeParam(g.param) }] });
  }
  return out;
}

const fill = (text: string, values: string[]): string => text.replace(VAR_RE, (_m, n) => values[Number(n) - 1] ?? '');

/** Texto legível do template preenchido (cabeçalho de texto + corpo + rodapé) — vai para o histórico da conversa. */
export function renderTemplateText(stored: unknown, meta: TemplateSendMeta): string {
  const params = normParams(meta);
  const parts: string[] = [];
  const header = find(stored as any[], 'HEADER');
  if (header && String(header.format ?? 'TEXT').toUpperCase() === 'TEXT' && header.text) parts.push(fill(String(header.text), Array.isArray(params.header) ? params.header.map(sanitizeParam) : []));
  const body = find(stored as any[], 'BODY');
  if (body?.text) parts.push(fill(String(body.text), (params.body ?? []).map(sanitizeParam)));
  const footer = find(stored as any[], 'FOOTER');
  if (footer?.text) parts.push(String(footer.text));
  return parts.join('\n\n');
}

export const usageItemFor = (category: string): 'WA_UTILITY' | 'WA_MARKETING' => (category === 'MARKETING' ? 'WA_MARKETING' : 'WA_UTILITY');
