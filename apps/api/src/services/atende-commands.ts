/**
 * atende-commands.ts
 *
 * Feature 8: comandos do dono do Atende via self-chat (mensagem que o dono manda
 * pro próprio número no WhatsApp). Reaproveita a mesma detecção de self-chat já
 * usada pro áudio (isSelfNote, Feature 1, em evolution-webhook.ts) — aqui aplicada
 * a texto, sempre atrás do prefixo "atende" pra nunca sequestrar uma nota pessoal
 * comum que o dono mande pra si mesmo.
 */

import { prisma } from '../lib/prisma';
import { sendText } from './evolution';

const COMMAND_PREFIX = /^\s*atende\b/i;

export function isAtendeOwnerCommand(text: string): boolean {
  return COMMAND_PREFIX.test(text ?? '');
}

const LEVELS = ['conservador', 'equilibrado', 'autonomo'];
const LEVEL_LABEL: Record<string, string> = {
  conservador: 'conservador',
  equilibrado: 'equilibrado',
  autonomo: 'autônomo',
};

const HELP_TEXT = [
  '*Comandos do Atende* (mande aqui, pra você mesmo):',
  '• atende status — resumo das conversas',
  '• atende ligar / desligar — ativa ou pausa a resposta automática',
  '• atende confianca conservador|equilibrado|autonomo — ajusta o quanto a IA arrisca responder sozinha',
].join('\n');

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// Reaproveitado pela Feature 9 (digest periódico) — mesmo texto de resumo.
export async function buildAtendeStatusSummary(userId: string, numberId: string): Promise<string> {
  const [config, openCount, escalatedCount, todayCount] = await Promise.all([
    prisma.atendeConfig.findUnique({ where: { numberId } }),
    prisma.atendeConversation.count({ where: { userId, numberId, status: 'open' } }),
    prisma.atendeConversation.count({ where: { userId, numberId, status: 'escalated' } }),
    prisma.atendeConversation.count({ where: { userId, numberId, lastMessageAt: { gte: startOfToday() } } }),
  ]);

  const state = config?.enabled ? 'ligado ✅' : 'desligado ⏸️';
  const level = (config?.confidenceLevel && LEVEL_LABEL[config.confidenceLevel]) || config?.confidenceLevel || 'equilibrado';

  return [
    '*Atende — status*',
    `Estado: ${state}`,
    `Confiança: ${level}`,
    `Conversas com você hoje: ${todayCount}`,
    `Abertas (bot respondendo): ${openCount}`,
    `Escaladas p/ você: ${escalatedCount}`,
  ].join('\n');
}

export async function handleAtendeOwnerCommand(params: {
  userId: string;
  numberId: string;
  instanceName: string;
  selfPhone: string;
  text: string;
}): Promise<void> {
  const { userId, numberId, instanceName, selfPhone, text } = params;
  const rest = text.replace(COMMAND_PREFIX, '').trim().toLowerCase();
  const [cmd, arg] = rest.split(/\s+/).filter(Boolean);

  let reply: string;
  try {
    const config = await prisma.atendeConfig.findUnique({ where: { numberId } });

    if (!cmd || cmd === 'ajuda' || cmd === 'help' || cmd === 'comandos') {
      reply = HELP_TEXT;
    } else if (cmd === 'status') {
      reply = await buildAtendeStatusSummary(userId, numberId);
    } else if (['ligar', 'ativar', 'on'].includes(cmd)) {
      if (!config) {
        reply = 'Configure o Atende primeiro pelo painel (zapscript.me/app/atende/config) antes de ligar por aqui.';
      } else {
        await prisma.atendeConfig.update({ where: { numberId }, data: { enabled: true } });
        reply = 'Atende ligado ✅ — vou responder seus clientes automaticamente.';
      }
    } else if (['desligar', 'pausar', 'parar', 'off'].includes(cmd)) {
      if (!config) {
        reply = 'Atende ainda não foi configurado.';
      } else {
        await prisma.atendeConfig.update({ where: { numberId }, data: { enabled: false } });
        reply = 'Atende desligado ⏸️ — nenhuma resposta automática até você religar.';
      }
    } else if (cmd === 'confianca' || cmd === 'confiança') {
      const level = LEVELS.includes(arg ?? '') ? arg! : null;
      if (!config) {
        reply = 'Atende ainda não foi configurado.';
      } else if (!level) {
        reply = 'Use: atende confianca conservador | equilibrado | autonomo';
      } else {
        await prisma.atendeConfig.update({ where: { numberId }, data: { confidenceLevel: level } });
        reply = `Nível de confiança ajustado para *${LEVEL_LABEL[level]}*.`;
      }
    } else {
      reply = `Não entendi esse comando.\n\n${HELP_TEXT}`;
    }
  } catch {
    reply = 'Deu erro ao processar esse comando. Tente de novo em instantes.';
  }

  await sendText(instanceName, selfPhone, reply).catch(() => { /* não crítico */ });
}
