import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

/**
 * Cleanup de conversas antigas (soft-delete, nunca hard-delete por compliance).
 * Executar via cron job: `0 2 * * *` (2am diariamente)
 *
 * Critério: conversas sem atividade há > 90 dias
 * Ação: marcar como archived (soft-delete, preserva dados LGPD)
 *
 * Benefícios:
 * - Reduz tamanho do índice ativo
 * - Queries de "conversas ativas" ficam mais rápidas
 * - Dados ainda recuperáveis (audit trail, LGPD)
 */
export async function cleanupOldAtendeConversations(): Promise<{
  archived: number;
  totalActive: number;
  error?: string;
}> {
  try {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    // Contar conversas ativas antes
    const totalActiveBefore = await prisma.atendeConversation.count({
      where: { archived: false },
    });

    // Marcar conversas antigas como archived
    const result = await prisma.atendeConversation.updateMany({
      where: {
        archived: false,
        lastMessageAt: { lt: ninetyDaysAgo },
      },
      data: { archived: true, archivedAt: new Date() },
    });

    logger.info(
      { archived: result.count, totalActiveBefore, daysThreshold: 90 },
      '[Atende Cleanup] Conversas antigas arquivadas',
    );

    return { archived: result.count, totalActive: totalActiveBefore - result.count };
  } catch (err: any) {
    logger.error({ err: err.message }, '[Atende Cleanup] Erro ao executar cleanup');
    return {
      archived: 0,
      totalActive: 0,
      error: err.message,
    };
  }
}

/**
 * Query helper: obter apenas conversas ativas (não archived).
 * Use em vez de findMany direto para garantir que sempre filtra archived.
 */
export async function findActiveAtendeConversations(params: {
  userId: string;
  limit?: number;
  offset?: number;
}) {
  return prisma.atendeConversation.findMany({
    where: {
      userId: params.userId,
      archived: false, // Sempre filtra archived
    },
    orderBy: { lastMessageAt: 'desc' },
    take: params.limit ?? 50,
    skip: params.offset ?? 0,
  });
}
