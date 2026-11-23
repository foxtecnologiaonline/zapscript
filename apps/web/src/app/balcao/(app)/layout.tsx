'use client';
import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useBvSession } from '@/lib/balcao/session';
import { NAV } from '@/lib/balcao/nav';
import { A11yToolbar } from '@/lib/balcao/a11y';
import { ROLE_LABEL, PRESENCE_LABEL } from '@/lib/balcao/format';
import { useBvSocket } from '@/lib/balcao/socket';
import { bv } from '@/lib/balcao/api';
import { Spinner, cx, useToast } from '../_ui/ui';

const PRESENCE: Array<'ONLINE' | 'AWAY' | 'OFFLINE'> = ['ONLINE', 'AWAY', 'OFFLINE'];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { status, me, token, can, canAny, logout } = useBvSession();
  const router = useRouter();
  const path = usePathname();
  const toast = useToast();
  const mainRef = useRef<HTMLElement>(null);
  const [presence, setPresence] = useState<string>('OFFLINE');
  const [unread, setUnread] = useState(0);
  const [announce, setAnnounce] = useState('');

  useEffect(() => { if (status === 'anon') router.replace(`/balcao/login?next=${encodeURIComponent(path)}`); }, [status, router, path]);
  useEffect(() => {
    if (me && (me.mustChangePassword || me.mfaSetupRequired) && !path.startsWith('/balcao/conta')) router.replace('/balcao/conta');
  }, [me, path, router]);
  useEffect(() => { if (me?.user.presence) setPresence(me.user.presence); }, [me]);
  // acessibilidade: ao navegar, anuncia a página e leva o foco ao conteúdo
  useEffect(() => {
    const t = setTimeout(() => {
      const h1 = mainRef.current?.querySelector<HTMLElement>('[data-bv-page-title]');
      (h1 ?? mainRef.current)?.focus({ preventScroll: false });
      setAnnounce(h1?.textContent ? `Página: ${h1.textContent}` : '');
    }, 50);
    return () => clearTimeout(t);
  }, [path]);

  useBvSocket(token, {
    notification: (n: any) => { setUnread((u) => u + 1); if (n?.title) toast.info(n.title); },
    'sla:breach': () => toast.error('Atenção: um prazo de SLA foi violado.'),
  });

  if (status !== 'authed' || !me) return <div className="flex min-h-screen items-center justify-center"><Spinner size={32} /></div>;

  const items = NAV.filter((n) => (n.perm ? can(n.perm) : n.anyOf ? canAny(n.anyOf) : true));
  const groups = Array.from(new Set(items.map((i) => i.group)));
  const isAgent = can('conversation:reply');

  const setPres = async (p: string) => {
    setPresence(p);
    try { await bv.put('/agents/me/presence', { presence: p }); } catch { toast.error('Não foi possível alterar sua disponibilidade.'); }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <a className="bv-skip" href="#bv-main">Ir para o conteúdo principal</a>
      <header className="flex flex-wrap items-center gap-3 border-b border-bv-border bg-bv-surface px-4 py-2">
        <Link href="/balcao" className="text-lg font-semibold text-bv-primary">Balcão Virtual</Link>
        <span className="text-sm text-bv-muted">{me.user.orgName}</span>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {isAgent && (
            <label className="flex items-center gap-2 text-sm">
              <span>Disponibilidade</span>
              <select value={presence} onChange={(e) => void setPres(e.target.value)} className="min-h-[36px] rounded-md border border-bv-border bg-bv-surface px-2">
                {PRESENCE.map((p) => <option key={p} value={p}>{PRESENCE_LABEL[p]}</option>)}
              </select>
            </label>
          )}
          <A11yToolbar />
          <Link href="/balcao/tarefas?aba=notificacoes" className="relative rounded-md border border-bv-border px-2 py-1.5 text-sm" onClick={() => setUnread(0)}>
            Avisos{unread > 0 && <span className="ml-1 rounded-full bg-bv-danger px-1.5 text-xs text-white" aria-label={`${unread} não lidos`}>{unread}</span>}
          </Link>
          <details className="relative">
            <summary className="cursor-pointer rounded-md border border-bv-border px-3 py-1.5 text-sm">{me.user.name} · {ROLE_LABEL[me.user.role]}</summary>
            <div className="absolute right-0 z-20 mt-1 w-48 rounded-md border border-bv-border bg-bv-surface p-1 shadow-lg">
              <Link className="block rounded px-3 py-2 text-sm hover:bg-bv-subtle" href="/balcao/conta">Minha conta</Link>
              <button type="button" className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-bv-subtle" onClick={async () => { await logout(); router.replace('/balcao/login'); }}>Sair</button>
            </div>
          </details>
        </div>
      </header>
      <div className="flex flex-1 flex-col md:flex-row">
        <nav aria-label="Menu principal" className="border-b border-bv-border bg-bv-surface p-3 md:w-60 md:border-b-0 md:border-r">
          {groups.map((g) => (
            <div key={g} className="mb-3">
              <p className="px-2 text-xs font-semibold uppercase tracking-wide text-bv-muted">{g}</p>
              <ul className="mt-1">
                {items.filter((i) => i.group === g).map((i) => {
                  const active = path === i.href || path.startsWith(i.href + '/');
                  return <li key={i.href}><Link href={i.href} aria-current={active ? 'page' : undefined} className={cx('block rounded-md px-2 py-2 text-sm', active ? 'bg-bv-primary-soft font-semibold text-bv-primary' : 'hover:bg-bv-subtle')}>{i.label}</Link></li>;
                })}
              </ul>
            </div>
          ))}
        </nav>
        <main id="bv-main" ref={mainRef} tabIndex={-1} className="min-w-0 flex-1 p-4 outline-none md:p-6">{children}</main>
      </div>
      <div aria-live="polite" className="bv-sr-only">{announce}</div>
    </div>
  );
}
