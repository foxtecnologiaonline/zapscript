import { prisma } from '../../lib/prisma';

/** Registra uma nova versão (snapshot) de uma configuração — filas, regras, URA, settings. Retorna o nº da versão. */
export async function recordConfigVersion(orgId: string, entityType: string, entityId: string, snapshot: unknown, changedById?: string | null): Promise<number> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const last = await prisma.bvConfigVersion.findFirst({ where: { entityType, entityId }, orderBy: { version: 'desc' }, select: { version: true } });
    const version = (last?.version ?? 0) + 1;
    try {
      await prisma.bvConfigVersion.create({ data: { orgId, entityType, entityId, version, snapshot: snapshot as any, changedById: changedById ?? null } });
      return version;
    } catch (err: any) {
      if (err?.code !== 'P2002') throw err; // corrida na versão → tenta de novo
    }
  }
  throw new Error('Não foi possível versionar a configuração');
}

export function listConfigVersions(entityType: string, entityId: string, take = 50) {
  return prisma.bvConfigVersion.findMany({ where: { entityType, entityId }, orderBy: { version: 'desc' }, take });
}
