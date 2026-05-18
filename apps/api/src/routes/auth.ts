import { FastifyInstance } from 'fastify';
import { createClient } from '@supabase/supabase-js';
import { prisma } from '../lib/prisma';
import { sendEmail } from '../lib/mailer';
import { logger } from '../lib/logger';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const APP_URL = process.env.APP_URL || 'https://zapscript.me';

// ── Template base dos e-mails ─────────────────────────────────────────────────
function emailWrapper(
  iconEmoji: string,
  title: string,
  body: string,
  securityNote = 'Se você não reconhece esta ação, ignore este e-mail.'
): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
</head>
<body style="margin:0;padding:0;background:#050a07;font-family:'Segoe UI',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased">
  <div style="padding:40px 16px">
    <div style="max-width:540px;margin:0 auto">

      <!-- Logo -->
      <div style="text-align:center;margin-bottom:28px">
        <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto">
          <tr>
            <td style="background:#10b981;border-radius:10px;width:38px;height:38px;text-align:center;vertical-align:middle">
              <span style="font-size:18px;line-height:38px">💬</span>
            </td>
            <td style="padding-left:10px;vertical-align:middle">
              <span style="font-size:21px;font-weight:700;color:#10b981;letter-spacing:-0.5px">ZapScript</span>
            </td>
          </tr>
        </table>
      </div>

      <!-- Card -->
      <div style="background:#0d1c19;border:1px solid rgba(16,185,129,.18);border-radius:20px;padding:40px 36px">

        <!-- Ícone -->
        <div style="text-align:center;margin-bottom:18px">
          <div style="display:inline-block;width:64px;height:64px;background:rgba(16,185,129,.12);border-radius:50%;font-size:28px;line-height:64px;text-align:center">${iconEmoji}</div>
        </div>

        <!-- Título -->
        <h1 style="text-align:center;color:#10b981;font-size:22px;font-weight:700;margin:0 0 4px;letter-spacing:-0.3px">${title}</h1>
        <p style="text-align:center;color:#4ade80;font-size:13px;font-weight:400;margin:0 0 28px;opacity:.7">zapscript.me</p>

        <!-- Divisória -->
        <div style="height:1px;background:rgba(16,185,129,.12);margin-bottom:28px"></div>

        ${body}

        <!-- Divisória -->
        <div style="height:1px;background:rgba(16,185,129,.08);margin-top:32px;margin-bottom:20px"></div>

        <p style="color:#4a7060;font-size:12px;line-height:1.6;margin:0;text-align:center">
          ${securityNote}
        </p>
      </div>

      <!-- Rodapé -->
      <div style="text-align:center;margin-top:24px">
        <p style="color:#2d5040;font-size:12px;margin:0 0 4px">ZapScript — Transcrição Inteligente de Áudios do WhatsApp</p>
        <a href="${APP_URL}" style="color:rgba(16,185,129,.55);font-size:12px;text-decoration:none">zapscript.me</a>
      </div>

    </div>
  </div>
</body>
</html>`;
}

export default async function authRoutes(app: FastifyInstance) {

  // ── POST /auth/register ───────────────────────────────────────────────────
  app.post<{ Body: { email: string; password: string; name?: string; inviteCode?: string } }>(
    '/register',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { email, password, name, inviteCode } = req.body;
      if (!email || !password) return reply.code(400).send({ error: 'email e password obrigatórios' });

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

      // Criar no Supabase Auth sem confirmar e-mail automaticamente
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: false,   // usuário deve confirmar via link no e-mail
      });
      if (error) return reply.code(400).send({ error: error.message });

      // Buscar plano adequado
      const planName = testerInvite ? 'pro' : 'free';
      const plan = await prisma.plan.findUnique({ where: { name: planName } });
      if (!plan) return reply.code(500).send({ error: 'Planos não configurados. Rode o seed.' });

      const now = new Date();
      const oneYearFromNow = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

      // Criar User + Subscription + MinuteBalance em transação atômica
      await prisma.$transaction(async (tx) => {
        const u = await tx.user.create({
          data: {
            id: data.user!.id,
            email,
            name,
            isTester:    !!testerInvite,
            testerSince: testerInvite ? now : undefined,
          },
        });
        await tx.subscription.create({
          data: {
            userId:          u.id,
            planId:          plan.id,
            status:          'active',
            currentPeriodEnd: testerInvite ? oneYearFromNow : undefined,
          },
        });
        await tx.minuteBalance.create({
          data: {
            userId:           u.id,
            availableMinutes: plan.minutesPerMonth,
            resetAt:          testerInvite ? oneYearFromNow : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        });
        // Marcar convite como usado
        if (testerInvite) {
          await tx.testerInvite.update({
            where: { id: testerInvite.id },
            data:  { usedAt: now, usedBy: u.id },
          });
        }
      });

      // Gerar link de confirmação e enviar e-mail de boas-vindas
      try {
        const { data: linkData } = await supabase.auth.admin.generateLink({
          type:     'signup',           // 'signup' = link de confirmação de e-mail (não magiclink)
          email,
          password, // necessário para o tipo 'signup'
          options:  { redirectTo: `${APP_URL}/email-confirmado` },
        });

        if (linkData?.properties?.action_link) {
          const confirmLink = linkData.properties.action_link;
          await sendEmail(
            email,
            'Confirme seu e-mail — ZapScript',
            emailWrapper('✉️', 'Confirme seu e-mail', `
              <p style="color:#b8d4c8;font-size:15px;line-height:1.7;margin:0 0 8px">
                Olá${name ? `, <strong style="color:#6ee7b7">${name}</strong>` : ''}!
              </p>
              <p style="color:#b8d4c8;font-size:15px;line-height:1.7;margin:0 0 6px">
                Sua conta ZapScript foi criada. Falta apenas <strong style="color:#6ee7b7">um passo</strong>:
                confirme seu e-mail para ativar o acesso.
              </p>
              <p style="color:#7aa898;font-size:14px;line-height:1.6;margin:0 0 28px">
                Após a confirmação, você terá acesso imediato à plataforma.
              </p>

              <div style="text-align:center;margin:0 0 24px">
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
                <table cellpadding="0" cellspacing="0" border="0" style="width:100%">
                  <tr>
                    <td style="vertical-align:top;padding-right:10px;font-size:20px;line-height:1">🎁</td>
                    <td>
                      <p style="color:#6ee7b7;font-size:13px;font-weight:700;margin:0 0 4px">10 minutos grátis te esperam</p>
                      <p style="color:#4a7060;font-size:12px;margin:0;line-height:1.5">
                        Assim que confirmar, sua conta recebe <strong style="color:#5d8a72">10 minutos de transcrição</strong> sem cartão de crédito.
                        Transcreva áudios do WhatsApp com IA em segundos.
                      </p>
                    </td>
                  </tr>
                </table>
                <div style="height:1px;background:rgba(16,185,129,.08);margin:12px 0"></div>
                <p style="color:#4a7060;font-size:12px;margin:0;line-height:1.5">
                  ⏰ <strong style="color:#5d8a72">Este link expira em 24 horas.</strong>
                  Após esse prazo, faça login e solicite um novo link de ativação.
                </p>
              </div>
            `, 'Se você não criou uma conta no ZapScript, pode ignorar este e-mail com segurança.')
          );
        }
      } catch (err: any) {
        // Não falhar o cadastro se o envio de e-mail falhar
        logger.error(`[Auth] Erro ao enviar e-mail de confirmação: ${err.message}`);
      }

      return reply.code(201).send({
        needsVerification: true,
        isTester: !!testerInvite,
        message: testerInvite
          ? 'Conta Tester criada com Plano PRO por 1 ano! Verifique seu e-mail para ativar.'
          : 'Conta criada! Verifique seu e-mail para ativar o acesso.',
      });
    }
  );

  // ── POST /auth/login ──────────────────────────────────────────────────────
  // Rate limit: 15 tentativas a cada 15 minutos (proteção contra bruteforce, tolerante a erros humanos)
  app.post<{ Body: { email: string; password: string } }>(
    '/login',
    { config: { rateLimit: { max: 15, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const { email, password } = req.body;
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        // Detectar especificamente e-mail não confirmado (mensagem do Supabase)
        const isUnconfirmed = error.message?.toLowerCase().includes('email not confirmed')
          || error.message?.toLowerCase().includes('email_not_confirmed');

        if (isUnconfirmed) {
          return reply.code(403).send({
            error: 'E-mail não confirmado. Verifique sua caixa de entrada ou solicite um novo link de ativação.',
            needsVerification: true,
            code: 'EMAIL_NOT_CONFIRMED',
          });
        }

        logger.warn(`[Auth] Login falhou para ${email}: ${error.message}`);
        return reply.code(401).send({ error: 'Credenciais inválidas' });
      }

      // Bloquear login se e-mail ainda não foi verificado (verificação dupla local)
      if (!data.user.email_confirmed_at) {
        return reply.code(403).send({
          error: 'E-mail não confirmado. Verifique sua caixa de entrada ou solicite um novo link de ativação.',
          needsVerification: true,
          code: 'EMAIL_NOT_CONFIRMED',
        });
      }

      // Atualizar emailVerified no banco (sync lazy)
      await prisma.user.update({
        where: { id: data.user.id },
        data:  { emailVerified: true },
      }).catch(() => { /* ignora se usuário não existir no Prisma */ });

      const token = app.jwt.sign({ sub: data.user.id, email }, { expiresIn: '30d' });
      return { token, user: { id: data.user.id, email } };
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
                  Após confirmar, sua conta estará ativa com <strong style="color:#5d8a72">10 minutos grátis</strong> de transcrição, sem cartão de crédito.
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

  // ── GET /auth/me ──────────────────────────────────────────────────────────
  app.get('/me', { preHandler: [(app as any).authenticate] }, async (req: any) => {
    return prisma.user.findUnique({
      where:   { id: req.user.sub },
      include: { subscription: { include: { plan: true } }, balance: true },
    });
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

      // Nome é imutável após cadastro
      if (name) {
        return reply.code(400).send({
          error: 'Nome não pode ser alterado após o cadastro. Entre em contato com suporte.'
        });
      }

      // CPF/CNPJ só pode ser definido uma vez (quando ainda não preenchido)
      if (document) {
        if (user.document) {
          return reply.code(400).send({
            error: 'CPF/CNPJ já cadastrado e não pode ser alterado. Entre em contato com suporte.'
          });
        }

        const clean = document.replace(/\D/g, '');
        if (clean.length < 11 || clean.length > 14) {
          return reply.code(400).send({ error: 'CPF deve ter 11 dígitos, CNPJ deve ter 14 dígitos.' });
        }

        // Verificar duplicata
        const existing = await prisma.user.findFirst({ where: { document: clean, NOT: { id: userId } } });
        if (existing) {
          return reply.code(400).send({ error: 'CPF/CNPJ já cadastrado em outra conta.' });
        }

        const updated = await prisma.user.update({ where: { id: userId }, data: { document: clean } });
        return { updated: true, user: updated };
      }

      return { updated: false, user };
    }
  );
}
