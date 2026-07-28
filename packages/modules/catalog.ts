/**
 * ZapScript Suite — Catálogo canônico de módulos (fonte ÚNICA da verdade).
 *
 * Consumido por API (gate + checkout), Web (launcher + upsell) e billing.
 * NÃO duplicar key/nome/preço/estado em nenhum outro lugar — importe daqui.
 *
 * Sem imports externos de propósito: é dado puro, seguro de importar em qualquer
 * pipeline (api/worker/web) sem risco de build.
 *
 * Ver arquitetura: MODULOS_ARQUITETURA.md
 */

/** Estágio de maturidade do módulo. */
export type ModuleStatus =
  | 'ga'        // disponível a todos
  | 'beta'      // liberado, em amadurecimento
  | 'planned'   // no roadmap, ainda não construído
  | 'discovery' // especulativo — validar demanda antes de construir
  | 'bundled';  // só via tier (Profissional/Empresas) — não vendido avulso

export interface ModuleSpec {
  /** Chave estável (== Product.key no banco, == segmento de rota /app/<key>). */
  key: string;
  /** Nome comercial exibido ao usuário. */
  name: string;
  /** Emoji/ícone do card no launcher. */
  icon: string;
  /** Frase curta (o que é). */
  tagline: string;
  /** JTBD — a dor concreta que resolve. */
  jtbd: string;
  status: ModuleStatus;
  /** Preço mensal à la carte (BRL). 0 = incluso/base. Placeholders — validar com pricing. */
  priceMonthly: number;
  /** Preço anual (BRL) — ~20% off × 12 quando aplicável. */
  priceYearly: number;
  /** Módulos que precisam estar ativos para este funcionar (dependência dura). */
  dependsOn: string[];
  /** Serviços de infra reaproveitados (documental — evita reconstruir o que já existe). */
  reuses: string[];
  /** Fase de rollout no roadmap (0 = fundação já entregue). */
  phase: number;
}

/**
 * Catálogo. `core` é a base (tiers free/pro vivem em Plan/MinuteBalance).
 * Preços marcados como proposta — ajustar em §Billing após decisão de pricing.
 */
export const MODULES: readonly ModuleSpec[] = [
  {
    key: 'core',
    name: 'ZapScript',
    icon: '🎙️',
    tagline: 'Transcrição e resumo de áudios do WhatsApp',
    jtbd: 'Não tenho tempo de ouvir áudio longo no WhatsApp.',
    status: 'ga',
    priceMonthly: 37,
    priceYearly: 355,
    dependsOn: [],
    reuses: ['mensageria', 'transcricao', 'ia'],
    phase: 0,
  },
  {
    key: 'atende',
    name: 'ZapScript Atende',
    icon: '🤖',
    tagline: 'Atendimento automático 24/7 no WhatsApp',
    jtbd: 'Preciso responder cliente na hora sem contratar equipe.',
    // Retirado da venda avulsa (revisão de tiers ZapScript 2.0) — passou a
    // vir incluso no Profissional/Empresas (ver TIER_MODULE_BUNDLES em
    // routes/billing.ts). Quem já era assinante avulso mantém acesso; só a
    // contratação nova é bloqueada. Preço aqui é só referência histórica.
    status: 'bundled',
    priceMonthly: 67,
    priceYearly: 643,
    dependsOn: [],
    reuses: ['mensageria', 'ia', 'knowledge-base'],
    phase: 1,
  },
  {
    key: 'cobranca',
    name: 'ZapScript Cobrança',
    icon: '💰',
    tagline: 'Lembrete e cobrança automática via WhatsApp',
    jtbd: 'Sou MEI e não tenho tempo de cobrar quem venceu/vence hoje; perco receita por inadimplência.',
    // Retirado de venda (revisão de tiers) — absorvido pelo recurso de Avisos
    // do Profissional. Código e dados seguem intactos. Ver index.ts.
    status: 'planned',
    priceMonthly: 39,
    priceYearly: 374,
    dependsOn: [],
    reuses: ['mensageria'], // 100% da infra de envio já validada
    phase: 2,
  },
  {
    key: 'campanhas',
    name: 'ZapScript Campanhas',
    icon: '📣',
    tagline: 'Disparo em massa compliant via API oficial',
    jtbd: 'Perdi meu bot não autorizado (política Meta dez/2025) e preciso de alternativa legal agora.',
    status: 'beta',
    priceMonthly: 67,
    priceYearly: 643,
    dependsOn: [],
    reuses: ['whatsapp-oficial', 'mensageria'],
    phase: 3,
  },
  {
    key: 'crm',
    name: 'ZapScript CRM',
    icon: '📊',
    tagline: 'Funil de vendas dentro do WhatsApp',
    jtbd: 'Respondo no WhatsApp mas não organizo quem é lead novo, quem está negociando e quem fechou.',
    // Retirado da venda avulsa (revisão de tiers ZapScript 2.0) — exclusivo
    // do Empresas (ver TIER_MODULE_BUNDLES em routes/billing.ts). Quem já
    // era assinante avulso mantém acesso. Preço aqui é só referência histórica.
    status: 'bundled',
    priceMonthly: 47,
    priceYearly: 451,
    dependsOn: [],
    reuses: ['mensageria', 'conversas'],
    phase: 4,
  },
  {
    key: 'atende-qualidade',
    name: 'Atende Qualidade',
    icon: '📈',
    tagline: 'Análise das conversas do Atende (tempo, sentimento, conversão)',
    jtbd: 'Assumi o atendimento por bot — mas está funcionando? Preciso medir.',
    status: 'planned',
    priceMonthly: 27,
    priceYearly: 259,
    dependsOn: ['atende'],
    reuses: ['dados-atende', 'ia'],
    phase: 4,
  },
  {
    key: 'legenda',
    name: 'ZapScript Legendas',
    icon: '🎬',
    tagline: 'Legenda automática para Reels e Stories',
    jtbd: 'Faço vídeo curto e preciso de legenda sem editar na mão.',
    // Retirado de venda (ajuste de negócio) — código e dados (LegendaJob)
    // seguem intactos; quem já tinha o módulo mantém acesso. Não promover
    // sem decisão explícita. Ver o force-heal em apps/api/src/index.ts.
    status: 'planned',
    priceMonthly: 37,
    priceYearly: 355,
    dependsOn: [],
    reuses: ['transcricao'], // só nova interface sobre o Whisper
    phase: 5,
  },
  {
    key: 'vendas',
    name: 'ZapScript Vendas',
    icon: '🗣️',
    tagline: 'Grave a visita/ligação → vira nota no CRM',
    jtbd: 'Vendedor externo perde o registro da visita; queremos transcrever e lançar como atividade.',
    // Retirado de venda (revisão de tiers) — código e dados seguem intactos.
    status: 'planned',
    priceMonthly: 57,
    priceYearly: 547,
    dependsOn: [], // sinergia (não dependência) com 'crm'
    reuses: ['transcricao', 'ia'],
    phase: 5,
  },
  {
    key: 'tarefas',
    name: 'ZapScript Tarefas',
    icon: '✅',
    tagline: 'Designação e controle de tarefas na equipe',
    jtbd: 'Preciso distribuir tarefas pro time e saber o que está pendente/atrasado.',
    // Empacotado só no tier Empresas — não é vendido avulso.
    status: 'planned',
    priceMonthly: 0,
    priceYearly: 0,
    dependsOn: [],
    reuses: ['mensageria'],
    phase: 3,
  },
  {
    key: 'multicanal',
    name: 'ZapScript Multicanal',
    icon: '📷',
    tagline: 'Os módulos ZapScript também no Instagram, Facebook e Telegram',
    jtbd: 'Meus clientes não falam só pelo WhatsApp — preciso do mesmo atendimento/automação no Instagram, Facebook e Telegram.',
    status: 'discovery', // validar com 5 conversas antes de construir
    priceMonthly: 27,
    priceYearly: 259,
    dependsOn: [],
    reuses: ['transcricao', 'ia', 'mensageria'],
    phase: 6,
  },
] as const;

/** Índice por key para lookup O(1). */
export const MODULE_BY_KEY: Readonly<Record<string, ModuleSpec>> = Object.freeze(
  Object.fromEntries(MODULES.map((m) => [m.key, m])),
);

/** Todas as keys válidas. */
export const MODULE_KEYS: readonly string[] = MODULES.map((m) => m.key);

/** Type guard: a string é uma key de módulo conhecida? */
export function isModuleKey(key: string): boolean {
  return key in MODULE_BY_KEY;
}

/**
 * Resolve o conjunto de módulos efetivamente utilizáveis a partir dos módulos
 * contratados, aplicando dependências. Um módulo com dependsOn não satisfeita
 * NÃO entra no conjunto usável (o front deve sinalizar "requer módulo X").
 */
export function resolveUsableModules(ownedKeys: string[]): string[] {
  const owned = new Set(ownedKeys.filter(isModuleKey));
  return [...owned].filter((key) => {
    const spec = MODULE_BY_KEY[key];
    return spec.dependsOn.every((dep) => owned.has(dep));
  });
}

/**
 * Preço total mensal de uma cesta de módulos (sem desconto de bundle).
 * O desconto de bundle, quando definido, deve ser aplicado por cima deste valor
 * na camada de billing — mantido fora daqui para o catálogo permanecer dado puro.
 */
export function basketMonthlyPrice(keys: string[]): number {
  return keys
    .filter(isModuleKey)
    .reduce((sum, key) => sum + MODULE_BY_KEY[key].priceMonthly, 0);
}
