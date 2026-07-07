'use client';
/**
 * Launcher da suíte ZapScript — home de login único.
 * Mostra os módulos CONTRATADOS (abrir) e os demais como upsell.
 * Ver MODULOS_ARQUITETURA.md §4.3.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import {
  ModuleCatalogItem, MODULE_ICON, moduleRoute,
  STATUS_LABEL, isContractable, formatBrl,
} from '@/lib/modules';

export default function AppLauncher() {
  const router = useRouter();
  const [catalog, setCatalog] = useState<ModuleCatalogItem[]>([]);
  const [owned, setOwned] = useState<Set<string>>(new Set());
  const [name, setName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // /auth/me protege a rota (401 → redireciona no api client) e traz os módulos.
        const [me, mods] = await Promise.all([
          api.get<{ name?: string; email?: string; modules?: string[] }>('/auth/me'),
          api.get<{ modules: ModuleCatalogItem[] }>('/modules'),
        ]);
        setName(me?.name || me?.email || '');
        setOwned(new Set(me?.modules || []));
        setCatalog(mods?.modules || []);
      } catch (e: any) {
        if (e?.statusCode !== 401) setError('Não foi possível carregar seus módulos.');
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-neutral-950 text-neutral-300">
        Carregando seus módulos…
      </main>
    );
  }

  const ownedItems = catalog.filter((m) => owned.has(m.key));
  const otherItems = catalog.filter((m) => !owned.has(m.key));

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 px-5 py-10">
      <div className="max-w-5xl mx-auto">
        <header className="mb-8">
          <h1 className="text-2xl font-bold">Seus módulos</h1>
          <p className="text-neutral-400 mt-1">
            {name ? `Olá, ${name}. ` : ''}Escolha um módulo para abrir ou contrate novos.
          </p>
        </header>

        {error && (
          <div className="mb-6 rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-red-200">
            {error}
          </div>
        )}

        {/* Contratados */}
        <section className="mb-10">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400 mb-3">
            Contratados
          </h2>
          {ownedItems.length === 0 ? (
            <p className="text-neutral-500">Você ainda não tem módulos ativos.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {ownedItems.map((m) => (
                <Link
                  key={m.key}
                  href={moduleRoute(m.key)}
                  className="group rounded-xl border border-neutral-800 bg-neutral-900 p-5 hover:border-emerald-600 hover:bg-neutral-900/70 transition-colors"
                >
                  <div className="text-3xl mb-3">{MODULE_ICON[m.key] || '🧩'}</div>
                  <div className="font-semibold">{m.name}</div>
                  <div className="mt-3 text-sm text-emerald-400 group-hover:text-emerald-300">
                    Abrir →
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Descobrir mais (upsell) */}
        {otherItems.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400 mb-3">
              Descobrir mais
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {otherItems.map((m) => {
                const contractable = isContractable(m.status);
                return (
                  <div
                    key={m.key}
                    className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5 flex flex-col"
                  >
                    <div className="flex items-start justify-between">
                      <div className="text-3xl mb-3 opacity-80">{MODULE_ICON[m.key] || '🧩'}</div>
                      <span className="text-[11px] rounded-full border border-neutral-700 px-2 py-0.5 text-neutral-400">
                        {STATUS_LABEL[m.status]}
                      </span>
                    </div>
                    <div className="font-semibold">{m.name}</div>
                    {m.priceMonthly > 0 && (
                      <div className="mt-1 text-sm text-neutral-400">
                        {formatBrl(m.priceMonthly)}/mês
                      </div>
                    )}
                    <div className="mt-4">
                      {contractable ? (
                        <Link
                          href={`/dashboard/plano?add=${encodeURIComponent(m.key)}`}
                          className="inline-block rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
                        >
                          Contratar
                        </Link>
                      ) : (
                        <span className="inline-block rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-500">
                          Em breve
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
