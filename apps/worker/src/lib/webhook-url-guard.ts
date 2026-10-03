import { promises as dns } from 'dns';

/**
 * Guarda anti-SSRF das URLs de webhook. Estava embutida em
 * routes/webhook-config.ts; foi extraída porque agora precisa rodar em DOIS
 * momentos distintos:
 *   1. no cadastro/teste da URL (rota) — feedback imediato pro dono;
 *   2. em CADA disparo (worker) — porque entre o cadastro e o disparo o DNS do
 *      host pode ter passado a resolver para IP interno (DNS rebinding). Sem a
 *      revalidação no disparo, a validação do cadastro é só teatro.
 *
 * Cópia idêntica em apps/api/src/lib/webhook-url-guard.ts (apps separados,
 * sem pacote compartilhado). Se mudar aqui, mude lá.
 */

// IPs privados/internos/link-local — inclui 169.254.169.254 (metadata de nuvem)
const PRIVATE_IP_RE =
  /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|::1$|fc[0-9a-f]{2}:|fd[0-9a-f]{2}:)/i;

const BLOCKED_HOSTNAMES = new Set([
  'localhost', '0.0.0.0', 'metadata.google.internal',
]);

export async function isSafeWebhookUrl(url: string): Promise<{ ok: boolean; error?: string }> {
  let u: URL;
  try { u = new URL(url); } catch { return { ok: false, error: 'URL inválida.' }; }

  if (process.env.NODE_ENV === 'production' && u.protocol !== 'https:') {
    return { ok: false, error: 'Apenas URLs HTTPS são aceitas em produção.' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return { ok: false, error: 'Protocolo não suportado. Use https://.' };
  }

  const hostname = u.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { ok: false, error: 'URL aponta para host interno não permitido.' };
  }

  try {
    const addresses = await dns.lookup(hostname, { all: true });
    for (const { address } of addresses) {
      if (PRIVATE_IP_RE.test(address)) {
        return { ok: false, error: 'URL aponta para endereço IP interno não permitido.' };
      }
    }
  } catch {
    return { ok: false, error: 'Não foi possível resolver o hostname da URL.' };
  }

  return { ok: true };
}
