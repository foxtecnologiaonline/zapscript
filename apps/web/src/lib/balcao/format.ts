/** Formatação pt-BR / fuso do Tocantins (America/Araguaina) para o Balcão Virtual. */
const TZ = 'America/Araguaina';
const toDate = (d: string | number | Date | null | undefined) => (d == null ? null : d instanceof Date ? d : new Date(d));

export function fmtDateTime(d: string | number | Date | null | undefined): string {
  const x = toDate(d); if (!x || isNaN(+x)) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' }).format(x);
}
export function fmtDate(d: string | number | Date | null | undefined): string {
  const x = toDate(d); if (!x || isNaN(+x)) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, dateStyle: 'short' }).format(x);
}
export function fmtTime(d: string | number | Date | null | undefined): string {
  const x = toDate(d); if (!x || isNaN(+x)) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, timeStyle: 'short' }).format(x);
}
/** 3725 → "1h 02min"; 75 → "1min 15s"; 8 → "8s". */
export function fmtDuration(sec: number | null | undefined): string {
  if (sec == null || !isFinite(sec)) return '—';
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  if (h) return `${h}h ${String(m).padStart(2, '0')}min`;
  if (m) return `${m}min ${String(r).padStart(2, '0')}s`;
  return `${r}s`;
}
/** "há 5 min" */
export function fmtAgo(d: string | number | Date | null | undefined, now = Date.now()): string {
  const x = toDate(d); if (!x) return '—';
  const diff = Math.round((now - +x) / 1000);
  if (diff < 45) return 'agora';
  if (diff < 3600) return `há ${Math.round(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.round(diff / 3600)} h`;
  return `há ${Math.round(diff / 86400)} d`;
}
export const fmtNumber = (n: number | null | undefined, digits = 0) => n == null ? '—' : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
export const fmtPercent = (n: number | null | undefined, digits = 1) => n == null ? '—' : `${fmtNumber(n, digits)}%`;
export const fmtBRL = (n: number | null | undefined) => n == null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
export function fmtBytes(n: number | null | undefined): string {
  if (n == null) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${fmtNumber(v, i ? 1 : 0)} ${u[i]}`;
}
export const maskPhone = (p?: string | null) => (p ? p.replace(/^(\d{2})(\d{2})(\d{4,5})(\d{4})$/, '+$1 ($2) $3-$4') : '—');

export const CHANNEL_LABEL: Record<string, string> = { WHATSAPP: 'WhatsApp', WEBCHAT: 'Chat do site', EMAIL: 'E-mail', VOICE: 'Telefone' };
export const STATUS_LABEL: Record<string, string> = { BOT: 'Com o assistente', WAITING: 'Aguardando atendente', ACTIVE: 'Em atendimento', CLOSED: 'Encerrada' };
export const ROLE_LABEL: Record<string, string> = { ATENDENTE: 'Atendente', SUPERVISOR: 'Supervisor', ADMIN: 'Administrador', FISCAL: 'Fiscal do contrato' };
export const PRESENCE_LABEL: Record<string, string> = { ONLINE: 'Disponível', AWAY: 'Ausente', BUSY: 'Ocupado', OFFLINE: 'Desconectado' };
export const PRIORITY_LABEL: Record<string, string> = { LOW: 'Baixa', NORMAL: 'Normal', HIGH: 'Alta', URGENT: 'Urgente' };
