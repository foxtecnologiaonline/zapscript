'use client';
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

type Theme = 'dark' | 'light';

interface ThemeCtx {
  theme: Theme;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeCtx>({ theme: 'dark', toggle: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark');

  // On mount: read stored preference or detect system preference
  useEffect(() => {
    const stored = localStorage.getItem('zs_theme') as Theme | null;
    if (stored === 'dark' || stored === 'light') {
      setTheme(stored);
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      setTheme(prefersDark ? 'dark' : 'light');
    }
  }, []);

  // Apply / remove .dark class on <html> whenever theme changes
  useEffect(() => {
    const html = document.documentElement;
    if (theme === 'dark') {
      html.classList.add('dark');
    } else {
      html.classList.remove('dark');
    }
  }, [theme]);

  // Follow system changes only when the user hasn't set a manual preference
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem('zs_theme')) {
        setTheme(e.matches ? 'dark' : 'light');
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  function toggle() {
    setTheme(prev => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem('zs_theme', next);
      return next;
    });
  }

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

/* ── Inline toggle button — use wherever you need it ── */
export function ThemeToggleButton({ className = '' }: { className?: string }) {
  const { theme, toggle } = useTheme();

  return (
    <button
      onClick={toggle}
      className={`w-10 h-10 rounded-xl border flex items-center justify-center transition-all hover:scale-105 ${className}`}
      style={{
        background: 'rgb(var(--color-surface))',
        borderColor: 'rgb(var(--color-border-light))',
        color: 'rgb(var(--color-text-secondary))',
      }}
      title={theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
      aria-label="Alternar tema claro / escuro"
    >
      {theme === 'dark' ? (
        /* Sun */
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="5"/>
          <line x1="12" y1="1"     x2="12" y2="3"/>
          <line x1="12" y1="21"    x2="12" y2="23"/>
          <line x1="4.22" y1="4.22"   x2="5.64"  y2="5.64"/>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
          <line x1="1"  y1="12"    x2="3"  y2="12"/>
          <line x1="21" y1="12"    x2="23" y2="12"/>
          <line x1="4.22"  y1="19.78" x2="5.64"  y2="18.36"/>
          <line x1="18.36" y1="5.64"  x2="19.78" y2="4.22"/>
        </svg>
      ) : (
        /* Moon */
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
        </svg>
      )}
    </button>
  );
}
