import { prisma } from '../../lib/prisma';
import { emitToUser } from '../core/realtime';

/** Notificações internas (BvNotification) + push por socket (`notification` na sala do usuário). */
export interface NotificationInput { type: string; title: string; body?: string | null; data?: Record<string, unknown> }

/** Cria uma notificação por usuário (ignora duplicados, tokens de API e usuários de outro órgão/inativos). */
export async function notifyUsers(orgId: string, userIds: Array<string | null | undefined>, n: NotificationInput): Promise<number> {
  const ids = [...new Set(userIds.filter((x): x is string => !!x && !x.startsWith('token:')))];
  if (!ids.length) return 0;
  const valid = await prisma.bvUser.findMany({ where: { orgId, id: { in: ids }, active: true }, select: { id: true } });
  let count = 0;
  for (const u of valid) {
    const row = await prisma.bvNotification.create({
      data: { orgId, userId: u.id, type: n.type, title: n.title.slice(0, 200), body: n.body?.slice(0, 1000) ?? null, data: (n.data ?? undefined) as any },
    });
    emitToUser(u.id, 'notification', { id: row.id, type: row.type, title: row.title, body: row.body, data: row.data, createdAt: row.createdAt });
    count++;
  }
  return count;
}

export async function supervisorIds(orgId: string, limit = 20): Promise<string[]> {
  return (await prisma.bvUser.findMany({ where: { orgId, active: true, role: { in: ['SUPERVISOR', 'ADMIN'] } }, select: { id: true }, take: limit })).map((u) => u.id);
}

export async function sectorUserIds(orgId: string, sectorId: string, limit = 50): Promise<string[]> {
  return (await prisma.bvUser.findMany({ where: { orgId, sectorId, active: true }, select: { id: true }, take: limit })).map((u) => u.id);
}

/** Quem responde pela tarefa: o responsável; senão os usuários do setor; senão os supervisores. */
export async function responsibleIds(orgId: string, t: { assigneeId: string | null; sectorId: string | null }): Promise<string[]> {
  if (t.assigneeId) return [t.assigneeId];
  if (t.sectorId) {
    const ids = await sectorUserIds(orgId, t.sectorId);
    if (ids.length) return ids;
  }
  return supervisorIds(orgId);
}

export async function listNotifications(orgId: string, userId: string, o: { unread?: boolean; limit: number; cursor?: string }) {
  const rows = await prisma.bvNotification.findMany({
    where: { orgId, userId, ...(o.unread ? { readAt: null } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: o.limit + 1, ...(o.cursor ? { cursor: { id: o.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > o.limit;
  const items = hasMore ? rows.slice(0, o.limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

export const unreadCount = (orgId: string, userId: string) => prisma.bvNotification.count({ where: { orgId, userId, readAt: null } });

export async function markRead(orgId: string, userId: string, id: string): Promise<boolean> {
  const r = await prisma.bvNotification.updateMany({ where: { id, orgId, userId, readAt: null }, data: { readAt: new Date() } });
  if (r.count > 0) return true;
  return !!(await prisma.bvNotification.findFirst({ where: { id, orgId, userId }, select: { id: true } }));
}

export async function markAllRead(orgId: string, userId: string): Promise<number> {
  return (await prisma.bvNotification.updateMany({ where: { orgId, userId, readAt: null }, data: { readAt: new Date() } })).count;
}
