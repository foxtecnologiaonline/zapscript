import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';

// ── Z-API helpers ──────────────────────────────────────────────────────────────

/** URL de uma operação em uma instância específica */
function zapiUrl(instanceId: string, token: string, path: string): string {
  return `https://api.z-api.io/instances/${instanceId}/token/${token}${path}`;
}

/**
 * Headers para chamadas a uma instância Z-API.
 * O Client-Token é um token de segurança da CONTA (diferente do token de instância).
 * Encontrado em: painel Z-API → Segurança → Token de segurança da conta.
 * É opcional — só obrigatório se o usuário tiver ativado essa proteção.
 */
function zapiHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.ZAPI_CLIENT_TOKEN) headers['Client-Token'] = process.env.ZAPI_CLIENT_TOKEN;
  return extra ? { ...headers, ...extra } : headers;
}

/** Headers para a API de parceiro (gerenciar instâncias) */
function partnerHeaders(): Record<string, string> {
  const token = process.env.ZAPI_PARTNER_TOKEN;
  if (!token) throw new Error('ZAPI_PARTNER_TOKEN não configurado');
  return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
}

/** URL base da API (usada para configurar webhooks nas instâncias criadas) */
const API_BASE = process.env.API_URL ?? 'https://zapscript.me';

/**
 * Cria uma nova instância Z-API via Partner API.
 * Endpoint: POST https://api.z-api.io/instances/integrator/on-demand
 * Após criar, configura os webhooks via PUT nos endpoints de webhook.
 */
async function createZapiInstance(name: string): Promise<{ id: string; token: string }> {
  const res = await fetch('https://api.z-api.io/instances/integrator/on-demand', {
    method:  'POST',
    headers: partnerHeaders(),
    body: JSON.stringify({ name }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Z-API falhou ao criar instância (${res.status}): ${text}`);
  }

  const data = await res.json() as { id: string; token: string };
  if (!data.id || !data.token) throw new Error('Z-API retornou instância sem id/token');

  // Configurar webhooks na instância recém criada
  const webhookUrl = `${API_BASE}/webhook/zapi`;
  const webhookEndpoints = [
    '/update-webhook-received',
    '/update-webhook-connected',
    '/update-webhook-received-disconnected',
  ];
  await Promise.all(webhookEndpoints.map(path =>
    fetch(zapiUrl(data.id, data.token, path), {
      method:  'PUT',
      headers: zapiHeaders(),
      body:    JSON.stringify({ value: webhookUrl }),
    }).catch(() => {/* ignora erros de webhook — não bloqueia a criação */})
  ));

  return data;
}

/** Cancela / remove uma instância Z-API — ignora erros (pode já ter sido deletada) */
async function deleteZapiInstance(instanceId: string, instanceToken: string): Promise<void> {
  try {
    // Primeiro desconectar o WhatsApp da instância
    await fetch(zapiUrl(instanceId, instanceToken, '/disconnect'), {
      headers: zapiHeaders(),
    }).catch(() => {});
    // Depois cancelar via Partner API
    await fetch(
      'https://api.z-api.io/integrator/on-demand/cancel',
      {
        method:  'POST',
        headers: partnerHeaders(),
        body:    JSON.stringify({ instanceId }),
      }
    );
  } catch { /* ignora */ }
}

// ── Rotas ──────────────────────────────────────────────────────────────────────
export default async function numberRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any).authenticate] };

  // ── GET /numbers ──────────────────────────────────────────────────────────
  // Usa select explícito para não falhar se colunas novas (zapiToken/zapiInstanceId)
  // ainda não existem na DB de produção (migration pendente)
  app.get('/', auth, async (req: any) => {
    return prisma.whatsappNumber.findMany({
      where:   { userId: req.user.sub },
      orderBy: { createdAt: 'asc' },
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
    if (!trimmedName || trimmedName.length < 2) {
      return reply.code(400).send({ error: 'Nome deve ter ao menos 2 caracteres.' });
    }
    if (trimmedName.length > 50) {
      return reply.code(400).send({ error: 'Nome deve ter no máximo 50 caracteres.' });
    }

    // Admin não tem limite de números
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.isAdmin) {
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
    }

    // Sanitizar número: só dígitos, prefixar 55 se não tiver
    let cleanPhone: string | undefined;
    if (phoneNumber) {
      const digits = phoneNumber.replace(/\D/g, '');
      cleanPhone = digits.startsWith('55') ? digits : `55${digits}`;
    }

    const number = await prisma.whatsappNumber.create({
      data: {
        userId,
        displayName: trimmedName,
        ...(cleanPhone ? { phoneNumber: cleanPhone } : {}),
      },
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
  // Tenta criar instância via Partner API; se não disponível (conta Cliente/405),
  // usa a instância configurada por env vars ZAPI_INSTANCE_ID + ZAPI_TOKEN.
  app.post<{ Params: { id: string } }>('/:id/connect', auth, async (req: any, reply) => {
    const { id } = req.params;
    const userId = req.user.sub;

    const number = await prisma.whatsappNumber.findFirst({ where: { id, userId } });
    if (!number) return reply.code(404).send({ error: 'Número não encontrado' });

    // ── Resolver qual instância usar ──────────────────────────────────────
    let instanceId: string;
    let instanceToken: string;

    if (number.zapiInstanceId && number.zapiToken) {
      // Já tem instância vinculada — mas se env var mudou, migra para nova instância
      const envInstanceId = process.env.ZAPI_INSTANCE_ID;
      const envToken      = process.env.ZAPI_TOKEN;
      if (envInstanceId && envToken && envInstanceId !== number.zapiInstanceId) {
        app.log.info(`[Z-API] Instância mudou em env vars: ${number.zapiInstanceId} → ${envInstanceId}, migrando`);
        instanceId    = envInstanceId;
        instanceToken = envToken;
      } else {
        instanceId    = number.zapiInstanceId;
        instanceToken = number.zapiToken;
        app.log.info(`[Z-API] Reusando instância existente: ${instanceId}`);
      }
    } else if (process.env.ZAPI_PARTNER_TOKEN) {
      try {
        // Tenta criar instância dedicada via Partner API
        const instance = await createZapiInstance(
          `ZapScript-${(number.displayName ?? id).substring(0, 40)}`
        );
        instanceId    = instance.id;
        instanceToken = instance.token;
        app.log.info(`[Z-API] Nova instância criada: ${instanceId} para número ${id}`);
      } catch (err: any) {
        // Conta "Cliente" não tem acesso à Partner API — usar instância única de env
        app.log.warn(`[Z-API] Partner API indisponível (${err.message}), usando instância de env vars`);
        if (!process.env.ZAPI_INSTANCE_ID || !process.env.ZAPI_TOKEN) {
          return reply.code(503).send({
            error: 'Configure ZAPI_INSTANCE_ID e ZAPI_TOKEN no servidor.',
          });
        }
        instanceId    = process.env.ZAPI_INSTANCE_ID;
        instanceToken = process.env.ZAPI_TOKEN;
      }
    } else if (process.env.ZAPI_INSTANCE_ID && process.env.ZAPI_TOKEN) {
      instanceId    = process.env.ZAPI_INSTANCE_ID;
      instanceToken = process.env.ZAPI_TOKEN;
    } else {
      return reply.code(503).send({
        error: 'Z-API não configurada. Adicione ZAPI_INSTANCE_ID e ZAPI_TOKEN no servidor.',
      });
    }

    // ── Configurar webhooks SEMPRE (garante que Z-API sabe para onde enviar áudios) ─
    const webhookUrl = `${API_BASE}/webhook/zapi`;
    const webhookResults = await Promise.allSettled([
      // Webhooks de eventos
      fetch(zapiUrl(instanceId, instanceToken, '/update-webhook-received'), {
        method: 'PUT', headers: zapiHeaders(), body: JSON.stringify({ value: webhookUrl }),
      }),
      fetch(zapiUrl(instanceId, instanceToken, '/update-webhook-connected'), {
        method: 'PUT', headers: zapiHeaders(), body: JSON.stringify({ value: webhookUrl }),
      }),
      fetch(zapiUrl(instanceId, instanceToken, '/update-webhook-received-disconnected'), {
        method: 'PUT', headers: zapiHeaders(), body: JSON.stringify({ value: webhookUrl }),
      }),
      // Desabilitar leitura automática — evita marcar mensagens como "visto" ao receber
      fetch(zapiUrl(instanceId, instanceToken, '/update-auto-read-message'), {
        method: 'PUT', headers: zapiHeaders(), body: JSON.stringify({ value: false }),
      }),
    ]);
    const webhookOk = webhookResults.filter(r => r.status === 'fulfilled').length;
    app.log.info(`[Z-API] Configuração concluída: ${webhookOk}/4 (webhooks + auto-read desabilitado)`);

    // ── Vincular instância ao número e marcar como conectando ─────────────
    await prisma.whatsappNumber.update({
      where: { id },
      data: {
        zapiInstanceId: instanceId,
        zapiToken:      instanceToken,
        status:         'connecting',
      },
    });

    return { ok: true, message: 'Pronto para escanear o QR Code.' };
  });

  // ── GET /numbers/:id/qr ───────────────────────────────────────────────────
  // Retorna o QR Code da instância deste número como data URI base64.
  // Usa /qr-code (bytes PNG raw) — mais confiável que /qr-code/image que pode
  // retornar JSON, string ou data URI dependendo da versão da Z-API.
  app.get<{ Params: { id: string } }>('/:id/qr', auth, async (req: any, reply) => {
    const { id } = req.params;
    const userId = req.user.sub;

    const number = await prisma.whatsappNumber.findFirst({ where: { id, userId } });
    if (!number) return reply.code(404).send({ error: 'Número não encontrado' });

    if (!number.zapiInstanceId || !number.zapiToken) {
      return reply.code(400).send({ error: 'Instância não criada. Chame /connect primeiro.' });
    }

    try {
      const res = await fetch(
        zapiUrl(number.zapiInstanceId, number.zapiToken, '/qr-code'),
        { headers: zapiHeaders() }
      );

      app.log.info(`[Z-API] QR code status=${res.status} content-type=${res.headers.get('content-type')}`);

      if (!res.ok) {
        // 4xx = já conectado, QR não disponível ou instância aguardando
        app.log.warn(`[Z-API] QR code retornou ${res.status} para instância ${number.zapiInstanceId}`);
        return reply.code(204).send();
      }

      const contentType = res.headers.get('content-type') ?? '';

      // Caso 1: resposta é JSON com campo value/qr/image (alguns planos Z-API)
      if (contentType.includes('application/json')) {
        const data = await res.json() as any;
        const b64  = data?.value ?? data?.qr ?? data?.image ?? data?.base64;
        if (b64) {
          const qr = b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`;
          return { qr };
        }
        return reply.code(204).send();
      }

      // Caso 2: resposta é string base64 pura (text/plain)
      if (contentType.includes('text/')) {
        const text = (await res.text()).trim();
        if (text.startsWith('data:')) return { qr: text };
        if (text.length > 100) return { qr: `data:image/png;base64,${text}` };
        return reply.code(204).send();
      }

      // Caso 3 (padrão): bytes PNG binários — converter para base64
      const buf    = await res.arrayBuffer();
      const base64 = Buffer.from(buf).toString('base64');
      return { qr: `data:image/png;base64,${base64}` };

    } catch (err: any) {
      app.log.error({ err: err.message }, '[Z-API] Erro ao buscar QR');
      return reply.code(502).send({ error: 'Erro ao obter QR Code da Z-API.' });
    }
  });

  // ── POST /numbers/:id/pairing-code ───────────────────────────────────────
  // Solicita código de parelhamento por número (alternativa ao QR Code)
  // Usuário recebe um código e insere no WhatsApp: Dispositivos → Conectar pelo número
  app.post<{ Params: { id: string }; Body: { phone: string } }>(
    '/:id/pairing-code', auth, async (req: any, reply) => {
      const { id } = req.params;
      const { phone } = req.body;
      const userId = req.user.sub;

      if (!phone) return reply.code(400).send({ error: 'Número de telefone obrigatório.' });

      const number = await prisma.whatsappNumber.findFirst({ where: { id, userId } });
      if (!number) return reply.code(404).send({ error: 'Número não encontrado' });
      if (!number.zapiInstanceId || !number.zapiToken) {
        return reply.code(400).send({ error: 'Instância não iniciada. Chame /connect primeiro.' });
      }

      // Número limpo com DDI
      const cleanPhone = phone.replace(/\D/g, '');
      const fullPhone  = cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`;

      try {
        // Z-API: GET /phone-code/{PHONE_NUMBER} (path param, não body)
        // Documentação: https://z-api-docs.vercel.app/en/instance/qrcode
        const res = await fetch(
          zapiUrl(number.zapiInstanceId, number.zapiToken, `/phone-code/${fullPhone}`),
          { headers: zapiHeaders() }
        );

        const rawText = await res.text();
        let data: any = {};
        try { data = JSON.parse(rawText); } catch { data = { raw: rawText }; }

        app.log.info(`[Z-API] phone-code response (${res.status}): ${rawText.substring(0, 200)}`);

        if (!res.ok) {
          // 404 = endpoint não existe nesta instância (instância tipo Web não suporta phone-code)
          const isUnsupported =
            res.status === 404 ||
            rawText.includes('NOT_FOUND') ||
            rawText.includes('Unable to find matching target resource') ||
            rawText.toLowerCase().includes('not found');
          const errMsg = isUnsupported
            ? 'NOT_FOUND: instância Web não suporta código por telefone. Use o QR Code.'
            : (data?.error || data?.message || `Z-API retornou ${res.status}: ${rawText.substring(0, 100)}`);
          return reply.code(502).send({ error: errMsg });
        }

        // Z-API retorna { "value": "A1B2C3D4" }
        const code = data?.value ?? data?.code ?? data?.pairingCode ?? data?.phoneCode;
        if (!code) {
          return reply.code(502).send({
            error: `Z-API não retornou código. Resposta: ${rawText.substring(0, 100)}`,
          });
        }

        app.log.info(`[Z-API] Phone code gerado para número ${id}: ${code}`);
        return { code };

      } catch (err: any) {
        app.log.error({ err: err.message }, '[Z-API] Erro ao solicitar phone code');
        return reply.code(502).send({ error: `Erro ao solicitar código: ${err.message}` });
      }
    }
  );

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
      const res  = await fetch(
        zapiUrl(number.zapiInstanceId, number.zapiToken, '/status'),
        { headers: zapiHeaders() }
      );
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
        // Z-API: GET /disconnect (não DELETE — confirmado no Postman oficial)
        await fetch(
          zapiUrl(number.zapiInstanceId, number.zapiToken, '/disconnect'),
          { headers: zapiHeaders() }
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

  // ── POST /numbers/:id/reset-instance ─────────────────────────────────────
  // Limpa zapiInstanceId/zapiToken do banco → próximo /connect usa env vars
  // Usar quando trocar de instância Z-API (ex: Trial → Pago)
  app.post<{ Params: { id: string } }>('/:id/reset-instance', auth, async (req: any, reply) => {
    const { id } = req.params;
    const userId = req.user.sub;

    const number = await prisma.whatsappNumber.findFirst({ where: { id, userId } });
    if (!number) return reply.code(404).send({ error: 'Número não encontrado' });

    await prisma.whatsappNumber.update({
      where: { id },
      data:  { zapiInstanceId: null, zapiToken: null, status: 'disconnected' },
    });

    app.log.info(`[Z-API] Instância resetada para número ${id} — próximo /connect usa env vars`);
    return { ok: true, message: 'Instância resetada. Clique em "Conectar WhatsApp" para vincular a nova instância.' };
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
        await deleteZapiInstance(number.zapiInstanceId, number.zapiToken ?? '');
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
