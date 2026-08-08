import { FastifyInstance } from 'fastify';
import axios from 'axios';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { encryptStr } from '../services/encryption';

/**
 * Meta Embedded Signup (WhatsApp Cloud API)
 * ------------------------------------------
 * Fluxo OFICIAL da Meta: o usuário conecta um WhatsApp Business Account (WABA)
 * pelo popup oficial; o frontend devolve um `code` + o sessionInfo (waba_id,
 * phone_number_id). Aqui trocamos o code por um token, assinamos o app no WABA
 * e guardamos o vínculo criptografado (`provider: 'meta'` em WhatsappNumber).
 *
 * Coexiste com o Evolution API — nada aqui migra clientes automaticamente.
 * O vínculo salvo por este módulo só passa a valer para o pipeline real de
 * transcrição (worker) quando `WHATSAPP_OFFICIAL_MULTITENANT_ENABLED=true`;
 * ver `docs/whatsapp-official-golive.md` para o checklist completo de go-live.
 *
 * Segredos (no `.env` do servidor Vultr — nunca em código; ver CLAUDE.md):
 *   META_APP_ID, META_APP_SECRET (fallback FACEBOOK_APP_SECRET),
 *   META_GRAPH_VERSION (opcional, default v23.0), INTERNAL_API_SECRET.
 */

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v23.0';
const GRAPH_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;

function metaAppSecret(): string | undefined {
  return process.env.META_APP_SECRET || process.env.FACEBOOK_APP_SECRET;
}

export default async function metaEmbeddedRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any).authenticate] };

  // ── POST /meta/connect ──────────────────────────────────────────────────
  // Recebe { code, wabaId, phoneNumberId } do Embedded Signup, troca o code
  // por token, assina o app no WABA e persiste o vínculo (token criptografado).
  app.post<{ Body: { code?: string; wabaId?: string; phoneNumberId?: string } }>(
    '/connect',
    { ...auth },
    async (req: any, reply) => {
      const userId = req.user.sub;
      const { code, wabaId, phoneNumberId } = req.body || {};

      const appId     = process.env.META_APP_ID;
      const appSecret = metaAppSecret();

      if (!appId || !appSecret) {
        logger.error('[Meta] META_APP_ID/META_APP_SECRET não configurados');
        return reply.code(500).send({ error: 'Integração Meta não configurada no servidor.' });
      }
      if (!code) {
        return reply.code(400).send({ error: 'code é obrigatório.' });
      }

      try {
        // 1) Trocar o code por um access token (Embedded Signup: sem redirect_uri)
        const tokenRes = await axios.get(`${GRAPH_URL}/oauth/access_token`, {
          params: {
            client_id:     appId,
            client_secret: appSecret,
            code,
          },
          timeout: 15_000,
        });

        const accessToken: string | undefined = tokenRes.data?.access_token;
        const expiresIn: number | undefined   = tokenRes.data?.expires_in;
        if (!accessToken) {
          logger.error('[Meta] Resposta sem access_token na troca de code');
          return reply.code(502).send({ error: 'Falha ao obter token da Meta.' });
        }

        // 2) Assinar o app no WABA (passo de compliance verificado pelo revisor)
        if (wabaId) {
          try {
            await axios.post(
              `${GRAPH_URL}/${wabaId}/subscribed_apps`,
              {},
              { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 15_000 },
            );
            logger.info(`[Meta] App assinado no WABA ${wabaId}`);
          } catch (err: any) {
            // Não bloquear a conexão se a assinatura já existir / falhar pontualmente
            logger.warn(`[Meta] subscribed_apps falhou: ${err?.response?.data?.error?.message || err?.message}`);
          }
        }

        // 3) (Opcional) confirmar o número de telefone exibido
        let displayPhone: string | null = null;
        if (phoneNumberId) {
          try {
            const phoneRes = await axios.get(`${GRAPH_URL}/${phoneNumberId}`, {
              params:  { fields: 'display_phone_number,verified_name' },
              headers: { Authorization: `Bearer ${accessToken}` },
              timeout: 15_000,
            });
            displayPhone = phoneRes.data?.display_phone_number || null;
          } catch (err: any) {
            logger.warn(`[Meta] GET phone number falhou: ${err?.response?.data?.error?.message || err?.message}`);
          }
        }

        const phoneDigits = (displayPhone || '').replace(/\D/g, '');
        const tokenEnc    = encryptStr(accessToken);
        const expiresAt   = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;

        // 4) Persistir o vínculo Meta (1 linha por usuário, provider='meta')
        const existing = await prisma.whatsappNumber.findFirst({
          where: { userId, provider: 'meta' },
        });

        const data = {
          provider:           'meta',
          metaWabaId:         wabaId || null,
          metaPhoneNumberId:  phoneNumberId || null,
          metaBusinessId:     (req.body as any)?.businessId || null,
          metaAccessTokenEnc: tokenEnc,
          metaTokenExpiresAt: expiresAt,
          status:             'connected',
          connectedAt:        new Date(),
          ...(phoneDigits ? { phoneNumber: phoneDigits, displayName: displayPhone } : {}),
        };

        if (existing) {
          await prisma.whatsappNumber.update({ where: { id: existing.id }, data });
        } else {
          await prisma.whatsappNumber.create({
            data: { userId, phoneNumber: phoneDigits || 'pending', ...data },
          });
        }

        logger.info(`[Meta] WABA conectado p/ user ${userId} (waba=${wabaId}, phone=${phoneNumberId})`);
        return reply.send({ ok: true, phoneNumber: displayPhone, wabaId: wabaId || null });
      } catch (err: any) {
        const msg = err?.response?.data?.error?.message || err?.message || 'erro desconhecido';
        logger.error(`[Meta] /connect falhou: ${msg}`);
        return reply.code(502).send({ error: 'Falha ao conectar com a Meta.', detail: msg });
      }
    },
  );

  // ── POST /meta/disconnect ───────────────────────────────────────────────
  app.post('/disconnect', { ...auth }, async (req: any, reply) => {
    const userId = req.user.sub;
    await prisma.whatsappNumber.updateMany({
      where: { userId, provider: 'meta' },
      data: {
        status:             'disconnected',
        metaAccessTokenEnc: null,
        metaTokenExpiresAt: null,
      },
    });
    logger.info(`[Meta] WABA desconectado p/ user ${userId}`);
    return reply.send({ ok: true });
  });

  // ── GET /meta/status ────────────────────────────────────────────────────
  app.get('/status', { ...auth }, async (req: any, reply) => {
    const userId = req.user.sub;
    const conn = await prisma.whatsappNumber.findFirst({
      where:  { userId, provider: 'meta' },
      select: {
        id: true, status: true, phoneNumber: true, displayName: true,
        metaWabaId: true, metaPhoneNumberId: true, connectedAt: true,
      },
    });
    return reply.send({ connected: !!conn && conn.status === 'connected', connection: conn });
  });

  // ── POST /meta/deauthorize-internal ─────────────────────────────────────
  // Chamado server-to-server pelo Next.js quando a Meta dispara o callback de
  // deauthorize. Protegido por INTERNAL_API_SECRET. Limpa o vínculo do usuário.
  app.post<{ Body: { metaUserId?: string; wabaId?: string } }>(
    '/deauthorize-internal',
    async (req: any, reply) => {
      const authHeader     = req.headers.authorization as string | undefined;
      const internalSecret = process.env.INTERNAL_API_SECRET;
      if (!internalSecret || authHeader !== `Bearer ${internalSecret}`) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const { wabaId } = req.body || {};
      if (wabaId) {
        await prisma.whatsappNumber.updateMany({
          where: { provider: 'meta', metaWabaId: wabaId },
          data:  { status: 'disconnected', metaAccessTokenEnc: null, metaTokenExpiresAt: null },
        });
      }
      logger.info(`[Meta] deauthorize recebido (waba=${wabaId || 'n/a'})`);
      return reply.send({ ok: true });
    },
  );
}
