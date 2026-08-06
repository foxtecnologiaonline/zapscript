/**
 * onboarding-nudge.ts
 *
 * Cobre abandono do onboarding conversacional via WhatsApp (site simultâneo
 * ou número oficial) — mesmo molde de services/lifecycle-whatsapp.ts.
 * Sem resposta há 30-60min: reenvia o passo pendente uma vez (nudgeStuckLead).
 * Ainda sem resposta depois disso (>60min): escala pro Agente de Suporte.
 */
import { prisma } from '../lib/prisma';
import { nudgeStuckLead, escalateAbandonedLead } from './onboarding-whatsapp';

const INTERVAL_MS  = 15 * 60 * 1000; // a cada 15 min
const FIRST_RUN_MS = 5  * 60 * 1000; // 5 min após startup

const NUDGE_FROM_MS = 30 * 60 * 1000; // janela de lembrete: 30-60min sem atualização
const NUDGE_TO_MS   = 60 * 60 * 1000;

async function runOnce(log: any) {
  try {
    const now = Date.now();
    const windowStart = new Date(now - NUDGE_TO_MS);   // 60min atrás
    const windowEnd   = new Date(now - NUDGE_FROM_MS);  // 30min atrás

    const toNudge = await prisma.whatsappOnboardingLead.findMany({
      where: { stage: { notIn: ['completed', 'escalated'] }, updatedAt: { gte: windowStart, lte: windowEnd } },
    }).catch(() => [] as any[]);

    let nudged = 0;
    for (const lead of toNudge) {
      try {
        await nudgeStuckLead(lead);
        nudged++;
      } catch (e: any) {
        log?.warn?.(`[OnboardingNudge] Falha ao lembrar ${lead.phone}: ${e.message}`);
      }
    }

    const toEscalate = await prisma.whatsappOnboardingLead.findMany({
      where: { stage: { notIn: ['completed', 'escalated'] }, updatedAt: { lt: windowStart } },
    }).catch(() => [] as any[]);

    let escalated = 0;
    for (const lead of toEscalate) {
      try {
        await escalateAbandonedLead(lead);
        escalated++;
      } catch (e: any) {
        log?.warn?.(`[OnboardingNudge] Falha ao escalar ${lead.phone}: ${e.message}`);
      }
    }

    log?.info?.(`[OnboardingNudge] Ciclo concluído — lembretes=${nudged} escalados=${escalated}`);
  } catch (e: any) {
    log?.error?.(`[OnboardingNudge] Erro no ciclo: ${e.message}`);
  }
}

export function startOnboardingNudge(log: any) {
  setTimeout(() => {
    runOnce(log);
    setInterval(() => runOnce(log), INTERVAL_MS);
  }, FIRST_RUN_MS);
}
