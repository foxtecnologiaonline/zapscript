import { FastifyInstance } from 'fastify';
import { createClient } from '@supabase/supabase-js';
import { prisma } from '../lib/prisma';
import nodemailer from 'nodemailer';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// ── Utilitário de e-mail (igual ao support.ts) ────────────────────────────────
async function sendEmail(to: string, subject: string, html: string) {
  if (!process.env.SMTP_HOST) {
    console.log('[Auth] SMTP não configurado, e-mail não enviado');
    return;
  }
  const transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   Number(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transporter.sendMail({ from: process.env.SMTP_USER, to, subject, html });
}

const APP_URL = process.env.APP_URL || 'https://zapscript.me';

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
          type:    'signup',
          email,
          options: { redirectTo: `${APP_URL}/email-confirmado` },
        });

        if (linkData?.properties?.action_link) {
          await sendEmail(
            email,
            'Confirme seu e-mail — ZapScript',
            `
              <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#f9fafb;border-radius:12px">
                <div style="text-align:center;margin-bottom:24px">
                  <span style="font-size:32px">🎉</span>
                  <h2 style="color:#10b981;margin:8px 0 4px">Bem-vindo ao ZapScript!</h2>
                  <p style="color:#6b7280;margin:0">Sua conta está quase pronta</p>
                </div>

                <div style="background:#fff;border-radius:8px;padding:24px;border:1px solid #e5e7eb">
                  <p style="margin-top:0">Olá${name ? `, <b>${name}</b>` : ''}!</p>
                  <p>Para ativar sua conta e começar a transcrever áudios do WhatsApp, confirme seu e-mail clicando no botão abaixo:</p>

                  <p style="text-align:center;margin:28px 0">
                    <a href="${linkData.properties.action_link}"
                       style="background:#10b981;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block">
                      ✅ Confirmar meu e-mail
                    </a>
                  </p>

                  <p style="color:#9ca3af;font-size:13px;margin:0">
                    Se você não criou esta conta, ignore este e-mail.<br>
                    Este link expira em 24 horas.
                  </p>
                </div>

                <p style="text-align:center;color:#9ca3af;font-size:12px;margin-top:20px">
                  ZapScript — Transcrição automática de áudios do WhatsApp<br>
                  <a href="${APP_URL}" style="color:#10b981">${APP_URL.replace('https://', '')}</a>
                </p>
              </div>
            `
          );
        }
      } catch (err: any) {
        // Não falhar o cadastro se o envio de e-mail falhar
        console.error('[Auth] Erro ao enviar e-mail de confirmação:', err.message);
      }

      return reply.code(201).send({
        needsVerification: true,
        message: 'Conta criada! Verifique seu e-mail para ativar o acesso.',
      });
    }
  );

  // ── POST /auth/login ──────────────────────────────────────────────────────
  app.post<{ Body: { email: string; password: string } }>(
    '/login',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
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
          await sendEmail(
            email,
            'Redefinir sua senha — ZapScript',
            `
              <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#f9fafb;border-radius:12px">
                <div style="text-align:center;margin-bottom:24px">
                  <span style="font-size:32px">🔑</span>
                  <h2 style="color:#10b981;margin:8px 0 4px">Redefinição de senha</h2>
                </div>

                <div style="background:#fff;border-radius:8px;padding:24px;border:1px solid #e5e7eb">
                  <p style="margin-top:0">Recebemos uma solicitação para redefinir a senha da sua conta ZapScript.</p>
                  <p>Clique no botão abaixo para criar uma nova senha:</p>

                  <p style="text-align:center;margin:28px 0">
                    <a href="${linkData.properties.action_link}"
                       style="background:#10b981;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block">
                      🔑 Redefinir minha senha
                    </a>
                  </p>

                  <p style="color:#9ca3af;font-size:13px;margin:0">
                    Se você não solicitou isso, ignore este e-mail. Sua senha permanece a mesma.<br>
                    Este link expira em 1 hora.
                  </p>
                </div>

                <p style="text-align:center;color:#9ca3af;font-size:12px;margin-top:20px">
                  ZapScript — <a href="${APP_URL}" style="color:#10b981">${APP_URL.replace('https://', '')}</a>
                </p>
              </div>
            `
          );
        }
      } catch (err: any) {
        console.error('[Auth] Erro ao gerar link de recuperação:', err.message);
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

      if (document) {
        const existing = await prisma.user.findFirst({ where: { document, NOT: { id: userId } } });
        if (existing) return reply.code(400).send({ error: 'CPF/CNPJ já cadastrado em outra conta.' });
      }

      const user = await prisma.user.update({
        where: { id: userId },
        data:  { ...(name ? { name } : {}), ...(document ? { document } : {}) },
      });
      return { updated: true, user };
    }
  );
}
