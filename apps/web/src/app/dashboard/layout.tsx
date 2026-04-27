'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '@/lib/api';

const NAV = [
  { href: '/dashboard',                  icon: '🏠', label: 'Dashboard' },
  { href: '/dashboard/transcricoes',     icon: '📝', label: 'Transcrições' },
  { href: '/dashboard/numeros',          icon: '📱', label: 'Números' },
  { href: '/dashboard/plano',            icon: '💳', label: 'Plano' },
  { href: '/dashboard/configuracoes',    icon: '⚙️', label: 'Configurações' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router   = useRouter();
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    api.get<any>('/auth/me')
      .then(setUser)
      .catch(() => router.push('/login'));
  }, []);

  function logout() { api.clearToken(); router.push('/login'); }

  const planColors: Record<string, string> = {
    free:  'text-[rgba(16,185,129,.4)]',
    pro:   'text-[#10b981]',
    ultra: 'text-yellow-400',
  };

  return (
    <div className="flex min-h-screen dashboard-bg">
      <aside className="w-56 flex-shrink-0 dashboard-sidebar border-r dashboard-border flex flex-col sticky top-0 h-screen">
        <div className="flex items-center gap-2 px-5 py-5 border-b dashboard-border">
          <span className="w-2 h-2 rounded-full dashboard-primary animate-pulse"/>
          <span className="font-bold dashboard-primary text-base">ZapScript</span>
        </div>

        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {NAV.map(item => {
            const active = pathname === item.href;
            return (
              <Link key={item.href} href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  active
                    ? 'bg-brand-primary/10 dashboard-primary border dashboard-border'
                    : 'dashboard-text hover:bg-brand-primary/7 hover:text-brand-text'
                }`}>
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t dashboard-border">
          {user && (
            <div className="flex items-center gap-2 px-3 py-2 mb-1">
              <div className="w-7 h-7 rounded-full dashboard-avatar flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                {user.name?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold truncate">{user.name || user.email}</div>
                <div className={`text-[10px] capitalize font-semibold ${planColors[user.subscription?.plan?.name || 'free']}`}>
                  {user.subscription?.plan?.label || 'Grátis'}
                </div>
              </div>
            </div>
          )}
          <button onClick={logout} className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs text-brand-muted hover:text-red-400 hover:bg-red-400/5 transition-colors">
            ↩ Sair da conta
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
