/**
 * Redação de PII para minimização de dados (LGPD).
 *
 * O Atende lida com dados de TERCEIROS (clientes do assinante). O resumo da
 * conversa é o único texto que persiste além do rascunho/resposta auditável —
 * por isso passa por redação antes de ir ao banco: e-mails, telefones, CPF/CNPJ
 * e números de cartão são mascarados. Não substitui a criptografia de campo,
 * apenas reduz a superfície de dado sensível armazenado em texto de resumo.
 */

const CPF_CNPJ   = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
const CARD       = /\b(?:\d[ -]?){13,16}\b/g;
const EMAIL      = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
// Telefone BR com/sem DDI/DDD (evita capturar sequências curtas: exige >= 10 dígitos)
const PHONE      = /\b(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?\d{4,5}[-\s]?\d{4}\b/g;

export function redactPII(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(CPF_CNPJ, '[documento]')
    .replace(CARD, '[cartão]')
    .replace(EMAIL, '[email]')
    .replace(PHONE, '[telefone]')
    .trim();
}
