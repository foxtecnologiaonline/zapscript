'use client';

export function SupportChatButton() {
  return (
    <button
      type="button"
      onClick={() => {
        const btn = document.querySelector<HTMLButtonElement>('[aria-label="Suporte"]');
        btn?.click();
      }}
      className="flex items-center gap-4 rounded-2xl p-5 border transition-all hover:scale-[1.02] text-left w-full"
      style={{
        background: 'rgb(var(--color-surface-elevated))',
        borderColor: 'rgb(var(--color-border))',
      }}
    >
      <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: 'rgba(16,185,129,.1)', color: 'rgb(var(--color-primary))' }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
        </svg>
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wider mb-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>Chat ao vivo</p>
        <p className="text-sm font-semibold" style={{ color: 'rgb(var(--color-text))' }}>Abrir suporte</p>
        <p className="text-[10px] mt-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>Clique no ícone 💬 abaixo</p>
      </div>
    </button>
  );
}
