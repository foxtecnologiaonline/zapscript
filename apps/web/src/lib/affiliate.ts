/* ─────────────────────────────────────────────────────────
   Atribuição de afiliado — captura "invisível"
   O código viaja no link (?aff= ou /i/CODE), é guardado por 90
   dias no localStorage e some da barra de endereços na hora,
   pra que o indicado veja só "zapscript.me".
   ───────────────────────────────────────────────────────── */

const KEY     = 'zs_aff';
const KEY_EXP = 'zs_aff_exp';
const TTL_MS  = 90 * 24 * 60 * 60 * 1000; // 90 dias

/** Salva o código de afiliado (validade de 90 dias). */
export function storeAffiliateCode(code: string) {
  const c = (code || '').trim();
  if (!c) return;
  try {
    localStorage.setItem(KEY, c);
    localStorage.setItem(KEY_EXP, String(Date.now() + TTL_MS));
  } catch {}
}

/** Lê o código guardado (ou '' se expirou/ausente). */
export function readAffiliateCode(): string {
  if (typeof window === 'undefined') return '';
  try {
    const exp = Number(localStorage.getItem(KEY_EXP) || '0');
    if (Date.now() > exp) {
      localStorage.removeItem(KEY);
      localStorage.removeItem(KEY_EXP);
      return '';
    }
    return localStorage.getItem(KEY) || '';
  } catch {
    return '';
  }
}

/** Limpa o código após o cadastro ser concluído. */
export function clearAffiliateCode() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(KEY_EXP);
  } catch {}
}

/**
 * Captura o ?aff= da URL atual, guarda no localStorage e REMOVE o
 * parâmetro da barra de endereços (preservando os demais params).
 * Chamar dentro de um useEffect nas páginas de entrada.
 */
export function captureAffiliateFromUrl() {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    const aff = url.searchParams.get('aff');
    if (!aff) return;

    storeAffiliateCode(aff);

    // Some da barra de endereços — o indicado vê só o domínio limpo
    url.searchParams.delete('aff');
    const clean = url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : '') + url.hash;
    window.history.replaceState({}, '', clean);
  } catch {}
}
