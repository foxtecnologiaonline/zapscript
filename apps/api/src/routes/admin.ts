import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { retryWithBackoff } from '../lib/db-retry';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import axios from 'axios';
import { runHealthCheck, lastReport, history } from '../services/health-monitor';
import { Queue } from 'bullmq';
import { redis } from '../services/queue';
import { sendText } from '../services/evolution';
import { sendEmail } from '../lib/mailer';
import { asaas, asaasConfigured, asaasEnv } from '../lib/asaas';
import { checkAdminTotp } from '../lib/totp';
import { COMMISSION } from '../lib/affiliate';
import {
  getEffectiveCommissionRates, getAutoApproveConfig, getReportScheduleConfig, setAffiliateConfig,
} from '../lib/affiliateConfig';
import { maskEmail } from '../lib/mask';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

const PLAN_PRICES: Record<string, number> = { pro: 37, executive: 67, free: 0, 'pro-tester': 0, profissional: 49, empresas: 99 };

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

🫵Você pode ser Tester Oficial do ZapScript, antes do lançamento oficial.

🎙️ O que é o *ZapScript.me?*
Sabe aquela pilha de áudios no WhatsApp que você deixa pra depois... e nunca ouve? 😅
Você vai ler em segundos, pois a conversão e o resumo são feitos de forma automática, isso é organização sem perder nada importante! 👍

🎁 Você ajuda a construir, e ganha 1 ano grátis no Plano Pro de presente. 💚

👇 Seu link exclusivo — expira em 24h ⏳
${link}
Te espero lá! 🙌`;
}

const INVITE_SENDER_PHONE = '5534991790254';
// Últimos 8 dígitos identificam a linha unicamente. Casamos por eles para
// tolerar a variação do "9º dígito" do celular BR — a mesma linha pode estar
// salva como 5534991790254 (com 9) ou 553491790254 (sem 9, formato antigo).
const INVITE_SENDER_TAIL = INVITE_SENDER_PHONE.slice(-8); // '91790254'
/** Linha do remetente de convites, conectada (match tolerante ao 9º dígito). */
const INVITE_SENDER_WHERE = {
  status: 'connected',
  phoneNumber: { endsWith: INVITE_SENDER_TAIL },
  zapiInstanceId: { not: null },
} as const;
/** True se o número é o remetente de convites (ignora variação do 9º dígito). */
function isInviteSender(phoneNumber?: string | null): boolean {
  return !!phoneNumber && phoneNumber.endsWith(INVITE_SENDER_TAIL);
}

async function sendTesterWhatsApp(phone: string, message: string, log: any): Promise<string> {
  const number = await prisma.whatsappNumber.findFirst({
    where: INVITE_SENDER_WHERE,
    select: { zapiInstanceId: true },
  });

  if (!number?.zapiInstanceId) {
    throw new Error(
      `Número ${INVITE_SENDER_PHONE} não está conectado. ` +
      `Conecte esse número no dashboard antes de enviar convites.`
    );
  }

  await sendText(number.zapiInstanceId, phone, message);
  log.info({ phone, instance: number.zapiInstanceId }, '[Invites] ✅ WhatsApp enviado via Evolution API');
  return 'evolution';
}

const adminAuth = async (req: any, reply: any) => {
  const token = req.headers['x-admin-token'] as string | undefined;
  if (!safeCompare(token, process.env.ADMIN_TOKEN)) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
  const totp = await checkAdminTotp(token!, req.headers['x-admin-totp'] as string | undefined);
  if (totp !== 'ok') {
    return reply.code(401).send({
      error: totp === 'totp_required' ? 'Código 2FA necessário' : 'Código 2FA inválido',
      totpRequired: true,
    });
  }
};

export default async function adminRoutes(app: FastifyInstance) {

  // ════════════════════════════════════════════════════════════════════════
  // GESTÃO DE COBRANÇAS ASAAS (financeiro) — listar / excluir / estornar
  // A chave fica só em env (ASAAS_API_KEY). Excluir só funciona em cobrança
  // ainda não paga; cobrança paga deve ser estornada (refund).
  // ════════════════════════════════════════════════════════════════════════

  // GET /asaas/payments?status=PENDING&limit=50&offset=0
  app.get('/asaas/payments', { preHandler: [adminAuth] }, async (req: any, reply) => {
    if (!asaasConfigured()) {
      return reply.code(503).send({ error: 'Asaas não configurado (ASAAS_API_KEY ausente).' });
    }
    const { status = 'PENDING', limit = '50', offset = '0' } = req.query || {};
    const qs = new URLSearchParams();
    if (status && status !== 'ALL') qs.set('status', String(status));
    qs.set('limit',  String(Math.min(Number(limit) || 50, 100)));
    qs.set('offset', String(Math.max(Number(offset) || 0, 0)));

    try {
      const res  = await asaas(`/payments?${qs.toString()}`);
      const data = await res.json() as any;
      if (!res.ok) {
        return reply.code(502).send({ error: data?.errors?.[0]?.description || 'Erro ao listar cobranças no Asaas.' });
      }
      const rows: any[] = Array.isArray(data?.data) ? data.data : [];

      // Enriquecer com o usuário local via externalReference ("<userId>|<plan>|...")
      const userIds = Array.from(new Set(
        rows.map(p => String(p.externalReference || '').split('|')[0]).filter(Boolean),
      )) as string[];
      const users = userIds.length
        ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true, name: true } })
        : [];
      const byId = new Map(users.map((u: { id: string; email: string | null; name: string | null }) => [u.id, u] as const));

      const payments = rows.map(p => {
        const ref = String(p.externalReference || '').split('|');
        const u   = byId.get(ref[0]);
        return {
          id:           p.id,
          status:       p.status,
          value:        p.value,
          netValue:     p.netValue,
          billingType:  p.billingType,
          dueDate:      p.dueDate,
          dateCreated:  p.dateCreated,
          description:  p.description,
          invoiceUrl:   p.invoiceUrl,
          customer:     p.customer,
          subscription: p.subscription || null,
          plan:         ref[1] || null,
          userEmail:    u?.email ? maskEmail(u.email) : null,
          userName:     u?.name || null,
          canDelete:    ['PENDING', 'OVERDUE', 'AWAITING_RISK_ANALYSIS'].includes(p.status),
        };
      });

      return reply.send({
        env:     asaasEnv(),
        total:   data?.totalCount ?? payments.length,
        hasMore: !!data?.hasMore,
        offset:  Number(offset) || 0,
        payments,
      });
    } catch (err: any) {
      app.log.error({ err: err.message }, '[Admin] Asaas list payments falhou');
      return reply.code(502).send({ error: 'Falha ao consultar o Asaas.' });
    }
  });

  // DELETE /asaas/payments/:id — exclui cobrança (somente não-paga)
  app.delete<{ Params: { id: string } }>('/asaas/payments/:id', { preHandler: [adminAuth] }, async (req: any, reply) => {
    if (!asaasConfigured()) return reply.code(503).send({ error: 'Asaas não configurado.' });
    const { id } = req.params;
    try {
      const res  = await asaas(`/payments/${id}`, { method: 'DELETE' });
      const data = await res.json() as any;
      if (!res.ok || data?.deleted === false) {
        return reply.code(502).send({ error: data?.errors?.[0]?.description || 'Não foi possível excluir a cobrança.' });
      }
      app.log.info({ paymentId: id }, '[Admin] Cobrança Asaas excluída');
      return reply.send({ deleted: true, id });
    } catch (err: any) {
      app.log.error({ err: err.message, paymentId: id }, '[Admin] Asaas delete falhou');
      return reply.code(502).send({ error: 'Falha ao excluir no Asaas.' });
    }
  });

  // POST /asaas/payments/:id/refund — estorna cobrança paga
  app.post<{ Params: { id: string } }>('/asaas/payments/:id/refund', { preHandler: [adminAuth] }, async (req: any, reply) => {
    if (!asaasConfigured()) return reply.code(503).send({ error: 'Asaas não configurado.' });
    const { id } = req.params;
    try {
      const res  = await asaas(`/payments/${id}/refund`, { method: 'POST' });
      const data = await res.json() as any;
      if (!res.ok) {
        return reply.code(502).send({ error: data?.errors?.[0]?.description || 'Não foi possível estornar a cobrança.' });
      }
      app.log.info({ paymentId: id }, '[Admin] Cobrança Asaas estornada');
      return reply.send({ refunded: true, id, status: data?.status });
    } catch (err: any) {
      app.log.error({ err: err.message, paymentId: id }, '[Admin] Asaas refund falhou');
      return reply.code(502).send({ error: 'Falha ao estornar no Asaas.' });
    }
  });

  // ── POST /test-email — testa envio de e-mail (diagnóstico) ──────────────
  app.post<{ Body: { to: string } }>(
    '/test-email',
    { preHandler: [adminAuth], schema: { body: { type: 'object', required: ['to'] } } },
    async (req, reply) => {
      const { to } = req.body;
      if (!to) return reply.code(400).send({ error: 'to é obrigatório' });
      try {
        await sendEmail(
          to,
          '🧪 Teste de E-mail — ZapScript Admin',
          `<div style="font-family:sans-serif;background:#050a07;color:#d1fae5;padding:32px;border-radius:12px;max-width:480px;margin:0 auto">
            <h2 style="color:#10b981">✅ E-mail de teste funcionando!</h2>
            <p style="color:#a7f3d0">Este e-mail foi enviado pelo endpoint de diagnóstico do admin ZapScript.</p>
            <p style="color:#6ee7b7;font-size:12px">Horário: ${new Date().toISOString()}</p>
            <p style="color:#6ee7b7;font-size:12px">Provider: ${process.env.RESEND_API_KEY ? 'Resend' : process.env.SMTP_HOST ? 'SMTP' : 'NENHUM'}</p>
            <p style="color:#6ee7b7;font-size:12px">SMTP_FROM: ${process.env.SMTP_FROM || 'não definido'}</p>
          </div>`,
        );
        return { ok: true, message: `E-mail enviado para ${to}`, provider: process.env.RESEND_API_KEY ? 'resend' : process.env.SMTP_HOST ? 'smtp' : 'none' };
      } catch (err: any) {
        return reply.code(500).send({ ok: false, error: err.message, provider: process.env.RESEND_API_KEY ? 'resend' : process.env.SMTP_HOST ? 'smtp' : 'none' });
      }
    }
  );

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
      txDurationAgg,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: today } } }),
      prisma.user.count({ where: { createdAt: { gte: monthStart } } }),
      prisma.user.count({ where: { createdAt: { gte: lastMonthStart, lt: lastMonthEnd } } }),
      // distribuição por plano — inclui usuários sem subscription (= free)
      Promise.all([
        prisma.user.count(),
        prisma.subscription.findMany({ include: { plan: { select: { name: true } } } }),
      ]).then(([total, subs]) => {
        const acc: Record<string, number> = {};
        for (const s of subs) {
          const name = s.plan.name;
          acc[name] = (acc[name] || 0) + 1;
        }
        // usuários sem subscription são free
        const withSub = subs.length;
        const withoutSub = total - withSub;
        if (withoutSub > 0) acc['free'] = (acc['free'] || 0) + withoutSub;
        return acc;
      }),
      // assinaturas ativas com plano (para MRR) — inclui isTester para excluir do cálculo financeiro
      prisma.subscription.findMany({
        where:   { status: 'active' },
        include: { plan: { select: { name: true } }, user: { select: { isTester: true } } },
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
      // Duração real dos áudios transcritos — total e média (em segundos)
      prisma.transcription.aggregate({ _sum: { durationSec: true }, _avg: { durationSec: true } }),
    ]);

    // Testers não contam como pagantes — têm plano pro-tester (gratuito por design)
    const mrr            = activeSubs.reduce((sum: number, s: any) => (s.user.isTester ? sum : sum + (PLAN_PRICES[s.plan.name] || 0)), 0);
    const paidActive     = activeSubs.filter((s: any) => s.plan.name !== 'free' && s.plan.name !== 'pro-tester' && !s.user.isTester).length;
    const testerCount    = activeSubs.filter((s: any) => s.user.isTester).length;
    const conversionRate = totalUsers > 0 ? (paidActive / totalUsers) * 100 : 0;
    const subsByStatus   = subStatusGroups.reduce((acc: Record<string, number>, g: any) => {
      acc[g.status] = g._count.status;
      return acc;
    }, {});

    return {
      users:          { total: totalUsers, today: todayUsers, month: monthUsers, lastMonth: lastMonthUsers },
      byPlan:         byPlanRaw,
      transcriptions: {
        total:        totalTranscriptions,
        today:        todayTranscriptions,
        totalMinutes: (txDurationAgg._sum.durationSec || 0) / 60,  // soma da duração de todos os áudios
        avgMinutes:   (txDurationAgg._avg.durationSec || 0) / 60,  // média de minutos por áudio
      },
      minutes:        { total: totalMinutes._sum.minutesUsed || 0, today: todayMinutes._sum.minutesUsed || 0 },
      recentErrors,
      tickets:        { total: totalTickets, open: openTickets },
      mrr,
      conversion:     { paid: paidActive, rate: conversionRate, testers: testerCount },
      subscriptions:  subsByStatus,
      whatsapp:       { connected: connectedNumbers, total: totalNumbers },
    };
  });

  // GET /admin/users — lista de usuários com busca, paginação e filtro de WhatsApp
  app.get<{ Querystring: { limit?: string; offset?: string; search?: string; whatsapp?: string } }>(
    '/users',
    { preHandler: [adminAuth] },
    async (req) => {
      const limit  = Math.min(Math.max(parseInt(req.query.limit  || '20') || 20, 1), 100);
      const offset = Math.max(parseInt(req.query.offset || '0') || 0, 0);
      const search = req.query.search;
      const whatsapp = req.query.whatsapp;  // 'connected' | 'disconnected' | undefined (todos)

      const where: any = {};
      if (search) {
        where.OR = [
          { email: { contains: search, mode: 'insensitive' } },
          { name:  { contains: search, mode: 'insensitive' } },
        ];
      }
      // Filtro por status de conexão do WhatsApp
      if (whatsapp === 'connected') {
        where.numbers = { some: { status: 'connected' } };
      } else if (whatsapp === 'disconnected') {
        // Sem nenhum número conectado (inclui quem não tem número algum)
        where.numbers = { none: { status: 'connected' } };
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
            numbers: { select: { id: true, status: true } },
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.user.count({ where }),
      ]);

      return { users, total, limit, offset };
    }
  );

  // PATCH /admin/users/:id — trocar plano, ajustar áudios ou alterar isAdmin
  app.patch<{
    Params: { id: string };
    Body: {
      planName?:    string;
      isAdmin?:     boolean;
      audios?:      number;          // ajuste de áudios consumidos no ciclo
      audiosMode?:  'set' | 'add';   // 'set' define audiosUsed absoluto, 'add' soma/subtrai (padrão: 'set')
    };
  }>(
    '/users/:id',
    { preHandler: [adminAuth], schema: { body: { type: 'object' } } },
    async (req, reply) => {
      const { id } = req.params;
      const { planName, isAdmin, audios, audiosMode = 'set' } = req.body;

      if (planName === undefined && isAdmin === undefined && audios === undefined) {
        return reply.code(400).send({ error: 'Informe ao menos um campo: planName, isAdmin ou audios.' });
      }

      const VALID_PLANS = ['free', 'pro', 'ultra', 'executive', 'pro-tester'];
      if (planName !== undefined && !VALID_PLANS.includes(planName)) {
        return reply.code(400).send({ error: `Plano inválido. Use: ${VALID_PLANS.join(', ')}` });
      }

      const user = await prisma.user.findUnique({ where: { id } });
      if (!user) return reply.code(404).send({ error: 'Usuário não encontrado.' });

      const ops: any[] = [];

      if (planName !== undefined) {
        const plan = await prisma.plan.findUnique({ where: { name: planName } });
        if (!plan) return reply.code(400).send({ error: `Plano "${planName}" não encontrado.` });

        // Para planos pagos: resetAt = data de aquisição + 30 dias
        const nextPeriod = planName !== 'free'
          ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
          : null;

        ops.push(
          prisma.subscription.update({
            where: { userId: id },
            data: {
              planId:              plan.id,
              status:              planName === 'free' ? 'canceled' : 'active',
              asaasSubscriptionId: planName === 'free' ? null : undefined,
              currentPeriodEnd:    planName === 'free' ? null : nextPeriod,
            },
          }),
          // ao trocar plano: cota de áudios reiniciada (audiosUsed = 0)
          // minutos internos reabastecidos p/ métrica de custo; resetAt ancorado na aquisição
          prisma.minuteBalance.upsert({
            where:  { userId: id },
            create: {
              userId:           id,
              availableMinutes: plan.minutesPerMonth,
              audiosUsed:       0,
              resetAt:          nextPeriod ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
              lastAlertSent:    null,
            },
            update: {
              availableMinutes: plan.minutesPerMonth,
              audiosUsed:       0,
              lastAlertSent:    null,
              ...(nextPeriod ? { resetAt: nextPeriod } : {}),
            },
          }),
        );
      }

      if (isAdmin !== undefined) {
        ops.push(prisma.user.update({ where: { id }, data: { isAdmin } }));
      }

      // Executa operações acima antes de ajustar minutos
      if (ops.length) await prisma.$transaction(ops);

      // Ajuste de áudios consumidos no ciclo (independente ou após troca de plano)
      if (audios !== undefined) {
        if (typeof audios !== 'number' || isNaN(audios)) {
          return reply.code(400).send({ error: 'audios deve ser um número.' });
        }

        if (audiosMode === 'add') {
          // Soma/subtrai ao consumo atual (garante mínimo 0)
          const current = await prisma.minuteBalance.findUnique({ where: { userId: id } });
          const newVal  = Math.max(0, ((current as any)?.audiosUsed ?? 0) + audios);
          await prisma.minuteBalance.update({
            where: { userId: id },
            data:  { audiosUsed: newVal, lastAlertSent: null } as any,
          });
        } else {
          // 'set' — define audiosUsed absoluto (mínimo 0)
          await prisma.minuteBalance.update({
            where: { userId: id },
            data:  { audiosUsed: Math.max(0, audios), lastAlertSent: null } as any,
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

      return { ok: true, message: `Link de redefinição enviado para ${user.email}.` };
    }
  );

  // POST /admin/users/:id/resend-activation — reenvia e-mail de ativação
  app.post<{ Params: { id: string }; Body: {} }>(
    '/users/:id/resend-activation',
    { preHandler: [adminAuth], schema: { body: { type: 'object' } } },
    async (req, reply) => {
      const { id } = req.params;
      try {
        const user = await retryWithBackoff(() =>
          prisma.user.findUnique({ where: { id } })
        ) as any;
        if (!user) return reply.code(404).send({ error: 'Usuário não encontrado.' });
        if (user.emailVerified) return reply.code(400).send({ error: 'E-mail já verificado.' });

        // generateLink com type 'signup' requer password no TypeScript do Supabase,
        // mas na prática 'magiclink' gera um link de confirmação sem senha.
        const { data: linkData, error } = await (supabase.auth.admin.generateLink as any)({
          type:    'magiclink',
          email:   user.email,
          options: { redirectTo: `${process.env.APP_URL || 'https://zapscript.me'}/dashboard` },
        });
        if (error) return reply.code(500).send({ error: error.message });

        const { sendEmail } = await import('../lib/mailer');
        const activationLink = linkData?.properties?.action_link || '';
        if (activationLink) {
          await sendEmail(
            user.email,
            'Ative sua conta — ZapScript',
            `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
              <h2 style="color:#10b981">Bem-vindo ao ZapScript! 🎙️</h2>
              <p>Olá${user.name ? `, <strong>${user.name}</strong>` : ''}!</p>
              <p>Clique no botão abaixo para ativar sua conta:</p>
              <a href="${activationLink}" style="display:inline-block;background:#10b981;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin:16px 0">
                ✅ Ativar minha conta
              </a>
              <p style="font-size:12px;color:#888">O link expira em 24 horas. Se não solicitou isso, ignore este e-mail.</p>
            </div>`
          );
        }

        app.log.info(`[Admin] E-mail de ativação reenviado para ${user.email}`);
        return { ok: true, message: `E-mail de ativação reenviado para ${user.email}.` };
      } catch (err: any) {
        app.log.error({ userId: id, err: err.message }, '[Admin] Erro ao reenviar ativação');
        return reply.code(500).send({ error: 'Erro ao reenviar ativação. Tente novamente.' });
      }
    }
  );

  // GET /admin/email-health — verifica se sistema de e-mail está funcionando
  app.get(
    '/email-health',
    { preHandler: [adminAuth] },
    async (_req, reply) => {
      const result: any = {
        provider:    null,
        configured:  false,
        testResult:  null,
        recentSent:  null,
      };

      if (process.env.RESEND_API_KEY) {
        result.provider   = 'resend';
        result.configured = true;
        // Verificar via API Resend se a chave é válida
        try {
          const res = await axios.get('https://api.resend.com/emails', {
            headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
            timeout: 8000,
          });
          result.testResult = { ok: true, status: res.status };
        } catch (e: any) {
          result.testResult = { ok: false, error: e.response?.data || e.message };
        }
      } else if (process.env.SMTP_HOST) {
        result.provider   = 'smtp';
        result.configured = true;
        result.testResult = { ok: true, note: 'SMTP configurado — verificação via conexão real não implementada' };
      } else {
        result.provider   = null;
        result.configured = false;
        result.testResult = { ok: false, error: 'Nenhum provider configurado (RESEND_API_KEY ou SMTP_HOST)' };
      }

      return reply.send(result);
    }
  );

  // GET /admin/users/:id/detail — detalhes completos do usuário (uso, minutos, conversões)
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

      const totalMinutesUsed = usageLogs.reduce((s: number, l: any) => s + (l.minutesUsed || 0), 0);
      const planLimit        = (user.subscription?.plan as any)?.audiosPerMonth || 0;
      const audiosUsed       = (user.balance as any)?.audiosUsed || 0;
      const usagePct         = planLimit > 0 ? Math.min(100, (audiosUsed / planLimit) * 100) : 0;

      return {
        user,
        stats: {
          totalTranscriptions: transcriptions.length,
          totalMinutesUsed,
          audiosUsed,
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

  // PATCH /admin/plans/:id — editar detalhes de um plano (label, áudios, preço, etc.)
  app.patch<{
    Params: { id: string };
    Body: { label?: string; audiosPerMonth?: number; minutesPerMonth?: number; maxNumbers?: number; priceBrl?: number; features?: unknown[] };
  }>(
    '/plans/:id',
    { preHandler: [adminAuth], schema: { body: { type: 'object' } } },
    async (req, reply) => {
      const { id } = req.params;
      const { label, audiosPerMonth, minutesPerMonth, maxNumbers, priceBrl, features } = req.body;

      const plan = await prisma.plan.findUnique({ where: { id } });
      if (!plan) return reply.code(404).send({ error: 'Plano não encontrado.' });

      const data: Record<string, unknown> = {};
      if (label            !== undefined) data.label            = label;
      if (audiosPerMonth   !== undefined) data.audiosPerMonth   = audiosPerMonth;
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

  // POST /admin/plans — criar novo plano (ex: pro-tester)
  app.post<{
    Body: { name: string; label: string; audiosPerMonth?: number; minutesPerMonth: number; maxNumbers: number; priceBrl: number; features?: unknown[] };
  }>(
    '/plans',
    { preHandler: [adminAuth], schema: { body: { type: 'object' } } },
    async (req, reply) => {
      const { name, label, audiosPerMonth, minutesPerMonth, maxNumbers, priceBrl, features = [] } = req.body;
      if (!name || !label || minutesPerMonth == null || maxNumbers == null || priceBrl == null) {
        return reply.code(400).send({ error: 'Campos obrigatórios: name, label, minutesPerMonth, maxNumbers, priceBrl.' });
      }
      const existing = await prisma.plan.findUnique({ where: { name } });
      if (existing) {
        return reply.code(409).send({ error: `Plano "${name}" já existe.`, plan: existing });
      }
      const plan = await prisma.plan.create({
        data: { name, label, audiosPerMonth: audiosPerMonth ?? 0, minutesPerMonth, maxNumbers, priceBrl, features: features as any } as any,
      });
      app.log.info({ planId: plan.id, name }, '[Admin] Plano criado');
      return reply.code(201).send(plan);
    }
  );

  // GET /admin/testers — lista todos os usuários marcados como tester
  app.get('/testers', { preHandler: [adminAuth] }, async () => {
    const testers = await prisma.user.findMany({
      where: { isTester: true, deletedAt: null },
      select: {
        id:           true,
        name:         true,
        email:        true,
        testerSince:  true,
        createdAt:    true,
        subscription: { include: { plan: true } },
        balance:      { select: { audiosUsed: true, availableMinutes: true, accumulatedMinutes: true } },
        numbers:      { select: { id: true, status: true, phoneNumber: true } },
      },
      orderBy: { testerSince: 'asc' },
    });

    return {
      total: testers.length,
      testers: testers.map((u: any) => ({
        id:             u.id,
        name:           u.name,
        email:          u.email,
        testerSince:    u.testerSince,
        createdAt:      u.createdAt,
        planName:       u.subscription?.plan?.name  || 'sem plano',
        planLabel:      u.subscription?.plan?.label || '—',
        subStatus:      u.subscription?.status      || '—',
        audiosUsed:     u.balance?.audiosUsed        ?? 0,
        numbersConnected: u.numbers.filter((n: any) => n.status === 'connected').length,
      })),
    };
  });

  // POST /admin/testers/upgrade-executive — migra todos os testers para plano executive
  app.post(
    '/testers/upgrade-executive',
    { preHandler: [adminAuth], schema: { body: { type: 'object' } } },
    async (_req, _reply) => {
      // Garante que o plano executive existe (upsert)
      const execPlan = await prisma.plan.upsert({
        where:  { name: 'executive' },
        update: {},
        create: {
          name:            'executive',
          label:           'Executive',
          minutesPerMonth: 500,
          maxNumbers:      5,
          priceBrl:        0,   // gratuito para testers
          features:        JSON.stringify([
            'Áudios ilimitados', '5 números WhatsApp', 'Conversão automática',
            'Ponto chave IA', 'Busca full-text', 'Exportação CSV',
            'Tags', 'Tradução automática', 'Webhook personalizado', 'Modo privado',
          ]),
        },
      });

      const testers = await prisma.user.findMany({
        where: { isTester: true, deletedAt: null },
        include: { subscription: { include: { plan: true } } },
      });

      let upgraded = 0;
      let skipped  = 0;
      const results: { email: string; from: string; to: string; action: string }[] = [];

      for (const u of testers) {
        const currentPlan = u.subscription?.plan?.name;
        if (currentPlan === 'executive') {
          skipped++;
          results.push({ email: u.email, from: currentPlan, to: 'executive', action: 'skipped (já executive)' });
          continue;
        }

        await prisma.$transaction([
          prisma.subscription.update({
            where: { userId: u.id },
            data: {
              planId:              execPlan.id,
              status:              'active',
              asaasSubscriptionId: null,       // gratuito — sem cobrança Asaas
              currentPeriodEnd:    null,        // não expira
            },
          }),
          prisma.minuteBalance.update({
            where: { userId: u.id },
            data:  { availableMinutes: execPlan.minutesPerMonth, lastAlertSent: null },
          }),
        ]);

        upgraded++;
        results.push({ email: u.email, from: currentPlan || '?', to: 'executive', action: 'upgraded' });
      }

      return { total: testers.length, upgraded, skipped, results };
    }
  );

  // POST /admin/testers/downgrade-pro — reverte testers para o plano Pro padrão
  app.post(
    '/testers/downgrade-pro',
    { preHandler: [adminAuth], schema: { body: { type: 'object' } } },
    async (_req, _reply) => {
      const proPlan = await prisma.plan.findFirst({ where: { name: 'pro' } });
      if (!proPlan) return { error: 'Plano Pro não encontrado na base.' };

      const testers = await prisma.user.findMany({
        where: { isTester: true, deletedAt: null },
        include: { subscription: { include: { plan: true } } },
      });

      let downgraded = 0;
      let skipped    = 0;
      const results: { email: string; from: string; to: string; action: string }[] = [];

      for (const u of testers) {
        const currentPlan = u.subscription?.plan?.name;
        if (currentPlan === 'pro') {
          skipped++;
          results.push({ email: u.email, from: currentPlan, to: 'pro', action: 'skipped (já pro)' });
          continue;
        }

        await prisma.$transaction([
          prisma.subscription.update({
            where: { userId: u.id },
            data: {
              planId:              proPlan.id,
              status:              'active',
              asaasSubscriptionId: null,
              currentPeriodEnd:    null,
            },
          }),
          prisma.minuteBalance.update({
            where: { userId: u.id },
            data:  { availableMinutes: proPlan.minutesPerMonth, lastAlertSent: null },
          }),
        ]);

        downgraded++;
        results.push({ email: u.email, from: currentPlan || '?', to: 'pro', action: 'downgraded' });
      }

      return { total: testers.length, downgraded, skipped, results };
    }
  );

  // POST /admin/testers/upgrade-pro-tester — coloca todos os testers no plano Pro (isento via isTester)
  // Modelo de 2 planos (Free/Pro): testers ficam no Pro com isTester=true; a isenção de 12 meses
  // é controlada por testerRenewalsUsed (máx 12), não por um plano separado.
  app.post(
    '/testers/upgrade-pro-tester',
    { preHandler: [adminAuth], schema: { body: { type: 'object' } } },
    async (_req, _reply) => {
      const proPlan = await prisma.plan.findUnique({ where: { name: 'pro' } });
      if (!proPlan) return { error: 'Plano pro não configurado. Rode o seed.' };
      const PRO_MINUTES = proPlan.minutesPerMonth;

      const testers = await prisma.user.findMany({
        where: { isTester: true, deletedAt: null },
        include: { subscription: { include: { plan: true } }, balance: true },
      });

      // Próximo vencimento mensal ancorado no cadastro: createdAt + k*30 dias, no futuro
      const nextMonthlyAnchor = (createdAt: Date): Date => {
        const DAY = 24 * 60 * 60 * 1000;
        const now = Date.now();
        let next = createdAt.getTime() + 30 * DAY;
        while (next <= now) next += 30 * DAY;
        return new Date(next);
      };

      let upgraded = 0;
      let skipped  = 0;
      const results: { email: string; from: string; to: string; action: string }[] = [];

      for (const u of testers) {
        const currentPlan = u.subscription?.plan?.name;
        // Não faz downgrade de quem tem executive (plano superior legado)
        if (currentPlan === 'executive') {
          skipped++;
          results.push({ email: u.email, from: currentPlan, to: 'pro', action: 'skipped (já executive)' });
          continue;
        }

        // Aplicar os minutos do Pro PRESERVANDO os já usados neste ciclo:
        // novo saldo = PRO − (minutos do plano antigo − saldo atual)
        const oldPlanMin    = u.subscription?.plan?.minutesPerMonth ?? 0;
        const oldAvailable  = u.balance?.availableMinutes ?? PRO_MINUTES;
        const usedThisCycle = Math.max(0, oldPlanMin - oldAvailable);
        const newAvailable  = Math.max(0, Math.min(PRO_MINUTES, PRO_MINUTES - usedThisCycle));
        const resetAt       = nextMonthlyAnchor(u.createdAt);

        await prisma.$transaction([
          prisma.subscription.update({
            where: { userId: u.id },
            data: {
              planId:              proPlan.id,
              status:              'active',
              asaasSubscriptionId: null,   // tester não paga durante a isenção
              currentPeriodEnd:    null,   // ciclo mensal via balance.resetAt
            },
          }),
          prisma.minuteBalance.upsert({
            where:  { userId: u.id },
            create: { userId: u.id, availableMinutes: newAvailable, resetAt, lastAlertSent: null },
            update: { availableMinutes: newAvailable, resetAt, lastAlertSent: null },
          }),
        ]);

        upgraded++;
        results.push({
          email: u.email,
          from: currentPlan || '?',
          to: 'pro',
          action: `upgraded (saldo ${newAvailable}/${PRO_MINUTES} min, usado ${usedThisCycle})`,
        });
      }

      return { total: testers.length, upgraded, skipped, results };
    }
  );

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
    { preHandler: [adminAuth], schema: { body: { type: 'object' } } },
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

  // POST /admin/tickets/:id/reply — responder ticket por e-mail e fechar
  app.post<{ Params: { id: string }; Body: { message: string; close?: boolean } }>(
    '/tickets/:id/reply',
    { preHandler: [adminAuth], schema: { body: { type: 'object', required: ['message'] } } },
    async (req, reply) => {
      const { id }      = req.params;
      const { message, close = true } = req.body;
      if (!message?.trim()) return reply.code(400).send({ error: 'Mensagem é obrigatória.' });

      const ticket = await prisma.supportTicket.findUnique({ where: { id } });
      if (!ticket) return reply.code(404).send({ error: 'Ticket não encontrado.' });

      try {
        await sendEmail(
          ticket.email,
          `Re: [Suporte ZapScript] ${ticket.description.slice(0, 60)}`,
          `<p>Olá, <strong>${ticket.name}</strong>!</p>
<p>A equipe ZapScript respondeu ao seu chamado:</p>
<blockquote style="border-left:3px solid #10b981;padding:12px 16px;background:#f0fdf4;color:#065f46;margin:16px 0">
  ${message.replace(/\n/g, '<br>')}
</blockquote>
<p style="color:#6b7280;font-size:12px">
  Sua mensagem original: <em>${ticket.description.slice(0, 200)}${ticket.description.length > 200 ? '…' : ''}</em>
</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
<p style="color:#9ca3af;font-size:12px">
  ZapScript Suporte · <a href="https://zapscript.me" style="color:#10b981">zapscript.me</a>
</p>`,
        );
      } catch (err: any) {
        app.log.error({ ticketId: id, err: err.message }, '[Admin] Erro ao enviar e-mail de resposta');
        return reply.code(502).send({ error: `Falha ao enviar e-mail: ${err.message}` });
      }

      const newStatus = close ? 'closed' : 'in_progress';
      const updated = await prisma.supportTicket.update({ where: { id }, data: { status: newStatus } });
      return { ok: true, status: newStatus, ticket: updated };
    }
  );

  // POST /admin/users/:id/anonymize — anonimizar dados do usuário (LGPD)
  app.post<{ Params: { id: string } }>(
    '/users/:id/anonymize',
    { preHandler: [adminAuth] },
    async (req, reply) => {
      const { id } = req.params;
      const user = await prisma.user.findUnique({ where: { id } });
      if (!user) return reply.code(404).send({ error: 'Usuário não encontrado.' });
      if (user.pseudonymizedAt) return reply.code(409).send({ error: 'Usuário já foi anonimizado.' });

      const anonId   = `anon_${id.slice(0, 8)}`;
      const anonEmail = `${anonId}@deleted.local`;

      await prisma.user.update({
        where: { id },
        data:  {
          name:              '[Removido]',
          email:             anonEmail,
          document:          null,
          phone:             null,
          pseudonymizedAt:   new Date(),
          deletedAt:         user.deletedAt ?? null,
        },
      });

      // Supabase Auth: desabilitar conta
      try {
        await (app as any).supabase?.auth?.admin?.updateUserById?.(id, { ban_duration: '87600h' });
      } catch {}

      app.log.info({ adminAction: 'anonymize', userId: id }, '[Admin] Usuário anonimizado (LGPD)');
      return { ok: true, message: `Dados de ${id} anonimizados com sucesso.` };
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
    { preHandler: [adminAuth], schema: { body: { type: 'object' } } },
    async (req, reply) => {
      const { name, phone } = req.body;
      if (!name || typeof name !== 'string' || name.trim().length < 2) {
        return reply.code(400).send({ error: 'Nome inválido (mínimo 2 caracteres).' });
      }
      const trimmedName = name.trim().substring(0, 100);
      const code      = crypto.randomBytes(8).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
      const invite = await (prisma as any).testerInvite.create({
        data: {
          name:  trimmedName,
          phone: phone ? (phone.replace(/\D/g, '').startsWith('55') ? phone.replace(/\D/g, '') : `55${phone.replace(/\D/g, '')}`) : null,
          code,
          expiresAt,
        },
      });
      const appUrl  = process.env.APP_URL || 'https://zapscript.me';
      const link    = `${appUrl}/convite/${invite.code}`;
      const message = buildTesterMessage(trimmedName, link);

      let whatsappSent    = false;
      let whatsappError: string | undefined;
      let whatsappChannel: string | undefined;

      if (phone) {
        const digits     = phone.replace(/\D/g, '');
        const cleanPhone = digits.startsWith('55') ? digits : `55${digits}`;
        try {
          whatsappChannel = await sendTesterWhatsApp(cleanPhone, message, app.log);
          whatsappSent    = true;
        } catch (err: any) {
          whatsappError = err.message;
          app.log.warn({ phone: cleanPhone, err: err.message }, '[Invites] Falha ao enviar WhatsApp');
        }
      }

      return { invite, link, message, whatsappSent, whatsappChannel, whatsappError };
    }
  );

  // DELETE /admin/invites/:id — excluir convite de Tester
  app.delete<{ Params: { id: string } }>(
    '/invites/:id',
    { preHandler: [adminAuth] },
    async (req, reply) => {
      const { id } = req.params;
      const invite = await prisma.testerInvite.findUnique({ where: { id } });
      if (!invite) return reply.code(404).send({ error: 'Convite não encontrado.' });
      await prisma.testerInvite.delete({ where: { id } });
      app.log.info(`[Admin] Convite ${invite.code} (${invite.name}) excluído`);
      return reply.code(204).send();
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
        invites: invites.map((i: any) => ({ ...i, link: `${appUrl}/convite/${i.code}` })),
        total,
        limit,
        offset,
      };
    }
  );

  // POST /admin/diagnose-whatsapp — diagnóstico do canal WhatsApp (Evolution API)
  app.post<{ Body: { phone?: string } }>(
    '/diagnose-whatsapp',
    { preHandler: [adminAuth], schema: { body: { type: 'object' } } },
    async (req, reply) => {
      const { getConnectionState } = await import('../services/evolution');
      const testPhone = req.body?.phone;
      const result: any = { envVars: {}, numbers: [], senderStatus: null, testSend: null };

      result.envVars = {
        EVOLUTION_API_URL: process.env.EVOLUTION_API_URL || null,
        EVOLUTION_API_KEY: !!process.env.EVOLUTION_API_KEY,
        EVOLUTION_WEBHOOK_SECRET: !!process.env.EVOLUTION_WEBHOOK_SECRET,
      };

      const numbers = await (prisma as any).whatsappNumber.findMany({
        where:  { zapiInstanceId: { not: null } },
        select: { id: true, displayName: true, phoneNumber: true, status: true, zapiInstanceId: true },
      });

      for (const n of numbers) {
        const entry: any = {
          id: n.id, displayName: n.displayName, phoneNumber: n.phoneNumber,
          statusDB: n.status, instanceId: n.zapiInstanceId,
          isSender: isInviteSender(n.phoneNumber),
        };
        try {
          entry.evolutionState = await getConnectionState(n.zapiInstanceId);
          entry.evolutionConnected = entry.evolutionState === 'open';
        } catch (e: any) {
          entry.evolutionError = e.message;
          entry.evolutionConnected = false;
        }
        result.numbers.push(entry);
      }

      // Status específico do número remetente de convites
      const sender = result.numbers.find((n: any) => n.isSender);
      result.senderStatus = sender
        ? { phone: INVITE_SENDER_PHONE, connected: sender.evolutionConnected, state: sender.evolutionState }
        : { phone: INVITE_SENDER_PHONE, connected: false, state: 'not_registered' };

      // Teste de envio real usando o número remetente
      if (testPhone && sender?.evolutionConnected) {
        const digits    = testPhone.replace(/\D/g, '');
        const fullPhone = digits.startsWith('55') ? digits : `55${digits}`;
        try {
          await sendText(sender.instanceId, fullPhone, '🧪 Teste de diagnóstico ZapScript — pode ignorar.');
          result.testSend = { ok: true, phone: fullPhone, instanceUsed: sender.instanceId };
        } catch (e: any) {
          result.testSend = { ok: false, phone: fullPhone, error: e.message };
        }
      } else if (testPhone) {
        result.testSend = { ok: false, error: `Número remetente (${INVITE_SENDER_PHONE}) não conectado.` };
      }

      return reply.send(result);
    }
  );

  // ── GET /admin/queue — status da fila de conversões ──────────────────────
  // Mostra: jobs aguardando, ativos, falhos, concluídos e jobs falhos recentes.
  app.get(
    '/queue',
    { preHandler: [adminAuth] },
    async (_req, reply) => {
      try {
        const q = new Queue('transcriptions', { connection: redis as any });

        const [waiting, active, failed, completed, delayed, paused] = await Promise.all([
          q.getWaitingCount(),
          q.getActiveCount(),
          q.getFailedCount(),
          q.getCompletedCount(),
          q.getDelayedCount(),
          q.isPaused(),
        ]);

        // Últimos 20 jobs falhos com detalhes
        const failedJobs = await q.getFailed(0, 19);
        const failedDetails = failedJobs.map(j => ({
          id:          j.id,
          name:        j.name,
          source:      j.data?.source,
          userId:      j.data?.userId,
          senderPhone: j.data?.senderPhone,
          attempts:    j.attemptsMade,
          failedReason: j.failedReason,
          processedOn: j.processedOn ? new Date(j.processedOn).toISOString() : null,
          finishedOn:  j.finishedOn  ? new Date(j.finishedOn).toISOString()  : null,
        }));

        // Últimos 5 jobs ativos
        const activeJobs = await q.getActive(0, 4);
        const activeDetails = activeJobs.map(j => ({
          id:         j.id,
          name:       j.name,
          source:     j.data?.source,
          userId:     j.data?.userId,
          processedOn: j.processedOn ? new Date(j.processedOn).toISOString() : null,
        }));

        await q.close();

        return reply.send({
          ok: true,
          queue: {
            paused,
            counts: { waiting, active, failed, completed, delayed },
          },
          active:  activeDetails,
          failed:  failedDetails,
        });
      } catch (err: any) {
        app.log.error({ err: err.message }, '[Admin] Erro ao buscar status da fila');
        return reply.code(500).send({ error: err.message });
      }
    }
  );

  // ── POST /admin/queue/retry-failed — retentar todos os jobs falhos ──────────
  app.post(
    '/queue/retry-failed',
    { preHandler: [adminAuth] },
    async (_req, reply) => {
      try {
        const q = new Queue('transcriptions', { connection: redis as any });
        const failedJobs = await q.getFailed(0, 99);
        let retried = 0;
        for (const job of failedJobs) {
          await job.retry('failed').catch(() => null);
          retried++;
        }
        await q.close();
        app.log.info(`[Admin] ${retried} jobs falhos re-enfileirados`);
        return reply.send({ ok: true, retried });
      } catch (err: any) {
        return reply.code(500).send({ error: err.message });
      }
    }
  );

  // ── POST /admin/queue/clear-failed — remove todos os jobs falhos da fila ──────
  app.post(
    '/queue/clear-failed',
    { preHandler: [adminAuth] },
    async (_req, reply) => {
      try {
        const q = new Queue('transcriptions', { connection: redis as any });
        const failedJobs = await q.getFailed(0, 999);
        let cleared = 0;
        for (const job of failedJobs) {
          await job.remove().catch(() => null);
          cleared++;
        }
        await q.close();
        app.log.info(`[Admin] ${cleared} jobs falhos removidos da fila`);
        return reply.send({ ok: true, cleared });
      } catch (err: any) {
        return reply.code(500).send({ error: err.message });
      }
    }
  );

  // ── GET /admin/audit-numbers — auditoria de isolamento de números WhatsApp ──
  // Verifica se há números misturados entre usuários (mesmo zapiInstanceId em múltiplos usuários)
  // e retorna o estado completo de todos os números para diagnóstico.
  app.get(
    '/audit-numbers',
    { preHandler: [adminAuth] },
    async (_req, reply) => {
      // 1. Todos os números com dados do usuário dono
      const allNumbers = await (prisma as any).whatsappNumber.findMany({
        orderBy: { updatedAt: 'desc' },
        select: {
          id:             true,
          phoneNumber:    true,
          displayName:    true,
          status:         true,
          zapiInstanceId: true,
          createdAt:      true,
          updatedAt:      true,
          connectedAt:    true,
          userId:         true,
          user: {
            select: { id: true, email: true, name: true },
          },
        },
      });

      // 2. Detectar violações de isolamento: mesmo zapiInstanceId em múltiplos registros ativos
      const byInstance: Record<string, typeof allNumbers> = {};
      for (const n of allNumbers) {
        if (!n.zapiInstanceId) continue;
        if (!byInstance[n.zapiInstanceId]) byInstance[n.zapiInstanceId] = [];
        byInstance[n.zapiInstanceId].push(n);
      }

      const violations: any[] = [];
      for (const [instanceId, nums] of Object.entries(byInstance)) {
        const active = (nums as any[]).filter((n: any) => n.status === 'connected' || n.status === 'connecting');
        if (active.length > 1) {
          violations.push({
            instanceId,
            activeCount: active.length,
            numbers: active.map((n: any) => ({
              id:          n.id,
              phoneNumber: n.phoneNumber,
              status:      n.status,
              userId:      n.userId,
              userEmail:   n.user?.email,
              connectedAt: n.connectedAt,
              updatedAt:   n.updatedAt,
            })),
          });
        }
      }

      // 3. Números sem zapiInstanceId (órfãos)
      const orphans = allNumbers.filter((n: any) => !n.zapiInstanceId);

      // 4. Resumo por usuário
      const byUser: Record<string, any> = {};
      for (const n of allNumbers) {
        const uid = n.userId;
        if (!byUser[uid]) {
          byUser[uid] = {
            userId:    uid,
            userEmail: n.user?.email,
            userName:  n.user?.name,
            numbers:   [],
          };
        }
        byUser[uid].numbers.push({
          id:             n.id,
          phoneNumber:    n.phoneNumber,
          displayName:    n.displayName,
          status:         n.status,
          zapiInstanceId: n.zapiInstanceId,
          connectedAt:    n.connectedAt,
          updatedAt:      n.updatedAt,
        });
      }

      const summary = {
        totalNumbers:    allNumbers.length,
        connected:       allNumbers.filter((n: any) => n.status === 'connected').length,
        connecting:      allNumbers.filter((n: any) => n.status === 'connecting').length,
        disconnected:    allNumbers.filter((n: any) => n.status === 'disconnected').length,
        orphans:         orphans.length,
        violations:      violations.length,
        isolationOk:     violations.length === 0,
      };

      app.log.info(
        `[Admin Audit] Números: ${summary.totalNumbers} total, ${summary.connected} conectados, ` +
        `${violations.length} violações de isolamento`
      );

      return reply.send({
        ok: true,
        summary,
        violations,
        byUser: Object.values(byUser),
        orphans: orphans.map((n: any) => ({
          id:          n.id,
          phoneNumber: n.phoneNumber,
          displayName: n.displayName,
          status:      n.status,
          userId:      n.userId,
          userEmail:   n.user?.email,
        })),
      });
    }
  );

  // ── POST /admin/fix-number-isolation — corrige violações de isolamento ────────
  // Para cada zapiInstanceId com múltiplos números ativos, mantém o mais recente
  // e desconecta os demais. USE COM CUIDADO — altera status no banco.
  app.post(
    '/fix-number-isolation',
    { preHandler: [adminAuth] },
    async (_req, reply) => {
      const allNumbers = await (prisma as any).whatsappNumber.findMany({
        where:  { status: { in: ['connected', 'connecting'] }, zapiInstanceId: { not: null } },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, userId: true, zapiInstanceId: true, status: true, updatedAt: true },
      });

      const byInstance: Record<string, any[]> = {};
      for (const n of allNumbers) {
        if (!byInstance[n.zapiInstanceId]) byInstance[n.zapiInstanceId] = [];
        byInstance[n.zapiInstanceId].push(n);
      }

      const fixed: any[] = [];
      for (const [instanceId, nums] of Object.entries(byInstance)) {
        if (nums.length <= 1) continue;
        const [keep, ...evict] = nums; // já ordenado por updatedAt desc — manter o mais recente
        const evictIds = evict.map((n: any) => n.id);
        await prisma.whatsappNumber.updateMany({
          where: { id: { in: evictIds } },
          data:  { status: 'disconnected' },
        });
        fixed.push({
          instanceId,
          kept:    { id: keep.id, userId: keep.userId, updatedAt: keep.updatedAt },
          evicted: evict.map((n: any) => ({ id: n.id, userId: n.userId, updatedAt: n.updatedAt })),
        });
        app.log.warn(
          `[Admin Fix] Instância ${instanceId}: mantido ${keep.id} (user ${keep.userId}), ` +
          `desconectados: ${evictIds.join(', ')}`
        );
      }

      return reply.send({
        ok:    true,
        fixed: fixed.length,
        details: fixed,
      });
    }
  );

  // ── GET /admin/health — último relatório do monitor de saúde ─────────────────
  app.get(
    '/health',
    { preHandler: [adminAuth] },
    async (_req, reply) => {
      return reply.send({
        ok:         true,
        lastReport: lastReport ?? null,
        historyLen: history.length,
        // Últimas 6 verificações para mostrar tendência
        recentHistory: history.slice(-6).map(r => ({
          ts:      r.ts,
          status:  r.status,
          alerts:  r.alerts.length,
          queue:   { waiting: r.checks.queue.waiting, active: r.checks.queue.active, failed: r.checks.queue.failed },
          dbMs:    r.checks.db.latencyMs,
          redisMs: r.checks.redis.latencyMs,
        })),
      });
    }
  );

  // ── POST /admin/health/run — dispara verificação manual ──────────────────────
  app.post(
    '/health/run',
    { preHandler: [adminAuth] },
    async (_req, reply) => {
      try {
        const report = await runHealthCheck(app.log);
        return reply.send({ ok: true, report });
      } catch (err: any) {
        return reply.code(500).send({ ok: false, error: err.message });
      }
    }
  );

  // ── DELETE /admin/numbers/all — apaga TODOS os números cadastrados ────────────
  // Útil para resetar o estado antes de um novo ciclo de testes.
  // Requer confirmação via query param: ?confirm=APAGAR_TUDO
  app.delete(
    '/numbers/all',
    { preHandler: [adminAuth] },
    async (req: any, reply) => {
      if ((req.query as any).confirm !== 'APAGAR_TUDO') {
        return reply.code(400).send({
          error: 'Passe ?confirm=APAGAR_TUDO na URL para confirmar a exclusão.',
        });
      }

      const all = await (prisma as any).whatsappNumber.findMany({
        select: { id: true, userId: true, phoneNumber: true, status: true },
      });

      const deleted = await prisma.whatsappNumber.deleteMany({});

      app.log.warn(
        `[Admin] ⚠️ RESET: ${deleted.count} número(s) apagados por ${req.headers['x-forwarded-for'] || 'admin'}`
      );

      return reply.send({
        ok:      true,
        deleted: deleted.count,
        numbers: all.map((n: any) => ({
          id:          n.id,
          phoneNumber: n.phoneNumber,
          userId:      n.userId,
          status:      n.status,
        })),
      });
    }
  );

  // POST /admin/sync-plans — aplica as cotas atuais dos planos a TODOS os usuários
  // com assinatura ativa, recalculando availableMinutes com base no uso real do ciclo.
  // Cria MinuteBalance para quem não tem; recalibra quem já tem.
  // Idempotente: pode ser executado quantas vezes for necessário.
  app.post(
    '/sync-plans',
    { preHandler: [adminAuth] },
    async (_req, reply) => {
      const subscriptions = await prisma.subscription.findMany({
        where:   { status: 'active' },
        include: { plan: true, user: { select: { id: true, email: true } } },
      });

      let created  = 0;
      let updated  = 0;
      const errors: string[] = [];

      for (const sub of subscriptions) {
        const { userId } = sub;
        const planMinutes = sub.plan.minutesPerMonth;

        try {
          const existing = await prisma.minuteBalance.findUnique({ where: { userId } });

          if (!existing) {
            // Usuário sem MinuteBalance — criar com cota cheia
            await prisma.minuteBalance.create({
              data: {
                userId,
                availableMinutes: planMinutes,
                resetAt:          new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                lastAlertSent:    null,
              },
            });
            created++;
            app.log.info({ userId, plan: sub.plan.name, planMinutes }, '[Admin] sync-plans: criado');
          } else {
            // Recalcular uso real do ciclo atual
            const cycleStart = new Date(existing.resetAt.getTime() - 30 * 24 * 60 * 60 * 1000);
            const usageLogs  = await prisma.usageLog.aggregate({
              _sum: { minutesUsed: true },
              where: {
                userId,
                createdAt: { gte: cycleStart, lt: existing.resetAt },
              },
            });
            const minutesUsed   = usageLogs._sum.minutesUsed ?? 0;
            const newAvailable  = Math.max(0, Math.round((planMinutes - minutesUsed) * 100) / 100);

            await prisma.minuteBalance.update({
              where: { userId },
              data:  { availableMinutes: newAvailable, lastAlertSent: null },
            });
            updated++;
            app.log.info({ userId, plan: sub.plan.name, planMinutes, minutesUsed, newAvailable }, '[Admin] sync-plans: recalibrado');
          }
        } catch (err: any) {
          errors.push(`${sub.user.email}: ${err.message}`);
          app.log.error({ userId, err: err.message }, '[Admin] sync-plans: erro');
        }
      }

      app.log.info({ created, updated, errors: errors.length, total: subscriptions.length }, '[Admin] sync-plans concluído');

      return reply.send({
        ok:      errors.length === 0,
        total:   subscriptions.length,
        created,
        updated,
        errors,
        message: `Sincronização concluída: ${created} criado(s), ${updated} recalibrado(s)${errors.length ? `, ${errors.length} erro(s)` : ''}.`,
      });
    }
  );

  // ═══════════════════════════════════════════════════════
  //  10 Admin Features
  // ═══════════════════════════════════════════════════════

  // ── #1 Impersonação temporária (1h) ────────────────────
  app.post<{ Params: { id: string } }>(
    '/users/:id/impersonate',
    { preHandler: [adminAuth] },
    async (req, reply) => {
      const { id } = req.params;
      const user = await prisma.user.findUnique({
        where:  { id },
        select: { id: true, email: true, deletedAt: true },
      });
      if (!user)          return reply.code(404).send({ error: 'Usuário não encontrado.' });
      if (user.deletedAt) return reply.code(400).send({ error: 'Usuário deletado — não é possível impersonar.' });

      const token = (app as any).jwt.sign(
        { sub: user.id, email: user.email, impersonated: true },
        { expiresIn: '1h' }
      );
      app.log.warn({ userId: id, email: maskEmail(user.email) }, '[Admin] ⚠️ Impersonação iniciada');
      return reply.send({ token, user: { id: user.id, email: maskEmail(user.email) }, expiresIn: 3600 });
    }
  );

  // ── #2 Timeline de eventos do usuário ──────────────────
  app.get<{ Params: { id: string } }>(
    '/users/:id/timeline',
    { preHandler: [adminAuth] },
    async (req, reply) => {
      const { id } = req.params;
      const user = await prisma.user.findUnique({
        where:   { id },
        include: {
          subscription: { include: { plan: { select: { label: true } } } },
          numbers:      { orderBy: { createdAt: 'asc' }, select: { id: true, displayName: true, phoneNumber: true, connectedAt: true, createdAt: true } },
          transcriptions: {
            orderBy: { createdAt: 'asc' },
            take:    500,
            select:  { id: true, createdAt: true, durationSec: true, language: true, source: true },
          },
          supportTickets: {
            orderBy: { createdAt: 'asc' },
            select:  { id: true, category: true, status: true, createdAt: true },
          },
        },
      });
      if (!user) return reply.code(404).send({ error: 'Usuário não encontrado.' });

      const auditLogs = await prisma.auditLog.findMany({
        where:   { targetUserId: id },
        orderBy: { timestamp: 'asc' },
        take:    50,
      });

      type Ev = { ts: Date; type: string; icon: string; label: string; detail?: string };
      const events: Ev[] = [];

      events.push({ ts: user.createdAt, type: 'signup', icon: '👤', label: 'Cadastro realizado' });

      if (user.subscription) {
        events.push({ ts: user.subscription.createdAt, type: 'subscription', icon: '💳', label: 'Assinatura ativada', detail: user.subscription.plan.label });
      }
      for (const n of user.numbers) {
        events.push({ ts: n.createdAt, type: 'number-added', icon: '📱', label: 'Número adicionado', detail: n.displayName || n.phoneNumber || n.id });
        if (n.connectedAt) events.push({ ts: n.connectedAt, type: 'number-connected', icon: '✅', label: 'Número conectado', detail: n.displayName || n.phoneNumber || undefined });
      }
      if (user.transcriptions.length > 0) {
        const first = user.transcriptions[0];
        const last  = user.transcriptions[user.transcriptions.length - 1];
        events.push({ ts: first.createdAt, type: 'tx-first', icon: '🎙️', label: 'Primeira conversão', detail: `${(first.durationSec / 60).toFixed(1)} min` });
        if (last.id !== first.id) events.push({ ts: last.createdAt, type: 'tx-last', icon: '🎙️', label: 'Conversão mais recente', detail: `${(last.durationSec / 60).toFixed(1)} min` });
      }
      for (const t of user.supportTickets) {
        events.push({ ts: t.createdAt, type: 'ticket', icon: '🎫', label: `Ticket: ${t.category}`, detail: t.status });
      }
      for (const a of auditLogs) {
        events.push({ ts: a.timestamp, type: 'audit', icon: '🔍', label: a.action });
      }

      events.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
      return { events, totalTranscriptions: user.transcriptions.length };
    }
  );

  // ── #3 Bulk actions ─────────────────────────────────────
  app.post<{ Body: { userIds: string[]; action: string; value?: any } }>(
    '/users/bulk-action',
    { preHandler: [adminAuth], schema: { body: { type: 'object' } } },
    async (req, reply) => {
      const { userIds, action, value } = req.body;
      if (!Array.isArray(userIds) || userIds.length === 0) return reply.code(400).send({ error: 'userIds é obrigatório.' });
      if (userIds.length > 100)  return reply.code(400).send({ error: 'Máximo 100 usuários por ação em lote.' });
      const allowed = ['add-audios', 'set-plan', 'ban', 'unban', 'anonymize', 'export-data'];
      if (!allowed.includes(action)) return reply.code(400).send({ error: `Ação inválida. Use: ${allowed.join(', ')}` });

      let affected = 0;
      const errors: string[] = [];

      for (const userId of userIds) {
        try {
          if (action === 'add-audios') {
            // value = delta em audiosUsed (negativo devolve cota; positivo consome)
            const delta = parseFloat(value);
            if (isNaN(delta)) throw new Error('value deve ser número');
            const current = await prisma.minuteBalance.findUnique({ where: { userId } });
            const newVal  = Math.max(0, ((current as any)?.audiosUsed ?? 0) + delta);
            await prisma.minuteBalance.upsert({
              where:  { userId },
              create: { userId, audiosUsed: newVal, resetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), lastAlertSent: null } as any,
              update: { audiosUsed: newVal, lastAlertSent: null } as any,
            });

          } else if (action === 'set-plan') {
            const plan = await prisma.plan.findUnique({ where: { name: String(value) } });
            if (!plan) throw new Error(`Plano "${value}" não existe`);
            const nextReset = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
            await prisma.$transaction([
              prisma.subscription.upsert({
                where:  { userId },
                create: { userId, planId: plan.id, status: 'active' },
                update: { planId: plan.id, status: 'active' },
              }),
              prisma.minuteBalance.upsert({
                where:  { userId },
                create: { userId, audiosUsed: 0, availableMinutes: plan.minutesPerMonth, resetAt: nextReset, lastAlertSent: null } as any,
                update: { audiosUsed: 0, availableMinutes: plan.minutesPerMonth, lastAlertSent: null, resetAt: nextReset } as any,
              }),
            ]);

          } else if (action === 'ban') {
            await prisma.user.update({ where: { id: userId }, data: { deletedAt: new Date() } });

          } else if (action === 'unban') {
            await prisma.user.update({ where: { id: userId }, data: { deletedAt: null } });

          } else if (action === 'anonymize') {
            const user = await prisma.user.findUnique({ where: { id: userId } });
            if (!user) throw new Error('Usuário não encontrado');
            if (user.pseudonymizedAt) throw new Error('Já anonimizado');
            await prisma.user.update({
              where: { id: userId },
              data:  { name: '[Removido]', email: `anon_${userId.slice(0,8)}@deleted.local`, document: null, pseudonymizedAt: new Date() },
            });

          } else if (action === 'export-data') {
            // Log da solicitação — operacional LGPD
            app.log.info({ adminAction: 'lgpd-export-request', userId }, '[Admin] Solicitação de exportação LGPD registrada');
          }
          affected++;
        } catch (e: any) {
          errors.push(`${userId.slice(0, 8)}: ${e.message}`);
        }
      }

      app.log.info({ action, affected, total: userIds.length }, '[Admin] bulk-action');
      return { ok: true, affected, errors, message: `${affected}/${userIds.length} usuário(s) processado(s).` };
    }
  );

  // ── #4 Alert Config (GET + POST) ────────────────────────
  app.get('/alert-config', { preHandler: [adminAuth] }, async () => {
    const rows = await (prisma as any).adminAlertConfig.findMany();
    return Object.fromEntries(rows.map((r: any) => [r.key, r.value]));
  });

  app.post<{ Body: Record<string, any> }>(
    '/alert-config',
    { preHandler: [adminAuth], schema: { body: { type: 'object' } } },
    async (req, reply) => {
      const entries = Object.entries(req.body);
      if (entries.length === 0) return reply.code(400).send({ error: 'Corpo vazio.' });
      for (const [key, value] of entries) {
        await (prisma as any).adminAlertConfig.upsert({
          where:  { key },
          create: { key, value },
          update: { value, updatedAt: new Date() },
        });
      }
      return { ok: true, updated: entries.length };
    }
  );

  // ── #5 Gráfico de conversões por hora (últimas 24h) ──
  app.get('/analytics/transcriptions/hourly', { preHandler: [adminAuth] }, async () => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows: any[] = await prisma.$queryRaw`
      SELECT
        date_trunc('hour', "createdAt" AT TIME ZONE 'America/Sao_Paulo') AS hour,
        COUNT(*)::int AS total
      FROM "Transcription"
      WHERE "createdAt" >= ${since}
      GROUP BY 1
      ORDER BY 1
    `;
    return rows.map(r => ({ hour: r.hour, total: Number(r.total) }));
  });

  // ── Analytics first-party do SITE (visitas, geo, cliques) ──────────────────
  // Lê a tabela SiteEvent (coletada via /analytics/collect). Resiliente a drift:
  // se a tabela ainda não existir em prod, retorna estrutura vazia (sem 500).
  app.get<{ Querystring: { days?: string } }>(
    '/analytics/site',
    { preHandler: [adminAuth] },
    async (req) => {
      const days  = Math.min(Math.max(parseInt(req.query.days || '30') || 30, 1), 90);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const empty = {
        days,
        totals: { pageviews: 0, visitors: 0, clicks: 0 },
        daily: [] as any[],
        topPages: [] as any[],
        byCountry: [] as any[],
        byCity: [] as any[],
        topClicks: [] as any[],
        byDevice: [] as any[],
        bySource: [] as any[],
      };

      try {
        const [totals, daily, topPages, byCountry, byCity, topClicks, byDevice, bySource] = await Promise.all([
          prisma.$queryRaw<any[]>`
            SELECT
              COUNT(*) FILTER (WHERE "type" = 'pageview')::int            AS pageviews,
              COUNT(DISTINCT "visitorId") FILTER (WHERE "type" = 'pageview')::int AS visitors,
              COUNT(*) FILTER (WHERE "type" = 'click')::int               AS clicks
            FROM "SiteEvent" WHERE "createdAt" >= ${since}
          `,
          prisma.$queryRaw<any[]>`
            SELECT
              to_char(date_trunc('day', "createdAt" AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM-DD') AS day,
              COUNT(*) FILTER (WHERE "type" = 'pageview')::int AS pageviews,
              COUNT(DISTINCT "visitorId") FILTER (WHERE "type" = 'pageview')::int AS visitors,
              COUNT(*) FILTER (WHERE "type" = 'click')::int    AS clicks
            FROM "SiteEvent" WHERE "createdAt" >= ${since}
            GROUP BY 1 ORDER BY 1
          `,
          prisma.$queryRaw<any[]>`
            SELECT "path", COUNT(*)::int AS views
            FROM "SiteEvent" WHERE "type" = 'pageview' AND "createdAt" >= ${since}
            GROUP BY 1 ORDER BY 2 DESC LIMIT 15
          `,
          prisma.$queryRaw<any[]>`
            SELECT COALESCE("country", '??') AS country, COUNT(*)::int AS views,
                   COUNT(DISTINCT "visitorId")::int AS visitors
            FROM "SiteEvent" WHERE "type" = 'pageview' AND "createdAt" >= ${since}
            GROUP BY 1 ORDER BY 2 DESC LIMIT 20
          `,
          prisma.$queryRaw<any[]>`
            SELECT COALESCE("city", '—') AS city, COALESCE("country", '??') AS country, COUNT(*)::int AS views
            FROM "SiteEvent" WHERE "type" = 'pageview' AND "createdAt" >= ${since} AND "city" IS NOT NULL
            GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 20
          `,
          prisma.$queryRaw<any[]>`
            SELECT COALESCE("name", '—') AS name, COUNT(*)::int AS clicks
            FROM "SiteEvent" WHERE "type" = 'click' AND "createdAt" >= ${since}
            GROUP BY 1 ORDER BY 2 DESC LIMIT 15
          `,
          prisma.$queryRaw<any[]>`
            SELECT COALESCE("device", '—') AS device, COUNT(*)::int AS views
            FROM "SiteEvent" WHERE "type" = 'pageview' AND "createdAt" >= ${since}
            GROUP BY 1 ORDER BY 2 DESC
          `,
          prisma.$queryRaw<any[]>`
            SELECT COALESCE("utmSource", 'direto') AS source, COUNT(*)::int AS views
            FROM "SiteEvent" WHERE "type" = 'pageview' AND "createdAt" >= ${since}
            GROUP BY 1 ORDER BY 2 DESC LIMIT 12
          `,
        ]);

        const t = totals[0] || {};
        return {
          days,
          totals: {
            pageviews: Number(t.pageviews || 0),
            visitors:  Number(t.visitors  || 0),
            clicks:    Number(t.clicks    || 0),
          },
          daily:     daily.map((r: any) => ({ day: r.day, pageviews: Number(r.pageviews), visitors: Number(r.visitors), clicks: Number(r.clicks) })),
          topPages:  topPages.map((r: any) => ({ path: r.path, views: Number(r.views) })),
          byCountry: byCountry.map((r: any) => ({ country: r.country, views: Number(r.views), visitors: Number(r.visitors) })),
          byCity:    byCity.map((r: any) => ({ city: r.city, country: r.country, views: Number(r.views) })),
          topClicks: topClicks.map((r: any) => ({ name: r.name, clicks: Number(r.clicks) })),
          byDevice:  byDevice.map((r: any) => ({ device: r.device, views: Number(r.views) })),
          bySource:  bySource.map((r: any) => ({ source: r.source, views: Number(r.views) })),
        };
      } catch (err: any) {
        app.log.warn({ err: err?.message }, '[Admin] analytics/site indisponível (tabela ausente?)');
        return empty;
      }
    }
  );

  // ── #6 Histórico de uptime (ServiceStatusLog) ───────────
  app.get<{ Querystring: { days?: string } }>(
    '/uptime-history',
    { preHandler: [adminAuth] },
    async (req) => {
      const days  = Math.min(Math.max(parseInt(req.query.days || '7') || 7, 1), 30);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const logs  = await (prisma as any).serviceStatusLog.findMany({
        where:   { checkedAt: { gte: since } },
        orderBy: { checkedAt: 'desc' },
        take:    5000,
      });

      const byService: Record<string, any[]> = {};
      for (const log of logs) {
        if (!byService[log.service]) byService[log.service] = [];
        byService[log.service].push(log);
      }

      const summary = Object.entries(byService).map(([service, entries]) => {
        const upCount    = entries.filter(e => e.status === 'up').length;
        const uptime     = entries.length ? Math.round((upCount / entries.length) * 100) : 100;
        const withLatency = entries.filter(e => e.latencyMs != null);
        const avgLatency = withLatency.length
          ? Math.round(withLatency.reduce((a, e) => a + e.latencyMs, 0) / withLatency.length)
          : null;
        return {
          service,
          uptime,
          avgLatencyMs: avgLatency,
          checks:       entries.length,
          latest:       entries[0] ?? null,
        };
      });

      return { summary, days, total: logs.length };
    }
  );

  // ── #7 MRR por coorte de mês de cadastro ───────────────
  app.get('/analytics/mrr-cohort', { preHandler: [adminAuth] }, async () => {
    const subs = await prisma.subscription.findMany({
      where:   { status: 'active' },
      include: {
        plan: { select: { name: true, priceBrl: true } },
        user: { select: { isTester: true, createdAt: true } },
      },
    });

    const cohorts: Record<string, { cohort: string; users: number; mrr: number }> = {};
    for (const sub of subs) {
      if (sub.user.isTester || sub.plan.priceBrl === 0) continue;
      const month = sub.user.createdAt.toISOString().slice(0, 7);
      if (!cohorts[month]) cohorts[month] = { cohort: month, users: 0, mrr: 0 };
      cohorts[month].users++;
      cohorts[month].mrr = Math.round((cohorts[month].mrr + sub.plan.priceBrl) * 100) / 100;
    }

    const rows    = Object.values(cohorts).sort((a, b) => a.cohort.localeCompare(b.cohort));
    const totalMrr = Math.round(rows.reduce((acc, r) => acc + r.mrr, 0) * 100) / 100;
    return { cohorts: rows, totalMrr };
  });

  // ── #8 Risco de churn (sem atividade em N dias) ─────────
  app.get<{ Querystring: { days?: string } }>(
    '/analytics/churn-risk',
    { preHandler: [adminAuth] },
    async (req) => {
      const days  = Math.min(Math.max(parseInt(req.query.days || '14') || 14, 1), 90);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const subs = await prisma.subscription.findMany({
        where:   { status: 'active' },
        include: {
          plan: { select: { name: true, label: true, priceBrl: true } },
          user: {
            select: {
              id: true, email: true, isTester: true, createdAt: true,
              transcriptions: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
              balance:        { select: { availableMinutes: true, resetAt: true } },
            },
          },
        },
      });

      const atRisk = subs
        .filter((s: any) => s.plan.priceBrl > 0 && !s.user.isTester)
        .map((s: any) => {
          const lastT = s.user.transcriptions[0]?.createdAt ?? null;
          const daysSinceLast = lastT
            ? Math.floor((Date.now() - new Date(lastT).getTime()) / 86_400_000)
            : null;
          const isAtRisk = !lastT || new Date(lastT) < since;
          return {
            userId:       s.user.id,
            email:        maskEmail(s.user.email),
            plan:         s.plan.label,
            priceBrl:     s.plan.priceBrl,
            createdAt:    s.user.createdAt,
            lastActivity: lastT,
            daysSinceLast,
            neverUsed:    !lastT,
            minutesLeft:  s.user.balance?.availableMinutes ?? null,
            periodEnd:    s.currentPeriodEnd,
            isAtRisk,
          };
        })
        .filter((u: any) => u.isAtRisk)
        .sort((a: any, b: any) => (b.daysSinceLast ?? 9999) - (a.daysSinceLast ?? 9999));

      return { atRisk, total: atRisk.length, inactiveDays: days };
    }
  );

  // ── #9 Amostrador de conversões aleatórias ────────────
  app.get<{ Querystring: { n?: string } }>(
    '/transcriptions/sample',
    { preHandler: [adminAuth] },
    async (req) => {
      const n = Math.min(Math.max(parseInt(req.query.n || '5') || 5, 1), 20);
      const rows: any[] = await prisma.$queryRaw`
        SELECT t.id, t."userId", t."contactName", t."durationSec", t.language, t.source,
               t."createdAt", u.email AS "userEmail"
        FROM   "Transcription" t
        JOIN   "User" u ON u.id = t."userId"
        ORDER  BY RANDOM()
        LIMIT  ${n}
      `;
      return rows.map(r => ({
        ...r,
        userEmail:   maskEmail(r.userEmail),
        contactName: r.contactName ? String(r.contactName).substring(0, 25) : null,
      }));
    }
  );

  // ── #10 Painel NPS (admin view) ─────────────────────────
  app.get<{ Querystring: { days?: string } }>(
    '/nps',
    { preHandler: [adminAuth] },
    async (req) => {
      const days  = Math.min(Math.max(parseInt(req.query.days || '90') || 90, 7), 365);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const responses = await (prisma as any).npsResponse.findMany({
        where:   { createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { email: true } } },
        take:    1000,
      });

      const total      = responses.length;
      const promoters  = responses.filter((r: any) => r.score >= 9).length;
      const passives   = responses.filter((r: any) => r.score >= 7 && r.score <= 8).length;
      const detractors = responses.filter((r: any) => r.score <= 6).length;
      const npsScore   = total > 0 ? Math.round(((promoters - detractors) / total) * 100) : null;
      const avgScore   = total > 0
        ? Math.round((responses.reduce((a: number, r: any) => a + r.score, 0) / total) * 10) / 10
        : null;

      const distribution: Record<string, number> = {};
      for (let i = 0; i <= 10; i++) distribution[String(i)] = 0;
      for (const r of responses) distribution[String(r.score)]++;

      const recent = responses.slice(0, 20).map((r: any) => ({
        score:     r.score,
        comment:   r.comment,
        createdAt: r.createdAt,
        email:     maskEmail(r.user.email),
      }));

      return { npsScore, avgScore, total, promoters, passives, detractors, distribution, recent, days };
    }
  );

  // ── #11 Metas — atuais semanais e mensais ───────────────
  // Cadastros, Ativações (1ª conversão), Assinaturas pagas e Receita
  // no período. As METAS (targets) ficam em /alert-config sob a chave
  // "metas.targets" → { week: {...}, month: {...} }.
  app.get('/metas', { preHandler: [adminAuth] }, async () => {
    const now        = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    // início da semana (segunda-feira 00:00, horário local do servidor)
    const weekStart  = new Date(now); weekStart.setHours(0, 0, 0, 0);
    const dow        = (weekStart.getDay() + 6) % 7; // 0 = segunda
    weekStart.setDate(weekStart.getDate() - dow);

    async function actuals(since: Date) {
      const [cadastros, activationRows, paidSubs] = await Promise.all([
        prisma.user.count({ where: { createdAt: { gte: since } } }),
        prisma.$queryRaw<{ c: number }[]>`
          SELECT COUNT(*)::int AS c FROM (
            SELECT "userId", MIN("createdAt") AS first
            FROM "Transcription" GROUP BY "userId"
          ) t WHERE t.first >= ${since}
        `,
        prisma.subscription.findMany({
          where:   { createdAt: { gte: since }, status: 'active' },
          include: { plan: { select: { priceBrl: true } }, user: { select: { isTester: true } } },
        }),
      ]);
      const paying    = paidSubs.filter((s: any) => s.plan.priceBrl > 0 && !s.user.isTester);
      const assinaturas = paying.length;
      const receita     = Math.round(paying.reduce((a: number, s: any) => a + s.plan.priceBrl, 0) * 100) / 100;
      return {
        cadastros,
        ativacoes:   Number(activationRows[0]?.c || 0),
        assinaturas,
        receita,
      };
    }

    const [week, month] = await Promise.all([actuals(weekStart), actuals(monthStart)]);

    // targets opcionais salvos via /alert-config
    let targets: any = null;
    try {
      const row = await (prisma as any).adminAlertConfig.findUnique({ where: { key: 'metas.targets' } });
      targets = row?.value ?? null;
    } catch { /* sem targets ainda */ }

    return {
      week:  { since: weekStart,  actual: week },
      month: { since: monthStart, actual: month },
      targets,
    };
  });

  // ═══════════════════════════════════════════════════════
  //  MENSAGENS INDIVIDUAIS & CAMPANHAS
  // ═══════════════════════════════════════════════════════

  // ── POST /users/:id/send-message ────────────────────────
  // Envia mensagem individual para um usuário (WhatsApp e/ou email)
  app.post<{
    Params: { id: string };
    Body:   { channel: 'whatsapp' | 'email' | 'both'; message: string; subject?: string };
  }>(
    '/users/:id/send-message',
    { preHandler: [adminAuth], schema: { body: { type: 'object' } } },
    async (req, reply) => {
      const { id } = req.params;
      const { channel, message, subject } = req.body;

      if (!channel || !message?.trim()) {
        return reply.code(400).send({ error: 'channel e message são obrigatórios.' });
      }
      if (!['whatsapp', 'email', 'both'].includes(channel)) {
        return reply.code(400).send({ error: 'channel deve ser whatsapp, email ou both.' });
      }

      const user = await prisma.user.findUnique({
        where:   { id },
        select:  {
          id: true, email: true, name: true, deletedAt: true,
          numbers: { where: { status: 'connected' }, select: { phoneNumber: true, zapiInstanceId: true }, take: 1 },
        },
      });
      if (!user)          return reply.code(404).send({ error: 'Usuário não encontrado.' });
      if (user.deletedAt) return reply.code(400).send({ error: 'Usuário deletado.' });

      // [Nome] → primeiro nome do cadastro
      const personalMsg = personalizeMsg(message.trim(), user.name);

      const results: Record<string, any> = {};

      // ── WhatsApp ──────────────────────────────────────────
      if (channel === 'whatsapp' || channel === 'both') {
        const number = user.numbers[0];
        if (!number?.phoneNumber || !number?.zapiInstanceId) {
          results.whatsapp = { ok: false, error: 'Usuário não tem número WhatsApp conectado.' };
        } else {
          try {
            // Usa o número remetente oficial do admin (o mesmo dos convites),
            // nunca um número de cliente aleatório.
            const sender = await prisma.whatsappNumber.findFirst({
              where:  INVITE_SENDER_WHERE,
              select: { zapiInstanceId: true },
            });
            if (!sender?.zapiInstanceId) {
              throw new Error(`Número remetente ${INVITE_SENDER_PHONE} não está conectado. Conecte-o no painel antes de enviar.`);
            }
            await sendText(sender.zapiInstanceId, number.phoneNumber, personalMsg);
            results.whatsapp = { ok: true, phone: number.phoneNumber };
          } catch (e: any) {
            results.whatsapp = { ok: false, error: e.message };
          }
        }
      }

      // ── E-mail ────────────────────────────────────────────
      if (channel === 'email' || channel === 'both') {
        try {
          const emailSubject = personalizeMsg(subject?.trim() || '📩 Mensagem da equipe ZapScript', user.name);
          await sendEmail(user.email, emailSubject, adminMsgEmailHtml(personalMsg));
          results.email = { ok: true, to: maskEmail(user.email) };
        } catch (e: any) {
          results.email = { ok: false, error: e.message };
        }
      }

      app.log.info({ userId: id, channel }, '[Admin] Mensagem individual enviada');
      const anyOk = Object.values(results).some((r: any) => r.ok);
      // Sempre 200: a requisição foi processada. O status de entrega por canal
      // (sucesso/falha + motivo) vai no corpo `results` para a UI exibir.
      return reply.send({ ok: anyOk, results });
    }
  );

  // ── POST /campaigns/preview ──────────────────────────────
  // Retorna quantos usuários serão impactados pelos filtros (sem enviar nada)
  app.post<{
    Body: {
      plans?:           string[];   // ex: ['pro','ultra']
      minDaysInactive?: number;     // ex: 14 — sem conversão há N dias
      hasNeverUsed?:    boolean;    // nunca fez conversão
      emailVerified?:   boolean;
      includeTesters?:  boolean;
      includeFree?:     boolean;
      hasDocument?:     boolean;    // apenas usuários com CNPJ/CPF cadastrado (empresas)
      hasWhatsapp?:     'connected' | 'disconnected';
      userIds?:         string[];   // seleção manual de destinatários
    };
  }>(
    '/campaigns/preview',
    { preHandler: [adminAuth], schema: { body: { type: 'object' } } },
    async (req) => {
      const filters = req.body || {};
      const users   = await getCampaignRecipients(filters);
      const sample  = users.slice(0, 5).map((u: any) => ({
        email:    maskEmail(u.email),
        plan:     u.subscription?.plan?.name || 'free',
        hasPhone: u.numbers.length > 0,
      }));
      return { total: users.length, sample };
    }
  );

  // ── POST /campaigns/send ─────────────────────────────────
  // Envia mensagem em massa para usuários filtrados
  app.post<{
    Body: {
      plans?:           string[];
      minDaysInactive?: number;
      hasNeverUsed?:    boolean;
      emailVerified?:   boolean;
      includeTesters?:  boolean;
      includeFree?:     boolean;
      hasDocument?:     boolean;    // apenas usuários com CNPJ/CPF cadastrado (empresas)
      hasWhatsapp?:     'connected' | 'disconnected';
      userIds?:         string[];   // seleção manual de destinatários
      channel:          'whatsapp' | 'email' | 'both';
      message:          string;
      subject?:         string;
    };
  }>(
    '/campaigns/send',
    { preHandler: [adminAuth], schema: { body: { type: 'object' } } },
    async (req, reply) => {
      const { channel, message, subject, ...filters } = req.body;

      if (!channel || !message?.trim()) {
        return reply.code(400).send({ error: 'channel e message são obrigatórios.' });
      }

      const users = await getCampaignRecipients(filters);

      if (users.length === 0) return reply.send({ ok: true, sent: 0, failed: 0, message: 'Nenhum usuário corresponde aos filtros.' });
      if (users.length > 1000) return reply.code(400).send({ error: `Campanha limitada a 1000 destinatários. Filtros retornaram ${users.length}.` });

      // Número remetente oficial do admin (mesmo dos convites), nunca um cliente.
      const sender = await prisma.whatsappNumber.findFirst({
        where:  INVITE_SENDER_WHERE,
        select: { zapiInstanceId: true },
      });

      let sent = 0; let failed = 0;
      const errors: string[] = [];

      const emailSubject = subject?.trim() || '📩 Mensagem da equipe ZapScript';
      const baseMsg = message.trim();

      for (const user of users) {
        let userOk = false;
        // [Nome] → primeiro nome do cadastro (por destinatário)
        const personalMsg = personalizeMsg(baseMsg, (user as any).name);

        if ((channel === 'whatsapp' || channel === 'both') && sender?.zapiInstanceId) {
          const num = user.numbers[0];
          if (num?.phoneNumber && num?.zapiInstanceId) {
            try {
              await sendText(sender.zapiInstanceId, num.phoneNumber, personalMsg);
              userOk = true;
            } catch (e: any) {
              errors.push(`WA ${maskEmail(user.email)}: ${e.message}`);
            }
          }
        }

        if (channel === 'email' || channel === 'both') {
          try {
            await sendEmail(user.email, personalizeMsg(emailSubject, (user as any).name), adminMsgEmailHtml(personalMsg));
            userOk = true;
          } catch (e: any) {
            errors.push(`Email ${maskEmail(user.email)}: ${e.message}`);
          }
        }

        userOk ? sent++ : failed++;

        // Pausa de 200ms entre envios para não sobrecarregar
        await new Promise(r => setTimeout(r, 200));
      }

      app.log.info({ channel, sent, failed, total: users.length }, '[Admin] Campanha enviada');
      return { ok: true, sent, failed, total: users.length, errors: errors.slice(0, 20) };
    }
  );

  // ══════════════════════════════════════════════════════════════════════════
  // Programa de Afiliados — administração (aprovação + payout manual via Pix)
  // ══════════════════════════════════════════════════════════════════════════

  // GET /affiliates — lista afiliados (filtro por status) com estatísticas
  app.get<{ Querystring: { status?: string } }>(
    '/affiliates',
    { preHandler: [adminAuth] },
    async (req) => {
      const { status } = req.query;
      const where: any = {};
      if (status && status !== 'all') where.status = status;

      const affiliates = await prisma.affiliate.findMany({
        where,
        orderBy: { appliedAt: 'desc' },
        // Select explícito — evita referenciar colunas ausentes em caso de drift de migração
        select: {
          id: true, code: true, status: true,
          pixKey: true, pixKeyType: true, payoutName: true,
          audience: true, notes: true, appliedAt: true, approvedAt: true,
          rejectedReason: true, customRate: true,
          user:   { select: { email: true, name: true } },
          _count: { select: { referrals: true } },
        },
      });

      // Totais de comissão por afiliado
      const ids = affiliates.map((a: { id: string }) => a.id);
      const grouped = ids.length
        ? await prisma.affiliateCommission.groupBy({
            by: ['affiliateId', 'status'],
            where: { affiliateId: { in: ids } },
            _sum: { commissionAmount: true },
          })
        : [];

      const sumBy = (affId: string, st: string) =>
        Math.round((grouped.find((g: any) => g.affiliateId === affId && g.status === st)?._sum.commissionAmount || 0) * 100) / 100;

      return {
        affiliates: affiliates.map((a: any) => ({
          id:             a.id,
          code:           a.code,
          status:         a.status,
          email:          maskEmail(a.user.email),
          name:           a.user.name,
          pixKey:         a.pixKey,
          pixKeyType:     a.pixKeyType,
          payoutName:     a.payoutName,
          audience:       a.audience,
          notes:          a.notes,
          referrals:      a._count.referrals,
          pendingAmount:  sumBy(a.id, 'pending'),
          paidAmount:     sumBy(a.id, 'paid'),
          appliedAt:      a.appliedAt,
          approvedAt:     a.approvedAt,
          rejectedReason: a.rejectedReason,
          customRate:     a.customRate,
        })),
      };
    }
  );

  // POST /affiliates/:id/approve
  app.post<{ Params: { id: string } }>(
    '/affiliates/:id/approve',
    { preHandler: [adminAuth], schema: { body: { type: 'object' } } },
    async (req, reply) => {
      const aff = await prisma.affiliate.findUnique({
        where:  { id: req.params.id },
        select: { id: true, code: true, user: { select: { email: true, name: true } } },
      });
      if (!aff) return reply.code(404).send({ error: 'Afiliado não encontrado.' });

      await prisma.affiliate.update({
        where: { id: aff.id },
        data:  { status: 'approved', approvedAt: new Date(), rejectedReason: null },
      });

      // Aviso por e-mail (best-effort)
      if (aff.user.email) {
        const APP_URL = process.env.APP_URL || 'https://zapscript.me';
        sendEmail(
          aff.user.email,
          '🎉 Você foi aprovado como Afiliado ZapScript',
          `<div style="font-family:sans-serif;max-width:540px;margin:0 auto;background:#050a07;color:#d1fae5;padding:32px;border-radius:12px">
            <div style="font-size:22px;font-weight:bold;margin-bottom:12px">🎉 Cadastro de afiliado aprovado!</div>
            <p style="color:#a7f3d0;line-height:1.7">Olá, ${escHtmlAdmin(aff.user.name?.split(' ')[0] || 'parceiro(a)')}! Seu cadastro no Programa de Afiliados do ZapScript foi aprovado.</p>
            <p style="color:#a7f3d0;line-height:1.7">Seu link de divulgação:<br><strong style="color:#10b981">${APP_URL}/?aff=${aff.code}</strong></p>
            <div style="margin:24px 0;text-align:center">
              <a href="${APP_URL}/dashboard/afiliado" style="background:#10b981;color:#04130c;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:bold">Acessar painel de afiliado →</a>
            </div>
          </div>`,
        ).catch(err => app.log.error({ err }, 'Erro ao enviar e-mail de aprovação de afiliado'));
      }

      app.log.info(`[Admin] Afiliado aprovado: ${aff.id} (${aff.code})`);
      return { ok: true };
    }
  );

  // POST /affiliates/:id/reject  { reason? }
  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/affiliates/:id/reject',
    { preHandler: [adminAuth], schema: { body: { type: 'object' } } },
    async (req, reply) => {
      const aff = await prisma.affiliate.findUnique({
        where:  { id: req.params.id },
        select: { id: true },
      });
      if (!aff) return reply.code(404).send({ error: 'Afiliado não encontrado.' });

      await prisma.affiliate.update({
        where: { id: aff.id },
        data:  { status: 'rejected', rejectedReason: req.body?.reason?.slice(0, 500) || 'Não especificado' },
      });
      app.log.info(`[Admin] Afiliado recusado: ${aff.id}`);
      return { ok: true };
    }
  );

  // GET /affiliates/commissions?status=pending — extrato global de comissões
  app.get<{ Querystring: { status?: string } }>(
    '/affiliates/commissions',
    { preHandler: [adminAuth] },
    async (req) => {
      const { status } = req.query;
      const where: any = {};
      if (status && status !== 'all') where.status = status;

      const commissions = await prisma.affiliateCommission.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take:    300,
        include: {
          affiliate: {
            select: { code: true, pixKey: true, pixKeyType: true, payoutName: true, user: { select: { email: true, name: true } } },
          },
        },
      });

      return {
        commissions: commissions.map((c: any) => ({
          id:               c.id,
          affiliateCode:    c.affiliate.code,
          affiliateName:    c.affiliate.payoutName || c.affiliate.user.name,
          affiliateEmail:   maskEmail(c.affiliate.user.email),
          pixKey:           c.affiliate.pixKey,
          pixKeyType:       c.affiliate.pixKeyType,
          saleAmount:       c.saleAmount,
          commissionAmount: c.commissionAmount,
          commissionType:   c.commissionType,
          monthIndex:       c.monthIndex,
          status:           c.status,
          paidAt:           c.paidAt,
          paidReference:    c.paidReference,
          createdAt:        c.createdAt,
        })),
      };
    }
  );

  // POST /affiliates/commissions/:id/mark-paid  { reference? }
  app.post<{ Params: { id: string }; Body: { reference?: string } }>(
    '/affiliates/commissions/:id/mark-paid',
    { preHandler: [adminAuth], schema: { body: { type: 'object' } } },
    async (req, reply) => {
      const c = await prisma.affiliateCommission.findUnique({ where: { id: req.params.id } });
      if (!c) return reply.code(404).send({ error: 'Comissão não encontrada.' });
      if (c.status === 'paid') return { ok: true, alreadyPaid: true };

      const updated = await prisma.affiliateCommission.update({
        where:   { id: c.id },
        data:    { status: 'paid', paidAt: new Date(), paidReference: req.body?.reference?.slice(0, 200) || null },
        include: { affiliate: { include: { user: { select: { email: true, name: true } } } } },
      });

      // Notificar afiliado do pagamento (best-effort)
      const userEmail = updated.affiliate.user.email;
      if (userEmail) {
        const APP_URL   = process.env.APP_URL || 'https://zapscript.me';
        const firstName = updated.affiliate.user.name?.split(' ')[0] || 'parceiro(a)';
        const amtFmt    = updated.commissionAmount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        sendEmail(
          userEmail,
          `🎉 Pix enviado! ${amtFmt} chegando na sua conta`,
          `<div style="font-family:sans-serif;max-width:540px;margin:0 auto;background:#050a07;color:#d1fae5;padding:32px;border-radius:12px">
            <div style="font-size:22px;font-weight:bold;margin-bottom:12px">🎉 Pagamento realizado!</div>
            <p style="color:#a7f3d0;line-height:1.7">Olá, ${escHtmlAdmin(firstName)}! Seu Pix de comissão foi enviado.</p>
            <p style="color:#a7f3d0;line-height:1.7">Valor: <strong style="color:#10b981;font-size:20px">${amtFmt}</strong></p>
            ${req.body?.reference ? `<p style="color:#6b7280;font-size:13px">Referência: ${escHtmlAdmin(req.body.reference)}</p>` : ''}
            <p style="color:#6b7280;font-size:13px">Continue divulgando seu link para acumular mais comissões!</p>
            <div style="margin:24px 0;text-align:center">
              <a href="${APP_URL}/dashboard/afiliado" style="background:#10b981;color:#04130c;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:bold">Ver extrato →</a>
            </div>
          </div>`,
        ).catch(err => app.log.error({ err }, 'Erro ao enviar e-mail de pagamento de afiliado'));
      }

      app.log.info(`[Admin] Comissão marcada como paga: ${c.id} R$${c.commissionAmount}`);
      return { ok: true };
    }
  );

  // ── Carteira de Crédito (Regulamento v4) — fila de saques manuais ────────
  // GET /wallet/payouts?status=requested — fila de solicitações de saque
  app.get<{ Querystring: { status?: string } }>(
    '/wallet/payouts',
    { preHandler: [adminAuth] },
    async (req) => {
      const status = req.query.status;
      const payouts = await prisma.walletPayout.findMany({
        where:   status ? { status } : undefined,
        orderBy: { requestedAt: 'desc' },
        take:    300,
        include: { wallet: { include: { user: { select: { email: true, name: true } } } } },
      });
      return { payouts };
    },
  );

  // POST /wallet/payouts/:id/mark-paid  { reference? }
  app.post<{ Params: { id: string }; Body: { reference?: string } }>(
    '/wallet/payouts/:id/mark-paid',
    { preHandler: [adminAuth], schema: { body: { type: 'object' } } },
    async (req, reply) => {
      const p = await prisma.walletPayout.findUnique({
        where:   { id: req.params.id },
        include: { wallet: { include: { user: { select: { email: true, name: true } } } } },
      });
      if (!p) return reply.code(404).send({ error: 'Solicitação de saque não encontrada.' });
      if (p.status === 'paid') return { ok: true, alreadyPaid: true };

      await prisma.walletPayout.update({
        where: { id: p.id },
        data:  { status: 'paid', paidAt: new Date(), paidReference: req.body?.reference?.slice(0, 200) || null },
      });

      const userEmail = p.wallet.user.email;
      if (userEmail) {
        const firstName = p.wallet.user.name?.split(' ')[0] || 'tudo bem';
        const amtFmt = p.amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        sendEmail(
          userEmail,
          `🎉 Pix enviado! ${amtFmt} chegando na sua conta`,
          `<div style="font-family:sans-serif;max-width:540px;margin:0 auto;background:#050a07;color:#d1fae5;padding:32px;border-radius:12px">
            <div style="font-size:22px;font-weight:bold;margin-bottom:12px">🎉 Pagamento realizado!</div>
            <p style="color:#a7f3d0;line-height:1.7">Olá, ${escHtmlAdmin(firstName)}! O saque da sua carteira ZapScript foi pago.</p>
            <p style="color:#a7f3d0;line-height:1.7">Valor: <strong style="color:#10b981;font-size:20px">${amtFmt}</strong></p>
          </div>`,
        ).catch(err => app.log.error({ err }, 'Erro ao enviar e-mail de pagamento de saque da carteira'));
      }

      app.log.info(`[Admin] Saque de carteira marcado como pago: ${p.id} R$${p.amount}`);
      return { ok: true };
    },
  );

  // GET /affiliates/performance — resumo geral + ranking de desempenho por afiliado
  app.get(
    '/affiliates/performance',
    { preHandler: [adminAuth] },
    async () => {
      const round2 = (n: number) => Math.round((n || 0) * 100) / 100;

      const [byStatus, affiliates, convertedGroup, commGroup] = await Promise.all([
        prisma.affiliate.groupBy({ by: ['status'], _count: { _all: true } }),
        prisma.affiliate.findMany({
          where:  { status: 'approved' },
          select: {
            id: true, code: true,
            user: { select: { name: true, email: true } },
            _count: { select: { referrals: true } },
          },
        }),
        prisma.affiliateReferral.groupBy({ by: ['affiliateId'], where: { status: 'converted' }, _count: { _all: true } }),
        prisma.affiliateCommission.groupBy({ by: ['affiliateId', 'status'], _sum: { commissionAmount: true } }),
      ]);

      const statusCount = (s: string) => byStatus.find((g: any) => g.status === s)?._count._all || 0;
      const convOf = (id: string) => convertedGroup.find((g: any) => g.affiliateId === id)?._count._all || 0;
      const sumOf  = (id: string, st: string) => round2(commGroup.find((g: any) => g.affiliateId === id && g.status === st)?._sum.commissionAmount || 0);

      const rows = affiliates.map((a: any) => {
        const referrals = a._count.referrals;
        const converted = convOf(a.id);
        const pending   = sumOf(a.id, 'pending');
        const paid      = sumOf(a.id, 'paid');
        return {
          id:             a.id,
          code:           a.code,
          name:           a.user.name,
          email:          maskEmail(a.user.email),
          referrals,
          converted,
          convRate:  referrals ? Math.round((converted / referrals) * 100) : 0,
          pending,                    // saldo acumulado a pagar
          paid,                       // total já pago
          lifetime:  round2(pending + paid),
        };
      }).sort((x: any, y: any) => y.lifetime - x.lifetime);

      const totalReferrals = rows.reduce((s: number, r: any) => s + r.referrals, 0);
      const totalConverted = rows.reduce((s: number, r: any) => s + r.converted, 0);

      return {
        summary: {
          total:          byStatus.reduce((s: number, g: any) => s + g._count._all, 0),
          approved:       statusCount('approved'),
          pending:        statusCount('pending'),   // solicitações aguardando autorização
          rejected:       statusCount('rejected'),
          totalReferrals,
          totalConverted,
          convRate:       totalReferrals ? Math.round((totalConverted / totalReferrals) * 100) : 0,
          pendingPayout:  round2(rows.reduce((s: number, r: any) => s + r.pending, 0)),
          paidLifetime:   round2(rows.reduce((s: number, r: any) => s + r.paid, 0)),
        },
        rows,
      };
    }
  );

  // ── GET /affiliates/config — parâmetros efetivos do programa (taxas, ─────
  // auto-aprovação, relatório periódico) + defaults hardcoded p/ referência.
  app.get('/affiliates/config', { preHandler: [adminAuth] }, async () => {
    const [rates, autoApprove, reportSchedule] = await Promise.all([
      getEffectiveCommissionRates(),
      getAutoApproveConfig(),
      getReportScheduleConfig(),
    ]);
    return {
      rates, autoApprove, reportSchedule,
      defaults: { base: COMMISSION.BASE_RATE, bonus: COMMISSION.BONUS_RATE, residual: COMMISSION.RESIDUAL_RATE },
    };
  });

  // ── PUT /affiliates/config — grava parâmetros (parcial: só as chaves enviadas) ──
  app.put<{ Body: { rates?: any; autoApprove?: any; reportSchedule?: any } }>(
    '/affiliates/config',
    { preHandler: [adminAuth], schema: { body: { type: 'object' } } },
    async (req, reply) => {
      const { rates, autoApprove, reportSchedule } = req.body || {};
      const entries: Record<string, any> = {};

      if (rates) {
        for (const k of ['base', 'bonus', 'residual']) {
          const v = (rates as any)[k];
          if (v !== undefined && (!Number.isFinite(v) || v <= 0 || v >= 1)) {
            return reply.code(400).send({ error: `Taxa "${k}" deve ser uma fração entre 0 e 1 (ex.: 0.3 = 30%).` });
          }
        }
        entries.rates = rates;
      }
      if (autoApprove) entries.autoApprove = autoApprove;
      if (reportSchedule) {
        if (reportSchedule.cadence && !['off', 'weekly', 'monthly'].includes(reportSchedule.cadence)) {
          return reply.code(400).send({ error: 'Cadência inválida (use off, weekly ou monthly).' });
        }
        entries.reportSchedule = reportSchedule;
      }
      if (Object.keys(entries).length === 0) return reply.code(400).send({ error: 'Corpo vazio.' });

      await setAffiliateConfig(entries);
      app.log.info(`[Admin] Config de afiliados atualizada: ${Object.keys(entries).join(', ')}`);
      return { ok: true };
    }
  );

  // ── GET /affiliates/campaigns — lista campanhas sazonais (todas, +recentes primeiro) ──
  app.get('/affiliates/campaigns', { preHandler: [adminAuth] }, async () => {
    const campaigns = await (prisma as any).affiliateCampaign.findMany({ orderBy: { startsAt: 'desc' } });
    return { campaigns };
  });

  // ── POST /affiliates/campaigns — cria campanha (ex.: "Black Friday: 50% de 20/11 a 30/11") ──
  app.post<{ Body: { name?: string; rate?: number; startsAt?: string; endsAt?: string } }>(
    '/affiliates/campaigns',
    { preHandler: [adminAuth], schema: { body: { type: 'object' } } },
    async (req, reply) => {
      const { name, rate, startsAt, endsAt } = req.body || {};
      if (!name?.trim()) return reply.code(400).send({ error: 'Nome da campanha é obrigatório.' });
      if (!Number.isFinite(rate) || (rate as number) <= 0 || (rate as number) >= 1) {
        return reply.code(400).send({ error: 'Taxa deve ser uma fração entre 0 e 1 (ex.: 0.5 = 50%).' });
      }
      const start = new Date(startsAt || '');
      const end   = new Date(endsAt || '');
      if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
        return reply.code(400).send({ error: 'Datas inválidas — o fim deve ser depois do início.' });
      }

      const campaign = await (prisma as any).affiliateCampaign.create({
        data: { name: name.trim().slice(0, 100), rate, startsAt: start, endsAt: end, active: true },
      });
      app.log.info(`[Admin] Campanha de afiliados criada: "${campaign.name}" (${Math.round((rate as number) * 100)}%, ${start.toISOString().slice(0, 10)}→${end.toISOString().slice(0, 10)})`);
      return reply.code(201).send({ ok: true, campaign });
    }
  );

  // ── PUT /affiliates/campaigns/:id — edita ou (des)ativa uma campanha ─────
  app.put<{ Params: { id: string }; Body: { active?: boolean; name?: string; rate?: number; startsAt?: string; endsAt?: string } }>(
    '/affiliates/campaigns/:id',
    { preHandler: [adminAuth], schema: { body: { type: 'object' } } },
    async (req, reply) => {
      const existing = await (prisma as any).affiliateCampaign.findUnique({ where: { id: req.params.id } });
      if (!existing) return reply.code(404).send({ error: 'Campanha não encontrada.' });

      const { active, name, rate, startsAt, endsAt } = req.body || {};
      const data: any = {};
      if (active !== undefined) data.active = !!active;
      if (name !== undefined) data.name = name.trim().slice(0, 100);
      if (rate !== undefined) {
        if (!Number.isFinite(rate) || rate <= 0 || rate >= 1) return reply.code(400).send({ error: 'Taxa inválida.' });
        data.rate = rate;
      }
      if (startsAt !== undefined) data.startsAt = new Date(startsAt);
      if (endsAt !== undefined) data.endsAt = new Date(endsAt);

      const updated = await (prisma as any).affiliateCampaign.update({ where: { id: existing.id }, data });
      app.log.info(`[Admin] Campanha de afiliados atualizada: ${existing.id}`);
      return { ok: true, campaign: updated };
    }
  );

  // ── PUT /affiliates/:id/custom-rate — taxa individual (override), null remove ──
  app.put<{ Params: { id: string }; Body: { customRate?: number | null } }>(
    '/affiliates/:id/custom-rate',
    { preHandler: [adminAuth], schema: { body: { type: 'object' } } },
    async (req, reply) => {
      const { customRate } = req.body || {};
      if (customRate !== null && customRate !== undefined && (!Number.isFinite(customRate) || customRate <= 0 || customRate >= 1)) {
        return reply.code(400).send({ error: 'Taxa deve ser uma fração entre 0 e 1 (ex.: 0.35 = 35%), ou null para remover.' });
      }
      const aff = await prisma.affiliate.findUnique({ where: { id: req.params.id }, select: { id: true, code: true } });
      if (!aff) return reply.code(404).send({ error: 'Afiliado não encontrado.' });

      await prisma.affiliate.update({ where: { id: aff.id }, data: { customRate: customRate ?? null } });
      app.log.info(`[Admin] Taxa personalizada: ${aff.code} → ${customRate != null ? Math.round(customRate * 100) + '%' : 'removida (usa global)'}`);
      return { ok: true };
    }
  );

  // ══════════════════════════════════════════════════════════════════════════
  // Leads da demo pública ("converta 1 áudio grátis" da landing page)
  // ══════════════════════════════════════════════════════════════════════════

  // GET /demo-leads?q=&limit= — lista leads (e-mail completo p/ contato) + totais
  app.get<{ Querystring: { q?: string; limit?: string } }>(
    '/demo-leads',
    { preHandler: [adminAuth] },
    async (req) => {
      const q     = (req.query.q || '').trim().toLowerCase();
      const limit = Math.min(Math.max(parseInt(req.query.limit || '1000', 10) || 1000, 1), 5000);
      const where: any = q ? { email: { contains: q, mode: 'insensitive' } } : {};

      const [leads, total, distinct] = await Promise.all([
        prisma.demoLead.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take:    limit,
          select:  { id: true, email: true, ip: true, durationSec: true, createdAt: true },
        }),
        prisma.demoLead.count({ where }),
        prisma.demoLead.findMany({ where, distinct: ['email'], select: { email: true } }),
      ]);

      return { leads, total, uniqueEmails: distinct.length };
    }
  );

  // ── Inteligência de Crescimento — funil, retenção, unit economics, MRR, alavancas ──
  // Endpoint único consumido pela aba "Crescimento". Resiliente: cada bloco tem
  // fallback próprio (retorna null) para não derrubar o painel inteiro se uma
  // query falhar (ex.: drift de schema em produção).
  app.get<{ Querystring: { days?: string } }>(
    '/analytics/growth',
    { preHandler: [adminAuth] },
    async (req) => {
      const days  = Math.min(Math.max(parseInt(req.query.days || '30') || 30, 7), 365);
      const since = new Date(Date.now() - days * 86_400_000);
      const d60   = new Date(Date.now() - 60 * 86_400_000);
      const d30   = new Date(Date.now() - 30 * 86_400_000);
      const d7    = new Date(Date.now() - 7  * 86_400_000);
      const d1    = new Date(Date.now() - 1  * 86_400_000);

      // ── 1) Funil de ativação + time-to-activation ──────────────────────────
      async function funnel() {
        try {
          const rows = await prisma.$queryRaw<any[]>`
            WITH u AS (
              SELECT id FROM "User"
              WHERE "deletedAt" IS NULL AND "createdAt" >= ${since}
            )
            SELECT
              COUNT(*)::int AS signups,
              COUNT(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM "WhatsappNumber" w
                WHERE w."userId" = u.id AND (w."connectedAt" IS NOT NULL OR w.status = 'connected')
              ))::int AS connected,
              COUNT(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM "Transcription" t WHERE t."userId" = u.id
              ))::int AS first_audio,
              COUNT(*) FILTER (WHERE (
                SELECT COUNT(*) FROM "Transcription" t WHERE t."userId" = u.id
              ) >= 3)::int AS activated
            FROM u
          `;
          const tta = await prisma.$queryRaw<any[]>`
            SELECT percentile_cont(0.5) WITHIN GROUP (
              ORDER BY EXTRACT(EPOCH FROM (ft.first_t - u."createdAt"))
            ) AS median_seconds
            FROM "User" u
            JOIN (
              SELECT "userId", MIN("createdAt") AS first_t
              FROM "Transcription" GROUP BY "userId"
            ) ft ON ft."userId" = u.id
            WHERE u."createdAt" >= ${since} AND u."deletedAt" IS NULL
          `;
          const r = rows[0] || {};
          const medSec = Number(tta[0]?.median_seconds || 0);
          return {
            signups:    Number(r.signups || 0),
            connected:  Number(r.connected || 0),
            firstAudio: Number(r.first_audio || 0),
            activated:  Number(r.activated || 0),
            timeToActivationHours: medSec ? Math.round((medSec / 3600) * 10) / 10 : null,
          };
        } catch (err: any) {
          app.log.warn({ err: err?.message }, '[Growth] funnel falhou');
          return null;
        }
      }

      // ── 2) Retenção por cohort + DAU/WAU/MAU + stickiness ──────────────────
      async function retention() {
        try {
          const active = await prisma.$queryRaw<any[]>`
            SELECT
              COUNT(DISTINCT "userId") FILTER (WHERE "createdAt" >= ${d1})::int  AS dau,
              COUNT(DISTINCT "userId") FILTER (WHERE "createdAt" >= ${d7})::int  AS wau,
              COUNT(DISTINCT "userId") FILTER (WHERE "createdAt" >= ${d30})::int AS mau
            FROM "Transcription"
          `;
          const cohorts = await prisma.$queryRaw<any[]>`
            WITH cohorts AS (
              SELECT id AS user_id, date_trunc('week', "createdAt") AS cohort_week
              FROM "User"
              WHERE "deletedAt" IS NULL AND "createdAt" >= now() - interval '8 weeks'
            ),
            acts AS (
              SELECT DISTINCT c.user_id, c.cohort_week,
                floor(EXTRACT(EPOCH FROM (date_trunc('week', t."createdAt") - c.cohort_week)) / 604800)::int AS week_offset
              FROM cohorts c JOIN "Transcription" t ON t."userId" = c.user_id
            )
            SELECT to_char(c.cohort_week, 'YYYY-MM-DD') AS cohort,
              COUNT(DISTINCT c.user_id)::int AS size,
              COUNT(DISTINCT a.user_id) FILTER (WHERE a.week_offset = 0)::int AS w0,
              COUNT(DISTINCT a.user_id) FILTER (WHERE a.week_offset = 1)::int AS w1,
              COUNT(DISTINCT a.user_id) FILTER (WHERE a.week_offset = 2)::int AS w2,
              COUNT(DISTINCT a.user_id) FILTER (WHERE a.week_offset = 3)::int AS w3
            FROM cohorts c LEFT JOIN acts a ON a.user_id = c.user_id
            GROUP BY c.cohort_week ORDER BY c.cohort_week
          `;
          const a = active[0] || {};
          const dau = Number(a.dau || 0), mau = Number(a.mau || 0);
          return {
            dau, wau: Number(a.wau || 0), mau,
            stickiness: mau ? Math.round((dau / mau) * 1000) / 10 : null,
            cohorts: cohorts.map((c: any) => ({
              cohort: c.cohort, size: Number(c.size),
              w0: Number(c.w0), w1: Number(c.w1), w2: Number(c.w2), w3: Number(c.w3),
            })),
          };
        } catch (err: any) {
          app.log.warn({ err: err?.message }, '[Growth] retention falhou');
          return null;
        }
      }

      // ── 3 + 4) Unit economics + MRR movement + churn + conversão cadastro→pago ──
      async function economics() {
        try {
          const [activeSubs, canceledLast30, newPaidLast30, paidCohort60, signupsAged60, totalUsers] = await Promise.all([
            prisma.subscription.findMany({
              where:   { status: 'active' },
              include: { plan: { select: { priceBrl: true } }, user: { select: { isTester: true } } },
            }),
            prisma.subscription.findMany({
              where:   { status: 'canceled', updatedAt: { gte: d30 } },
              include: { plan: { select: { priceBrl: true } }, user: { select: { isTester: true } } },
            }),
            prisma.subscription.findMany({
              where:   { status: 'active', createdAt: { gte: d30 } },
              include: { plan: { select: { priceBrl: true } }, user: { select: { isTester: true } } },
            }),
            // pagantes não-tester que entraram nos últimos 60 dias (conversões do funil de cadastro, sem trial)
            prisma.subscription.count({
              where: { status: 'active', plan: { priceBrl: { gt: 0 } }, user: { isTester: false }, createdAt: { gte: d60 } },
            }),
            // usuários com pelo menos 7 dias de conta: criados entre 60 e 7 dias atrás — denominador da conversão
            prisma.user.count({ where: { deletedAt: null, createdAt: { gte: d60, lte: d7 } } }),
            prisma.user.count({ where: { deletedAt: null } }),
          ]);

          const paying       = activeSubs.filter((s: any) => !s.user.isTester && s.plan.priceBrl > 0);
          const payingCount  = paying.length;
          const mrr          = Math.round(paying.reduce((a: number, s: any) => a + s.plan.priceBrl, 0) * 100) / 100;
          const arpu         = totalUsers  ? Math.round((mrr / totalUsers)  * 100) / 100 : 0;
          const arppu        = payingCount ? Math.round((mrr / payingCount) * 100) / 100 : 0;

          const churnedCustomers = canceledLast30.filter((s: any) => !s.user.isTester && (s.plan?.priceBrl || 0) > 0).length;
          const churnedMrr = Math.round(canceledLast30.reduce((a: number, s: any) => a + (s.user.isTester ? 0 : (s.plan?.priceBrl || 0)), 0) * 100) / 100;
          const newMrr     = Math.round(newPaidLast30.filter((s: any) => !s.user.isTester && s.plan.priceBrl > 0).reduce((a: number, s: any) => a + s.plan.priceBrl, 0) * 100) / 100;

          // churn% mensal aproximado = perdidos / (pagantes atuais + perdidos no período)
          const churnRate = (payingCount + churnedCustomers) > 0
            ? Math.round((churnedCustomers / (payingCount + churnedCustomers)) * 1000) / 10
            : null;
          // LTV = ARPPU / churn mensal (fração). Sem churn medido → null.
          const ltv = (churnRate && churnRate > 0) ? Math.round((arppu / (churnRate / 100)) * 100) / 100 : null;
          // conversão cadastro→pago em até 60 dias: pagantes (≤60d) / usuários com ≥7 dias de conta (7–60d)
          const signupToPaidRate60d = signupsAged60 > 0 ? Math.round((paidCohort60 / signupsAged60) * 1000) / 10 : null;

          return {
            mrr, payingCount, totalUsers, arpu, arppu, ltv,
            churnRate, churnedCustomers, churnedMrr, newMrr,
            netNewMrr: Math.round((newMrr - churnedMrr) * 100) / 100,
            signupToPaidRate60d,
            // CAC / payback dependem de investimento em mídia (não está no banco) → informados pelo painel Financeiro
            cac: null, ltvCacRatio: null, paybackMonths: null,
          };
        } catch (err: any) {
          app.log.warn({ err: err?.message }, '[Growth] economics falhou');
          return null;
        }
      }

      // ── 5) Alavancas de produto + K-factor ─────────────────────────────────
      async function levers() {
        try {
          const [referredUsers, newUsersWindow, footerAgg, seedCount, invitesAgg, invitesUsed] = await Promise.all([
            prisma.user.count({ where: { deletedAt: null, referredBy: { not: null }, createdAt: { gte: since } } }),
            prisma.user.count({ where: { deletedAt: null, createdAt: { gte: since } } }),
            prisma.transcription.groupBy({ by: ['footerVariant'], where: { footerShown: true, createdAt: { gte: since } }, _count: true }),
            (prisma as any).proContactSeed.count().catch(() => 0),
            prisma.testerInvite.aggregate({ _count: { _all: true }, _sum: { clickCount: true } }),
            prisma.testerInvite.count({ where: { usedAt: { not: null } } }),
          ]);
          // K-factor aproximado = novos usuários vindos de indicação / novos usuários no período
          const kFactor = newUsersWindow ? Math.round((referredUsers / newUsersWindow) * 1000) / 1000 : null;
          return {
            referredUsers, newUsersWindow, kFactor,
            footerByVariant:   footerAgg.map((f: any) => ({ variant: f.footerVariant || '—', count: Number(f._count) })),
            footerImpressions: footerAgg.reduce((a: number, f: any) => a + Number(f._count || 0), 0),
            seededContacts:    Number(seedCount || 0),
            invites: { total: invitesAgg._count._all, clicks: invitesAgg._sum.clickCount || 0, used: invitesUsed },
          };
        } catch (err: any) {
          app.log.warn({ err: err?.message }, '[Growth] levers falhou');
          return null;
        }
      }

      const [funnelData, retentionData, economicsData, leversData] = await Promise.all([
        funnel(), retention(), economics(), levers(),
      ]);
      return { days, funnel: funnelData, retention: retentionData, economics: economicsData, levers: leversData };
    }
  );
}

/** Escapa HTML em templates de e-mail do admin. */
function escHtmlAdmin(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/** Primeiro nome do cadastro (fallback neutro quando não há nome). */
function firstNameOfAdmin(name: string | null | undefined): string {
  const n = name?.trim().split(/\s+/)[0];
  return n || 'tudo bem';
}

/** Substitui o token [Nome] (case-insensitive) pelo primeiro nome do usuário. */
function personalizeMsg(text: string, name: string | null | undefined): string {
  return text.replace(/\[nome\]/gi, firstNameOfAdmin(name));
}

/** Monta o HTML padrão de mensagem do admin (mesmo layout em individual e campanha). */
function adminMsgEmailHtml(message: string): string {
  return `
    <div style="font-family:sans-serif;max-width:540px;margin:0 auto;background:#050a07;color:#d1fae5;padding:32px;border-radius:12px">
      <div style="font-size:22px;font-weight:bold;margin-bottom:16px">📩 Mensagem do ZapScript</div>
      <div style="font-size:14px;line-height:1.6;white-space:pre-wrap;color:#a7f3d0">${message.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
      <div style="margin-top:24px;font-size:11px;color:#6ee7b7;opacity:0.5">Equipe ZapScript · zapscript.me</div>
    </div>`;
}

// ── Helper: monta lista de usuários para campanha ────────────────────────────
async function getCampaignRecipients(filters: {
  plans?:           string[];
  minDaysInactive?: number;
  hasNeverUsed?:    boolean;
  emailVerified?:   boolean;
  includeTesters?:  boolean;
  includeFree?:     boolean;
  hasDocument?:     boolean;
  hasWhatsapp?:     'connected' | 'disconnected';  // com / sem número WhatsApp conectado
  userIds?:         string[];   // seleção manual — quando presente, ignora os demais filtros
}) {
  const RECIPIENT_INCLUDE = {
    subscription: { include: { plan: { select: { name: true } } } },
    numbers:      { where: { status: 'connected' }, select: { phoneNumber: true, zapiInstanceId: true }, take: 1 },
    transcriptions: { orderBy: { createdAt: 'desc' as const }, take: 1, select: { createdAt: true } },
  };

  // Seleção manual de destinatários: retorna exatamente os usuários escolhidos.
  if (filters.userIds && filters.userIds.length > 0) {
    return prisma.user.findMany({
      where:   { id: { in: filters.userIds.slice(0, 1100) }, deletedAt: null },
      include: RECIPIENT_INCLUDE,
    });
  }

  const since14d = filters.minDaysInactive
    ? new Date(Date.now() - filters.minDaysInactive * 86_400_000)
    : null;

  const users = await prisma.user.findMany({
    where: {
      deletedAt:      null,
      emailVerified:  filters.emailVerified === true ? true : undefined,
      isTester:       filters.includeTesters ? undefined : false,
      document:       filters.hasDocument === true ? { not: null } : undefined,
    },
    include: RECIPIENT_INCLUDE,
    take: 1100, // hard cap
  });

  return users.filter((u: any) => {
    const planName = u.subscription?.plan?.name || 'free';

    // Filtro por WhatsApp (numbers já vem filtrado para status 'connected')
    const hasConnected = u.numbers.length > 0;
    if (filters.hasWhatsapp === 'connected'    && !hasConnected) return false;
    if (filters.hasWhatsapp === 'disconnected' &&  hasConnected) return false;

    // Filtro por plano
    if (filters.plans && filters.plans.length > 0) {
      if (!filters.plans.includes(planName)) return false;
    } else if (!filters.includeFree && planName === 'free') {
      return false; // por padrão exclui free
    }

    // Filtro por inatividade
    if (since14d) {
      const lastT = u.transcriptions[0]?.createdAt;
      if (!lastT || new Date(lastT) >= since14d) return false; // ainda ativo — exclui
    }

    // Filtro "nunca usou"
    if (filters.hasNeverUsed === true && u.transcriptions.length > 0) return false;

    return true;
  });
}
