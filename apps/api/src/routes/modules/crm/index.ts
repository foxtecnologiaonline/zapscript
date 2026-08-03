import { FastifyInstance } from 'fastify';
import { prisma } from '../../../lib/prisma';
import { requireModuleShared, requireTeamRole } from '../../../lib/teamScope';
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
 * Compartilhado de verdade via teamScope (tier Empresas — ver lib/teamScope.ts):
 * membros do time do dono enxergam/atuam no mesmo funil, não numa conta
 * separada. `auth` = qualquer papel (agent+); `authManage` = manager+, pra
 * configuração do funil (estágios).
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
  const auth       = { preHandler: [(app as any).authenticate, requireModuleShared('crm')] };
  const authManage = { preHandler: [(app as any).authenticate, requireModuleShared('crm'), requireTeamRole('manager')] };

  // ═══════════════════════════════════════════════════════════════════════
  // Board — 1 request com estágios + contatos, para montar o Kanban
  // ═══════════════════════════════════════════════════════════════════════
  // CRM #3: teto de segurança no board — funis com milhares de contatos não
  // travam a tela inteira. Board é uma visão geral; pra ver o restante de um
  // estágio específico com paginação de verdade, usar GET /contacts?stageId=.
  const BOARD_CONTACTS_LIMIT = 500;

  app.get('/board', auth, async (req: any) => {
    const { ownerId } = req.teamScope;
    const stages = await getOrSeedStages(ownerId);
    const contacts = await prisma.crmContact.findMany({
      where:   { userId: ownerId },
      orderBy: { lastActivityAt: 'desc' },
      take:    BOARD_CONTACTS_LIMIT,
    });

    const byStage = new Map<string, typeof contacts>();
    for (const c of contacts) {
      const list = byStage.get(c.stageId) ?? [];
      list.push(c);
      byStage.set(c.stageId, list);
    }

    return { stages: stages.map((s: any) => ({ ...s, contacts: byStage.get(s.id) ?? [] })) };
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Estágios (colunas do Kanban) — configuração do funil, manager+
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/stages', auth, async (req: any) => getOrSeedStages(req.teamScope.ownerId));

  app.post('/stages', authManage, async (req: any, reply) => {
    const { ownerId } = req.teamScope;
    const v = validateRequest(createCrmStageSchema)(req.body);
    if (!v.valid) return reply.code(400).send({ error: v.error });

    const count = await prisma.crmStage.count({ where: { userId: ownerId } });
    if (count >= 20) return reply.code(400).send({ error: 'Limite de 20 estágios no funil.' });

    const stage = await prisma.crmStage.create({
      data: { userId: ownerId, name: v.data.name, color: v.data.color ?? '#6b7280', order: count },
    });
    return reply.code(201).send(stage);
  });

  app.patch('/stages/:id', authManage, async (req: any, reply) => {
    const { ownerId } = req.teamScope;
    const v = validateRequest(updateCrmStageSchema)(req.body);
    if (!v.valid) return reply.code(400).send({ error: v.error });

    const stage = await prisma.crmStage.findFirst({ where: { id: req.params.id, userId: ownerId } });
    if (!stage) return reply.code(404).send({ error: 'Estágio não encontrado.' });

    return prisma.crmStage.update({ where: { id: stage.id }, data: v.data });
  });

  app.delete('/stages/:id', authManage, async (req: any, reply) => {
    const { ownerId } = req.teamScope;
    const stage = await prisma.crmStage.findFirst({ where: { id: req.params.id, userId: ownerId } });
    if (!stage) return reply.code(404).send({ error: 'Estágio não encontrado.' });

    const totalStages = await prisma.crmStage.count({ where: { userId: ownerId } });
    if (totalStages <= 1) return reply.code(400).send({ error: 'O funil precisa de ao menos 1 estágio.' });

    const contactCount = await prisma.crmContact.count({ where: { stageId: stage.id } });
    if (contactCount > 0) {
      return reply.code(400).send({ error: `Mova o(s) ${contactCount} contato(s) deste estágio antes de excluí-lo.` });
    }

    await prisma.crmStage.delete({ where: { id: stage.id } });
    return reply.code(204).send();
  });

  app.post('/stages/reorder', authManage, async (req: any, reply) => {
    const { ownerId } = req.teamScope;
    const v = validateRequest(reorderCrmStagesSchema)(req.body);
    if (!v.valid) return reply.code(400).send({ error: v.error });

    const stages = await prisma.crmStage.findMany({ where: { userId: ownerId }, select: { id: true } });
    const validIds = new Set(stages.map((s: any) => s.id));
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
  // CRM #3: paginação por cursor (id da última linha da página anterior) —
  // antes carregava todos os contatos do usuário numa única resposta.
  app.get('/contacts', auth, async (req: any) => {
    const { ownerId } = req.teamScope;
    const { stageId, cursor } = req.query as { stageId?: string; cursor?: string };
    const limit = Math.min(200, Math.max(1, parseInt((req.query as any)?.limit, 10) || 50));

    return prisma.crmContact.findMany({
      where:   { userId: ownerId, ...(stageId ? { stageId } : {}) },
      orderBy: [{ lastActivityAt: 'desc' }, { id: 'desc' }],
      take:    limit,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
  });

  app.get('/contacts/:id', auth, async (req: any, reply) => {
    const { ownerId } = req.teamScope;
    const contact = await prisma.crmContact.findFirst({
      where:   { id: req.params.id, userId: ownerId },
      include: { stage: true, activities: { orderBy: { createdAt: 'desc' } } },
    });
    if (!contact) return reply.code(404).send({ error: 'Contato não encontrado.' });
    return contact;
  });

  app.post('/contacts', auth, async (req: any, reply) => {
    const { ownerId } = req.teamScope;
    const v = validateRequest(createCrmContactSchema)(req.body);
    if (!v.valid) return reply.code(400).send({ error: v.error });

    const stages = await getOrSeedStages(ownerId);
    let stageId = v.data.stageId;
    if (stageId) {
      if (!stages.some((s: any) => s.id === stageId)) return reply.code(400).send({ error: 'Estágio inválido.' });
    } else {
      stageId = stages[0].id;
    }

    try {
      const contact = await prisma.crmContact.create({
        data: {
          userId: ownerId,
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

  app.patch('/contacts/:id', auth, async (req: any, reply) => {
    const { ownerId } = req.teamScope;
    const v = validateRequest(updateCrmContactSchema)(req.body);
    if (!v.valid) return reply.code(400).send({ error: v.error });

    const contact = await prisma.crmContact.findFirst({ where: { id: req.params.id, userId: ownerId } });
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
  app.patch('/contacts/:id/move', auth, async (req: any, reply) => {
    const { ownerId } = req.teamScope;
    const v = validateRequest(moveCrmContactSchema)(req.body);
    if (!v.valid) return reply.code(400).send({ error: v.error });

    const contact = await prisma.crmContact.findFirst({
      where:   { id: req.params.id, userId: ownerId },
      include: { stage: true },
    });
    if (!contact) return reply.code(404).send({ error: 'Contato não encontrado.' });

    const targetStage = await prisma.crmStage.findFirst({ where: { id: v.data.stageId, userId: ownerId } });
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
          userId:    ownerId,
          type:      'stage_change',
          content:   `Moveu de "${contact.stage.name}" para "${targetStage.name}"`,
        },
      }),
    ]);

    return updated;
  });

  app.delete('/contacts/:id', auth, async (req: any, reply) => {
    const { ownerId } = req.teamScope;
    const contact = await prisma.crmContact.findFirst({ where: { id: req.params.id, userId: ownerId } });
    if (!contact) return reply.code(404).send({ error: 'Contato não encontrado.' });
    await prisma.crmContact.delete({ where: { id: contact.id } });
    return reply.code(204).send();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Atividades — notas, ligações, reuniões e lembretes na timeline do contato
  // ═══════════════════════════════════════════════════════════════════════
  app.post('/contacts/:id/activities', auth, async (req: any, reply) => {
    const { ownerId } = req.teamScope;
    const v = validateRequest(createCrmActivitySchema)(req.body);
    if (!v.valid) return reply.code(400).send({ error: v.error });
    if (v.data.type === 'reminder' && !v.data.dueAt) {
      return reply.code(400).send({ error: 'Lembretes exigem uma data (dueAt).' });
    }

    const contact = await prisma.crmContact.findFirst({ where: { id: req.params.id, userId: ownerId } });
    if (!contact) return reply.code(404).send({ error: 'Contato não encontrado.' });

    const [activity] = await prisma.$transaction([
      prisma.crmActivity.create({
        data: {
          contactId: contact.id,
          userId:    ownerId,
          type:      v.data.type,
          content:   v.data.content,
          dueAt:     v.data.dueAt,
        },
      }),
      prisma.crmContact.update({ where: { id: contact.id }, data: { lastActivityAt: new Date() } }),
    ]);

    return reply.code(201).send(activity);
  });

  app.patch('/activities/:id/complete', auth, async (req: any, reply) => {
    const { ownerId } = req.teamScope;
    const activity = await prisma.crmActivity.findFirst({ where: { id: req.params.id, userId: ownerId } });
    if (!activity) return reply.code(404).send({ error: 'Atividade não encontrada.' });
    if (activity.type !== 'reminder') return reply.code(400).send({ error: 'Somente lembretes podem ser concluídos.' });

    return prisma.crmActivity.update({ where: { id: activity.id }, data: { completedAt: new Date() } });
  });

  // Lembretes pendentes de todos os contatos (widget de "hoje"/atrasados).
  app.get('/reminders', auth, async (req: any) => {
    const { ownerId } = req.teamScope;
    return prisma.crmActivity.findMany({
      where:   { userId: ownerId, type: 'reminder', completedAt: null },
      orderBy: { dueAt: 'asc' },
      include: { contact: { select: { id: true, name: true, phone: true, stageId: true } } },
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Dashboard — KPIs de negócio (tier Empresas). Lê só dados já existentes
  // (CrmContact/CrmActivity + AtendeConversation).
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/dashboard', auth, async (req: any) => {
    const { ownerId } = req.teamScope;
    const days  = Math.min(365, Math.max(1, parseInt((req.query as any)?.days, 10) || 30));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [wonContacts, negociosPerdidos, novosLeads, atendimentosSemana, topActivity] = await Promise.all([
      prisma.crmContact.findMany({
        where:  { userId: ownerId, closedAt: { gte: since }, stage: { isWon: true } },
        select: { id: true, value: true },
      }),
      prisma.crmContact.count({ where: { userId: ownerId, closedAt: { gte: since }, stage: { isLost: true } } }),
      prisma.crmContact.count({ where: { userId: ownerId, createdAt: { gte: since } } }),
      prisma.atendeConversation.count({ where: { userId: ownerId, lastMessageAt: { gte: weekAgo } } }).catch(() => 0),
      prisma.crmActivity.groupBy({
        by:      ['contactId'],
        where:   { userId: ownerId, createdAt: { gte: since } },
        _count:  { contactId: true },
        orderBy: { _count: { contactId: 'desc' } },
        take:    5,
      }),
    ]);

    const topIds = topActivity.map((t: any) => t.contactId);
    const topContacts = topIds.length
      ? await prisma.crmContact.findMany({
          where:  { id: { in: topIds } },
          select: { id: true, name: true, phone: true, company: true, value: true },
        })
      : [];
    const topClientes = topActivity
      .map((t: any) => {
        const c = topContacts.find((x: any) => x.id === t.contactId);
        return c ? { ...c, activityCount: t._count.contactId } : null;
      })
      .filter(Boolean);

    // CRM #4: negócio fechado (won) sem `value` preenchido some silenciosamente
    // do faturamentoFechado — sinaliza pra o dono corrigir o cadastro em vez de
    // deixar o KPI de receita furado sem ninguém perceber.
    const fechadosSemValor = wonContacts.filter((c: any) => !c.value).length;

    return {
      periodDays:         days,
      faturamentoFechado: wonContacts.reduce((sum: number, c: any) => sum + (c.value || 0), 0),
      negociosFechados:   wonContacts.length,
      negociosFechadosSemValor: fechadosSemValor,
      negociosPerdidos,
      novosLeads,
      atendimentosSemana,
      topClientes,
    };
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Importar do WhatsApp — sugestões a partir do histórico de Transcription
  // (zero alteração no webhook de mensageria; só lê dados já existentes)
  // ═══════════════════════════════════════════════════════════════════════
  // CRM #2: agrupamento (última ocorrência por telefone) feito no banco via
  // DISTINCT ON/window function, em vez de puxar até 2000 linhas pra memória
  // do Node e reduzir com um Map — mais rápido e escala melhor com o histórico.
  app.get('/import/suggestions', auth, async (req: any) => {
    const { ownerId } = req.teamScope;

    const rows = await prisma.$queryRaw<
      { phone: string; name: string | null; numberId: string | null; lastAt: Date; count: bigint }[]
    >`
      WITH normalized AS (
        SELECT regexp_replace("contactPhone", '\D', '', 'g') AS phone,
               "contactName" AS name,
               "numberId",
               "createdAt"
        FROM "Transcription"
        WHERE "userId" = ${ownerId}
      ), ranked AS (
        SELECT phone, name, "numberId", "createdAt" AS "lastAt",
               COUNT(*) OVER (PARTITION BY phone) AS count,
               ROW_NUMBER() OVER (PARTITION BY phone ORDER BY "createdAt" DESC) AS rn
        FROM normalized
        WHERE phone != ''
      )
      SELECT phone, name, "numberId", "lastAt", count
      FROM ranked
      WHERE rn = 1
        AND phone NOT IN (SELECT phone FROM "CrmContact" WHERE "userId" = ${ownerId})
      ORDER BY "lastAt" DESC
      LIMIT 100
    `;

    const suggestions = rows.map((r) => ({
      phone: r.phone, name: r.name, numberId: r.numberId, lastAt: r.lastAt, count: Number(r.count),
    }));

    return { suggestions };
  });

  app.post('/import', auth, async (req: any, reply) => {
    const { ownerId } = req.teamScope;
    const v = validateRequest(crmImportSchema)(req.body);
    if (!v.valid) return reply.code(400).send({ error: v.error });

    const stages = await getOrSeedStages(ownerId);
    const defaultStageId = stages[0].id;

    const rows = await prisma.transcription.findMany({
      where:   { userId: ownerId, contactPhone: { in: v.data.phones } },
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
            userId: ownerId,
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
            userId:    ownerId,
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
