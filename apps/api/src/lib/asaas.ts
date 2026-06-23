/* ─────────────────────────────────────────────────────────
   ASAAS v3 — cliente HTTP compartilhado
   Docs:  https://docs.asaas.com
   Auth:  header access_token ($aas_live_xxx / $aas_sandbox_xxx)
   Prod:  https://api.asaas.com/api/v3
   Sand:  https://sandbox.asaas.com/api/v3

   Usado por billing.ts (checkout) e admin.ts (gestão de cobranças).
   A chave (ASAAS_API_KEY) vem só de env — nunca em código.
   ───────────────────────────────────────────────────────── */

const IS_PROD = process.env.NODE_ENV === 'production';

// Prioridade: ASAAS_BASE_URL (env explícita) → fallback por NODE_ENV
export const ASAAS_BASE =
  process.env.ASAAS_BASE_URL?.replace(/\/$/, '') ||
  (IS_PROD ? 'https://api.asaas.com/api/v3' : 'https://sandbox.asaas.com/api/v3');

const ASAAS_API_KEY = process.env.ASAAS_API_KEY || '';

/** True quando a integração está configurada (chave presente). */
export function asaasConfigured(): boolean {
  return !!ASAAS_API_KEY;
}

/** Ambiente atual ('production' | 'sandbox') — derivado da base URL. */
export function asaasEnv(): 'production' | 'sandbox' {
  return ASAAS_BASE.includes('sandbox') ? 'sandbox' : 'production';
}

/** Wrapper de fetch para a API do Asaas, já com headers de auth. */
export function asaas(path: string, options: RequestInit = {}) {
  return fetch(`${ASAAS_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'access_token': ASAAS_API_KEY,
      ...(options.headers ?? {}),
    },
  });
}
