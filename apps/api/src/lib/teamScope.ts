import { FastifyReply } from 'fastify';
import { prisma } from './prisma';
import { getUserModules } from './moduleGate';

/**
 * Compartilhamento de dados de time (Fase 3, tier Empresas — ver
 * MODULOS_ARQUITETURA.md). Hierarquia de papéis: agent < manager < admin < owner.
 * 'owner' é sempre o dono da conta/dos dados (dono do time, ou qualquer usuário
 * que não pertence a nenhum time — o caso comum hoje).
 */
export type TeamRole = 'agent' | 'manager' | 'admin' | 'owner';
const ROLE_RANK: Record<TeamRole, number> = { agent: 0, manager: 1, admin: 2, owner: 3 };

export interface TeamScope {
  /** userId cujos dados devem ser lidos/escritos — o dono do time (ou o próprio usuário, sem time). */
  ownerId: string;
  /** papel efetivo do usuário logado. */
  role: TeamRole;
}

/**
 * Resolve de quem são os dados que o usuário logado deve enxergar e qual o
 * papel efetivo dele. Usuário sem time (ou membro inativo/convite pendente)
 * = dono dos próprios dados, role 'owner' — comportamento idêntico ao de hoje
 * para quem nunca usou Equipe.
 */
export async function resolveTeamScope(userId: string): Promise<TeamScope> {
  const member = await prisma.teamMember.findUnique({
    where:  { userId },
    select: { teamId: true, role: true, status: true },
  });
  if (!member || member.status !== 'active' || member.role === 'owner') {
    return { ownerId: userId, role: 'owner' };
  }
  const team = await prisma.team.findUnique({ where: { id: member.teamId }, select: { ownerId: true } });
  const role: TeamRole = member.role === 'admin' || member.role === 'manager' ? member.role : 'agent';
  return { ownerId: team?.ownerId ?? userId, role };
}

/** true se `role` tem privilégio >= `min` na hierarquia agent < manager < admin < owner. */
export function roleAtLeast(role: TeamRole, min: TeamRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/**
 * preHandler factory: resolve o team scope (grava em req.teamScope) e exige
 * que o DONO dos dados (não necessariamente quem está logado) tenha o módulo
 * `key` ativo. Use no lugar de requireModule() em rotas que suportam
 * compartilhamento de time (ex.: Atende visto por membros do time).
 */
export function requireModuleShared(key: string) {
  return async (req: any, reply: FastifyReply) => {
    const userId = req.user?.sub;
    if (!userId) {
      reply.code(401).send({ error: 'Unauthorized' });
      return reply;
    }

    const scope = await resolveTeamScope(userId);
    req.teamScope = scope;

    const owned = await getUserModules(scope.ownerId);
    if (!owned.includes(key)) {
      reply.code(402).send({
        error:          'Módulo não contratado',
        message:        `Este recurso faz parte do módulo "${key}", que ${scope.role === 'owner' ? 'você ainda não contratou' : 'o dono do time ainda não contratou'}.`,
        moduleRequired: key,
        upsellUrl:      `/app?upsell=${encodeURIComponent(key)}`,
      });
      return reply;
    }
  };
}

/**
 * preHandler factory: exige papel >= `min` no time. Deve rodar DEPOIS de
 * requireModuleShared() (depende de req.teamScope já resolvido).
 */
export function requireTeamRole(min: TeamRole) {
  return async (req: any, reply: FastifyReply) => {
    const scope: TeamScope | undefined = req.teamScope;
    if (!scope || !roleAtLeast(scope.role, min)) {
      reply.code(403).send({
        error:   'Permissão insuficiente',
        message: `Esta ação requer papel "${min}" ou superior no time.`,
      });
      return reply;
    }
  };
}
