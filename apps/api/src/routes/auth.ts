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
function emailWrapper(iconEmoji: string, title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#050a07;font-family:'Segoe UI',Arial,sans-serif">
  <div style="padding:40px 20px">
    <div style="max-width:520px;margin:0 auto">

      <!-- Logo -->
      <div style="text-align:center;margin-bottom:32px">
        <table cellpadding="0" cellspacing="0" style="margin:0 auto">
          <tr>
            <td style="background:#10b981;border-radius:12px;width:40px;height:40px;text-align:center;vertical-align:middle">
              <span style="font-size:20px;line-height:40px">💬</span>
            </td>
            <td style="padding-left:10px;vertical-align:middle">
              <span style="font-size:22px;font-weight:700;color:#10b981;letter-spacing:-0.5px">ZapScript</span>
            </td>
          </tr>
        </table>
      </div>

      <!-- Card -->
      <div style="background:#0d1c19;border:1px solid rgba(16,185,129,.2);border-radius:20px;padding:40px 36px">

        <!-- Ícone -->
        <div style="text-align:center;margin-bottom:20px">
          <div style="display:inline-block;width:64px;height:64px;background:rgba(16,185,129,.12);border-radius:50%;font-size:28px;line-height:64px;text-align:center">
            ${iconEmoji}
          </div>
        </div>

        <!-- Título -->
        <h1 style="text-align:center;color:#10b981;font-size:22px;font-weight:700;margin:0 0 6px">${title}</h1>
        <p style="text-align:center;color:#6ee7b7;font-size:14px;font-weight:300;margin:0 0 28px">zapscript.me</p>

        <!-- Linha divisória -->
        <div style="height:1px;background:rgba(16,185,129,.12);margin-bottom:28px"></div>

        ${body}

        <!-- Linha divisória -->
        <div style="height:1px;background:rgba(16,185,129,.08);margin-top:28px;margin-bottom:20px"></div>

        <p style="color:#2d4a3e;font-size:12px;line-height:1.5;margin:0;text-align:center">
          Se você não reconhece esta ação, ignore este e-mail.<br>Nenhuma senha foi alterada.
        </p>
      </div>

      <!-- Rodapé -->
      <div style="text-align:center;margin-top:24px">
        <p style="color:#1e3329;font-size:12px;margin:0 0 4px">
          ZapScript — Transcrição Inteligente de Áudios do WhatsApp
        </p>
        <a href="${APP_URL}" style="color:rgba(16,185,129,.4);font-size:12px;text-decoration:none">zapscript.me</a>
      </div>

    </div>
  </div>
</body>
</html>`;
}

export default async function authRoutes(app: FastifyInstance) {

  // ── POST /auth/register ───────────────────────────────────────────────────
  app.post<{ Body: { email: string; password: string; name?: string; document?: string } }>(
    '/register',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { email, password, name, document } = req.body;
      if (!email || !password) return reply.code(400).send({ error: 'email e password obrigatórios' });

      // Verificar duplicata de e-mail
      const existingEmail = await prisma.user.findUnique({ where: { email } });
      if (existingEmail) return reply.code(400).send({ error: 'E-mail já cadastrado. Faça login.', redirect: '/login' });

      // Verificar duplicata de CPF/CNPJ
      if (document) {
        const existingDoc = await prisma.user.findFirst({ where: { document } });
        if (existingDoc) return reply.code(400).send({ error: 'CPF/CNPJ já cadastrado. Faça login.', redirect: '/login' });
      }

      // Criar no Supabase Auth sem confirmar e-mail automaticamente
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: false,   // usuário deve confirmar via link no e-mail
      });
      if (error) return reply.code(400).send({ error: error.message });

      // Buscar plano Free
      const freePlan = await prisma.plan.findUnique({ where: { name: 'free' } });
      if (!freePlan) return reply.code(500).send({ error: 'Planos não configurados. Rode o seed.' });

      // Criar User + Subscription + MinuteBalance em transação atômica
      await prisma.$transaction(async (tx) => {
        const u = await tx.user.create({ data: { id: data.user!.id, email, name, document } });
        await tx.subscription.create({ data: { userId: u.id, planId: freePlan.id } });
        await tx.minuteBalance.create({
          data: {
            userId:           u.id,
            availableMinutes: freePlan.minutesPerMonth,
            resetAt:          new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        });
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
              <p style="color:#a0aec0;font-size:15px;line-height:1.7;margin:0 0 10px">
                Olá${name ? `, <strong style="color:#d1fae5">${name}</strong>` : ''}!
              </p>
              <p style="color:#a0aec0;font-size:15px;line-height:1.7;margin:0 0 28px">
                Sua conta ZapScript foi criada com sucesso! Para ativá-la e começar a
                transcrever seus áudios do WhatsApp com IA, confirme seu endereço de e-mail:
              </p>

              <div style="text-align:center;margin:0 0 28px">
                <a href="${confirmLink}"
                   style="display:inline-block;background:#10b981;color:#ffffff;padding:16px 44px;border-radius:12px;text-decoration:none;font-weight:700;font-size:15px;letter-spacing:0.2px;box-shadow:0 4px 20px rgba(16,185,129,.4)">
                  ✅ Confirmar meu e-mail
                </a>
              </div>

              <p style="color:#4a6e5a;font-size:12px;text-align:center;margin:0;line-height:1.6">
                Ou cole este link no navegador:<br>
                <a href="${confirmLink}" style="color:rgba(16,185,129,.6);word-break:break-all;font-size:11px">${confirmLink}</a>
              </p>

              <div style="background:rgba(16,185,129,.05);border:1px solid rgba(16,185,129,.1);border-radius:10px;padding:14px 18px;margin-top:24px">
                <p style="color:#4a6e5a;font-size:12px;margin:0;line-height:1.6">
                  ⏰ <strong style="color:#6b8a75">Este link expira em 24 horas.</strong><br>
                  Após confirmar, você terá acesso a <strong style="color:#6b8a75">10 minutos grátis</strong> de transcrição, sem cartão de crédito.
                </p>
              </div>
            `)
          );
        }
      } catch (err: any) {
        // Não falhar o cadastro se o envio de e-mail falhar
        logger.error(`[Auth] Erro ao enviar e-mail de confirmação: ${err.message}`);
      }

      return reply.code(201).send({
        needsVerification: true,
        message: 'Conta criada! Verifique seu e-mail para ativar o acesso.',
      });
    }
  );

  // ── POST /auth/login ──────────────────────────────────────────────────────
  // Rate limit: 5 tentativas a cada 15 minutos (proteção contra bruteforce)
  app.post<{ Body: { email: string; password: string } }>(
    '/login',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const { email, password } = req.body;
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return reply.code(401).send({ error: 'Credenciais inválidas' });

      // Bloquear login se e-mail ainda não foi verificado
      if (!data.user.email_confirmed_at) {
        return reply.code(403).send({
          error: 'E-mail não verificado. Verifique sua caixa de entrada e clique no link de confirmação.',
          needsVerification: true,
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
            emailWrapper('🔑', 'Redefinir senha', `
              <p style="color:#a0aec0;font-size:15px;line-height:1.7;margin:0 0 10px">
                Recebemos uma solicitação para redefinir a senha da sua conta ZapScript.
              </p>
              <p style="color:#a0aec0;font-size:15px;line-height:1.7;margin:0 0 28px">
                Clique no botão abaixo para criar uma nova senha:
              </p>

              <div style="text-align:center;margin:0 0 28px">
                <a href="${resetLink}"
                   style="display:inline-block;background:#10b981;color:#ffffff;padding:16px 44px;border-radius:12px;text-decoration:none;font-weight:700;font-size:15px;letter-spacing:0.2px;box-shadow:0 4px 20px rgba(16,185,129,.4)">
                  🔑 Redefinir minha senha
                </a>
              </div>

              <p style="color:#4a6e5a;font-size:12px;text-align:center;margin:0;line-height:1.6">
                Ou cole este link no navegador:<br>
                <a href="${resetLink}" style="color:rgba(16,185,129,.6);word-break:break-all;font-size:11px">${resetLink}</a>
              </p>

              <div style="background:rgba(16,185,129,.05);border:1px solid rgba(16,185,129,.1);border-radius:10px;padding:14px 18px;margin-top:24px">
                <p style="color:#4a6e5a;font-size:12px;margin:0;line-height:1.6">
                  ⏰ <strong style="color:#6b8a75">Este link expira em 1 hora.</strong><br>
                  Se você não solicitou a redefinição, sua senha permanece a mesma.
                </p>
              </div>
            `)
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
      if (new_password.length < 6) {
        return reply.code(400).send({ error: 'Senha deve ter ao menos 6 caracteres' });
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

      // Name and document are immutable after registration
      if (name || document) {
        return reply.code(400).send({
          error: 'Nome e CPF/CNPJ não podem ser alterados após o cadastro. Entre em contato com suporte para modificações.'
        });
      }

      const user = await prisma.user.findUnique({ where: { id: userId } });
      return { updated: true, user };
    }
  );
}
