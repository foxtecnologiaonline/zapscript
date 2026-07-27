/**
 * Tipos e helpers do módulo CRM (funil de vendas do WhatsApp).
 * Espelham os models Prisma CrmStage/CrmContact/CrmActivity — ver
 * packages/database/prisma/schema.prisma e apps/api/src/routes/modules/crm/index.ts.
 */

export interface CrmStage {
  id: string;
  userId: string;
  name: string;
  order: number;
  color: string;
  isWon: boolean;
  isLost: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CrmContact {
  id: string;
  userId: string;
  stageId: string;
  name: string;
  phone: string;
  email: string | null;
  company: string | null;
  value: number | null;
  tags: string[];
  numberId: string | null;
  source: string;
  lostReason: string | null;
  lastActivityAt: string;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CrmActivity {
  id: string;
  contactId: string;
  userId: string;
  type: 'note' | 'stage_change' | 'call' | 'meeting' | 'reminder' | 'whatsapp';
  content: string;
  dueAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface StageWithContacts extends CrmStage {
  contacts: CrmContact[];
}

export interface ContactDetail extends CrmContact {
  stage: CrmStage;
  activities: CrmActivity[];
}

export interface ReminderItem extends CrmActivity {
  contact: { id: string; name: string; phone: string; stageId: string };
}

export interface ImportSuggestion {
  phone: string;
  name: string | null;
  numberId: string | null;
  lastAt: string;
  count: number;
}

export interface CrmDashboardTopCliente {
  id: string;
  name: string;
  phone: string;
  company: string | null;
  value: number | null;
  activityCount: number;
}

export interface CrmDashboard {
  periodDays: number;
  faturamentoFechado: number;
  negociosFechados: number;
  negociosPerdidos: number;
  novosLeads: number;
  atendimentosSemana: number;
  topClientes: CrmDashboardTopCliente[];
}

export const ACTIVITY_ICON: Record<CrmActivity['type'], string> = {
  note: '📝',
  stage_change: '🔄',
  call: '📞',
  meeting: '🤝',
  reminder: '⏰',
  whatsapp: '💬',
};

export const ACTIVITY_LABEL: Record<CrmActivity['type'], string> = {
  note: 'Nota',
  stage_change: 'Mudança de estágio',
  call: 'Ligação',
  meeting: 'Reunião',
  reminder: 'Lembrete',
  whatsapp: 'WhatsApp',
};

/** Formata telefone BR (aceita com ou sem DDI 55) para exibição. */
export function formatPhone(phone: string): string {
  let d = phone.replace(/\D/g, '');
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return phone;
}

/** "há 2h" / "em 3d" / data curta para intervalos longos. */
export function relativeTime(iso: string): string {
  const d = new Date(iso).getTime();
  const diff = d - Date.now();
  const abs = Math.abs(diff);
  const min = 60_000, hour = 60 * min, day = 24 * hour;

  let label: string;
  if (abs < min) return 'agora';
  else if (abs < hour) label = `${Math.round(abs / min)}min`;
  else if (abs < day) label = `${Math.round(abs / hour)}h`;
  else if (abs < 30 * day) label = `${Math.round(abs / day)}d`;
  else return new Date(d).toLocaleDateString('pt-BR');

  return diff < 0 ? `há ${label}` : `em ${label}`;
}

export function sumValue(contacts: CrmContact[]): number {
  return contacts.reduce((sum, c) => sum + (c.value || 0), 0);
}
