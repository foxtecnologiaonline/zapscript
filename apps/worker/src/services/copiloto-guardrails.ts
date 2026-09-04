/**
 * copiloto-guardrails.ts
 *
 * Validação determinística DEPOIS da geração. O prompt (copiloto-playbook.ts) já
 * proíbe escassez falsa e preço inventado, mas prompt é pedido, não controle:
 * o que impede de fato a sugestão errada de chegar ao dono é este arquivo.
 *
 * Filosofia: barra só o que dá pra provar que está errado a partir do texto —
 * valor/percentual que não aparece em lugar nenhum do contexto, urgência
 * fabricada, o agente se anunciando como robô. Nada de heurística de "tom".
 *
 * Ver ESCOPO_COPILOTO.md §3.4.
 */

export interface GuardrailContext {
  /** Tudo que o dono/cliente já escreveram + contexto do negócio + base de conhecimento. */
  allowedText: string;
}

export interface GuardrailResult {
  ok: boolean;
  violations: string[];
}

/** Urgência/escassez fabricada — o padrão clássico de publicidade enganosa (CDC art. 37). */
const SCARCITY_PATTERNS: Array<[RegExp, string]> = [
  // "só agora" fica DE FORA de propósito: "vi só agora sua mensagem" é frase
  // inocente e comum — barrar isso seria falso positivo em conversa normal.
  [/\b(s[óo]|somente|apenas)\s+hoje\b/i,                'urgência fabricada ("só hoje")'],
  // (^|\s) em vez de \b: o \b do JS é ASCII e NÃO casa antes de "ú" — com \b
  // aqui, "últimas vagas" passava batido. Vale para todo padrão que começa com
  // letra acentuada.
  [/(^|\s)[úu]ltim[ao]s?\s+(vaga|unidade|pe[çc]a|chance|dia)/i, 'escassez não comprovada ("última vaga")'],
  [/\brestam?\s+(apenas|s[óo])\s+\d+/i,                 'escassez não comprovada ("restam apenas N")'],
  [/\bpor\s+tempo\s+limitado\b/i,                       'urgência fabricada ("por tempo limitado")'],
  [/\bo?\s*pre[çc]o\s+(sobe|aumenta)\b/i,               'ameaça de preço não comprovada'],
  [/\bpromo[çc][ãa]o\s+(acaba|termina|encerra)\b/i,     'prazo de promoção não comprovado'],
  [/\bvaga\s+garantida\b/i,                             'promessa absoluta'],
  [/\b(100%|totalmente)\s+garantid/i,                   'promessa absoluta ("100% garantido")'],
  [/\bsem\s+risco\s+(nenhum|algum)\b/i,                 'promessa absoluta ("sem risco nenhum")'],
];

/** O rascunho é do DONO. Ele nunca se anuncia como robô. */
const ROBOT_PATTERNS: Array<[RegExp, string]> = [
  // Sem \b no fim: "robô" termina em caractere não-ASCII e o \b nunca fecharia.
  [/\b(sou|somos)\s+(uma?\s+)?(ia|intelig[êe]ncia artificial|rob[ôo]|bot)/i, 'menção a IA/robô'],
  [/\b(assistente|atendente)\s+virtual/i,                                     'menção a atendente virtual'],
  [/\bmensagem\s+autom[áa]tica/i,                                             'menção a automação'],
];

/** "R$ 1.200,00" / "1200 reais" / "R$1200" → 1200. Retorna null se não der pra ler. */
function parseMoney(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.,]/g, '');
  if (!cleaned) return null;
  // pt-BR: ponto é milhar, vírgula é decimal. "1.200,50" → "1200.50"
  const normalized = cleaned.replace(/\./g, '').replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/** Todos os valores em reais citados num texto. */
function extractMoney(text: string): number[] {
  const out: number[] = [];
  const patterns = [
    /R\$\s?\d[\d.,]*/gi,          // R$ 1.200,00
    /\b\d[\d.,]*\s*reais\b/gi,    // 1200 reais
  ];
  for (const re of patterns) {
    for (const m of text.match(re) ?? []) {
      const v = parseMoney(m);
      if (v !== null) out.push(v);
    }
  }
  return out;
}

/** Percentuais citados ("20%", "20 %"). */
function extractPercents(text: string): number[] {
  const out: number[] = [];
  for (const m of text.match(/\b\d{1,3}\s?%/g) ?? []) {
    const v = parseInt(m, 10);
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

/**
 * Valida um rascunho antes de ele ser oferecido ao dono.
 *
 * A regra de ancoragem é a que mais importa: todo valor em reais e todo
 * percentual que aparece no rascunho precisa já existir no contexto (conversa,
 * descrição do negócio ou base de conhecimento). Um número que a IA produziu
 * sozinha é preço inventado em nome do negócio do cliente — o pior erro possível.
 */
export function validateDraft(draft: string, ctx: GuardrailContext): GuardrailResult {
  const violations: string[] = [];
  const text = draft ?? '';

  if (!text.trim()) {
    return { ok: false, violations: ['rascunho vazio'] };
  }

  for (const [re, label] of SCARCITY_PATTERNS) {
    if (re.test(text)) violations.push(label);
  }
  for (const [re, label] of ROBOT_PATTERNS) {
    if (re.test(text)) violations.push(label);
  }

  const allowedMoney   = new Set(extractMoney(ctx.allowedText));
  const allowedPercent = new Set(extractPercents(ctx.allowedText));

  for (const v of extractMoney(text)) {
    if (!allowedMoney.has(v)) {
      violations.push(`valor R$ ${v} não existe no contexto (preço inventado)`);
    }
  }
  for (const p of extractPercents(text)) {
    if (!allowedPercent.has(p)) {
      violations.push(`percentual ${p}% não existe no contexto (desconto inventado)`);
    }
  }

  return { ok: violations.length === 0, violations };
}

/**
 * Recusa explícita do cliente. Quando isto bate na última mensagem, o Copiloto
 * não sugere nada comercial — só avisa o dono. Insistir depois do "não" é
 * prática abusiva (CDC art. 39) e queima o número no WhatsApp.
 */
// Sem \b no fim: a lista tem radicais truncados ("descadastr") e um \b depois de
// "descadastr" exigiria que a próxima letra NÃO fosse letra — ou seja, nunca
// casaria "descadastrar". As alternativas são longas o bastante para não gerar
// falso positivo sem o fecho.
const OPT_OUT = /\b(n[ãa]o\s+quero\s+mais|para\s+de\s+(me\s+)?mandar|pare\s+de\s+(me\s+)?mandar|me\s+tira\s+d(a|essa)\s+lista|descadastr|sair\s+da\s+lista|n[ãa]o\s+me\s+(mande|envie|procure)\s+mais)/i;

export function isOptOut(text: string): boolean {
  return OPT_OUT.test(text ?? '');
}

/**
 * Sinais de vulnerabilidade. Não bloqueiam sozinhos — sobem "sensivel" para o
 * agente e fazem o Copiloto avisar o dono em vez de empurrar venda.
 */
// Duas listas de propósito. Palavras inteiras precisam do \b final — sem ele,
// "uti" casaria dentro de "utilidade". Radicais truncados não podem tê-lo — com
// ele, "desempregad" nunca casaria "desempregado".
const VULNERABILITY_WORDS = /\b(faleceu|falecimento|luto|enterro|vel[óo]rio|hospital|uti|c[âa]ncer|quimioterapia)\b/i;
const VULNERABILITY_STEMS = /\b(desempregad|endividad|negativad|sem\s+dinheiro|emerg[êe]ncia\s+m[ée]dica)/i;

export function hasVulnerabilitySignal(text: string): boolean {
  const t = text ?? '';
  return VULNERABILITY_WORDS.test(t) || VULNERABILITY_STEMS.test(t);
}
