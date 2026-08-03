import { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma';
import { requireModuleShared } from '../../lib/teamScope';
import { validateRequest, createTaskSchema, updateTaskSchema, createTaskCommentSchema } from '../../lib/validation';
import { sendText } from '../../services/evolution';

const ASSIGNEE_SELECT = { id: true, name: true, email: true };
const CONTACT_SELECT = { id: true, name: true, phone: true, stageId: true };

/**
 * Módulo Tarefas (tier Empresas) — designação e controle de tarefas dentro
 * do time. Compartilhado de verdade via teamScope (ver lib/teamScope.ts):
 * todo o time (dono + até 5 membros) vê e atua no mesmo quadro de tarefas.
 *
 * Qualquer papel do time (agent+) pode criar, atribuir e concluir tarefas —
 * mesma política de permissão usada nas conversas do Atende.
 */
export default async function tarefasRoutes(app: FastifyInstance) {
  app.addHook('preHandler', (app as any).authenticate);
  app.addHook('preHandler', requireModuleShared('tarefas'));

  /**
   * Valida que assignedToId é o dono ou um membro ativo do mesmo time e já
   * devolve nome/telefone num único round-trip — antes a validação e a busca
   * de dados pra notificação (Tarefas #1) seriam 2 queries separadas.
   */
  async function resolveAssignee(ownerId: string, assignedToId: string): Promise<{ id: string; name: string | null; phone: string | null } | null> {
    if (assignedToId === ownerId) {
      return prisma.user.findUnique({ where: { id: ownerId }, select: { id: true, name: true, phone: true } });
    }
    const member = await prisma.teamMember.findUnique({
      where:  { userId: assignedToId },
      select: { status: true, team: { select: { ownerId: true } }, user: { select: { id: true, name: true, phone: true } } },
    });
    if (!member || member.status !== 'active' || member.team.ownerId !== ownerId) return null;
    return member.user;
  }

  /** Best-effort: nunca deve derrubar a criação/edição da tarefa por causa de falha no envio. */
  async function notifyAssignee(ownerId: string, assignee: { id: string; name: string | null; phone: string | null }, title: string) {
    if (assignee.id === ownerId || !assignee.phone) return; // não notifica autoatribuição nem quem não tem telefone
    try {
      const number = await prisma.whatsappNumber.findFirst({
        where:  { userId: ownerId, status: 'connected', zapiInstanceId: { not: null } },
        select: { zapiInstanceId: true },
      });
      if (!number?.zapiInstanceId) return;
      await sendText(number.zapiInstanceId, assignee.phone, `✅ *Tarefas* — nova tarefa pra você:\n"${title}"`);
    } catch { /* notificação nunca é fatal */ }
  }

  // ── GET /tarefas ──────────────────────────────────────────────────────────
  app.get('/', async (req: any) => {
    const { ownerId } = req.teamScope;
    const { status, assignedToId } = req.query as { status?: string; assignedToId?: string };
    return prisma.task.findMany({
      where: {
        userId: ownerId,
        ...(status ? { status } : {}),
        ...(assignedToId ? { assignedToId } : {}),
      },
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }, { createdAt: 'desc' }],
      include: { assignedTo: { select: ASSIGNEE_SELECT }, contact: { select: CONTACT_SELECT } },
    });
  });

  // ── GET /tarefas/atrasadas ───────────────────────────────────────────────
  // Tarefas #2: pendentes com prazo já vencido — sem isso, dueAt existia mas
  // nada cruzava com "hoje" pra sinalizar atraso (diferente do CRM, que já
  // tem /reminders dedicado).
  app.get('/atrasadas', async (req: any) => {
    const { ownerId } = req.teamScope;
    return prisma.task.findMany({
      where:   { userId: ownerId, status: 'pending', dueAt: { lt: new Date() } },
      orderBy: { dueAt: 'asc' },
      include: { assignedTo: { select: ASSIGNEE_SELECT }, contact: { select: CONTACT_SELECT } },
    });
  });

  // ── POST /tarefas ─────────────────────────────────────────────────────────
  app.post<{ Body: any }>('/', async (req: any, reply) => {
    const { ownerId } = req.teamScope;
    const v = validateRequest(createTaskSchema)(req.body);
    if (!v.valid) return reply.code(400).send({ error: v.error });

    let assignee: { id: string; name: string | null; phone: string | null } | null = null;
    if (v.data.assignedToId) {
      assignee = await resolveAssignee(ownerId, v.data.assignedToId);
      if (!assignee) return reply.code(400).send({ error: 'Responsável precisa ser o dono ou um membro ativo do time.' });
    }

    if (v.data.contactId) {
      const contact = await prisma.crmContact.findFirst({ where: { id: v.data.contactId, userId: ownerId } });
      if (!contact) return reply.code(400).send({ error: 'Contato do CRM não encontrado.' });
    }

    const task = await prisma.task.create({
      data: {
        userId:       ownerId,
        title:        v.data.title,
        description:  v.data.description,
        assignedToId: v.data.assignedToId,
        contactId:    v.data.contactId,
        dueAt:        v.data.dueAt,
      },
      include: { assignedTo: { select: ASSIGNEE_SELECT }, contact: { select: CONTACT_SELECT } },
    });

    if (assignee) notifyAssignee(ownerId, assignee, task.title).catch(() => null);

    return reply.code(201).send(task);
  });

  // ── PATCH /tarefas/:id ────────────────────────────────────────────────────
  app.patch<{ Params: { id: string }; Body: any }>('/:id', async (req: any, reply) => {
    const { ownerId } = req.teamScope;
    const { id } = req.params;

    const existing = await prisma.task.findFirst({ where: { id, userId: ownerId } });
    if (!existing) return reply.code(404).send({ error: 'Tarefa não encontrada' });

    const v = validateRequest(updateTaskSchema)(req.body);
    if (!v.valid) return reply.code(400).send({ error: v.error });
    if (Object.keys(v.data).length === 0) {
      return reply.code(400).send({ error: 'Nenhum campo para atualizar.' });
    }

    let newAssignee: { id: string; name: string | null; phone: string | null } | null = null;
    const isReassignment = v.data.assignedToId !== undefined && v.data.assignedToId !== existing.assignedToId;
    if (v.data.assignedToId) {
      newAssignee = await resolveAssignee(ownerId, v.data.assignedToId);
      if (!newAssignee) return reply.code(400).send({ error: 'Responsável precisa ser o dono ou um membro ativo do time.' });
    }

    if (v.data.contactId) {
      const contact = await prisma.crmContact.findFirst({ where: { id: v.data.contactId, userId: ownerId } });
      if (!contact) return reply.code(400).send({ error: 'Contato do CRM não encontrado.' });
    }

    const data: any = { ...v.data };
    if (data.status === 'done' && existing.status !== 'done') data.completedAt = new Date();
    if (data.status === 'pending') data.completedAt = null;

    const task = await prisma.task.update({
      where: { id },
      data,
      include: { assignedTo: { select: ASSIGNEE_SELECT }, contact: { select: CONTACT_SELECT } },
    });

    if (isReassignment && newAssignee) notifyAssignee(ownerId, newAssignee, task.title).catch(() => null);

    return task;
  });

  // ── DELETE /tarefas/:id ───────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/:id', async (req: any, reply) => {
    const { ownerId } = req.teamScope;
    const { id } = req.params;

    const existing = await prisma.task.findFirst({ where: { id, userId: ownerId } });
    if (!existing) return reply.code(404).send({ error: 'Tarefa não encontrada' });

    await prisma.task.delete({ where: { id } });
    return reply.code(204).send();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Comentários (Tarefas #5) — colaboração leve dentro da tarefa.
  // ═══════════════════════════════════════════════════════════════════════
  app.get<{ Params: { id: string } }>('/:id/comentarios', async (req: any, reply) => {
    const { ownerId } = req.teamScope;
    const task = await prisma.task.findFirst({ where: { id: req.params.id, userId: ownerId } });
    if (!task) return reply.code(404).send({ error: 'Tarefa não encontrada' });

    return prisma.taskComment.findMany({
      where:   { taskId: task.id },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: ASSIGNEE_SELECT } },
    });
  });

  app.post<{ Params: { id: string }; Body: { content?: string } }>('/:id/comentarios', async (req: any, reply) => {
    const { ownerId } = req.teamScope;
    const task = await prisma.task.findFirst({ where: { id: req.params.id, userId: ownerId } });
    if (!task) return reply.code(404).send({ error: 'Tarefa não encontrada' });

    const v = validateRequest(createTaskCommentSchema)(req.body);
    if (!v.valid) return reply.code(400).send({ error: v.error });

    const comment = await prisma.taskComment.create({
      data: { taskId: task.id, userId: req.user.sub, content: v.data.content },
      include: { user: { select: ASSIGNEE_SELECT } },
    });
    return reply.code(201).send(comment);
  });
}
