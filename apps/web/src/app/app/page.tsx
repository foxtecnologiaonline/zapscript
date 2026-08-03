'use client';
/**
 * Launcher da suíte ZapScript — home de login único.
 * Mostra os módulos CONTRATADOS (abrir) e os demais como upsell.
 * Ver MODULOS_ARQUITETURA.md §4.3.
 */
import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import ModuleCheckout from '@/components/ModuleCheckout';
import {
  ModuleCatalogItem, MODULE_ICON, moduleRoute,
  STATUS_LABEL, isContractable, formatBrl,
} from '@/lib/modules';

interface Me {
  id: string; name?: string; email: string;
  emailVerified: boolean; document: string | null;
  modules?: string[];
}

function AppLauncherInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [catalog, setCatalog] = useState<ModuleCatalogItem[]>([]);
  const [owned, setOwned] = useState<Set<string>>(new Set());
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkoutKey, setCheckoutKey] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // /auth/me protege a rota (401 → redireciona no api client) e traz os módulos.
        const [meRes, mods] = await Promise.all([
          api.get<Me>('/auth/me'),
          api.get<{ modules: ModuleCatalogItem[] }>('/modules'),
        ]);
        setMe(meRes);
        setOwned(new Set(meRes?.modules || []));
        setCatalog(mods?.modules || []);

        // ?upsell=<key> (ex: vindo do gate 402 de um módulo não contratado) abre o checkout direto.
        const upsell = searchParams.get('upsell');
        if (upsell && !(meRes?.modules || []).includes(upsell)) {
          const spec = (mods?.modules || []).find((m) => m.key === upsell);
          if (spec && isContractable(spec.status)) setCheckoutKey(upsell);
        }
      } catch (e: any) {
        if (e?.statusCode !== 401) setError('Não foi possível carregar seus módulos.');
      } finally {
        setLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function refreshMe() {
    try {
      const meRes = await api.get<Me>('/auth/me');
      setMe(meRes);
      setOwned(new Set(meRes?.modules || []));
    } catch { /* ignora — módulo aparece ativo na próxima carga */ }
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-neutral-950 text-neutral-300">
        Carregando seus módulos…
      </main>
    );
  }

  const ownedItems = catalog.filter((m) => owned.has(m.key));
  const otherItems = catalog.filter((m) => !owned.has(m.key));
  const checkoutSpec = checkoutKey ? catalog.find((m) => m.key === checkoutKey) : null;

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 px-5 py-10">
      <div className="max-w-5xl mx-auto">
        <header className="mb-8">
          <h1 className="text-2xl font-bold">Seus módulos</h1>
          <p className="text-neutral-400 mt-1">
            {me?.name ? `Olá, ${me.name}. ` : ''}Escolha um módulo para abrir ou contrate novos.
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
                        <button
                          onClick={() => setCheckoutKey(m.key)}
                          className="inline-block rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
                        >
                          Contratar
                        </button>
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

      {checkoutSpec && me && (
        <ModuleCheckout
          moduleKey={checkoutSpec.key}
          moduleLabel={checkoutSpec.name}
          moduleIcon={MODULE_ICON[checkoutSpec.key] || '🧩'}
          priceLabel={`${formatBrl(checkoutSpec.priceMonthly)}/mês`}
          user={{ email: me.email, emailVerified: me.emailVerified }}
          onSuccess={() => { setCheckoutKey(null); refreshMe(); }}
          onClose={() => setCheckoutKey(null)}
        />
      )}
    </main>
  );
}

export default function AppLauncher() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center bg-neutral-950 text-neutral-300">
        Carregando…
      </main>
    }>
      <AppLauncherInner />
    </Suspense>
  );
}
