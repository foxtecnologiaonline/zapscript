/* ─────────────────────────────────────────────────────────
   Atribuição de origem (UTM) — captura de primeiro toque.
   Guarda utm_source/utm_campaign/utm_medium por 30 dias no
   localStorage, para anexar ao cadastro e aos eventos de
   conversão (signup/subscribe) mesmo que o usuário navegue
   por várias páginas antes de converter.
   ───────────────────────────────────────────────────────── */

const KEY     = 'zs_utm';
const KEY_EXP = 'zs_utm_exp';
const TTL_MS  = 30 * 24 * 60 * 60 * 1000; // 30 dias

export interface Utm {
  source?:   string;
  campaign?: string;
  medium?:   string;
}

/** Captura utm_source/utm_campaign/utm_medium da URL atual (se houver) e guarda. */
export function captureUtmFromUrl() {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    const source   = url.searchParams.get('utm_source')   || '';
    const campaign = url.searchParams.get('utm_campaign') || '';
    const medium    = url.searchParams.get('utm_medium')   || '';
    if (!source && !campaign && !medium) return;

    // Primeiro toque vence — não sobrescreve atribuição já guardada
    if (readUtm().source) return;

    localStorage.setItem(KEY, JSON.stringify({ source, campaign, medium }));
    localStorage.setItem(KEY_EXP, String(Date.now() + TTL_MS));
  } catch {}
}

/** Lê a atribuição guardada (ou {} se expirou/ausente). */
export function readUtm(): Utm {
  if (typeof window === 'undefined') return {};
  try {
    const exp = Number(localStorage.getItem(KEY_EXP) || '0');
    if (Date.now() > exp) {
      localStorage.removeItem(KEY);
      localStorage.removeItem(KEY_EXP);
      return {};
    }
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}
