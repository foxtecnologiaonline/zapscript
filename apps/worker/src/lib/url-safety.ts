import { promises as dns } from 'dns';

/**
 * Validação anti-SSRF de URL de webhook.
 *
 * Extraído de routes/webhook-config.ts para ser compartilhado com os endpoints
 * novos do sistema de eventos (item 2): são DUAS superfícies que aceitam uma
 * URL do cliente e depois fazem fetch server-side. Ter a checagem em um só
 * lugar evita o cenário clássico de "a rota nova esqueceu de validar" — que
 * aqui significaria usar nosso servidor para alcançar a rede interna.
 */

// IPs privados/internos — bloqueados para prevenir SSRF
const PRIVATE_IP_RE =
  /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|::1$|fc[0-9a-f]{2}:|fd[0-9a-f]{2}:)/i;

const BLOCKED_HOSTNAMES = new Set([
  'localhost', '0.0.0.0', 'metadata.google.internal',
]);

export interface UrlSafetyResult {
  ok: boolean;
  error?: string;
}

/**
 * Valida se a URL do webhook é segura para fetch server-side:
 * - HTTPS obrigatório em produção
 * - Bloqueia IPs privados, loopback, link-local e metadata services
 * - Resolve DNS e verifica TODOS os IPs retornados (um hostname público pode
 *   apontar para 127.0.0.1 — é o ataque de DNS rebinding na forma mais simples)
 */
export async function isSafeWebhookUrl(url: string): Promise<UrlSafetyResult> {
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
