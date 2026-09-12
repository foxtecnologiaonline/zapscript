/**
 * onboarding-nudge.ts
 *
 * Cobre abandono do onboarding conversacional via WhatsApp (site simultâneo
 * ou número oficial) — mesmo molde de services/lifecycle-whatsapp.ts.
 *
 * Ciclo:
 *   1. Se parado >5min em code_sent → regenera código (pois expira em 3-5min)
 *   2. Se parado 30-60min → reenvia lembrete (nudgeStuckLead)
 *   3. Se parado >60min → escala pro Agente de Suporte
 */
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { nudgeStuckLead, escalateAbandonedLead, getOfficialInstanceName } from './onboarding-whatsapp';
import { sendText } from './evolution';
import { requestPairingCodeWithRetry } from './number-provisioning';

const INTERVAL_MS         = 15 * 60 * 1000;  // a cada 15 min
const FIRST_RUN_MS        = 5  * 60 * 1000;  // 5 min após startup
const REGEN_CODE_AFTER_MS = 5  * 60 * 1000;  // regenerar código após 5 min (expira em 3)
const TIMEOUT_CODE_SENT_MS = 10 * 60 * 1000; // timeout em code_sent: 10 min (código expirado)
const NUDGE_FROM_MS       = 30 * 60 * 1000;  // janela de lembrete: 30-60min
const NUDGE_TO_MS         = 60 * 60 * 1000;

async function runOnce(log: any) {
  try {
    const now = Date.now();

    // ────────────────────────────────────────────────────────────────────
    // 1. Regenerar código em code_sent se passaram >5 min (código expirou)
    // ────────────────────────────────────────────────────────────────────
    const toRegenCode = await prisma.whatsappOnboardingLead.findMany({
      where: {
        stage: 'code_sent',
        updatedAt: { lt: new Date(now - REGEN_CODE_AFTER_MS) },
      },
    }).catch(() => [] as any[]);

    let regened = 0;
    for (const lead of toRegenCode) {
      if (!lead.numberId) continue;
      try {
        // Usar retry com backoff para tolerar falhas transitórias
        const newCode = await requestPairingCodeWithRetry(lead.numberId, lead.phone, log);
        if (newCode.ok) {
          // Enviar mensagem com urgência
          const officialInstance = await getOfficialInstanceName();
          if (officialInstance) {
            await sendText(officialInstance, lead.phone,
              `Código anterior expirou! Novo código:\n\n*${newCode.code}*\n\n⚠️ *Válido por 3 minutos apenas* — digita agora mesmo!`
            ).catch(() => null);
          }
          // Reset timer (updatedAt) pra não regenerar novamente tão cedo
          await prisma.whatsappOnboardingLead.update({
            where: { phone: lead.phone },
            data: { updatedAt: new Date() },
          });
          regened++;
        }
      } catch (e: any) {
        log?.warn?.(`[OnboardingNudge] Falha ao regenerar código ${lead.phone}: ${e.message}`);
      }
    }

    // ────────────────────────────────────────────────────────────────────
    // 2. Lembrete automático (30-60min sem atualização)
    // ────────────────────────────────────────────────────────────────────
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

    // ────────────────────────────────────────────────────────────────────
    // 2.5. Timeout em code_sent (10 min — código expirou)
    // ────────────────────────────────────────────────────────────────────
    const toTimeout = await prisma.whatsappOnboardingLead.findMany({
      where: {
        stage: 'code_sent',
        updatedAt: { lt: new Date(now - TIMEOUT_CODE_SENT_MS) },
      },
    }).catch(() => [] as any[]);

    let timedOut = 0;
    for (const lead of toTimeout) {
      try {
        await escalateAbandonedLead(lead);
        const officialInstance = await getOfficialInstanceName();
        if (officialInstance) {
          await sendText(officialInstance, lead.phone,
            `Seu código expirou e não conseguimos conectar. Vou chamar um agente para ajudar. Aguarde!`
          ).catch(() => null);
        }
        timedOut++;
      } catch (e: any) {
        log?.warn?.(`[OnboardingNudge] Falha ao timeout ${lead.phone}: ${e.message}`);
      }
    }

    // ────────────────────────────────────────────────────────────────────
    // 3. Escalação (>60min sem resposta)
    // ────────────────────────────────────────────────────────────────────
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

    log?.info?.(`[OnboardingNudge] Ciclo — regen=${regened} nudges=${nudged} timeout=${timedOut} escalados=${escalated}`);
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
