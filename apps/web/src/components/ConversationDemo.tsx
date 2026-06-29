'use client';

/* ─────────────────────────────────────────────────────────────────
   ConversationDemo — mockup realista de tela do WhatsApp
   Mostra o fluxo real do ZapScript: um áudio recebido é respondido,
   na MESMA conversa, com a transcrição + resumo automático.

   Visual fixo (estilo "print" do WhatsApp light) para parecer uma
   captura real, independente do tema da página onde é embutido.
   Usado para substituir a antiga seção "Como funciona" nas LPs.
───────────────────────────────────────────────────────────────── */

export default function ConversationDemo({
  contactName = 'Cliente — Imóvel Centro',
  audioDuration = '0:47',
  className = '',
}: {
  contactName?: string;
  audioDuration?: string;
  className?: string;
}) {
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
              <div className="text-[13px] font-semibold text-white truncate leading-tight">{contactName}</div>
              <div className="text-[10px] leading-tight" style={{ color: 'rgba(255,255,255,.7)' }}>online</div>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M12 8a2 2 0 100-4 2 2 0 000 4zm0 2a2 2 0 100 4 2 2 0 000-4zm0 6a2 2 0 100 4 2 2 0 000-4z"/></svg>
          </div>

          {/* ── Corpo da conversa ───────────────────────────────── */}
          <div
            className="px-3 py-4 space-y-2"
            style={{
              minHeight: 360,
              backgroundColor: '#efeae2',
              backgroundImage:
                'radial-gradient(rgba(0,0,0,.035) 1px, transparent 1px)',
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

            {/* ── Balão: áudio recebido (entrada, esquerda) ──────── */}
            <div className="flex">
              <div className="relative max-w-[80%] rounded-lg rounded-tl-none px-2.5 py-2 shadow-sm"
                style={{ background: '#ffffff' }}>
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: '#00a884' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg>
                  </div>
                  {/* waveform */}
                  <div className="flex items-end gap-[2px] h-5 flex-1">
                    {[6, 11, 8, 15, 10, 18, 7, 13, 9, 16, 6, 12, 8, 14, 5, 10].map((h, i) => (
                      <span key={i} className="w-[2px] rounded-full"
                        style={{ height: h, background: i < 4 ? '#00a884' : '#c4ccd0' }} />
                    ))}
                  </div>
                  <span className="text-[10px] flex-shrink-0" style={{ color: '#667781' }}>{audioDuration}</span>
                </div>
                <div className="flex items-center justify-end gap-1 mt-0.5">
                  <span className="text-[9px]" style={{ color: '#667781' }}>🎤 Mensagem de voz</span>
                </div>
              </div>
            </div>

            {/* ── Balão: resposta do ZapScript (saída, direita) ──── */}
            <div className="flex justify-end">
              <div className="relative max-w-[88%] rounded-lg rounded-tr-none px-3 py-2 shadow-sm"
                style={{ background: '#d9fdd3' }}>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className="text-[11px] font-bold" style={{ color: '#1f7a3f' }}>📝 Transcrição</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold"
                    style={{ background: '#1f7a3f', color: '#fff' }}>ZapScript</span>
                </div>
                <p className="text-[12px] leading-snug" style={{ color: '#111b21' }}>
                  &ldquo;Oi! Consegui fechar com o proprietário. Ele aceitou R$ 2.800 com o primeiro
                  aluguel adiantado e topa entregar as chaves na sexta. Pode confirmar com o cliente?&rdquo;
                </p>

                <div className="mt-2 pt-2" style={{ borderTop: '1px solid rgba(31,122,63,.18)' }}>
                  <div className="text-[10px] font-bold mb-1" style={{ color: '#1f7a3f' }}>✨ Resumo</div>
                  <ul className="space-y-0.5">
                    {[
                      'Proprietário aceitou R$ 2.800/mês',
                      '1º aluguel adiantado',
                      'Chaves na sexta — confirmar com o cliente',
                    ].map((t) => (
                      <li key={t} className="text-[11px] leading-snug flex gap-1" style={{ color: '#1b3b27' }}>
                        <span style={{ color: '#1f7a3f' }}>•</span>{t}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="flex items-center justify-end gap-1 mt-1">
                  <span className="text-[9px]" style={{ color: '#5b9c6e' }}>agora</span>
                  <svg width="14" height="14" viewBox="0 0 18 18" fill="none">
                    <path d="M1 9l3.5 3.5L11 6M7 12l6-6" stroke="#53bdeb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
              </div>
            </div>

            {/* Selo "automático" */}
            <div className="flex justify-center pt-1">
              <span className="text-[9px] px-2 py-1 rounded-md"
                style={{ background: 'rgba(0,168,132,.12)', color: '#1f7a3f' }}>
                ⚡ Feito automaticamente em segundos — você nem abriu o áudio
              </span>
            </div>
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
