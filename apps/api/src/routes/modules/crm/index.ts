import { FastifyInstance } from 'fastify';
import { prisma } from '../../../lib/prisma';
import { requireModule } from '../../../lib/moduleGate';
import {
  validateRequest,
  createCrmStageSchema,
  updateCrmStageSchema,
  reorderCrmStagesSchema,
  createCrmContactSchema,
  updateCrmContactSchema,
  moveCrmContactSchema,
  createCrmActivitySchema,
  crmImportSchema,
} from '../../../lib/validation';

/**
 * Módulo CRM — funil de vendas dentro do WhatsApp (ver MODULOS_ARQUITETURA.md).
 *
 * v1 é gerenciado manualmente: usuário arrasta contatos entre estágios do
 * Kanban, adiciona notas/lembretes, e pode importar contatos 1-clique a
 * partir do histórico de Transcription. NÃO há captura automática de leads
 * a partir de mensagens do WhatsApp nesta versão (ver evolution-webhook.ts,
 * que continua intocado) — isso fica para uma fase 2.
 *
 * Toda rota exige o módulo `crm` contratado (Entitlement).
 */

const DEFAULT_STAGES = [
  { name: 'Novo lead',     order: 0, color: '#3b82f6' },
  { name: 'Contato feito', order: 1, color: '#eab308' },
  { name: 'Negociando',    order: 2, color: '#f97316' },
  { name: 'Fechado',       order: 3, color: '#22c55e', isWon: true },
  { name: 'Perdido',       order: 4, color: '#ef4444', isLost: true },
];

/** Retorna os estágios do usuário (ordenados); semeia os 5 padrões no 1º acesso. */
async function getOrSeedStages(userId: string) {
  let stages = await prisma.crmStage.findMany({ where: { userId }, orderBy: { order: 'asc' } });
  if (stages.length === 0) {
    await prisma.crmStage.createMany({ data: DEFAULT_STAGES.map((s) => ({ userId, ...s })) });
    stages = await prisma.crmStage.findMany({ where: { userId }, orderBy: { order: 'asc' } });
  }
  return stages;
}

export default async function crmRoutes(app: FastifyInstance) {
  app.addHook('preHandler', (app as any).authenticate);
  app.addHook('preHandler', requireModule('crm'));

  // ═══════════════════════════════════════════════════════════════════════
  // Board — 1 request com estágios + contatos, para montar o Kanban
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/board', async (req: any) => {
    const userId = req.user.sub;
    const stages = await getOrSeedStages(userId);
    const contacts = await prisma.crmContact.findMany({
      where:   { userId },
      orderBy: { lastActivityAt: 'desc' },
    });

    const byStage = new Map<string, typeof contacts>();
    for (const c of contacts) {
      const list = byStage.get(c.stageId) ?? [];
      list.push(c);
      byStage.set(c.stageId, list);
    }

    return { stages: stages.map((s) => ({ ...s, contacts: byStage.get(s.id) ?? [] })) };
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Estágios (colunas do Kanban)
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/stages', async (req: any) => getOrSeedStages(req.user.sub));

  app.post('/stages', async (req: any, reply) => {
    const userId = req.user.sub;
    const v = validateRequest(createCrmStageSchema)(req.body);
    if (!v.valid) return reply.code(400).send({ error: v.error });

    const count = await prisma.crmStage.count({ where: { userId } });
    if (count >= 20) return reply.code(400).send({ error: 'Limite de 20 estágios no funil.' });

    const stage = await prisma.crmStage.create({
      data: { userId, name: v.data.name, color: v.data.color ?? '#6b7280', order: count },
    });
    return reply.code(201).send(stage);
  });

  app.patch('/stages/:id', async (req: any, reply) => {
    const userId = req.user.sub;
    const v = validateRequest(updateCrmStageSchema)(req.body);
    if (!v.valid) return reply.code(400).send({ error: v.error });

    const stage = await prisma.crmStage.findFirst({ where: { id: req.params.id, userId } });
    if (!stage) return reply.code(404).send({ error: 'Estágio não encontrado.' });

    return prisma.crmStage.update({ where: { id: stage.id }, data: v.data });
  });

  app.delete('/stages/:id', async (req: any, reply) => {
    const userId = req.user.sub;
    const stage = await prisma.crmStage.findFirst({ where: { id: req.params.id, userId } });
    if (!stage) return reply.code(404).send({ error: 'Estágio não encontrado.' });

    const totalStages = await prisma.crmStage.count({ where: { userId } });
    if (totalStages <= 1) return reply.code(400).send({ error: 'O funil precisa de ao menos 1 estágio.' });

    const contactCount = await prisma.crmContact.count({ where: { stageId: stage.id } });
    if (contactCount > 0) {
      return reply.code(400).send({ error: `Mova o(s) ${contactCount} contato(s) deste estágio antes de excluí-lo.` });
    }

    await prisma.crmStage.delete({ where: { id: stage.id } });
    return reply.code(204).send();
  });

  app.post('/stages/reorder', async (req: any, reply) => {
    const userId = req.user.sub;
    const v = validateRequest(reorderCrmStagesSchema)(req.body);
    if (!v.valid) return reply.code(400).send({ error: v.error });

    const stages = await prisma.crmStage.findMany({ where: { userId }, select: { id: true } });
    const validIds = new Set(stages.map((s) => s.id));
    if (v.data.order.length !== stages.length || !v.data.order.every((id) => validIds.has(id))) {
      return reply.code(400).send({ error: 'A lista deve conter exatamente os estágios existentes do funil.' });
    }

    await prisma.$transaction(
      v.data.order.map((id, index) => prisma.crmStage.update({ where: { id }, data: { order: index } })),
    );
    return { ok: true };
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Contatos
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/contacts', async (req: any) => {
    const userId = req.user.sub;
    const { stageId } = req.query as { stageId?: string };
    return prisma.crmContact.findMany({
      where:   { userId, ...(stageId ? { stageId } : {}) },
      orderBy: { lastActivityAt: 'desc' },
    });
  });

  app.get('/contacts/:id', async (req: any, reply) => {
    const userId = req.user.sub;
    const contact = await prisma.crmContact.findFirst({
      where:   { id: req.params.id, userId },
      include: { stage: true, activities: { orderBy: { createdAt: 'desc' } } },
    });
    if (!contact) return reply.code(404).send({ error: 'Contato não encontrado.' });
    return contact;
  });

  app.post('/contacts', async (req: any, reply) => {
    const userId = req.user.sub;
    const v = validateRequest(createCrmContactSchema)(req.body);
    if (!v.valid) return reply.code(400).send({ error: v.error });

    const stages = await getOrSeedStages(userId);
    let stageId = v.data.stageId;
    if (stageId) {
      if (!stages.some((s) => s.id === stageId)) return reply.code(400).send({ error: 'Estágio inválido.' });
    } else {
      stageId = stages[0].id;
    }

    try {
      const contact = await prisma.crmContact.create({
        data: {
          userId,
          stageId,
          name:    v.data.name,
          phone:   v.data.phone,
          email:   v.data.email,
          company: v.data.company,
          value:   v.data.value,
          tags:    v.data.tags ?? [],
          source:  'manual',
        },
      });
      return reply.code(201).send(contact);
    } catch (err: any) {
      if (err?.code === 'P2002') return reply.code(409).send({ error: 'Já existe um contato com este telefone.' });
      throw err;
    }
  });

  app.patch('/contacts/:id', async (req: any, reply) => {
    const userId = req.user.sub;
    const v = validateRequest(updateCrmContactSchema)(req.body);
    if (!v.valid) return reply.code(400).send({ error: v.error });

    const contact = await prisma.crmContact.findFirst({ where: { id: req.params.id, userId } });
    if (!contact) return reply.code(404).send({ error: 'Contato não encontrado.' });

    try {
      return await prisma.crmContact.update({ where: { id: contact.id }, data: v.data as any });
    } catch (err: any) {
      if (err?.code === 'P2002') return reply.code(409).send({ error: 'Já existe um contato com este telefone.' });
      throw err;
    }
  });

  // Mover contato entre estágios (drag-and-drop do Kanban). Loga stage_change
  // e fecha o negócio (closedAt) quando o estágio destino é isWon/isLost.
  app.patch('/contacts/:id/move', async (req: any, reply) => {
    const userId = req.user.sub;
    const v = validateRequest(moveCrmContactSchema)(req.body);
    if (!v.valid) return reply.code(400).send({ error: v.error });

    const contact = await prisma.crmContact.findFirst({
      where:   { id: req.params.id, userId },
      include: { stage: true },
    });
    if (!contact) return reply.code(404).send({ error: 'Contato não encontrado.' });

    const targetStage = await prisma.crmStage.findFirst({ where: { id: v.data.stageId, userId } });
    if (!targetStage) return reply.code(400).send({ error: 'Estágio inválido.' });

    if (targetStage.id === contact.stageId) return contact; // no-op

    const now = new Date();
    const [updated] = await prisma.$transaction([
      prisma.crmContact.update({
        where: { id: contact.id },
        data: {
          stageId:        targetStage.id,
          lastActivityAt: now,
          closedAt:       targetStage.isWon || targetStage.isLost ? now : null,
          lostReason:     targetStage.isLost ? (v.data.lostReason ?? contact.lostReason) : null,
        },
      }),
      prisma.crmActivity.create({
        data: {
          contactId: contact.id,
          userId,
          type:      'stage_change',
          content:   `Moveu de "${contact.stage.name}" para "${targetStage.name}"`,
        },
      }),
    ]);

    return updated;
  });

  app.delete('/contacts/:id', async (req: any, reply) => {
    const userId = req.user.sub;
    const contact = await prisma.crmContact.findFirst({ where: { id: req.params.id, userId } });
    if (!contact) return reply.code(404).send({ error: 'Contato não encontrado.' });
    await prisma.crmContact.delete({ where: { id: contact.id } });
    return reply.code(204).send();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Atividades — notas, ligações, reuniões e lembretes na timeline do contato
  // ═══════════════════════════════════════════════════════════════════════
  app.post('/contacts/:id/activities', async (req: any, reply) => {
    const userId = req.user.sub;
    const v = validateRequest(createCrmActivitySchema)(req.body);
    if (!v.valid) return reply.code(400).send({ error: v.error });
    if (v.data.type === 'reminder' && !v.data.dueAt) {
      return reply.code(400).send({ error: 'Lembretes exigem uma data (dueAt).' });
    }

    const contact = await prisma.crmContact.findFirst({ where: { id: req.params.id, userId } });
    if (!contact) return reply.code(404).send({ error: 'Contato não encontrado.' });

    const [activity] = await prisma.$transaction([
      prisma.crmActivity.create({
        data: {
          contactId: contact.id,
          userId,
          type:      v.data.type,
          content:   v.data.content,
          dueAt:     v.data.dueAt,
        },
      }),
      prisma.crmContact.update({ where: { id: contact.id }, data: { lastActivityAt: new Date() } }),
    ]);

    return reply.code(201).send(activity);
  });

  app.patch('/activities/:id/complete', async (req: any, reply) => {
    const userId = req.user.sub;
    const activity = await prisma.crmActivity.findFirst({ where: { id: req.params.id, userId } });
    if (!activity) return reply.code(404).send({ error: 'Atividade não encontrada.' });
    if (activity.type !== 'reminder') return reply.code(400).send({ error: 'Somente lembretes podem ser concluídos.' });

    return prisma.crmActivity.update({ where: { id: activity.id }, data: { completedAt: new Date() } });
  });

  // Lembretes pendentes de todos os contatos (widget de "hoje"/atrasados).
  app.get('/reminders', async (req: any) => {
    const userId = req.user.sub;
    return prisma.crmActivity.findMany({
      where:   { userId, type: 'reminder', completedAt: null },
      orderBy: { dueAt: 'asc' },
      include: { contact: { select: { id: true, name: true, phone: true, stageId: true } } },
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Importar do WhatsApp — sugestões a partir do histórico de Transcription
  // (zero alteração no webhook de mensageria; só lê dados já existentes)
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/import/suggestions', async (req: any) => {
    const userId = req.user.sub;

    const rows = await prisma.transcription.findMany({
      where:   { userId },
      select:  { contactPhone: true, contactName: true, numberId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take:    2000,
    });

    const byPhone = new Map<string, { phone: string; name: string | null; numberId: string | null; lastAt: Date; count: number }>();
    for (const r of rows) {
      const phone = r.contactPhone.replace(/\D/g, '');
      if (!phone) continue;
      const existing = byPhone.get(phone);
      if (existing) {
        existing.count += 1; // linhas vêm desc — a 1ª ocorrência já é a mais recente
      } else {
        byPhone.set(phone, { phone, name: r.contactName, numberId: r.numberId, lastAt: r.createdAt, count: 1 });
      }
    }

    const already = new Set(
      (await prisma.crmContact.findMany({ where: { userId }, select: { phone: true } })).map((c) => c.phone),
    );

    const suggestions = [...byPhone.values()]
      .filter((s) => !already.has(s.phone))
      .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime())
      .slice(0, 100);

    return { suggestions };
  });

  app.post('/import', async (req: any, reply) => {
    const userId = req.user.sub;
    const v = validateRequest(crmImportSchema)(req.body);
    if (!v.valid) return reply.code(400).send({ error: v.error });

    const stages = await getOrSeedStages(userId);
    const defaultStageId = stages[0].id;

    const rows = await prisma.transcription.findMany({
      where:   { userId, contactPhone: { in: v.data.phones } },
      select:  { contactPhone: true, contactName: true, numberId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    const latestByPhone = new Map<string, { name: string | null; numberId: string | null }>();
    for (const r of rows) {
      const phone = r.contactPhone.replace(/\D/g, '');
      if (!latestByPhone.has(phone)) latestByPhone.set(phone, { name: r.contactName, numberId: r.numberId });
    }

    const imported: string[] = [];
    const skipped: string[] = [];

    for (const phone of v.data.phones) {
      const info = latestByPhone.get(phone);
      if (!info) { skipped.push(phone); continue; }
      try {
        const contact = await prisma.crmContact.create({
          data: {
            userId,
            stageId:  defaultStageId,
            name:     info.name || phone,
            phone,
            numberId: info.numberId ?? undefined,
            source:   'import_whatsapp',
          },
        });
        await prisma.crmActivity.create({
          data: {
            contactId: contact.id,
            userId,
            type:      'note',
            content:   'Importado do histórico de transcrições do WhatsApp.',
          },
        });
        imported.push(phone);
      } catch (err: any) {
        if (err?.code === 'P2002') { skipped.push(phone); continue; }
        throw err;
      }
    }

    return reply.code(201).send({ imported, skipped });
  });
}
