'use client';
import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';

interface Transcription {
  id: string;
  contactPhone: string;
  contactName: string | null;
  durationSec: number;
  originalText: string;
  summaryBullets: string[];
  createdAt: string;
  number: { displayName: string | null; phoneNumber: string };
}

export default function TranscricoesPage() {
  const [items, setItems]       = useState<Transcription[]>([]);
  const [total, setTotal]       = useState(0);
  const [search, setSearch]     = useState('');
  const [offset, setOffset]     = useState(0);
  const [loading, setLoading]   = useState(true);
  const [selected, setSelected] = useState<Transcription | null>(null);
  const [copied, setCopied]     = useState(false);
  const LIMIT = 20;

  const load = useCallback(async (s = search, o = offset) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(LIMIT), offset: String(o) });
      if (s) params.set('search', s);
      const res = await api.get<{ items: Transcription[]; total: number }>(`/transcriptions?${params}`);
      setItems(res.items);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, []);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setOffset(0);
    load(search, 0);
  }

  async function handleDelete(id: string) {
    if (!confirm('Deletar esta transcrição?')) return;
    await api.delete(`/transcriptions/${id}`);
    setItems(i => i.filter(t => t.id !== id));
    setTotal(t => t - 1);
    if (selected?.id === id) setSelected(null);
  }

  function copyText(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Transcrições</h1>
          <p className="text-sm text-[#7aaa85] font-light mt-0.5">{total} transcrição(ões) no total</p>
        </div>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-2 mb-5">
        <input className="input flex-1" placeholder="Buscar por contato ou conteúdo..."
          value={search} onChange={e => setSearch(e.target.value)} />
        <button type="submit" className="btn-primary px-5">Buscar</button>
        {search && (
          <button type="button" className="btn-ghost px-4" onClick={() => { setSearch(''); setOffset(0); load('', 0); }}>
            Limpar
          </button>
        )}
      </form>

      {/* List */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-[#3d6647] text-sm">Carregando...</div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center text-[#3d6647]">
            <div className="text-4xl mb-3">🎙</div>
            <div className="text-sm">{search ? 'Nenhuma transcrição encontrada.' : 'Nenhuma transcrição ainda. Conecte um número WhatsApp para começar.'}</div>
          </div>
        ) : (
          items.map(t => (
            <div key={t.id} className="flex items-start gap-3 px-5 py-4 border-b border-[rgba(34,197,94,.06)] hover:bg-[#101a0d] transition-colors group last:border-0">
              <div className="w-9 h-9 rounded-full bg-green-900 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                {(t.contactName || t.contactPhone)[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setSelected(t)}>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-semibold">{t.contactName || t.contactPhone}</span>
                  <span className="text-[10px] text-[#3d6647] bg-[#162012] px-2 py-0.5 rounded font-mono">{t.number.displayName || t.number.phoneNumber}</span>
                  <span className="text-xs text-[#3d6647] ml-auto">{new Date(t.createdAt).toLocaleString('pt-BR')}</span>
                </div>
                <p className="text-xs text-[#7aaa85] font-light line-clamp-2">{t.originalText}</p>
                <div className="flex gap-2 mt-1.5">
                  <span className="text-[10px] font-bold bg-[#162012] border border-[rgba(34,197,94,.12)] text-green-400 px-2 py-0.5 rounded">
                    🎙 {t.durationSec}s
                  </span>
                  <span className="text-[10px] font-bold bg-[#162012] border border-[rgba(34,197,94,.12)] text-green-400 px-2 py-0.5 rounded">
                    {(t.summaryBullets as string[]).length} bullet(s)
                  </span>
                </div>
              </div>
              <button onClick={() => handleDelete(t.id)}
                className="opacity-0 group-hover:opacity-100 text-[#3d6647] hover:text-red-400 text-sm transition-all flex-shrink-0 mt-1">
                🗑
              </button>
            </div>
          ))
        )}
      </div>

      {/* Pagination */}
      {total > LIMIT && (
        <div className="flex justify-center gap-2 mt-4">
          <button className="btn-ghost text-xs py-1.5 px-4" disabled={offset === 0}
            onClick={() => { const o = offset - LIMIT; setOffset(o); load(search, o); }}>
            ← Anterior
          </button>
          <span className="text-xs text-[#3d6647] self-center">
            {Math.floor(offset / LIMIT) + 1} / {Math.ceil(total / LIMIT)}
          </span>
          <button className="btn-ghost text-xs py-1.5 px-4" disabled={offset + LIMIT >= total}
            onClick={() => { const o = offset + LIMIT; setOffset(o); load(search, o); }}>
            Próxima →
          </button>
        </div>
      )}

      {/* Detail modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="bg-[#0b1209] border border-[rgba(34,197,94,.22)] rounded-2xl p-6 max-w-lg w-full shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div>
                <div className="font-bold text-base">{selected.contactName || selected.contactPhone}</div>
                <div className="text-xs text-[#3d6647]">{selected.number.displayName} · {new Date(selected.createdAt).toLocaleString('pt-BR')}</div>
              </div>
              <button onClick={() => setSelected(null)} className="text-[#3d6647] hover:text-white text-xl leading-none">✕</button>
            </div>
            <div className="bg-[#101a0d] border border-[rgba(34,197,94,.10)] rounded-xl p-4 mb-3">
              <div className="text-[10px] font-bold text-green-400 uppercase tracking-widest mb-2">✨ Resumo</div>
              {(selected.summaryBullets as string[]).map((b, i) => (
                <div key={i} className="text-sm text-[#e4f0e8] mb-1.5 flex gap-2"><span className="text-green-400 mt-0.5">•</span>{b}</div>
              ))}
            </div>
            <div className="bg-[#101a0d] border border-[rgba(34,197,94,.10)] rounded-xl p-4">
              <div className="text-[10px] font-bold text-[#7aaa85] uppercase tracking-widest mb-2">Original</div>
              <p className="text-sm text-[#7aaa85] font-light leading-relaxed italic">"{selected.originalText}"</p>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-4">
              <button onClick={() => copyText(selected.originalText)}
                className="btn-ghost text-xs py-2 justify-center col-span-1">
                {copied ? '✓ Copiado' : '📋 Copiar'}
              </button>
              <button onClick={() => copyText(`Resumo:\n${(selected.summaryBullets as string[]).map(b=>`• ${b}`).join('\n')}\n\nOriginal:\n${selected.originalText}`)}
                className="btn-ghost text-xs py-2 justify-center col-span-1">
                📄 Resumo
              </button>
              <button onClick={() => handleDelete(selected.id)}
                className="text-xs py-2 rounded-lg border border-red-400/20 text-red-400 hover:bg-red-400/5 transition-colors col-span-1">
                🗑 Deletar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
