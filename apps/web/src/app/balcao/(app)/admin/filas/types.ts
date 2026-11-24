import type { Hours } from '../orgao/BusinessHoursEditor';

export type Strategy = 'LEAST_BUSY' | 'ROUND_ROBIN' | 'LONGEST_IDLE';
export const STRATEGY_LABEL: Record<Strategy, string> = { LEAST_BUSY: 'Menos ocupado', ROUND_ROBIN: 'Rodízio', LONGEST_IDLE: 'Há mais tempo ocioso' };
export const STRATEGY_HINT: Record<Strategy, string> = {
  LEAST_BUSY: 'Escolhe quem tem menos conversas em andamento.', ROUND_ROBIN: 'Reveza entre os atendentes, do que recebeu há mais tempo.', LONGEST_IDLE: 'Escolhe quem está há mais tempo sem atividade.',
};
export const CHANNELS = ['WHATSAPP', 'WEBCHAT', 'EMAIL', 'VOICE'] as const;

export interface Queue {
  id: string; name: string; slug: string; categories: string[]; channels: string[]; requiredSkills: string[]; priority: number; strategy: Strategy;
  slaFirstResponseSec: number; slaResolutionSec: number | null; maxWaitSec: number | null; overflowQueueId: string | null; businessHours: Hours | null;
  sectorId: string | null; active: boolean; memberCount?: number;
}
export interface Agent { id: string; name: string; email: string; role: string; skills: string[]; presence: string }
export interface RuleConditions {
  channels?: string[]; contactCategories?: string[]; categories?: string[]; intents?: string[]; outsideHours?: boolean; weekdays?: Array<number | string>; minWaitSec?: number;
}
export interface RuleAction { queueId: string; priorityBoost?: number; setCategory?: string }
export interface Rule { id: string; name: string; position: number; active: boolean; conditions: RuleConditions; action: RuleAction }
export interface Canned { id: string; shortcut: string; title: string; body: string }
