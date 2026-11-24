import type { BvIvrFlow } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { recordConfigVersion } from '../../core/configVersion';
import { validateIvrDefinition, type IvrDefinition, type IvrIssue } from './ivr';
import { loadUra0800 } from './ura0800';

export class FlowError extends Error {
  constructor(public code: string, message: string, public status = 400, public details?: unknown) { super(message); }
}

/** Nova versão DRAFT do fluxo `name` (versão = última + 1). Não afeta chamadas em andamento nem o fluxo ACTIVE. */
export async function createDraft(orgId: string, i: { name: string; language?: string; definition: unknown }, userId?: string | null): Promise<BvIvrFlow> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const last = await prisma.bvIvrFlow.findFirst({ where: { orgId, name: i.name }, orderBy: { version: 'desc' }, select: { version: true } });
    try {
      return await prisma.bvIvrFlow.create({ data: { orgId, name: i.name, version: (last?.version ?? 0) + 1, status: 'DRAFT', language: i.language ?? 'pt-BR', definition: i.definition as any, createdById: userId ?? null } });
    } catch (err: any) { if (err?.code !== 'P2002') throw err; }
  }
  throw new FlowError('ivr.version_conflict', 'Conflito ao versionar o fluxo; tente novamente', 409);
}

export async function updateDraft(orgId: string, id: string, patch: { language?: string; definition?: unknown }): Promise<BvIvrFlow> {
  const flow = await prisma.bvIvrFlow.findFirst({ where: { id, orgId } });
  if (!flow) throw new FlowError('ivr.not_found', 'Fluxo não encontrado', 404);
  if (flow.status !== 'DRAFT') throw new FlowError('ivr.not_draft', 'Só rascunhos podem ser editados; crie uma nova versão', 409);
  return prisma.bvIvrFlow.update({ where: { id }, data: { ...(patch.language ? { language: patch.language } : {}), ...(patch.definition ? { definition: patch.definition as any } : {}) } });
}

export async function deleteDraft(orgId: string, id: string): Promise<void> {
  const res = await prisma.bvIvrFlow.deleteMany({ where: { id, orgId, status: 'DRAFT' } });
  if (res.count === 0) throw new FlowError('ivr.not_found', 'Rascunho não encontrado (só rascunhos podem ser removidos)', 404);
}

/**
 * Publica a versão: troca a ACTIVE do mesmo nome por esta, em UMA transação (lock advisory por órgão+nome),
 * arquivando a anterior. Chamadas em andamento seguem com a definição que carregaram ao começar.
 * Aceita DRAFT ou ARCHIVED (rollback para uma versão anterior).
 */
export async function publishFlow(orgId: string, id: string, userId?: string | null): Promise<{ flow: BvIvrFlow; archivedId: string | null; warnings: IvrIssue[] }> {
  const flow = await prisma.bvIvrFlow.findFirst({ where: { id, orgId } });
  if (!flow) throw new FlowError('ivr.not_found', 'Fluxo não encontrado', 404);
  if (flow.status === 'ACTIVE') throw new FlowError('ivr.already_active', 'Esta versão já está ativa', 409);
  const v = validateIvrDefinition(flow.definition);
  if (!v.ok) throw new FlowError('ivr.invalid', 'Fluxo inválido — corrija os erros antes de publicar', 422, { errors: v.errors, warnings: v.warnings });

  // DID só pode ser atendido por um fluxo ACTIVE (de nomes diferentes) por órgão
  const dids = v.definition!.dids ?? [];
  if (dids.length) {
    const others = await prisma.bvIvrFlow.findMany({ where: { orgId, status: 'ACTIVE', name: { not: flow.name } }, select: { name: true, definition: true } });
    for (const o of others) {
      const od: string[] = ((o.definition as any)?.dids ?? []) as string[];
      const clash = dids.find((d) => od.includes(d));
      if (clash) throw new FlowError('ivr.did_conflict', `O DID ${clash} já é atendido pelo fluxo ativo "${o.name}"`, 409);
    }
  }

  const res = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orgId + ':ivr:' + flow.name}))`;
    const active = await tx.bvIvrFlow.findMany({ where: { orgId, name: flow.name, status: 'ACTIVE' }, select: { id: true } });
    if (active.length) await tx.bvIvrFlow.updateMany({ where: { id: { in: active.map((a) => a.id) } }, data: { status: 'ARCHIVED' } });
    const published = await tx.bvIvrFlow.update({ where: { id }, data: { status: 'ACTIVE', publishedAt: new Date() } });
    return { published, archivedId: active[0]?.id ?? null };
  });
  await recordConfigVersion(orgId, 'IVR_FLOW', id, { name: flow.name, version: flow.version, definition: flow.definition, archivedId: res.archivedId }, userId);
  return { flow: res.published, archivedId: res.archivedId, warnings: v.warnings };
}

/**
 * Fluxo ACTIVE que atende o DID: mapeamento da integração URA_0800 (`dids[].flowName`) → `definition.dids` explícitos → fluxo ACTIVE
 * sem `dids` (padrão) → null.
 */
export async function resolveFlowForDid(orgId: string, did: string | null | undefined): Promise<BvIvrFlow | null> {
  const active = await prisma.bvIvrFlow.findMany({ where: { orgId, status: 'ACTIVE' }, orderBy: { publishedAt: 'asc' } });
  const dids = (f: BvIvrFlow) => (((f.definition as any)?.dids ?? []) as string[]);
  if (did) {
    const mapped = (await loadUra0800(orgId))?.dids.find((d) => d.did === did);
    const byName = mapped ? active.filter((f) => f.name === mapped.flowName) : [];
    if (byName.length) return byName[byName.length - 1]; // versão publicada mais recente
    const hit = active.find((f) => dids(f).includes(did));
    if (hit) return hit;
  }
  return active.find((f) => dids(f).length === 0) ?? null;
}

export function flowDefinition(flow: BvIvrFlow): IvrDefinition {
  const v = validateIvrDefinition(flow.definition);
  if (!v.definition) throw new FlowError('ivr.invalid', 'Fluxo armazenado é inválido', 500);
  return v.definition;
}
