import { FastifyInstance } from 'fastify';
import { createClient } from '@supabase/supabase-js';
import { prisma } from '../lib/prisma';
import { sendEmail, emailWrapper } from '../lib/mailer';
import { logger } from '../lib/logger';
import { validateRequest, registerSchema, loginSchema } from '../lib/validation';
import { encryptStr, decryptStr, documentHash as computeDocHash } from '../services/encryption';
import { createPasswordlessAccount } from '../services/account-provisioning';
import { provisionInstance, requestPairingCode } from '../services/number-provisioning';
import { startFromSiteSignup } from '../services/onboarding-whatsapp';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const APP_URL = process.env.APP_URL || 'https://zapscript.me';

/** Escapa caracteres HTML para evitar injeção em templates de e-mail (C1) */
function escHtml(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/**
 * Envia o e-mail de verificação (link mágico próprio).
 * O link aponta para /verificar-email?token=<JWT purpose:verify-email>; ao abrir,
 * o front chama POST /auth/verify-email e marca emailVerified=true.
 * Best-effort: nunca derruba o fluxo de cadastro se o envio falhar.
 */
async function sendVerificationEmail(email: string, name: string | null | undefined, confirmLink: string) {
  await sendEmail(
    email,
    'Confirme seu e-mail — ZapScript',
    emailWrapper('✉️', 'Confirme seu e-mail', `
      <p style="color:#b8d4c8;font-size:15px;line-height:1.7;margin:0 0 8px">
        Olá${name ? `, <strong style="color:#6ee7b7">${escHtml(name)}</strong>` : ''}!
      </p>
      <p style="color:#b8d4c8;font-size:15px;line-height:1.7;margin:0 0 6px">
        Sua conta já está ativa e você pode usar o ZapScript agora mesmo.
        Confirme seu e-mail para liberar a <strong style="color:#6ee7b7">assinatura de planos pagos</strong>.
      </p>

      <div style="text-align:center;margin:24px 0">
        <a href="${confirmLink}"
           style="display:inline-block;background:#10b981;color:#ffffff;padding:16px 48px;border-radius:12px;text-decoration:none;font-weight:700;font-size:16px;letter-spacing:0.2px;box-shadow:0 4px 24px rgba(16,185,129,.35)">
          ✅ Confirmar meu e-mail
        </a>
      </div>

      <p style="color:#4a7060;font-size:12px;text-align:center;margin:0 0 24px;line-height:1.6">
        Botão não funcionou? Cole este link no navegador:<br>
        <a href="${confirmLink}" style="color:rgba(16,185,129,.65);word-break:break-all;font-size:11px">${confirmLink}</a>
      </p>

      <div style="background:rgba(16,185,129,.06);border:1px solid rgba(16,185,129,.12);border-radius:12px;padding:16px 20px">
        <p style="color:#4a7060;font-size:12px;margin:0;line-height:1.5">
          ⏰ <strong style="color:#5d8a72">Este link expira em 7 dias.</strong>
          Sua conta já vem com <strong style="color:#5d8a72">7 dias de Pro grátis</strong> (áudios ilimitados), sem cartão de crédito.
        </p>
      </div>
    `, 'Se você não criou uma conta no ZapScript, pode ignorar este e-mail com segurança.')
  );
}

export default async function authRoutes(app: FastifyInstance) {

  // ── POST /auth/register ───────────────────────────────────────────────────
  app.post<{ Body: {
    email: string; password: string; name?: string; phone: string; inviteCode?: string;
    referralCode?: string; affiliateCode?: string;
    cbTos?: boolean; cbContrato?: boolean; cbLgpd?: boolean; cbMarketing?: boolean; docVersion?: string;
    utmSource?: string; utmCampaign?: string; utmMedium?: string;
  } }>(
    '/register',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      // Validação Zod (formato/tamanho de campos)
      const v = validateRequest(registerSchema)(req.body);
      if (!v.valid) return reply.code(400).send({ error: v.error });

      const { email, password, name, phone, inviteCode, referralCode, affiliateCode, cbTos, cbContrato, cbLgpd, cbMarketing, docVersion, utmSource, utmCampaign, utmMedium } = req.body;
      if (!email || !password) return reply.code(400).send({ error: 'email e password obrigatórios' });
      // Validar consentimentos obrigatórios (LGPD Art. 8º §1º)
      if (!cbTos)      return reply.code(400).send({ error: 'Aceite dos Termos de Serviço é obrigatório.' });
      if (!cbContrato) return reply.code(400).send({ error: 'Aceite do Contrato de Prestação é obrigatório.' });
      if (!cbLgpd)     return reply.code(400).send({ error: 'Autorização de tratamento de dados (LGPD) é obrigatória.' });

      // Verificar duplicata de e-mail
      const existingEmail = await prisma.user.findUnique({ where: { email } });
      if (existingEmail) return reply.code(400).send({ error: 'E-mail já cadastrado. Faça login.', redirect: '/login' });

      // Validar convite de Tester se fornecido
      let testerInvite: any = null;
      if (inviteCode) {
        testerInvite = await (prisma as any).testerInvite.findUnique({ where: { code: inviteCode } });
        if (!testerInvite || testerInvite.usedAt) {
          return reply.code(400).send({ error: 'Código de convite inválido ou já utilizado.' });
        }
        if (testerInvite.expiresAt && new Date(testerInvite.expiresAt) < new Date()) {
          return reply.code(400).send({ error: 'Código de convite expirado. Solicite um novo.' });
        }
      }

      // Verificar referral code (se fornecido)
      let referrer: any = null;
      if (referralCode) {
        referrer = await prisma.user.findUnique({ where: { refCode: referralCode }, select: { id: true } });
        // Referral inválido: não bloquear o cadastro, apenas ignorar
        if (!referrer) logger.warn(`[Auth] referralCode inválido: ${referralCode}`);
      }

      // Verificar código de afiliado (?ref=CODE) — vínculo monetário separado da indicação amigável.
      // Registramos o vínculo independente do status do afiliado; a comissão só é gerada
      // no pagamento se o afiliado estiver aprovado (ver lib/affiliate.ts).
      let affiliate: any = null;
      if (affiliateCode) {
        affiliate = await prisma.affiliate.findUnique({
          where:  { code: affiliateCode.trim().toUpperCase() },
          select: { id: true, userId: true, status: true },
        });
        if (!affiliate) logger.warn(`[Auth] affiliateCode inválido: ${affiliateCode}`);
        else if (affiliate.status === 'rejected') affiliate = null; // afiliado recusado não atribui
      }

      // Auto-login (Opção A): autoconfirma no Supabase apenas para liberar o
      // signInWithPassword; a verificação REAL de posse do e-mail é controlada
      // por User.emailVerified (Prisma) e exigida só no momento da assinatura.
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error) return reply.code(400).send({ error: error.message });

      // Sem trial: usuário comum entra direto no Free/Core.
      //  • Tester      → PRO permanente (isTester, isenção 12 meses via testerRenewalsUsed)
      //  • Não-tester  → Free, ativo, sem período de teste.
      const plan = await prisma.plan.findUnique({ where: { name: testerInvite ? 'pro' : 'free' } });
      if (!plan) return reply.code(500).send({ error: 'Planos não configurados. Rode o seed.' });

      const now = new Date();
      const phoneDigits = phone!.replace(/\D/g, '');
      const cleanPhone  = phoneDigits.startsWith('55') ? phoneDigits : `55${phoneDigits}`;
      let numberId: string | undefined;

      // Criar User + Subscription + MinuteBalance em transação atômica
      // Se falhar: rollback do usuário Supabase para evitar conta órfã (autenticada mas sem dados)
      try {
        await prisma.$transaction(async (tx: any) => {
          // Indicação: ambos (indicador e novo usuário) ganham 5 áudios extras no ciclo atual.
          // No modelo por áudios, o bônus é creditado abatendo audiosUsed (devolve cota do ciclo).
          const REFERRAL_BONUS_AUDIOS = 5;

          const u = await tx.user.create({
            data: {
              id: data.user!.id,
              email,
              name,
              phone:                   phone?.trim() || undefined,
              referredBy:              referrer ? referrer.id : undefined,
              isTester:                !!testerInvite,
              testerSince:             testerInvite ? now : undefined,
              // LGPD — registro de consentimentos (Art. 8º §2º)
              termsAcceptedAt:         cbTos      ? now : undefined,
              contractAcceptedAt:      cbContrato ? now : undefined,
              privacyPolicyAcceptedAt: cbLgpd     ? now : undefined,
              marketingConsentAt:      cbMarketing ? now : undefined,
              consentDocVersion:       docVersion || 'tos_v2.0,contrato_v2.0,pp_v2.0',
              utmSource:               utmSource?.trim()   || undefined,
              utmCampaign:             utmCampaign?.trim() || undefined,
              utmMedium:               utmMedium?.trim()   || undefined,
            },
          });
          await tx.subscription.create({
            data: {
              userId:          u.id,
              planId:          plan.id,
              // Tester = PRO ativo permanente; não-tester = Free ativo (sem trial).
              status:          'active',
              // Tester e free seguem ciclo mensal — renovação a partir de balance.resetAt
              // (a isenção do tester é controlada por testerRenewalsUsed, máx 12 renovações)
              currentPeriodEnd: undefined,
            },
          });
          // resetAt ancorando no createdAt do usuário (ciclos de 30 dias a partir do cadastro)
          // Tester e free seguem o MESMO ciclo mensal — a isenção do tester (12 meses)
          // é controlada pelo contador testerRenewalsUsed no cron de renovação.
          // O bônus de indicação abate audiosUsed (cota do ciclo); reseta no próximo ciclo.
          const cycleResetAt = new Date(u.createdAt.getTime() + 30 * 24 * 60 * 60 * 1000);
          await tx.minuteBalance.create({
            data: {
              userId:           u.id,
              audiosUsed:       referrer ? -REFERRAL_BONUS_AUDIOS : 0,
              availableMinutes: plan.minutesPerMonth,
              resetAt:          cycleResetAt,
            } as any,
          });
          // Indicador também ganha 5 áudios extras no ciclo atual
          if (referrer) {
            await tx.minuteBalance.update({
              where: { userId: referrer.id },
              data:  { audiosUsed: { decrement: REFERRAL_BONUS_AUDIOS } } as any,
            });
          }
          // Marcar convite como usado
          if (testerInvite) {
            await tx.testerInvite.update({
              where: { id: testerInvite.id },
              data:  { usedAt: now, usedBy: u.id },
            });
          }
          // Vínculo de afiliado (sem auto-indicação)
          if (affiliate && affiliate.userId !== u.id) {
            await tx.affiliateReferral.create({
              data: { affiliateId: affiliate.id, referredUserId: u.id, status: 'pending' },
            });
          }
          // Número do próprio usuário, já com o telefone do cadastro — deixa a
          // conexão (pairing code) pronta para aparecer no painel + WhatsApp
          // assim que a transação terminar (ver provisionamento logo abaixo).
          const firstName = (name ?? 'Meu').split(' ')[0];
          const number = await tx.whatsappNumber.create({
            data: { userId: u.id, displayName: `${firstName} 1`, phoneNumber: cleanPhone, privateMode: false },
          });
          numberId = number.id;
        });
      } catch (txErr: any) {
        // Classificar a falha. Erros transitórios/infra (banco indisponível, migração
        // pendente, timeout de pool) NÃO indicam dados inválidos — o cadastro pode ser
        // retentado. Distinguir disso evita um 500 genérico durante um incidente de banco.
        const errCode = txErr?.code as string | undefined;
        const TRANSIENT_DB_ERRORS = ['P1001', 'P1002', 'P1008', 'P1011', 'P1017', 'P2022', 'P2024', 'P2028', 'P2034'];
        const isTransient = !!errCode && TRANSIENT_DB_ERRORS.includes(errCode);

        logger.error(`[Auth] Transação Prisma falhou para ${email}: code=${errCode} msg=${txErr?.message}. Revertendo conta Supabase recém-criada...`);

        // Rollback da conta recém-criada (sem dados): evita conta autenticável e órfã.
        // É a conta DESTE cadastro que não completou — nunca uma conta existente.
        // Se o delete falhar, logamos CRÍTICO com id+email para reconciliação manual
        // (a conta pode ser recuperada via "Esqueci minha senha" ou removida no painel).
        const rolledBack = await supabase.auth.admin.deleteUser(data.user!.id)
          .then(() => true)
          .catch((delErr: any) => {
            logger.error(`[Auth] CRÍTICO: conta Supabase órfã NÃO removida — id=${data.user!.id} email=${email}: ${delErr.message}`);
            return false;
          });

        if (isTransient) {
          // 503 retornável: deixa claro que a conta NÃO foi criada e que basta tentar de novo.
          return reply.code(503).send({
            error: 'Estamos com instabilidade momentânea e sua conta não foi criada. Tente novamente em alguns instantes.',
            retryable: true,
          });
        }
        return reply.code(500).send({
          error: rolledBack
            ? 'Erro ao criar conta. Tente novamente em instantes.'
            : 'Erro ao criar conta. Se já recebeu algum e-mail nosso, use "Esqueci minha senha"; caso contrário, tente novamente.',
        });
      }

      // Enviar e-mail de verificação (link mágico próprio, token JWT purpose:verify-email)
      try {
        const verifyToken = app.jwt.sign(
          { sub: data.user!.id, email, purpose: 'verify-email' },
          { expiresIn: '7d' },
        );
        const confirmLink = `${APP_URL}/verificar-email?token=${encodeURIComponent(verifyToken)}`;
        logger.info(`[Auth] Enviando e-mail de verificação para ${email}`);
        await sendVerificationEmail(email, name, confirmLink);

        // E-mail de boas-vindas / ativação (best-effort, separado do de verificação)
        const firstName = name?.split(' ')[0] || 'parceiro(a)';
        sendEmail(
          email,
          `Bem-vindo ao ZapScript, ${firstName}! Conecte seu WhatsApp agora`,
          `<div style="font-family:'DM Sans',sans-serif;max-width:540px;margin:0 auto;background:#050a07;color:#d1fae5;padding:32px;border-radius:16px;border:1px solid rgba(16,185,129,.15)">
            <div style="font-size:28px;font-weight:900;color:#10b981;margin-bottom:8px">⚡ ZapScript</div>
            <h1 style="font-size:22px;font-weight:700;color:#fff;margin:0 0 12px">Sua conta está pronta, ${firstName}!</h1>
            <p style="color:#a7f3d0;line-height:1.7;margin:0 0 16px">Falta 1 passo para ligar seu <strong style="color:#6ee7b7">robô particular, que converte e resume cada áudio do WhatsApp 24 horas por dia</strong> — mesmo enquanto você dorme. Conectar leva menos de 2 minutos.</p>
            <p style="color:#6ee7b7;line-height:1.6;margin:0 0 20px;font-size:13px">🔒 Criptografia AES-256 · servidores no Brasil (LGPD) · cancele quando quiser.</p>
            <div style="background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.2);border-radius:12px;padding:20px;margin-bottom:24px">
              <p style="margin:0 0 12px;font-weight:600;color:#fff">Já deixamos tudo pronto:</p>
              <p style="margin:0;color:#a7f3d0;font-size:14px">Você já recebeu (ou vai receber em instantes) um código de conexão no seu WhatsApp — é só digitar em <strong>Aparelhos conectados → Conectar um aparelho</strong> e pronto! 🎉</p>
            </div>
            <div style="text-align:center;margin-bottom:24px">
              <a href="${APP_URL}/dashboard/numeros" style="display:inline-block;background:#10b981;color:#04130c;padding:14px 36px;border-radius:12px;text-decoration:none;font-weight:800;font-size:16px">Conectar meu WhatsApp →</a>
            </div>
            <p style="color:#6b7280;font-size:12px;text-align:center">Dúvidas? Responda este e-mail ou fale em <a href="mailto:suporte@zapscript.me" style="color:#10b981">suporte@zapscript.me</a></p>
          </div>`,
        ).catch(() => {});
      } catch (err: any) {
        // Não falhar o cadastro se o envio de e-mail falhar — o usuário já está logado
        logger.error(`[Auth] Erro ao enviar e-mail de verificação: ${err.message}`);
      }

      // ── Onboarding facilitado: provisiona a instância + pairing code ANTES
      // de responder (o painel já abre com o código pronto), e dispara o
      // mesmo código por WhatsApp em paralelo — não é fallback, é o mesmo
      // convite chegando por dois canais ao mesmo tempo.
      let pairingCode: string | null = null;
      if (numberId) {
        const provision = await provisionInstance(numberId, logger).catch((err: any) => {
          logger.warn(`[Auth] provisionInstance falhou no cadastro (número ${numberId}): ${err.message}`);
          return { ok: false as const, message: err.message };
        });
        if (provision.ok) {
          const pairing = await requestPairingCode(numberId, cleanPhone, logger).catch((err: any) => {
            logger.warn(`[Auth] requestPairingCode falhou no cadastro (número ${numberId}): ${err.message}`);
            return { ok: false as const, error: err.message };
          });
          if (pairing.ok) pairingCode = pairing.code ?? null;
        }
        startFromSiteSignup(data.user!.id, numberId, cleanPhone, pairingCode).catch((err: any) =>
          logger.warn(`[Auth] startFromSiteSignup falhou (número ${numberId}): ${err.message}`)
        );
      }

      // Auto-login (Opção A): emitir JWT na hora para o usuário ir direto ao dashboard
      const token = app.jwt.sign({ sub: data.user!.id, email }, { expiresIn: '30d' });
      return reply.code(201).send({
        token,
        user: { id: data.user!.id, email },
        emailVerified: false,
        isTester: !!testerInvite,
        numberId,
        pairingCode,
        message: testerInvite
          ? 'Conta Tester criada com Plano PRO por 1 ano!'
          : 'Conta criada! Você já pode usar o ZapScript.',
      });
    }
  );

  // ── POST /auth/magic-register ──────────────────────────────────────────────
  // Fast-path: cadastro expresso pós-demo. O usuário já transcreveu um áudio
  // grátis, só precisa confirmar o e-mail para criar conta. Sem nome, senha ou
  // checkboxes — magic link vai direto para o dashboard.
  //
  // Se a conta já existir: reenvia o magic link normalmente (sem vazar info).
  app.post<{ Body: { email: string; name?: string; inviteCode?: string; referralCode?: string } }>(
    '/magic-register',
    { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const { email, name, inviteCode, referralCode } = req.body;
      if (!email) return reply.code(400).send({ error: 'E-mail obrigatório.' });

      const result = await createPasswordlessAccount({ email, name, inviteCode, referralCode });

      if (!result.ok) return reply.code(500).send({ error: result.error });
      if (result.alreadyExisted) {
        // Sempre responde igual — não vaza se a conta existe
        return { ok: true, message: 'Se este e-mail já estiver cadastrado, você receberá um link de acesso.' };
      }

      logger.info(`[Auth] magic-register: ${email.toLowerCase().trim()} → conta criada + magic link enviado`);
      return { ok: true, message: 'Conta criada! Verifique seu e-mail para acessar.' };
    }
  );

  // ── POST /auth/login ──────────────────────────────────────────────────────
  // Rate limit: 15 tentativas a cada 15 minutos (proteção contra bruteforce, tolerante a erros humanos)
  app.post<{ Body: { email: string; password: string } }>(
    '/login',
    { config: { rateLimit: { max: 15, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const v = validateRequest(loginSchema)(req.body);
      if (!v.valid) return reply.code(400).send({ error: v.error });

      const { email, password } = req.body;
      let { data, error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        // Opção A: o login NÃO exige e-mail confirmado. Contas legadas (cadastradas
        // antes do auto-confirm no cadastro) ficam não-confirmadas no Supabase e o
        // signInWithPassword falha — com 'email_not_confirmed' (comportamento antigo)
        // ou 'invalid_credentials' (novo, para evitar enumeração). Em ambos os casos,
        // se o usuário existe localmente, auto-confirmamos no Supabase e tentamos de
        // novo. A verificação REAL de posse do e-mail continua sendo User.emailVerified
        // (Prisma), que NÃO tocamos aqui — ela é exigida só no momento da assinatura.
        const errCode    = (error as any).code as string | undefined;
        const errMessage = error.message?.toLowerCase() ?? '';

        const isUnconfirmed =
          errCode === 'email_not_confirmed' ||
          errMessage.includes('email not confirmed') ||
          errMessage.includes('email_not_confirmed') ||
          errCode === 'invalid_credentials' ||
          errMessage.includes('invalid login credentials');

        if (isUnconfirmed) {
          try {
            const localUser = await prisma.user.findUnique({
              where:  { email: email.toLowerCase() },
              select: { id: true },
            });
            if (localUser) {
              // Confirma o e-mail no Supabase (apenas para liberar o signInWithPassword)
              // e tenta o login novamente. Se a senha estiver errada, o retry falha e
              // caímos no 401 genérico abaixo — sem revelar a existência da conta.
              await supabase.auth.admin.updateUserById(localUser.id, { email_confirm: true });
              const retry = await supabase.auth.signInWithPassword({ email, password });
              data  = retry.data;
              error = retry.error;
              if (!error) logger.info(`[Auth] Conta legada auto-confirmada no login: ${email}`);
            }
          } catch (confirmErr: any) {
            logger.warn(`[Auth] Falha ao auto-confirmar conta legada ${email}: ${confirmErr.message}`);
          }
        }

        if (error || !data?.user) {
          logger.warn(`[Auth] Login falhou para ${email}: code=${errCode} msg=${error?.message}`);
          return reply.code(401).send({ error: 'Credenciais inválidas' });
        }
      }

      // Opção A: o login NÃO exige e-mail verificado — o usuário acessa o Free
      // normalmente. A verificação (User.emailVerified) é exigida apenas no
      // checkout. Não sincronizamos emailVerified aqui, pois o login não prova
      // posse do e-mail (a conta é autoconfirmada no Supabase no cadastro).
      const token = app.jwt.sign({ sub: data!.user!.id, email }, { expiresIn: '30d' });
      return { token, user: { id: data!.user!.id, email } };
    }
  );

  // ── POST /auth/resend-confirmation ───────────────────────────────────────
  // Reenviar link de ativação para usuários que não confirmaram o e-mail
  app.post<{ Body: { email: string } }>(
    '/resend-confirmation',
    { config: { rateLimit: { max: 3, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const { email } = req.body;
      if (!email) return reply.code(400).send({ error: 'E-mail obrigatório' });

      try {
        const { data: linkData } = await supabase.auth.admin.generateLink({
          type:    'magiclink',
          email,
          options: { redirectTo: `${APP_URL}/email-confirmado` },
        });

        if (linkData?.properties?.action_link) {
          const confirmLink = linkData.properties.action_link;
          await sendEmail(
            email,
            'Ative sua conta ZapScript',
            emailWrapper('✉️', 'Novo link de ativação', `
              <p style="color:#b8d4c8;font-size:15px;line-height:1.7;margin:0 0 6px">
                Enviamos um novo link de ativação para este endereço de e-mail.
              </p>
              <p style="color:#7aa898;font-size:14px;line-height:1.6;margin:0 0 28px">
                Clique no botão abaixo para confirmar seu e-mail e ativar sua conta:
              </p>

              <div style="text-align:center;margin:0 0 24px">
                <a href="${confirmLink}"
                   style="display:inline-block;background:#10b981;color:#ffffff;padding:16px 48px;border-radius:12px;text-decoration:none;font-weight:700;font-size:16px;letter-spacing:0.2px;box-shadow:0 4px 24px rgba(16,185,129,.35)">
                  ✅ Ativar minha conta
                </a>
              </div>

              <p style="color:#4a7060;font-size:12px;text-align:center;margin:0 0 24px;line-height:1.6">
                Botão não funcionou? Cole este link no navegador:<br>
                <a href="${confirmLink}" style="color:rgba(16,185,129,.65);word-break:break-all;font-size:11px">${confirmLink}</a>
              </p>

              <div style="background:rgba(16,185,129,.06);border:1px solid rgba(16,185,129,.12);border-radius:12px;padding:16px 20px">
                <p style="color:#4a7060;font-size:12px;margin:0;line-height:1.5">
                  ⏰ <strong style="color:#5d8a72">Este link expira em 24 horas.</strong>
                  Após confirmar, sua conta estará ativa com <strong style="color:#5d8a72">7 dias de Pro grátis</strong> (áudios ilimitados), sem cartão de crédito.
                </p>
              </div>
            `, 'Se você não solicitou este link, pode ignorar este e-mail com segurança.')
          ).catch((err: any) => logger.error(`[Auth] Falha ao reenviar confirmação: ${err.message}`));
        }
      } catch (err: any) {
        logger.error(`[Auth] Erro ao gerar link de reconfirmação: ${err.message}`);
      }

      // Sempre retornar sucesso para não vazar se e-mail existe
      return { message: 'Se este e-mail estiver cadastrado e não confirmado, você receberá um novo link.' };
    }
  );

  // ── POST /auth/forgot-password ────────────────────────────────────────────
  app.post<{ Body: { email: string } }>(
    '/forgot-password',
    { config: { rateLimit: { max: 3, timeWindow: '5 minutes' } } },
    async (req, reply) => {
      const { email } = req.body;
      if (!email) return reply.code(400).send({ error: 'E-mail obrigatório' });

      try {
        const { data: linkData } = await supabase.auth.admin.generateLink({
          type:    'recovery',
          email,
          options: { redirectTo: `${APP_URL}/redefinir-senha` },
        });

        if (linkData?.properties?.action_link) {
          const resetLink = linkData.properties.action_link;
          await sendEmail(
            email,
            'Redefinir sua senha — ZapScript',
            emailWrapper('🔑', 'Redefinir sua senha', `
              <p style="color:#b8d4c8;font-size:15px;line-height:1.7;margin:0 0 6px">
                Recebemos uma solicitação para redefinir a senha da sua conta ZapScript.
              </p>
              <p style="color:#7aa898;font-size:14px;line-height:1.6;margin:0 0 28px">
                Clique no botão abaixo e crie uma nova senha:
              </p>

              <div style="text-align:center;margin:0 0 24px">
                <a href="${resetLink}"
                   style="display:inline-block;background:#10b981;color:#ffffff;padding:16px 48px;border-radius:12px;text-decoration:none;font-weight:700;font-size:16px;letter-spacing:0.2px;box-shadow:0 4px 24px rgba(16,185,129,.35)">
                  🔑 Criar nova senha
                </a>
              </div>

              <p style="color:#4a7060;font-size:12px;text-align:center;margin:0 0 24px;line-height:1.6">
                Botão não funcionou? Cole este link no navegador:<br>
                <a href="${resetLink}" style="color:rgba(16,185,129,.65);word-break:break-all;font-size:11px">${resetLink}</a>
              </p>

              <div style="background:rgba(16,185,129,.06);border:1px solid rgba(16,185,129,.12);border-radius:12px;padding:16px 20px">
                <table cellpadding="0" cellspacing="0" border="0" style="width:100%">
                  <tr>
                    <td style="vertical-align:top;padding-right:10px;font-size:18px;line-height:1;padding-top:2px">⚠️</td>
                    <td>
                      <p style="color:#4a7060;font-size:12px;margin:0;line-height:1.6">
                        <strong style="color:#5d8a72">Este link expira em 1 hora</strong> e só pode ser usado uma vez.<br>
                        Após criar a nova senha, o link é invalidado automaticamente.
                      </p>
                    </td>
                  </tr>
                </table>
              </div>
            `, 'Não solicitou a redefinição? Ignore este e-mail — sua senha atual permanece ativa e segura. Nenhuma alteração foi feita.')
          );
        }
      } catch (err: any) {
        logger.error(`[Auth] Erro ao gerar link de recuperação: ${err.message}`);
      }

      // Sempre retornar sucesso para não vazar se o e-mail existe no sistema
      return {
        message: 'Se este e-mail estiver cadastrado, você receberá as instruções em breve.',
      };
    }
  );

  // ── POST /auth/reset-password ─────────────────────────────────────────────
  app.post<{ Body: { access_token: string; new_password: string } }>(
    '/reset-password',
    { config: { rateLimit: { max: 5, timeWindow: '5 minutes' } } },
    async (req, reply) => {
      const { access_token, new_password } = req.body;
      if (!access_token || !new_password) {
        return reply.code(400).send({ error: 'access_token e new_password são obrigatórios' });
      }
      if (new_password.length < 8) {
        return reply.code(400).send({ error: 'Senha deve ter ao menos 8 caracteres' });
      }

      // Verificar token e identificar usuário
      const { data: userData, error: userError } = await supabase.auth.getUser(access_token);
      if (userError || !userData.user) {
        return reply.code(401).send({ error: 'Link inválido ou expirado. Solicite um novo.' });
      }

      // Atualizar senha via admin API
      const { error: updateError } = await supabase.auth.admin.updateUserById(
        userData.user.id,
        { password: new_password }
      );
      if (updateError) {
        return reply.code(400).send({ error: 'Erro ao redefinir senha. Tente novamente.' });
      }

      return { message: 'Senha redefinida com sucesso! Faça login com sua nova senha.' };
    }
  );

  // ── POST /auth/verify-email ───────────────────────────────────────────────
  // Confirma a posse do e-mail via link mágico (token JWT purpose:verify-email).
  app.post<{ Body: { token: string } }>(
    '/verify-email',
    { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } },
    async (req, reply) => {
      const { token } = req.body;
      if (!token) return reply.code(400).send({ error: 'Token obrigatório.' });

      let payload: any;
      try {
        payload = (app as any).jwt.verify(token);
      } catch {
        return reply.code(400).send({ error: 'Link inválido ou expirado. Solicite um novo.' });
      }
      if (payload?.purpose !== 'verify-email' || !payload?.sub) {
        return reply.code(400).send({ error: 'Link inválido.' });
      }

      await prisma.user.update({
        where: { id: payload.sub },
        data:  { emailVerified: true },
      }).catch((err: any) => logger.warn(`[Auth] verify-email: usuário não encontrado (${payload.sub}): ${err.message}`));

      logger.info(`[Auth] E-mail verificado: ${payload.sub}`);
      return { verified: true };
    }
  );

  // ── POST /auth/resend-verification ────────────────────────────────────────
  // Reenvia o link mágico de verificação para o usuário autenticado (usado no
  // banner do dashboard e no gate do checkout).
  app.post(
    '/resend-verification',
    { preHandler: [(app as any).authenticate], config: { rateLimit: { max: 3, timeWindow: '10 minutes' } } },
    async (req: any, reply) => {
      const user = await prisma.user.findUnique({
        where:  { id: req.user.sub },
        select: { email: true, name: true, emailVerified: true },
      });
      if (!user) return reply.code(404).send({ error: 'Usuário não encontrado.' });
      if (user.emailVerified) return { alreadyVerified: true };

      try {
        const verifyToken = (app as any).jwt.sign(
          { sub: req.user.sub, email: user.email, purpose: 'verify-email' },
          { expiresIn: '7d' },
        );
        const confirmLink = `${APP_URL}/verificar-email?token=${encodeURIComponent(verifyToken)}`;
        await sendVerificationEmail(user.email, user.name, confirmLink);
      } catch (err: any) {
        logger.error(`[Auth] Erro ao reenviar verificação: ${err.message}`);
      }
      return { sent: true };
    }
  );

  // ── POST /auth/accept-terms ───────────────────────────────────────────────
  // Aceite dos termos por usuários já cadastrados (modal bloqueante no dashboard)
  app.post<{ Body: { cbTos: boolean; cbContrato: boolean; cbLgpd: boolean; cbMarketing?: boolean } }>(
    '/accept-terms',
    { preHandler: [(app as any).authenticate] },
    async (req: any, reply) => {
      const { cbTos, cbContrato, cbLgpd, cbMarketing } = req.body;
      if (!cbTos || !cbContrato || !cbLgpd) {
        return reply.code(400).send({ error: 'Todos os aceites obrigatórios são necessários.' });
      }
      const now = new Date();
      const consentDocVersion = 'tos_v2.0,contrato_v2.0,pp_v2.0';
      await prisma.user.update({
        where: { id: req.user.sub },
        data: {
          termsAcceptedAt:         now,
          contractAcceptedAt:      now,
          privacyPolicyAcceptedAt: now,
          marketingConsentAt:      cbMarketing ? now : undefined,
          consentDocVersion,
        },
      });
      await prisma.auditLog.create({
        data: {
          action:       'user.terms_accepted',
          targetUserId: req.user.sub,
          adminId:      'system',
          changes:      { cbTos, cbContrato, cbLgpd, cbMarketing: !!cbMarketing, consentDocVersion },
        },
      });
      return { accepted: true };
    }
  );

  // ── GET /auth/me ──────────────────────────────────────────────────────────
  // C3: Retornar apenas campos necessários ao frontend (sem metadados internos de compliance)
  app.get('/me', { preHandler: [(app as any).authenticate] }, async (req: any) => {
    const user = await prisma.user.findUnique({
      where:  { id: req.user.sub },
      select: {
        id:               true,
        email:            true,
        name:             true,
        phone:            true,
        document:         true,
        emailVerified:    true,
        isAdmin:          true,
        isTester:         true,
        refCode:          true,
        createdAt:        true,
        termsAcceptedAt:  true,
        subscription: {
          select: {
            id:              true,
            status:          true,
            paymentMethod:   true,
            currentPeriodEnd: true,
            plan: {
              select: {
                id: true, name: true, label: true,
                audiosPerMonth: true, minutesPerMonth: true, maxNumbers: true, priceBrl: true, features: true,
              },
            },
          },
        },
        balance: {
          select: {
            audiosUsed:         true,
            availableMinutes:   true,
            accumulatedMinutes: true,
            resetAt:            true,
          },
        },
      },
    });
    if (!user) return null;

    // Marcação de afiliado — usada no front para liberar o menu/página "Afiliados".
    // Consulta isolada e tolerante a falhas: se a tabela/migração não existir
    // (ou qualquer erro), degrada para "sem marcação" em vez de derrubar o /me.
    let affiliate: { status: string } | null = null;
    try {
      const aff = await prisma.affiliate.findUnique({
        where:  { userId: req.user.sub },
        select: { status: true },
      });
      if (aff) affiliate = aff;
    } catch (err: any) {
      req.log?.warn(`[Auth] Falha ao ler marcação de afiliado (ignorada): ${err?.message}`);
    }

    // Módulos ativos da suíte (login único + acesso à la carte). Tolerante a
    // falhas/ausência de migração: degrada para lista vazia. Ver MODULOS_ARQUITETURA.md.
    let modules: string[] = [];
    try {
      const ents = await prisma.entitlement.findMany({
        where:  { userId: req.user.sub, status: { in: ['active', 'trialing'] } },
        select: { productKey: true },
      });
      modules = ents.map((e: { productKey: string }) => e.productKey);
    } catch (err: any) {
      req.log?.warn(`[Auth] Falha ao ler entitlements (ignorada): ${err?.message}`);
    }

    // C2: decriptar document (AES-256-GCM) antes de retornar ao frontend
    return { ...user, document: decryptStr(user.document) || null, affiliate, modules };
  });

  // ── PUT /auth/profile ─────────────────────────────────────────────────────
  app.put<{ Body: { name?: string; document?: string } }>(
    '/profile',
    { preHandler: [(app as any).authenticate] },
    async (req: any, reply) => {
      const { name, document } = req.body;
      const userId = req.user.sub;

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) return reply.code(404).send({ error: 'Usuário não encontrado' });

      const data: { name?: string; document?: string; documentHash?: string } = {};
      let plainDoc: string | null = null;

      // Nome — editável; valida apenas tamanho razoável
      if (name !== undefined) {
        const cleanName = name.trim();
        if (cleanName.length < 2 || cleanName.length > 120) {
          return reply.code(400).send({ error: 'Nome deve ter entre 2 e 120 caracteres.' });
        }
        data.name = cleanName;
      }

      // CPF/CNPJ — editável; mantém validação de formato e duplicidade
      if (document !== undefined && document !== '') {
        const clean = document.replace(/\D/g, '');
        if (clean.length < 11 || clean.length > 14) {
          return reply.code(400).send({ error: 'CPF deve ter 11 dígitos, CNPJ deve ter 14 dígitos.' });
        }

        // C2: Verificar duplicata via blind index HMAC (sem comparar plaintext no DB)
        const hash = computeDocHash(clean);
        const existing = await prisma.user.findFirst({ where: { documentHash: hash, NOT: { id: userId } } });
        if (existing) {
          return reply.code(400).send({ error: 'CPF/CNPJ já cadastrado em outra conta.' });
        }

        // C2: Armazenar CPF/CNPJ criptografado (AES-256-GCM) + blind index (HMAC-SHA256)
        data.document     = encryptStr(clean);
        data.documentHash = hash;
        plainDoc          = clean;
      }

      if (Object.keys(data).length === 0) {
        return { updated: false, user: { ...user, document: decryptStr(user.document) || null } };
      }

      const updated = await prisma.user.update({ where: { id: userId }, data });
      return {
        updated: true,
        user: { ...updated, document: plainDoc ?? (decryptStr(updated.document) || null) },
      };
    }
  );
}
