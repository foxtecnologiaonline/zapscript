'use client';

import { useEffect, useMemo, useState, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface ListaItem {
  id: string;
  name: string;
  description: string | null;
  consentConfirmedAt: string | null;
  contatosCount: number;
  updatedAt: string;
}

async function downloadCsv(listaId: string, fallbackName: string) {
  const res = await api.get<{ csv: string; filename: string }>(`/modules/campanhas/listas/${listaId}/export`);
  const blob = new Blob([res.csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = res.filename || `${fallbackName}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function ListasPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [listas, setListas] = useState<ListaItem[]>([]);
  const [search, setSearch] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [mergeName, setMergeName] = useState('');
  const [merging, setMerging] = useState(false);

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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? listas.filter((l) => l.name.toLowerCase().includes(q)) : listas;
  }, [listas, search]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const res = await api.post<{ lista: { id: string } }>('/modules/campanhas/listas', {
        name,
        description: description.trim() || undefined,
        consentConfirmed: consentConfirmed || undefined,
      });
      router.push(`/dashboard/campanhas/listas/${res.lista.id}`);
    } catch (err: any) {
      setCreateError(err?.message || 'Não foi possível criar a lista.');
      setCreating(false);
    }
  }

  async function handleDuplicate(listaId: string) {
    setDuplicatingId(listaId);
    setError(null);
    try {
      const res = await api.post<{ lista: ListaItem }>(`/modules/campanhas/listas/${listaId}/duplicate`, {});
      setListas((prev) => [res.lista, ...prev]);
    } catch (err: any) {
      setError(err?.message || 'Não foi possível duplicar a lista.');
    } finally {
      setDuplicatingId(null);
    }
  }

  async function handleExport(listaId: string, listaName: string) {
    setError(null);
    try {
      await downloadCsv(listaId, listaName);
    } catch (err: any) {
      setError(err?.message || 'Não foi possível exportar a lista.');
    }
  }

  function toggleSelected(listaId: string) {
    setSelected((prev) => (prev.includes(listaId) ? prev.filter((x) => x !== listaId) : [...prev, listaId]));
  }

  async function handleMerge(e: FormEvent) {
    e.preventDefault();
    if (selected.length < 2 || !mergeName.trim()) return;
    setMerging(true);
    setError(null);
    try {
      const res = await api.post<{ lista: ListaItem }>('/modules/campanhas/listas/merge', {
        listaIds: selected, name: mergeName.trim(),
      });
      setListas((prev) => [res.lista, ...prev]);
      setSelected([]);
      setMergeName('');
    } catch (err: any) {
      setError(err?.message || 'Não foi possível mesclar as listas.');
    } finally {
      setMerging(false);
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
    <div className="min-h-screen px-5 py-10 overflow-x-hidden">
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
            <label className="flex items-start gap-2 text-sm text-brand-text">
              <input
                type="checkbox"
                checked={consentConfirmed}
                onChange={(e) => setConsentConfirmed(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Confirmo que tenho consentimento (opt-in) destes contatos para campanhas de marketing —
                evita reconfirmar depois em toda campanha que reusar esta lista.
              </span>
            </label>
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
            <div className="rounded-xl border border-brand-border bg-brand-elevated p-8 text-center">
              <p className="text-brand-muted">Nenhuma lista ainda.</p>
              <p className="mt-2 text-sm text-brand-text-secondary">
                Exemplos: clientes VIP, quem comprou no último lançamento, leads de um evento.
              </p>
              {!showForm && (
                <button onClick={() => setShowForm(true)} className="btn-primary inline-block px-4 py-2 text-sm mt-4">
                  + Criar minha primeira lista
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por nome…"
                  className="input w-auto flex-1 min-w-[180px] max-w-xs"
                />
                {selected.length > 0 && (
                  <span className="text-xs text-brand-muted">{selected.length} selecionada{selected.length === 1 ? '' : 's'}</span>
                )}
              </div>

              {selected.length >= 2 && (
                <form onSubmit={handleMerge} className="mb-4 card rounded-xl p-4 flex flex-wrap items-center gap-2">
                  <span className="text-sm text-brand-text-secondary">Mesclar {selected.length} listas em uma nova:</span>
                  <input
                    required
                    value={mergeName}
                    onChange={(e) => setMergeName(e.target.value)}
                    placeholder="Nome da nova lista"
                    className="input w-auto flex-1 min-w-[160px]"
                  />
                  <button
                    type="submit"
                    disabled={merging || !mergeName.trim()}
                    className="btn-primary px-3 py-1.5 text-xs disabled:opacity-50"
                  >
                    {merging ? 'Mesclando…' : 'Mesclar'}
                  </button>
                  <button type="button" onClick={() => setSelected([])} className="text-xs text-brand-muted hover:text-brand-text">
                    Limpar seleção
                  </button>
                </form>
              )}

              {filtered.length === 0 ? (
                <div className="rounded-xl border border-brand-border bg-brand-elevated p-8 text-center text-brand-muted">
                  Nenhuma lista encontrada com esse nome.
                </div>
              ) : (
                <div className="space-y-3">
                  {filtered.map((l) => (
                    <div key={l.id} className="card rounded-xl p-4">
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={selected.includes(l.id)}
                          onChange={() => toggleSelected(l.id)}
                          className="mt-1.5"
                          title="Selecionar pra mesclar"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-4">
                            <Link href={`/dashboard/campanhas/listas/${l.id}`} className="font-medium text-brand-text hover:underline truncate min-w-0">
                              {l.name}
                            </Link>
                            <span className="text-xs rounded-full border border-brand-border px-2.5 py-1 text-brand-text-secondary whitespace-nowrap shrink-0">
                              {l.contatosCount} número{l.contatosCount === 1 ? '' : 's'}
                            </span>
                          </div>
                          {l.description && <div className="text-sm text-brand-muted mt-0.5 truncate">{l.description}</div>}
                          {l.consentConfirmedAt && (
                            <div className="text-xs text-emerald-600 mt-1">✓ Consentimento confirmado</div>
                          )}
                          <div className="mt-2 flex items-center gap-3 text-xs">
                            <Link href={`/dashboard/campanhas/listas/${l.id}`} className="text-emerald-600 hover:text-emerald-500">
                              Abrir →
                            </Link>
                            <button
                              onClick={() => handleDuplicate(l.id)}
                              disabled={duplicatingId === l.id}
                              className="text-brand-muted hover:text-brand-text disabled:opacity-50"
                            >
                              {duplicatingId === l.id ? 'Duplicando…' : 'Duplicar'}
                            </button>
                            <button
                              onClick={() => handleExport(l.id, l.name)}
                              className="text-brand-muted hover:text-brand-text"
                            >
                              Exportar CSV
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
