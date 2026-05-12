import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';

// ── Z-API helpers ──────────────────────────────────────────────────────────────

/** URL de uma operação em uma instância específica */
function zapiUrl(instanceId: string, token: string, path: string): string {
  return `https://api.z-api.io/instances/${instanceId}/token/${token}${path}`;
}

/** Headers para a API de parceiro (gerenciar instâncias) */
function partnerHeaders(): Record<string, string> {
  const token = process.env.ZAPI_PARTNER_TOKEN;
  if (!token) throw new Error('ZAPI_PARTNER_TOKEN não configurado');
  return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
}

/** URL base da API (usada para configurar webhooks nas instâncias criadas) */
const API_BASE = process.env.API_URL ?? 'https://zapscript.me';

/** Cria uma nova instância Z-API e já configura os webhooks */
async function createZapiInstance(name: string): Promise<{ id: string; token: string }> {
  const res = await fetch('https://api.z-api.io/instances', {
    method:  'POST',
    headers: partnerHeaders(),
    body: JSON.stringify({
      name,
      // Todos os eventos chegam no mesmo endpoint — o instanceId no body faz o roteamento
      receivedCallbackUrl:    `${API_BASE}/webhook/zapi`,
      connectedCallbackUrl:   `${API_BASE}/webhook/zapi`,
      disconnectedCallbackUrl:`${API_BASE}/webhook/zapi`,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Z-API falhou ao criar instância (${res.status}): ${text}`);
  }

  const data = await res.json() as { id: string; token: string };
  if (!data.id || !data.token) throw new Error('Z-API retornou instância sem id/token');
  return data;
}

/** Cancela / remove uma instância Z-API — ignora erros (pode já ter sido deletada) */
async function deleteZapiInstance(instanceId: string): Promise<void> {
  try {
    await fetch(
      `https://api.z-api.io/instances/${instanceId}/subscriptions/unsubscribe`,
      { method: 'POST', headers: partnerHeaders() }
    );
  } catch { /* ignora */ }
}

// ── Rotas ──────────────────────────────────────────────────────────────────────
export default async function numberRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any).authenticate] };

  // ── GET /numbers ──────────────────────────────────────────────────────────
  app.get('/', auth, async (req: any) => {
    return prisma.whatsappNumber.findMany({
      where:   { userId: req.user.sub },
      orderBy: { createdAt: 'asc' },
    });
  });

  // ── POST /numbers ─────────────────────────────────────────────────────────
  app.post<{ Body: { displayName: string } }>('/', auth, async (req: any, reply) => {
    const { displayName } = req.body;
    const userId = req.user.sub;

    // Verificar limite do plano
    const sub = await prisma.subscription.findUnique({
      where:   { userId },
      include: { plan: true },
    });
    const count = await prisma.whatsappNumber.count({ where: { userId } });

    if (count >= sub!.plan.maxNumbers) {
      return reply.code(403).send({
        error: `Limite de ${sub!.plan.maxNumbers} número(s) atingido. Faça upgrade do plano.`,
      });
    }

    const number = await prisma.whatsappNumber.create({
      data: { userId, displayName },
    });

    return reply.code(201).send(number);
  });

  // ── PATCH /numbers/:id ────────────────────────────────────────────────────
  app.patch<{ Params: { id: string }; Body: { displayName?: string } }>(
    '/:id',
    auth,
    async (req: any, reply) => {
      const { id } = req.params;
      const { displayName } = req.body;

      const number = await prisma.whatsappNumber.findFirst({ where: { id, userId: req.user.sub } });
      if (!number) return reply.code(404).send({ error: 'Número não encontrado.' });

      const trimmed = displayName?.trim();
      if (!trimmed) return reply.code(400).send({ error: 'Nenhum campo para atualizar.' });
      if (trimmed.length > 50) return reply.code(400).send({ error: 'Nome deve ter no máximo 50 caracteres.' });

      return prisma.whatsappNumber.update({ where: { id }, data: { displayName: trimmed } });
    }
  );

  // ── POST /numbers/:id/connect ─────────────────────────────────────────────
  // Cria uma instância Z-API dedicada para este número (se não existir) e inicia conexão
  app.post<{ Params: { id: string } }>('/:id/connect', auth, async (req: any, reply) => {
    const { id } = req.params;
    const userId = req.user.sub;

    const number = await prisma.whatsappNumber.findFirst({ where: { id, userId } });
    if (!number) return reply.code(404).send({ error: 'Número não encontrado' });

    if (!process.env.ZAPI_PARTNER_TOKEN) {
      return reply.code(503).send({ error: 'ZAPI_PARTNER_TOKEN não configurado no servidor.' });
    }

    // ── Já tem instância → só atualizar status e reconectar ──────────────
    if (number.zapiInstanceId && number.zapiToken) {
      await prisma.whatsappNumber.update({
        where: { id },
        data:  { status: 'connecting' },
      });
      return { ok: true, message: 'Reconectando à instância existente.' };
    }

    // ── Criar nova instância Z-API ────────────────────────────────────────
    try {
      const instance = await createZapiInstance(
        `ZapScript-${(number.displayName ?? id).substring(0, 40)}`
      );

      await prisma.whatsappNumber.update({
        where: { id },
        data: {
          zapiInstanceId: instance.id,
          zapiToken:      instance.token,
          status:         'connecting',
        },
      });

      app.log.info(`[Z-API] Nova instância criada: ${instance.id} para número ${id}`);
      return { ok: true, message: 'Instância criada. Pronto para escanear o QR Code.' };

    } catch (err: any) {
      app.log.error({ err: err.message }, '[Z-API] Erro ao criar instância');
      return reply.code(502).send({ error: err.message });
    }
  });

  // ── GET /numbers/:id/qr ───────────────────────────────────────────────────
  // Retorna o QR Code da instância deste número como base64
  app.get<{ Params: { id: string } }>('/:id/qr', auth, async (req: any, reply) => {
    const { id } = req.params;
    const userId = req.user.sub;

    const number = await prisma.whatsappNumber.findFirst({ where: { id, userId } });
    if (!number) return reply.code(404).send({ error: 'Número não encontrado' });

    if (!number.zapiInstanceId || !number.zapiToken) {
      return reply.code(400).send({ error: 'Instância não criada. Chame /connect primeiro.' });
    }

    try {
      const res = await fetch(zapiUrl(number.zapiInstanceId, number.zapiToken, '/qr-code/image'));

      if (!res.ok) {
        // 4xx = já conectado (Z-API não retorna QR quando conectado)
        return reply.code(204).send();
      }

      const buf    = await res.arrayBuffer();
      const base64 = Buffer.from(buf).toString('base64');
      return { qr: `data:image/png;base64,${base64}` };

    } catch (err: any) {
      app.log.error({ err: err.message }, '[Z-API] Erro ao buscar QR');
      return reply.code(502).send({ error: 'Erro ao obter QR Code da Z-API.' });
    }
  });

  // ── GET /numbers/:id/zapi-status ─────────────────────────────────────────
  // Verifica se a instância deste número está conectada ao WhatsApp
  app.get<{ Params: { id: string } }>('/:id/zapi-status', auth, async (req: any, reply) => {
    const { id } = req.params;
    const userId = req.user.sub;

    const number = await prisma.whatsappNumber.findFirst({ where: { id, userId } });
    if (!number) return reply.code(404).send({ error: 'Número não encontrado' });

    if (!number.zapiInstanceId || !number.zapiToken) {
      return { connected: false };
    }

    try {
      const res  = await fetch(zapiUrl(number.zapiInstanceId, number.zapiToken, '/status'));
      const data = await res.json() as any;

      const connected = data?.connected === true;

      // Sincronizar status no banco se mudou
      if (connected && number.status !== 'connected') {
        await prisma.whatsappNumber.update({
          where: { id },
          data:  { status: 'connected', connectedAt: new Date() },
        });
      } else if (!connected && number.status === 'connected') {
        await prisma.whatsappNumber.update({
          where: { id },
          data:  { status: 'disconnected' },
        });
      }

      return { connected, phone: data?.phone || number.phoneNumber };

    } catch (err: any) {
      app.log.error({ err: err.message }, '[Z-API] Erro ao verificar status');
      return { connected: false };
    }
  });

  // ── POST /numbers/:id/disconnect ──────────────────────────────────────────
  // Desconecta o WhatsApp — mantém a instância Z-API para reconexão futura
  app.post<{ Params: { id: string } }>('/:id/disconnect', auth, async (req: any, reply) => {
    const { id } = req.params;
    const userId = req.user.sub;

    const number = await prisma.whatsappNumber.findFirst({ where: { id, userId } });
    if (!number) return reply.code(404).send({ error: 'Número não encontrado' });

    if (number.zapiInstanceId && number.zapiToken) {
      try {
        await fetch(
          zapiUrl(number.zapiInstanceId, number.zapiToken, '/disconnect'),
          { method: 'DELETE' }
        );
      } catch (err: any) {
        app.log.warn({ err: err.message }, '[Z-API] Erro ao desconectar WhatsApp');
      }
    }

    await prisma.whatsappNumber.update({
      where: { id },
      // Mantém zapiInstanceId e zapiToken → usuário pode reconectar sem criar nova instância
      data:  { status: 'disconnected' },
    });

    return { status: 'disconnected' };
  });

  // ── DELETE /numbers/:id ───────────────────────────────────────────────────
  // Remove o número do banco E cancela a instância Z-API
  app.delete<{ Params: { id: string } }>('/:id', auth, async (req: any, reply) => {
    const { id } = req.params;
    const userId = req.user.sub;

    try {
      const number = await prisma.whatsappNumber.findFirst({ where: { id, userId } });
      if (!number) return reply.code(404).send({ error: 'Número não encontrado' });

      // Cancelar instância Z-API (ignora erro se já não existir)
      if (number.zapiInstanceId) {
        await deleteZapiInstance(number.zapiInstanceId);
        app.log.info(`[Z-API] Instância ${number.zapiInstanceId} cancelada`);
      }

      await prisma.whatsappNumber.delete({ where: { id } });
      return reply.code(204).send();

    } catch (err: any) {
      app.log.error({ err: err.message, id, userId }, '[Numbers] Erro ao deletar número');
      return reply.code(500).send({ error: err.message || 'Erro ao deletar número.' });
    }
  });
}
