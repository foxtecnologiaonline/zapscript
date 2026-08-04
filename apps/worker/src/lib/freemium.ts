/**
 * Regras de negócio do Freemium / métrica por áudios / rodapé condicional.
 *
 * ⚠️ Este arquivo é DUPLICADO em apps/api/src/lib/freemium.ts.
 *    Mantenha os dois em sincronia (constantes + lógica pura).
 *    São funções puras (sem Prisma) para poderem viver nos dois builds.
 */

// ── Parâmetros de cota (parametrizáveis por env, sem hardcode no fluxo) ──────
export const FREE_AUDIO_QUOTA = parseInt(process.env.FREE_AUDIO_QUOTA || '200', 10);
export const PRO_AUDIO_CAP    = parseInt(process.env.PRO_AUDIO_CAP    || '500', 10);

// ── Teto de duração por áudio: 10 min. Acima → rejeita (não conta cota) ──────
export const MAX_AUDIO_SECONDS = parseInt(process.env.MAX_AUDIO_SECONDS || '600', 10);
// Margem de tolerância para imprecisão da estimativa de duração do MP3.
export const MAX_AUDIO_MARGIN_SECONDS = parseInt(process.env.MAX_AUDIO_MARGIN_SECONDS || '30', 10);

export type PlanEfetivo = 'pro' | 'free';

interface PlanEfetivoInput {
  isTester?: boolean | null;
  subscription?: {
    status?: string | null;
    plan?: { name?: string | null } | null;
  } | null;
}

/**
 * Plano efetivo do usuário para fins de cota e rodapé:
 *   PRO  se: tester válido OU assinante pagante (qualquer plano != free) ativo
 *   FREE caso contrário. Sem trial — ver histórico do repo se precisar do
 *   comportamento antigo (TRIAL_DAYS/trialEndsAt).
 */
export function planEfetivo(u: PlanEfetivoInput, _now: Date = new Date()): PlanEfetivo {
  if (u.isTester) return 'pro';
  const sub = u.subscription;
  if (!sub) return 'free';

  const planName = (sub.plan?.name || 'free').toLowerCase();
  if (sub.status === 'active' && planName !== 'free') return 'pro';

  return 'free';
}

/** Cota de áudios do mês conforme o plano efetivo. */
export function audioQuotaFor(plan: PlanEfetivo): number {
  return plan === 'pro' ? PRO_AUDIO_CAP : FREE_AUDIO_QUOTA;
}

/** Normaliza o telefone do remetente para uso como contactId (somente dígitos). */
export function normalizeContactId(phone: string | null | undefined): string {
  return (phone || '').replace(/\D/g, '');
}

// ── Variações do rodapé viral (B1) — preparadas para A/B futuro ──────────────
// `id` é gravado em Transcription.footerVariant / ProContactSeed.footerVariant
// para medir conversão por variação depois.
export const FOOTER_VARIANTS: { id: string; text: string }[] = [
  { id: 'v1', text: '🎧→📄 Áudio vira texto: ZapScript.me' },
  { id: 'v2', text: '🔇 Leia sem fone: ZapScript.me' },
  { id: 'v3', text: '⚡ Áudio vira texto: ZapScript.me' },
  { id: 'v4', text: '⚡ Sem tempo de ouvir? ZapScript.me' },
  { id: 'v5', text: '⚡ Ouvir? Leia Áudios: ZapScript.me' },
  { id: 'v6', text: '⚡ Ouvir=demorado, Ler=rápido: ZapScript.me' },
];

/** Sorteia uma variação de rodapé (rotação aleatória, base para A/B). */
export function pickFooterVariant(): { id: string; text: string } {
  return FOOTER_VARIANTS[Math.floor(Math.random() * FOOTER_VARIANTS.length)];
}

/** Converte segundos economizados em rótulo amigável ("2h15" / "45min"). */
export function formatSavedTime(totalSeconds: number): string {
  const mins = Math.max(0, Math.round(totalSeconds / 60));
  if (mins < 60) return `${mins}min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}
