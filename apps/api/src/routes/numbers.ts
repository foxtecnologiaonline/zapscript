import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { notifyDisconnected } from '../services/whatsapp-notify';
import { validateRequest, createNumberSchema } from '../lib/validation';
import {
  evolutionBaseUrl,
  evolutionHeaders,
  instanceName as evoInstanceName,
  createInstance,
  deleteInstance,
  getConnectionState,
  setWebhook,
} from '../services/evolution';
import { getQr } from '../lib/qrStore';

// ── Helpers ────────────────────────────────────────────────────────────────────

function getApiBase(): string {
  const url = process.env.API_URL || process.env.RENDER_EXTERNAL_URL || process.env.APP_URL;
  if (url) return url.replace(/\/$/, '');
  console.error('[numbers] ⛔ API_URL não configurado! Configure API_URL no .env da Vultr.');
  return '';
}

function buildWebhookUrl(): string {
  const base   = getApiBase();
  const url    = `${base}/webhook/evolution`;
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET;
  return secret ? `${url}?secret=${encodeURIComponent(secret)}` : url;
}

// ── Rotas ──────────────────────────────────────────────────────────────────────
export default async function numberRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any).authenticate] };

  // ── GET /numbers ──────────────────────────────────────────────────────────
  app.get('/', auth, async (req: any) => {
    return prisma.whatsappNumber.findMany({
      where:   { userId: req.user.sub },
      orderBy: { createdAt: 'desc' },
      select: {
        id:           true,
        displayName:  true,
        phoneNumber:  true,
        status:       true,
        messageCount: true,
        minutesUsed:  true,
        connectedAt:  true,
        createdAt:    true,
        privateMode:  true,
      } as any,
    });
  });

  // ── POST /numbers ─────────────────────────────────────────────────────────
  app.post<{ Body: { displayName?: string; phoneNumber?: string } }>('/', auth, async (req: any, reply) => {
    const v = validateRequest(createNumberSchema)(req.body);
    if (!v.valid) return reply.code(400).send({ error: v.error });

    const { displayName, phoneNumber } = req.body;
    const userId = req.user.sub;

    // Admin não tem limite de números
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const count = await prisma.whatsappNumber.count({ where: { userId } });

    if (!user?.isAdmin) {
      const sub = await prisma.subscription.findUnique({ where: { userId }, include: { plan: true } });
      if (count >= sub!.plan.maxNumbers) {
        return reply.code(403).send({
          error: `Limite de ${sub!.plan.maxNumbers} número(s) atingido. Faça upgrade do plano.`,
        });
      }
    }

    const firstName = (user?.name ?? 'Meu').split(' ')[0];
    const finalName = displayName?.trim() || `${firstName} ${count + 1}`;

    let cleanPhone: string | undefined;
    if (phoneNumber) {
      const digits = phoneNumber.replace(/\D/g, '');
      cleanPhone = digits.startsWith('55') ? digits : `55${digits}`;
    }

    const number = await prisma.whatsappNumber.create({
      // Modo Privado nasce desligado (opt-in). Usuário ativa manualmente no painel.
      data: { userId, displayName: finalName, privateMode: false, ...(cleanPhone ? { phoneNumber: cleanPhone } : {}) },
    });

    // Nota: notifyWelcome é disparado via connection.update no webhook Evolution
    // (quando state='open'), não aqui — neste ponto zapiInstanceId ainda é null
    return reply.code(201).send(number);
  });

  // ── PATCH /numbers/:id ────────────────────────────────────────────────────
  app.patch<{ Params: { id: string }; Body: { displayName?: string; privateMode?: boolean } }>(
    '/:id', auth, async (req: any, reply) => {
      const userId = req.user.sub;
      const { id } = req.params;
      const number = await prisma.whatsappNumber.findFirst({ where: { id, userId } });
      if (!number) return reply.code(404).send({ error: 'Número não encontrado.' });

      const data: any = {};

      if (req.body.displayName !== undefined) {
        const trimmed = req.body.displayName.trim();
        if (!trimmed)          return reply.code(400).send({ error: 'Nome não pode ser vazio.' });
        if (trimmed.length > 50) return reply.code(400).send({ error: 'Nome deve ter no máximo 50 caracteres.' });
        data.displayName = trimmed;
      }

      if (req.body.privateMode !== undefined) {
        // Modo Privado disponível em todos os planos (Core incluso) — desligado por
        // padrão, o usuário liga se quiser. Ver revisão de tiers ZapScript 2.0.
        data.privateMode = Boolean(req.body.privateMode);
      }

      if (Object.keys(data).length === 0) {
        return reply.code(400).send({ error: 'Nenhum campo para atualizar.' });
      }

      return prisma.whatsappNumber.update({ where: { id }, data });
    }
  );

  // ── POST /numbers/:id/connect ─────────────────────────────────────────────
  // Cria (ou reutiliza) instância Evolution API dedicada para este número.
  // Cada número tem sua própria instância isolada — sem compartilhamento entre usuários.
  app.post<{ Params: { id: string } }>('/:id/connect', auth, async (req: any, reply) => {
    const { id } = req.params;
    const userId = req.user.sub;

    if (!process.env.EVOLUTION_API_URL || !process.env.EVOLUTION_API_KEY) {
      return reply.code(503).send({
        error: 'Evolution API não configurada. Adicione EVOLUTION_API_URL e EVOLUTION_API_KEY no servidor.',
      });
    }

    const number = await prisma.whatsappNumber.findFirst({ where: { id, userId } });
    if (!number) return reply.code(404).send({ error: 'Número não encontrado' });

    const webhookUrl = buildWebhookUrl();
    const instName   = evoInstanceName(id);  // 'zs-{numberId}'

    try {
      // Verificar se instância já existe no Evolution
      const existingState = await getConnectionState(instName);

      if (existingState === 'open') {
        // Já conectada — re-aplicar webhook (garante byEvents=false) e retornar
        app.log.info(`[Evolution] Instância ${instName} já está conectada (open)`);
        await setWebhook(instName, webhookUrl);
        await (prisma as any).whatsappNumber.update({
          where: { id },
          data: { zapiInstanceId: instName, zapiToken: null, status: 'connected', connectedAt: new Date() },
        });
        return { ok: true, message: 'WhatsApp já conectado.' };

      } else if (existingState === 'connecting') {
        // Instância já está gerando QR — reutilizar, apenas re-aplicar webhook
        // (não deletar: o QR já está disponível no Evolution)
        app.log.info(`[Evolution] Instância ${instName} em "connecting" — reutilizando, re-aplicando webhook`);
        await setWebhook(instName, webhookUrl);

      } else if (existingState === 'close') {
        // Definitivamente desconectada — recriar para estado limpo
        app.log.info(`[Evolution] Instância ${instName} em "close" — recriando`);
        await deleteInstance(instName);
        await new Promise(r => setTimeout(r, 1000));
        await createInstance(id, webhookUrl);
        app.log.info(`[Evolution] ✅ Instância recriada: ${instName}`);

      } else {
        // Instância não existe — criar nova
        app.log.info(`[Evolution] Criando nova instância: ${instName}`);
        await createInstance(id, webhookUrl);
        app.log.info(`[Evolution] ✅ Instância criada: ${instName}`);
      }

      // Vincular nome da instância ao número (campo zapiInstanceId reutilizado)
      await (prisma as any).whatsappNumber.update({
        where: { id },
        data: {
          zapiInstanceId: instName,
          zapiToken:      null,        // Evolution usa chave global, não token por instância
          status:         'connecting',
        },
      });

      return { ok: true, message: 'Pronto para escanear o QR Code.' };

    } catch (err: any) {
      app.log.error({ err: err.message }, '[Evolution] Erro ao criar/conectar instância');
      return reply.code(502).send({ error: `Erro ao configurar instância: ${err.message}` });
    }
  });

  // ── GET /numbers/:id/qr ───────────────────────────────────────────────────
  // Retorna QR Code da instância Evolution como data URI base64.
  // Evolution retorna: { base64: "data:image/png;base64,..." }
  app.get<{ Params: { id: string } }>('/:id/qr', auth, async (req: any, reply) => {
    const { id } = req.params;
    const userId = req.user.sub;

    const number = await (prisma as any).whatsappNumber.findFirst({ where: { id, userId } });
    if (!number) return reply.code(404).send({ error: 'Número não encontrado' });

    const instName = number.zapiInstanceId ?? evoInstanceName(id);

    try {
      // 1) Verificar store em memória (populado pelo webhook qrcode.updated)
      const stored = getQr(instName);
      if (stored) {
        app.log.info(`[Evolution] QR servido do store (instância ${instName})`);
        const qr = stored.startsWith('data:') ? stored : `data:image/png;base64,${stored}`;
        return { qr };
      }

      // 2) Fallback: pedir QR diretamente à Evolution (inicia conexão se necessário)
      const base = evolutionBaseUrl();
      const res = await fetch(
        `${base}/instance/connect/${instName}`,
        { headers: evolutionHeaders(), signal: AbortSignal.timeout(10_000) }
      );

      const rawText = await res.text().catch(() => '');
      app.log.info(`[Evolution] /instance/connect status=${res.status} instância=${instName} body=${rawText.substring(0, 300)}`);

      if (!res.ok) {
        return reply.code(204).send();
      }

      let data: any = {};
      try { data = JSON.parse(rawText); } catch { /* não é JSON */ }

      const b64 = data?.base64 ?? data?.qrcode?.base64 ?? data?.qr?.base64 ?? data?.code ?? null;
      if (!b64) {
        app.log.warn(`[Evolution] QR sem base64 no /instance/connect. Aguardando webhook qrcode.updated...`);
        return reply.code(204).send();
      }

      const qr = b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`;
      return { qr };

    } catch (err: any) {
      app.log.error({ err: err.message }, '[Evolution] Erro ao buscar QR');
      return reply.code(204).send();
    }
  });

  // ── POST /numbers/:id/pairing-code ───────────────────────────────────────
  // Código de pareamento por número de telefone.
  // Evolution API: GET /instance/connect/{name}?number={phone}
  // Com o query param ?number, retorna pairingCode em vez de QR.
  app.post<{ Params: { id: string }; Body: { phone: string } }>(
    '/:id/pairing-code', auth, async (req: any, reply) => {
      const { id } = req.params;
      const { phone } = req.body;
      const userId = req.user.sub;

      if (!phone) return reply.code(400).send({ error: 'Número de telefone obrigatório.' });

      const number = await (prisma as any).whatsappNumber.findFirst({ where: { id, userId } });
      if (!number) return reply.code(404).send({ error: 'Número não encontrado' });

      const instName = number.zapiInstanceId ?? evoInstanceName(id);
      if (!number.zapiInstanceId) {
        return reply.code(400).send({ error: 'Instância não iniciada. Chame /connect primeiro.' });
      }

      const cleanPhone = phone.replace(/\D/g, '');
      const fullPhone  = cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`;

      try {
        const base = evolutionBaseUrl();

        // Pairing code: mesmo endpoint do QR, mas com ?number= na query string
        // GET /instance/connect/{name}?number=5511999999999 → { pairingCode: "ABCD1234" }
        const res = await fetch(
          `${base}/instance/connect/${instName}?number=${fullPhone}`,
          { headers: evolutionHeaders(), signal: AbortSignal.timeout(15_000) }
        );

        const rawText = await res.text();
        app.log.info(`[Evolution] pairing-code status=${res.status}: ${rawText.substring(0, 300)}`);

        let data: any = {};
        try { data = JSON.parse(rawText); } catch { /* não é JSON */ }

        if (res.ok) {
          const code = data?.pairingCode ?? data?.code;
          // pairingCode é o código de 8 chars para digitar no WhatsApp
          // code sem pairingCode = QR em modo texto, não é o que queremos
          if (code && data?.pairingCode) {
            app.log.info(`[Evolution] Pairing code gerado: ${code}`);
            return { code };
          }
          // Retornou QR em vez de pairing code — número pode não ser suportado
          app.log.warn(`[Evolution] Resposta sem pairingCode. Data: ${rawText.substring(0, 200)}`);
          return reply.code(502).send({ error: 'Código por número indisponível para este número.', fallbackToQr: true });
        }

        app.log.warn(`[Evolution] pairing-code erro ${res.status}: ${rawText.substring(0, 200)}`);
        return reply.code(502).send({ error: 'Erro ao gerar código. Tente o QR Code.', fallbackToQr: true });

      } catch (err: any) {
        app.log.error({ err: err.message }, '[Evolution] Erro ao solicitar pairing code');
        return reply.code(502).send({ error: `Erro ao solicitar código: ${err.message}`, fallbackToQr: true });
      }
    }
  );

  // ── GET /numbers/:id/zapi-status ─────────────────────────────────────────
  // Mantém compatibilidade de rota — verifica status via Evolution API
  app.get<{ Params: { id: string } }>('/:id/zapi-status', auth, async (req: any, reply) => {
    const { id } = req.params;
    const userId = req.user.sub;

    const number = await (prisma as any).whatsappNumber.findFirst({ where: { id, userId } });
    if (!number) return reply.code(404).send({ error: 'Número não encontrado' });

    const instName = number.zapiInstanceId;
    if (!instName) return { connected: false, phone: number.phoneNumber };

    const state = await getConnectionState(instName);

    // Auto-reconectar no banco se Evolution confirmar online
    if (state === 'open' && number.status !== 'connected') {
      await prisma.whatsappNumber.update({
        where: { id },
        data:  { status: 'connected', connectedAt: new Date() },
      }).catch(() => null);
    }

    return {
      connected: state === 'open',
      phone:     number.phoneNumber,
      state,
    };
  });

  // ── POST /numbers/:id/disconnect ──────────────────────────────────────────
  // Desconecta o WhatsApp — mantém instância Evolution para reconexão futura
  app.post<{ Params: { id: string } }>('/:id/disconnect', auth, async (req: any, reply) => {
    const { id } = req.params;
    const userId = req.user.sub;

    const number = await (prisma as any).whatsappNumber.findFirst({ where: { id, userId } });
    if (!number) return reply.code(404).send({ error: 'Número não encontrado' });

    notifyDisconnected(id).catch(() => null);

    const instName = number.zapiInstanceId;
    if (instName) {
      try {
        // Logout desconecta o WhatsApp mas mantém a instância (usuário pode reconectar)
        await fetch(`${evolutionBaseUrl()}/instance/logout/${instName}`, {
          method:  'DELETE',
          headers: evolutionHeaders(),
          signal:  AbortSignal.timeout(8_000),
        });
        app.log.info(`[Evolution] Logout da instância ${instName}`);
      } catch (err: any) {
        app.log.warn({ err: err.message }, '[Evolution] Erro ao fazer logout');
      }
    }

    await prisma.whatsappNumber.update({
      where: { id },
      data:  { status: 'disconnected' },  // mantém zapiInstanceId → pode reconectar
    });

    return { status: 'disconnected' };
  });

  // ── POST /numbers/:id/reset-instance ─────────────────────────────────────
  // Remove instância do Evolution e limpa do banco → próximo /connect cria nova
  app.post<{ Params: { id: string } }>('/:id/reset-instance', auth, async (req: any, reply) => {
    const { id } = req.params;
    const userId = req.user.sub;

    const number = await (prisma as any).whatsappNumber.findFirst({ where: { id, userId } });
    if (!number) return reply.code(404).send({ error: 'Número não encontrado' });

    // Deletar instância no Evolution (se existir)
    const instName = number.zapiInstanceId;
    if (instName) {
      await deleteInstance(instName);
      app.log.info(`[Evolution] Instância ${instName} deletada`);
    }

    await (prisma as any).whatsappNumber.update({
      where: { id },
      data:  { zapiInstanceId: null, zapiToken: null, status: 'disconnected' },
    });

    return { ok: true, message: 'Instância resetada. Clique em "Conectar WhatsApp" para criar nova instância.' };
  });

  // ── DELETE /numbers/:id ───────────────────────────────────────────────────
  // Remove o número do banco E deleta a instância Evolution
  app.delete<{ Params: { id: string } }>('/:id', auth, async (req: any, reply) => {
    const { id } = req.params;
    const userId = req.user.sub;

    try {
      const number = await (prisma as any).whatsappNumber.findFirst({ where: { id, userId } });
      if (!number) return reply.code(404).send({ error: 'Número não encontrado' });

      if (number.zapiInstanceId) {
        await deleteInstance(number.zapiInstanceId);
        app.log.info(`[Evolution] Instância ${number.zapiInstanceId} deletada`);
      }

      await prisma.whatsappNumber.delete({ where: { id } });
      return reply.code(204).send();

    } catch (err: any) {
      app.log.error({ err: err.message, id, userId }, '[Numbers] Erro ao deletar número');
      return reply.code(500).send({ error: err.message || 'Erro ao deletar número.' });
    }
  });
}
