import type { BusinessHours, BvOrgSettings, DayKey } from '../core/settings';

/**
 * Soma de tempo útil por saltos de janela (O(dias)), no lugar de `addBusinessSeconds` do núcleo, que varre minuto a
 * minuto e recria um Intl.DateTimeFormat a cada passo (≈ centenas de ms por conversa em prazos de 24 h úteis).
 * Mesma semântica do núcleo (janelas "HH:mm" por dia, feriados fechados, fuso do órgão); equivalência coberta em testes.
 */
const fmtCache = new Map<string, Intl.DateTimeFormat>();
const DAY_BY_SHORT: Record<string, DayKey> = { Sun: 'sun', Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat' };

function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    fmtCache.set(tz, f);
  }
  return f;
}

export function localPartsFast(at: Date | number, tz: string): { day: DayKey; minutes: number; ymd: string } {
  const p: Record<string, string> = {};
  for (const x of formatter(tz).formatToParts(at)) p[x.type] = x.value;
  return { day: DAY_BY_SHORT[p.weekday], minutes: (Number(p.hour) % 24) * 60 + Number(p.minute), ymd: `${p.year}-${p.month}-${p.day}` };
}

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

function windowsOf(hours: BusinessHours, day: DayKey): Array<[number, number]> {
  return (hours[day] ?? []).map(([a, b]) => [toMin(a), toMin(b)] as [number, number]).sort((x, y) => x[0] - y[0]);
}

export function addBusinessSecondsFast(
  settings: Pick<BvOrgSettings, 'timezone' | 'businessHours'>, from: Date, seconds: number,
  holidays: Set<string> = new Set(), hoursOverride?: BusinessHours | null,
): Date {
  const hours = hoursOverride ?? settings.businessHours;
  const tz = settings.timezone;
  let remaining = seconds;
  let t = from.getTime();
  const limit = t + 60 * 86400_000;
  for (let guard = 0; remaining > 0 && t < limit && guard < 2000; guard++) {
    const p = localPartsFast(t, tz);
    const secInMin = Math.floor(t / 1000) % 60;
    const nowSec = p.minutes * 60 + secInMin; // segundos desde 00:00 local
    const today = holidays.has(p.ymd) ? [] : windowsOf(hours, p.day);
    const cur = today.find(([a, b]) => p.minutes >= a && p.minutes < b);
    if (cur) {
      const step = Math.min(remaining, cur[1] * 60 - nowSec);
      t += step * 1000; remaining -= step;
      continue;
    }
    // fechado: salta para o início da próxima janela
    const later = today.find(([a]) => a > p.minutes);
    if (later) { t += (later[0] * 60 - nowSec) * 1000; continue; }
    let jumped = false;
    for (let d = 1; d <= 8 && !jumped; d++) {
      const q = localPartsFast(t + d * 86400_000, tz);
      const ws = holidays.has(q.ymd) ? [] : windowsOf(hours, q.day);
      if (ws.length) { t += ((86400 - nowSec) + (d - 1) * 86400 + ws[0][0] * 60) * 1000; jumped = true; }
    }
    if (!jumped) return new Date(from.getTime() + seconds * 1000);
  }
  return remaining > 0 ? new Date(from.getTime() + seconds * 1000) : new Date(t);
}
