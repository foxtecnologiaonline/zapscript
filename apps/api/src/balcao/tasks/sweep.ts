import type { BvTask } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { emitBvEvent } from '../core/events';
import { emitToSupervisors } from '../core/realtime';
import { OPEN_STATUSES } from './model';
import { notifyUsers, responsibleIds, supervisorIds } from './notifications';

/**
 * Varredura periódica (`balcao.tasks.sweep`, ~60 s): vencimento próximo (24 h / 1 h), vencidas e violação de SLA.
 * Cada aviso é registrado UMA vez por tarefa em BvTaskHistory (campos `sys.*` ocultos; `sla.breach` visível), então
 * rodar o job várias vezes (ou em duas réplicas) não duplica notificações nem eventos `sla.breach`.
 */
const BATCH = 500;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export interface SweepResult { scanned: number; due24h: number; due1h: number; overdue: number; breaches: number }

export async function runTasksSweep(now = new Date()): Promise<SweepResult> {
  const out: SweepResult = { scanned: 0, due24h: 0, due1h: 0, overdue: 0, breaches: 0 };
  const horizon = new Date(now.getTime() + DAY_MS);
  const supCache = new Map<string, string[]>();
  const sups = async (orgId: string) => { if (!supCache.has(orgId)) supCache.set(orgId, await supervisorIds(orgId)); return supCache.get(orgId)!; };

  // Pagina por id até esgotar (tarefas já avisadas continuam elegíveis e não podem "esconder" as novas).
  let lastId: string | undefined;
  for (;;) {
    const tasks = await prisma.bvTask.findMany({
      where: {
        status: { in: OPEN_STATUSES },
        OR: [{ dueAt: { lte: horizon } }, { slaResolutionDueAt: { lte: now } }, { slaResponseDueAt: { lte: now }, respondedAt: null }],
      },
      orderBy: { id: 'asc' }, take: BATCH, ...(lastId ? { cursor: { id: lastId }, skip: 1 } : {}),
    });
    if (!tasks.length) break;
    lastId = tasks[tasks.length - 1].id;
    out.scanned += tasks.length;
    await sweepBatch(tasks, now, out, sups);
    if (tasks.length < BATCH) break;
  }
  return out;
}

async function sweepBatch(tasks: BvTask[], now: Date, out: SweepResult, sups: (orgId: string) => Promise<string[]>): Promise<void> {
  const markers = await prisma.bvTaskHistory.findMany({
    where: { taskId: { in: tasks.map((t) => t.id) }, field: { in: ['sys.due24h', 'sys.due1h', 'sys.overdue', 'sla.breach'] } },
    select: { taskId: true, field: true, toValue: true },
  });
  const done = new Set(markers.map((m) => `${m.taskId}|${m.field}|${m.field === 'sla.breach' ? m.toValue : ''}`));
  const mark = async (taskId: string, field: string, value: string | null = null) => {
    await prisma.bvTaskHistory.create({ data: { taskId, field, toValue: value } });
    done.add(`${taskId}|${field}|${field === 'sla.breach' ? value : ''}`);
  };
  const seen = (taskId: string, field: string, value = '') => done.has(`${taskId}|${field}|${field === 'sla.breach' ? value : ''}`);

  for (const t of tasks) {
    try {
      const data = { taskId: t.id, code: t.code };
      const who = () => responsibleIds(t.orgId, t);
      const due = t.dueAt;

      if (due) {
        const left = due.getTime() - now.getTime();
        if (left > 0 && left <= HOUR_MS && !seen(t.id, 'sys.due1h')) {
          await mark(t.id, 'sys.due1h'); await mark(t.id, 'sys.due24h'); // ≤ 1 h já cobre o aviso de 24 h
          await notifyUsers(t.orgId, await who(), { type: 'task.due_soon', title: `Tarefa ${t.code} vence em menos de 1 hora`, body: t.title, data: { ...data, dueAt: due, window: '1h' } });
          out.due1h++;
        } else if (left > HOUR_MS && left <= DAY_MS && !seen(t.id, 'sys.due24h')) {
          await mark(t.id, 'sys.due24h');
          await notifyUsers(t.orgId, await who(), { type: 'task.due_soon', title: `Tarefa ${t.code} vence em menos de 24 horas`, body: t.title, data: { ...data, dueAt: due, window: '24h' } });
          out.due24h++;
        } else if (left <= 0 && !seen(t.id, 'sys.overdue')) {
          await mark(t.id, 'sys.overdue');
          await notifyUsers(t.orgId, [...(await who()), ...(await sups(t.orgId))], { type: 'task.overdue', title: `Tarefa ${t.code} vencida`, body: t.title, data: { ...data, dueAt: due } });
          out.overdue++;
        }
      }

      const breaches: Array<{ kind: 'task.response' | 'task.resolution'; label: string; value: string }> = [];
      if (t.slaResponseDueAt && !t.respondedAt && t.slaResponseDueAt < now && !seen(t.id, 'sla.breach', 'response')) breaches.push({ kind: 'task.response', label: 'resposta', value: 'response' });
      if (t.slaResolutionDueAt && t.slaResolutionDueAt < now && !seen(t.id, 'sla.breach', 'resolution')) breaches.push({ kind: 'task.resolution', label: 'resolução', value: 'resolution' });
      for (const b of breaches) {
        await mark(t.id, 'sla.breach', b.value);
        emitBvEvent('sla.breach', { orgId: t.orgId, taskId: t.id, kind: b.kind });
        const recipients = [...(await who()), ...(await sups(t.orgId))];
        await notifyUsers(t.orgId, recipients, { type: 'task.sla_breach', title: `SLA de ${b.label} violado: ${t.code}`, body: t.title, data: { ...data, kind: b.kind } });
        emitToSupervisors(t.orgId, 'sla:breach', { taskId: t.id, code: t.code, kind: b.kind });
        out.breaches++;
      }
    } catch (err: any) {
      logger.error({ err: err?.message, taskId: t.id }, '[balcao/tasks] sweep falhou para a tarefa');
    }
  }
}
