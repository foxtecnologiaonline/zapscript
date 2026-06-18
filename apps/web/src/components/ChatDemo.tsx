'use client';
import { useState, useEffect } from 'react';

const WAVE_HEIGHTS = [4,8,12,15,10,6,13,16,11,7,5,10,15,11,6,9,14,12,7,5,9,13];

const EXAMPLES = [
  {
    label: 'Voz Feminina',
    title: 'Voz Feminina - Gestão de Equipe',
    subtitle: 'Áudio enviado hoje',
    avatarBg: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
    priority: { label: 'Alta Prioridade', color: '#ef4444', bg: 'rgba(239,68,68,.12)' },
    bullets: [
      'Definir procedimentos claros para a equipe seguir.',
      'Reuniões semanais de alinhamento para revisar processos.',
      'Reconhecer publicamente conquistas individuais.',
      'Criar um ambiente de feedback contínuo e positivo.',
    ],
    transcript: 'Oi, tudo bem? Então, eu queria conversar com você sobre os procedimentos do departamento. Eu acredito que a gente precisa padronizar algumas coisas, sabe? Primeiro, definir quem faz o quê, com checklists bem claros. Segunda coisa, toda semana a gente faz uma reuniãozinha de alinhamento, quinze minutos só, pra ver o que cada um fez e o que tá pendente. E o mais importante: reconhecer o trabalho da galera. Quando alguém faz um bom trabalho, eu gosto de mencionar no grupo, dar aquele feedback positivo. Isso motiva muito a equipe. E claro, sempre ficar aberto pra ouvir sugestões, porque quem tá na linha de frente muitas vezes tem as melhores ideias.',
  },
  {
    label: 'Voz Masculina',
    title: 'Voz Masculina - Organização Pessoal',
    subtitle: 'Áudio enviado hoje',
    avatarBg: 'linear-gradient(135deg,#0ea5e9,#0d9488)',
    priority: { label: 'Média Prioridade', color: '#f59e0b', bg: 'rgba(245,158,11,.12)' },
    bullets: [
      'Recebe muitos áudios no WhatsApp todos os dias.',
      'Dificuldade em organizar e acompanhar todas as tarefas.',
      'Precisa de uma forma de não perder informações importantes.',
      'Quer transformar áudios em tarefas organizadas.',
    ],
    transcript: 'E aí, brother, tudo bem? Cara, to meio perdido, sabe? É o seguinte, todo dia eu recebo uma avalanche de áudio no WhatsApp. Do trabalho, da família, dos amigos... É muita coisa, cara. Aí eu fico lá, ouço um áudio, anoto qualquer coisa, aí vem outro, aí eu esqueço o que o primeiro disse. Não consigo acompanhar, cara. Preciso muito de uma ferramenta que pegue esses áudio e transforme em texto, em tarefa, pra mim não perder nada, entende? Porque informação que entra por áudio às vezes se perde, né? Então se tiver como organizar isso, eu vou ganhar muito tempo.',
  },
];

export function ChatDemo() {
  const [tab, setTab] = useState(0);
  const [phase, setPhase] = useState<0|1|2>(0);
  const [bullets, setBullets] = useState(0);
  const [playing, setPlaying] = useState(false);
  const ex = EXAMPLES[tab];

  useEffect(() => {
    setPhase(0); setBullets(0); setPlaying(false);
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
    const ts = [
      setTimeout(() => setPhase(1),   1800),
      setTimeout(() => setPhase(2),   3600),
      setTimeout(() => setBullets(1), 4700),
      setTimeout(() => setBullets(2), 5500),
      setTimeout(() => setBullets(3), 6300),
      setTimeout(() => setBullets(4), 7100),
    ];
    return () => ts.forEach(clearTimeout);
  }, [tab]);

  function togglePlay() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (playing) { window.speechSynthesis.cancel(); setPlaying(false); return; }
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(ex.transcript);
    utt.lang = 'pt-BR'; utt.rate = 1.05;
    utt.onend = () => setPlaying(false);
    utt.onerror = () => setPlaying(false);
    window.speechSynthesis.speak(utt);
    setPlaying(true);
  }

  const initials = (s: string) => s.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(16,185,129,.15)', color: 'rgb(var(--color-primary))' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M12 2a3 3 0 013 3v7a3 3 0 11-6 0V5a3 3 0 013-3z"/>
            <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v3M8 22h8"/>
          </svg>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgb(var(--color-primary))' }}>Demo ao vivo</p>
          <h2 className="font-display font-bold text-2xl tracking-tight">Veja como funciona</h2>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        {EXAMPLES.map((e, i) => (
          <button key={i} onClick={() => setTab(i)}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all"
            style={{
              border: '1.5px solid',
              borderColor: tab === i ? 'rgb(var(--color-primary))' : 'rgb(var(--color-border))',
              background:  tab === i ? 'rgba(16,185,129,.1)' : 'transparent',
              color:       tab === i ? 'rgb(var(--color-primary))' : 'rgb(var(--color-text-secondary))',
              fontFamily:  'inherit', cursor: 'pointer',
            }}>{e.label}</button>
        ))}
      </div>

      {/* Chat window */}
      <div className="rounded-2xl overflow-hidden"
        style={{ border: '1.5px solid rgba(16,185,129,.22)', boxShadow: '0 8px 32px rgba(0,0,0,.35)' }}>

        {/* WA-style header */}
        <div className="flex items-center gap-3 px-4 py-3"
          style={{ background: '#0d2416', borderBottom: '1px solid rgba(16,185,129,.12)' }}>
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
            style={{ background: 'linear-gradient(135deg,#10b981,#059669)' }}>Z</div>
          <div className="flex-1">
            <p className="text-sm font-bold text-white">ZapScript Bot</p>
            <p className="text-xs flex items-center gap-1" style={{ color: '#10b981' }}>
              <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: '#10b981' }} />
              online
            </p>
          </div>
          <div className="text-xs px-2.5 py-1 rounded-full font-semibold"
            style={{ background: 'rgba(16,185,129,.12)', color: '#10b981' }}>
            automático
          </div>
        </div>

        {/* Messages area */}
        <div className="px-4 pt-4 pb-3 flex flex-col gap-4"
          style={{ background: '#0a1d12', minHeight: 300 }}>

          {/* ── Received audio bubble ── */}
          <div className="flex items-end gap-2">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0"
              style={{ background: ex.avatarBg }}>
              {initials(ex.label)}
            </div>
            <div className="rounded-2xl rounded-bl-sm overflow-hidden max-w-[82%]"
              style={{ background: '#1e2d26', border: '1px solid rgba(255,255,255,.06)' }}>
              {/* Audio player row */}
              <div className="flex items-center gap-2.5 px-3 pt-3 pb-1">
                <button onClick={togglePlay}
                  className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-all active:scale-90"
                  style={{ background: playing ? 'rgba(16,185,129,.3)' : 'rgba(16,185,129,.15)',
                           color: '#10b981', border: 'none', cursor: 'pointer' }}>
                  {playing
                    ? <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="1" width="4" height="10" rx="1"/><rect x="7" y="1" width="4" height="10" rx="1"/></svg>
                    : <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M2 1.5l9 4.5-9 4.5z"/></svg>
                  }
                </button>
                {/* Waveform bars */}
                <div className="flex items-center gap-[2px] flex-1">
                  {WAVE_HEIGHTS.map((h, i) => (
                    <div key={i} style={{
                      width: 2.5, height: h, borderRadius: 2,
                      background: playing ? '#10b981' : '#3d5248',
                      transformOrigin: 'center',
                      animation: playing
                        ? `waveBar ${0.45 + (i % 5) * 0.08}s ease ${(i * 0.028).toFixed(3)}s infinite alternate`
                        : 'none',
                    }} />
                  ))}
                </div>
                <span className="text-[11px] font-mono flex-shrink-0" style={{ color: '#6b7280' }}>1:23</span>
              </div>
              <p className="text-right text-[10px] pb-2 pr-3" style={{ color: '#4b5e56' }}>14:32</p>
            </div>
          </div>

          {/* ── Typing indicator ── */}
          {phase === 1 && (
            <div className="flex items-end gap-2" key="typing"
              style={{ animation: 'fadeInUp .3s ease both' }}>
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0"
                style={{ background: 'linear-gradient(135deg,#10b981,#059669)' }}>Z</div>
              <div className="rounded-2xl rounded-bl-sm px-4 py-3"
                style={{ background: '#083d22', border: '1px solid rgba(16,185,129,.15)' }}>
                <div className="flex items-center gap-1.5">
                  <div className="chat-typing-dot" style={{ animationDelay: '0s' }} />
                  <div className="chat-typing-dot" style={{ animationDelay: '.15s' }} />
                  <div className="chat-typing-dot" style={{ animationDelay: '.3s' }} />
                </div>
              </div>
            </div>
          )}

          {/* ── ZapScript result ── */}
          {phase === 2 && (
            <div className="flex items-end gap-2" key="result"
              style={{ animation: 'fadeInUp .4s ease both' }}>
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0"
                style={{ background: 'linear-gradient(135deg,#10b981,#059669)' }}>Z</div>
              <div className="rounded-2xl rounded-bl-sm px-4 py-3.5 max-w-[90%]"
                style={{ background: '#083d22', border: '1px solid rgba(16,185,129,.2)' }}>
                {/* Transcript */}
                <p className="text-[11px] font-semibold mb-1.5" style={{ color: '#6ee7b7' }}>📝 Transcrição:</p>
                <p className="text-sm leading-relaxed italic" style={{ color: '#a7f3d0', fontStyle: 'italic' }}>
                  &ldquo;{ex.transcript.slice(0, 108)}&hellip;&rdquo;
                </p>
                {/* Bullets */}
                {bullets > 0 && (
                  <div className="mt-3 pt-3 space-y-2"
                    style={{ borderTop: '1px solid rgba(16,185,129,.12)' }}>
                    <p className="text-[11px] font-semibold mb-2" style={{ color: '#6ee7b7' }}>🎯 Pontos-chave:</p>
                    {ex.bullets.slice(0, bullets).map((b, i) => (
                      <div key={i} className="flex items-start gap-2"
                        style={{ animation: 'fadeInUp .3s ease both' }}>
                        <span className="flex-shrink-0 text-sm leading-none mt-0.5" style={{ color: '#10b981' }}>✅</span>
                        <span className="text-xs leading-relaxed" style={{ color: '#d1fae5' }}>{b}</span>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-right text-[10px] mt-2" style={{ color: '#0d4a29' }}>
                  14:32 · ZapScript ✓✓
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 text-center"
          style={{ background: '#071510', borderTop: '1px solid rgba(255,255,255,.04)' }}>
          <p className="text-[11px]" style={{ color: 'rgba(16,185,129,.5)' }}>
            ▶ Toque no play para ouvir o áudio real · Simulação em loop automático
          </p>
        </div>
      </div>
    </div>
  );
}
