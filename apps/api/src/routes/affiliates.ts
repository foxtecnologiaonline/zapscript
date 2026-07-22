import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { genAffiliateCode, COMMISSION } from '../lib/affiliate';
import { sendEmail } from '../lib/mailer';

/* ─────────────────────────────────────────────────────────
   Programa de Afiliados — rotas self-service (JWT)
   Painel admin (aprovação/payout) fica em routes/admin.ts
   ───────────────────────────────────────────────────────── */

const VALID_PIX_TYPES = ['cpf', 'cnpj', 'email', 'phone', 'random'];
const HOLD_MS = COMMISSION.PAYOUT_HOLD_DAYS * 24 * 60 * 60 * 1000;

function hashIp(ip: string): string {
  return crypto.createHash('sha256').update(`zs-ip:${ip}`).digest('hex');
}

// Mascara email para LGPD: "fr***@gmail.com" (mesmo padrão de routes/admin.ts)
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const masked = local.length > 2 ? local.slice(0, 2) + '***' : '***';
  return `${masked}@${domain}`;
}

/** Agrega estatísticas do afiliado (indicações + comissões, com corte D+30). */
async function buildAffiliateStats(affiliateId: string) {
  const [referrals, converted, commissions] = await Promise.all([
    prisma.affiliateReferral.count({ where: { affiliateId } }),
    prisma.affiliateReferral.count({ where: { affiliateId, status: 'converted' } }),
    prisma.affiliateCommission.findMany({
      where:  { affiliateId },
      select: { commissionAmount: true, status: true, createdAt: true },
    }),
  ]);

  const now = Date.now();
  const isReleased = (createdAt: Date) => now - createdAt.getTime() >= HOLD_MS;

  const pending = commissions.filter(c => c.status === 'pending');
  const availableAmount = pending.filter(c => isReleased(c.createdAt)).reduce((s, c) => s + c.commissionAmount, 0);
  const lockedAmount    = pending.filter(c => !isReleased(c.createdAt)).reduce((s, c) => s + c.commissionAmount, 0);
  const paidAmount = commissions
    .filter(c => c.status === 'paid')
    .reduce((s, c) => s + c.commissionAmount, 0);

  return {
    referrals,
    converted,
    totalCommissions: commissions.length,
    pendingAmount:    Math.round((availableAmount + lockedAmount) * 100) / 100, // total ainda não pago (liberado + em validação D+30)
    availableAmount:  Math.round(availableAmount * 100) / 100, // liberado para saque (D+30 já vencido)
    lockedAmount:     Math.round(lockedAmount * 100) / 100,    // em validação (D+30 ainda não vencido)
    paidAmount:       Math.round(paidAmount * 100) / 100,
  };
}

/** Quantos indicados este afiliado converteu no mês corrente (progresso rumo ao bônus de 50). */
async function countConversionsThisMonth(affiliateId: string): Promise<number> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return prisma.affiliateReferral.count({
    where: { affiliateId, status: 'converted', convertedAt: { gte: monthStart, lt: monthEnd } },
  });
}

export default async function affiliateRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any).authenticate] };

  // ── GET /affiliates/me — dados + estatísticas do afiliado atual ──────────
  app.get('/me', auth, async (req: any) => {
    const userId = req.user.sub;
    // Select explícito — evita referenciar colunas ausentes em caso de drift de migração
    const affiliate = await prisma.affiliate.findUnique({
      where:  { userId },
      select: {
        id: true, code: true, status: true,
        pixKey: true, pixKeyType: true, payoutName: true,
        rejectedReason: true, appliedAt: true, approvedAt: true,
      },
    });
    if (!affiliate) return { affiliate: null };

    const [stats, conversionsThisMonth, clicksTotal, clicksToday] = await Promise.all([
      buildAffiliateStats(affiliate.id),
      countConversionsThisMonth(affiliate.id),
      prisma.affiliateClick.count({ where: { affiliateId: affiliate.id } }).catch(() => 0),
      prisma.affiliateClick.count({
        where: { affiliateId: affiliate.id, createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
      }).catch(() => 0),
    ]);

    // Agregação de cliques nos últimos 30 dias (tolerante a migration drift)
    let clickHistory: { date: string; clicks: number }[] = [];
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const raw: any[] = await prisma.$queryRawUnsafe(
        `SELECT DATE(created_at) as date, COUNT(*)::int as clicks
         FROM "AffiliateClick"
         WHERE affiliate_id = $1 AND created_at >= $2
         GROUP BY 1 ORDER BY 1`,
        affiliate.id, thirtyDaysAgo,
      );
      clickHistory = (raw || []).map((r: any) => ({ date: r.date, clicks: Number(r.clicks) }));
    } catch { /* tabela pode não existir ainda */ }

    return {
      affiliate: {
        id:             affiliate.id,
        code:           affiliate.code,
        status:         affiliate.status,
        pixKey:         affiliate.pixKey,
        pixKeyType:     affiliate.pixKeyType,
        payoutName:     affiliate.payoutName,
        rejectedReason: affiliate.rejectedReason,
        appliedAt:      affiliate.appliedAt,
        approvedAt:     affiliate.approvedAt,
      },
      stats,
      rates: {
        baseRate:        COMMISSION.BASE_RATE,
        bonusRate:        COMMISSION.BONUS_RATE,
        residualRate:     COMMISSION.RESIDUAL_RATE,
        recurringMonths:  COMMISSION.RECURRING_MONTHS,
        bonusThreshold:   COMMISSION.BONUS_THRESHOLD,
        payoutHoldDays:   COMMISSION.PAYOUT_HOLD_DAYS,
      },
      progress: {
        conversionsThisMonth,
        bonusThreshold: COMMISSION.BONUS_THRESHOLD,
        bonusActive:    conversionsThisMonth >= COMMISSION.BONUS_THRESHOLD,
      },
      clicks: {
        total: clicksTotal,
        today: clicksToday,
        last30Days: clickHistory,
      },
    };
  });

  // ── POST /affiliates/apply — solicitar afiliação (status pending) ────────
  app.post<{ Body: {
    pixKey?: string; pixKeyType?: string;
    payoutName?: string; audience?: string; estimatedVolume?: string;
  } }>(
    '/apply',
    { ...auth, config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (req: any, reply) => {
      const userId = req.user.sub;
      const { pixKey, pixKeyType, payoutName, audience, estimatedVolume } = req.body || {};

      // Já existe? Não recriar — retornar o atual.
      const existing = await prisma.affiliate.findUnique({
        where:  { userId },
        select: { id: true, status: true },
      });
      if (existing) {
        return reply.code(409).send({
          error: 'Você já possui um cadastro de afiliado.',
          status: existing.status,
        });
      }

      if (pixKeyType && !VALID_PIX_TYPES.includes(pixKeyType)) {
        return reply.code(400).send({ error: 'Tipo de chave Pix inválido.' });
      }

      // Garantir código único (colisão é raríssima, mas tratamos)
      let code = genAffiliateCode();
      for (let i = 0; i < 5; i++) {
        const clash = await prisma.affiliate.findUnique({ where: { code }, select: { id: true } });
        if (!clash) break;
        code = genAffiliateCode();
      }

      const affiliate = await prisma.affiliate.create({
        data: {
          userId,
          code,
          status:         'pending',
          pixKey:         pixKey?.trim() || null,
          pixKeyType:     pixKeyType || null,
          payoutName:     payoutName?.trim() || null,
          audience:       audience?.trim() || null,
          // Quantidade estimada de indicações/mês (guardada em notes p/ avaliação do time)
          notes:          estimatedVolume?.trim()
            ? `Estimativa: ${estimatedVolume.trim().slice(0, 40)}/mês`
            : null,
        },
      });

      return reply.code(201).send({
        ok: true,
        affiliate: { id: affiliate.id, code: affiliate.code, status: affiliate.status },
        message: 'Cadastro enviado! Você receberá um aviso quando for aprovado.',
      });
    }
  );

  // ── PUT /affiliates/me — atualizar dados de pagamento ────────────────────
  app.put<{ Body: {
    pixKey?: string; pixKeyType?: string; payoutName?: string;
  } }>(
    '/me',
    auth,
    async (req: any, reply) => {
      const userId = req.user.sub;
      const affiliate = await prisma.affiliate.findUnique({
        where:  { userId },
        select: { id: true },
      });
      if (!affiliate) return reply.code(404).send({ error: 'Cadastro de afiliado não encontrado.' });

      const { pixKey, pixKeyType, payoutName } = req.body || {};
      if (pixKeyType && !VALID_PIX_TYPES.includes(pixKeyType)) {
        return reply.code(400).send({ error: 'Tipo de chave Pix inválido.' });
      }

      const data = {
        pixKey:     pixKey !== undefined ? (pixKey?.trim() || null) : undefined,
        pixKeyType: pixKeyType !== undefined ? (pixKeyType || null) : undefined,
        payoutName: payoutName !== undefined ? (payoutName?.trim() || null) : undefined,
      };

      const updated = await prisma.affiliate.update({ where: { userId }, data });
      return { ok: true, affiliate: { pixKey: updated.pixKey, pixKeyType: updated.pixKeyType, payoutName: updated.payoutName } };
    }
  );

  // ── POST /affiliates/me/payout-request — solicitar saque via Pix ─────────
  // Sem valor mínimo: qualquer saldo já liberado (D+30 desde a comissão) pode
  // ser sacado. O envio do Pix em si continua manual (admin confirma no painel).
  app.post(
    '/me/payout-request',
    { ...auth, config: { rateLimit: { max: 3, timeWindow: '1 hour' } } },
    async (req: any, reply) => {
      const userId = req.user.sub;
      const affiliate = await prisma.affiliate.findUnique({
        where:  { userId },
        select: { id: true, status: true, pixKey: true, pixKeyType: true, payoutName: true, code: true },
      });
      if (!affiliate) return reply.code(404).send({ error: 'Cadastro de afiliado não encontrado.' });
      if (affiliate.status !== 'approved') return reply.code(400).send({ error: 'Apenas afiliados aprovados podem solicitar saque.' });
      if (!affiliate.pixKey) return reply.code(400).send({ error: 'Cadastre sua chave Pix antes de solicitar o saque.' });

      const stats = await buildAffiliateStats(affiliate.id);
      if (stats.availableAmount <= 0) {
        return reply.code(400).send({
          error: stats.lockedAmount > 0
            ? `Seu saldo ainda está em validação (liberado 30 dias após cada comissão). Nada disponível para saque agora.`
            : 'Você ainda não tem saldo disponível para saque.',
        });
      }

      // Marca a data da solicitação (best-effort: tolera ambiente sem a coluna
      // payoutRequestedAt até a migração rodar — não deve bloquear o saque)
      try {
        await prisma.affiliate.update({
          where: { id: affiliate.id },
          data:  { payoutRequestedAt: new Date() },
        });
      } catch (err: any) {
        app.log.warn({ err: err?.message, affiliateId: affiliate.id }, '[Affiliates] payoutRequestedAt indisponível — seguindo sem marcar data');
      }

      // Notificar admin por e-mail (best-effort)
      const adminEmail = process.env.SUPPORT_EMAIL || process.env.SMTP_FROM?.replace(/.*<(.+)>/, '$1');
      if (adminEmail) {
        const APP_URL = process.env.APP_URL || 'https://zapscript.me';
        const amtFmt  = stats.availableAmount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        sendEmail(
          adminEmail,
          `[ZapScript] Solicitação de saque — ${affiliate.code} (${amtFmt})`,
          `<div style="font-family:sans-serif;max-width:540px;margin:0 auto;background:#050a07;color:#d1fae5;padding:32px;border-radius:12px">
            <div style="font-size:20px;font-weight:bold;margin-bottom:12px">💸 Solicitação de saque de afiliado</div>
            <p><strong>Código:</strong> ${affiliate.code}</p>
            <p><strong>Chave Pix:</strong> ${affiliate.pixKeyType?.toUpperCase()} — ${affiliate.pixKey}</p>
            <p><strong>Nome:</strong> ${affiliate.payoutName || '—'}</p>
            <p><strong>Saldo disponível:</strong> <span style="color:#10b981;font-size:18px">${amtFmt}</span></p>
            <div style="margin:24px 0;text-align:center">
              <a href="${APP_URL}/g5r8t2?tab=afiliados" style="background:#10b981;color:#04130c;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:bold">Ver no painel admin →</a>
            </div>
          </div>`,
        ).catch(() => {});
      }

      return { ok: true, message: 'Solicitação de saque registrada! O Pix é processado manualmente pela equipe em até alguns dias úteis.' };
    }
  );

  // ── GET /affiliates/leaderboard — top 10 do mês (público) ───────
  app.get('/leaderboard', async () => {
    try {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const top = await prisma.affiliateCommission.groupBy({
        by: ['affiliateId'],
        where: { createdAt: { gte: monthStart }, status: 'pending' },
        _sum: { commissionAmount: true },
        orderBy: { _sum: { commissionAmount: 'desc' } },
        take: 10,
      });
      const affiliateIds = top.map(t => t.affiliateId);
      const affiliates = affiliateIds.length
        ? await prisma.affiliate.findMany({ where: { id: { in: affiliateIds }, status: 'approved' }, select: { id: true, code: true } })
        : [];
      const byId = new Map(affiliates.map(a => [a.id, a]));
      // Anonimizar: "AFI****" + últimos 2 chars do code
      function maskCode(code: string): string {
        if (code.length <= 2) return 'AFI***';
        return `AFI***${code.slice(-2)}`;
      }
      return top.map((t, i) => ({
        position: i + 1,
        code: byId.get(t.affiliateId) ? maskCode(byId.get(t.affiliateId)!.code) : 'AFI***',
        totalCommissions: Math.round((t._sum.commissionAmount || 0) * 100) / 100,
      }));
    } catch { return []; }
  });

  // ── GET /affiliates/me/referrals — lista de indicados com status ──
  app.get('/me/referrals', auth, async (req: any) => {
    const userId = req.user.sub;
    const affiliate = await prisma.affiliate.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!affiliate) return { referrals: [] };

    const refs = await prisma.affiliateReferral.findMany({
      where: { affiliateId: affiliate.id },
      include: {
        referredUser: { select: { name: true, email: true, createdAt: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return {
      referrals: refs.map(r => ({
        id: r.id,
        name: r.referredUser?.name?.split(' ')[0] || 'Usuário',
        email: maskEmail(r.referredUser?.email || ''),
        status: r.status,         // 'pending' | 'converted' | 'canceled'
        bonusTier: r.bonusTier,
        convertedAt: r.convertedAt,
        createdAt: r.createdAt,
      })),
    };
  });

  // ── POST /affiliates/click — registra clique no link de afiliado (público) ──
  app.post('/click', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req: any, reply) => {
    const { code } = req.body || {};
    if (!code || typeof code !== 'string') return reply.code(400).send({ error: 'Código inválido' });

    try {
      const affiliate = await prisma.affiliate.findUnique({ where: { code }, select: { id: true, status: true } });
      if (!affiliate || affiliate.status !== 'approved') return reply.code(404).send({ error: 'Afiliado não encontrado' });

      const ip = typeof req.ip === 'string' ? req.ip : (req.socket?.remoteAddress || '');
      await prisma.affiliateClick.create({
        data: {
          affiliateId: affiliate.id,
          code,
          ip: ip ? hashIp(ip) : null,
          userAgent: (req.headers['user-agent'] as string)?.slice(0, 250) || null,
          referrer: (req.headers['referer'] as string)?.slice(0, 500) || null,
          country: (req.headers['x-vercel-ip-country'] as string) || null,
        },
      });
      return { ok: true };
    } catch (err: any) {
      if (err?.code === 'P2002' || err?.code === 'P2003') return { ok: true }; // duplicado ou FK inválida — silencioso
      app.log.warn({ err: err?.message }, '[Affiliates] Falha ao registrar clique');
      return { ok: true }; // nunca quebrar o fluxo do usuário
    }
  });

  // ── GET /affiliates/commissions — extrato de comissões do afiliado ───────
  app.get('/commissions', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const affiliate = await prisma.affiliate.findUnique({
      where:  { userId },
      select: { id: true },
    });
    if (!affiliate) return reply.code(404).send({ error: 'Cadastro de afiliado não encontrado.' });

    const commissions = await prisma.affiliateCommission.findMany({
      where:   { affiliateId: affiliate.id },
      orderBy: { createdAt: 'desc' },
      take:    200,
      select: {
        id: true, referredUserId: true, saleAmount: true, commissionAmount: true,
        commissionType: true, monthIndex: true, status: true,
        paidAt: true, createdAt: true,
      },
    });

    // Identificação do cliente mascarada (LGPD) — primeiro nome + e-mail parcial.
    const userIds = [...new Set(commissions.map(c => c.referredUserId))];
    const users = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
      : [];
    const userById = new Map(users.map(u => [u.id, u]));

    const now = Date.now();
    return {
      commissions: commissions.map(c => {
        const u = userById.get(c.referredUserId);
        const rateFraction = c.saleAmount > 0 ? c.commissionAmount / c.saleAmount : 0;
        return {
          id:               c.id,
          cliente:          u ? `${(u.name || 'Cliente').trim().split(' ')[0]} — ${maskEmail(u.email)}` : 'Cliente',
          saleAmount:       c.saleAmount,
          commissionAmount: c.commissionAmount,
          ratePercent:      Math.round(rateFraction * 100),
          bonus:            Math.abs(rateFraction - COMMISSION.BONUS_RATE) < 0.01,
          commissionType:   c.commissionType,
          monthIndex:       c.monthIndex,
          status:           c.status,
          available:        c.status === 'pending' && (now - c.createdAt.getTime()) >= HOLD_MS,
          paidAt:           c.paidAt,
          createdAt:        c.createdAt,
        };
      }),
    };
  });
}
