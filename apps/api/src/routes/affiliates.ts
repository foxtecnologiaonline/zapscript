import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { genAffiliateCode, COMMISSION } from '../lib/affiliate';
import { sendEmail } from '../lib/mailer';

const PAYOUT_MIN = 50; // R$50 mínimo para solicitar saque

/* ─────────────────────────────────────────────────────────
   Programa de Afiliados — rotas self-service (JWT)
   Painel admin (aprovação/payout) fica em routes/admin.ts
   ───────────────────────────────────────────────────────── */

const VALID_COMMISSION_TYPES = ['onetime', 'recurring'];
const VALID_PIX_TYPES = ['cpf', 'cnpj', 'email', 'phone', 'random'];

/** Agrega estatísticas do afiliado (indicações + comissões). */
async function buildAffiliateStats(affiliateId: string) {
  const [referrals, converted, commissions] = await Promise.all([
    prisma.affiliateReferral.count({ where: { affiliateId } }),
    prisma.affiliateReferral.count({ where: { affiliateId, status: 'converted' } }),
    prisma.affiliateCommission.findMany({
      where:  { affiliateId },
      select: { commissionAmount: true, status: true },
    }),
  ]);

  const pendingAmount = commissions
    .filter(c => c.status === 'pending')
    .reduce((s, c) => s + c.commissionAmount, 0);
  const paidAmount = commissions
    .filter(c => c.status === 'paid')
    .reduce((s, c) => s + c.commissionAmount, 0);

  return {
    referrals,
    converted,
    totalCommissions: commissions.length,
    pendingAmount: Math.round(pendingAmount * 100) / 100,
    paidAmount:    Math.round(paidAmount * 100) / 100,
  };
}

export default async function affiliateRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any).authenticate] };

  // ── GET /affiliates/me — dados + estatísticas do afiliado atual ──────────
  app.get('/me', auth, async (req: any) => {
    const userId = req.user.sub;
    const affiliate = await prisma.affiliate.findUnique({ where: { userId } });
    if (!affiliate) return { affiliate: null };

    const stats = await buildAffiliateStats(affiliate.id);
    return {
      affiliate: {
        id:             affiliate.id,
        code:           affiliate.code,
        status:         affiliate.status,
        commissionType: affiliate.commissionType,
        pixKey:         affiliate.pixKey,
        pixKeyType:     affiliate.pixKeyType,
        payoutName:     affiliate.payoutName,
        rejectedReason: affiliate.rejectedReason,
        appliedAt:      affiliate.appliedAt,
        approvedAt:     affiliate.approvedAt,
      },
      stats,
      rates: {
        monthlyRate: COMMISSION.MONTHLY_RATE,
        yearlyRate:  COMMISSION.YEARLY_RATE,
        payoutDays:  COMMISSION.PAYOUT_DAYS,
      },
    };
  });

  // ── POST /affiliates/apply — solicitar afiliação (status pending) ────────
  app.post<{ Body: {
    commissionType?: string; pixKey?: string; pixKeyType?: string;
    payoutName?: string; audience?: string;
  } }>(
    '/apply',
    { ...auth, config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (req: any, reply) => {
      const userId = req.user.sub;
      const { commissionType, pixKey, pixKeyType, payoutName, audience } = req.body || {};

      // Já existe? Não recriar — retornar o atual.
      const existing = await prisma.affiliate.findUnique({ where: { userId } });
      if (existing) {
        return reply.code(409).send({
          error: 'Você já possui um cadastro de afiliado.',
          status: existing.status,
        });
      }

      if (commissionType && !VALID_COMMISSION_TYPES.includes(commissionType)) {
        return reply.code(400).send({ error: 'Modelo de comissão inválido.' });
      }
      if (pixKeyType && !VALID_PIX_TYPES.includes(pixKeyType)) {
        return reply.code(400).send({ error: 'Tipo de chave Pix inválido.' });
      }

      // Garantir código único (colisão é raríssima, mas tratamos)
      let code = genAffiliateCode();
      for (let i = 0; i < 5; i++) {
        const clash = await prisma.affiliate.findUnique({ where: { code } });
        if (!clash) break;
        code = genAffiliateCode();
      }

      const affiliate = await prisma.affiliate.create({
        data: {
          userId,
          code,
          status:         'pending',
          commissionType: 'onetime', // modelo único: 50% mensal ou 20% anual
          pixKey:         pixKey?.trim() || null,
          pixKeyType:     pixKeyType || null,
          payoutName:     payoutName?.trim() || null,
          audience:       audience?.trim() || null,
        },
      });

      return reply.code(201).send({
        ok: true,
        affiliate: { id: affiliate.id, code: affiliate.code, status: affiliate.status },
        message: 'Cadastro enviado! Você receberá um aviso quando for aprovado.',
      });
    }
  );

  // ── PUT /affiliates/me — atualizar dados de pagamento / modelo ───────────
  app.put<{ Body: {
    commissionType?: string; pixKey?: string; pixKeyType?: string; payoutName?: string;
  } }>(
    '/me',
    auth,
    async (req: any, reply) => {
      const userId = req.user.sub;
      const affiliate = await prisma.affiliate.findUnique({ where: { userId } });
      if (!affiliate) return reply.code(404).send({ error: 'Cadastro de afiliado não encontrado.' });

      const { commissionType, pixKey, pixKeyType, payoutName } = req.body || {};
      if (commissionType && !VALID_COMMISSION_TYPES.includes(commissionType)) {
        return reply.code(400).send({ error: 'Modelo de comissão inválido.' });
      }
      if (pixKeyType && !VALID_PIX_TYPES.includes(pixKeyType)) {
        return reply.code(400).send({ error: 'Tipo de chave Pix inválido.' });
      }

      // O modelo de comissão só pode mudar enquanto não houver comissões geradas
      let data: any = {
        pixKey:     pixKey !== undefined ? (pixKey?.trim() || null) : undefined,
        pixKeyType: pixKeyType !== undefined ? (pixKeyType || null) : undefined,
        payoutName: payoutName !== undefined ? (payoutName?.trim() || null) : undefined,
      };
      if (commissionType && commissionType !== affiliate.commissionType) {
        const hasCommissions = await prisma.affiliateCommission.count({ where: { affiliateId: affiliate.id } });
        if (hasCommissions > 0) {
          return reply.code(400).send({ error: 'Não é possível mudar o modelo de comissão após já ter comissões registradas.' });
        }
        data.commissionType = commissionType;
      }

      const updated = await prisma.affiliate.update({ where: { userId }, data });
      return { ok: true, affiliate: { commissionType: updated.commissionType, pixKey: updated.pixKey, pixKeyType: updated.pixKeyType, payoutName: updated.payoutName } };
    }
  );

  // ── POST /affiliates/me/payout-request — solicitar saque via Pix ─────────
  app.post(
    '/me/payout-request',
    { ...auth, config: { rateLimit: { max: 3, timeWindow: '1 hour' } } },
    async (req: any, reply) => {
      const userId = req.user.sub;
      const affiliate = await prisma.affiliate.findUnique({ where: { userId } });
      if (!affiliate) return reply.code(404).send({ error: 'Cadastro de afiliado não encontrado.' });
      if (affiliate.status !== 'approved') return reply.code(400).send({ error: 'Apenas afiliados aprovados podem solicitar saque.' });
      if (!affiliate.pixKey) return reply.code(400).send({ error: 'Cadastre sua chave Pix antes de solicitar o saque.' });

      const stats = await buildAffiliateStats(affiliate.id);
      if (stats.pendingAmount < PAYOUT_MIN) {
        return reply.code(400).send({
          error: `Saldo mínimo para saque é R$${PAYOUT_MIN.toFixed(2)}. Seu saldo atual é R$${stats.pendingAmount.toFixed(2)}.`,
        });
      }

      await prisma.affiliate.update({
        where: { id: affiliate.id },
        data:  { payoutRequestedAt: new Date() },
      });

      // Notificar admin por e-mail (best-effort)
      const adminEmail = process.env.SUPPORT_EMAIL || process.env.SMTP_FROM?.replace(/.*<(.+)>/, '$1');
      if (adminEmail) {
        const APP_URL = process.env.APP_URL || 'https://zapscript.me';
        const amtFmt  = stats.pendingAmount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        sendEmail(
          adminEmail,
          `[ZapScript] Solicitação de saque — ${affiliate.code} (${amtFmt})`,
          `<div style="font-family:sans-serif;max-width:540px;margin:0 auto;background:#050a07;color:#d1fae5;padding:32px;border-radius:12px">
            <div style="font-size:20px;font-weight:bold;margin-bottom:12px">💸 Solicitação de saque de afiliado</div>
            <p><strong>Código:</strong> ${affiliate.code}</p>
            <p><strong>Chave Pix:</strong> ${affiliate.pixKeyType?.toUpperCase()} — ${affiliate.pixKey}</p>
            <p><strong>Nome:</strong> ${affiliate.payoutName || '—'}</p>
            <p><strong>Saldo pendente:</strong> <span style="color:#10b981;font-size:18px">${amtFmt}</span></p>
            <div style="margin:24px 0;text-align:center">
              <a href="${APP_URL}/g5r8t2?tab=afiliados" style="background:#10b981;color:#04130c;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:bold">Ver no painel admin →</a>
            </div>
          </div>`,
        ).catch(() => {});
      }

      return { ok: true, message: 'Solicitação de saque registrada! Você receberá o Pix até o dia 15 do próximo mês.' };
    }
  );

  // ── GET /affiliates/commissions — extrato de comissões do afiliado ───────
  app.get('/commissions', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const affiliate = await prisma.affiliate.findUnique({ where: { userId } });
    if (!affiliate) return reply.code(404).send({ error: 'Cadastro de afiliado não encontrado.' });

    const commissions = await prisma.affiliateCommission.findMany({
      where:   { affiliateId: affiliate.id },
      orderBy: { createdAt: 'desc' },
      take:    100,
      select: {
        id: true, saleAmount: true, commissionAmount: true,
        commissionType: true, monthIndex: true, status: true,
        paidAt: true, createdAt: true,
      },
    });
    return { commissions };
  });
}
