import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { sendEmail } from '../lib/mailer';
import { resolveTeamScope } from '../lib/teamScope';
import { PLAN_PRICES, PLAN_PRICES_YEARLY } from './billing';

/* ─────────────────────────────────────────────────────────
   Plano Empresas Multi-Seat
   Preço FLAT do tier (R$99/mês ou R$595/ano) já cobre até
   EMPRESAS_MAX_SEATS usuários — não é cobrança por seat. Só o dono de um
   time no plano Empresas pode criar/convidar. Papéis: admin/manager/agent
   (ver lib/teamScope.ts) — hoje compartilhados de verdade nos módulos
   Atende/CRM/Tarefas (bundle do Empresas); os demais módulos seguem por
   conta individual.
   ───────────────────────────────────────────────────────── */

const INVITE_ROLES = new Set(['admin', 'manager', 'agent']);

const EMPRESAS_MAX_SEATS = 5; // até 5 usuários incluídos no plano Empresas

function genInviteCode(): string {
  return crypto.randomBytes(16).toString('hex'); // 32 chars
}

/** ownerId é o userId do dono; retorna o team ou null se não for owner. */
async function getOwnedTeam(userId: string) {
  const member = await prisma.teamMember.findUnique({
    where: { userId },
    select: { teamId: true, role: true },
  });
  if (!member || member.role !== 'owner') return null;
  return prisma.team.findUnique({
    where: { id: member.teamId },
    include: {
      members: {
        select: {
          id: true,
          userId: true,
          role: true,
          status: true,
          invitedEmail: true,
          joinedAt: true,
          user: { select: { name: true, email: true } },
        },
      },
    },
  });
}

/** Membro de time (qualquer role) retorna o team. */
async function getMyTeam(userId: string) {
  const member = await prisma.teamMember.findUnique({
    where: { userId },
    select: { teamId: true, role: true },
  });
  if (!member) return null;
  return prisma.team.findUnique({
    where: { id: member.teamId },
    include: {
      members: {
        select: {
          id: true,
          userId: true,
          role: true,
          status: true,
          invitedEmail: true,
          joinedAt: true,
          user: { select: { name: true, email: true } },
        },
      },
    },
  });
}

export default async function teamRoutes(app: FastifyInstance) {
  const auth = { preHandler: [(app as any).authenticate] };

  // ── GET /teams/mine — time do usuário logado ─────────────────────
  app.get('/mine', auth, async (req: any) => {
    const team = await getMyTeam(req.user.sub);
    if (!team) return { team: null };

    const ownerSub = await prisma.subscription.findUnique({
      where: { userId: team.ownerId },
      select: { planId: true, status: true },
    });
    const plan = ownerSub?.planId
      ? await prisma.plan.findUnique({ where: { id: ownerSub.planId }, select: { name: true, label: true } })
      : null;

    const activeMembers = team.members.filter((m: any) => m.status === 'active').length;
    const totalSeats = team.members.length;

    return {
      team: {
        id: team.id,
        name: team.name,
        slug: team.slug,
        ownerId: team.ownerId,
        createdAt: team.createdAt,
        members: team.members.map((m: any) => ({
          id: m.id,
          userId: m.userId, // usado por outros módulos (ex.: Tarefas) para atribuir a um membro
          name: m.user?.name || m.invitedEmail || 'Convidado',
          email: m.user?.email || m.invitedEmail || '',
          role: m.role,
          status: m.status,
          joinedAt: m.joinedAt,
        })),
        seats: { active: activeMembers, total: totalSeats, max: EMPRESAS_MAX_SEATS },
        billing: {
          // Preço flat do tier Empresas — não é cobrança por seat.
          planPriceMonthly: PLAN_PRICES.empresas,
          planPriceYearly:  PLAN_PRICES_YEARLY.empresas,
        },
        ownerPlan: plan ? { name: plan.name, label: plan.label } : null,
      },
    };
  });

  // ── POST /teams — criar time ─────────────────────────────────────
  app.post<{ Body: { name: string } }>(
    '/',
    { ...auth, config: { rateLimit: { max: 3, timeWindow: '1 hour' } } },
    async (req: any, reply) => {
      const userId = req.user.sub;
      const { name } = req.body || {};
      if (!name || typeof name !== 'string' || name.trim().length < 2) {
        return reply.code(400).send({ error: 'Nome do time precisa ter pelo menos 2 caracteres.' });
      }

      // Multiusuário é exclusivo do plano Empresas.
      const sub = await prisma.subscription.findUnique({ where: { userId }, include: { plan: true } });
      if (sub?.plan?.name !== 'empresas') {
        return reply.code(402).send({ error: 'Times multiusuário são exclusivos do plano Empresas. Veja /dashboard/plano.' });
      }

      // Um usuário só pode ter 1 time (como owner ou member)
      const existing = await prisma.teamMember.findUnique({ where: { userId } });
      if (existing) {
        return reply.code(409).send({ error: 'Você já pertence a um time. Saia do time atual antes de criar um novo.' });
      }

      // Gerar slug único
      const baseSlug = name.trim().toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      let slug = baseSlug || `team-${crypto.randomBytes(4).toString('hex')}`;
      const clash = await prisma.team.findUnique({ where: { slug } });
      if (clash) slug = `${slug}-${crypto.randomBytes(2).toString('hex')}`;

      const team = await prisma.team.create({
        data: {
          name: name.trim(),
          slug,
          ownerId: userId,
          members: {
            create: {
              userId,
              role: 'owner',
              status: 'active',
            },
          },
        },
        include: { members: true },
      });

      return reply.code(201).send({
        ok: true,
        team: {
          id: team.id,
          name: team.name,
          slug: team.slug,
          seats: { active: 1, total: 1 },
        },
        message: 'Time criado! Convide membros para começar.',
      });
    }
  );

  // ── POST /teams/invite — convidar membro por e-mail ──────────────
  app.post<{ Body: { email: string; role?: string } }>(
    '/invite',
    { ...auth, config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    async (req: any, reply) => {
      const userId = req.user.sub;
      const { email, role } = req.body || {};
      if (!email || typeof email !== 'string' || !email.includes('@')) {
        return reply.code(400).send({ error: 'E-mail inválido.' });
      }
      const memberRole = role ?? 'agent';
      if (!INVITE_ROLES.has(memberRole)) {
        return reply.code(400).send({ error: 'Papel inválido. Use admin, manager ou agent.' });
      }

      const team = await getOwnedTeam(userId);
      if (!team) {
        return reply.code(403).send({ error: 'Apenas o dono do time pode convidar membros.' });
      }

      // Multiusuário é exclusivo do plano Empresas — revalida a cada convite
      // (cobre o caso de o dono ter feito downgrade após criar o time).
      const ownerSub = await prisma.subscription.findUnique({ where: { userId }, include: { plan: true } });
      if (ownerSub?.plan?.name !== 'empresas') {
        return reply.code(402).send({ error: 'Times multiusuário são exclusivos do plano Empresas. Veja /dashboard/plano.' });
      }

      // Até EMPRESAS_MAX_SEATS membros no total (já incluído no preço flat do Empresas)
      if (team.members.length >= EMPRESAS_MAX_SEATS) {
        return reply.code(400).send({ error: `Limite de ${EMPRESAS_MAX_SEATS} membros do plano Empresas atingido.` });
      }

      const normalizedEmail = email.trim().toLowerCase();

      // Já está no time?
      const already = team.members.find((m: any) =>
        m.user?.email?.toLowerCase() === normalizedEmail ||
        m.invitedEmail?.toLowerCase() === normalizedEmail
      );
      if (already) {
        return reply.code(409).send({ error: 'Este e-mail já pertence a um membro do time.' });
      }

      const inviteCode = genInviteCode();

      // Verifica se o e-mail já é um usuário cadastrado
      const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
      // Verifica se já pertence a outro time
      if (existingUser) {
        const alreadyInTeam = await prisma.teamMember.findUnique({ where: { userId: existingUser.id } });
        if (alreadyInTeam) {
          return reply.code(409).send({ error: 'Este usuário já pertence a outro time.' });
        }
      }

      await prisma.teamMember.create({
        data: {
          teamId: team.id,
          userId: existingUser?.id || 'pending', // placeholder — será atualizado ao aceitar
          role: memberRole,
          status: 'invited',
          inviteCode,
          invitedEmail: normalizedEmail,
        },
      });

      // Enviar e-mail de convite (best-effort)
      const APP_URL = process.env.APP_URL || 'https://zapscript.me';
      const acceptUrl = `${APP_URL}/dashboard/empresarial?accept=${inviteCode}`;

      sendEmail(
        normalizedEmail,
        `Convite para o time "${team.name}" no ZapScript`,
        `<div style="font-family:sans-serif;max-width:540px;margin:0 auto;background:#050a07;color:#d1fae5;padding:32px;border-radius:12px">
          <div style="font-size:20px;font-weight:bold;margin-bottom:12px">🏢 Convite para o time "${team.name}"</div>
          <p>Você foi convidado(a) para fazer parte do time <strong>${team.name}</strong> no ZapScript.</p>
          <p>Ao aceitar, você terá acesso ao plano <strong>Empresas</strong> compartilhado com os demais membros do time, sem custo adicional para você.</p>
          <div style="margin:24px 0;text-align:center">
            <a href="${acceptUrl}" style="background:#10b981;color:#04130c;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:16px">Aceitar convite →</a>
          </div>
          <p style="font-size:12px;color:#6b7280">Se você não conhece o ZapScript, ignore este e-mail.</p>
        </div>`,
      ).catch(() => {});

      return {
        ok: true,
        message: `Convite enviado para ${normalizedEmail}.`,
        inviteCode, // retornado para debug — em prod, ocultar
      };
    }
  );

  // ── POST /teams/accept — aceitar convite (público, auth requerido) ──
  app.post<{ Body: { inviteCode: string } }>(
    '/accept',
    { ...auth, config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (req: any, reply) => {
      const userId = req.user.sub;
      const { inviteCode } = req.body || {};
      if (!inviteCode || typeof inviteCode !== 'string') {
        return reply.code(400).send({ error: 'Código de convite inválido.' });
      }

      const member = await prisma.teamMember.findUnique({
        where: { inviteCode },
        include: { team: true },
      });
      if (!member || member.status !== 'invited') {
        return reply.code(404).send({ error: 'Convite não encontrado ou já utilizado.' });
      }

      // Verificar se usuário já está em outro time
      const alreadyInTeam = await prisma.teamMember.findUnique({ where: { userId } });
      if (alreadyInTeam && alreadyInTeam.id !== member.id) {
        return reply.code(409).send({ error: 'Você já pertence a outro time. Saia dele antes de aceitar este convite.' });
      }

      // Atualizar o membro com o userId real e status active
      await prisma.teamMember.update({
        where: { id: member.id },
        data: {
          userId,
          status: 'active',
          joinedAt: new Date(),
          inviteCode: null, // invalida o código após uso
        },
      });

      return {
        ok: true,
        team: { id: member.team.id, name: member.team.name },
        message: `Bem-vindo ao time "${member.team.name}"! Você agora tem acesso ao plano Empresas via time.`,
      };
    }
  );

  // ── PATCH /teams/members/:id/role — trocar papel de um membro (owner apenas) ──
  app.patch<{ Params: { id: string }; Body: { role: string } }>('/members/:id/role', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { id } = req.params;
    const { role } = req.body || {};
    if (!INVITE_ROLES.has(role)) {
      return reply.code(400).send({ error: 'Papel inválido. Use admin, manager ou agent.' });
    }

    const member = await prisma.teamMember.findUnique({ where: { id } });
    if (!member) return reply.code(404).send({ error: 'Membro não encontrado.' });

    const requesterMembership = await prisma.teamMember.findUnique({ where: { userId } });
    if (!requesterMembership || requesterMembership.teamId !== member.teamId || requesterMembership.role !== 'owner') {
      return reply.code(403).send({ error: 'Apenas o dono do time pode alterar papéis.' });
    }
    if (member.role === 'owner') {
      return reply.code(400).send({ error: 'O dono do time não muda de papel.' });
    }

    const updated = await prisma.teamMember.update({ where: { id }, data: { role } });
    return { ok: true, member: { id: updated.id, role: updated.role } };
  });

  // ── GET /teams/my-role — papel efetivo do usuário logado (para a UI mostrar/ocultar ações) ──
  app.get('/my-role', auth, async (req: any) => {
    const scope = await resolveTeamScope(req.user.sub);
    return { role: scope.role };
  });

  // ── DELETE /teams/members/:id — remover membro (owner apenas) ────
  app.delete('/members/:id', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { id } = req.params as { id: string };

    const member = await prisma.teamMember.findUnique({
      where: { id },
      include: { team: true },
    });
    if (!member) return reply.code(404).send({ error: 'Membro não encontrado.' });

    // Verificar que o requisitante é owner do time
    const requesterMembership = await prisma.teamMember.findUnique({ where: { userId } });
    if (!requesterMembership || requesterMembership.teamId !== member.teamId || requesterMembership.role !== 'owner') {
      return reply.code(403).send({ error: 'Apenas o dono do time pode remover membros.' });
    }

    // Não pode remover o owner
    if (member.role === 'owner') {
      return reply.code(400).send({ error: 'O dono do time não pode ser removido. Transfira a propriedade primeiro ou delete o time.' });
    }

    await prisma.teamMember.delete({ where: { id } });
    return { ok: true, message: 'Membro removido do time.' };
  });

  // ── DELETE /teams — deletar o time (owner apenas) ─────────────────
  app.delete('/', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const team = await getOwnedTeam(userId);
    if (!team) return reply.code(403).send({ error: 'Apenas o dono do time pode deletá-lo.' });

    await prisma.team.delete({ where: { id: team.id } }); // cascade deleta members
    return { ok: true, message: 'Time deletado.' };
  });

  // ── PUT /teams — atualizar nome do time (owner apenas) ────────────
  app.put<{ Body: { name: string } }>('/', auth, async (req: any, reply) => {
    const userId = req.user.sub;
    const { name } = req.body || {};
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return reply.code(400).send({ error: 'Nome precisa ter pelo menos 2 caracteres.' });
    }

    const team = await getOwnedTeam(userId);
    if (!team) return reply.code(403).send({ error: 'Apenas o dono do time pode editá-lo.' });

    const updated = await prisma.team.update({
      where: { id: team.id },
      data: { name: name.trim() },
    });

    return { ok: true, team: { id: updated.id, name: updated.name, slug: updated.slug } };
  });
}
