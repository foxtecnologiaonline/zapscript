'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '@/lib/api';

const NAV = [
  { href: '/dashboard',               icon: '🏠', label: 'Dashboard' },
  { href: '/dashboard/transcricoes',  icon: '📝', label: 'Transcrições' },
  { href: '/dashboard/numeros',       icon: '📱', label: 'Números' },
  { href: '/dashboard/plano',         icon: '💳', label: 'Plano' },
  { href: '/dashboard/invoices',      icon: '🧾', label: 'Faturas' },
  { href: '/dashboard/configuracoes', icon: '⚙️', label: 'Configurações' },
];

const PLAN_COLORS: Record<string, string> = {
  free:      'text-[rgba(16,185,129,.4)]',
  pro:       'text-[#10b981]',
  ultra:     'text-yellow-400',
  executive: 'text-amber-400',
};

/* ── Sidebar content — shared between desktop & mobile drawer ── */
function NavContent({
  user, pathname, onLogout, onClose,
}: {
  user: any;
  pathname: string;
  onLogout: () => void;
  onClose?: () => void;
}) {
  return (
    <>
      {/* Logo header */}
      <div className="flex items-center gap-2 px-5 py-5 border-b dashboard-border">
        <span className="w-2 h-2 rounded-full dashboard-primary animate-pulse" />
        <span className="font-bold dashboard-primary text-base flex-1">ZapScript</span>
        {/* Close button — only shown inside mobile drawer */}
        {onClose && (
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-brand-muted hover:text-brand-text transition-colors md:hidden"
            aria-label="Fechar menu"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Nav links */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {NAV.map(item => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                active
                  ? 'bg-brand-primary/10 dashboard-primary border dashboard-border'
                  : 'dashboard-text hover:bg-brand-primary/7 hover:text-brand-text'
              }`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* User + logout */}
      <div className="p-3 border-t dashboard-border">
        {user && (
          <div className="flex items-center gap-2 px-3 py-2 mb-1">
            <div className="w-7 h-7 rounded-full dashboard-avatar flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
              {user.name?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold truncate">{user.name || user.email}</div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={`text-[10px] capitalize font-semibold ${PLAN_COLORS[user.subscription?.plan?.name || 'free']}`}>
                  {user.subscription?.plan?.label || 'Grátis'}
                </span>
                {user.isTester && (
                  <span
                    className="inline-flex items-center text-[9px] font-black uppercase tracking-widest bg-[#10b981]/10 border border-[#10b981]/25 rounded-full px-2 py-0.5 text-[#10b981]"
                    title="Tester Oficial ZapScript"
                  >
                    Tester
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
        <button
          onClick={onLogout}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs text-brand-muted hover:text-red-400 hover:bg-red-400/5 transition-colors"
        >
          ↩ Sair da conta
        </button>
      </div>
    </>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname   = usePathname();
  const router     = useRouter();
  const [user, setUser]         = useState<any>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    api.get<any>('/auth/me')
      .then(setUser)
      .catch(() => router.push('/login'));
  }, []);

  // ── Keepalive: ping /health a cada 4 min para evitar cold start do Render ──
  // O Render free tier dorme após 15 min de inatividade → primeiro request leva 30-60s.
  // Usuários autenticados no dashboard mantêm o servidor acordado.
  useEffect(() => {
    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    const ping = () => fetch(`${API_URL}/health`, { method: 'GET', cache: 'no-store' }).catch(() => null);
    ping(); // ping imediato ao entrar no dashboard
    const id = setInterval(ping, 4 * 60 * 1000); // a cada 4 min
    return () => clearInterval(id);
  }, []);

  // Close drawer automatically on navigation
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  function logout() { api.clearToken(); router.push('/login'); }

  return (
    <div className="flex min-h-screen dashboard-bg">

      {/* ── Desktop sidebar (hidden on mobile) ─── */}
      <aside className="hidden md:flex w-56 flex-shrink-0 dashboard-sidebar border-r dashboard-border flex-col sticky top-0 h-screen">
        <NavContent user={user} pathname={pathname} onLogout={logout} />
      </aside>

      {/* ── Mobile: backdrop + slide-in drawer ─── */}
      {menuOpen && (
        <div className="md:hidden">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
            onClick={() => setMenuOpen(false)}
          />
          {/* Drawer */}
          <aside
            className="fixed inset-y-0 left-0 z-50 w-64 flex flex-col dashboard-sidebar border-r dashboard-border"
            style={{ animation: 'slideInLeft .22s cubic-bezier(.4,0,.2,1) both' }}
          >
            <NavContent
              user={user}
              pathname={pathname}
              onLogout={logout}
              onClose={() => setMenuOpen(false)}
            />
          </aside>
        </div>
      )}

      {/* ── Content column ──────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Mobile top bar */}
        <header className="md:hidden sticky top-0 z-30 flex items-center gap-3 px-4 py-3 border-b dashboard-border dashboard-sidebar">
          <button
            onClick={() => setMenuOpen(true)}
            className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-brand-primary/10 transition-colors text-brand-text"
            aria-label="Abrir menu"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          </button>

          <span className="font-bold dashboard-primary text-base flex-1">ZapScript</span>

          {user && (
            <div className="w-8 h-8 rounded-full dashboard-avatar flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
              {user.name?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase()}
            </div>
          )}
        </header>

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
