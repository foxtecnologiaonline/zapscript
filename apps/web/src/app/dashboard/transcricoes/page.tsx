'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '@/lib/api';

interface Transcription {
  id: string;
  contactPhone: string;
  contactName: string | null;
  durationSec: number;
  originalText: string;
  summaryBullets: string[];
  language: string;
  tags: string[];
  createdAt: string;
  number: { displayName: string | null; phoneNumber: string } | null;
}

const ALLOWED_EXT = ['.ogg', '.opus', '.mp3', '.mp4', '.m4a', '.wav', '.webm', '.mpeg'];
const MAX_MB      = 50;
const LIMIT       = 20;

const PLAN_SEARCH  = ['pro', 'ultra', 'executive'];
const PLAN_EXPORT  = ['pro', 'ultra', 'executive'];
const PLAN_TAGS    = ['ultra', 'executive'];
const PLAN_LANG    = ['ultra', 'executive'];

const LANG_FLAG: Record<string, string> = {
  pt: '🇧🇷 PT', 'pt-BR': '🇧🇷 PT', en: '🇺🇸 EN', es: '🇪🇸 ES',
  fr: '🇫🇷 FR', de: '🇩🇪 DE', it: '🇮🇹 IT', ja: '🇯🇵 JA',
  zh: '🇨🇳 ZH', ko: '🇰🇷 KO', ru: '🇷🇺 RU', ar: '🇸🇦 AR',
};

const TAG_COLORS = [
  'bg-brand-primary/10 text-brand-primary border-brand-primary/20',
  'bg-amber-400/10 text-amber-400 border-amber-400/20',
  'bg-emerald-400/10 text-emerald-400 border-emerald-400/20',
  'bg-rose-400/10 text-rose-400 border-rose-400/20',
  'bg-violet-400/10 text-violet-400 border-violet-400/20',
];

// ── Upload Modal ─────────────────────────────────────────────────────────────
function UploadModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const inputRef                  = useRef<HTMLInputElement>(null);
  const [file, setFile]           = useState<File | null>(null);
  const [dragging, setDragging]   = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError]         = useState('');
  const [success, setSuccess]     = useState(false);

  function validateFile(f: File): string {
    const ext = f.name.substring(f.name.lastIndexOf('.')).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) return `Formato inválido. Use: ${ALLOWED_EXT.join(', ')}`;
    if (f.size > MAX_MB * 1024 * 1024) return `Arquivo muito grande. Máximo ${MAX_MB}MB.`;
    return '';
  }

  function pickFile(f: File) {
    const err = validateFile(f);
    if (err) { setError(err); setFile(null); return; }
    setError(''); setFile(f);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) pickFile(f);
  }

  async function handleUpload() {
    if (!file) return;
    setUploading(true); setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.postFormData('/transcriptions/upload', fd);
      setSuccess(true);
      setTimeout(() => { onDone(); onClose(); }, 2000);
    } catch (err: any) {
      setError(err.message || 'Erro ao enviar. Tente novamente.');
    } finally {
      setUploading(false);
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="modal-panel max-w-md w-full" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="font-bold text-base text-brand-text">Enviar áudio para transcrição</h2>
            <p className="text-xs text-brand-muted mt-0.5">Formatos aceitos: OGG, OPUS, MP3, MP4, M4A, WAV, WEBM</p>
          </div>
          <button onClick={onClose} className="text-brand-muted hover:text-brand-text text-xl leading-none transition-colors">✕</button>
        </div>
        {success ? (
          <div className="text-center py-8">
            <div className="text-4xl mb-3">✅</div>
            <p className="text-brand-primary font-semibold">Áudio enviado com sucesso!</p>
            <p className="text-xs text-brand-muted mt-1">A transcrição chegará em instantes...</p>
          </div>
        ) : (
          <>
            <div
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors mb-4 ${dragging ? 'border-brand-primary bg-brand-primary/5' : file ? 'border-brand-primary/40 bg-brand-primary/5' : 'border-brand-border hover:border-brand-primary/40'}`}
              onClick={() => inputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <input ref={inputRef} type="file" accept={ALLOWED_EXT.join(',')} className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) pickFile(f); }} />
              {file ? (
                <>
                  <div className="text-3xl mb-2">🎙️</div>
                  <p className="text-sm font-semibold text-brand-text">{file.name}</p>
                  <p className="text-xs text-brand-muted mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                  <button onClick={e => { e.stopPropagation(); setFile(null); setError(''); }}
                    className="text-xs text-brand-muted hover:text-red-400 mt-2 transition-colors">Remover</button>
                </>
              ) : (
                <>
                  <div className="text-3xl mb-2">📁</div>
                  <p className="text-sm text-brand-text-secondary">Arraste um arquivo aqui ou <span className="text-brand-primary font-semibold">clique para selecionar</span></p>
                  <p className="text-xs text-brand-muted mt-1">Máximo {MAX_MB}MB</p>
                </>
              )}
            </div>
            {error && <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2 mb-4">{error}</div>}
            <div className="flex gap-2">
              <button onClick={onClose} className="btn-ghost flex-1 py-2.5 text-sm">Cancelar</button>
              <button onClick={handleUpload} disabled={!file || uploading} className="btn-primary flex-1 py-2.5 text-sm disabled:opacity-50">
                {uploading ? <span className="flex items-center justify-center gap-2"><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Enviando...</span> : 'Transcrever áudio'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── TagInput — pill input para adicionar/remover tags ────────────────────────
function TagInput({ tags, onChange, disabled }: { tags: string[]; onChange: (t: string[]) => void; disabled?: boolean }) {
  const [input, setInput] = useState('');

  function addTag(val: string) {
    const tag = val.trim();
    if (!tag || tags.includes(tag) || tags.length >= 5) return;
    onChange([...tags, tag]);
    setInput('');
  }

  return (
    <div className="flex flex-wrap gap-1.5 items-center min-h-[32px]">
      {tags.map((t, i) => (
        <span key={t} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border flex items-center gap-1 ${TAG_COLORS[i % TAG_COLORS.length]}`}>
          {t}
          {!disabled && (
            <button onClick={() => onChange(tags.filter(x => x !== t))} className="opacity-60 hover:opacity-100 leading-none ml-0.5">×</button>
          )}
        </span>
      ))}
      {!disabled && tags.length < 5 && (
        <input
          className="text-xs bg-transparent border-none outline-none text-brand-text placeholder:text-brand-muted w-24"
          placeholder="+ tag"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(input); }
            if (e.key === 'Backspace' && !input && tags.length) onChange(tags.slice(0, -1));
          }}
          onBlur={() => { if (input) addTag(input); }}
        />
      )}
    </div>
  );
}

// ── Página principal ─────────────────────────────────────────────────────────
export default function TranscricoesPage() {
  const [items, setItems]         = useState<Transcription[]>([]);
  const [total, setTotal]         = useState(0);
  const [search, setSearch]       = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [filterLang, setFilterLang] = useState('');
  const [offset, setOffset]       = useState(0);
  const [loading, setLoading]     = useState(true);
  const [selected, setSelected]   = useState<Transcription | null>(null);
  const [copied, setCopied]       = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [planName, setPlanName]   = useState('free');
  const [exporting, setExporting] = useState(false);
  const [editTags, setEditTags]   = useState<string[]>([]);
  const [savingTags, setSavingTags] = useState(false);

  useEffect(() => {
    api.get<any>('/auth/me').then(u => setPlanName(u.subscription?.plan?.name || 'free')).catch(() => null);
  }, []);

  const load = useCallback(async (s = search, o = offset, tag = filterTag, lang = filterLang) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(LIMIT), offset: String(o) });
      if (s)    params.set('search', s);
      if (tag)  params.set('tag', tag);
      if (lang) params.set('language', lang);
      const res = await api.get<{ items: Transcription[]; total: number }>(`/transcriptions?${params}`);
      setItems(res.items);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, []);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault(); setOffset(0); load(search, 0, filterTag, filterLang);
  }

  function clearFilters() {
    setSearch(''); setFilterTag(''); setFilterLang(''); setOffset(0); load('', 0, '', '');
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

  async function handleExport() {
    setExporting(true);
    try {
      const month = new Date().toISOString().slice(0, 7);
      // Fetch com token — api.get retorna JSON, precisamos de blob para download
      const token = typeof window !== 'undefined' ? localStorage.getItem('zs_token') : null;
      const base  = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const res   = await fetch(`${base}/transcriptions/export?format=csv&month=${month}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { alert('Erro ao exportar. Verifique seu plano.'); return; }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = `transcricoes-${month}.csv`; a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  async function saveTags() {
    if (!selected) return;
    setSavingTags(true);
    try {
      await api.patch(`/transcriptions/${selected.id}/tags`, { tags: editTags });
      setItems(prev => prev.map(t => t.id === selected.id ? { ...t, tags: editTags } : t));
      setSelected(prev => prev ? { ...prev, tags: editTags } : null);
    } catch (err: any) {
      alert(err.message || 'Erro ao salvar tags.');
    } finally {
      setSavingTags(false);
    }
  }

  function openDetail(t: Transcription) {
    setSelected(t);
    setEditTags(t.tags || []);
  }

  const canSearch = PLAN_SEARCH.includes(planName);
  const canExport = PLAN_EXPORT.includes(planName);
  const canTags   = PLAN_TAGS.includes(planName);
  const canLang   = PLAN_LANG.includes(planName);
  const hasFilters = search || filterTag || filterLang;

  return (
    <div className="p-4 sm:p-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-brand-text">Transcrições</h1>
          <p className="text-sm text-brand-text-secondary font-light mt-0.5">{total} transcrição(ões) no total</p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {/* Exportar CSV */}
          <button
            onClick={canExport ? handleExport : undefined}
            disabled={exporting}
            title={!canExport ? 'Disponível no plano Pro ou superior' : 'Exportar CSV do mês atual'}
            className={`text-sm px-3 py-2.5 rounded-xl border flex items-center gap-1.5 transition-colors ${
              canExport
                ? 'border-brand-border text-brand-text-secondary hover:border-brand-primary hover:text-brand-primary'
                : 'border-brand-border/40 text-brand-muted cursor-not-allowed'
            }`}>
            {exporting ? '...' : '📤'} <span className="hidden xs:inline">CSV</span>
            {!canExport && <span className="text-[9px] bg-brand-primary/10 text-brand-primary px-1 py-0.5 rounded font-bold ml-0.5">Pro+</span>}
          </button>
          {/* Enviar áudio */}
          <button onClick={() => setShowUpload(true)} className="btn-primary text-sm px-4 py-2.5 flex items-center gap-2">
            <span>🎙️</span><span className="hidden xs:inline">Enviar áudio</span>
          </button>
        </div>
      </div>

      {/* Busca e filtros */}
      <form onSubmit={handleSearch} className="flex gap-2 mb-3 flex-wrap">
        {/* Campo de busca */}
        <div className="relative flex-1 min-w-[180px]">
          <input
            className={`input w-full ${!canSearch ? 'opacity-60 cursor-not-allowed' : ''}`}
            placeholder={canSearch ? 'Buscar por contato, texto ou resumo...' : '🔒 Busca disponível no plano Pro'}
            value={search}
            onChange={e => canSearch && setSearch(e.target.value)}
            readOnly={!canSearch}
            title={!canSearch ? 'Disponível no plano Pro ou superior' : ''}
          />
        </div>

        {/* Filtro de idioma (Ultra+) */}
        {canLang && (
          <select
            className="input text-sm py-2"
            value={filterLang}
            onChange={e => { setFilterLang(e.target.value); setOffset(0); load(search, 0, filterTag, e.target.value); }}>
            <option value="">🌐 Idioma</option>
            <option value="pt">🇧🇷 PT</option>
            <option value="en">🇺🇸 EN</option>
            <option value="es">🇪🇸 ES</option>
            <option value="fr">🇫🇷 FR</option>
            <option value="de">🇩🇪 DE</option>
          </select>
        )}

        <button type="submit" className="btn-primary px-4">Buscar</button>
        {hasFilters && (
          <button type="button" className="btn-ghost px-3 text-sm" onClick={clearFilters}>Limpar</button>
        )}
      </form>

      {/* Filtro por tag ativo */}
      {filterTag && (
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs text-brand-muted">Tag:</span>
          <span className="text-xs bg-brand-primary/10 text-brand-primary border border-brand-primary/20 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
            {filterTag}
            <button onClick={() => { setFilterTag(''); setOffset(0); load(search, 0, '', filterLang); }} className="hover:opacity-70">×</button>
          </span>
        </div>
      )}

      {/* Lista */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-brand-muted text-sm">Carregando...</div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center text-brand-muted">
            <div className="text-4xl mb-3">🎙️</div>
            <div className="text-sm mb-4">{hasFilters ? 'Nenhuma transcrição encontrada.' : 'Nenhuma transcrição ainda.'}</div>
            {!hasFilters && (
              <button onClick={() => setShowUpload(true)} className="btn-primary text-sm px-5 py-2.5">Enviar primeiro áudio</button>
            )}
          </div>
        ) : (
          items.map(t => (
            <div key={t.id}
              className="hover-row flex items-start gap-3 px-5 py-4 group last:border-0"
              style={{ borderBottom: '1px solid rgb(var(--color-border) / .5)' }}>
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 mt-0.5"
                style={{ background: 'rgba(var(--color-primary), .35)' }}>
                {(t.contactName || t.contactPhone)[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => openDetail(t)}>
                <div className="flex items-center gap-1.5 mb-0.5 min-w-0">
                  <span className="text-sm font-semibold text-brand-text truncate">{t.contactName || t.contactPhone}</span>
                  <span className="text-xs text-brand-muted ml-auto flex-shrink-0">{new Date(t.createdAt).toLocaleDateString('pt-BR')}</span>
                </div>
                <span className="text-[10px] text-brand-muted bg-brand-elevated px-2 py-0.5 rounded font-mono inline-block mb-1 max-w-full truncate">
                  {t.number ? (t.number.displayName || t.number.phoneNumber) : 'Número removido'}
                </span>
                <p className="text-xs text-brand-text-secondary font-light line-clamp-2">{t.originalText}</p>
                <div className="flex gap-2 mt-1.5 flex-wrap">
                  <span className="text-[10px] font-bold bg-brand-primary/10 border border-brand-primary/15 text-brand-primary px-2 py-0.5 rounded">
                    🎙 {t.durationSec}s
                  </span>
                  {/* Badge de idioma */}
                  {t.language && t.language !== 'pt' && (
                    <span className="text-[10px] font-bold bg-amber-400/10 border border-amber-400/20 text-amber-400 px-2 py-0.5 rounded">
                      {LANG_FLAG[t.language] || t.language.toUpperCase()}
                    </span>
                  )}
                  {/* Tags */}
                  {(t.tags || []).map((tag, i) => (
                    <button key={tag}
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${TAG_COLORS[i % TAG_COLORS.length]} hover:opacity-80`}
                      onClick={e => { e.stopPropagation(); setFilterTag(tag); setOffset(0); load(search, 0, tag, filterLang); }}>
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={() => handleDelete(t.id)}
                className="opacity-0 group-hover:opacity-100 text-brand-muted hover:text-red-400 text-sm transition-all flex-shrink-0 mt-1">
                🗑
              </button>
            </div>
          ))
        )}
      </div>

      {/* Paginação */}
      {total > LIMIT && (
        <div className="flex justify-center gap-2 mt-4">
          <button className="btn-ghost text-xs py-1.5 px-4" disabled={offset === 0}
            onClick={() => { const o = offset - LIMIT; setOffset(o); load(search, o, filterTag, filterLang); }}>
            ← Anterior
          </button>
          <span className="text-xs text-brand-muted self-center">
            {Math.floor(offset / LIMIT) + 1} / {Math.ceil(total / LIMIT)}
          </span>
          <button className="btn-ghost text-xs py-1.5 px-4" disabled={offset + LIMIT >= total}
            onClick={() => { const o = offset + LIMIT; setOffset(o); load(search, o, filterTag, filterLang); }}>
            Próxima →
          </button>
        </div>
      )}

      {/* Modal de upload */}
      {showUpload && (
        <UploadModal onClose={() => setShowUpload(false)} onDone={() => { setOffset(0); load('', 0, '', ''); }} />
      )}

      {/* Modal de detalhe */}
      {selected && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setSelected(null)}>
          <div className="modal-panel w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[88vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4 p-5 pb-0">
              <div>
                <div className="font-bold text-base text-brand-text">{selected.contactName || selected.contactPhone}</div>
                <div className="text-xs text-brand-muted mt-0.5 flex items-center gap-1.5">
                  {selected.number ? (selected.number.displayName || selected.number.phoneNumber) : 'Número removido'}
                  {' · '}
                  {new Date(selected.createdAt).toLocaleString('pt-BR')}
                  {selected.language && selected.language !== 'pt' && (
                    <span className="text-[10px] bg-amber-400/10 text-amber-400 border border-amber-400/20 px-1.5 py-0.5 rounded font-bold">
                      {LANG_FLAG[selected.language] || selected.language.toUpperCase()}
                    </span>
                  )}
                </div>
              </div>
              <button onClick={() => setSelected(null)} className="text-brand-muted hover:text-brand-text text-xl leading-none transition-colors p-1">✕</button>
            </div>

            <div className="px-5 pb-5 space-y-3">
              {/* Resumo */}
              {selected.summaryBullets.length > 0 && (
                <div className="inner-block">
                  <div className="text-[10px] font-bold text-brand-primary uppercase tracking-widest mb-2">✨ Resumo</div>
                  {selected.summaryBullets.map((b, i) => (
                    <div key={i} className="text-sm text-brand-text mb-1.5 flex gap-2">
                      <span className="text-brand-primary mt-0.5 flex-shrink-0">•</span>{b}
                    </div>
                  ))}
                </div>
              )}

              {/* Texto original */}
              <div className="inner-block">
                <div className="text-[10px] font-bold text-brand-text-secondary uppercase tracking-widest mb-2">Original</div>
                <p className="text-sm text-brand-text-secondary font-light leading-relaxed italic">"{selected.originalText}"</p>
              </div>

              {/* Tags (Ultra+) */}
              <div className={`inner-block ${!canTags ? 'opacity-60' : ''}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[10px] font-bold text-brand-text-secondary uppercase tracking-widest">🏷️ Tags</div>
                  {!canTags && <span className="text-[9px] bg-brand-primary/10 text-brand-primary px-1.5 py-0.5 rounded font-bold">Ultra+</span>}
                </div>
                {canTags ? (
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <TagInput tags={editTags} onChange={setEditTags} />
                    </div>
                    {JSON.stringify(editTags) !== JSON.stringify(selected.tags || []) && (
                      <button
                        onClick={saveTags}
                        disabled={savingTags}
                        className="text-xs btn-primary px-3 py-1.5 flex-shrink-0">
                        {savingTags ? '...' : 'Salvar'}
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-brand-muted">Tags disponíveis no plano Ultra ou superior.</p>
                )}
              </div>

              {/* Ações */}
              <div className="grid grid-cols-3 gap-2">
                <button onClick={() => copyText(selected.originalText)} className="btn-ghost text-xs py-2.5 justify-center">
                  {copied ? '✓ Copiado' : '📋 Copiar'}
                </button>
                <button
                  onClick={() => copyText(`Resumo:\n${selected.summaryBullets.map(b => `• ${b}`).join('\n')}\n\nOriginal:\n${selected.originalText}`)}
                  className="btn-ghost text-xs py-2.5 justify-center">
                  📄 Resumo
                </button>
                <button onClick={() => handleDelete(selected.id)}
                  className="text-xs py-2.5 rounded-lg border border-red-400/20 text-red-400 hover:bg-red-400/5 transition-colors">
                  🗑 Deletar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
