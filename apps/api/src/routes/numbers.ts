import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { notifyDisconnected } from '../services/whatsapp-notify';
import {
  evolutionBaseUrl,
  evolutionHeaders,
  instanceName as evoInstanceName,
  createInstance,
  deleteInstance,
  getConnectionState,
} from '../services/evolution';

// ── Helpers ────────────────────────────────────────────────────────────────────

function getApiBase(): string {
  const url = process.env.API_URL || process.env.RENDER_EXTERNAL_URL;
  if (url) return url.replace(/\/$/, '');
  console.error('[numbers] ⛔ API_URL não configurado! Configure API_URL no Render.');
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
      },
    });
  });

  // ── POST /numbers ─────────────────────────────────────────────────────────
  app.post<{ Body: { displayName: string; phoneNumber?: string } }>('/', auth, async (req: any, reply) => {
    const { displayName, phoneNumber } = req.body;
    const userId = req.user.sub;

    const trimmedName = displayName?.trim();
    if (!trimmedName || trimmedName.length < 2)
      return reply.code(400).send({ error: 'Nome deve ter ao menos 2 caracteres.' });
    if (trimmedName.length > 50)
      return reply.code(400).send({ error: 'Nome deve ter no máximo 50 caracteres.' });

    // Admin não tem limite de números
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.isAdmin) {
      const sub = await prisma.subscription.findUnique({ where: { userId }, include: { plan: true } });
      const count = await prisma.whatsappNumber.count({ where: { userId } });
      if (count >= sub!.plan.maxNumbers) {
        return reply.code(403).send({
          error: `Limite de ${sub!.plan.maxNumbers} número(s) atingido. Faça upgrade do plano.`,
        });
      }
    }

    let cleanPhone: string | undefined;
    if (phoneNumber) {
      const digits = phoneNumber.replace(/\D/g, '');
      cleanPhone = digits.startsWith('55') ? digits : `55${digits}`;
    }

    const number = await prisma.whatsappNumber.create({
      data: { userId, displayName: trimmedName, ...(cleanPhone ? { phoneNumber: cleanPhone } : {}) },
    });

    // Nota: notifyWelcome é disparado via connection.update no webhook Evolution
    // (quando state='open'), não aqui — neste ponto zapiInstanceId ainda é null
    return reply.code(201).send(number);
  });

  // ── PATCH /numbers/:id ────────────────────────────────────────────────────
  app.patch<{ Params: { id: string }; Body: { displayName?: string } }>(
    '/:id', auth, async (req: any, reply) => {
      const { id } = req.params;
      const number = await prisma.whatsappNumber.findFirst({ where: { id, userId: req.user.sub } });
      if (!number) return reply.code(404).send({ error: 'Número não encontrado.' });

      const trimmed = req.body.displayName?.trim();
      if (!trimmed) return reply.code(400).send({ error: 'Nenhum campo para atualizar.' });
      if (trimmed.length > 50) return reply.code(400).send({ error: 'Nome deve ter no máximo 50 caracteres.' });

      return prisma.whatsappNumber.update({ where: { id }, data: { displayName: trimmed } });
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
        // Já conectada — apenas re-aplicar webhook e retornar como conectada
        app.log.info(`[Evolution] Instância ${instName} já está conectada (open)`);
        await (prisma as any).whatsappNumber.update({
          where: { id },
          data: { zapiInstanceId: instName, zapiToken: null, status: 'connected', connectedAt: new Date() },
        });
        return { ok: true, message: 'WhatsApp já conectado.' };

      } else if (existingState !== null) {
        // Instância existe mas não conectada (close/connecting) —
        // deletar e recriar para garantir estado limpo para pairing code / QR
        app.log.info(`[Evolution] Instância ${instName} existe em estado "${existingState}" — recriando para estado limpo`);
        await deleteInstance(instName);
        await new Promise(r => setTimeout(r, 1000)); // aguarda Evolution processar deleção
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
      const base = evolutionBaseUrl();

      // Uma única chamada — o frontend já faz polling a cada 25s.
      // Retry aqui causaria timeout de 60s no Render e retornaria 500.
      const res = await fetch(
        `${base}/instance/connect/${instName}`,
        { headers: evolutionHeaders(), signal: AbortSignal.timeout(8_000) }
      );

      app.log.info(`[Evolution] QR status=${res.status} instância=${instName}`);

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        app.log.warn(`[Evolution] QR retornou ${res.status}: ${errText.substring(0, 200)}`);
        return reply.code(204).send();
      }

      const data = await res.json() as any;

      // Evolution retorna { base64: "data:image/png;base64,..." } ou { qrcode: { base64: "..." } }
      const b64 = data?.base64 ?? data?.qrcode?.base64 ?? data?.qr?.base64 ?? data?.code ?? null;
      if (!b64) {
        app.log.warn(`[Evolution] QR sem base64. Resposta: ${JSON.stringify(data).substring(0, 200)}`);
        return reply.code(204).send();
      }

      const qr = b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`;
      return { qr };

    } catch (err: any) {
      app.log.error({ err: err.message }, '[Evolution] Erro ao buscar QR');
      return reply.code(502).send({ error: 'Erro ao obter QR Code.' });
    }
  });

  // ── POST /numbers/:id/pairing-code ───────────────────────────────────────
  // Código de parelhamento por número (alternativa ao QR).
  // Evolution: POST /instance/pairingCode/{instanceName} body: { number: "5511999999999" }
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

        // Evolution requer que a instância esteja em estado "connecting" (QR gerado)
        // antes de aceitar o pairing code. Chamamos /instance/connect primeiro.
        app.log.info(`[Evolution] Iniciando conexão para pairing code (instância ${instName})`);
        await fetch(`${base}/instance/connect/${instName}`, {
          headers: evolutionHeaders(),
          signal:  AbortSignal.timeout(8_000),
        }).catch(() => {}); // ignora erro — instância pode já estar connecting
        await new Promise(r => setTimeout(r, 2_000)); // aguarda Evolution gerar QR interno

        let lastRawText = '';
        let lastData: any = {};
        let lastStatus = 0;

        // Retry até 2x com 2s entre tentativas (total max ~24s, dentro do limite Render 60s)
        for (let attempt = 0; attempt < 2; attempt++) {
          if (attempt > 0) await new Promise(r => setTimeout(r, 2_000));

          const res = await fetch(
            `${base}/instance/pairingCode/${instName}`,
            {
              method:  'POST',
              headers: evolutionHeaders(),
              body:    JSON.stringify({ number: fullPhone }),
              signal:  AbortSignal.timeout(10_000),
            }
          );

          lastStatus  = res.status;
          lastRawText = await res.text();
          try { lastData = JSON.parse(lastRawText); } catch { lastData = { raw: lastRawText }; }

          app.log.info(`[Evolution] pairing-code tentativa ${attempt + 1}/2 (${res.status}): ${lastRawText.substring(0, 200)}`);

          if (res.ok) {
            const code = lastData?.code ?? lastData?.pairingCode ?? lastData?.value;
            if (code) {
              app.log.info(`[Evolution] Pairing code gerado para número ${id}: ${code}`);
              return { code };
            }
            // Sucesso HTTP mas sem código — não vale tentar de novo
            return reply.code(502).send({ error: `Evolution não retornou código: ${lastRawText.substring(0, 100)}` });
          }

          // 404 routing = endpoint não existe → não adianta tentar de novo
          if (lastStatus === 404) break;

          // Erros definitivos não adianta tentar novamente
          const errMsg0 = lastData?.error ?? lastData?.message ?? lastData?.response?.message ?? '';
          const lower0  = String(errMsg0).toLowerCase();
          const isDefinitive = lower0.includes('already') || lower0.includes('open') ||
            lower0.includes('number') || lower0.includes('phone');
          if (isDefinitive) break;
        }

        const errMsg  = lastData?.error ?? lastData?.message ?? lastData?.response?.message ?? `Evolution retornou ${lastStatus}`;
        const lower   = String(errMsg).toLowerCase();
        // 404 routing = endpoint não existe nesta build → fallback QR
        const unavail = lastStatus === 404 || lastStatus === 400 ||
          lower.includes('not found') || lower.includes('not connected') ||
          lower.includes('unavailable') || lower.includes('instance') ||
          lower.includes('connecting') || lower.includes('open') ||
          lower.includes('already') || lower.includes('invalid') ||
          lower.includes('cannot post');
        app.log.warn(`[Evolution] pairing-code falhou (${lastStatus}) unavail=${unavail}: ${lastRawText.substring(0, 200)}`);
        return reply.code(502).send({
          error:        unavail ? 'Código por número indisponível. Use o QR Code.' : errMsg,
          fallbackToQr: unavail,
        });

      } catch (err: any) {
        app.log.error({ err: err.message }, '[Evolution] Erro ao solicitar pairing code');
        return reply.code(502).send({ error: `Erro ao solicitar código: ${err.message}` });
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
