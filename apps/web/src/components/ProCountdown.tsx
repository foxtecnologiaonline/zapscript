'use client';
import { useState, useEffect } from 'react';

// Oferta encerra 30/06/2026 às 23:59:59 (horário de Brasília, UTC-3)
const TARGET = new Date('2026-06-30T23:59:59-03:00').getTime();

function pad(n: number) { return String(n).padStart(2, '0'); }

export function ProCountdown() {
  const [left, setLeft] = useState(TARGET - Date.now());

  useEffect(() => {
    const id = setInterval(() => setLeft(TARGET - Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (left <= 0) return <>🔥 Oferta de junho</>;

  const d = Math.floor(left / 86_400_000);
  const h = Math.floor((left % 86_400_000) / 3_600_000);
  const m = Math.floor((left % 3_600_000) / 60_000);
  const s = Math.floor((left % 60_000) / 1_000);

  if (d >= 1) return <>🔥 Oferta acaba em {d}d {pad(h)}h {pad(m)}m</>;
  return <>🔥 Acaba em {pad(h)}:{pad(m)}:{pad(s)}</>;
}
