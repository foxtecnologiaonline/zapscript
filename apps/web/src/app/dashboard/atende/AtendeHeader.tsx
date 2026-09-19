'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/api';

const ALL_TABS = [
  { href: '/dashboard/atende',           label: 'Conversas',            minRole: 'agent' },
  { href: '/dashboard/atende/avisos',    label: 'Avisos',               minRole: 'agent' },
  { href: '/dashboard/atende/dashboard', label: 'Dashboard',            minRole: 'agent' },
  { href: '/dashboard/atende/config',    label: 'Configuração',         minRole: 'manager' },
  { href: '/dashboard/atende/welcome',   label: 'Boas-vindas',          minRole: 'manager' },
  { href: '/dashboard/atende/kb',        label: 'Base de conhecimento', minRole: 'manager' },
] as const;

const ROLE_RANK: Record<string, number> = { agent: 0, manager: 1, admin: 2, owner: 3 };

export default function AtendeHeader() {
  const pathname = usePathname();
  // Default permissivo (owner) até a role carregar — evita "piscar" as abas
  // pra maioria dos usuários, que não estão em nenhum time.
  const [role, setRole] = useState('owner');

  useEffect(() => {
    api.get<{ role: string }>('/teams/my-role').then(r => setRole(r.role)).catch(() => {});
  }, []);

  const tabs = ALL_TABS.filter(t => (ROLE_RANK[role] ?? 3) >= ROLE_RANK[t.minRole]);

  return (
    <header className="mb-6">
      <h1 className="text-2xl font-bold mb-4">🤖 Atende</h1>
      <div className="flex items-center gap-1 border-b border-brand-border">
        {tabs.map((t) => {
          const active = pathname === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                active
                  ? 'border-brand-primary text-brand-primary'
                  : 'border-transparent text-brand-text-secondary hover:text-brand-text'
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </header>
  );
}
