/**
 * Erro estruturado da Graph API (envio de campanha Meta).
 *
 * O serviço antigo achatava tudo em `new Error(message)` e perdia o código —
 * então "número inválido" (falha permanente do contato) e "Meta limitou a taxa"
 * (falha temporária, o contato teria sucesso depois) eram indistinguíveis, e a
 * lista inteira ia sendo marcada como `failed` enquanto a Meta rejeitava.
 */
export class MetaSendError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
    public readonly subcode?: number,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'MetaSendError';
  }
}

/**
 * Códigos de throttling que afetam o NÚMERO/CONTA inteiro (⇒ pausar a campanha):
 *   4 / 17 / 32 / 613  — limites de chamadas da Graph API (app, usuário, página)
 *   80007              — limite de taxa da WhatsApp Business Management API
 *   130429             — throughput da Cloud API atingido
 *   131048             — "spam rate limit": a Meta está restringindo o número por qualidade
 * De propósito FORA da lista:
 *   131056             — limite do PAR (empresa × este destinatário): é por contato,
 *                        o retry normal resolve; não justifica parar a lista toda.
 *   131026 / 131047 / 131051 — não entregável / fora da janela / tipo inválido: permanentes
 *                        por contato, continuam indo para `failed`.
 */
export const META_THROTTLE_CODES: ReadonlySet<number> = new Set([4, 17, 32, 613, 80007, 130429, 131048]);

export function isMetaThrottleError(err: unknown): boolean {
  if (!(err instanceof MetaSendError)) return false;
  if (err.httpStatus === 429) return true;
  return err.code !== undefined && META_THROTTLE_CODES.has(err.code);
}
