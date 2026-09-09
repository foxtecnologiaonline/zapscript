'use client';

import { useEffect, useState, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface ListaItem {
  id: string;
  name: string;
  description: string | null;
  contatosCount: number;
  updatedAt: string;
}

export default function ListasPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [listas, setListas] = useState<ListaItem[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<{ listas: ListaItem[] }>('/modules/campanhas/listas');
        setListas(res.listas || []);
      } catch (e: any) {
        if (e?.statusCode !== 401) setError(e?.message || 'Não foi possível carregar suas listas.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const res = await api.post<{ lista: { id: string } }>('/modules/campanhas/listas', {
        name,
        description: description.trim() || undefined,
      });
      router.push(`/dashboard/campanhas/listas/${res.lista.id}`);
    } catch (err: any) {
      setCreateError(err?.message || 'Não foi possível criar a lista.');
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-brand-text-secondary">
        Carregando listas…
      </div>
    );
  }

  return (
    <div className="min-h-screen px-5 py-10">
      <div className="max-w-3xl mx-auto">
        <Link href="/dashboard/campanhas" className="text-sm text-brand-muted hover:text-brand-text">← Campanhas</Link>

        <div className="mt-2 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-brand-text">📋 Listas de números</h1>
            <p className="text-brand-text-secondary mt-1 text-sm">
              Monte uma vez, reutilize em quantas campanhas quiser — sem exportar CSV toda hora.
            </p>
          </div>
          {!showForm && (
            <button onClick={() => setShowForm(true)} className="btn-primary px-4 py-2 text-sm whitespace-nowrap">
              + Nova lista
            </button>
          )}
        </div>

        {error && (
          <div className="mt-6 rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-red-600">
            {error}
          </div>
        )}

        {showForm && (
          <form onSubmit={handleCreate} className="mt-6 card rounded-xl p-4 space-y-3">
            <div>
              <label className="block text-sm font-medium text-brand-text-secondary mb-1">Nome da lista</label>
              <input
                required
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Clientes VIP"
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-brand-text-secondary mb-1">Descrição (opcional)</label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex: Compraram acima de R$500 em 2026"
                className="input"
              />
            </div>
            {createError && <p className="text-sm text-red-500">{createError}</p>}
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={creating || name.trim().length < 2}
                className="btn-primary px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creating ? 'Criando…' : 'Criar e adicionar números →'}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); setCreateError(null); }}
                className="text-xs text-brand-muted hover:text-brand-text"
              >
                Cancelar
              </button>
            </div>
          </form>
        )}

        <div className="mt-6">
          {listas.length === 0 ? (
            <div className="rounded-xl border border-brand-border bg-brand-elevated p-8 text-center text-brand-muted">
              Nenhuma lista ainda. Crie uma pra reutilizar os mesmos números em várias campanhas.
            </div>
          ) : (
            <div className="space-y-3">
              {listas.map((l) => (
                <Link
                  key={l.id}
                  href={`/dashboard/campanhas/listas/${l.id}`}
                  className="card rounded-xl block p-4 hover:border-brand-primary/30 transition-colors"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="font-medium text-brand-text">{l.name}</div>
                      {l.description && <div className="text-sm text-brand-muted mt-0.5">{l.description}</div>}
                    </div>
                    <span className="text-xs rounded-full border border-brand-border px-2.5 py-1 text-brand-text-secondary whitespace-nowrap">
                      {l.contatosCount} número{l.contatosCount === 1 ? '' : 's'}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
