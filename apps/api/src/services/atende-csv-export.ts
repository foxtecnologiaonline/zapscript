import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

/**
 * Exportar conversas do Atende para CSV.
 * Útil para: backup, análise offline, compliance (LGPD).
 */
export async function exportAtendeCsvStream(params: {
  userId: string;
  days?: number; // Últimos N dias (default 30)
  archived?: boolean; // Incluir conversas arquivadas? (default false)
}): Promise<{
  headers: string[];
  rows: string[][];
  metadata: { conversationCount: number; messageCount: number };
}> {
  const days = params.days ?? 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Buscar conversas + todas as mensagens
  const conversations = await prisma.atendeConversation.findMany({
    where: {
      userId: params.userId,
      createdAt: { gte: since },
      ...(params.archived === undefined && { archived: false }), // Default: apenas conversas ativas
    },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
      },
      number: {
        select: { displayName: true },
      },
    },
  });

  const headers = [
    'Conversation ID',
    'Phone',
    'Contact Name',
    'Status',
    'Created At',
    'Last Message At',
    'Message ID',
    'Direction',
    'Content',
    'AI Generated',
    'Human Authored',
    'Confidence',
    'Message Status',
    'Message Sent At',
  ];

  const rows: string[][] = [];

  for (const conv of conversations) {
    if (conv.messages.length === 0) {
      // Se conversa sem mensagens, criar uma linha vazia
      rows.push([
        conv.id,
        conv.contactPhone,
        conv.contactName || '',
        conv.status,
        conv.createdAt.toISOString(),
        conv.lastMessageAt.toISOString(),
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
      ]);
    } else {
      // Uma linha por mensagem
      for (const msg of conv.messages) {
        rows.push([
          conv.id,
          conv.contactPhone,
          conv.contactName || '',
          conv.status,
          conv.createdAt.toISOString(),
          conv.lastMessageAt.toISOString(),
          msg.id,
          msg.direction,
          `"${msg.content.replace(/"/g, '""')}"`, // Escape quotes para CSV
          msg.aiGenerated ? 'Yes' : 'No',
          msg.humanAuthored ? 'Yes' : 'No',
          msg.confidence ? msg.confidence.toString() : '',
          msg.status || 'sent',
          msg.createdAt.toISOString(),
        ]);
      }
    }
  }

  logger.info(
    { conversations: conversations.length, messages: rows.length, userId: params.userId },
    '[Atende Export] CSV gerado',
  );

  return {
    headers,
    rows,
    metadata: {
      conversationCount: conversations.length,
      messageCount: rows.length,
    },
  };
}

/**
 * Converter headers + rows para string CSV (com BOM para Excel).
 */
export function csvToString(headers: string[], rows: string[][]): string {
  // BOM UTF-8 para Excel reconhecer encoding
  const bom = '﻿';
  const headerLine = headers.map((h) => `"${h}"`).join(',');
  const rowLines = rows.map((row) => row.join(','));
  return bom + [headerLine, ...rowLines].join('\n');
}
