'use client';

import { useEffect, useState, useCallback, useRef, ChangeEvent, FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';

interface Lista {
  id: string;
  name: string;
  description: string | null;
}

interface ListaContato {
  id: string;
  phone: string;
  name: string | null;
  createdAt: string;
}

interface ImportResult {
  imported: number;
  skippedInvalid: number;
  skippedDuplicate: number;
}

function parsePastedNumbers(text: string): { phone: string; name?: string }[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/[,;\t]/).map((p) => p.trim());
      return { phone: parts[0], name: parts[1] || undefined };
    })
    .filter((c) => c.phone.length > 0);
}

export default function ListaDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [lista, setLista] = useState<Lista | null>(null);
  const [contatos, setContatos] = useState<ListaContato[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);

  const [pasteText, setPasteText] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ lista: Lista; contatos: ListaContato[]; total: number }>(
        `/modules/campanhas/listas/${id}`,
      );
      setLista(res.lista);
      setContatos(res.contatos || []);
      setTotal(res.total || 0);
    } catch (e: any) {
      if (e?.error === 'Lista não encontrada.') setNotFound(true);
      else if (e?.statusCode !== 401) setError(e?.message || 'Não foi possível carregar a lista.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function handleSaveName() {
    if (!lista || nameDraft.trim().length < 2) return;
    setSavingName(true);
    try {
      await api.put(`/modules/campanhas/listas/${id}`, { name: nameDraft.trim() });
      setLista({ ...lista, name: nameDraft.trim() });
      setEditingName(false);
    } catch (err: any) {
      setError(err?.message || 'Não foi possível renomear a lista.');
    } finally {
      setSavingName(false);
    }
  }

  async function handleDeleteLista() {
    if (!confirm('Excluir esta lista? Campanhas que já a usaram não são afetadas.')) return;
    try {
      await api.delete(`/modules/campanhas/listas/${id}`);
      router.push('/dashboard/campanhas/listas');
    } catch (err: any) {
      setError(err?.message || 'Não foi possível excluir a lista.');
    }
  }

  async function handlePasteImport(e: FormEvent) {
    e.preventDefault();
    const parsed = parsePastedNumbers(pasteText);
    if (parsed.length === 0) return;
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const res = await api.post<ImportResult>(`/modules/campanhas/listas/${id}/contatos/manual`, {
        contatos: parsed,
      });
      setImportResult(res);
      setPasteText('');
      await load();
    } catch (err: any) {
      setImportError(err?.message || 'Não foi possível adicionar os números.');
    } finally {
      setImporting(false);
    }
  }

  async function handleCsvUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.postFormData<ImportResult>(`/modules/campanhas/listas/${id}/contatos`, fd);
      setImportResult(res);
      await load();
    } catch (err: any) {
      setImportError(err?.message || 'Falha ao importar CSV.');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleRemoveContato(contatoId: string) {
    setContatos((prev) => prev.filter((c) => c.id !== contatoId));
    setTotal((t) => Math.max(0, t - 1));
    try {
      await api.delete(`/modules/campanhas/listas/${id}/contatos/${contatoId}`);
    } catch {
      await load();
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-brand-text-secondary">
        Carregando…
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="mb-4 text-brand-text">Lista não encontrada.</p>
          <Link href="/dashboard/campanhas/listas" className="text-emerald-600 hover:text-emerald-500">← Voltar</Link>
        </div>
      </div>
    );
  }

  if (!lista) {
    return (
      <div className="min-h-screen flex items-center justify-center text-red-500 px-5 text-center">
        {error || 'Erro ao carregar lista.'}
      </div>
    );
  }

  return (
    <div className="min-h-screen px-5 py-10">
      <div className="max-w-3xl mx-auto">
        <Link href="/dashboard/campanhas/listas" className="text-sm text-brand-muted hover:text-brand-text">← Listas</Link>

        <div className="mt-2 flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            {editingName ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') setEditingName(false); }}
                  className="input text-xl font-bold w-auto"
                />
                <button onClick={handleSaveName} disabled={savingName} className="btn-ghost text-xs disabled:opacity-50">
                  Salvar
                </button>
                <button onClick={() => setEditingName(false)} className="text-xs text-brand-muted hover:text-brand-text">
                  Cancelar
                </button>
              </div>
            ) : (
              <h1
                className="text-2xl font-bold text-brand-text cursor-pointer hover:underline decoration-dashed underline-offset-4"
                onClick={() => { setNameDraft(lista.name); setEditingName(true); }}
                title="Clique para renomear"
              >
                {lista.name} <span className="text-sm font-normal text-brand-muted">✎</span>
              </h1>
            )}
            {lista.description && <p className="text-brand-text-secondary mt-1 text-sm">{lista.description}</p>}
          </div>
          <button
            onClick={handleDeleteLista}
            className="rounded-lg border border-red-400/30 px-3 py-1.5 text-xs text-red-500 hover:bg-red-400/10 whitespace-nowrap"
          >
            Excluir lista
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-red-600 text-sm">
            {error}
          </div>
        )}

        <div className="mt-6 grid sm:grid-cols-2 gap-4">
          <form onSubmit={handlePasteImport} className="card rounded-xl p-4">
            <h2 className="text-sm font-semibold text-brand-text">Colar números</h2>
            <p className="mt-1 text-xs text-brand-muted">1 por linha — telefone, ou telefone e nome separados por vírgula.</p>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={5}
              placeholder={'11987654321, Maria\n11912345678'}
              className="input mt-3 font-mono text-xs"
            />
            <button
              type="submit"
              disabled={importing || parsePastedNumbers(pasteText).length === 0}
              className="btn-ghost text-xs mt-3 disabled:opacity-50"
            >
              {importing ? 'Adicionando…' : '+ Adicionar à lista'}
            </button>
          </form>

          <div className="card rounded-xl p-4">
            <h2 className="text-sm font-semibold text-brand-text">Importar CSV</h2>
            <p className="mt-1 text-xs text-brand-muted">Coluna 1 = telefone (obrigatório) · coluna 2 = nome (opcional).</p>
            <label className="btn-ghost text-xs mt-3 cursor-pointer inline-block">
              {importing ? 'Importando…' : '📄 Escolher arquivo'}
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleCsvUpload}
                disabled={importing}
                className="hidden"
              />
            </label>
          </div>
        </div>

        {importError && (
          <div className="mt-4 rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-red-600 text-sm">
            {importError}
          </div>
        )}
        {importResult && (
          <div className="mt-4 card rounded-lg p-3 text-sm text-brand-text-secondary">
            {importResult.imported} número{importResult.imported === 1 ? '' : 's'} adicionado{importResult.imported === 1 ? '' : 's'}.
            {importResult.skippedInvalid > 0 && ` ${importResult.skippedInvalid} inválido(s).`}
            {importResult.skippedDuplicate > 0 && ` ${importResult.skippedDuplicate} já estava(m) na lista.`}
          </div>
        )}

        <div className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-brand-muted mb-3">
            Números ({total})
          </h2>
          {contatos.length === 0 ? (
            <p className="text-sm text-brand-muted">Nenhum número ainda — adicione acima.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-brand-border">
              <table className="w-full text-sm">
                <thead className="bg-brand-elevated text-brand-text-secondary text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Telefone</th>
                    <th className="px-3 py-2 font-medium">Nome</th>
                    <th className="px-3 py-2 font-medium w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-border">
                  {contatos.map((c) => (
                    <tr key={c.id}>
                      <td className="px-3 py-2 text-brand-text-secondary">{c.phone}</td>
                      <td className="px-3 py-2 text-brand-muted">{c.name || '—'}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => handleRemoveContato(c.id)}
                          className="text-xs text-red-500 hover:underline"
                          title="Remover"
                        >
                          Remover
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {total > contatos.length && (
                <div className="px-3 py-2 text-xs text-brand-muted bg-brand-elevated">
                  Mostrando {contatos.length} de {total}.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
