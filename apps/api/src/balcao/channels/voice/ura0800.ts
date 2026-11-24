import net from 'net';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { getIntegration } from '../../core/integrations';
import { DEFAULT_TRUNK, type TrunkConfig } from './config';

/**
 * Integração `URA_0800` (cifrada em BvIntegration): a URA 0800 do TJTO entrega a chamada ao Balcão com cabeçalhos SIP `X-*`.
 *  - `dids[]`        DIDs/0800 que chegam por este canal → nome do fluxo de URA (ACTIVE) que os atende;
 *  - `headerMap`     nome lógico → cabeçalho SIP (ex.: `opcao: 'X-TJTO-URA-Opcao'`). Os cabeçalhos listados são lidos de cada INVITE e
 *                    gravados em `metadata.voice.ura0800.headers` (por nome lógico); `opcao` também vira `metadata.ivr.entryOption`;
 *  - `allowedSourceIps` (opcional) IPs/CIDRs de origem aceitos para estes DIDs (exige o dialplan expor `BV_SRC_ADDR` — ver infra/asterisk).
 */
const numberRe = /^\+?[0-9*#]{2,20}$/;
const logicalName = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const headerName = /^[Xx]-[A-Za-z0-9-]{1,60}$/;

const ipOrCidr = z.string().trim().max(64).refine((v) => {
  const [ip, bits] = v.split('/');
  const fam = net.isIP(ip);
  if (!fam) return false;
  if (bits === undefined) return true;
  return /^\d{1,3}$/.test(bits) && Number(bits) <= (fam === 4 ? 32 : 128);
}, 'IP ou CIDR inválido');

export const ura0800Schema = z.strictObject({
  dids: z.array(z.strictObject({ did: z.string().regex(numberRe, 'DID inválido'), flowName: z.string().trim().min(1).max(80) })).max(100)
    .refine((l) => new Set(l.map((d) => d.did)).size === l.length, 'DID repetido'),
  headerMap: z.record(z.string().regex(logicalName, 'nome lógico inválido'), z.string().regex(headerName, 'cabeçalho deve começar com X-')).default({})
    .refine((m) => Object.keys(m).length <= 20, 'no máximo 20 cabeçalhos'),
  allowedSourceIps: z.array(ipOrCidr).max(50).optional(),
});
export type Ura0800Config = z.infer<typeof ura0800Schema>;

export const URA0800_DEFAULTS = { headerMap: { opcao: 'X-URA-Option', ura: 'X-URA-Id', protocolo: 'X-Protocolo-0800' } as Record<string, string> };

/** Config salva e válida do órgão (integração habilitada); null se ausente/desabilitada/inválida. */
export async function loadUra0800(orgId: string): Promise<Ura0800Config | null> {
  const row = await getIntegration<Record<string, unknown>>(orgId, 'URA_0800');
  if (!row?.enabled) return null;
  const r = ura0800Schema.safeParse(row.config);
  return r.success ? r.data : null;
}

const sameHeader = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const isDefaultPreserve = (l: string[] | undefined) => !l || JSON.stringify(l) === JSON.stringify(DEFAULT_TRUNK.preserveHeaders);

/**
 * Cabeçalhos a ler de cada INVITE: com URA_0800 configurada, os do `headerMap` (no lugar dos nomes fixos padrão) + os `preserveHeaders`
 * que o órgão definiu explicitamente no tronco; sem ela, `preserveHeaders` do tronco (padrão incluso).
 */
export function headersToCapture(ura: Ura0800Config | null, trunk: Pick<TrunkConfig, 'preserveHeaders'>): string[] {
  const names = ura && Object.keys(ura.headerMap).length
    ? [...Object.values(ura.headerMap), ...(isDefaultPreserve(trunk.preserveHeaders) ? [] : trunk.preserveHeaders ?? [])]
    : trunk.preserveHeaders ?? [];
  const out: string[] = [];
  for (const n of names) if (!out.some((o) => sameHeader(o, n))) out.push(n);
  return out;
}

function lookup(headers: Record<string, string>, name: string): string | undefined {
  const hit = Object.entries(headers).find(([k]) => sameHeader(k, name));
  const v = hit?.[1]?.trim();
  return v ? v : undefined;
}

/** Cabeçalhos capturados → { nomeLógico: valor }. */
export function mapUraHeaders(ura: Ura0800Config | null, headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [logical, header] of Object.entries(ura?.headerMap ?? {})) { const v = lookup(headers, header); if (v !== undefined) out[logical] = v; }
  return out;
}

/** Opção de entrada da URA (`opcao` do headerMap; sem URA_0800, o cabeçalho legado `X-URA-Option`). */
export function entryOptionOf(ura: Ura0800Config | null, headers: Record<string, string>): string | null {
  const header = ura?.headerMap.opcao ?? URA0800_DEFAULTS.headerMap.opcao;
  return lookup(headers, header) ?? null;
}

// ── IP de origem ─────────────────────────────────────────────────────────────────────────────────────
/** `CHANNEL(pjsip,remote_addr)` pode vir como `1.2.3.4:5060`, `[::1]:5060` ou só o IP. */
export function parseSrcAddr(raw: string | undefined | null): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const v6 = /^\[([0-9a-fA-F:.]+)\](?::\d+)?$/.exec(s);
  const candidate = v6 ? v6[1] : /^[^:]+:\d+$/.test(s) ? s.slice(0, s.lastIndexOf(':')) : s;
  return net.isIP(candidate) ? candidate : null;
}

export function sourceIpAllowed(allowed: string[], ip: string): boolean {
  const bl = new net.BlockList();
  for (const entry of allowed) {
    const [addr, bits] = entry.split('/');
    const fam = net.isIP(addr) === 6 ? 'ipv6' : 'ipv4';
    try { if (bits === undefined) bl.addAddress(addr, fam); else bl.addSubnet(addr, Number(bits), fam); } catch { /* entrada inválida: ignora */ }
  }
  const fam = net.isIP(ip) === 6 ? 'ipv6' : 'ipv4';
  if (bl.check(ip, fam)) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip); // IPv4 mapeado em IPv6
  return !!mapped && bl.check(mapped[1], 'ipv4');
}

// ── Autoteste (POST /ura0800/test) ───────────────────────────────────────────────────────────────────
export interface Ura0800TestInput { did?: string; headers?: Record<string, string>; sourceIp?: string }

export async function testUra0800(orgId: string, cfg: Ura0800Config, input: Ura0800TestInput) {
  const dids = input.did ? cfg.dids.filter((d) => d.did === input.did) : cfg.dids;
  const active = await prisma.bvIvrFlow.findMany({ where: { orgId, status: 'ACTIVE' }, select: { id: true, name: true, version: true, definition: true }, orderBy: { publishedAt: 'desc' } });
  const warnings: string[] = [];
  if (input.did && dids.length === 0) warnings.push(`O DID ${input.did} não está em dids[]`);
  if (cfg.dids.length === 0) warnings.push('Nenhum DID configurado: a chamada só será associada ao órgão por SIP_TRUNK/BV_VOICE_ORG_ID');
  const didChecks = dids.map((d) => {
    const flow = active.find((f) => f.name === d.flowName);
    if (!flow) warnings.push(`DID ${d.did}: não há fluxo ACTIVE chamado "${d.flowName}" (a URA cairá no fluxo padrão, se houver)`);
    return { did: d.did, flowName: d.flowName, flowFound: !!flow, flowId: flow?.id ?? null, flowVersion: flow?.version ?? null };
  });
  const headers = input.headers ?? {};
  const captured = mapUraHeaders(cfg, headers);
  const missing = input.headers ? Object.keys(cfg.headerMap).filter((k) => !(k in captured)) : [];
  if (missing.length) warnings.push(`Cabeçalhos ausentes no INVITE de teste: ${missing.join(', ')}`);

  const ipChecks = { configured: !!cfg.allowedSourceIps?.length, tested: null as string | null, allowed: null as boolean | null };
  if (input.sourceIp) {
    const ip = parseSrcAddr(input.sourceIp);
    ipChecks.tested = input.sourceIp;
    ipChecks.allowed = ip ? (cfg.allowedSourceIps?.length ? sourceIpAllowed(cfg.allowedSourceIps, ip) : true) : false;
  }
  const entryOption = entryOptionOf(cfg, headers);
  const entry = (() => {
    if (entryOption == null) return { option: null, node: null as string | null };
    const flowName = (input.did ? cfg.dids.find((d) => d.did === input.did) : cfg.dids[0])?.flowName;
    const flow = active.find((f) => f.name === flowName);
    const by = (flow?.definition as any)?.entryByHeader;
    return { option: entryOption, node: by?.map?.[entryOption] ?? null };
  })();
  const ok = didChecks.every((d) => d.flowFound) && ipChecks.allowed !== false && missing.length === 0 && (dids.length > 0 || !input.did);
  return { ok, dids: didChecks, headers: { map: cfg.headerMap, captured, missing }, sourceIp: ipChecks, entry, warnings };
}
