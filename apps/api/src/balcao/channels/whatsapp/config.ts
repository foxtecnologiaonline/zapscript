import crypto from 'crypto';
import { prisma } from '../../../lib/prisma';
import { decryptJson } from '../../core/crypto';
import type { WaConfig } from './graph';

/** Resolução de órgão ↔ integração WhatsApp (o webhook da Meta é único por app e não identifica o órgão). */
export interface WaIntegrationRow { id: string; orgId: string; enabled: boolean; config: WaConfig }

let cache: { at: number; rows: WaIntegrationRow[] } | null = null;
const TTL_MS = 5_000;

export function invalidateWaConfigCache(): void { cache = null; }

export async function listWaIntegrations(fresh = false): Promise<WaIntegrationRow[]> {
  if (!fresh && cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  const rows = await prisma.bvIntegration.findMany({ where: { type: 'WHATSAPP', name: 'default' } });
  const out: WaIntegrationRow[] = [];
  for (const r of rows) {
    try { out.push({ id: r.id, orgId: r.orgId, enabled: r.enabled, config: (r.configEnc ? decryptJson<WaConfig>(r.configEnc) : {}) as WaConfig }); } catch { /* config ilegível: ignora */ }
  }
  cache = { at: Date.now(), rows: out };
  return out;
}

async function findBy(pred: (r: WaIntegrationRow) => boolean): Promise<WaIntegrationRow | null> {
  const hit = (await listWaIntegrations()).find(pred);
  if (hit) return hit;
  return (await listWaIntegrations(true)).find(pred) ?? null; // cache pode estar velho: relê 1 vez
}

/** Integração (habilitada) dona do número `phone_number_id` do payload. */
export const findByPhoneNumberId = (id: string) => findBy((r) => r.enabled && !!id && r.config.phoneNumberId === id);
/** Integração dona da WABA (campos de template chegam com entry.id = wabaId). */
export const findByWabaId = (id: string) => findBy((r) => r.enabled && !!id && r.config.wabaId === id);

const eq = (a: string, b: string): boolean => {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
};

/** Verificação GET do webhook: aceita se o token bate com o de alguma integração (todas são comparadas, sem curto-circuito). */
export async function verifyTokenMatches(token: string): Promise<boolean> {
  if (!token) return false;
  let ok = false;
  for (const r of await listWaIntegrations(true)) {
    if (r.config.verifyToken && eq(token, r.config.verifyToken)) ok = true;
  }
  return ok;
}

/** x-hub-signature-256 = "sha256=" + HMAC-SHA256(corpo bruto, appSecret). */
export function validSignature(rawBody: Buffer | undefined, header: string | undefined, appSecret: string | undefined): boolean {
  if (!rawBody || !header || !appSecret) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!m) return false;
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(m[1], 'hex'));
}

export const SECRET_PLACEHOLDER = '••••••';
