'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/api';

const ALL_TABS = [
  { href: '/app/atende',           label: 'Conversas',            minRole: 'agent' },
  { href: '/app/atende/avisos',    label: 'Avisos',               minRole: 'agent' },
  { href: '/app/atende/dashboard', label: 'Dashboard',            minRole: 'agent' },
  { href: '/app/atende/config',    label: 'Configuração',         minRole: 'manager' },
  { href: '/app/atende/kb',        label: 'Base de conhecimento', minRole: 'manager' },
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
      <Link href="/app" className="text-sm text-neutral-500 hover:text-neutral-300">
        ← Meus módulos
      </Link>
      <h1 className="text-2xl font-bold mt-2 mb-4">🤖 Atende</h1>
      <div className="flex items-center gap-1 border-b border-neutral-800">
        {tabs.map((t) => {
          const active = pathname === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                active
                  ? 'border-emerald-500 text-emerald-400'
                  : 'border-transparent text-neutral-400 hover:text-neutral-200'
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
