'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface Visit {
  id: string;
  clientName: string | null;
  filename: string | null;
  status: 'processing' | 'done' | 'error';
  durationSec: number;
  summaryBullets: string[];
  errorMessage: string | null;
  createdAt: string;
  originalText?: string | null;
}

function StatusBadge({ status }: { status: Visit['status'] }) {
  const map = {
    processing: { label: 'Processando…', cls: 'border-amber-700 text-amber-400' },
    done:       { label: 'Concluída',     cls: 'border-emerald-700 text-emerald-400' },
    error:      { label: 'Erro',          cls: 'border-red-700 text-red-400' },
  } as const;
  const s = map[status];
  return <span className={`shrink-0 text-[11px] rounded-full border px-2 py-0.5 ${s.cls}`}>{s.label}</span>;
}

export default function VendasApp() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [visits, setVisits]   = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [upsell, setUpsell]   = useState<{ message: string; upsellUrl: string } | null>(null);

  const [clientName, setClientName] = useState('');
  const [file, setFile]             = useState<File | null>(null);
  const [uploading, setUploading]   = useState(false);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail]     = useState<Record<string, Visit>>({});

  async function load() {
    try {
      const data = await api.get<Visit[]>('/modules/vendas');
      setVisits(data);
      setError(null);
    } catch (e: any) {
      if (e?.moduleRequired) {
        setUpsell({ message: e.message, upsellUrl: e.upsellUrl || '/app' });
      } else if (/sess[ãa]o expirada/i.test(e?.message || '')) {
        router.push('/login');
        return;
      } else {
        setError('Não foi possível carregar suas visitas.');
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // Enquanto houver visita "processing", reconsulta a cada 5s.
  useEffect(() => {
    if (!visits.some((v) => v.status === 'processing')) return;
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [visits]);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('audio', file);
      if (clientName.trim()) fd.append('clientName', clientName.trim());
      const created = await api.postFormData<Visit>('/modules/vendas', fd);
      setVisits((prev) => [created, ...prev]);
      setClientName('');
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (e: any) {
      setError(e?.message || 'Falha ao enviar o áudio.');
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Excluir esta visita? Essa ação não pode ser desfeita.')) return;
    try {
      await api.delete(`/modules/vendas/${id}`);
      setVisits((prev) => prev.filter((v) => v.id !== id));
    } catch {
      setError('Não foi possível excluir.');
    }
  }

  async function toggleExpand(id: string) {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (!detail[id]) {
      try {
        const d = await api.get<Visit>(`/modules/vendas/${id}`);
        setDetail((prev) => ({ ...prev, [id]: d }));
      } catch { /* mantém sem detalhe expandido */ }
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-neutral-950 text-neutral-300">
        Carregando…
      </main>
    );
  }

  if (upsell) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-neutral-950 text-neutral-100 px-5">
        <div className="max-w-md text-center">
          <div className="text-4xl mb-4">🗣️</div>
          <h1 className="text-xl font-bold mb-2">Módulo Vendas</h1>
          <p className="text-neutral-400 mb-6">{upsell.message}</p>
          <Link href={upsell.upsellUrl} className="inline-block rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-500">
            Ver módulos disponíveis
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 px-5 py-10">
      <div className="max-w-3xl mx-auto">
        <header className="mb-8 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">🗣️ Vendas</h1>
            <p className="text-neutral-400 mt-1">Grave a visita ou ligação e receba o resumo comercial.</p>
          </div>
          <Link href="/app" className="text-sm text-neutral-400 hover:text-neutral-200 shrink-0">← Seus módulos</Link>
        </header>

        {error && (
          <div className="mb-6 rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-red-200">{error}</div>
        )}

        <form onSubmit={handleUpload} className="mb-10 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <input
              type="text"
              placeholder="Nome do cliente (opcional)"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,video/*"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="text-sm text-neutral-300"
            />
          </div>
          <button
            type="submit"
            disabled={!file || uploading}
            className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {uploading ? 'Enviando…' : 'Enviar visita'}
          </button>
        </form>

        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400 mb-3">Visitas</h2>
          {visits.length === 0 ? (
            <p className="text-neutral-500">Nenhuma visita enviada ainda.</p>
          ) : (
            <div className="space-y-3">
              {visits.map((v) => (
                <div key={v.id} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <button onClick={() => toggleExpand(v.id)} className="text-left flex-1 min-w-0">
                      <div className="font-medium truncate">{v.clientName || v.filename || 'Visita sem nome'}</div>
                      <div className="text-xs text-neutral-500 mt-0.5">
                        {new Date(v.createdAt).toLocaleString('pt-BR')}
                        {v.durationSec > 0 && ` · ${Math.round(v.durationSec / 60)}min`}
                      </div>
                    </button>
                    <StatusBadge status={v.status} />
                  </div>

                  {v.status === 'error' && v.errorMessage && (
                    <p className="mt-2 text-xs text-red-400">{v.errorMessage}</p>
                  )}

                  {expanded === v.id && v.status === 'done' && (
                    <div className="mt-3 border-t border-neutral-800 pt-3 space-y-3">
                      {(detail[v.id]?.summaryBullets ?? v.summaryBullets).length > 0 && (
                        <ul className="text-sm text-neutral-300 space-y-1 list-disc list-inside">
                          {(detail[v.id]?.summaryBullets ?? v.summaryBullets).map((b, i) => <li key={i}>{b}</li>)}
                        </ul>
                      )}
                      {detail[v.id]?.originalText && (
                        <details className="text-xs text-neutral-500">
                          <summary className="cursor-pointer text-neutral-400">Ver transcrição completa</summary>
                          <p className="mt-2 whitespace-pre-wrap">{detail[v.id]?.originalText}</p>
                        </details>
                      )}
                    </div>
                  )}

                  <div className="mt-3 flex justify-end">
                    <button onClick={() => handleDelete(v.id)} className="text-xs text-neutral-500 hover:text-red-400">
                      Excluir
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
