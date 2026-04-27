import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

export type AuditAction =
  | 'user.created'
  | 'user.updated'
  | 'user.deleted'
  | 'user.plan_changed'
  | 'user.permission_changed'
  | 'plan.created'
  | 'plan.updated'
  | 'plan.deleted'
  | 'subscription.created'
  | 'subscription.cancelled'
  | 'ticket.created'
  | 'ticket.updated'
  | 'ticket.closed'
  | 'admin.login'
  | 'admin.logout'
  | 'number.connected'
  | 'number.disconnected';

interface AuditLogInput {
  action: AuditAction;
  adminId: string;
  targetUserId?: string;
  targetResourceId?: string;
  resourceType?: string;
  changes?: Record<string, any>;
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Log an action for audit trail
 * This helps track all admin actions and changes for compliance
 */
export async function logAudit(input: AuditLogInput) {
  try {
    await prisma.auditLog.create({
      data: {
        action: input.action,
        adminId: input.adminId,
        targetUserId: input.targetUserId,
        targetResourceId: input.targetResourceId,
        resourceType: input.resourceType,
        changes: input.changes,
        metadata: input.metadata,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        timestamp: new Date(),
      },
    });

    logger.debug({
      type: 'audit',
      action: input.action,
      adminId: input.adminId,
      targetUserId: input.targetUserId,
    });
  } catch (error) {
    logger.error({
      type: 'audit_error',
      action: input.action,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Get audit logs for a specific user or resource
 */
export async function getAuditLogs(
  filters: {
    adminId?: string;
    targetUserId?: string;
    action?: AuditAction;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }
) {
  const where: any = {};

  if (filters.adminId) where.adminId = filters.adminId;
  if (filters.targetUserId) where.targetUserId = filters.targetUserId;
  if (filters.action) where.action = filters.action;

  if (filters.startDate || filters.endDate) {
    where.timestamp = {};
    if (filters.startDate) where.timestamp.gte = filters.startDate;
    if (filters.endDate) where.timestamp.lte = filters.endDate;
  }

  return prisma.auditLog.findMany({
    where,
    orderBy: { timestamp: 'desc' },
    take: filters.limit || 50,
    skip: filters.offset || 0,
  });
}

/**
 * Get audit summary for dashboards
 */
export async function getAuditSummary(days: number = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const logs = await prisma.auditLog.findMany({
    where: {
      timestamp: {
        gte: startDate,
      },
    },
  });

  const summary = {
    totalActions: logs.length,
    actionsByType: {} as Record<AuditAction, number>,
    adminsActive: new Set<string>(),
    usersAffected: new Set<string>(),
  };

  logs.forEach(log => {
    summary.actionsByType[log.action as AuditAction] = (summary.actionsByType[log.action as AuditAction] || 0) + 1;
    summary.adminsActive.add(log.adminId);
    if (log.targetUserId) summary.usersAffected.add(log.targetUserId);
  });

  return {
    ...summary,
    adminsActive: summary.adminsActive.size,
    usersAffected: summary.usersAffected.size,
  };
}
