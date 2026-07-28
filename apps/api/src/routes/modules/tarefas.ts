import { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma';
import { requireModuleShared } from '../../lib/teamScope';
import { validateRequest, createTaskSchema, updateTaskSchema } from '../../lib/validation';

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

  /** Valida que assignedToId (se informado) é o dono ou um membro ativo do mesmo time. */
  async function isValidAssignee(ownerId: string, assignedToId: string): Promise<boolean> {
    if (assignedToId === ownerId) return true;
    const member = await prisma.teamMember.findUnique({
      where:  { userId: assignedToId },
      select: { status: true, team: { select: { ownerId: true } } },
    });
    return !!member && member.status === 'active' && member.team.ownerId === ownerId;
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
      include: { assignedTo: { select: { id: true, name: true, email: true } } },
    });
  });

  // ── POST /tarefas ─────────────────────────────────────────────────────────
  app.post<{ Body: any }>('/', async (req: any, reply) => {
    const { ownerId } = req.teamScope;
    const v = validateRequest(createTaskSchema)(req.body);
    if (!v.valid) return reply.code(400).send({ error: v.error });

    if (v.data.assignedToId && !(await isValidAssignee(ownerId, v.data.assignedToId))) {
      return reply.code(400).send({ error: 'Responsável precisa ser o dono ou um membro ativo do time.' });
    }

    const task = await prisma.task.create({
      data: {
        userId:       ownerId,
        title:        v.data.title,
        description:  v.data.description,
        assignedToId: v.data.assignedToId,
        dueAt:        v.data.dueAt,
      },
      include: { assignedTo: { select: { id: true, name: true, email: true } } },
    });
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

    if (v.data.assignedToId && !(await isValidAssignee(ownerId, v.data.assignedToId))) {
      return reply.code(400).send({ error: 'Responsável precisa ser o dono ou um membro ativo do time.' });
    }

    const data: any = { ...v.data };
    if (data.status === 'done' && existing.status !== 'done') data.completedAt = new Date();
    if (data.status === 'pending') data.completedAt = null;

    const task = await prisma.task.update({
      where: { id },
      data,
      include: { assignedTo: { select: { id: true, name: true, email: true } } },
    });
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
}
