import { POSTS } from './posts';

/**
 * Páginas de categoria/cluster do blog — consolidam sinal topical por tema
 * e linkam de volta para as LPs de nicho correspondentes (técnica de silo).
 */
// Nenhuma categoria atual usa acento (Guias, Produtividade, Dicas, Empresas,
// Comparativos, Casos de uso, Nichos) — slugify simples é suficiente.
export function slugifyCategory(category: string): string {
  return category.toLowerCase().replace(/\s+/g, '-');
}

export interface CategoryMeta {
  label:       string;
  slug:        string;
  description: string;
}

export const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  'Guias':        'Passo a passo completo para converter áudio do WhatsApp em texto, em qualquer dispositivo.',
  'Produtividade':'Como economizar horas por semana deixando de ouvir áudio e passando a ler.',
  'Dicas':        'Recomendações práticas de privacidade, segurança e uso do dia a dia.',
  'Empresas':     'Conversão de áudio aplicada a times, atendimento e operação de negócio.',
  'Comparativos': 'ZapScript frente a outras ferramentas de transcrição e assistentes de IA.',
  'Casos de uso': 'Exemplos reais de quem já converte áudio automaticamente no WhatsApp.',
  'Nichos':       'Guias específicos por profissão — corretores, advogados, vendedores e mais.',
};

/** LPs de nicho relacionadas — exibidas na categoria "Nichos" para reforçar o silo temático. */
export const NICHE_LPS: { label: string; href: string }[] = [
  { label: 'Corretores de imóveis', href: '/corretores' },
  { label: 'Advogados',             href: '/advogados' },
  { label: 'Vendas',                href: '/vendas' },
  { label: 'Dentistas',             href: '/dentistas' },
  { label: 'Contabilidade',         href: '/para/contabilidade' },
];

export function allCategories(): CategoryMeta[] {
  const labels = Array.from(new Set(POSTS.map(p => p.category)));
  return labels.map(label => ({
    label,
    slug: slugifyCategory(label),
    description: CATEGORY_DESCRIPTIONS[label] ?? '',
  }));
}

export function getCategoryBySlug(slug: string): CategoryMeta | undefined {
  return allCategories().find(c => c.slug === slug);
}
