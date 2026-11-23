import { z } from 'zod';
import { isWithinBusinessHours, localParts, type BusinessHours, type BvOrgSettings } from '../../core/settings';

/**
 * Motor da URA (IVR) — PURO: não conhece Asterisk, banco nem rede. Recebe uma `IvrIO` (reprodução + DTMF)
 * e percorre a árvore de nós. A mesma árvore roda no controlador ARI (chamada real) e no simulador
 * (`simulate`, sem telefonia) — é o que torna a URA testável e demonstrável na PoC.
 *
 * Tipos de nó: menu · play · collect · schedule · language · queue · transfer · hangup.
 * Edital 1.1.3.1.6.1: cut-thru (barge-in), force-play, echo (repete os dígitos digitados), múltiplos idiomas.
 */

// ── Definição ────────────────────────────────────────────────────────────────────────────────────────
export interface PromptDef {
  text?: string;
  /** Chave de storage (core/storage) de um áudio enviado. Tem prioridade sobre `text`. */
  audioKey?: string;
  lang?: string;
  /** Variações por idioma: { en: { text }, es: { audioKey } } */
  i18n?: Record<string, { text?: string; audioKey?: string }>;
}

export interface ResolvedIvrPrompt { text: string; audioKey?: string; lang: string }

const DIGIT_KEY = /^[0-9*#]$/;
const NODE_ID = /^[A-Za-z0-9_.-]{1,64}$/;

const promptSchema = z.strictObject({
  text: z.string().max(1500).optional(),
  audioKey: z.string().max(300).optional(),
  lang: z.string().max(10).optional(),
  i18n: z.record(z.string(), z.strictObject({ text: z.string().max(1500).optional(), audioKey: z.string().max(300).optional() })).optional(),
}).refine((p) => !!(p.text || p.audioKey || p.i18n), { message: 'prompt precisa de text, audioKey ou i18n' });

const nodeId = z.string().regex(NODE_ID, 'id de nó inválido');
const retryFields = {
  maxRetries: z.number().int().min(0).max(10).optional(),
  timeoutSec: z.number().min(1).max(60).optional(),
  timeoutNode: nodeId.optional(),
  invalidNode: nodeId.optional(),
  timeoutPrompt: promptSchema.optional(),
  invalidPrompt: promptSchema.optional(),
};
const optionsSchema = z.record(z.string().regex(DIGIT_KEY, 'opção deve ser um dígito 0-9, * ou #'), nodeId);
const businessHoursSchema = z.record(z.string(), z.array(z.tuple([z.string().regex(/^\d{1,2}:\d{2}$/), z.string().regex(/^\d{1,2}:\d{2}$/)])));

export const ivrNodeSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('menu'), prompt: promptSchema, options: optionsSchema.refine((o) => Object.keys(o).length > 0, 'menu precisa de ao menos uma opção'),
    /** cut-thru: o chamador pode digitar durante o áudio (padrão: true). */
    bargeIn: z.boolean().optional(),
    /** force-play: aviso obrigatório, ignora DTMF até terminar. */
    forcePlay: z.boolean().optional(),
    /** Tecla que repete o menu sem contar tentativa (padrão '*', se não for uma opção). */
    repeatKey: z.string().regex(DIGIT_KEY).optional(),
    ...retryFields,
  }),
  z.strictObject({ type: z.literal('play'), prompt: promptSchema, next: nodeId, bargeIn: z.boolean().optional(), forcePlay: z.boolean().optional() }),
  z.strictObject({
    type: z.literal('collect'), prompt: promptSchema, var: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,30}$/), next: nodeId,
    minDigits: z.number().int().min(1).max(30).optional(), maxDigits: z.number().int().min(1).max(30).optional(),
    terminator: z.string().regex(DIGIT_KEY).nullable().optional(),
    validate: z.enum(['none', 'cpf', 'cnpj']).optional(),
    /** Dado sensível: o valor nunca é gravado em trilha/log/banco (padrão: true para cpf/cnpj). */
    sensitive: z.boolean().optional(),
    /** echo: repete os dígitos digitados ao chamador. */
    echo: z.boolean().optional(),
    /** Após o echo, pede confirmação (1 confirma, 2 digita de novo). */
    confirm: z.boolean().optional(),
    ...retryFields,
  }),
  z.strictObject({ type: z.literal('schedule'), open: nodeId, closed: nodeId, holiday: nodeId.optional(), hours: businessHoursSchema.optional() }),
  z.strictObject({
    type: z.literal('language'), prompt: promptSchema, languages: z.record(z.string().regex(DIGIT_KEY), z.string().min(2).max(10)).refine((o) => Object.keys(o).length > 0, 'language precisa de ao menos um idioma'),
    next: nodeId, ...retryFields,
  }),
  z.strictObject({
    type: z.literal('queue'), prompt: promptSchema.optional(), category: z.string().max(80).optional(), queue: z.string().max(120).optional(),
    priority: z.number().int().min(0).max(10).optional(), mohClass: z.string().max(40).optional(),
  }),
  z.strictObject({
    type: z.literal('transfer'), prompt: promptSchema.optional(),
    destination: z.strictObject({ type: z.enum(['external', 'extension', 'ura0800']), number: z.string().regex(/^\+?[0-9*#]{2,20}$/) }),
  }),
  z.strictObject({ type: z.literal('hangup'), prompt: promptSchema.optional() }),
]);

export const ivrDefinitionSchema = z.strictObject({
  start: nodeId,
  /** DIDs/0800 atendidos por este fluxo. */
  dids: z.array(z.string().regex(/^\+?[0-9*#]{2,20}$/)).max(50).optional(),
  defaultLang: z.string().max(10).optional(),
  /** Início alternativo conforme cabeçalho SIP da URA 0800 (ex.: X-URA-Option já escolhida). */
  entryByHeader: z.strictObject({ header: z.string().regex(/^[A-Za-z0-9-]{1,60}$/), map: z.record(z.string(), nodeId) }).optional(),
  nodes: z.record(nodeId, ivrNodeSchema),
});

export type IvrNode = z.infer<typeof ivrNodeSchema>;
export type IvrDefinition = z.infer<typeof ivrDefinitionSchema>;
export type IvrNodeType = IvrNode['type'];

// ── Validação estrutural + grafo ────────────────────────────────────────────────────────────────────
export interface IvrIssue { code: string; message: string; node?: string; path?: string }
export interface IvrValidation { ok: boolean; errors: IvrIssue[]; warnings: IvrIssue[]; definition?: IvrDefinition }

const TERMINALS: IvrNodeType[] = ['queue', 'transfer', 'hangup'];

/** Nós para onde um nó pode ir. */
export function edgesOf(n: IvrNode): string[] {
  switch (n.type) {
    case 'menu': return [...Object.values(n.options), ...(n.timeoutNode ? [n.timeoutNode] : []), ...(n.invalidNode ? [n.invalidNode] : [])];
    case 'play': return [n.next];
    case 'collect': return [n.next, ...(n.timeoutNode ? [n.timeoutNode] : []), ...(n.invalidNode ? [n.invalidNode] : [])];
    case 'schedule': return [n.open, n.closed, ...(n.holiday ? [n.holiday] : [])];
    case 'language': return [n.next, ...(n.timeoutNode ? [n.timeoutNode] : []), ...(n.invalidNode ? [n.invalidNode] : [])];
    default: return [];
  }
}

export function validateIvrDefinition(raw: unknown): IvrValidation {
  const errors: IvrIssue[] = [];
  const warnings: IvrIssue[] = [];
  const parsed = ivrDefinitionSchema.safeParse(raw);
  if (!parsed.success) {
    for (const i of parsed.error.issues) errors.push({ code: 'ivr.schema', message: i.message, path: i.path.join('.') });
    return { ok: false, errors, warnings };
  }
  const def = parsed.data;
  const ids = Object.keys(def.nodes);
  if (ids.length === 0) errors.push({ code: 'ivr.empty', message: 'O fluxo não tem nós' });
  if (ids.length > 500) errors.push({ code: 'ivr.too_big', message: 'Máximo de 500 nós por fluxo' });

  if (!def.nodes[def.start]) errors.push({ code: 'ivr.start_missing', message: `Nó inicial "${def.start}" não existe`, node: def.start });
  for (const [h, target] of Object.entries(def.entryByHeader?.map ?? {})) {
    if (!def.nodes[target]) errors.push({ code: 'ivr.node_missing', message: `entryByHeader[${h}] aponta para nó inexistente "${target}"`, node: target });
  }
  for (const [id, n] of Object.entries(def.nodes)) {
    for (const t of edgesOf(n)) if (!def.nodes[t]) errors.push({ code: 'ivr.node_missing', message: `Nó "${id}" aponta para nó inexistente "${t}"`, node: id });
    if (n.type === 'collect' && n.minDigits && n.maxDigits && n.minDigits > n.maxDigits) errors.push({ code: 'ivr.collect_range', message: `Nó "${id}": minDigits > maxDigits`, node: id });
    if (n.type === 'menu' && n.forcePlay && n.bargeIn === true) warnings.push({ code: 'ivr.force_vs_barge', message: `Nó "${id}": forcePlay anula bargeIn`, node: id });
  }
  if (!ids.some((id) => def.nodes[id].type === 'queue')) errors.push({ code: 'ivr.no_queue', message: 'O fluxo precisa de ao menos um nó do tipo "queue" (entrega ao atendimento humano)' });

  if (errors.some((e) => e.code === 'ivr.node_missing' || e.code === 'ivr.start_missing')) return { ok: false, errors, warnings };

  // alcançáveis a partir do início
  const entries = [def.start, ...Object.values(def.entryByHeader?.map ?? {})];
  const reach = new Set<string>();
  const stack = [...entries];
  while (stack.length) {
    const id = stack.pop()!;
    if (reach.has(id)) continue;
    reach.add(id);
    for (const t of edgesOf(def.nodes[id])) stack.push(t);
  }
  for (const id of ids) if (!reach.has(id)) warnings.push({ code: 'ivr.unreachable', message: `Nó "${id}" é inalcançável`, node: id });

  // nós alcançáveis dos quais NÃO se chega a um nó terminal (ciclo sem saída)
  const canExit = new Set<string>(ids.filter((id) => TERMINALS.includes(def.nodes[id].type)));
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of ids) {
      if (canExit.has(id)) continue;
      if (edgesOf(def.nodes[id]).some((t) => canExit.has(t))) { canExit.add(id); changed = true; }
    }
  }
  for (const id of reach) if (!canExit.has(id)) errors.push({ code: 'ivr.dead_end', message: `Nó "${id}" faz parte de um ciclo sem saída (não chega a queue/transfer/hangup)`, node: id });
  if (![...reach].some((id) => def.nodes[id].type === 'queue')) errors.push({ code: 'ivr.queue_unreachable', message: 'Nenhum nó "queue" é alcançável a partir do início' });

  return { ok: errors.length === 0, errors, warnings, definition: def };
}

// ── Frases padrão (multi-idioma) ─────────────────────────────────────────────────────────────────────
type Phrase = 'timeout' | 'invalid' | 'maxRetries' | 'echo' | 'confirm' | 'closed';
export const DEFAULT_PHRASES: Record<Phrase, Record<string, string>> = {
  timeout: { 'pt-BR': 'Não recebemos nenhuma opção.', en: 'We did not receive any option.', es: 'No recibimos ninguna opción.' },
  invalid: { 'pt-BR': 'Opção inválida.', en: 'Invalid option.', es: 'Opción inválida.' },
  maxRetries: { 'pt-BR': 'Não foi possível concluir sua solicitação. Obrigado por ligar.', en: 'We could not complete your request. Thank you for calling.', es: 'No pudimos completar su solicitud. Gracias por llamar.' },
  echo: { 'pt-BR': 'Você digitou:', en: 'You entered:', es: 'Usted ingresó:' },
  confirm: { 'pt-BR': 'Para confirmar, digite 1. Para digitar novamente, digite 2.', en: 'To confirm, press 1. To enter again, press 2.', es: 'Para confirmar, marque 1. Para ingresar de nuevo, marque 2.' },
  closed: { 'pt-BR': 'Nosso atendimento está fechado no momento.', en: 'Our service is currently closed.', es: 'Nuestro servicio está cerrado en este momento.' },
};

const baseLang = (l: string) => l.split('-')[0].toLowerCase();

export function phrase(kind: Phrase, lang: string): ResolvedIvrPrompt {
  const m = DEFAULT_PHRASES[kind];
  const text = m[lang] ?? m[Object.keys(m).find((k) => baseLang(k) === baseLang(lang)) ?? 'pt-BR'];
  return { text, lang };
}

/** Escolhe o texto/áudio do prompt para o idioma corrente (i18n → base). */
export function pickPrompt(p: PromptDef | undefined, lang: string, defaultLang = 'pt-BR'): ResolvedIvrPrompt {
  if (!p) return { text: '', lang };
  const key = p.i18n ? (Object.keys(p.i18n).find((k) => k === lang) ?? Object.keys(p.i18n).find((k) => baseLang(k) === baseLang(lang))) : undefined;
  if (key) { const v = p.i18n![key]; return { text: v.text ?? '', audioKey: v.audioKey, lang }; }
  return { text: p.text ?? '', audioKey: p.audioKey, lang: p.lang ?? defaultLang };
}

// ── CPF / CNPJ ───────────────────────────────────────────────────────────────────────────────────────
export function isValidCpf(v: string): boolean {
  const d = v.replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const calc = (n: number) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}
export function isValidCnpj(v: string): boolean {
  const d = v.replace(/\D/g, '');
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (n: number) => { let s = 0, w = n - 7; for (let i = 0; i < n; i++) { s += Number(d[i]) * w--; if (w < 2) w = 9; } const r = s % 11; return r < 2 ? 0 : 11 - r; };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

// ── Execução ─────────────────────────────────────────────────────────────────────────────────────────
/** Lançado pela IO quando o chamador desliga durante a URA. */
export class IvrAborted extends Error { constructor(public reason = 'caller_hangup') { super(`URA interrompida: ${reason}`); } }

export interface IvrIO {
  /** Toca o prompt. Se `interruptible` e o chamador digitar durante o áudio (cut-thru), interrompe e devolve o dígito. */
  play(p: ResolvedIvrPrompt, o: { interruptible: boolean }): Promise<string | null>;
  /** Espera um dígito (null = tempo esgotado). */
  waitDigit(timeoutSec: number): Promise<string | null>;
  /** Coleta uma sequência de dígitos até o terminador, `max` dígitos ou tempo (entre dígitos). */
  collect(o: { min: number; max: number; terminator: string | null; timeoutSec: number; initial?: string }): Promise<{ digits: string; timedOut: boolean }>;
  /** Fala os dígitos (echo). */
  sayDigits(digits: string): Promise<void>;
}

export interface IvrEnv {
  now: () => Date;
  settings: Pick<BvOrgSettings, 'timezone' | 'businessHours'>;
  holidays: Set<string>;
}

export interface TrailEntry {
  node: string;
  type: IvrNodeType;
  event: 'enter' | 'choice' | 'timeout' | 'invalid' | 'repeat' | 'collected' | 'schedule' | 'language' | 'queue' | 'transfer' | 'hangup' | 'aborted' | 'entry';
  input?: string;
  next?: string;
  bargedIn?: boolean;
  /** collect sensível: só o tamanho; nunca o valor. */
  length?: number;
  sensitive?: boolean;
  value?: string;
  result?: string;
  attempt?: number;
}

export type IvrOutcome =
  | { action: 'queue'; node: string; category?: string; queue?: string; priority?: number; mohClass?: string }
  | { action: 'transfer'; node: string; destination: { type: 'external' | 'extension' | 'ura0800'; number: string } }
  | { action: 'hangup'; node: string; reason: 'end' | 'max_retries' | 'invalid_node' | 'loop_guard' }
  | { action: 'aborted'; node: string; reason: string };

export interface IvrResult {
  outcome: IvrOutcome;
  trail: TrailEntry[];
  lang: string;
  /** Variáveis NÃO sensíveis coletadas (ex.: nº do protocolo/processo). */
  vars: Record<string, string>;
  /** Nomes das variáveis sensíveis coletadas (valores nunca saem do motor). */
  sensitiveVars: string[];
}

export interface RunOptions { lang?: string; headers?: Record<string, string>; maxSteps?: number }

type Retry = Pick<Extract<IvrNode, { type: 'menu' }>, 'maxRetries' | 'timeoutSec' | 'timeoutNode' | 'invalidNode' | 'timeoutPrompt' | 'invalidPrompt'>;

export async function runIvr(def: IvrDefinition, io: IvrIO, env: IvrEnv, opts: RunOptions = {}): Promise<IvrResult> {
  const defaultLang = def.defaultLang ?? 'pt-BR';
  let lang = opts.lang ?? defaultLang;
  const trail: TrailEntry[] = [];
  const vars: Record<string, string> = {};
  const sensitiveVars: string[] = [];
  const maxSteps = opts.maxSteps ?? 300;
  const pick = (p: PromptDef | undefined) => pickPrompt(p, lang, defaultLang);
  const done = (outcome: IvrOutcome): IvrResult => ({ outcome, trail, lang, vars, sensitiveVars });

  let current = def.start;
  const headerName = def.entryByHeader?.header.toLowerCase();
  if (headerName && opts.headers) {
    const hv = Object.entries(opts.headers).find(([k]) => k.toLowerCase() === headerName)?.[1];
    const target = hv != null ? def.entryByHeader!.map[String(hv).trim()] : undefined;
    if (target && def.nodes[target]) { current = target; trail.push({ node: target, type: def.nodes[target].type, event: 'entry', input: `${def.entryByHeader!.header}=${String(hv).trim()}` }); }
  }

  /** Falha após esgotar tentativas: segue timeoutNode/invalidNode ou encerra. */
  const exhausted = async (id: string, type: IvrNodeType, r: Retry, last: 'timeout' | 'invalid'): Promise<{ next: string } | { out: IvrResult }> => {
    const dest = last === 'timeout' ? (r.timeoutNode ?? r.invalidNode) : (r.invalidNode ?? r.timeoutNode);
    if (dest) return { next: dest };
    await io.play(phrase('maxRetries', lang), { interruptible: false });
    trail.push({ node: id, type, event: 'hangup', result: 'max_retries' });
    return { out: done({ action: 'hangup', node: id, reason: 'max_retries' }) };
  };

  /** Pergunta uma opção de uma tecla com tentativas. Devolve a tecla válida ou o motivo da falha. */
  const askKey = async (id: string, node: Extract<IvrNode, { type: 'menu' | 'language' }>, valid: (d: string) => boolean): Promise<{ digit: string; barged: boolean } | { failed: 'timeout' | 'invalid' }> => {
    const maxRetries = node.maxRetries ?? 2;
    const timeoutSec = node.timeoutSec ?? 5;
    const forcePlay = node.type === 'menu' && node.forcePlay === true;
    const interruptible = !forcePlay && (node.type === 'language' || node.bargeIn !== false);
    const repeatKey = node.type === 'menu' ? (node.repeatKey ?? '*') : '*';
    let attempts = 0;
    let last: 'timeout' | 'invalid' = 'timeout';
    for (;;) {
      let digit = await io.play(pick(node.prompt), { interruptible });
      const barged = digit != null;
      if (digit == null) digit = await io.waitDigit(timeoutSec);
      if (digit != null && valid(digit)) return { digit, barged };
      if (digit != null && digit === repeatKey) { trail.push({ node: id, type: node.type, event: 'repeat', input: digit }); continue; }
      last = digit == null ? 'timeout' : 'invalid';
      attempts++;
      trail.push({ node: id, type: node.type, event: last, attempt: attempts, ...(digit != null ? { input: digit } : {}) });
      if (attempts > maxRetries) return { failed: last };
      await io.play(last === 'timeout' ? (node.timeoutPrompt ? pick(node.timeoutPrompt) : phrase('timeout', lang)) : (node.invalidPrompt ? pick(node.invalidPrompt) : phrase('invalid', lang)), { interruptible: false });
    }
  };

  try {
    for (let steps = 0; ; steps++) {
      if (steps >= maxSteps) return done({ action: 'hangup', node: current, reason: 'loop_guard' });
      const node = def.nodes[current];
      if (!node) return done({ action: 'hangup', node: current, reason: 'invalid_node' });
      const id = current;

      switch (node.type) {
        case 'menu': {
          const r = await askKey(id, node, (d) => d in node.options);
          if ('failed' in r) {
            const e = await exhausted(id, 'menu', node, r.failed);
            if ('out' in e) return e.out;
            current = e.next; continue;
          }
          current = node.options[r.digit];
          trail.push({ node: id, type: 'menu', event: 'choice', input: r.digit, next: current, bargedIn: r.barged });
          continue;
        }

        case 'language': {
          const r = await askKey(id, node, (d) => d in node.languages);
          if ('failed' in r) {
            const e = await exhausted(id, 'language', node, r.failed);
            if ('out' in e) return e.out;
            current = e.next; continue;
          }
          lang = node.languages[r.digit];
          current = node.next;
          trail.push({ node: id, type: 'language', event: 'language', input: r.digit, result: lang, next: current, bargedIn: r.barged });
          continue;
        }

        case 'play': {
          const interruptible = node.forcePlay !== true && node.bargeIn === true;
          await io.play(pick(node.prompt), { interruptible });
          current = node.next;
          trail.push({ node: id, type: 'play', event: 'enter', next: current });
          continue;
        }

        case 'collect': {
          const min = node.minDigits ?? 1;
          const max = node.maxDigits ?? Math.max(min, 11);
          const terminator = node.terminator === undefined ? '#' : node.terminator;
          const sensitive = node.sensitive ?? (node.validate === 'cpf' || node.validate === 'cnpj');
          const maxRetries = node.maxRetries ?? 2;
          let attempts = 0;
          let last: 'timeout' | 'invalid' = 'timeout';
          let value: string | null = null;
          let initial: string | undefined;
          let prompt = pick(node.prompt);
          while (value === null) {
            const barged = await io.play(prompt, { interruptible: true });
            initial = barged ?? undefined;
            const got = await io.collect({ min, max, terminator, timeoutSec: node.timeoutSec ?? 8, initial });
            let fail: 'timeout' | 'invalid' | null = null;
            if (got.digits.length === 0) fail = 'timeout';
            else if (got.digits.length < min) fail = 'invalid';
            else if (node.validate === 'cpf' && !isValidCpf(got.digits)) fail = 'invalid';
            else if (node.validate === 'cnpj' && !isValidCnpj(got.digits)) fail = 'invalid';
            if (!fail && node.echo) {
              await io.play(phrase('echo', lang), { interruptible: false });
              await io.sayDigits(got.digits);
              if (node.confirm) {
                const c = await askConfirm(io, lang);
                if (c !== '1') { trail.push({ node: id, type: 'collect', event: 'repeat', result: 'not_confirmed' }); continue; }
              }
            }
            if (fail) {
              last = fail; attempts++;
              trail.push({ node: id, type: 'collect', event: fail, attempt: attempts });
              if (attempts > maxRetries) break;
              await io.play(fail === 'timeout' ? (node.timeoutPrompt ? pick(node.timeoutPrompt) : phrase('timeout', lang)) : (node.invalidPrompt ? pick(node.invalidPrompt) : phrase('invalid', lang)), { interruptible: false });
              prompt = pick(node.prompt);
              continue;
            }
            value = got.digits;
          }
          if (value === null) {
            const e = await exhausted(id, 'collect', node, last);
            if ('out' in e) return e.out;
            current = e.next; continue;
          }
          if (sensitive) { sensitiveVars.push(node.var); trail.push({ node: id, type: 'collect', event: 'collected', sensitive: true, length: value.length, next: node.next }); }
          else { vars[node.var] = value; trail.push({ node: id, type: 'collect', event: 'collected', value, length: value.length, next: node.next }); }
          current = node.next;
          continue;
        }

        case 'schedule': {
          const { ymd } = localParts(env.now(), env.settings.timezone);
          const isHoliday = env.holidays.has(ymd);
          const open = isWithinBusinessHours(env.settings, env.now(), env.holidays, node.hours as BusinessHours | undefined);
          const result = isHoliday && node.holiday ? 'holiday' : open ? 'open' : 'closed';
          current = result === 'holiday' ? node.holiday! : result === 'open' ? node.open : node.closed;
          trail.push({ node: id, type: 'schedule', event: 'schedule', result, next: current });
          continue;
        }

        case 'queue': {
          if (node.prompt) await io.play(pick(node.prompt), { interruptible: false });
          trail.push({ node: id, type: 'queue', event: 'queue', result: node.category ?? node.queue ?? '' });
          return done({ action: 'queue', node: id, category: node.category, queue: node.queue, priority: node.priority, mohClass: node.mohClass });
        }

        case 'transfer': {
          if (node.prompt) await io.play(pick(node.prompt), { interruptible: false });
          trail.push({ node: id, type: 'transfer', event: 'transfer', result: node.destination.type });
          return done({ action: 'transfer', node: id, destination: node.destination });
        }

        case 'hangup': {
          if (node.prompt) await io.play(pick(node.prompt), { interruptible: false });
          trail.push({ node: id, type: 'hangup', event: 'hangup', result: 'end' });
          return done({ action: 'hangup', node: id, reason: 'end' });
        }
      }
    }
  } catch (err) {
    if (err instanceof IvrAborted) {
      trail.push({ node: current, type: def.nodes[current]?.type ?? 'hangup', event: 'aborted', result: err.reason });
      return done({ action: 'aborted', node: current, reason: err.reason });
    }
    throw err;
  }
}

async function askConfirm(io: IvrIO, lang: string): Promise<string | null> {
  const p = await io.play(phrase('confirm', lang), { interruptible: true });
  return p ?? io.waitDigit(5);
}

// ── Simulação (sem telefonia) ────────────────────────────────────────────────────────────────────────
/**
 * Entradas da simulação, na ordem em que o motor pede:
 *  "1"      → dígito digitado APÓS o prompt (ou timeout se vazio / "timeout")
 *  "~1"     → dígito digitado DURANTE o prompt (cut-thru); em force-play é descartado
 *  "12345#" → sequência para `collect` (o "#" é opcional)
 */
export class SimulatedIO implements IvrIO {
  readonly spoken: Array<{ text: string; audioKey?: string; lang: string; interruptible: boolean; cutThru?: boolean }> = [];
  private i = 0;
  constructor(private inputs: string[]) {}

  private peek(): string | undefined { return this.inputs[this.i]; }
  private take(): string | undefined { return this.inputs[this.i++]; }
  get exhausted() { return this.i >= this.inputs.length; }
  get consumed() { return this.i; }

  async play(p: ResolvedIvrPrompt, o: { interruptible: boolean }): Promise<string | null> {
    const next = this.peek();
    const cut = next?.startsWith('~') ?? false;
    if (cut) {
      this.take(); // a tecla pressionada durante o áudio é consumida de qualquer forma
      if (o.interruptible) { this.spoken.push({ ...p, interruptible: true, cutThru: true }); return next!.slice(1) || null; }
      this.spoken.push({ ...p, interruptible: false }); return null; // force-play: descartada
    }
    this.spoken.push({ ...p, interruptible: o.interruptible });
    return null;
  }
  async waitDigit(): Promise<string | null> {
    if (this.exhausted) throw new IvrAborted('inputs_exhausted');
    const v = this.take()!;
    return v === '' || v === 'timeout' ? null : v.slice(0, 1);
  }
  async collect(o: { min: number; max: number; terminator: string | null; timeoutSec: number; initial?: string }): Promise<{ digits: string; timedOut: boolean }> {
    if (this.exhausted && !o.initial) throw new IvrAborted('inputs_exhausted');
    const raw = this.exhausted ? '' : this.take()!;
    if (raw === '' || raw === 'timeout') return { digits: o.initial ?? '', timedOut: !o.initial };
    let digits = (o.initial ?? '') + raw;
    if (o.terminator && digits.includes(o.terminator)) digits = digits.slice(0, digits.indexOf(o.terminator));
    return { digits: digits.slice(0, o.max), timedOut: false };
  }
  async sayDigits(): Promise<void> { this.spoken.push({ text: '[dígitos repetidos ao chamador]', lang: '', interruptible: false }); }
}

export async function simulateIvr(def: IvrDefinition, inputs: string[], env: IvrEnv, opts: RunOptions = {}): Promise<IvrResult & { spoken: SimulatedIO['spoken']; unusedInputs: string[] }> {
  const io = new SimulatedIO(inputs);
  const res = await runIvr(def, io, env, opts);
  const unusedInputs = inputs.slice(io.consumed);
  return { ...res, spoken: io.spoken, unusedInputs };
}
