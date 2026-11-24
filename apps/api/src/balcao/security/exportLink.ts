import { redis } from '../../services/queue';
import { hashToken, randomToken } from '../core/crypto';

/**
 * Link de download de uso único da exportação integral (TR 7.1.14.2). O front não precisa carregar o arquivo (GBs) em memória
 * via fetch+Blob: pede um link e o navegador baixa direto, em streaming. O token é aleatório (256 bits), vale 60 s e é
 * guardado no Redis só como hash (SHA-256) — vazar o Redis não vaza links válidos. Consumido na 1ª requisição.
 */
export const EXPORT_LINK_TTL_SEC = 60;
const key = (token: string) => `bv:exportlink:${hashToken(token)}`;

export interface ExportLinkGrant { orgId: string; jobId: string; userId: string }

export async function issueExportLink(grant: ExportLinkGrant): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken(32);
  await redis.set(key(token), JSON.stringify(grant), 'EX', EXPORT_LINK_TTL_SEC);
  return { token, expiresAt: new Date(Date.now() + EXPORT_LINK_TTL_SEC * 1000) };
}

/** Consome o token (atômico: `DEL` devolve 1 só para quem chegou primeiro). null = inválido, expirado ou já usado. */
export async function consumeExportLink(token: string): Promise<ExportLinkGrant | null> {
  if (!token || token.length < 20 || token.length > 128) return null;
  try {
    const raw = await redis.get(key(token));
    if (!raw) return null;
    if ((await redis.del(key(token))) !== 1) return null;
    const g = JSON.parse(raw) as ExportLinkGrant;
    return g?.orgId && g?.jobId ? g : null;
  } catch { return null; }
}
