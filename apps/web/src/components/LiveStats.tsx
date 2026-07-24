'use client';

import { useState, useEffect } from 'react';

/* ─────────────────────────────────────────────────────────────────
   LiveStats — contador animado de atividade real do ZapScript.

   Busca GET /demo/stats a cada 5 min e exibe:
   - Total de áudios processados (com contagem animada)
   - Usuários cadastrados
   - Horas economizadas (2 min por áudio em média)

   Fallback: se a API falhar, mostra os valores estáticos do backend.
   O glass card da home usa este componente para prova social em tempo real.
───────────────────────────────────────────────────────────────── */

interface Stats {
  totalAudios: number;
  totalUsers: number;
  hoursSaved: number;
}

const FALLBACK: Stats = { totalAudios: 1240, totalUsers: 380, hoursSaved: 41 };

function formatNumber(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return k >= 10 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`;
  }
  return String(n);
}

/** Anima do valor anterior para o novo (easing out). */
function useAnimatedValue(target: number, duration = 1200): number {
  const [val, setVal] = useState(target);

  useEffect(() => {
    if (target === val) return;
    const start = val;
    const diff = target - start;
    const t0 = performance.now();

    let raf: number;
    const tick = (now: number) => {
      const elapsed = now - t0;
      const progress = Math.min(elapsed / duration, 1);
      // ease out quad
      const eased = 1 - (1 - progress) * (1 - progress);
      setVal(Math.round(start + diff * eased));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return val;
}

export default function LiveStats() {
  const [stats, setStats] = useState<Stats>(FALLBACK);

  useEffect(() => {
    let cancelled = false;

    async function fetchStats() {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'https://api.zapscript.me'}/demo/stats`);
        if (!res.ok) throw new Error('non-ok');
        const data = await res.json();
        if (!cancelled && data && typeof data.totalAudios === 'number') {
          setStats(data);
        }
      } catch {
        // fallback silencioso — mantém o último valor ou o FALLBACK
      }
    }

    fetchStats();

    // Atualiza a cada 10 min (cache do backend é 5 min, mas stats não mudam tão rápido)
    const interval = setInterval(fetchStats, 10 * 60 * 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const animatedAudios = useAnimatedValue(stats.totalAudios);
  const animatedUsers = useAnimatedValue(stats.totalUsers);

  return (
    <>
      {/* Audios processados */}
      <div className="text-center">
        <p className="font-display text-xl font-bold text-brand-text">{formatNumber(animatedAudios)}+</p>
        <p className="text-[11px] font-medium mt-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>
          Áudios lidos
        </p>
      </div>

      <div style={{ width: 1, height: 40, background: 'rgb(var(--color-border))' }} />

      {/* Usuários */}
      <div className="text-center">
        <p className="font-display text-xl font-bold text-brand-text">{formatNumber(animatedUsers)}+</p>
        <p className="text-[11px] font-medium mt-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>
          Usuários
        </p>
      </div>

      <div style={{ width: 1, height: 40, background: 'rgb(var(--color-border))' }} />

      {/* Horas economizadas */}
      <div className="text-center">
        <p className="font-display text-xl font-bold text-brand-text">{formatNumber(stats.hoursSaved)}h+</p>
        <p className="text-[11px] font-medium mt-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>
          Economizadas
        </p>
      </div>
    </>
  );
}
