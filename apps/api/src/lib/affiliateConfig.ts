import { prisma } from './prisma';
import { COMMISSION } from './affiliate';

/* ─────────────────────────────────────────────────────────
   Configuração dinâmica do Programa de Afiliados — editável pelo admin
   sem redeploy (tabela AffiliateConfig, padrão key/value/Json, mesma
   ideia do AdminAlertConfig em routes/admin.ts). Chaves conhecidas:
   "rates" | "autoApprove" | "reportSchedule". Ausência de linha = usa
   o default hardcoded abaixo (por sua vez espelhando COMMISSION).
   ───────────────────────────────────────────────────────── */

export type AffiliateRates = {
  base: number;
  bonus: number;
  residual: number;
};

export type AutoApproveConfig = {
  enabled: boolean;
  requireVerifiedEmail: boolean;
  minAccountDays: number;
};

export type ReportScheduleConfig = {
  cadence: 'off' | 'weekly' | 'monthly';
  destination: string; // e-mail (ou telefone WhatsApp no futuro)
};

export type ActiveCampaign = { id: string; name: string; rate: number; startsAt: Date; endsAt: Date };

const DEFAULT_AUTO_APPROVE: AutoApproveConfig = {
  enabled: false,
  requireVerifiedEmail: true,
  minAccountDays: 7,
};

const DEFAULT_REPORT_SCHEDULE: ReportScheduleConfig = {
  cadence: 'off',
  destination: '',
};

/** Leitura defensiva de uma única chave — tolera tabela ainda não migrada (retorna null). */
async function getConfigValue(key: string): Promise<any | null> {
  try {
    const row = await (prisma as any).affiliateConfig.findUnique({ where: { key } });
    return row?.value ?? null;
  } catch {
    return null;
  }
}

/** Mapa completo key→value — usado pelo painel admin (1 leitura só). */
export async function getAffiliateConfigMap(): Promise<Record<string, any>> {
  try {
    const rows = await (prisma as any).affiliateConfig.findMany();
    return Object.fromEntries(rows.map((r: any) => [r.key, r.value]));
  } catch {
    return {};
  }
}

/** Grava/atualiza uma ou mais chaves (upsert), mesmo contrato do POST /alert-config. */
export async function setAffiliateConfig(entries: Record<string, any>): Promise<void> {
  for (const [key, value] of Object.entries(entries)) {
    await (prisma as any).affiliateConfig.upsert({
      where:  { key },
      create: { key, value },
      update: { value, updatedAt: new Date() },
    });
  }
}

/** Taxas efetivas (base/bônus/residual) — de AffiliateConfig, com fallback ao default de COMMISSION. */
export async function getEffectiveCommissionRates(): Promise<AffiliateRates> {
  const custom = await getConfigValue('rates');
  const isRate = (n: any) => Number.isFinite(n) && n > 0 && n < 1;
  return {
    base:     isRate(custom?.base) ? custom.base : COMMISSION.BASE_RATE,
    bonus:    isRate(custom?.bonus) ? custom.bonus : COMMISSION.BONUS_RATE,
    residual: isRate(custom?.residual) ? custom.residual : COMMISSION.RESIDUAL_RATE,
  };
}

/** Config de auto-aprovação ("aprovar automaticamente se e-mail verificado + conta com X dias"). */
export async function getAutoApproveConfig(): Promise<AutoApproveConfig> {
  const custom = await getConfigValue('autoApprove');
  return { ...DEFAULT_AUTO_APPROVE, ...(custom || {}) };
}

/** Config do relatório periódico (cadência + destino) consumida pelo worker. */
export async function getReportScheduleConfig(): Promise<ReportScheduleConfig> {
  const custom = await getConfigValue('reportSchedule');
  return { ...DEFAULT_REPORT_SCHEDULE, ...(custom || {}) };
}

/**
 * Campanha sazonal ativa agora, se houver (ex.: "Black Friday: 50% de 20/11 a
 * 30/11"). Havendo sobreposição de janelas, vence a de maior taxa. Substitui
 * base/bônus/taxa personalizada na comissão do período — nunca a residual.
 */
export async function getActiveCampaign(): Promise<ActiveCampaign | null> {
  try {
    const now = new Date();
    const rows = await (prisma as any).affiliateCampaign.findMany({
      where:   { active: true, startsAt: { lte: now }, endsAt: { gte: now } },
      orderBy: { rate: 'desc' },
      take:    1,
    });
    return rows[0] || null;
  } catch {
    return null;
  }
}
