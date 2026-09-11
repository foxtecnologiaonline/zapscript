'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { usePathname } from 'next/navigation';

/* ─────────────────────────────────────────────────────────────────
   SocialProofToast — notificações rotativas de prova social.

   Mostra toasts no canto inferior esquerdo que aparecem e somem,
   um de cada vez, com fade in/out. As mensagens mesclam dados
   reais da API /demo/stats com variações textuais.

   Só roda nas rotas de topo de funil (home, /lp, /cadastro, /login) —
   em qualquer outra rota (dashboard etc.) o componente não renderiza
   nem inicia o polling/timers.

   Ciclo: aparece → fica visível 3.5s → fade out 500ms → pausa
   11.5-13.5s (aleatório) → próximo item. Total entre um toast e
   outro: ~15-17s.
   ──────────────────────────────────────────────────────────────── */

/* Rotas onde o toast pode aparecer — "LP" cobre a home (que é a
   landing page principal) e a /lp dedicada (tráfego pago). */
const ALLOWED_PATHS = ['/', '/lp', '/cadastro', '/login'];

function isAllowedPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return ALLOWED_PATHS.some((p) =>
    p === '/' ? pathname === '/' : pathname === p || pathname.startsWith(`${p}/`)
  );
}

interface LiveStats {
  totalAudios: number;
  totalUsers: number;
  hoursSaved: number;
  todayAudios?: number;
  weekAudios?: number;
}

/* ── Pool de templates ── */
type TemplateFn = (s: LiveStats) => string;

const TEMPLATES: TemplateFn[] = [
  // ── Volume total ──
  (s) => `Já são ${fmt(s.totalAudios)} áudios convertidos em texto`,
  (s) => `Mais de ${fmt(s.totalAudios)} áudios já transcritos na plataforma`,
  (s) => `${fmt(s.totalAudios)} áudios convertidos — e contando`,

  // ── Hoje / semana ──
  (s) => `${fmt(s.todayAudios ?? 0)} áudios convertidos nas últimas 24h`,
  (s) => `Hoje: ${fmt(s.todayAudios ?? 0)} áudios transformados em texto`,
  (s) => `${fmt(s.weekAudios ?? 0)} áudios convertidos nos últimos 7 dias`,
  (s) => `Essa semana: ${fmt(s.weekAudios ?? 0)} áudios já processados`,

  // ── Tempo economizado ──
  (s) => `${fmt(s.hoursSaved)}h de áudio que ninguém precisou ouvir`,
  (s) => `${fmt(s.hoursSaved)}h economizadas em escuta de áudio`,
  (s) => `Equivalente a ${fmt(Math.round(s.hoursSaved / 24))} dias de escuta poupados`,
  (s) => `Cerca de ${fmt(Math.round(s.hoursSaved * 60))} minutos de áudio poupados dos seus ouvidos`,

  // ── Médias ──
  (s) => `Média de ${fmt(Math.round((s.weekAudios ?? 0) / 7))} áudios convertidos por dia essa semana`,

  // ── Combinado ──
  (s) => `${fmt(s.todayAudios ?? 0)} áudios hoje, ${fmt(s.weekAudios ?? 0)} essa semana — só cresce`,
];

function fmt(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return k >= 10 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`;
  }
  return String(Math.round(n));
}

const FALLBACK: LiveStats = { totalAudios: 1240, totalUsers: 380, hoursSaved: 41, todayAudios: 47, weekAudios: 310 };

type Toast = { id: number; text: string };

export default function SocialProofToast() {
  const pathname = usePathname();
  const allowed = isAllowedPath(pathname);

  const [stats, setStats] = useState<LiveStats>(FALLBACK);
  const [toast, setToast] = useState<Toast | null>(null);
  const nextId = useRef(1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  // Puxa stats reais a cada 5 min — só nas rotas permitidas
  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    const fetchStats = async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'https://api.zapscript.me'}/demo/stats`);
        if (!res.ok) throw new Error('non-ok');
        const data = await res.json();
        if (!cancelled && data && typeof data.totalAudios === 'number') setStats(data);
      } catch { /* fallback silencioso */ }
    };
    fetchStats();
    const iv = setInterval(fetchStats, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [allowed]);

  // Ciclo de toasts — nunca repete o mesmo consecutivo
  const lastIdx = useRef(-1);

  const showNext = useCallback(() => {
    if (!mounted.current) return;
    let idx = Math.floor(Math.random() * TEMPLATES.length);
    if (TEMPLATES.length > 1 && idx === lastIdx.current) {
      idx = (idx + 1 + Math.floor(Math.random() * (TEMPLATES.length - 1))) % TEMPLATES.length;
    }
    lastIdx.current = idx;
    const text = TEMPLATES[idx](stats);
    const id = nextId.current++;
    setToast({ id, text });

    // Remove após 3.5s visível + 500ms fade
    timer.current = setTimeout(() => {
      if (!mounted.current) return;
      setToast(null);
      // Pausa aleatória entre 11.5s e 13.5s antes do próximo
      // (3.5s visível + pausa = ~15-17s entre um toast e outro)
      const gap = 11500 + Math.random() * 2000;
      timer.current = setTimeout(showNext, gap);
    }, 3500);
  }, [stats]);

  // Inicia o ciclo — só nas rotas permitidas
  useEffect(() => {
    if (!allowed) {
      setToast(null);
      return;
    }
    mounted.current = true;
    // Primeiro toast após 2s
    const init = setTimeout(showNext, 2000);
    return () => {
      mounted.current = false;
      clearTimeout(init);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [showNext, allowed]);

  if (!allowed || !toast) return null;

  return (
    <div
      key={toast.id}
      className="social-toast"
      style={{
        position: 'fixed',
        bottom: 24,
        left: 24,
        zIndex: 9998,
        maxWidth: 'calc(100vw - 48px)',
        pointerEvents: 'none',
      }}
    >
      <span
        className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-semibold shadow-xl"
        style={{
          background: 'rgba(15,23,42,.92)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid rgba(16,185,129,.18)',
          color: '#e2e8f0',
          boxShadow: '0 8px 32px rgba(0,0,0,.4), 0 0 0 1px rgba(16,185,129,.06)',
        }}
      >
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ background: '#10b981', boxShadow: '0 0 6px rgba(16,185,129,.5)' }}
        />
        {toast.text}
      </span>

      <style jsx>{`
        .social-toast {
          animation: toastIn .4s cubic-bezier(.16,1,.3,1),
                     toastOut .35s cubic-bezier(.4,0,1,1) 3.15s forwards;
        }
        @keyframes toastIn {
          from { opacity: 0; transform: translateY(16px) scale(.94); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes toastOut {
          from { opacity: 1; transform: translateY(0) scale(1); }
          to   { opacity: 0; transform: translateY(-8px) scale(.96); }
        }
      `}</style>
    </div>
  );
}
