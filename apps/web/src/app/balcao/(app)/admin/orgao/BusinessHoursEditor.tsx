'use client';
import React from 'react';
import { Button } from '../../../_ui/ui';
import { WEEKDAY_PT } from '../usuarios/_shared';

export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type Hours = Partial<Record<DayKey, Array<[string, string]>>>;
export const DAY_ORDER: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const MAX_WINDOWS = 6;

/** Retorna mensagens de validação por dia (`start < end`, formato HH:mm). */
export function validateHours(h: Hours): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of DAY_ORDER) {
    const w = h[d] ?? [];
    for (let i = 0; i < w.length; i++) {
      const [a, b] = w[i];
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(a) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(b)) { out[d] = `Janela ${i + 1}: informe horários no formato HH:mm.`; break; }
      if (a >= b) { out[d] = `Janela ${i + 1}: o início deve ser anterior ao fim.`; break; }
    }
    if (!out[d]) {
      const sorted = [...w].sort((x, y) => x[0].localeCompare(y[0]));
      for (let i = 1; i < sorted.length; i++) if (sorted[i][0] < sorted[i - 1][1]) { out[d] = 'As janelas não podem se sobrepor.'; break; }
    }
  }
  return out;
}

/** Editor do horário por dia da semana: janelas "HH:mm" (adicionar/remover). Dia sem janelas = fechado. */
export default function BusinessHoursEditor({ value, onChange, errors = {}, legend = 'Horário de atendimento por dia da semana' }: {
  value: Hours; onChange: (v: Hours) => void; errors?: Record<string, string>; legend?: string;
}) {
  const set = (d: DayKey, w: Array<[string, string]>) => onChange({ ...value, [d]: w });
  const copyMonToWeek = () => {
    const mon = value.mon ?? [];
    onChange({ ...value, tue: mon.map((x) => [...x] as [string, string]), wed: mon.map((x) => [...x] as [string, string]), thu: mon.map((x) => [...x] as [string, string]), fri: mon.map((x) => [...x] as [string, string]) });
  };
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      {DAY_ORDER.map((d) => {
        const w = value[d] ?? [];
        const errId = `bh-${d}-err`;
        return (
          <div key={d} role="group" aria-label={WEEKDAY_PT[d]} aria-describedby={errors[d] ? errId : undefined} className="rounded-md border border-bv-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">{WEEKDAY_PT[d]} {!w.length && <span className="ml-2 text-sm font-normal text-bv-muted">(fechado)</span>}</p>
              <div className="flex flex-wrap gap-1">
                {d === 'mon' && <Button size="sm" variant="ghost" onClick={copyMonToWeek}>Copiar para terça a sexta</Button>}
                <Button size="sm" variant="secondary" disabled={w.length >= MAX_WINDOWS} aria-label={`Adicionar janela de horário em ${WEEKDAY_PT[d]}`} onClick={() => set(d, [...w, w.length ? ['14:00', '18:00'] : ['08:00', '18:00']])}>Adicionar janela</Button>
              </div>
            </div>
            {w.map((win, i) => (
              <div key={i} className="mt-2 flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1">
                  <label htmlFor={`bh-${d}-${i}-a`} className="text-xs text-bv-muted">Início ({WEEKDAY_PT[d]}, janela {i + 1})</label>
                  <input id={`bh-${d}-${i}-a`} type="time" required value={win[0]} onChange={(e) => set(d, w.map((x, j) => (j === i ? [e.target.value, x[1]] : x)))}
                    aria-invalid={errors[d] ? true : undefined} className="min-h-[40px] rounded-md border border-bv-border bg-bv-surface px-2" />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor={`bh-${d}-${i}-b`} className="text-xs text-bv-muted">Fim ({WEEKDAY_PT[d]}, janela {i + 1})</label>
                  <input id={`bh-${d}-${i}-b`} type="time" required value={win[1]} onChange={(e) => set(d, w.map((x, j) => (j === i ? [x[0], e.target.value] : x)))}
                    aria-invalid={errors[d] ? true : undefined} className="min-h-[40px] rounded-md border border-bv-border bg-bv-surface px-2" />
                </div>
                <Button size="sm" variant="secondary" aria-label={`Remover janela ${i + 1} de ${WEEKDAY_PT[d]}`} onClick={() => set(d, w.filter((_, j) => j !== i))}>Remover</Button>
              </div>
            ))}
            {errors[d] && <p id={errId} role="alert" className="mt-2 text-sm text-bv-danger">{errors[d]}</p>}
          </div>
        );
      })}
    </fieldset>
  );
}
