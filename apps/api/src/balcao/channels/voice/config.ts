import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { getIntegration } from '../../core/integrations';

/** Configuração de voz: variáveis de ambiente (infra) + integração SIP_TRUNK/URA_0800 do órgão (config cifrada). */
export const voiceEnabled = () => process.env.BV_VOICE_ENABLED === '1';
export const devSimulatorsEnabled = () => process.env.BV_DEV_SIMULATORS === '1';

export const ariApp = () => process.env.BV_ARI_APP || 'balcao';
export const recordingDir = () => process.env.BV_ASTERISK_RECORDING_DIR || '/var/spool/asterisk/recording';
export const agentRingMs = () => Math.max(1, Number(process.env.BV_AGENT_RING_SEC || 20)) * 1000;
export const maxQueueMs = () => Math.max(10, Number(process.env.BV_VOICE_MAX_QUEUE_SEC || 1200)) * 1000;

export interface AriConnection { url: string; username: string; password: string; app: string }

export function ariFromEnv(): AriConnection | null {
  const url = process.env.BV_ARI_URL;
  if (!url) return null;
  return { url: url.replace(/\/+$/, ''), username: process.env.BV_ARI_USER || 'balcao', password: process.env.BV_ARI_PASS || '', app: ariApp() };
}

export const trunkConfigSchema = z.strictObject({
  host: z.string().max(200).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  transport: z.enum(['udp', 'tcp', 'tls']).optional(),
  authMode: z.enum(['registration', 'userpass', 'ip']).optional(),
  username: z.string().max(100).optional(),
  password: z.string().max(200).optional(),
  identifyIps: z.array(z.string().max(64)).max(20).optional(),
  codecs: z.array(z.enum(['ulaw', 'alaw', 'opus', 'g722'])).max(6).optional(),
  dtmfMode: z.enum(['rfc4733', 'inband', 'info']).optional(),
  fromUser: z.string().max(100).optional(),
  fromDomain: z.string().max(200).optional(),
  /** Nome do endpoint PJSIP do tronco (pjsip.conf) usado para originar chamadas/transbordo. */
  trunkEndpoint: z.string().regex(/^[A-Za-z0-9_.-]{1,60}$/).optional(),
  /** DIDs/0800 que chegam por este tronco (resolve o órgão da chamada). */
  dids: z.array(z.string().regex(/^\+?[0-9*#]{2,20}$/)).max(100).optional(),
  /** Cabeçalhos SIP X-* da URA 0800 copiados para a chamada/conversa. */
  preserveHeaders: z.array(z.string().regex(/^[Xx]-[A-Za-z0-9-]{1,60}$/)).max(20).optional(),
  transferCallerId: z.enum(['original', 'trunk']).optional(),
  transferRingSec: z.number().int().min(5).max(120).optional(),
  speakProtocol: z.enum(['start', 'off']).optional(),
  autoCloseOnEnd: z.boolean().optional(),
  recordIvrPhase: z.boolean().optional(),
  ari: z.strictObject({ url: z.string().url(), username: z.string().max(100), password: z.string().max(200) }).optional(),
});
export type TrunkConfig = z.infer<typeof trunkConfigSchema>;

export const DEFAULT_TRUNK: Required<Pick<TrunkConfig, 'trunkEndpoint' | 'preserveHeaders' | 'transferRingSec' | 'speakProtocol' | 'autoCloseOnEnd' | 'recordIvrPhase' | 'transferCallerId'>> = {
  trunkEndpoint: 'tjto-trunk', preserveHeaders: ['X-URA-Option', 'X-URA-Id', 'X-Protocolo-0800'], transferRingSec: 45, speakProtocol: 'start', autoCloseOnEnd: true, recordIvrPhase: true, transferCallerId: 'original',
};

export async function loadTrunkConfig(orgId: string): Promise<TrunkConfig & typeof DEFAULT_TRUNK> {
  const i = await getIntegration<TrunkConfig>(orgId, 'SIP_TRUNK');
  return { ...DEFAULT_TRUNK, ...((i?.config ?? {}) as TrunkConfig) } as any;
}

/** Descobre o órgão dono de um DID: fluxos ACTIVE (definition.dids) → integrações SIP_TRUNK/URA_0800 → BV_VOICE_ORG_ID → único órgão com tronco. */
export async function resolveOrgForDid(did: string | null | undefined): Promise<string | null> {
  if (did) {
    const flow = await prisma.bvIvrFlow.findFirst({ where: { status: 'ACTIVE', definition: { path: ['dids'], array_contains: did } }, select: { orgId: true } });
    if (flow) return flow.orgId;
  }
  const rows = await prisma.bvIntegration.findMany({ where: { type: { in: ['SIP_TRUNK', 'URA_0800'] }, enabled: true }, select: { orgId: true, type: true } });
  if (did) {
    for (const r of rows) {
      const i = await getIntegration<any>(r.orgId, r.type as any);
      const dids: string[] = [...(i?.config?.dids ?? []), ...(i?.config?.did ? [i.config.did] : [])];
      if (dids.includes(did)) return r.orgId;
    }
  }
  if (process.env.BV_VOICE_ORG_ID) return process.env.BV_VOICE_ORG_ID;
  const orgs = [...new Set(rows.map((r) => r.orgId))];
  return orgs.length === 1 ? orgs[0] : null;
}

/** Credenciais ARI: ambiente primeiro; senão a 1ª integração SIP_TRUNK habilitada com `ari`. */
export async function loadAriConnection(): Promise<AriConnection | null> {
  const env = ariFromEnv();
  if (env) return env;
  const rows = await prisma.bvIntegration.findMany({ where: { type: 'SIP_TRUNK', enabled: true }, select: { orgId: true } });
  for (const r of rows) {
    const i = await getIntegration<TrunkConfig>(r.orgId, 'SIP_TRUNK');
    if (i?.config?.ari) return { url: i.config.ari.url.replace(/\/+$/, ''), username: i.config.ari.username, password: i.config.ari.password, app: ariApp() };
  }
  return null;
}
