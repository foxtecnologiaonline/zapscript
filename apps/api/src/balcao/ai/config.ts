import type { BvOrgSettings } from '../core/settings';

export const HANDOFF_NOTICE = 'Certo! Vou transferir você para um atendente. Aguarde um instante, por favor.';

/** Campos de settings.ai além dos tipados no core (lidos com padrão seguro). */
export function aiExtras(s: BvOrgSettings) {
  const a = s.ai as any;
  return {
    agentAssist: a.agentAssist !== false,
    idleCloseMinutes: Number(a.idleCloseMinutes ?? process.env.BV_AI_IDLE_MINUTES ?? 15),
    handoffMessage: typeof a.handoffMessage === 'string' && a.handoffMessage ? a.handoffMessage : HANDOFF_NOTICE,
    topK: Number(process.env.BV_AI_TOPK ?? 4),
  };
}

