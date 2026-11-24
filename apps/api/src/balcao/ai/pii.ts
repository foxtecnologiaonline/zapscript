/**
 * Redação de dados pessoais ANTES de qualquer texto sair para um LLM (LGPD). Troca CPF, CNPJ, e-mail, telefone,
 * cartão e nº de processo CNJ por marcadores ([CPF_1], [PROCESSO_1]…) e guarda o mapa para "reidratar" os
 * parâmetros de ferramentas (ex.: a consulta e-Proc precisa do número real, mas o LLM nunca o vê).
 *
 * Além dos identificadores numéricos, aplica HEURÍSTICAS de texto livre (nome após "meu nome é/me chamo/sou o|a",
 * RG, CEP, endereço, data de nascimento, agência/conta) — ver `docs/balcao/api-ai.md`. É regex, NÃO é NER:
 * reduz o vazamento, não o elimina (nomes soltos, cidades/bairros, nomes de terceiros e dados sensíveis em
 * prosa continuam passando). Prefere falso negativo a destruir texto comum: cada heurística exige uma âncora
 * (palavra-chave) ou um formato inequívoco.
 */

export type PiiKind = 'CPF' | 'CNPJ' | 'EMAIL' | 'TELEFONE' | 'PROCESSO' | 'CARTAO' | 'NOME' | 'RG' | 'CEP' | 'ENDERECO' | 'NASCIMENTO' | 'DADOS_BANCARIOS';
export const PII_KINDS: readonly PiiKind[] = ['CPF', 'CNPJ', 'EMAIL', 'TELEFONE', 'PROCESSO', 'CARTAO', 'NOME', 'RG', 'CEP', 'ENDERECO', 'NASCIMENTO', 'DADOS_BANCARIOS'];
/** Tipos cuja identidade é só o texto (não os dígitos): dois valores diferentes nunca podem compartilhar marcador. */
const TEXT_KEYED: ReadonlySet<PiiKind> = new Set(['EMAIL', 'NOME', 'ENDERECO']);

const CNJ_RE = /\b\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4}\b/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const CNPJ_RE = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
const CPF_RE = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const CARD_RE = /\b(?:\d[ -]?){13,19}\b/g;
// +55 (63) 99999-9999 · (63) 3215-1234 · 63 99999 9999 · 99999-9999 · 3215-1234
const PHONE_RE = /(?<![\d])(?:\+?55[\s.-]?)?(?:\(?\d{2}\)?[\s.-]?)?(?:9[\s.-]?\d{4}|\d{4})[\s.-]?\d{4}(?![\d])/g;


// ── Heurísticas de texto livre (todas ancoradas em palavra-chave ou formato) ─────────────────────────────────
const WORD = String.raw`[\p{L}][\p{L}'’.\-]*`;
const NUM_MARK = String.raw`(?:n[ºo°.]{0,2}\s*)`;

const BIRTH_RE = new RegExp(String.raw`(\bnasc(?:imento|i|eu|ido|ida)\b[^\d\n]{0,40}?)(\d{1,2}\s*[\/.\-]\s*\d{1,2}\s*[\/.\-]\s*(?:\d{4}|\d{2})\b|\d{1,2}\s+de\s+(?:janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+\d{4}\b)`, 'giu');
const BIRTH_YEAR_RE = /(\bnasci\s+em\s+)(\d{4})\b/giu;
const BIRTH_NOT = /emitid|expedid|solicit|audi[êe]ncia|protocol|registrad[oa]|segunda\s+via/iu;

const RG_RE = new RegExp(String.raw`\b((?:RG|R\.G\.|identidade|registro\s+geral|carteira\s+de\s+identidade)\s*${NUM_MARK}?(?:n[úu]mero\s*)?(?:é\s+|eh\s+|e\s+|[:\-])?\s*)(\d[\d.\-]{4,13}[\dXx](?:\s*(?:SSP|SJS|SESP|IFP|DETRAN|SEDS)(?:[\/\-\s]?[A-Z]{2})?)?)`, 'giu');
const RG_FORMATTED_RE = /(?<![\d.])\d{1,2}\.\d{3}\.\d{3}-[\dXx](?!\d)/g;

const CEP_KW_RE = new RegExp(String.raw`\b((?:cep|c\.e\.p\.?)\s*${NUM_MARK}?[:\-]?\s*)(\d{2}\.?\d{3}-?\d{3})\b`, 'giu');
const CEP_RE = /(?<![\d.\-\/])\d{5}-\d{3}(?![\d\-])/g;

const AGENCIA_RE = new RegExp(String.raw`\b(ag[êe]ncia|ag\.?)\s*${NUM_MARK}?[:\-]?\s*(\d{3,5}(?:\s?-\s?[\dxX])?)(?![\d])`, 'giu');
const CONTA_RE = new RegExp(String.raw`\b(conta(?:\s+(?:corrente|poupan[çc]a|sal[aá]rio|pagamento))?|c\/c|c\.c\.?|cta\.?)\s*${NUM_MARK}?[:\-]?\s*(\d{4,12}(?:\s?-\s?[\dxX])?)(?![\d])(?!\s*(?:reais|r\$|%|dias|vezes|anos))`, 'giu');

const ADDR_CHAIN = String.raw`(?:\s*[,\-–]?\s*(?:apto?\.?|apartamento|bloco|bl\.?|casa|lote|lt\.?|sala|conjunto|cj\.?|qd\.?|quadra|andar|alameda|al\.)\s*${NUM_MARK}?\d+[A-Za-z]?){0,4}`;
const STREET = String.raw`(?:rua|avenida|av\.?|travessa|trav\.?|alameda|rodovia|estrada|pra[çc]a)`;
// rua das Flores, 123 · Av. Teotônio Segurado nº 1500 · rua 7, casa 12
const ADDR_STREET_RE = new RegExp(String.raw`\b${STREET}\s+((?:${WORD}[\s,]+){0,5}?)${NUM_MARK}?\d{1,5}\b${ADDR_CHAIN}`, 'giu');
// Palmas/TO: ARNO 33, ARSE 14, ACSU-SO 40, ASR-SE 105 (siglas MAIÚSCULAS, sem `i`)
const ADDR_PALMAS_RE = new RegExp(String.raw`\b(?:A(?:RN[OE]|RS[OE]|CS[UVEO]|CN[OE]|SNO|SSE|SSO|ANE)(?:[\s-]?[A-Z]{2})?|ASR(?:-[A-Z]{2})?)\s*-?\s*\d{1,3}\b${ADDR_CHAIN}`, 'giu'); // `i` só p/ a cadeia; a sigla exige MAIÚSCULAS (checado no callback)
const ADDR_QUADRA_RE = new RegExp(String.raw`\b(?:quadra|qd\.?)\s*${NUM_MARK}?\d{1,4}(?:\.\d{3})?\b(?:\s*(?:norte|sul|leste|oeste|nordeste|sudeste|sudoeste|noroeste)\b)?${ADDR_CHAIN}`, 'giu');
// palavras que indicam frase comum ("na rua principal eu paguei 150") e não endereço
const ADDR_STOP = new Set(['que', 'para', 'pra', 'com', 'por', 'foi', 'fui', 'está', 'esta', 'estou', 'tem', 'tenho', 'paguei', 'pagar', 'pago', 'valor', 'reais', 'real', 'dia', 'dias', 'vez', 'vezes', 'ano', 'anos', 'mês', 'mes', 'meses', 'minutos', 'horas', 'hora', 'eu', 'você', 'voce', 'mas', 'quando', 'como', 'onde', 'não', 'nao', 'sim', 'protocolo', 'processo', 'artigo', 'lei', 'item']);

const NAME_LEAD_RE = /\b((?:meu\s+nome(?:\s+completo)?\s*(?:é|eh|e\b|[:=])\s*|me\s+chamo\s+|chamo-me\s+|nome\s+completo\s*[:=]\s*))((?:[\p{L}'’-]+[ \t]+){0,5}[\p{L}'’-]+)?/giu;
const NAME_SOU_RE = /\b((?:eu\s+)?sou\s+(?:o|a)\s+)((?:[\p{L}'’-]+[ \t]+){0,5}[\p{L}'’-]+)?/giu;
const NAME_STOP = new Set(['e', 'que', 'mas', 'preciso', 'precisava', 'gostaria', 'gostaríamos', 'quero', 'queria', 'tenho', 'tinha', 'estou', 'estava', 'moro', 'venho', 'vim', 'sou', 'para', 'pra', 'por', 'sobre', 'com', 'sem', 'na', 'no', 'em', 'ao', 'aos', 'a', 'o', 'os', 'as', 'um', 'uma', 'cpf', 'cnpj', 'rg', 'nascido', 'nascida', 'solicito', 'solicitar', 'solicitei', 'escrevo', 'ligo', 'entrei', 'fiz', 'fui', 'já', 'ja', 'como', 'onde', 'quando', 'favor', 'obrigado', 'obrigada', 'bom', 'boa', 'meu', 'minha', 'telefone', 'email', 'e-mail', 'whatsapp', 'processo', 'protocolo', 'advogado', 'advogada', 'servidor', 'servidora', 'autor', 'autora', 'réu', 'ré', 'parte', 'estudante', 'aposentado', 'aposentada', 'morador', 'moradora', 'brasileiro', 'brasileira', 'casado', 'casada', 'solteiro', 'solteira', 'maior', 'menor', 'aqui', 'novo', 'nova']);
const NAME_PARTICLES = new Set(['de', 'da', 'do', 'das', 'dos', 'di', 'du', 'del', 'della', 'van', 'von', 'bin', 'al', 'el', 'la', 'le']);
/** "Sou o Autor/Advogado/Servidor…" são papéis, não nomes. */
const NAME_ROLES = new Set(['autor', 'autora', 'réu', 'ré', 'reu', 're', 'advogado', 'advogada', 'parte', 'requerente', 'requerido', 'requerida', 'defensor', 'defensora', 'servidor', 'servidora', 'cidadão', 'cidadã', 'cidadao', 'cidada', 'procurador', 'procuradora', 'promotor', 'promotora', 'juiz', 'juíza', 'juiza', 'responsável', 'responsavel', 'mãe', 'mae', 'pai', 'titular', 'proprietário', 'proprietária', 'dono', 'dona', 'representante', 'testemunha', 'perito', 'perita', 'estagiário', 'estagiária', 'primeiro', 'primeira', 'único', 'única', 'unico', 'unica', 'responsável', 'inventariante', 'herdeiro', 'herdeira', 'beneficiário', 'beneficiária', 'terceiro', 'interessado', 'interessada', 'executado', 'executada', 'exequente', 'apelante', 'apelado', 'agravante', 'agravado', 'impetrante', 'paciente', 'vítima', 'vitima', 'cliente', 'usuário', 'usuária', 'usuario', 'usuaria', 'atendente', 'curador', 'curadora', 'tutor', 'tutora', 'guardião', 'guardiã', 'pessoa', 'moça', 'moço']);

/**
 * Extrai o nome logo após a âncora. `capsOnly` (para "sou o|a"): só aceita palavras iniciadas em maiúscula.
 * Devolve [nome, resto-do-texto-capturado] ou null (nada a redigir).
 */
function takeName(tail: string, capsOnly: boolean): { name: string; rest: string } | null {
  const parts = tail.split(/([ \t]+)/); // palavras nos índices pares, separadores nos ímpares
  const firstIsLower = !/^\p{Lu}/u.test(parts[0] ?? '');
  const maxTokens = firstIsLower ? 3 : 4;
  let end = -1; let n = 0;
  for (let i = 0; i < parts.length; i += 2) {
    const w = parts[i]; const lw = w.toLowerCase();
    if (!w || NAME_STOP.has(lw)) break;
    if (NAME_PARTICLES.has(lw) && n === 0) break;
    const isPart = NAME_PARTICLES.has(lw);
    if (capsOnly && !/^\p{Lu}/u.test(w) && !isPart) break;
    if (n === 0 && capsOnly && NAME_ROLES.has(lw)) return null;
    if (isPart) { // partícula só vale se seguida de outro nome válido
      const nx = parts[i + 2];
      if (!nx || NAME_STOP.has(nx.toLowerCase()) || NAME_PARTICLES.has(nx.toLowerCase()) || (capsOnly && !/^\p{Lu}/u.test(nx))) break;
      continue;
    }
    if (w.length < 2 && !/^\p{Lu}/u.test(w)) break;
    if (n >= maxTokens) break;
    n++; end = i;
  }
  if (n === 0 || end < 0) return null;
  return { name: parts.slice(0, end + 1).join(''), rest: parts.slice(end + 1).join('') };
}

function validCpf(d: string): boolean {
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (let t = 9; t < 11; t++) {
    let s = 0;
    for (let i = 0; i < t; i++) s += Number(d[i]) * (t + 1 - i);
    if (((s * 10) % 11) % 10 !== Number(d[t])) return false;
  }
  return true;
}
function validCnpj(d: string): boolean {
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (len: number) => {
    const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = w.reduce((a, x, i) => a + x * Number(d[i]), 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}
function luhn(d: string): boolean {
  let sum = 0; let alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = Number(d[i]);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}

export interface RedactOptions {
  /** Tipos que devem permanecer em claro (ex.: ['PROCESSO'] quando o texto vai a um sistema confiável). */
  keep?: PiiKind[];
}

/**
 * Redator com estado: o mesmo valor recebe sempre o mesmo marcador dentro do mesmo redator, e `map` permite
 * reidratar. Use UM redator por chamada ao LLM (mensagem atual + histórico).
 */
export class PiiRedactor {
  readonly map: Record<string, string> = {};
  readonly counts: Partial<Record<PiiKind, number>> = {};
  private byValue = new Map<string, string>();
  private n: Partial<Record<PiiKind, number>> = {};
  constructor(private opts: RedactOptions = {}) {}

  private mark(kind: PiiKind, value: string): string {
    const key = TEXT_KEYED.has(kind) ? `${kind}:${value.toLowerCase().replace(/\s+/g, ' ').trim()}` : `${kind}:${value.replace(/\D/g, '') || value.toLowerCase()}`;
    const hit = this.byValue.get(key);
    if (hit) return hit;
    const i = (this.n[kind] = (this.n[kind] ?? 0) + 1);
    const tag = `[${kind}_${i}]`;
    this.byValue.set(key, tag); this.map[tag] = value;
    this.counts[kind] = (this.counts[kind] ?? 0) + 1;
    return tag;
  }

  redact(text: string): string {
    if (!text) return text;
    const keep = new Set(this.opts.keep ?? []);
    let out = text;
    // PROCESSO mantido em claro: protege o número (sentinela) para que nenhuma outra regra o corte e restaura no fim
    const kept: string[] = [];
    if (keep.has('PROCESSO')) out = out.replace(CNJ_RE, (m) => { kept.push(m); return `\uE000${kept.length - 1}\uE001`; });
    // ordem importa: padrões mais longos/específicos primeiro, para um não "comer" parte do outro
    if (!keep.has('PROCESSO')) out = out.replace(CNJ_RE, (m) => this.mark('PROCESSO', m));
    if (!keep.has('EMAIL')) out = out.replace(EMAIL_RE, (m) => this.mark('EMAIL', m));
    if (!keep.has('CNPJ')) out = out.replace(CNPJ_RE, (m) => (validCnpj(m.replace(/\D/g, '')) ? this.mark('CNPJ', m) : m));
    if (!keep.has('CPF')) out = out.replace(CPF_RE, (m) => (validCpf(m.replace(/\D/g, '')) || /[.-]/.test(m) ? this.mark('CPF', m) : m));
    // heurísticas ancoradas (mantêm a palavra-âncora e trocam só o dado)
    if (!keep.has('NOME')) {
      out = out.replace(NAME_LEAD_RE, (m, lead: string, tail?: string) => this.nameSub(m, lead, tail, false));
      out = out.replace(NAME_SOU_RE, (m, lead: string, tail?: string) => this.nameSub(m, lead, tail, true));
    }
    if (!keep.has('NASCIMENTO')) {
      out = out.replace(BIRTH_RE, (m, lead: string, d: string) => (BIRTH_NOT.test(lead) ? m : lead + this.mark('NASCIMENTO', d)));
      out = out.replace(BIRTH_YEAR_RE, (_m, lead: string, y: string) => lead + this.mark('NASCIMENTO', y));
    }
    if (!keep.has('RG')) {
      out = out.replace(RG_RE, (_m, lead: string, v: string) => lead + this.mark('RG', v.trim()));
      out = out.replace(RG_FORMATTED_RE, (m) => this.mark('RG', m));
    }
    if (!keep.has('DADOS_BANCARIOS')) {
      out = out.replace(AGENCIA_RE, (_m, _lead: string, v: string) => `${_m.slice(0, _m.length - v.length)}${this.mark('DADOS_BANCARIOS', v)}`);
      out = out.replace(CONTA_RE, (_m, _lead: string, v: string) => `${_m.slice(0, _m.length - v.length)}${this.mark('DADOS_BANCARIOS', v)}`);
    }
    if (!keep.has('CEP')) {
      out = out.replace(CEP_KW_RE, (_m, lead: string, v: string) => lead + this.mark('CEP', v));
      out = out.replace(CEP_RE, (m) => this.mark('CEP', m));
    }
    if (!keep.has('ENDERECO')) {
      out = out.replace(ADDR_PALMAS_RE, (m) => (/^[A-Z]{3,4}/.test(m) ? this.mark('ENDERECO', m) : m)); // 1º: a cadeia absorve "Alameda 5 lote 10"
      out = out.replace(ADDR_STREET_RE, (m, words: string) => (this.addressWordsOk(words) ? this.mark('ENDERECO', m) : m));
      out = out.replace(ADDR_QUADRA_RE, (m) => this.mark('ENDERECO', m));
    }
    if (!keep.has('CARTAO')) out = out.replace(CARD_RE, (m) => { const d = m.replace(/\D/g, ''); return d.length >= 13 && luhn(d) ? this.mark('CARTAO', m) : m; });
    if (!keep.has('TELEFONE')) out = out.replace(PHONE_RE, (m) => (m.replace(/\D/g, '').length >= 8 ? this.mark('TELEFONE', m.trim()) : m));
    if (kept.length) out = out.replace(/\uE000(\d+)\uE001/g, (_m, i: string) => kept[Number(i)]);
    return out;
  }

  private nameSub(m: string, lead: string, tail: string | undefined, capsOnly: boolean): string {
    if (!tail) return m;
    const t = takeName(tail, capsOnly);
    return t ? lead + this.mark('NOME', t.name) + t.rest : m;
  }

  private addressWordsOk(words: string): boolean {
    return !words.toLowerCase().split(/[\s,]+/).some((w) => ADDR_STOP.has(w));
  }

  /** Reidrata marcadores em texto ou, recursivamente, em objetos/arrays (parâmetros de ferramenta). */
  rehydrate<T>(value: T): T {
    if (typeof value === 'string') {
      return value.replace(/\[(?:CPF|CNPJ|EMAIL|TELEFONE|PROCESSO|CARTAO|NOME|RG|CEP|ENDERECO|NASCIMENTO|DADOS_BANCARIOS)_\d+\]/g, (tag) => this.map[tag] ?? tag) as unknown as T;
    }
    if (Array.isArray(value)) return value.map((v) => this.rehydrate(v)) as unknown as T;
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, this.rehydrate(v)])) as T;
    }
    return value;
  }

  get found(): number { return Object.values(this.counts).reduce((a, b) => a + (b ?? 0), 0); }
}

/** Atalho sem estado: devolve só o texto redigido. */
export function redactPII(text: string, opts: RedactOptions = {}): string {
  return new PiiRedactor(opts).redact(text);
}
