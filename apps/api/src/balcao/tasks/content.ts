import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { decryptField, encryptField, isEncrypted } from '../core/crypto';

/**
 * Conteúdo de tarefas cifrado em repouso (AES-256-GCM, `core/crypto`). TODO acesso a texto livre passa por aqui:
 *   - `BvTask.description`
 *   - `BvTaskComment.body`
 *   - `BvTaskHistory.fromValue/toValue` dos campos `description` e `resolution` (carregam texto livre)
 * O título continua em claro (busca por `title`/`code`). Valores antigos, sem o prefixo `bv1.`, continuam legíveis
 * (decryptField os devolve como estão) e são cifrados por `encryptExistingTaskText()` / pela rotação de chaves.
 */
export const ENC_HISTORY_FIELDS: readonly string[] = ['description', 'resolution'];
export const isFreeTextField = (field: string) => ENC_HISTORY_FIELDS.includes(field);

/** Cifra para gravar. null/undefined → null. */
export const sealText = (v: string | null | undefined): string | null => (v == null ? null : encryptField(v));
/** Decifra para ler (texto sem prefixo volta como está). */
export const openText = (v: string | null | undefined): string | null => (v == null ? null : decryptField(v));

/** Valor de histórico pronto para gravar: cifrado só nos campos de texto livre. */
export const sealHistory = (field: string, v: string | null): string | null => (v != null && isFreeTextField(field) ? encryptField(v) : v);

// Linhas já decifradas não são decifradas de novo (evita ler como cifra um texto do usuário que comece com "bv1.").
const opened = new WeakSet<object>();
function mark<T extends object>(o: T): T { opened.add(o); return o; }

export function openTask<T extends { description: string | null }>(t: T): T {
  if (opened.has(t)) return t;
  return mark({ ...t, description: openText(t.description) });
}
export function openComment<T extends { body: string }>(c: T): T {
  if (opened.has(c)) return c;
  return mark({ ...c, body: decryptField(c.body) });
}
export function openHistory<T extends { field: string; fromValue: string | null; toValue: string | null }>(h: T): T {
  if (opened.has(h)) return h;
  return mark(isFreeTextField(h.field) ? { ...h, fromValue: openText(h.fromValue), toValue: openText(h.toValue) } : { ...h });
}

// ── Migração idempotente ─────────────────────────────────────────────────────
export interface EncryptTaskTextResult { descriptions: number; comments: number; history: number; done: boolean }

/**
 * Cifra o texto de tarefas gravado antes desta mudança (sem prefixo `bv1.`). Idempotente (só toca linhas em claro),
 * retomável (lotes confirmados separadamente) e otimista (não sobrescreve escrita concorrente). Valores vazios ficam como estão.
 */
export async function encryptExistingTaskText(opts: { orgId?: string; batchSize?: number; maxRows?: number } = {}): Promise<EncryptTaskTextResult> {
  const batch = Math.min(Math.max(opts.batchSize ?? 200, 1), 1000);
  let budget = opts.maxRows ?? Number.POSITIVE_INFINITY;
  const out = { descriptions: 0, comments: 0, history: 0 };
  const plain = (col: string) => ({ NOT: { [col]: { startsWith: 'bv1.' } }, [col]: { not: null } });

  // BvTask.description
  while (budget > 0) {
    const rows = await prisma.bvTask.findMany({
      where: { ...(opts.orgId ? { orgId: opts.orgId } : {}), AND: [plain('description')] }, select: { id: true, description: true }, orderBy: { id: 'asc' }, take: Math.min(batch, budget),
    });
    if (!rows.length) break;
    let progressed = 0;
    for (const r of rows) {
      if (r.description == null || isEncrypted(r.description)) continue;
      const res = await prisma.bvTask.updateMany({ where: { id: r.id, description: r.description }, data: { description: encryptField(r.description) } });
      if (res.count) { out.descriptions++; budget--; progressed++; }
    }
    if (!progressed) break; // só sobraram linhas que mudaram sob os pés: a próxima execução conclui
  }
  // BvTaskComment.body
  while (budget > 0) {
    const rows = await prisma.bvTaskComment.findMany({
      where: { ...(opts.orgId ? { task: { orgId: opts.orgId } } : {}), NOT: { body: { startsWith: 'bv1.' } } }, select: { id: true, body: true }, orderBy: { id: 'asc' }, take: Math.min(batch, budget),
    });
    if (!rows.length) break;
    let progressed = 0;
    for (const r of rows) {
      const res = await prisma.bvTaskComment.updateMany({ where: { id: r.id, body: r.body }, data: { body: encryptField(r.body) } });
      if (res.count) { out.comments++; budget--; progressed++; }
    }
    if (!progressed) break;
  }
  // BvTaskHistory (campos de texto livre)
  for (const col of ['fromValue', 'toValue'] as const) {
    while (budget > 0) {
      const rows = await prisma.bvTaskHistory.findMany({
        where: { ...(opts.orgId ? { task: { orgId: opts.orgId } } : {}), field: { in: [...ENC_HISTORY_FIELDS] }, AND: [plain(col)] }, select: { id: true, [col]: true }, orderBy: { id: 'asc' }, take: Math.min(batch, budget),
      });
      if (!rows.length) break;
      let progressed = 0;
      for (const r of rows as unknown as Array<{ id: string } & Record<string, any>>) {
        const old = r[col] as string;
        const res = await prisma.bvTaskHistory.updateMany({ where: { id: r.id, [col]: old }, data: { [col]: encryptField(old) } });
        if (res.count) { out.history++; budget--; progressed++; }
      }
      if (!progressed) break;
    }
  }
  const done = budget > 0;
  if (out.descriptions + out.comments + out.history > 0) logger.info({ ...out }, '[balcao/tasks] texto de tarefas cifrado (migração)');
  return { ...out, done };
}
