'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { clearToken } from '@/lib/apiClient';

const NAV = [
  { href: '/dashboard/connections', label: 'Números' },
  { href: '/dashboard/inbox', label: 'Inbox' },
  { href: '/dashboard/widget-settings', label: 'Widget' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 bg-white border-r flex flex-col">
        <div className="p-4 font-bold text-lg border-b">ZapBox</div>
        <nav className="flex-1 p-2 flex flex-col gap-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`px-3 py-2 rounded-lg text-sm font-medium ${
                pathname === item.href ? 'bg-green-50 text-green-700' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <button
          onClick={() => {
            clearToken();
            router.push('/login');
          }}
          className="m-2 px-3 py-2 rounded-lg text-sm text-left text-gray-500 hover:bg-gray-50"
        >
          Sair
        </button>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
