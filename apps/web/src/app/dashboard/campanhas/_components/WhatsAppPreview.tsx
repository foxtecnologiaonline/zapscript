'use client';

/**
 * Prévia visual da mensagem como bolha do WhatsApp — mesma cor, tipografia,
 * largura máxima e quebra de linha do app real, pra o usuário ver como o
 * texto vai chegar antes de disparar. {{nome}} é substituído por um exemplo
 * (mesma variável documentada no formulário de mensagem).
 */
export default function WhatsAppPreview({ text }: { text: string }) {
  const rendered = text.replace(/\{\{\s*nome\s*\}\}/gi, 'Maria');
  const now = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="rounded-xl overflow-hidden border border-black/10 shadow-sm w-full max-w-[280px] mx-auto lg:mx-0">
      <div className="flex items-center gap-2 px-3 py-2" style={{ background: '#075e54' }}>
        <div className="h-7 w-7 shrink-0 rounded-full bg-white/25 flex items-center justify-center text-white text-xs">👤</div>
        <div className="text-white text-sm font-medium truncate">Seu cliente</div>
      </div>
      <div
        className="p-3 flex flex-col justify-end min-h-[140px]"
        style={{ background: '#e5ddd5', backgroundImage: 'radial-gradient(rgba(0,0,0,0.03) 1px, transparent 1px)', backgroundSize: '14px 14px' }}
      >
        <div
          className="relative ml-auto max-w-[85%] rounded-lg px-2.5 pt-1.5 pb-4 break-words"
          style={{
            background: '#d9fdd3',
            color: '#111b21',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
            fontSize: '14.2px',
            lineHeight: '19px',
            whiteSpace: 'pre-wrap',
          }}
        >
          {rendered.trim().length > 0 ? rendered : <span className="opacity-40 italic">Sua mensagem aparece aqui…</span>}
          <span
            className="absolute bottom-1 right-2 flex items-center gap-0.5 text-[11px]"
            style={{ color: 'rgba(0,0,0,0.45)' }}
          >
            {now}
            <svg width="14" height="10" viewBox="0 0 16 11" fill="none" aria-hidden>
              <path d="M1 5.5 4.5 9 11 1.5" stroke="#8696a0" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M5.5 5.5 9 9 15.5 1.5" stroke="#8696a0" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
      </div>
    </div>
  );
}
