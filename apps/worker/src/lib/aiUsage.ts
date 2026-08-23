import { prisma } from './prisma';
import { logger } from './logger';

/**
 * Telemetria de custo de IA por tenant (não crítica: nunca deve travar ou
 * atrasar o pipeline). Cobre tanto chamadas de chat/LLM (inputTokens/
 * outputTokens reais) quanto Whisper (que cobra por duração, não por token —
 * nesse caso inputTokens carrega a duração em segundos do áudio; ver
 * chamadas em services/whisper.ts).
 */
export function logAiUsage(
  userId: string, feature: string, model: string, inputTokens?: number, outputTokens?: number,
): void {
  prisma.aiUsageLog.create({
    data: { userId, feature, model, inputTokens: inputTokens ?? 0, outputTokens: outputTokens ?? 0 },
  }).catch((err: any) => logger.warn(`[AiUsage] Falha ao registrar AiUsageLog: ${err.message}`));
}
