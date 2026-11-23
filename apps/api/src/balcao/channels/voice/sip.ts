import crypto from 'crypto';

/**
 * Credenciais SIP dos atendentes (WebRTC). A senha NÃO é guardada: é derivada de um segredo do servidor
 * (BV_SIP_SECRET) e do ramal — HMAC-SHA256(secret, ramal) em base64url, truncada em 24 caracteres.
 * `infra/asterisk/gen-agents.js` calcula a MESMA derivação para gerar os endpoints do PJSIP; mudar um lado
 * exige mudar o outro (há teste de paridade em __tests__/voice.test.ts).
 */
export const SIP_PASSWORD_LENGTH = 24;

export function deriveSipPassword(secret: string, extension: string): string {
  if (!secret) throw new Error('BV_SIP_SECRET não configurado');
  return crypto.createHmac('sha256', secret).update(String(extension)).digest('base64url').slice(0, SIP_PASSWORD_LENGTH);
}

export interface IceServer { urls: string | string[]; username?: string; credential?: string }

/** BV_ICE_SERVERS (JSON). Padrão: STUN público — em rede restrita do órgão, configure STUN/TURN próprios. */
export function parseIceServers(raw = process.env.BV_ICE_SERVERS): IceServer[] {
  if (raw) {
    try { const v = JSON.parse(raw); if (Array.isArray(v)) return v as IceServer[]; } catch { /* usa o padrão */ }
  }
  return [{ urls: ['stun:stun.l.google.com:19302'] }];
}

export interface SoftphoneCredentials { wssUrl: string; sipUri: string; domain: string; ramal: string; senha: string; iceServers: IceServer[]; displayName: string }

export function buildSoftphoneCredentials(user: { name: string; sipExtension: string }, env = process.env): SoftphoneCredentials | null {
  const secret = env.BV_SIP_SECRET;
  if (!secret) return null;
  const domain = env.BV_SIP_DOMAIN || env.BV_SIP_WSS_HOST || 'balcao.local';
  const wssUrl = env.BV_SIP_WSS_URL || `wss://${env.BV_SIP_WSS_HOST || domain}:8089/ws`;
  return {
    wssUrl, domain, sipUri: `sip:${user.sipExtension}@${domain}`, ramal: user.sipExtension,
    senha: deriveSipPassword(secret, user.sipExtension), iceServers: parseIceServers(env.BV_ICE_SERVERS), displayName: user.name,
  };
}
