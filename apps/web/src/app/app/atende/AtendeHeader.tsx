'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/app/atende', label: 'Conversas' },
  { href: '/app/atende/config', label: 'Configuração' },
  { href: '/app/atende/kb', label: 'Base de conhecimento' },
];

export default function AtendeHeader() {
  const pathname = usePathname();
  return (
    <header className="mb-6">
      <Link href="/app" className="text-sm text-neutral-500 hover:text-neutral-300">
        ← Meus módulos
      </Link>
      <h1 className="text-2xl font-bold mt-2 mb-4">🤖 Atende</h1>
      <div className="flex items-center gap-1 border-b border-neutral-800">
        {TABS.map((t) => {
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
