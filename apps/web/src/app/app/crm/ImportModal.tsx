'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { ImportSuggestion, formatPhone, relativeTime } from './lib';

interface Props {
  onClose: () => void;
  onImported: () => void;
}

export default function ImportModal({ onClose, onImported }: Props) {
  const [suggestions, setSuggestions] = useState<ImportSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: string[]; skipped: string[] } | null>(null);

  useEffect(() => {
    api.get<{ suggestions: ImportSuggestion[] }>('/crm/import/suggestions')
      .then(data => {
        setSuggestions(data.suggestions);
        setSelected(new Set(data.suggestions.map(s => s.phone)));
      })
      .catch(e => setError(e?.message || 'Não foi possível buscar sugestões.'))
      .finally(() => setLoading(false));
  }, []);

  const allSelected = suggestions.length > 0 && selected.size === suggestions.length;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(suggestions.map(s => s.phone)));
  }

  function toggleOne(phone: string) {
    setSelected(current => {
      const next = new Set(current);
      if (next.has(phone)) next.delete(phone); else next.add(phone);
      return next;
    });
  }

  async function handleImport() {
    if (selected.size === 0) return;
    setImporting(true);
    setError(null);
    try {
      const res = await api.post<{ imported: string[]; skipped: string[] }>('/crm/import', {
        phones: [...selected],
      });
      setResult(res);
    } catch (e: any) {
      setError(e?.message || 'Não foi possível importar os contatos.');
    } finally {
      setImporting(false);
    }
  }

  const title = useMemo(() => result ? 'Importação concluída' : 'Importar do WhatsApp', [result]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center px-4"
      style={{ background: 'rgba(4,11,9,0.72)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl border border-neutral-800 bg-neutral-950 p-5 max-h-[85vh] flex flex-col"
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-bold">{title}</h2>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-300">✕</button>
        </div>
        <p className="text-xs text-neutral-500 mb-4">
          Sugestões a partir do histórico de conversas transcritas — sem alterar nada no seu WhatsApp.
        </p>

        {error && (
          <div className="mb-3 rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {loading && <div className="text-sm text-neutral-500 py-6 text-center">Buscando conversas...</div>}

        {!loading && result && (
          <div className="py-4 text-center space-y-3">
            <div className="text-3xl">✅</div>
            <div className="text-sm text-neutral-300">
              {result.imported.length} contato{result.imported.length === 1 ? '' : 's'} importado{result.imported.length === 1 ? '' : 's'}
              {result.skipped.length > 0 && `, ${result.skipped.length} ignorado${result.skipped.length === 1 ? '' : 's'}`}.
            </div>
            <button
              onClick={onImported}
              className="mt-2 w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              Concluir
            </button>
          </div>
        )}

        {!loading && !result && suggestions.length === 0 && !error && (
          <div className="py-8 text-center text-sm text-neutral-500">
            Nenhum contato novo encontrado no histórico de conversas.
          </div>
        )}

        {!loading && !result && suggestions.length > 0 && (
          <>
            <label className="flex items-center gap-2 px-1 py-2 border-b border-neutral-800 text-sm text-neutral-400 cursor-pointer">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-emerald-600" />
              Selecionar todos ({suggestions.length})
            </label>
            <div className="flex-1 overflow-y-auto space-y-1 py-2">
              {suggestions.map(s => (
                <label
                  key={s.phone}
                  className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-neutral-900 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(s.phone)}
                    onChange={() => toggleOne(s.phone)}
                    className="accent-emerald-600 flex-shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">{s.name || formatPhone(s.phone)}</div>
                    <div className="text-xs text-neutral-500">{formatPhone(s.phone)} · {s.count} conversa{s.count === 1 ? '' : 's'}</div>
                  </div>
                  <div className="text-[11px] text-neutral-600 flex-shrink-0">{relativeTime(s.lastAt)}</div>
                </label>
              ))}
            </div>
            <button
              onClick={handleImport}
              disabled={importing || selected.size === 0}
              className="mt-3 w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {importing ? 'Importando...' : `Importar selecionados (${selected.size})`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
