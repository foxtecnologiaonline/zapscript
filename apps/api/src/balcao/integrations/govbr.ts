import crypto from 'crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { audit } from '../core/audit';
import { blindIndex, randomToken } from '../core/crypto';
import { getIntegration } from '../core/integrations';
import { mergeContacts, normalizeDocument, setContactDocument } from '../core/contacts';
import { sendMessage } from '../core/conversations';
import { registerBotTool } from '../core/tools';
import {
  buildAuthorizeUrl, exchangeCode, hitLimit, htmlPage, logged, newPkce, publicBaseUrl, putOnce, SECURITY_HEADERS, takeOnce, verifyIdToken,
  type Deps, type OidcClientConfig,
} from './common';
import { httpClientFor, IntegrationError, parseJsonSafe, type HttpClient } from './http-client';

/**
 * GOV.BR — login único (OIDC authorization code + PKCE) para o CIDADÃO (não é login de equipe).
 * Confirma identidade (CPF + nível bronze/prata/ouro) numa conversa; a consulta processual exige ouro.
 */

export const LEVELS = ['bronze', 'prata', 'ouro'] as const;
export type GovbrLevel = (typeof LEVELS)[number];
const RANK: Record<GovbrLevel, number> = { bronze: 1, prata: 2, ouro: 3 };

export const govbrConfigSchema = z.object({
  clientId: z.string().min(1).max(300),
  clientSecret: z.string().min(1).max(500),
  redirectUri: z.string().url().max(500),
  issuer: z.string().min(1).max(500),
  authorizeUrl: z.string().url().max(500),
  tokenUrl: z.string().url().max(500),
  jwksUri: z.string().url().max(500),
  userinfoUrl: z.string().url().max(500).optional(),
  /** Pode conter `{cpf}`. Resposta esperada: lista de níveis (ids 1..3 ou nomes). */
  confiabilidadesUrl: z.string().max(500).optional(),
  scopes: z.array(z.string().max(100)).max(20).default(['openid', 'email', 'phone', 'profile', 'govbr_confiabilidades']),
  requiredLevel: z.enum(LEVELS).default('ouro'),
  tokenAuthMethod: z.enum(['basic', 'post']).default('basic'),
  timeoutMs: z.number().int().min(500).max(60_000).default(10_000),
  allowPrivateHosts: z.boolean().optional(),
});
export type GovbrConfig = z.infer<typeof govbrConfigSchema>;
export const GOVBR_SECRETS = ['clientSecret'];

const STATE_TTL_SEC = 10 * 60; // state/nonce/verifier: 10 min, uso único
const LINK_TTL_SEC = 30 * 60; // link entregue ao cidadão
const NS = 'govbr';

async function loadConfig(orgId: string): Promise<GovbrConfig> {
  const row = await getIntegration<Record<string, any>>(orgId, 'GOVBR');
  if (!row?.enabled) throw new IntegrationError('govbr.not_configured', 'Integração GOV.BR não configurada');
  const p = govbrConfigSchema.safeParse(row.config);
  if (!p.success) throw new IntegrationError('govbr.not_configured', 'Configuração GOV.BR inválida');
  return p.data;
}

// ── Link assinado entregue ao cidadão ───────────────────────────────────────────────────────────
const sign = (orgId: string, conversationId: string, contactId: string, exp: number) => blindIndex(`${orgId}|${conversationId}|${contactId}|${exp}`, 'govbr-link');
function safeEq(a: string, b: string) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); }

/** URL (assinada, validade 30 min) que o cidadão abre para entrar com GOV.BR e confirmar identidade nesta conversa. */
export async function buildGovbrLoginUrl(orgId: string, conversationId: string): Promise<string> {
  const conv = await prisma.bvConversation.findFirst({ where: { id: conversationId, orgId }, select: { id: true, contactId: true } });
  if (!conv) throw new IntegrationError('govbr.conversation_not_found', 'Conversa não encontrada');
  await loadConfig(orgId);
  const exp = Math.floor(Date.now() / 1000) + LINK_TTL_SEC;
  const q = new URLSearchParams({ conversationId: conv.id, contactId: conv.contactId, exp: String(exp), sig: sign(orgId, conv.id, conv.contactId, exp) });
  return `${publicBaseUrl()}/balcao/integrations/govbr/authorize?${q.toString()}`;
}

// ── Nível (bronze/prata/ouro) ───────────────────────────────────────────────────────────────────
function levelFromValue(v: unknown): GovbrLevel | null {
  if (typeof v === 'number') return v === 1 ? 'bronze' : v === 2 ? 'prata' : v === 3 ? 'ouro' : null;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === '1') return 'bronze'; if (s === '2') return 'prata'; if (s === '3') return 'ouro';
    for (const l of LEVELS) if (s.includes(l)) return l;
    return null;
  }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return levelFromValue(o.id ?? o.nivel ?? o.codigo ?? o.nome ?? o.descricao);
  }
  return null;
}
/** Maior nível encontrado numa lista/objeto de confiabilidades. */
export function highestLevel(payload: unknown): GovbrLevel | null {
  const list: unknown[] = Array.isArray(payload) ? payload : payload && typeof payload === 'object' ? ((payload as any).niveis ?? (payload as any).levels ?? [payload]) : [payload];
  let best: GovbrLevel | null = null;
  for (const it of list) { const l = levelFromValue(it); if (l && (!best || RANK[l] > RANK[best])) best = l; }
  return best;
}

async function resolveLevel(cfg: GovbrConfig, http: HttpClient, cpf: string, accessToken: string | undefined, claims: Record<string, unknown>): Promise<GovbrLevel> {
  if (cfg.confiabilidadesUrl) {
    if (!accessToken) throw new IntegrationError('govbr.no_access_token', 'Sem access_token para consultar confiabilidades');
    const url = cfg.confiabilidadesUrl.replace('{cpf}', encodeURIComponent(cpf));
    const res = await http.request({ url, headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' }, timeoutMs: cfg.timeoutMs });
    if (res.status !== 200) throw new IntegrationError('govbr.confiabilidades_unavailable', `Confiabilidades indisponível (HTTP ${res.status})`, res.status);
    return highestLevel(parseJsonSafe(res.text)) ?? 'bronze';
  }
  return levelFromValue(claims.govbr_level ?? claims.nivel ?? claims.level) ?? 'bronze';
}

export function isValidCpf(raw: string): boolean {
  const d = normalizeDocument(raw);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (n: number) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

// ── Persistência da identidade ──────────────────────────────────────────────────────────────────
/** Grava CPF/sub/nível no contato (o `sub` do GOV.BR é o CPF: guardamos só o índice cego, nunca o CPF em claro numa coluna aberta). Se o CPF/sub já pertence a outro contato (ex.: mesmo cidadão por outro canal), mescla nele. */
export async function applyGovbrIdentity(orgId: string, contactId: string, id: { cpf: string; sub: string; level: GovbrLevel; name?: string | null }): Promise<string> {
  let target = contactId;
  const existing = await prisma.bvContact.findFirst({
    where: { orgId, mergedIntoId: null, id: { not: contactId }, OR: [{ govbrSub: id.sub }, { documentHash: blindIndex(id.cpf) }] }, select: { id: true },
  });
  if (existing) { await mergeContacts(orgId, existing.id, contactId); target = existing.id; }
  await setContactDocument(target, id.cpf);
  await prisma.bvContact.update({
    where: { id: target },
    data: { govbrSub: id.sub, govbrLevel: id.level, identityVerifiedAt: new Date(), ...(id.name ? { name: id.name.slice(0, 200) } : {}) },
  });
  return target;
}

async function notifyConversation(orgId: string, conversationId: string, body: string) {
  try { await sendMessage({ orgId, conversationId, senderType: 'SYSTEM', body }); } catch (err: any) { logger.warn({ err: err?.message }, '[balcao] govbr: falha ao avisar a conversa'); }
}

// ── Rotas públicas (cidadão) ────────────────────────────────────────────────────────────────────
const authorizeQuery = z.object({ conversationId: z.string().min(1).max(64), contactId: z.string().min(1).max(64), exp: z.coerce.number().int(), sig: z.string().min(16).max(128) });
const callbackQuery = z.object({ code: z.string().max(2000).optional(), state: z.string().min(8).max(200).optional(), error: z.string().max(100).optional() });

function page(reply: FastifyReply, status: number, title: string, message: string, kind: 'ok' | 'error') {
  return reply.code(status).headers({ ...SECURITY_HEADERS, 'content-type': 'text/html; charset=utf-8' }).send(htmlPage(title, message, kind));
}
const errorPage = (reply: FastifyReply, status = 400) => page(reply, status, 'Não foi possível confirmar sua identidade', 'O link expirou, já foi usado ou houve um problema na autenticação. Volte ao atendimento e peça um novo link.', 'error');

export function registerGovbrRoutes(app: FastifyInstance, deps: Deps = {}): void {
  app.get('/govbr/authorize', async (req, reply) => {
    if (!(await hitLimit('govbr-auth', req.ip, 30, 600))) return page(reply, 429, 'Muitas tentativas', 'Aguarde alguns minutos e tente novamente.', 'error');
    const q = authorizeQuery.safeParse(req.query);
    if (!q.success) return errorPage(reply);
    const conv = await prisma.bvConversation.findFirst({ where: { id: q.data.conversationId, contactId: q.data.contactId }, select: { id: true, orgId: true, contactId: true } });
    if (!conv || q.data.exp < Math.floor(Date.now() / 1000) || !safeEq(q.data.sig, sign(conv.orgId, conv.id, conv.contactId, q.data.exp))) return errorPage(reply);
    try {
      const cfg = await loadConfig(conv.orgId);
      const { verifier, challenge } = newPkce();
      const state = randomToken(24), nonce = randomToken(24);
      await putOnce(NS, state, { orgId: conv.orgId, conversationId: conv.id, contactId: conv.contactId, nonce, verifier }, STATE_TTL_SEC);
      return reply.header('cache-control', 'no-store').redirect(buildAuthorizeUrl(cfg as OidcClientConfig, { state, nonce, challenge }));
    } catch (err: any) {
      logger.warn({ code: err?.code }, '[balcao] govbr/authorize falhou');
      return errorPage(reply, 400);
    }
  });

  app.get('/govbr/callback', async (req, reply) => {
    if (!(await hitLimit('govbr-cb', req.ip, 60, 600))) return page(reply, 429, 'Muitas tentativas', 'Aguarde alguns minutos e tente novamente.', 'error');
    const q = callbackQuery.safeParse(req.query);
    if (!q.success || !q.data.state) return errorPage(reply);
    const rec = await takeOnce<{ orgId: string; conversationId: string; contactId: string; nonce: string; verifier: string }>(NS, q.data.state);
    if (!rec) return errorPage(reply); // state inválido, expirado ou replay
    if (q.data.error || !q.data.code) return errorPage(reply);

    try {
      const cfg = await loadConfig(rec.orgId);
      const http = deps.http ?? httpClientFor(cfg);
      const outcome = await logged(rec.orgId, 'GOVBR', 'login', async () => {
        const tokens = await exchangeCode(cfg as OidcClientConfig, http, q.data.code!, rec.verifier);
        const claims = await verifyIdToken(cfg as OidcClientConfig, http, tokens.idToken, rec.nonce);
        const cpf = normalizeDocument(String(claims.sub));
        if (!isValidCpf(cpf)) throw new IntegrationError('govbr.invalid_sub', 'sub não é um CPF válido');
        const level = await resolveLevel(cfg, http, cpf, tokens.accessToken, claims as Record<string, unknown>);
        return { cpf, level, name: typeof claims.name === 'string' ? claims.name : null };
      });

      if (RANK[outcome.level] < RANK[cfg.requiredLevel]) {
        await audit({ orgId: rec.orgId, actorType: 'CONTACT', actorId: rec.contactId, action: 'govbr.level_insufficient', meta: { level: outcome.level, required: cfg.requiredLevel } });
        await notifyConversation(rec.orgId, rec.conversationId, `Não foi possível confirmar sua identidade: é exigido o nível ${cfg.requiredLevel} do GOV.BR.`);
        return errorPage(reply, 403);
      }

      const contactId = await applyGovbrIdentity(rec.orgId, rec.contactId, { cpf: outcome.cpf, sub: blindIndex(outcome.cpf, 'govbr-sub'), level: outcome.level, name: outcome.name });
      await audit({ orgId: rec.orgId, actorType: 'CONTACT', actorId: contactId, action: 'govbr.identity_verified', entityType: 'conversation', entityId: rec.conversationId, meta: { level: outcome.level } });
      await notifyConversation(rec.orgId, rec.conversationId, `Identidade confirmada (nível ${outcome.level}).`);
      return page(reply, 200, 'Identidade confirmada', 'Você já pode voltar ao atendimento.', 'ok');
    } catch (err: any) {
      logger.warn({ code: err?.code ?? 'unexpected' }, '[balcao] govbr/callback falhou');
      return errorPage(reply, 400);
    }
  });
}

/** Ferramenta do bot: devolve o link para o cidadão se autenticar com GOV.BR. */
export function registerGovbrTool(): void {
  registerBotTool({
    name: 'identity.request_login',
    description: 'Gera o link para o cidadão confirmar a identidade com o GOV.BR (necessário para consultar processos). Entregue o link ao cidadão.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (ctx) => {
      try {
        const url = await buildGovbrLoginUrl(ctx.orgId, ctx.conversationId);
        return { ok: true, data: { url, validForMinutes: LINK_TTL_SEC / 60 }, message: `Para confirmar sua identidade, acesse o link (válido por ${LINK_TTL_SEC / 60} minutos) e entre com sua conta GOV.BR: ${url}` };
      } catch {
        return { ok: false, message: 'A confirmação de identidade pelo GOV.BR não está disponível no momento. Posso transferir você para um atendente.' };
      }
    },
  });
}

/** Teste de conexão: JWKS válido e tela de autorização acessível. */
export async function testGovbr(cfg: GovbrConfig, deps: Deps = {}): Promise<{ ok: boolean; message: string }> {
  const http = deps.http ?? httpClientFor(cfg);
  try {
    const j = await http.request({ url: cfg.jwksUri, timeoutMs: cfg.timeoutMs });
    const keys = parseJsonSafe<{ keys?: unknown[] }>(j.text)?.keys;
    if (j.status !== 200 || !Array.isArray(keys) || !keys.length) return { ok: false, message: 'JWKS indisponível ou vazio' };
    const a = await http.request({ url: cfg.authorizeUrl, timeoutMs: cfg.timeoutMs });
    if (a.status >= 500) return { ok: false, message: `Endpoint de autorização com erro (HTTP ${a.status})` };
    return { ok: true, message: `JWKS com ${keys.length} chave(s); autorização acessível` };
  } catch (err: any) {
    return { ok: false, message: err instanceof IntegrationError ? err.code : 'Falha de rede' };
  }
}
