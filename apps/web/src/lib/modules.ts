/**
 * Camada de apresentação dos módulos no front (launcher /app).
 *
 * A VERDADE de dados (nome, preço, status, dependências) vem da API
 * (GET /modules) — que por sua vez é semeada de packages/modules/catalog.ts.
 * Aqui ficam apenas concerns de UI: ícone e rota de abertura de cada módulo.
 */

export interface ModuleCatalogItem {
  key: string;
  name: string;
  status: 'ga' | 'beta' | 'planned' | 'discovery' | 'bundled' | 'free';
  priceMonthly: number;
  priceYearly: number;
  dependsOn: string[];
}

/** Ícone (emoji) por módulo — puramente visual. */
export const MODULE_ICON: Record<string, string> = {
  core: '🎙️',
  atende: '🤖',
  copiloto: '🎯',
  cobranca: '💰',
  campanhas: '📣',
  crm: '📊',
  'atende-qualidade': '📈',
  legenda: '🎬',
  vendas: '🗣️',
  multicanal: '📷',
  tarefas: '✅',
};

/** Rota interna para "Abrir" um módulo contratado. core reutiliza o dashboard atual.
 *  campanhas e copiloto também vivem sob /dashboard (com sidebar própria) —
 *  ver CAMPANHAS_ARQUITETURA.md §10. Os demais módulos seguem em /app/<key>. */
export function moduleRoute(key: string): string {
  if (key === 'core') return '/dashboard';
  if (key === 'campanhas') return '/dashboard/campanhas';
  if (key === 'copiloto') return '/dashboard/copiloto';
  return `/app/${key}`;
}

/** Rótulo curto do estágio do módulo. */
export const STATUS_LABEL: Record<ModuleCatalogItem['status'], string> = {
  ga: 'Disponível',
  beta: 'Beta',
  planned: 'Em breve',
  discovery: 'Em estudo',
  bundled: 'Incluso no plano',
  free: 'Grátis para todos',
};

/** Um módulo pode ser contratado agora avulso? (planned/discovery/bundled/free não). */
export function isContractable(status: ModuleCatalogItem['status']): boolean {
  return status === 'ga' || status === 'beta';
}

export function formatBrl(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
