'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

/* ─────────────────────────────────────────────────────────────────
   WhatsAppSimulator — mockup animado de conversa do WhatsApp

   Simula em tempo real o fluxo do ZapScript:
   1. Áudio recebido (balão de entrada com waveform)
   2. Indicador de digitação ("ZapScript está digitando…")
   3. Transcrição aparece (typing effect, caractere por caractere)
   4. Bullets do resumo surgem um por um (stagger)
   5. Selo "Feito em segundos" aparece
   6. Loop: após pausa, reinicia

   Tema WhatsApp Light fixo (independente do tema da página).
   Usado no hero da home para o visitante ENTENDER o produto
   em 5 segundos, sem ler nada.
───────────────────────────────────────────────────────────────── */

// ── Dados do exemplo ──────────────────────────────────────────────
const CONTACT_NAME = 'Cliente — Imóvel Centro';
const AUDIO_DURATION = '0:47';

const TRANSCRIPTION_FULL = 'Oi! Consegui fechar com o proprietário. Ele aceitou R$ 2.800 com o primeiro aluguel adiantado e topa entregar as chaves na sexta. Pode confirmar com o cliente?';

const BULLETS = [
  'Proprietário aceitou R$ 2.800/mês',
  '1º aluguel adiantado',
  'Chaves na sexta — confirmar com cliente',
];

// ── Timing (ms) ──────────────────────────────────────────────────
const PHASE_AUDIO_DELAY = 800;       // balão do áudio aparece
const PHASE_TYPING_DELAY = 1200;     // indicador de digitação
const PHASE_TYPING_DURATION = 2800;  // quanto tempo o typing effect dura
const PHASE_BULLET_STAGGER = 500;    // intervalo entre bullets
const PHASE_DONE_PAUSE = 3500;       // pausa no final antes de reiniciar
const CYCLE_PAUSE = 2500;            // pausa entre ciclos

// ── Waveform bars ─────────────────────────────────────────────────
const WAVEFORM = [6, 11, 8, 15, 10, 18, 7, 13, 9, 16, 6, 12, 8, 14, 5, 10];

type Phase = 'audio' | 'typing' | 'transcribing' | 'bullets' | 'done' | 'reset';

export default function WhatsAppSimulator({ className = '' }: { className?: string }) {
  const [phase, setPhase] = useState<Phase>('audio');
  const [visibleText, setVisibleText] = useState('');
  const [visibleBullets, setVisibleBullets] = useState<number>(0);
  const [charIndex, setCharIndex] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── Sequência principal ─────────────────────────────────────────
  const runCycle = useCallback(() => {
    if (!mountedRef.current) return;

    // 1. Áudio recebido
    setPhase('audio');
    setVisibleText('');
    setVisibleBullets(0);
    setCharIndex(0);

    timerRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      // 2. Indicador de digitação
      setPhase('typing');

      timerRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        // 3. Transcrição começa (typing effect)
        setPhase('transcribing');
        setVisibleText('');
        setCharIndex(0);
      }, PHASE_TYPING_DELAY);
    }, PHASE_AUDIO_DELAY);
  }, []);

  // ── Typing effect (char por char) ────────────────────────────────
  useEffect(() => {
    if (phase !== 'transcribing') return;

    const interval = PHASE_TYPING_DURATION / TRANSCRIPTION_FULL.length;

    const tick = () => {
      setCharIndex(prev => {
        const next = prev + 1;
        if (next >= TRANSCRIPTION_FULL.length) {
          // Transcrição concluída → mostrar bullets
          if (mountedRef.current) {
            setPhase('bullets');
            setVisibleBullets(0);
          }
          return TRANSCRIPTION_FULL.length;
        }
        setVisibleText(TRANSCRIPTION_FULL.slice(0, next + 1));
        return next;
      });
    };

    const id = setInterval(tick, interval);
    return () => clearInterval(id);
  }, [phase]);

  // ── Bullets stagger ──────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'bullets') return;

    if (visibleBullets < BULLETS.length) {
      const id = setTimeout(() => {
        if (mountedRef.current) {
          setVisibleBullets(prev => prev + 1);
        }
      }, PHASE_BULLET_STAGGER);
      return () => clearTimeout(id);
    } else {
      // Todos os bullets visíveis → aguardar e reiniciar
      const id = setTimeout(() => {
        if (mountedRef.current) {
          setPhase('done');
        }
      }, PHASE_DONE_PAUSE);
      return () => clearTimeout(id);
    }
  }, [phase, visibleBullets]);

  // ── Reiniciar ciclo ──────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'done') return;

    const id = setTimeout(() => {
      if (mountedRef.current) {
        runCycle();
      }
    }, CYCLE_PAUSE);
    return () => clearTimeout(id);
  }, [phase, runCycle]);

  // ── Iniciar ──────────────────────────────────────────────────────
  useEffect(() => {
    const id = setTimeout(() => runCycle(), 400);
    return () => clearTimeout(id);
  }, [runCycle]);

  // ── Render ───────────────────────────────────────────────────────
  const showAudio = phase !== 'reset';
  const showTyping = phase === 'typing';
  const showResponse = phase === 'transcribing' || phase === 'bullets' || phase === 'done';
  const showBullets = phase === 'bullets' || phase === 'done';
  const isDone = phase === 'done';

  return (
    <div className={`mx-auto w-full max-w-[360px] ${className}`}>
      {/* ── Moldura do celular ─────────────────────────────────── */}
      <div
        className="rounded-[2.25rem] p-2.5 shadow-2xl"
        style={{ background: '#0b141a', boxShadow: '0 24px 60px -12px rgba(0,0,0,.55)' }}
      >
        <div className="rounded-[1.85rem] overflow-hidden" style={{ background: '#efeae2' }}>

          {/* ── Header do WhatsApp ──────────────────────────────── */}
          <div className="flex items-center gap-2.5 px-3.5 py-2.5" style={{ background: '#075e54' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0"
              style={{ background: '#cfd8dc' }}>👤</div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-white truncate leading-tight">{CONTACT_NAME}</div>
              <div className="text-[10px] leading-tight" style={{ color: 'rgba(255,255,255,.7)' }}>online</div>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M12 8a2 2 0 100-4 2 2 0 000 4zm0 2a2 2 0 100 4 2 2 0 000-4zm0 6a2 2 0 100 4 2 2 0 000-4z"/></svg>
          </div>

          {/* ── Corpo da conversa ───────────────────────────────── */}
          <div
            className="px-3 py-4 space-y-2 relative"
            style={{
              minHeight: 360,
              backgroundColor: '#efeae2',
              backgroundImage: 'radial-gradient(rgba(0,0,0,.035) 1px, transparent 1px)',
              backgroundSize: '18px 18px',
            }}
          >
            {/* Etiqueta de data */}
            <div className="flex justify-center">
              <span className="text-[10px] px-2.5 py-1 rounded-md"
                style={{ background: '#ffffff', color: '#54656f', boxShadow: '0 1px 0 rgba(0,0,0,.05)' }}>
                HOJE
              </span>
            </div>

            {/* ── Balão: áudio recebido ──────────────────────────── */}
            <div className={`flex transition-all duration-500 ${showAudio ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`}>
              <div className="relative max-w-[80%] rounded-lg rounded-tl-none px-2.5 py-2 shadow-sm"
                style={{ background: '#ffffff' }}>
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: '#00a884' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg>
                  </div>
                  {/* waveform animado */}
                  <div className="flex items-end gap-[2px] h-5 flex-1">
                    {WAVEFORM.map((h, i) => (
                      <span key={i} className="w-[2px] rounded-full transition-colors duration-300"
                        style={{
                          height: h,
                          background: i < 4 ? '#00a884' : '#c4ccd0',
                          animation: `waveBar 0.6s ease-in-out ${i * 0.07}s infinite alternate`,
                        }} />
                    ))}
                  </div>
                  <span className="text-[10px] flex-shrink-0" style={{ color: '#667781' }}>{AUDIO_DURATION}</span>
                </div>
                <div className="flex items-center justify-end gap-1 mt-0.5">
                  <span className="text-[9px]" style={{ color: '#667781' }}>🎤 Mensagem de voz</span>
                </div>
              </div>
            </div>

            {/* ── Indicador de digitação ─────────────────────────── */}
            {showTyping && (
              <div className="flex justify-end animate-[fadeInUp_.3s_ease_both]">
                <div className="relative max-w-[70%] rounded-lg rounded-tr-none px-3 py-2 shadow-sm"
                  style={{ background: '#d9fdd3' }}>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] font-medium" style={{ color: '#5b9c6e' }}>ZapScript está digitando</span>
                    <span className="inline-flex gap-[3px]">
                      <span className="w-[4px] h-[4px] rounded-full inline-block" style={{ background: '#8696a0', animation: 'typingBounce 1.4s ease-in-out 0s infinite both' }} />
                      <span className="w-[4px] h-[4px] rounded-full inline-block" style={{ background: '#8696a0', animation: 'typingBounce 1.4s ease-in-out .2s infinite both' }} />
                      <span className="w-[4px] h-[4px] rounded-full inline-block" style={{ background: '#8696a0', animation: 'typingBounce 1.4s ease-in-out .4s infinite both' }} />
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* ── Balão: resposta do ZapScript ────────────────────── */}
            {showResponse && (
              <div className="flex justify-end animate-[fadeInUp_.35s_ease_both]">
                <div className="relative max-w-[88%] rounded-lg rounded-tr-none px-3 py-2 shadow-sm"
                  style={{ background: '#d9fdd3' }}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="text-[11px] font-bold" style={{ color: '#1f7a3f' }}>📝 Transcrição</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold"
                      style={{ background: '#1f7a3f', color: '#fff' }}>ZapScript</span>
                  </div>
                  <p className="text-[12px] leading-snug" style={{ color: '#111b21' }}>
                    &ldquo;{visibleText}
                    {phase === 'transcribing' && (
                      <span className="inline-block w-[2px] h-3 ml-px align-middle animate-pulse"
                        style={{ background: '#1f7a3f' }} />
                    )}
                    &rdquo;
                  </p>

                  {/* ── Resumo com bullets ────────────────────────── */}
                  {showBullets && (
                    <div className="mt-2 pt-2" style={{ borderTop: '1px solid rgba(31,122,63,.18)' }}>
                      <div className="text-[10px] font-bold mb-1 animate-[fadeInUp_.3s_ease_both]"
                        style={{ color: '#1f7a3f' }}>✨ Resumo</div>
                      <ul className="space-y-0.5">
                        {BULLETS.map((t, i) => (
                          <li key={t}
                            className={`text-[11px] leading-snug flex gap-1 transition-all duration-400 ${
                              i < visibleBullets
                                ? 'opacity-100 translate-y-0'
                                : 'opacity-0 translate-y-2'
                            }`}
                            style={{
                              color: '#1b3b27',
                              transitionDelay: `${i * 0.1}s`,
                            }}>
                            <span style={{ color: '#1f7a3f' }}>•</span>{t}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {isDone && (
                    <div className="flex items-center justify-end gap-1 mt-1">
                      <span className="text-[9px] animate-[fadeInUp_.3s_ease_both]" style={{ color: '#5b9c6e' }}>agora</span>
                      <svg width="14" height="14" viewBox="0 0 18 18" fill="none">
                        <path d="M1 9l3.5 3.5L11 6M7 12l6-6" stroke="#53bdeb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Selo automático ─────────────────────────────────── */}
            {isDone && (
              <div className="flex justify-center pt-1 animate-[fadeInUp_.4s_ease_both]">
                <span className="text-[9px] px-2 py-1 rounded-md"
                  style={{ background: 'rgba(0,168,132,.12)', color: '#1f7a3f' }}>
                  ⚡ Feito automaticamente em segundos — você nem abriu o áudio
                </span>
              </div>
            )}
          </div>

          {/* ── Barra de input (decorativa) ─────────────────────── */}
          <div className="flex items-center gap-2 px-3 py-2" style={{ background: '#f0f2f5' }}>
            <div className="flex-1 rounded-full px-3 py-1.5 text-[11px]"
              style={{ background: '#fff', color: '#8696a0' }}>Mensagem</div>
            <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: '#00a884' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff"><path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 006 6.92V21h2v-3.08A7 7 0 0019 11h-2z"/></svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
