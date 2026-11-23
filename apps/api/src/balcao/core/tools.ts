import type { Channel } from './types';

/**
 * Registro de "ferramentas" do chatbot (ex.: consultar processo no e-Proc). Desacopla IA ↔ integrações:
 * a frente de integrações registra, a frente de IA lista e executa.
 */
export interface BotToolContext {
  orgId: string;
  conversationId: string;
  contactId: string;
  channel: Channel;
  /** Nível de identidade do cidadão nesta conversa (GOV.BR): null = anônimo. */
  identityLevel: 'bronze' | 'prata' | 'ouro' | null;
}

export interface BotTool {
  name: string; // ex.: eproc.consultar_processo
  description: string; // para o LLM
  /** JSON Schema dos parâmetros. */
  inputSchema: Record<string, unknown>;
  /** Nível mínimo de identidade exigido (consulta processual ⇒ 'ouro'). */
  minIdentityLevel?: 'bronze' | 'prata' | 'ouro';
  handler: (ctx: BotToolContext, input: any) => Promise<{ ok: boolean; data?: unknown; message?: string }>;
}

const tools = new Map<string, BotTool>();
export const registerBotTool = (t: BotTool) => { tools.set(t.name, t); };
export const listBotTools = () => [...tools.values()];
export const getBotTool = (name: string) => tools.get(name);
export const clearBotTools = () => tools.clear();

const RANK = { bronze: 1, prata: 2, ouro: 3 } as const;
export const identitySatisfies = (have: BotToolContext['identityLevel'], need?: BotTool['minIdentityLevel']) =>
  !need || (have !== null && RANK[have] >= RANK[need]);
