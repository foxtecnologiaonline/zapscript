import type { Role } from './types';

/**
 * Matriz de permissões por perfil. O edital define atendente e supervisor (TR 1.1.3.1.9.1) e o painel do
 * Fiscal (1.1.3.1.8.1); ADMIN (gestão do órgão/plataforma) foi acrescentado por decisão de projeto.
 */
export const PERMISSIONS = [
  'conversation:read', // ver conversas atribuídas a si / da(s) sua(s) fila(s)
  'conversation:read_all', // ver qualquer conversa do órgão
  'conversation:reply',
  'conversation:transfer',
  'conversation:close',
  'conversation:monitor', // painel em tempo real / escuta e intervenção
  'contact:read',
  'contact:write',
  'contact:lgpd', // atender pedidos de titular (acesso/exclusão/anonimização)
  'queue:manage',
  'routing:manage',
  'ivr:manage',
  'recording:listen',
  'kb:read',
  'kb:write',
  'kb:approve',
  'task:read',
  'task:write',
  'task:manage',
  'report:read',
  'report:export',
  'fiscal:read', // consumo por item
  'quota:manage',
  'audit:read',
  'user:manage',
  'org:manage',
  'integration:manage',
  'security:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ATENDENTE: Permission[] = [
  'conversation:read', 'conversation:reply', 'conversation:transfer', 'conversation:close',
  'contact:read', 'contact:write', 'kb:read', 'kb:write', 'task:read', 'task:write',
];

const SUPERVISOR: Permission[] = [
  ...ATENDENTE,
  'conversation:read_all', 'conversation:monitor', 'recording:listen', 'kb:approve', 'task:manage',
  'queue:manage', 'routing:manage', 'ivr:manage', 'report:read', 'report:export', 'audit:read', 'contact:lgpd',
];

const FISCAL: Permission[] = [
  'report:read', 'report:export', 'fiscal:read', 'quota:manage', 'audit:read', 'task:read', 'task:write', 'kb:read',
];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  ATENDENTE: new Set(ATENDENTE),
  SUPERVISOR: new Set(SUPERVISOR),
  FISCAL: new Set(FISCAL),
  ADMIN: new Set(PERMISSIONS),
};

export function can(role: Role, perm: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(perm) ?? false;
}

export function permissionsOf(role: Role): Permission[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])];
}
