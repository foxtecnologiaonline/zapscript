import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { audit } from '../core/audit';
import { recordConfigVersion } from '../core/configVersion';
import { registerJob } from '../core/scheduler';
import { notifyOrgManagers } from './util';

/**
 * Registro de incidentes de segurança (DPA/Anexo G: comunicação ao contratante em até 24 h da ciência).
 * Não há tabela própria: cada alteração é um snapshot versionado em BvConfigVersion (entityType 'security.incident'),
 * o que preserva o histórico completo; toda ação também vai para a trilha de auditoria.
 */
export const INCIDENT_ENTITY = 'security.incident';
export const NOTIFY_DEADLINE_H = 24;

export interface Incident {
  id: string; version: number; title: string; description: string; dataAffected: string[]; affectedSubjects: number | null;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'; status: 'OPEN' | 'CONTAINED' | 'CLOSED'; awareAt: string; deadlineAt: string;
  notifiedAt: string | null; notifiedTo: string | null; measures: string | null; lastReminderAt: string | null; createdAt: string; createdById: string | null; updatedAt: string;
}

const fromSnap = (s: any, version: number, updatedAt: Date): Incident => ({ ...s, version, updatedAt: updatedAt.toISOString() });

export async function listIncidents(orgId: string): Promise<Incident[]> {
  const rows = await prisma.bvConfigVersion.findMany({ where: { orgId, entityType: INCIDENT_ENTITY }, orderBy: { version: 'desc' } });
  const seen = new Map<string, Incident>();
  for (const r of rows) if (!seen.has(r.entityId)) seen.set(r.entityId, fromSnap(r.snapshot, r.version, r.createdAt));
  return [...seen.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getIncident(orgId: string, id: string): Promise<{ incident: Incident; history: Array<{ version: number; at: string; by: string | null }> } | null> {
  const rows = await prisma.bvConfigVersion.findMany({ where: { orgId, entityType: INCIDENT_ENTITY, entityId: id }, orderBy: { version: 'desc' } });
  if (!rows.length) return null;
  return { incident: fromSnap(rows[0].snapshot, rows[0].version, rows[0].createdAt), history: rows.map((r) => ({ version: r.version, at: r.createdAt.toISOString(), by: r.changedById })) };
}

export interface CreateIncidentInput { title: string; description: string; dataAffected: string[]; affectedSubjects?: number | null; severity: Incident['severity']; awareAt: Date; notifiedAt?: Date | null; notifiedTo?: string | null; measures?: string | null }

export async function createIncident(orgId: string, actorId: string | null, i: CreateIncidentInput): Promise<Incident> {
  const id = 'inc_' + crypto.randomBytes(8).toString('hex');
  const now = new Date();
  const snap = {
    id, title: i.title, description: i.description, dataAffected: i.dataAffected, affectedSubjects: i.affectedSubjects ?? null, severity: i.severity, status: 'OPEN',
    awareAt: i.awareAt.toISOString(), deadlineAt: new Date(i.awareAt.getTime() + NOTIFY_DEADLINE_H * 3600_000).toISOString(),
    notifiedAt: i.notifiedAt ? i.notifiedAt.toISOString() : null, notifiedTo: i.notifiedTo ?? null, measures: i.measures ?? null, lastReminderAt: null, createdAt: now.toISOString(), createdById: actorId,
  };
  const version = await recordConfigVersion(orgId, INCIDENT_ENTITY, id, snap, actorId);
  await audit({ orgId, actorId, action: 'security.incident.open', entityType: 'incident', entityId: id, meta: { severity: i.severity, awareAt: snap.awareAt, deadlineAt: snap.deadlineAt, dataAffected: i.dataAffected } });
  if (!snap.notifiedAt) {
    await notifyOrgManagers(orgId, 'security.incident', `Incidente registrado: comunicar o contratante até ${snap.deadlineAt}`, snap.title, { incidentId: id, deadlineAt: snap.deadlineAt }, ['ADMIN']);
  }
  return fromSnap(snap, version, now);
}

export type IncidentPatch = Partial<Pick<Incident, 'title' | 'description' | 'dataAffected' | 'affectedSubjects' | 'severity' | 'status' | 'measures' | 'notifiedTo'>> & { notifiedAt?: Date | null };

export async function updateIncident(orgId: string, id: string, actorId: string | null, patch: IncidentPatch): Promise<Incident | null> {
  const cur = await getIncident(orgId, id);
  if (!cur) return null;
  const { notifiedAt, ...rest } = patch;
  const next: any = { ...cur.incident, ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) };
  delete next.version; delete next.updatedAt;
  if (notifiedAt !== undefined) next.notifiedAt = notifiedAt ? notifiedAt.toISOString() : null;
  const version = await recordConfigVersion(orgId, INCIDENT_ENTITY, id, next, actorId);
  const late = next.notifiedAt && Date.parse(next.notifiedAt) > Date.parse(next.deadlineAt);
  await audit({
    orgId, actorId, action: notifiedAt ? 'security.incident.notified' : 'security.incident.update', entityType: 'incident', entityId: id,
    meta: { fields: Object.keys(patch), ...(notifiedAt ? { notifiedAt: next.notifiedAt, withinDeadline: !late } : {}) },
  });
  return fromSnap(next, version, new Date());
}

/** Lembretes: faltando ≤ 6 h ou vencido, no máximo 1 por hora enquanto o contratante não for comunicado. */
export async function remindIncidents(now = new Date()): Promise<number> {
  const orgs = await prisma.bvConfigVersion.findMany({ where: { entityType: INCIDENT_ENTITY }, distinct: ['orgId'], select: { orgId: true } });
  let n = 0;
  for (const { orgId } of orgs) {
    for (const inc of await listIncidents(orgId)) {
      if (inc.notifiedAt || inc.status === 'CLOSED') continue;
      const left = Date.parse(inc.deadlineAt) - now.getTime();
      if (left > 6 * 3600_000) continue;
      if (inc.lastReminderAt && now.getTime() - Date.parse(inc.lastReminderAt) < 3600_000) continue;
      const overdue = left < 0;
      await notifyOrgManagers(orgId, 'security.incident.reminder', overdue ? 'PRAZO DE 24 h VENCIDO: comunicar o contratante' : 'Prazo de comunicação de incidente se encerrando', inc.title, { incidentId: inc.id, deadlineAt: inc.deadlineAt }, ['ADMIN']);
      const { version: _v, updatedAt: _u, ...snap } = inc;
      void _v; void _u;
      await recordConfigVersion(orgId, INCIDENT_ENTITY, inc.id, { ...snap, lastReminderAt: now.toISOString() }, null);
      await audit({ orgId, actorType: 'SYSTEM', action: 'security.incident.reminder', entityType: 'incident', entityId: inc.id, meta: { overdue } });
      n++;
    }
  }
  return n;
}

registerJob('balcao.security.incident-reminders', { intervalMs: 15 * 60_000, lockTtlSec: 300 }, async () => { await remindIncidents(); });
