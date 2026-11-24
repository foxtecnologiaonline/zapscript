import type { FastifyRequest } from 'fastify';
import { prisma } from '../../../lib/prisma';
import { getOrgSettings, type BvOrgSettings } from '../../core/settings';

/**
 * Configuração do webchat: variáveis de ambiente (lidas a cada uso, para permitir ajuste em teste),
 * configurações públicas do órgão (settings.webchat) e validação de Origin.
 */

const int = (name: string, def: number, min = 1, max = Number.MAX_SAFE_INTEGER): number => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= min && n <= max ? Math.floor(n) : def;
};

export const WIDGET_VERSION = '1.1.0';

/** Tamanho máximo de um trecho de legenda (relé efêmero, nunca gravado). */
export const MAX_CAPTION_CHARS = 500;

export const env = {
  /** Base do Jitsi para o atendimento por vídeo (BV_JITSI_BASE_URL). */
  jitsiBase: (): string => {
    const raw = (process.env.BV_JITSI_BASE_URL || 'https://meet.jit.si').trim().replace(/\/+$/, '');
    return /^https?:\/\/[^\s]+$/i.test(raw) ? raw : 'https://meet.jit.si';
  },
  /** Inatividade (s) até a sessão do visitante expirar. */
  sessionTtlSec: () => int('BV_WEBCHAT_SESSION_TTL_SEC', 12 * 3600, 60),
  maxMessageChars: () => int('BV_WEBCHAT_MAX_MESSAGE_CHARS', 2000, 10, 20000),
  maxAttachmentBytes: () => int('BV_WEBCHAT_MAX_ATTACHMENT_MB', 5, 1, 15) * 1024 * 1024,
  /** Força a validação de Origin mesmo fora de produção. */
  enforceOrigin: () => process.env.NODE_ENV === 'production' || process.env.BV_WEBCHAT_ENFORCE_ORIGIN === '1',
  demoEnabled: () => process.env.BV_WEBCHAT_DEMO !== 'off',
  rl: {
    ip: () => int('BV_WEBCHAT_RL_IP', 300), // req/min por IP (todas as rotas públicas)
    sessionsPerIp: () => int('BV_WEBCHAT_RL_SESSIONS', 10), // sessões novas/min por IP
    msg: () => int('BV_WEBCHAT_RL_MSG', 20), // mensagens/min por sessão
    attach: () => int('BV_WEBCHAT_RL_ATTACH', 6), // anexos/min por sessão
    poll: () => int('BV_WEBCHAT_RL_POLL', 120), // leituras/min por sessão
    typing: () => int('BV_WEBCHAT_RL_TYPING', 60),
    caption: () => int('BV_WEBCHAT_RL_CAPTION', 240), // trechos de legenda/min por sessão (visitante) ou por atendente
    action: () => int('BV_WEBCHAT_RL_ACTION', 30), // human/csat/end/video/identify por minuto
  },
};

/** Tipos de anexo aceitos do visitante (validados também pelos bytes iniciais do arquivo). */
export const ATTACHMENT_TYPES: Record<string, { ext: string; kind: 'IMAGE' | 'DOCUMENT' }> = {
  'image/png': { ext: 'png', kind: 'IMAGE' },
  'image/jpeg': { ext: 'jpg', kind: 'IMAGE' },
  'image/webp': { ext: 'webp', kind: 'IMAGE' },
  'image/gif': { ext: 'gif', kind: 'IMAGE' },
  'application/pdf': { ext: 'pdf', kind: 'DOCUMENT' },
};

/** Confere os "magic bytes" — não confiamos no Content-Type informado pelo cliente. */
export function sniffMime(buf: Buffer): string | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 6 && (buf.subarray(0, 6).toString('latin1') === 'GIF87a' || buf.subarray(0, 6).toString('latin1') === 'GIF89a')) return 'image/gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

/** Configurações do webchat além das tipadas no core (lidas de settings.webchat; todas opcionais). */
export interface WebchatSettings {
  allowedOrigins: string[];
  title: string;
  primaryColor: string;
  offlineMessage: string;
  welcomeMessage?: string;
  privacyNotice?: string;
  aiNotice?: string;
  videoEnabled?: boolean;
  humanButtonEnabled?: boolean;
  attachmentsEnabled?: boolean;
  position?: 'right' | 'left';
}

export const DEFAULT_PRIVACY_NOTICE =
  'Ao conversar, seus dados serão tratados conforme a LGPD (Lei 13.709/2018), apenas para fins de atendimento. Não informe senhas nem dados sensíveis desnecessários.';
export const DEFAULT_AI_NOTICE =
  'O atendimento começa com um assistente virtual (inteligência artificial). Você pode pedir para falar com um atendente humano a qualquer momento.';

export const webchatSettings = (s: BvOrgSettings): WebchatSettings => s.webchat as WebchatSettings;

export const safeColor = (c: unknown, fallback = '#1f4e9c'): string => (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : fallback);

// ── Origin ───────────────────────────────────────────────────────────────────
export const normOrigin = (o: string): string => o.trim().toLowerCase().replace(/\/+$/, '');

function matchOrigin(origin: string, pattern: string): boolean {
  if (pattern === '*') return true;
  if (!pattern.includes('*')) return origin === pattern;
  // "https://*.exemplo.jus.br" casa subdomínios (não o domínio raiz)
  const [scheme, rest] = pattern.split('://');
  const m = /^\*\.(.+)$/.exec(rest ?? '');
  if (!scheme || !m) return false;
  const o = /^([a-z]+):\/\/(.+)$/.exec(origin);
  return !!o && o[1] === scheme && o[2].endsWith('.' + m[1]) && o[2].length > m[1].length + 1;
}

export const selfOrigin = (req: Pick<FastifyRequest, 'protocol' | 'headers'>): string => normOrigin(`${req.protocol}://${req.headers.host ?? ''}`);

/**
 * Valida o header Origin contra settings.webchat.allowedOrigins.
 *  - lista preenchida: sempre exige (Origin ausente só passa em GET — navegadores omitem em GET same-origin);
 *  - lista vazia: libera em desenvolvimento; em produção (ou BV_WEBCHAT_ENFORCE_ORIGIN=1) nega tudo;
 *  - "*" na lista libera explicitamente; a página /demo (mesma origem da API) é sempre aceita.
 */
export function originAllowed(req: Pick<FastifyRequest, 'protocol' | 'headers' | 'method'>, s: BvOrgSettings): boolean {
  const raw = req.headers.origin;
  const origin = typeof raw === 'string' ? normOrigin(raw) : '';
  const list = (webchatSettings(s).allowedOrigins ?? []).filter((x) => typeof x === 'string').map(normOrigin).filter(Boolean);
  if (origin && env.demoEnabled() && origin === selfOrigin(req)) return true;
  if (!origin) {
    if (req.method === 'GET' || req.method === 'HEAD') return true;
    return !(list.length > 0 || env.enforceOrigin());
  }
  if (origin === 'null') return false;
  if (list.length === 0) return !env.enforceOrigin();
  return list.some((p) => matchOrigin(origin, p));
}

/** Variante para o handshake do Socket.IO (navegadores sempre enviam Origin no WebSocket). */
export function originAllowedForSocket(origin: string | undefined, s: BvOrgSettings, self?: string): boolean {
  const o = origin ? normOrigin(origin) : '';
  const list = (webchatSettings(s).allowedOrigins ?? []).filter((x) => typeof x === 'string').map(normOrigin).filter(Boolean);
  if (o && self && env.demoEnabled() && o === self) return true;
  if (!o) return !(list.length > 0 || env.enforceOrigin());
  if (o === 'null') return false;
  if (list.length === 0) return !env.enforceOrigin();
  return list.some((p) => matchOrigin(o, p));
}

export async function loadOrgBySlug(slug: string) {
  return prisma.bvOrg.findUnique({ where: { slug }, select: { id: true, slug: true, name: true } });
}

export { getOrgSettings };
