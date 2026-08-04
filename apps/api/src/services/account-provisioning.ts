/**
 * account-provisioning.ts
 *
 * Criação de conta passwordless (senha aleatória gerada no servidor, usuário
 * nunca digita) — extraído do core de POST /auth/magic-register
 * (apps/api/src/routes/auth.ts) para ser reaproveitado também pelo onboarding
 * conversacional via WhatsApp (número oficial), onde não faz sentido pedir
 * senha num chat. Consentimento LGPD é registrado com timestamp único no
 * momento da criação — quem chama garante que o usuário já consentiu (ex.:
 * respondeu "SIM" a um pedido explícito de aceite).
 */
import { createClient } from '@supabase/supabase-js';
import { prisma } from '../lib/prisma';
import { sendEmail, emailWrapper } from '../lib/mailer';
import { logger } from '../lib/logger';
import { FREE_AUDIO_QUOTA } from '../lib/freemium';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const APP_URL = process.env.APP_URL || 'https://zapscript.me';

export interface CreatePasswordlessAccountInput {
  email: string;
  name?: string | null;
  phone?: string | null;
  referralCode?: string | null;
  inviteCode?: string | null;
  sendWelcomeEmail?: boolean; // default true
}

export type CreatePasswordlessAccountResult =
  | { ok: true; userId: string; alreadyExisted: false }
  | { ok: true; alreadyExisted: true } // e-mail já existia — magic link de acesso reenviado
  | { ok: false; error: string };

/**
 * Cria uma conta Free sem senha (Supabase + User/Subscription/MinuteBalance)
 * e envia um magic link de acesso por e-mail. Se o e-mail já existir, reenvia
 * o magic link sem vazar a existência da conta (mesmo comportamento do
 * magic-register original).
 */
export async function createPasswordlessAccount(
  input: CreatePasswordlessAccountInput
): Promise<CreatePasswordlessAccountResult> {
  const normalizedEmail = input.email.toLowerCase().trim();
  const name = input.name?.trim() || normalizedEmail.split('@')[0];

  const existing = await prisma.user.findUnique({
    where:  { email: normalizedEmail },
    select: { id: true },
  });
  if (existing) {
    try {
      const { data: linkData } = await supabase.auth.admin.generateLink({
        type:    'magiclink',
        email:   normalizedEmail,
        options: { redirectTo: `${APP_URL}/dashboard` },
      });
      if (linkData?.properties?.action_link) {
        await sendEmail(
          normalizedEmail,
          'Seu link de acesso ao ZapScript',
          emailWrapper('⚡', 'Acesse o ZapScript', `
            <p style="color:#b8d4c8;font-size:15px;line-height:1.7;margin:0 0 6px">
              Você já tem uma conta no ZapScript. Clique abaixo para acessar:
            </p>
            <div style="text-align:center;margin:24px 0">
              <a href="${linkData.properties.action_link}"
                 style="display:inline-block;background:#10b981;color:#fff;padding:16px 48px;border-radius:12px;text-decoration:none;font-weight:700;font-size:16px">
                Entrar no ZapScript →
              </a>
            </div>
          `, 'Se você não solicitou este link, pode ignorar com segurança.'),
        ).catch(() => {});
      }
    } catch (err: any) {
      logger.warn(`[AccountProvisioning] magic link p/ conta existente falhou: ${err.message}`);
    }
    return { ok: true, alreadyExisted: true };
  }

  let testerInvite: any = null;
  if (input.inviteCode) {
    testerInvite = await prisma.testerInvite.findFirst({
      where: { code: input.inviteCode, usedAt: null },
    });
  }

  const referrer = input.referralCode
    ? await prisma.user.findUnique({ where: { refCode: input.referralCode }, select: { id: true } })
    : null;

  const { randomUUID } = await import('node:crypto');
  const randomPassword = randomUUID() + randomUUID();
  const { data, error } = await supabase.auth.admin.createUser({
    email:        normalizedEmail,
    password:     randomPassword,
    email_confirm: true, // magic link serve como confirmação
    user_metadata: { name },
  });
  if (error || !data?.user) {
    logger.error(`[AccountProvisioning] Supabase createUser falhou: ${error?.message}`);
    return { ok: false, error: 'Erro ao criar conta. Tente novamente.' };
  }

  const now = new Date();
  const userId = data.user.id;

  try {
    await prisma.$transaction(async (tx: any) => {
      await tx.user.create({
        data: {
          id:             userId,
          email:          normalizedEmail,
          name,
          phone:          input.phone?.trim() || undefined,
          refCode:        userId.slice(0, 8),
          emailVerified:  true, // magic link já confirma
          termsAcceptedAt:         now,
          contractAcceptedAt:      now,
          privacyPolicyAcceptedAt: now,
          consentDocVersion:       'tos_v2.0,contrato_v2.0,pp_v2.0',
          ...(referrer ? { referredBy: referrer.id } : {}),
        },
      });

      const plan = testerInvite
        ? await tx.plan.findFirst({ where: { name: 'pro-tester' } })
        : await tx.plan.findFirst({ where: { name: 'free' } });

      if (!plan) throw new Error('Plano não encontrado');

      await tx.subscription.create({
        data: {
          userId,
          planId:           plan.id,
          status:           'active',
          currentPeriodEnd: undefined,
        },
      });

      const cycleResetAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      await tx.minuteBalance.create({
        data: {
          userId,
          audiosUsed:       referrer ? -5 : 0, // 5 extras para indicado
          availableMinutes: plan.minutesPerMonth,
          resetAt:          cycleResetAt,
        } as any,
      });

      if (testerInvite) {
        await tx.testerInvite.update({
          where: { id: testerInvite.id },
          data:  { usedAt: now, usedBy: userId },
        });
      }
    });
  } catch (txErr: any) {
    await supabase.auth.admin.deleteUser(userId).catch(() => {});
    return { ok: false, error: 'Erro ao criar conta. Tente novamente.' };
  }

  if (input.sendWelcomeEmail !== false) {
    try {
      const { data: linkData } = await supabase.auth.admin.generateLink({
        type:    'magiclink',
        email:   normalizedEmail,
        options: { redirectTo: `${APP_URL}/dashboard` },
      });
      if (linkData?.properties?.action_link) {
        const firstName = name.split(/[@\s]/)[0];
        await sendEmail(
          normalizedEmail,
          `Bem-vindo ao ZapScript, ${firstName}!`,
          emailWrapper('🎉', 'Sua conta está pronta!', `
            <p style="color:#b8d4c8;font-size:15px;line-height:1.7;margin:0 0 12px">
              Olá, <strong>${firstName}</strong>! Sua conta gratuita foi criada.
            </p>
            <p style="color:#7aa898;font-size:14px;line-height:1.6;margin:0 0 28px">
              Clique no botão abaixo para acessar seu painel:
            </p>
            <div style="text-align:center;margin:24px 0">
              <a href="${linkData.properties.action_link}"
                 style="display:inline-block;background:#10b981;color:#fff;padding:16px 48px;border-radius:12px;text-decoration:none;font-weight:700;font-size:16px">
                Acessar meu painel →
              </a>
            </div>
            <p style="color:#4a7060;font-size:12px;text-align:center;margin:16px 0 0;line-height:1.6">
              Você tem <strong>${FREE_AUDIO_QUOTA} áudios grátis por mês</strong> para começar (sem cartão).
            </p>
          `, 'Se você não criou esta conta, pode ignorar este e-mail com segurança.'),
        ).catch(() => {});
      }
    } catch (err: any) {
      logger.warn(`[AccountProvisioning] e-mail de boas-vindas falhou: ${err.message}`);
    }
  }

  logger.info(`[AccountProvisioning] Conta criada: ${normalizedEmail} (userId=${userId})`);
  return { ok: true, userId, alreadyExisted: false };
}
