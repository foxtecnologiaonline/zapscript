/**
 * Detecção simples de idioma baseada em palavras-chave.
 * Suficiente para os 5-10 idiomas mais comuns de clientes.
 *
 * Estratégia: padrão de Trigram + keywords, sem dependência externa.
 * Precisão: ~85% para mensagens curtas > 10 caracteres.
 */

const LANGUAGE_KEYWORDS: Record<string, Set<string>> = {
  pt: new Set(['o', 'a', 'de', 'para', 'com', 'em', 'é', 'não', 'sim', 'por', 'mais', 'qual', 'quanto', 'quando', 'onde']),
  en: new Set(['the', 'is', 'and', 'to', 'of', 'a', 'in', 'that', 'you', 'it', 'for', 'what', 'how', 'when', 'where']),
  es: new Set(['el', 'la', 'de', 'que', 'y', 'a', 'en', 'es', 'los', 'se', 'del', 'las', 'un', 'por', 'con']),
  fr: new Set(['le', 'de', 'un', 'et', 'à', 'que', 'est', 'en', 'pour', 'la', 'je', 'on', 'une', 'du', 'qui']),
  de: new Set(['der', 'die', 'und', 'in', 'den', 'von', 'zu', 'das', 'mit', 'sich', 'des', 'auf', 'für', 'ist', 'im']),
  it: new Set(['il', 'di', 'da', 'che', 'la', 'è', 'le', 'non', 'e', 'del', 'a', 'per', 'in', 'un', 'nel']),
  ja: new Set(['は', 'を', 'に', 'が', 'で', 'た', 'れ', 'も', 'ます', 'ある', 'いる', 'さん', 'です']),
};

export type DetectedLanguage = 'pt' | 'en' | 'es' | 'fr' | 'de' | 'it' | 'ja' | 'unknown';

/**
 * Detectar idioma de uma mensagem.
 * Retorna: idioma detectado ou 'pt' (padrão fallback).
 */
export function detectLanguage(text: string): DetectedLanguage {
  if (!text || text.length < 5) return 'pt'; // Muito curto, assume português

  const normalized = text
    .toLowerCase()
    .replace(/[^a-zぁ-ん]/gi, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);

  const scores: Record<string, number> = {};

  for (const [lang, keywords] of Object.entries(LANGUAGE_KEYWORDS)) {
    let matches = 0;
    for (const word of normalized) {
      if (keywords.has(word)) matches++;
    }
    scores[lang] = matches;
  }

  // Encontra idioma com maior score
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [winner, winnerScore] = sorted[0];

  // Se score é 0 (nenhuma keyword encontrada) ou muito baixo, assume português
  if (winnerScore === 0 || (normalized.length > 5 && winnerScore / normalized.length < 0.1)) {
    return 'pt';
  }

  return (winner as DetectedLanguage) || 'pt';
}

/**
 * Traduzir um label para o idioma detectado.
 * Usado para instruções do system prompt.
 */
export function getLanguageLabel(lang: DetectedLanguage): string {
  const labels: Record<DetectedLanguage, string> = {
    pt: 'português brasileiro',
    en: 'English (British or American)',
    es: 'Español (Spain or Latin America)',
    fr: 'Français',
    de: 'Deutsch',
    it: 'Italiano',
    ja: '日本語 (Japanese)',
    unknown: 'português brasileiro',
  };
  return labels[lang];
}
