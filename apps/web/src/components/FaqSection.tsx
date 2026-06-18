'use client';
import { useState } from 'react';
import { FAQ_ITEMS } from '@/data/faq';

export function FaqSection() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="space-y-2">
      {FAQ_ITEMS.map((item, i) => (
        <div key={i} className="card rounded-2xl overflow-hidden">
          <button
            onClick={() => setOpen(open === i ? null : i)}
            className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            <span className="text-sm font-semibold" style={{ color: 'rgb(var(--color-text))' }}>
              {item.q}
            </span>
            <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-full transition-transform"
              style={{
                background: 'rgb(var(--color-surface-elevated))',
                color: 'rgb(var(--color-primary))',
                transform: open === i ? 'rotate(45deg)' : 'none',
                transition: 'transform .2s ease',
              }}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M5 1v8M1 5h8"/>
              </svg>
            </span>
          </button>
          {open === i && (
            <div className="px-5 pb-4" style={{ animation: 'fadeInUp .2s ease both' }}>
              <p className="text-sm leading-relaxed font-light" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                {item.a}
              </p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
