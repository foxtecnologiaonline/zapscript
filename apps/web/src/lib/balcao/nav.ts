/** Mapa de navegação do console. `perm` = permissão necessária (vem de /balcao/auth/me). Páginas ausentes dão 404 até serem implementadas. */
export interface NavItem { href: string; label: string; perm?: string; anyOf?: string[]; group: 'Atendimento' | 'Gestão' | 'Administração' | 'Conformidade' }

export const NAV: NavItem[] = [
  { href: '/balcao/atendimento', label: 'Atendimento', perm: 'conversation:reply', group: 'Atendimento' },
  { href: '/balcao/tarefas', label: 'Tarefas e demandas', anyOf: ['task:read', 'task:write'], group: 'Atendimento' },
  { href: '/balcao/conhecimento', label: 'Base de conhecimento', perm: 'kb:read', group: 'Atendimento' },
  { href: '/balcao/supervisor', label: 'Supervisão em tempo real', perm: 'conversation:monitor', group: 'Gestão' },
  { href: '/balcao/relatorios', label: 'Relatórios e indicadores', perm: 'report:read', group: 'Gestão' },
  { href: '/balcao/fiscal', label: 'Painel do fiscal', perm: 'fiscal:read', group: 'Gestão' },
  { href: '/balcao/chamadas', label: 'Chamadas e gravações', perm: 'recording:listen', group: 'Gestão' },
  { href: '/balcao/admin/usuarios', label: 'Usuários e setores', perm: 'user:manage', group: 'Administração' },
  { href: '/balcao/admin/filas', label: 'Filas e roteamento', perm: 'queue:manage', group: 'Administração' },
  { href: '/balcao/admin/ura', label: 'URA (atendimento por voz)', perm: 'ivr:manage', group: 'Administração' },
  { href: '/balcao/admin/curadoria', label: 'Curadoria e IA', perm: 'kb:approve', group: 'Administração' },
  { href: '/balcao/admin/integracoes', label: 'Canais e integrações', perm: 'integration:manage', group: 'Administração' },
  { href: '/balcao/admin/orgao', label: 'Configurações do órgão', perm: 'org:manage', group: 'Administração' },
  { href: '/balcao/admin/auditoria', label: 'Auditoria', perm: 'audit:read', group: 'Conformidade' },
  { href: '/balcao/admin/seguranca', label: 'Segurança e LGPD', perm: 'security:manage', group: 'Conformidade' },
];

export const HOME_BY_ROLE: Record<string, string> = {
  ATENDENTE: '/balcao/atendimento', SUPERVISOR: '/balcao/supervisor', FISCAL: '/balcao/fiscal', ADMIN: '/balcao/admin/usuarios',
};
