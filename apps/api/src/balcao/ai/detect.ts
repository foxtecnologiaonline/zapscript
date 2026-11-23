import { normalizeText } from './text';

/** Detecções determinísticas (sem LLM, custo zero) usadas pelo chatbot antes de chamar o modelo. */

const has = (n: string, re: RegExp) => re.test(n);

/** Cidadão pede explicitamente uma pessoa. */
export function wantsHuman(text: string): boolean {
  const n = normalizeText(text);
  return has(n, /\b(falar|conversar|passar|transferir|transfere|chamar|quero|preciso|prefiro|gostaria|me\s+passa|me\s+coloca)\b.{0,40}\b(atendente|humano|pessoa|alguem|operador|supervisor|gerente|funcionario|servidor)\b/)
    || has(n, /\b(atendente|atendimento)\s+(humano|real)\b/) || has(n, /\b(nao\s+e|nao\s+quero)\s+(robo|bot|maquina)\b/);
}

/** Palavras de escalonamento configuradas no órgão (comparação sem acentos, por palavra/expressão inteira). */
export function matchesEscalationKeyword(text: string, keywords: string[]): string | null {
  const n = ` ${normalizeText(text)} `;
  for (const k of keywords) {
    const kn = normalizeText(k);
    if (kn && n.includes(` ${kn} `)) return k;
  }
  return null;
}

const STRONG_NEG = /\b(merda|porra|caralho|idiota|imbecil|incompetente|palhacada|vergonha|lixo|porcaria|ridiculo|safado|desgraca|maldito|vagabundo|estelionat\w*|roubo|corrupt\w*)\b/;
const MILD_NEG = /\b(absurdo|pessimo|horrivel|inaceitavel|revoltad[oa]|indignad[oa]|furios[oa]|cansad[oa]|desrespeito|descaso|ninguem resolve|nunca resolve|nao aguento|procon|ouvidoria|denunciar|processar|corregedoria)\b/;

/** Pontuação de insatisfação (≥ 2 = escalar). Léxico simples e auditável — sem modelo. */
export function negativeSentimentScore(text: string): number {
  const n = normalizeText(text);
  let score = 0;
  if (STRONG_NEG.test(n)) score += 2;
  const mild = n.match(new RegExp(MILD_NEG.source, 'g'))?.length ?? 0;
  score += Math.min(mild, 2);
  const letters = text.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (letters.length >= 15 && text.replace(/[^A-ZÀ-Þ]/g, '').length / letters.length > 0.7) score += 1;
  if ((text.match(/!/g)?.length ?? 0) >= 3) score += 1;
  return score;
}

const GREET = new Set(['oi', 'ola', 'bom', 'boa', 'dia', 'tarde', 'noite', 'tudo', 'bem', 'e', 'ai', 'opa', 'hey', 'hello', 'eae', 'salve', 'oie', 'ola', 'como', 'vai', 'voce', 'esta', 'td']);
/** Só saudação, sem conteúdo ("oi", "bom dia, tudo bem?"). */
export function isGreetingOnly(text: string): boolean {
  const toks = normalizeText(text).split(' ').filter(Boolean);
  return toks.length > 0 && toks.length <= 6 && toks.every((t) => GREET.has(t));
}

const NOT_RESOLVED = /\b(nao|n)\s+(resolveu|ajudou|era isso|funcionou|adiantou|serviu|foi isso|e isso|respondeu)\b|\bcontinuo (sem|com o mesmo)|\bainda (nao|preciso)\b/;
const RESOLVED = /\b(obrigad[oa]|obg|valeu|vlw|resolveu|resolvido|era isso|deu certo|perfeito|otimo|show|ajudou|entendi|entendido|beleza|blz|certo|ok|okay|tudo certo|era so isso|muito bom|excelente|grat[oa])\b/;

/** Resposta do cidadão após uma resposta do bot: agradece/confirma → resolvido; "não resolveu" → não resolvido. */
export function resolutionSignal(text: string): 'RESOLVED' | 'NOT_RESOLVED' | null {
  const n = normalizeText(text);
  if (!n) return null;
  if (NOT_RESOLVED.test(n)) return 'NOT_RESOLVED';
  const toks = n.split(' ');
  if (toks.length > 8) return null; // frase longa = provavelmente nova pergunta
  if (/\b(nao|mas|porem|so que|duvida|pergunta|como|quando|onde|qual|quanto|\?)\b/.test(n) || text.includes('?')) return null;
  return RESOLVED.test(n) ? 'RESOLVED' : null;
}
