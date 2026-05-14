import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { retryWithBackoff } from '../lib/db-retry';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import axios from 'axios';
import { syncAllZapiConfigs } from '../services/zapi-sync';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

const PLAN_PRICES: Record<string, number> = { pro: 29.90, ultra: 59.90, free: 0 };

function safeCompare(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function buildTesterMessage(name: string, link: string): string {
  return `Oi, ${name}! 👋

Tenho algo especial pra te contar — e esse convite é só seu. 🔒

🫵Você foi selecionado(a) para ser Tester Oficial do ZapScript.me, antes do lançamento oficial.
🎙️ O que é o ZapScript.me?
Sabe aquela pilha de áudios no WhatsApp que você deixa pra depois... e nunca ouve? 😅
O ZapScript resolve isso de forma automática — transcreve e resume os áudios que você recebe, pra você ler em segundos, sem perder nada importante.
Mais produtividade. Mais organização. Mais controle do seu tempo. 🚀

🎁 O que você ganha sendo Tester:
✅ 1 ano grátis no Plano Pro
✅ Acesso antecipado — antes de todo mundo
✅ Selo exclusivo de Tester Oficial no seu perfil

Você ajuda a construir, a gente te dá 1 ano Pro de presente. 💚

👇 Seu link exclusivo — expira em 48h ⏳
${link}
Qualquer dúvida é só responder aqui. Te espero lá! 🙌`;
}

async function sendTesterWhatsApp(phone: string, message: string, log: any): Promise<void> {
  // 1. Tentar Meta Cloud API
  const apiToken      = process.env.WHATSAPP_API_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (apiToken && phoneNumberId) {
    await axios.post(
      `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type:    'individual',
        to:                phone,
        type:              'text',
        text:              { body: message },
      },
      { headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' } }
    );
    log.info(`[Invites] ✅ WhatsApp enviado via Meta Cloud API para ${phone}`);
    return;
  }

  // 2. Fallback: Z-API — usa primeiro número conectado com instância Z-API
  const number = await prisma.whatsappNumber.findFirst({
    where: { status: 'connected', zapiInstanceId: { not: null }, zapiToken: { not: null } },
    select: { zapiInstanceId: true, zapiToken: true },
  });
  if (number?.zapiInstanceId && number?.zapiToken) {
    const clientToken = process.env.ZAPI_CLIENT_TOKEN;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (clientToken) headers['Client-Token'] = clientToken;
    await axios.post(
      `https://api.z-api.io/instances/${number.zapiInstanceId}/token/${number.zapiToken}/send-text`,
      { phone, message },
      { headers }
    );
    log.info(`[Invites] ✅ WhatsApp enviado via Z-API para ${phone}`);
    return;
  }

  throw new Error('Nenhum canal WhatsApp configurado (Meta Cloud API ou Z-API conectado).');
}

const adminAuth = async (req: any, reply: any) => {
  const token = req.headers['x-admin-token'] as string | undefined;
  if (!safeCompare(token, process.env.ADMIN_TOKEN)) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
};

export default async function adminRoutes(app: FastifyInstance) {

  // GET /admin/stats — dashboard completo do admin
  app.get('/stats', { preHandler: [adminAuth] }, async () => {
    const now            = new Date();
    const today          = new Date(now); today.setHours(0, 0, 0, 0);
    const monthStart     = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd   = monthStart;

    const [
      totalUsers, todayUsers, monthUsers, lastMonthUsers,
      byPlanRaw,
      activeSubs,
      subStatusGroups,
      totalTranscriptions, todayTranscriptions,
      totalMinutes, todayMinutes,
      recentErrors,
      totalTickets, openTickets,
      connectedNumbers, totalNumbers,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: today } } }),
      prisma.user.count({ where: { createdAt: { gte: monthStart } } }),
      prisma.user.count({ where: { createdAt: { gte: lastMonthStart, lt: lastMonthEnd } } }),
      // distribuição por plano
      prisma.subscription.findMany({ include: { plan: { select: { name: true } } } }).then(subs =>
        subs.reduce((acc: Record<string, number>, s) => {
          const name = s.plan.name;
          acc[name] = (acc[name] || 0) + 1;
          return acc;
        }, {})
      ),
      // assinaturas ativas com plano (para MRR)
      prisma.subscription.findMany({
        where:   { status: 'active' },
        include: { plan: { select: { name: true } } },
      }),
      // agrupamento por status
      prisma.subscription.groupBy({ by: ['status'], _count: { status: true } }),
      prisma.transcription.count(),
      prisma.transcription.count({ where: { createdAt: { gte: today } } }),
      prisma.usageLog.aggregate({ _sum: { minutesUsed: true } }),
      prisma.usageLog.aggregate({ _sum: { minutesUsed: true }, where: { createdAt: { gte: today } } }),
      prisma.systemError.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
      prisma.supportTicket.count(),
      prisma.supportTicket.count({ where: { status: 'open' } }),
      prisma.whatsappNumber.count({ where: { status: 'connected' } }),
      prisma.whatsappNumber.count(),
    ]);

    const mrr            = activeSubs.reduce((sum, s) => sum + (PLAN_PRICES[s.plan.name] || 0), 0);
    const paidActive     = activeSubs.filter(s => s.plan.name !== 'free').length;
    const conversionRate = totalUsers > 0 ? (paidActive / totalUsers) * 100 : 0;
    const subsByStatus   = subStatusGroups.reduce((acc: Record<string, number>, g) => {
      acc[g.status] = g._count.status;
      return acc;
    }, {});

    return {
      users:          { total: totalUsers, today: todayUsers, month: monthUsers, lastMonth: lastMonthUsers },
      byPlan:         byPlanRaw,
      transcriptions: { total: totalTranscriptions, today: todayTranscriptions },
      minutes:        { total: totalMinutes._sum.minutesUsed || 0, today: todayMinutes._sum.minutesUsed || 0 },
      recentErrors,
      tickets:        { total: totalTickets, open: openTickets },
      mrr,
      conversion:     { paid: paidActive, rate: conversionRate },
      subscriptions:  subsByStatus,
      whatsapp:       { connected: connectedNumbers, total: totalNumbers },
    };
  });

  // GET /admin/users — lista de usuários com busca e paginação
  app.get<{ Querystring: { limit?: string; offset?: string; search?: string } }>(
    '/users',
    { preHandler: [adminAuth] },
    async (req) => {
      const limit  = Math.min(Math.max(parseInt(req.query.limit  || '20') || 20, 1), 100);
      const offset = Math.max(parseInt(req.query.offset || '0') || 0, 0);
      const search = req.query.search;

      const where: any = {};
      if (search) {
        where.OR = [
          { email: { contains: search, mode: 'insensitive' } },
          { name:  { contains: search, mode: 'insensitive' } },
        ];
      }

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where, take: limit, skip: offset,
          select: {
            id: true,
            email: true,
            emailVerified: true,
            isAdmin: true,
            isTester: true,
            testerSince: true,
            createdAt: true,
            updatedAt: true,
            deletedAt: true,
            subscription: { include: { plan: true } },
            balance: true,
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.user.count({ where }),
      ]);

      return { users, total, limit, offset };
    }
  );

  // PATCH /admin/users/:id — trocar plano, ajustar minutos ou alterar isAdmin
  app.patch<{
    Params: { id: string };
    Body: {
      planName?:    string;
      isAdmin?:     boolean;
      minutes?:     number;
      minutesMode?: 'set' | 'add';   // 'set' define absoluto, 'add' soma/subtrai (padrão: 'set')
    };
  }>(
    '/users/:id',
    { preHandler: [adminAuth] },
    async (req, reply) => {
      const { id } = req.params;
      const { planName, isAdmin, minutes, minutesMode = 'set' } = req.body;

      if (planName === undefined && isAdmin === undefined && minutes === undefined) {
        return reply.code(400).send({ error: 'Informe ao menos um campo: planName, isAdmin ou minutes.' });
      }

      const VALID_PLANS = ['free', 'pro', 'ultra'];
      if (planName !== undefined && !VALID_PLANS.includes(planName)) {
        return reply.code(400).send({ error: `Plano inválido. Use: ${VALID_PLANS.join(', ')}` });
      }

      const user = await prisma.user.findUnique({ where: { id } });
      if (!user) return reply.code(404).send({ error: 'Usuário não encontrado.' });

      const ops: any[] = [];

      if (planName !== undefined) {
        const plan = await prisma.plan.findUnique({ where: { name: planName } });
        if (!plan) return reply.code(400).send({ error: `Plano "${planName}" não encontrado.` });

        ops.push(
          prisma.subscription.update({
            where: { userId: id },
            data: {
              planId:              plan.id,
              status:              planName === 'free' ? 'canceled' : 'active',
              asaasSubscriptionId: planName === 'free' ? null : undefined,
              currentPeriodEnd:    planName === 'free' ? null : undefined,
            },
          }),
          // ao trocar plano, minutos são resetados para a cota do novo plano
          // (a menos que 'minutes' seja passado junto, que vai sobrescrever abaixo)
          prisma.minuteBalance.update({
            where: { userId: id },
            data:  { availableMinutes: plan.minutesPerMonth, lastAlertSent: null },
          }),
        );
      }

      if (isAdmin !== undefined) {
        ops.push(prisma.user.update({ where: { id }, data: { isAdmin } }));
      }

      // Executa operações acima antes de ajustar minutos
      if (ops.length) await prisma.$transaction(ops);

      // Ajuste de minutos (independente ou após troca de plano)
      if (minutes !== undefined) {
        if (typeof minutes !== 'number' || isNaN(minutes)) {
          return reply.code(400).send({ error: 'minutes deve ser um número.' });
        }

        if (minutesMode === 'add') {
          // Soma/subtrai ao saldo atual (garante mínimo 0)
          const current = await prisma.minuteBalance.findUnique({ where: { userId: id } });
          const newVal  = Math.max(0, (current?.availableMinutes ?? 0) + minutes);
          await prisma.minuteBalance.update({
            where: { userId: id },
            data:  { availableMinutes: newVal, lastAlertSent: null },
          });
        } else {
          // 'set' — define valor absoluto (mínimo 0)
          await prisma.minuteBalance.update({
            where: { userId: id },
            data:  { availableMinutes: Math.max(0, minutes), lastAlertSent: null },
          });
        }
      }

      return prisma.user.findUnique({
        where:   { id },
        include: { subscription: { include: { plan: true } }, balance: true },
      });
    }
  );

  // POST /admin/users/:id/confirm-email — confirma e-mail do usuário no Supabase
  app.post<{ Params: { id: string }; Body: {} }>(
    '/users/:id/confirm-email',
    { preHandler: [adminAuth], schema: { body: { type: 'object' } } },
    async (req, reply) => {
      const { id } = req.params;

      try {
        const user = await retryWithBackoff(() =>
          prisma.user.findUnique({ where: { id } })
        );
        if (!user) return reply.code(404).send({ error: 'Usuário não encontrado.' });

        const { error } = await supabase.auth.admin.updateUserById(id, {
          email_confirm: true,
        });
        if (error) return reply.code(500).send({ error: error.message });

        await retryWithBackoff(() =>
          prisma.user.update({ where: { id }, data: { emailVerified: true } })
        ).catch(() => null);

        return { ok: true, message: 'E-mail confirmado com sucesso.' };
      } catch (err: any) {
        app.log.error({ userId: id, err: err.message }, '[Admin] Erro ao confirmar email');
        return reply.code(500).send({ error: 'Erro ao confirmar email. Tente novamente.' });
      }
    }
  );

  // POST /admin/users/:id/reset-password — envia link de redefinição de senha
  app.post<{ Params: { id: string }; Body: {} }>(
    '/users/:id/reset-password',
    { preHandler: [adminAuth], schema: { body: { type: 'object' } } },
    async (req, reply) => {
      const { id } = req.params;
      const user = await prisma.user.findUnique({ where: { id } });
      if (!user) return reply.code(404).send({ error: 'Usuário não encontrado.' });

      const { data: linkData, error } = await supabase.auth.admin.generateLink({
        type:    'recovery',
        email:   user.email,
        options: { redirectTo: `${process.env.APP_URL || 'https://zapscript.me'}/redefinir-senha` },
      });
      if (error) return reply.code(500).send({ error: error.message });

      // Importar e enviar via mailer
      const { sendEmail } = await import('../lib/mailer');
      const resetLink = linkData?.properties?.action_link || '';
      if (resetLink) {
        await sendEmail(
          user.email,
          'Redefina sua senha — ZapScript',
          `<p>Olá${user.name ? `, ${user.name}` : ''}!</p>
           <p>Um administrador solicitou a redefinição da sua senha. Clique no link abaixo:</p>
           <p><a href="${resetLink}">${resetLink}</a></p>
           <p>O link expira em 1 hora.</p>`
        ).catch((err: any) => app.log.warn({ err: err.message }, '[Admin] Falha ao enviar reset e-mail'));
      }

      return { ok: true, message: `Link de redefinição enviado para ${user.email}.`, link: resetLink };
    }
  );

  // GET /admin/users/:id/detail — detalhes completos do usuário (uso, minutos, transcrições)
  app.get<{ Params: { id: string } }>(
    '/users/:id/detail',
    { preHandler: [adminAuth] },
    async (req, reply) => {
      const { id } = req.params;

      const [user, transcriptions, numbers, usageLogs, auditLogs] = await Promise.all([
        prisma.user.findUnique({
          where:   { id },
          select: {
            id: true,
            email: true,
            emailVerified: true,
            isAdmin: true,
            isTester: true,
            testerSince: true,
            createdAt: true,
            updatedAt: true,
            deletedAt: true,
            subscription: { include: { plan: true } },
            balance: true,
          },
        }),
        prisma.transcription.findMany({
          where:   { userId: id },
          orderBy: { createdAt: 'desc' },
          take:    20,
          select:  { id: true, durationSec: true, language: true, source: true, createdAt: true },
        }),
        prisma.whatsappNumber.findMany({
          where:  { userId: id },
          select: { id: true, displayName: true, status: true, createdAt: true, connectedAt: true },
        }),
        prisma.usageLog.findMany({
          where:   { userId: id },
          orderBy: { createdAt: 'desc' },
          take:    30,
          select:  { minutesUsed: true, createdAt: true },
        }),
        prisma.auditLog.findMany({
          where:   { targetUserId: id },
          orderBy: { timestamp: 'desc' },
          take:    10,
          select:  { action: true, timestamp: true, changes: true, metadata: true },
        }),
      ]);

      if (!user) return reply.code(404).send({ error: 'Usuário não encontrado.' });

      const totalMinutesUsed = usageLogs.reduce((s, l) => s + (l.minutesUsed || 0), 0);
      const planLimit        = user.subscription?.plan?.minutesPerMonth || 0;
      const available        = user.balance?.availableMinutes || 0;
      const usagePct         = planLimit > 0 ? Math.min(100, ((planLimit - available) / planLimit) * 100) : 0;

      return {
        user,
        stats: {
          totalTranscriptions: transcriptions.length,
          totalMinutesUsed,
          availableMinutes: available,
          planLimit,
          usagePct: Math.round(usagePct),
        },
        transcriptions,
        numbers,
        usageLogs,
        auditLogs,
      };
    }
  );

  // DELETE /admin/users/:id — remove usuário do Supabase + Prisma (cascade)
  app.delete<{ Params: { id: string } }>(
    '/users/:id',
    { preHandler: [adminAuth] },
    async (req, reply) => {
      const { id } = req.params;

      try {
        const user = await retryWithBackoff(() =>
          prisma.user.findUnique({ where: { id } })
        );
        if (!user) return reply.code(404).send({ error: 'Usuário não encontrado.' });

        // Remove do Supabase Auth primeiro (evita login fantasma)
        const { error } = await supabase.auth.admin.deleteUser(id);
        if (error) {
          // Logar mas não bloquear — se o user não existir no Supabase, prosseguir
          app.log.warn({ userId: id, err: error.message }, 'Supabase: erro ao deletar user');
        }

        // Cascade no Prisma elimina: Subscription, MinuteBalance, WhatsappNumber, Transcription, UsageLog, SupportTicket
        await retryWithBackoff(() =>
          prisma.user.delete({ where: { id } })
        );

        return reply.code(204).send();
      } catch (err: any) {
        app.log.error({ userId: id, err: err.message }, '[Admin] Erro ao deletar usuário');
        return reply.code(500).send({ error: 'Erro ao deletar usuário. Tente novamente.' });
      }
    }
  );

  // PATCH /admin/plans/:id — editar detalhes de um plano (label, minutos, preço, etc.)
  app.patch<{
    Params: { id: string };
    Body: { label?: string; minutesPerMonth?: number; maxNumbers?: number; priceBrl?: number; features?: unknown[] };
  }>(
    '/plans/:id',
    { preHandler: [adminAuth] },
    async (req, reply) => {
      const { id } = req.params;
      const { label, minutesPerMonth, maxNumbers, priceBrl, features } = req.body;

      const plan = await prisma.plan.findUnique({ where: { id } });
      if (!plan) return reply.code(404).send({ error: 'Plano não encontrado.' });

      const data: Record<string, unknown> = {};
      if (label            !== undefined) data.label            = label;
      if (minutesPerMonth  !== undefined) data.minutesPerMonth  = minutesPerMonth;
      if (maxNumbers       !== undefined) data.maxNumbers       = maxNumbers;
      if (priceBrl         !== undefined) data.priceBrl         = priceBrl;
      if (features         !== undefined) data.features         = features;

      if (Object.keys(data).length === 0) {
        return reply.code(400).send({ error: 'Nenhum campo para atualizar.' });
      }

      return prisma.plan.update({ where: { id }, data });
    }
  );

  // GET /admin/plans — listar todos os planos
  app.get('/plans', { preHandler: [adminAuth] }, async () => {
    return prisma.plan.findMany({ orderBy: { priceBrl: 'asc' } });
  });

  // GET /admin/tickets — tickets de suporte com filtro e paginação
  app.get<{ Querystring: { limit?: string; offset?: string; status?: string } }>(
    '/tickets',
    { preHandler: [adminAuth] },
    async (req) => {
      const limit  = Math.min(Math.max(parseInt(req.query.limit  || '20') || 20, 1), 100);
      const offset = Math.max(parseInt(req.query.offset || '0') || 0, 0);
      const status = req.query.status;

      const where: any = {};
      if (status) where.status = status;

      const [tickets, total] = await Promise.all([
        prisma.supportTicket.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.supportTicket.count({ where }),
      ]);

      return { tickets, total, limit, offset };
    }
  );

  // PATCH /admin/tickets/:id — atualizar status de um ticket de suporte
  app.patch<{ Params: { id: string }; Body: { status: string } }>(
    '/tickets/:id',
    { preHandler: [adminAuth] },
    async (req, reply) => {
      const { id } = req.params;
      const { status } = req.body;

      const allowed = ['open', 'in_progress', 'closed'];
      if (!allowed.includes(status)) {
        return reply.code(400).send({ error: `Status inválido. Use: ${allowed.join(', ')}.` });
      }

      const ticket = await prisma.supportTicket.findUnique({ where: { id } });
      if (!ticket) return reply.code(404).send({ error: 'Ticket não encontrado.' });

      return prisma.supportTicket.update({ where: { id }, data: { status } });
    }
  );

  // GET /admin/errors — log de erros do sistema
  app.get<{ Querystring: { limit?: string } }>(
    '/errors',
    { preHandler: [adminAuth] },
    async (req) => {
      const limit = Math.min(Math.max(parseInt(req.query.limit || '50') || 50, 1), 500);
      return prisma.systemError.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    }
  );

  // POST /admin/invites — criar convite para Tester e enviar via WhatsApp
  app.post<{ Body: { name: string; phone?: string } }>(
    '/invites',
    { preHandler: [adminAuth] },
    async (req, reply) => {
      const { name, phone } = req.body;
      if (!name || typeof name !== 'string' || name.trim().length < 2) {
        return reply.code(400).send({ error: 'Nome inválido (mínimo 2 caracteres).' });
      }
      const trimmedName = name.trim().substring(0, 100);
      const code = crypto.randomBytes(8).toString('hex');
      const invite = await prisma.testerInvite.create({
        data: { name: trimmedName, code },
      });
      const appUrl  = process.env.APP_URL || 'https://zapscript.me';
      const link    = `${appUrl}/convite/${invite.code}`;
      const message = buildTesterMessage(trimmedName, link);

      let whatsappSent = false;
      let whatsappError: string | undefined;

      if (phone) {
        const cleanPhone = phone.replace(/\D/g, '');
        try {
          await sendTesterWhatsApp(cleanPhone, message, app.log);
          whatsappSent = true;
        } catch (err: any) {
          whatsappError = err.message;
          app.log.warn({ phone: cleanPhone, err: err.message }, '[Invites] Falha ao enviar WhatsApp');
        }
      }

      return { invite, link, message, whatsappSent, whatsappError };
    }
  );

  // GET /admin/invites — listar convites de Tester
  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    '/invites',
    { preHandler: [adminAuth] },
    async (req) => {
      const limit  = Math.min(Math.max(parseInt(req.query.limit  || '50') || 50, 1), 200);
      const offset = Math.max(parseInt(req.query.offset || '0') || 0, 0);
      const [invites, total] = await Promise.all([
        prisma.testerInvite.findMany({ orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
        prisma.testerInvite.count(),
      ]);
      const appUrl = process.env.APP_URL || 'https://zapscript.me';
      return {
        invites: invites.map(i => ({ ...i, link: `${appUrl}/convite/${i.code}` })),
        total,
        limit,
        offset,
      };
    }
  );

  // POST /admin/sync-zapi — re-aplica webhooks e configurações Z-API em todos os números conectados.
  // Útil quando: instância foi migrada, URL mudou, auto-read travou, etc.
  // Não requer que usuários reconectem o WhatsApp.
  app.post(
    '/sync-zapi',
    { preHandler: [adminAuth] },
    async (_req, reply) => {
      const result = await syncAllZapiConfigs(app.log);
      return reply.send({ ok: true, ...result });
    }
  );
}
