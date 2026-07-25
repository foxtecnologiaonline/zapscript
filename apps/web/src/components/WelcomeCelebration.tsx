'use client';

import { useEffect, useState } from 'react';

/* ─────────────────────────────────────────────────────────────────
   WelcomeCelebration — celebração pós-cadastro.

   Mostra UMA VEZ quando o usuário cai no dashboard pela primeira
   vez (guard em localStorage zs_welcome_shown). Efeito de "confete"
   via múltiplas partículas CSS animadas + mensagem central.
───────────────────────────────────────────────────────────────── */

const LS_KEY = 'zs_welcome_shown';

const PARTICLE_COLORS = [
  '#10b981', '#34d399', '#059669', '#f59e0b', '#fbbf24',
  '#6366f1', '#a78bfa', '#ec4899', '#f472b6', '#06b6d4',
];

const PARTICLES = Array.from({ length: 40 }, (_, i) => ({
  id: i,
  color: PARTICLE_COLORS[i % PARTICLE_COLORS.length],
  left: `${Math.random() * 100}%`,
  delay: `${Math.random() * 0.5}s`,
  duration: `${1.5 + Math.random() * 1.5}s`,
  size: 5 + Math.random() * 7,
  rotation: Math.random() * 360,
}));

export default function WelcomeCelebration() {
  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState<'enter' | 'show' | 'exit'>('enter');

  useEffect(() => {
    try {
      if (localStorage.getItem(LS_KEY)) return;
      localStorage.setItem(LS_KEY, '1');
    } catch { /* se falhar, mostra mesmo assim */ }
    setVisible(true);

    // Sequência: entra → visível por 3s → sai
    const t1 = setTimeout(() => setPhase('show'), 100);
    const t2 = setTimeout(() => setPhase('exit'), 3200);
    const t3 = setTimeout(() => setVisible(false), 3800);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] pointer-events-none flex items-center justify-center"
      style={{
        opacity: phase === 'enter' ? 0 : phase === 'show' ? 1 : 0,
        transition: 'opacity 0.4s ease',
      }}
    >
      {/* Partículas */}
      {PARTICLES.map(p => (
        <div
          key={p.id}
          className="absolute"
          style={{
            left: p.left,
            top: '-2%',
            width: p.size,
            height: p.size * 1.5,
            background: p.color,
            borderRadius: '2px',
            opacity: 0,
            transform: `rotate(${p.rotation}deg)`,
            animation: `confettiFall ${p.duration} ease-out ${p.delay} forwards`,
          }}
        />
      ))}

      {/* Mensagem central */}
      <div style={{
        opacity: phase === 'show' ? 1 : 0,
        transform: `scale(${phase === 'show' ? 1 : 0.8}) translateY(${phase === 'show' ? 0 : '12px'})`,
        transition: 'opacity 0.3s ease, transform 0.35s cubic-bezier(.16,1,.3,1)',
      }}>
        <div
          className="text-center px-6 py-5 rounded-2xl"
          style={{
            background: 'rgba(15,23,42,.92)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(16,185,129,.2)',
            boxShadow: '0 8px 40px rgba(0,0,0,.4), 0 0 0 1px rgba(16,185,129,.08)',
          }}
        >
          <div className="text-3xl mb-2">🎉</div>
          <h2 className="text-lg font-bold text-white mb-0.5">
            Boas-vindas ao ZapScript!
          </h2>
          <p className="text-sm text-white/70">
            Áudios do WhatsApp virando texto e resumo em segundos.
          </p>
        </div>
      </div>

      <style jsx>{`
        @keyframes confettiFall {
          0% {
            opacity: 1;
            transform: translateY(0) rotate(${'0deg'});
          }
          100% {
            opacity: 0;
            transform: translateY(100vh) rotate(${360}deg);
          }
        }
      `}</style>
    </div>
  );
}
