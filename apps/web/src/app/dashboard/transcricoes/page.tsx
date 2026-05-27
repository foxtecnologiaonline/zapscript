'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '@/lib/api';

/* ─── Types ───────────────────────────────────────────────────────────────── */
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

/* ─── Constants ───────────────────────────────────────────────────────────── */
const ALLOWED_EXT = ['.ogg', '.opus', '.mp3', '.mp4', '.m4a', '.wav', '.webm', '.mpeg'];
const MAX_MB      = 50;
const LIMIT       = 20;

const PLAN_SEARCH  = ['pro', 'ultra', 'executive'];
const PLAN_EXPORT  = ['pro', 'ultra', 'executive'];
const PLAN_TAGS    = ['pro', 'ultra', 'executive'];
const PLAN_LANG    = ['ultra', 'executive'];
const PLAN_AI_FEAT = ['pro', 'ultra', 'executive'];
const PLAN_VOICE   = ['ultra', 'executive'];

const DOC_TYPES = [
  { value: 'resumo',     label: 'Resumo Executivo'    },
  { value: 'ata',        label: 'Ata de Reunião'      },
  { value: 'email',      label: 'E-mail Profissional' },
  { value: 'briefing',   label: 'Briefing'            },
  { value: 'combinados', label: 'Combinados'          },
];

const LANG_FLAG: Record<string, string> = {
  pt: '🇧🇷', 'pt-BR': '🇧🇷', en: '🇺🇸', es: '🇪🇸',
  fr: '🇫🇷', de: '🇩🇪', it: '🇮🇹', ja: '🇯🇵',
  zh: '🇨🇳', ko: '🇰🇷', ru: '🇷🇺', ar: '🇸🇦',
};
const LANG_CODE: Record<string, string> = {
  pt: 'PT', 'pt-BR': 'PT', en: 'EN', es: 'ES',
  fr: 'FR', de: 'DE', it: 'IT', ja: 'JA',
  zh: 'ZH', ko: 'KO', ru: 'RU', ar: 'AR',
};

const TAG_COLORS = [
  'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400',
  'bg-amber-500/10  text-amber-600  border-amber-500/20  dark:text-amber-400',
  'bg-violet-500/10 text-violet-600 border-violet-500/20 dark:text-violet-400',
  'bg-rose-500/10   text-rose-600   border-rose-500/20   dark:text-rose-400',
  'bg-sky-500/10    text-sky-600    border-sky-500/20    dark:text-sky-400',
];

const AVATAR_PALETTE = [
  '#0d9668', '#f59e0b', '#6366f1', '#ec4899', '#14b8a6', '#f97316',
];

/* ─── Helpers ──────────────────────────────────────────────────────────────── */
function avatarColor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}

function fmtDur(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

function relTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'agora';
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  if (h < 48) return 'ontem';
  return new Date(dateStr).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function isPortuguese(lang: string): boolean {
  return lang === 'pt' || lang === 'pt-BR' || lang === '';
}

type ModalTab = 'resumo' | 'original' | 'ia' | 'exportar';

/* ─── Sub-components ───────────────────────────────────────────────────────── */

/** Filter chip — active filter pill with remove button */
function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-brand-border bg-brand-elevated text-brand-text-secondary font-medium">
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="text-brand-muted hover:text-brand-text transition-colors ml-0.5 leading-none"
        aria-label="Remover filtro">
        ×
      </button>
    </span>
  );
}

/** Avatar circle with initials and hash-based color */
function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const sz = size === 'sm' ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm';
  return (
    <div
      className={`${sz} rounded-full flex-shrink-0 flex items-center justify-center font-bold text-white select-none`}
      style={{ background: avatarColor(name) }}>
      {name[0]?.toUpperCase() ?? '?'}
    </div>
  );
}

/** Tag input pill — add/remove tags with keyboard */
function TagInput({ tags, onChange, disabled }: {
  tags: string[];
  onChange: (t: string[]) => void;
  disabled?: boolean;
}) {
  const [input, setInput] = useState('');

  function addTag(val: string) {
    const tag = val.trim().slice(0, 20);
    if (!tag || tags.includes(tag) || tags.length >= 5) return;
    onChange([...tags, tag]);
    setInput('');
  }

  return (
    <div className="flex flex-wrap gap-1.5 items-center min-h-[34px] p-1.5 rounded-xl border border-brand-border focus-within:border-brand-primary bg-brand-elevated transition-colors">
      {tags.map((t, i) => (
        <span
          key={t}
          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border flex items-center gap-1 ${TAG_COLORS[i % TAG_COLORS.length]}`}>
          {t}
          {!disabled && (
            <button
              type="button"
              onClick={() => onChange(tags.filter(x => x !== t))}
              className="opacity-60 hover:opacity-100 leading-none ml-0.5"
              aria-label={`Remover tag ${t}`}>×</button>
          )}
        </span>
      ))}
      {!disabled && tags.length < 5 && (
        <input
          className="text-xs bg-transparent border-none outline-none text-brand-text placeholder:text-brand-muted flex-1 min-w-[80px]"
          placeholder={tags.length === 0 ? '+ adicionar tag...' : '+ tag'}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(input); }
            if (e.key === 'Backspace' && !input && tags.length) onChange(tags.slice(0, -1));
          }}
          onBlur={() => { if (input) addTag(input); }}
        />
      )}
      {disabled && tags.length === 0 && (
        <span className="text-xs text-brand-muted italic px-1">Sem tags</span>
      )}
    </div>
  );
}

/** Upload audio modal */
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
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}>
      <div
        className="bg-brand-surface w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 sm:p-6 shadow-2xl"
        onClick={e => e.stopPropagation()}>

        {/* Drag handle mobile */}
        <div className="w-10 h-1 bg-brand-border rounded-full mx-auto mb-5 sm:hidden" />

        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="font-bold text-base text-brand-text">Enviar áudio para transcrição</h2>
            <p className="text-xs text-brand-muted mt-0.5">
              OGG · OPUS · MP3 · MP4 · M4A · WAV · WEBM — máx. {MAX_MB}MB
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-brand-muted hover:text-brand-text p-1 rounded-lg transition-colors"
            aria-label="Fechar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {success ? (
          <div className="text-center py-8">
            <div className="w-16 h-16 rounded-full bg-brand-primary/10 border-2 border-brand-primary/30 flex items-center justify-center mx-auto mb-4">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: 'rgb(var(--color-primary))' }}>
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <p className="font-semibold text-brand-text">Áudio enviado com sucesso!</p>
            <p className="text-xs text-brand-muted mt-1">A transcrição chegará em instantes…</p>
          </div>
        ) : (
          <>
            <div
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all mb-4 ${
                dragging
                  ? 'border-brand-primary bg-brand-primary/5 scale-[1.01]'
                  : file
                    ? 'border-brand-primary/40 bg-brand-primary/5'
                    : 'border-brand-border hover:border-brand-primary/40 hover:bg-brand-elevated/50'
              }`}
              onClick={() => inputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) pickFile(f); }}>
              <input
                ref={inputRef}
                type="file"
                accept={ALLOWED_EXT.join(',')}
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) pickFile(f); }}
              />
              {file ? (
                <>
                  <div className="text-3xl mb-2">🎙️</div>
                  <p className="text-sm font-semibold text-brand-text">{file.name}</p>
                  <p className="text-xs text-brand-muted mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); setFile(null); setError(''); }}
                    className="text-xs text-brand-muted hover:text-red-400 mt-2 transition-colors">
                    Remover
                  </button>
                </>
              ) : (
                <>
                  <div className="text-3xl mb-2 opacity-60">📁</div>
                  <p className="text-sm text-brand-text-secondary">
                    Arraste aqui ou{' '}
                    <span className="text-brand-primary font-semibold">clique para selecionar</span>
                  </p>
                </>
              )}
            </div>
            {error && (
              <div className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-xl px-3 py-2 mb-4">
                {error}
              </div>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="btn-ghost flex-1 py-2.5 text-sm">
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleUpload}
                disabled={!file || uploading}
                className="btn-primary flex-1 py-2.5 text-sm disabled:opacity-50 flex items-center justify-center gap-2">
                {uploading ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    Enviando…
                  </>
                ) : 'Transcrever áudio'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Main Page ────────────────────────────────────────────────────────────── */
export default function TranscricoesPage() {

  /* — List state — */
  const [items, setItems]                   = useState<Transcription[]>([]);
  const [total, setTotal]                   = useState(0);
  const [loading, setLoading]               = useState(true);
  const [offset, setOffset]                 = useState(0);

  /* — Filters state — */
  const [search, setSearch]                 = useState('');
  const [filterTag, setFilterTag]           = useState('');
  const [filterLang, setFilterLang]         = useState('');
  const [filterContact, setFilterContact]   = useState('');
  const [dateFrom, setDateFrom]             = useState('');
  const [dateTo, setDateTo]                 = useState('');
  const [sortOrder, setSortOrder]           = useState('date_desc');
  const [filterSource, setFilterSource]     = useState('');
  const [showFilters, setShowFilters]       = useState(false);

  /* — Detail modal state — */
  const [selected, setSelected]             = useState<Transcription | null>(null);
  const [activeTab, setActiveTab]           = useState<ModalTab>('resumo');
  const [editTags, setEditTags]             = useState<string[]>([]);
  const [savingTags, setSavingTags]         = useState(false);
  const [copied, setCopied]                 = useState(false);

  /* — IA features state — */
  const [suggestedReplies, setSuggestedReplies] = useState<string[] | null>(null);
  const [loadingReplies, setLoadingReplies]     = useState(false);
  const [generatedDoc, setGeneratedDoc]         = useState<{ type: string; content: string } | null>(null);
  const [loadingDoc, setLoadingDoc]             = useState(false);
  const [docType, setDocType]                   = useState('resumo');

  /* — Upload & export — */
  const [showUpload, setShowUpload]         = useState(false);
  const [exporting, setExporting]           = useState(false);

  /* — Plan — */
  const [planName, setPlanName]             = useState('free');

  /* — NPS — */
  const [npsVisible, setNpsVisible]         = useState(false);
  const [npsScore, setNpsScore]             = useState<number | null>(null);
  const [npsComment, setNpsComment]         = useState('');
  const [npsSubmitting, setNpsSubmitting]   = useState(false);
  const [npsDone, setNpsDone]               = useState(false);

  /* ── Boot ──────────────────────────────────────────────────────────────── */
  useEffect(() => {
    api.get<any>('/auth/me')
      .then(u => setPlanName(u.subscription?.plan?.name || 'free'))
      .catch(() => null);
    api.get<any>('/nps/status')
      .then(s => { if (s.shouldShow) setNpsVisible(true); })
      .catch(() => null);
  }, []);

  /* ── Load list ─────────────────────────────────────────────────────────── */
  const load = useCallback(async (
    s = search, o = offset,
    tag = filterTag, lang = filterLang,
    contact = filterContact, from = dateFrom, to = dateTo,
    sort = sortOrder, source = filterSource,
  ) => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ limit: String(LIMIT), offset: String(o) });
      if (s)       p.set('search', s);
      if (tag)     p.set('tag', tag);
      if (lang)    p.set('language', lang);
      if (contact) p.set('contact', contact);
      if (from)    p.set('dateFrom', from);
      if (to)      p.set('dateTo', to);
      if (sort)    p.set('sort', sort);
      if (source)  p.set('source', source);
      const res = await api.get<{ items: Transcription[]; total: number }>(`/transcriptions?${p}`);
      setItems(res.items);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line

  useEffect(() => { load(); }, []); // eslint-disable-line

  /* ── Handlers ──────────────────────────────────────────────────────────── */
  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setOffset(0);
    load(search, 0, filterTag, filterLang, filterContact, dateFrom, dateTo, sortOrder, filterSource);
  }

  function clearFilters() {
    setSearch(''); setFilterTag(''); setFilterLang(''); setFilterContact('');
    setDateFrom(''); setDateTo(''); setSortOrder('date_desc'); setFilterSource('');
    setOffset(0);
    load('', 0, '', '', '', '', '', 'date_desc', '');
  }

  function openDetail(t: Transcription) {
    setSelected(t);
    setEditTags(t.tags || []);
    setSuggestedReplies(null);
    setGeneratedDoc(null);
    setActiveTab('resumo');
  }

  function closeDetail() { setSelected(null); }

  function copyText(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleDelete(id: string) {
    if (!confirm('Deletar esta transcrição?')) return;
    await api.delete(`/transcriptions/${id}`);
    setItems(i => i.filter(t => t.id !== id));
    setTotal(t => t - 1);
    if (selected?.id === id) setSelected(null);
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

  async function loadSuggestedReplies(t: Transcription) {
    setSuggestedReplies(null);
    setLoadingReplies(true);
    try {
      const res = await api.get<{ replies: string[] }>(`/transcriptions/${t.id}/suggest-reply`);
      setSuggestedReplies(res.replies || []);
    } catch (err: any) {
      alert(err.message || 'Erro ao gerar sugestões.');
    } finally {
      setLoadingReplies(false);
    }
  }

  async function generateDocument(t: Transcription, type: string) {
    setGeneratedDoc(null);
    setLoadingDoc(true);
    try {
      const res = await api.post<{ content: string; docType: string }>(
        `/transcriptions/${t.id}/generate-document`, { docType: type }
      );
      setGeneratedDoc({ type, content: res.content });
    } catch (err: any) {
      alert(err.message || 'Erro ao gerar documento.');
    } finally {
      setLoadingDoc(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const month = new Date().toISOString().slice(0, 7);
      const token = typeof window !== 'undefined' ? localStorage.getItem('zs_token') : null;
      const base  = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const res   = await fetch(`${base}/transcriptions/export?format=csv&month=${month}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { alert('Erro ao exportar. Verifique seu plano.'); return; }
      const blob = await res.blob();
      const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob),
        download: `transcricoes-${month}.csv`,
      });
      a.click(); URL.revokeObjectURL(a.href);
    } finally {
      setExporting(false);
    }
  }

  /* ── Single-transcription export helpers ──────────────────────────────── */
  function exportSinglePdf(t: Transcription) {
    const date = new Date(t.createdAt).toLocaleString('pt-BR');
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Transcrição</title>
<style>body{font-family:Arial,sans-serif;font-size:12px;margin:2cm;color:#111}h1{font-size:18px;color:#0d9668}h2{font-size:13px;color:#0d9668;border-bottom:1px solid #ddd;padding-bottom:4px}p{line-height:1.6}li{margin:4px 0}@media print{body{margin:1.5cm}}</style>
</head><body>
<h1>📝 ${t.contactName || t.contactPhone}</h1>
<p><b>Data:</b> ${date} &nbsp;|&nbsp; <b>Duração:</b> ${fmtDur(t.durationSec)} &nbsp;|&nbsp; <b>Idioma:</b> ${t.language.toUpperCase()}</p>
${t.tags?.length ? `<p><b>Tags:</b> ${t.tags.join(', ')}</p>` : ''}
<h2>✨ Resumo</h2><ul>${t.summaryBullets.map(b => `<li>${b}</li>`).join('')}</ul>
<h2>📝 Texto Original</h2><p><i>"${t.originalText}"</i></p>
<hr style="margin-top:40px;border:none;border-top:1px solid #eee"/>
<p style="font-size:10px;color:#999;text-align:center">Gerado pelo ZapScript · zapscript.me</p>
<script>window.onload=()=>{window.print()}<\/script>
</body></html>`);
    w.document.close();
  }

  function exportSingleDocx(t: Transcription) {
    const esc = (v: string) => (v || '').replace(/</g, '&lt;');
    const date = new Date(t.createdAt).toLocaleString('pt-BR');
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"/><style>body{font-family:Calibri,Arial;font-size:11pt;margin:2cm}h1{font-size:14pt}h2{font-size:12pt;color:#0d9668}p{margin:6pt 0}li{margin:3pt 0}</style></head><body>
<h1>${esc(t.contactName || t.contactPhone)}</h1>
<p><b>Data:</b> ${date} | <b>Duração:</b> ${fmtDur(t.durationSec)} | <b>Idioma:</b> ${t.language.toUpperCase()}</p>
${t.tags?.length ? `<p><b>Tags:</b> ${t.tags.join(', ')}</p>` : ''}
<h2>✨ Resumo</h2><ul>${t.summaryBullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>
<h2>📝 Texto Original</h2><p><i>${esc(t.originalText)}</i></p>
</body></html>`;
    const blob = new Blob([html], { type: 'application/msword;charset=utf-8' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `transcricao-${t.id.slice(0, 8)}.docx` });
    a.click(); URL.revokeObjectURL(a.href);
  }

  function exportSingleCsv(t: Transcription) {
    const esc = (v: string) => `"${(v || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`;
    const header = 'Data,Contato,Telefone,Duração,Idioma,Tags,Texto,Resumo';
    const row = [
      esc(new Date(t.createdAt).toLocaleString('pt-BR')),
      esc(t.contactName || ''), esc(t.contactPhone),
      esc(fmtDur(t.durationSec)), esc(t.language),
      esc((t.tags || []).join(', ')), esc(t.originalText),
      esc(t.summaryBullets.join(' | ')),
    ].join(',');
    const blob = new Blob(['﻿' + header + '\n' + row], { type: 'text/csv;charset=utf-8' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `transcricao-${t.id.slice(0, 8)}.csv` });
    a.click(); URL.revokeObjectURL(a.href);
  }

  function exportSingleXls(t: Transcription) {
    const c = (v: string) => `<td>${(v || '').replace(/</g, '&lt;')}</td>`;
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"/></head><body><table>
<tr><th>Data</th><th>Contato</th><th>Telefone</th><th>Duração</th><th>Idioma</th><th>Tags</th><th>Texto</th><th>Resumo</th></tr>
<tr>${c(new Date(t.createdAt).toLocaleString('pt-BR'))}${c(t.contactName||'')}${c(t.contactPhone)}${c(fmtDur(t.durationSec))}${c(t.language)}${c((t.tags||[]).join(', '))}${c(t.originalText)}${c(t.summaryBullets.join(' | '))}</tr>
</table></body></html>`;
    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `transcricao-${t.id.slice(0, 8)}.xls` });
    a.click(); URL.revokeObjectURL(a.href);
  }

  function downloadGeneratedDoc(t: Transcription) {
    if (!generatedDoc) return;
    const label = DOC_TYPES.find(d => d.value === generatedDoc.type)?.label || generatedDoc.type;
    const html = `<html><head><meta charset="utf-8"/><style>body{font-family:Arial,sans-serif;font-size:12px;margin:2cm;line-height:1.7;white-space:pre-wrap}</style></head><body><h2>${label} — ${t.contactName || t.contactPhone}</h2>\n\n${generatedDoc.content}</body></html>`;
    const blob = new Blob([html], { type: 'application/msword;charset=utf-8' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${generatedDoc.type}-${t.id.slice(0, 8)}.docx` });
    a.click(); URL.revokeObjectURL(a.href);
  }

  async function submitNps() {
    if (npsScore == null) return;
    setNpsSubmitting(true);
    try {
      await api.post('/nps/submit', { score: npsScore, comment: npsComment.trim() || undefined });
      setNpsDone(true);
      setTimeout(() => setNpsVisible(false), 2500);
    } catch { setNpsVisible(false); }
    finally { setNpsSubmitting(false); }
  }

  /* ── Derived ───────────────────────────────────────────────────────────── */
  const canSearch  = PLAN_SEARCH.includes(planName);
  const canExport  = PLAN_EXPORT.includes(planName);
  const canTags    = PLAN_TAGS.includes(planName);
  const canLang    = PLAN_LANG.includes(planName);
  const canAiFeat  = PLAN_AI_FEAT.includes(planName);
  const canVoice   = PLAN_VOICE.includes(planName);
  const hasFilters = !!(search || filterTag || filterLang || filterContact || dateFrom || dateTo || filterSource);
  const tagsChanged = JSON.stringify(editTags) !== JSON.stringify(selected?.tags || []);

  const totalPages = Math.ceil(total / LIMIT);
  const currentPage = Math.floor(offset / LIMIT) + 1;

  /* ─── Keyboard shortcut: Escape closes modal ─────────────────────────── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && selected) closeDetail(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  /* ══════════════════════════════════════════════════════════════════════ */
  /*  RENDER                                                                */
  /* ══════════════════════════════════════════════════════════════════════ */
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl">

      {/* ── PAGE HEADER ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-brand-text">Transcrições</h1>
          <p className="text-sm text-brand-muted mt-0.5">
            {loading ? 'Carregando…' : `${total.toLocaleString('pt-BR')} transcrição${total !== 1 ? 'ões' : ''}`}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Export bulk CSV — Pro+ */}
          <button
            type="button"
            onClick={canExport ? handleExport : undefined}
            disabled={exporting}
            title={!canExport ? 'Exportação disponível no plano Pro' : 'Exportar CSV do mês atual'}
            className={`relative text-sm px-3 py-2 rounded-xl border flex items-center gap-1.5 transition-colors ${
              canExport
                ? 'border-brand-border text-brand-text-secondary hover:border-brand-primary hover:text-brand-primary'
                : 'border-brand-border/40 text-brand-muted cursor-not-allowed'
            }`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            <span className="hidden sm:inline">{exporting ? 'Exportando…' : 'Exportar CSV'}</span>
            {!canExport && (
              <span className="text-[9px] font-bold px-1 py-0.5 rounded ml-0.5"
                style={{ background: 'rgba(13,150,104,.12)', color: 'rgb(var(--color-primary))' }}>
                Pro+
              </span>
            )}
          </button>

          {/* Upload audio */}
          <button
            type="button"
            onClick={() => setShowUpload(true)}
            className="btn-primary text-sm px-4 py-2 flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
            <span className="hidden sm:inline">Enviar áudio</span>
            <span className="sm:hidden">Enviar</span>
          </button>
        </div>
      </div>

      {/* ── SEARCH + FILTER BAR ─────────────────────────────────────────── */}
      <form onSubmit={handleSearch} className="mb-3">

        {/* Row 1: search + toggle + submit */}
        <div className="flex gap-2 mb-2">

          {/* Search input */}
          <div className="relative flex-1">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted pointer-events-none">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
            </div>
            <input
              className={`input pl-9 w-full ${!canSearch ? 'opacity-70 cursor-not-allowed' : ''}`}
              placeholder={canSearch
                ? 'Buscar por contato, texto ou resumo…'
                : '🔒 Busca disponível no plano Pro'
              }
              value={search}
              onChange={e => canSearch && setSearch(e.target.value)}
              readOnly={!canSearch}
              aria-label="Buscar transcrições"
            />
          </div>

          {/* Filter toggle */}
          <button
            type="button"
            onClick={() => setShowFilters(f => !f)}
            aria-label="Filtros"
            aria-expanded={showFilters}
            className={`px-3 py-2 rounded-xl border text-sm flex items-center gap-1.5 transition-colors flex-shrink-0 ${
              showFilters || hasFilters
                ? 'border-brand-primary bg-brand-primary/10 text-brand-primary'
                : 'border-brand-border text-brand-muted hover:border-brand-primary hover:text-brand-primary'
            }`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="4" y1="6" x2="20" y2="6"/>
              <line x1="8" y1="12" x2="16" y2="12"/>
              <line x1="11" y1="18" x2="13" y2="18"/>
            </svg>
            <span className="hidden sm:inline">Filtros</span>
            {hasFilters && !showFilters && (
              <span className="w-2 h-2 rounded-full bg-brand-primary flex-shrink-0" />
            )}
          </button>

          {/* Search button */}
          <button type="submit" className="btn-primary px-4 text-sm flex-shrink-0">
            Buscar
          </button>
        </div>

        {/* Row 2: expanded filter panel */}
        {showFilters && (
          <div className="card p-4 space-y-3 mb-2 border border-brand-border/60">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">

              {/* Contact */}
              <input
                className="input text-sm py-2 col-span-2 sm:col-span-1"
                placeholder="👤 Filtrar por contato"
                value={filterContact}
                onChange={e => setFilterContact(e.target.value)}
              />

              {/* Date from */}
              <div className="relative">
                <input
                  type="date"
                  className="input text-sm py-2 w-full"
                  value={dateFrom}
                  onChange={e => setDateFrom(e.target.value)}
                  aria-label="Data inicial"
                />
                {!dateFrom && (
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted text-xs pointer-events-none">
                    De
                  </span>
                )}
              </div>

              {/* Date to */}
              <div className="relative">
                <input
                  type="date"
                  className="input text-sm py-2 w-full"
                  value={dateTo}
                  onChange={e => setDateTo(e.target.value)}
                  aria-label="Data final"
                />
                {!dateTo && (
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted text-xs pointer-events-none">
                    Até
                  </span>
                )}
              </div>

              {/* Language — Ultra+ */}
              <div className="relative">
                <select
                  disabled={!canLang}
                  className="input text-sm py-2 w-full disabled:opacity-50 disabled:cursor-not-allowed"
                  value={filterLang}
                  onChange={e => {
                    setFilterLang(e.target.value);
                    setOffset(0);
                    load(search, 0, filterTag, e.target.value, filterContact, dateFrom, dateTo, sortOrder, filterSource);
                  }}>
                  <option value="">🌐 Idioma (todos)</option>
                  <option value="pt">🇧🇷 Português</option>
                  <option value="en">🇺🇸 English</option>
                  <option value="es">🇪🇸 Español</option>
                  <option value="fr">🇫🇷 Français</option>
                  <option value="de">🇩🇪 Deutsch</option>
                </select>
                {!canLang && (
                  <span className="absolute -top-1.5 -right-1 text-[9px] font-bold px-1.5 py-0.5 rounded"
                    style={{ background: 'rgba(245,158,11,.15)', color: '#f59e0b', border: '1px solid rgba(245,158,11,.3)' }}>
                    Ultra+
                  </span>
                )}
              </div>

              {/* Sort */}
              <select
                className="input text-sm py-2"
                value={sortOrder}
                onChange={e => {
                  setSortOrder(e.target.value);
                  setOffset(0);
                  load(search, 0, filterTag, filterLang, filterContact, dateFrom, dateTo, e.target.value, filterSource);
                }}>
                <option value="date_desc">📅 Mais recentes</option>
                <option value="date_asc">📅 Mais antigas</option>
                <option value="contact">🔤 Contato A-Z</option>
              </select>

              {/* Voice notes — Ultra+ */}
              {canVoice && (
                <button
                  type="button"
                  onClick={() => {
                    const s = filterSource === 'voice-note' ? '' : 'voice-note';
                    setFilterSource(s);
                    setOffset(0);
                    load(search, 0, filterTag, filterLang, filterContact, dateFrom, dateTo, sortOrder, s);
                  }}
                  className={`text-xs px-3 py-2 rounded-xl border transition-colors ${
                    filterSource === 'voice-note'
                      ? 'bg-brand-primary text-white border-brand-primary'
                      : 'border-brand-border text-brand-muted hover:border-brand-primary hover:text-brand-primary'
                  }`}>
                  🎙️ Notas pessoais
                </button>
              )}
            </div>

            <div className="flex items-center justify-between pt-1">
              <button type="submit" className="btn-primary text-sm px-5 py-2">
                Aplicar filtros
              </button>
              {hasFilters && (
                <button type="button" onClick={clearFilters}
                  className="text-xs text-brand-muted hover:text-red-400 transition-colors">
                  Limpar todos
                </button>
              )}
            </div>
          </div>
        )}

        {/* Active filter chips — when panel is closed */}
        {hasFilters && !showFilters && (
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            {filterTag && (
              <FilterChip label={`🏷️ ${filterTag}`}
                onRemove={() => { setFilterTag(''); setOffset(0); load(search, 0, '', filterLang, filterContact, dateFrom, dateTo, sortOrder, filterSource); }} />
            )}
            {filterContact && (
              <FilterChip label={`👤 ${filterContact}`}
                onRemove={() => { setFilterContact(''); setOffset(0); load(search, 0, filterTag, filterLang, '', dateFrom, dateTo, sortOrder, filterSource); }} />
            )}
            {filterLang && (
              <FilterChip label={`${LANG_FLAG[filterLang] || '🌐'} ${LANG_CODE[filterLang] || filterLang.toUpperCase()}`}
                onRemove={() => { setFilterLang(''); setOffset(0); load(search, 0, filterTag, '', filterContact, dateFrom, dateTo, sortOrder, filterSource); }} />
            )}
            {(dateFrom || dateTo) && (
              <FilterChip label={`📅 ${dateFrom || '…'} → ${dateTo || '…'}`}
                onRemove={() => { setDateFrom(''); setDateTo(''); setOffset(0); load(search, 0, filterTag, filterLang, filterContact, '', '', sortOrder, filterSource); }} />
            )}
            {filterSource === 'voice-note' && (
              <FilterChip label="🎙️ Notas pessoais"
                onRemove={() => { setFilterSource(''); setOffset(0); load(search, 0, filterTag, filterLang, filterContact, dateFrom, dateTo, sortOrder, ''); }} />
            )}
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs text-brand-muted hover:text-brand-text transition-colors px-1 py-0.5">
              Limpar tudo
            </button>
          </div>
        )}
      </form>

      {/* ── TRANSCRIPTION LIST ───────────────────────────────────────────── */}
      <div className="card overflow-hidden">

        {loading ? (
          /* Loading skeleton */
          <div className="divide-y divide-brand-border/30">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3 px-4 sm:px-5 py-4 animate-pulse">
                <div className="w-10 h-10 rounded-full bg-brand-border/40 flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="flex gap-2">
                    <div className="h-3.5 bg-brand-border/40 rounded w-32" />
                    <div className="h-3.5 bg-brand-border/40 rounded w-16 ml-auto" />
                  </div>
                  <div className="h-3 bg-brand-border/30 rounded w-full" />
                  <div className="h-3 bg-brand-border/30 rounded w-3/4" />
                  <div className="flex gap-1.5">
                    <div className="h-4 bg-brand-border/30 rounded-full w-16" />
                    <div className="h-4 bg-brand-border/30 rounded-full w-20" />
                  </div>
                </div>
              </div>
            ))}
          </div>

        ) : items.length === 0 ? (
          /* Empty state */
          <div className="py-16 px-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-brand-elevated border border-brand-border flex items-center justify-center mx-auto mb-4">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-brand-muted">
                <path d="M12 2a3 3 0 013 3v7a3 3 0 01-6 0V5a3 3 0 013-3z"/>
                <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v3M8 22h8"/>
              </svg>
            </div>
            <p className="font-semibold text-brand-text mb-1">
              {hasFilters ? 'Nenhuma transcrição encontrada' : 'Nenhuma transcrição ainda'}
            </p>
            <p className="text-sm text-brand-muted mb-5">
              {hasFilters
                ? 'Tente ajustar os filtros ou limpar a busca.'
                : 'Envie um áudio do WhatsApp ou faça upload para começar.'
              }
            </p>
            {hasFilters ? (
              <button type="button" onClick={clearFilters} className="btn-ghost text-sm px-5 py-2.5">
                Limpar filtros
              </button>
            ) : (
              <button type="button" onClick={() => setShowUpload(true)} className="btn-primary text-sm px-6 py-2.5">
                🎙️ Enviar primeiro áudio
              </button>
            )}
          </div>

        ) : (
          /* Card list */
          <div className="divide-y divide-brand-border/30">
            {items.map(t => {
              const displayName = t.contactName || t.contactPhone;
              const preview = t.summaryBullets?.[0] || t.originalText;
              const numberLabel = t.number
                ? (t.number.displayName || t.number.phoneNumber)
                : 'Número removido';
              const showLang = !isPortuguese(t.language);

              return (
                <div
                  key={t.id}
                  className="group flex items-start gap-3 px-4 sm:px-5 py-4 hover:bg-brand-elevated/50 cursor-pointer transition-colors"
                  onClick={() => openDetail(t)}
                  role="button"
                  tabIndex={0}
                  aria-label={`Ver transcrição de ${displayName}`}
                  onKeyDown={e => { if (e.key === 'Enter') openDetail(t); }}>

                  {/* Avatar */}
                  <Avatar name={displayName} />

                  {/* Content */}
                  <div className="flex-1 min-w-0">

                    {/* Row 1: name + meta */}
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <span className="text-sm font-semibold text-brand-text truncate leading-snug">
                        {displayName}
                      </span>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className="text-xs text-brand-muted whitespace-nowrap">
                          {relTime(t.createdAt)}
                        </span>
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
                          style={{
                            background: 'rgba(var(--color-primary),.1)',
                            color: 'rgb(var(--color-primary))',
                            border: '1px solid rgba(var(--color-primary),.2)',
                          }}>
                          🎙 {fmtDur(t.durationSec)}
                        </span>
                      </div>
                    </div>

                    {/* Row 2: number / source */}
                    <span className="text-[10px] text-brand-muted truncate block mb-1.5">
                      {numberLabel}
                    </span>

                    {/* Row 3: preview — first summary bullet */}
                    <p className="text-xs text-brand-text-secondary leading-relaxed line-clamp-2">
                      {preview}
                    </p>

                    {/* Row 4: tags + language */}
                    {(t.tags?.length > 0 || showLang) && (
                      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        {t.tags?.map((tag, i) => (
                          <button
                            key={tag}
                            type="button"
                            onClick={e => {
                              e.stopPropagation();
                              setFilterTag(tag);
                              setOffset(0);
                              load(search, 0, tag, filterLang, filterContact, dateFrom, dateTo, sortOrder, filterSource);
                            }}
                            className={`text-[10px] font-medium px-2 py-0.5 rounded-full border transition-opacity hover:opacity-80 ${TAG_COLORS[i % TAG_COLORS.length]}`}
                            aria-label={`Filtrar por tag ${tag}`}>
                            {tag}
                          </button>
                        ))}
                        {showLang && (
                          <span
                            className="text-[10px] font-medium px-2 py-0.5 rounded-full border"
                            style={{
                              background: 'rgba(245,158,11,.1)',
                              color: '#d97706',
                              borderColor: 'rgba(245,158,11,.2)',
                            }}>
                            {LANG_FLAG[t.language]} {LANG_CODE[t.language] || t.language.toUpperCase()}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Delete — hover (desktop) / always small (mobile) */}
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); handleDelete(t.id); }}
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1.5 rounded-lg text-brand-muted hover:text-red-400 hover:bg-red-400/10 transition-all flex-shrink-0 mt-0.5"
                    aria-label={`Deletar transcrição de ${displayName}`}
                    title="Deletar">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── PAGINATION ──────────────────────────────────────────────────── */}
      {total > LIMIT && (
        <div className="flex items-center justify-center gap-3 mt-4">
          <button
            type="button"
            className="btn-ghost text-xs py-1.5 px-4 disabled:opacity-40"
            disabled={offset === 0}
            onClick={() => { const o = offset - LIMIT; setOffset(o); load(search, o, filterTag, filterLang, filterContact, dateFrom, dateTo, sortOrder, filterSource); }}>
            ← Anterior
          </button>
          <span className="text-xs text-brand-muted min-w-[80px] text-center">
            {currentPage} de {totalPages}
          </span>
          <button
            type="button"
            className="btn-ghost text-xs py-1.5 px-4 disabled:opacity-40"
            disabled={offset + LIMIT >= total}
            onClick={() => { const o = offset + LIMIT; setOffset(o); load(search, o, filterTag, filterLang, filterContact, dateFrom, dateTo, sortOrder, filterSource); }}>
            Próxima →
          </button>
        </div>
      )}

      {/* ── UPLOAD MODAL ────────────────────────────────────────────────── */}
      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onDone={() => { setOffset(0); load('', 0, '', '', '', '', '', 'date_desc', ''); }}
        />
      )}

      {/* ── DETAIL MODAL ────────────────────────────────────────────────── */}
      {selected && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={closeDetail}
          role="dialog"
          aria-modal="true"
          aria-label={`Detalhe da transcrição de ${selected.contactName || selected.contactPhone}`}>

          <div
            className="bg-brand-surface w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-2xl flex flex-col"
            style={{ maxHeight: 'min(92vh, 680px)' }}
            onClick={e => e.stopPropagation()}>

            {/* ── Modal Header ──────────────────────────────────────────── */}
            <div className="flex-shrink-0 px-5 pt-5 pb-0">
              {/* Drag handle — mobile */}
              <div className="w-10 h-1 bg-brand-border rounded-full mx-auto mb-4 sm:hidden" aria-hidden />

              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <Avatar name={selected.contactName || selected.contactPhone} />
                  <div className="min-w-0">
                    <div className="font-bold text-brand-text truncate leading-tight">
                      {selected.contactName || selected.contactPhone}
                    </div>
                    <div className="flex items-center flex-wrap gap-x-1.5 gap-y-0.5 mt-0.5">
                      <span className="text-[11px] text-brand-muted truncate">
                        {selected.number
                          ? (selected.number.displayName || selected.number.phoneNumber)
                          : 'Número removido'}
                      </span>
                      <span className="text-brand-border text-[10px]">·</span>
                      <span className="text-[11px] text-brand-muted whitespace-nowrap">
                        {new Date(selected.createdAt).toLocaleString('pt-BR', {
                          day: '2-digit', month: '2-digit', year: '2-digit',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </span>
                      <span className="text-brand-border text-[10px]">·</span>
                      <span className="text-[11px] text-brand-muted">{fmtDur(selected.durationSec)}</span>
                      {!isPortuguese(selected.language) && (
                        <span
                          className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                          style={{ background: 'rgba(245,158,11,.1)', color: '#d97706', border: '1px solid rgba(245,158,11,.2)' }}>
                          {LANG_FLAG[selected.language]} {LANG_CODE[selected.language] || selected.language.toUpperCase()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={closeDetail}
                  className="flex-shrink-0 p-1.5 rounded-xl text-brand-muted hover:text-brand-text hover:bg-brand-elevated transition-colors"
                  aria-label="Fechar">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12"/>
                  </svg>
                </button>
              </div>

              {/* ── Tab Bar ─────────────────────────────────────────────── */}
              <div className="flex mt-4 -mx-5 px-5 border-b border-brand-border/50 overflow-x-auto no-scrollbar" role="tablist">
                {([
                  ['resumo',   '✨ Resumo'],
                  ['original', '📝 Texto'],
                  ['ia',       '🤖 IA'],
                  ['exportar', '📤 Exportar'],
                ] as [ModalTab, string][]).map(([tab, label]) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab}
                    onClick={() => setActiveTab(tab)}
                    className={`relative px-4 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors flex items-center gap-1 ${
                      activeTab === tab
                        ? 'border-brand-primary text-brand-primary'
                        : 'border-transparent text-brand-muted hover:text-brand-text'
                    }`}>
                    {label}
                    {tab === 'ia' && !canAiFeat && (
                      <span
                        className="text-[9px] font-bold px-1 py-0.5 rounded leading-none"
                        style={{ background: 'rgba(13,150,104,.12)', color: 'rgb(var(--color-primary))' }}>
                        Pro+
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Tab Content (scrollable) ─────────────────────────────── */}
            <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0" role="tabpanel">

              {/* ── TAB: RESUMO ─────────────────────────────────────────── */}
              {activeTab === 'resumo' && (
                <div className="space-y-4">

                  {/* Summary bullets */}
                  {selected.summaryBullets.length > 0 ? (
                    <div className="space-y-0.5">
                      {selected.summaryBullets.map((b, i) => (
                        <div
                          key={i}
                          className="flex gap-3 py-2.5 border-b border-brand-border/25 last:border-0">
                          <div
                            className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-[7px]"
                            style={{ background: 'rgb(var(--color-primary))' }}
                            aria-hidden />
                          <p className="text-sm text-brand-text leading-relaxed">{b}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-brand-muted italic py-2">Sem resumo disponível.</p>
                  )}

                  {/* Tags section */}
                  <div className={`pt-2 ${!canTags ? 'opacity-60' : ''}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold text-brand-text-secondary uppercase tracking-widest">
                        🏷️ Tags
                      </span>
                      {!canTags && (
                        <span
                          className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                          style={{ background: 'rgba(13,150,104,.12)', color: 'rgb(var(--color-primary))' }}>
                          Pro+
                        </span>
                      )}
                    </div>
                    {canTags ? (
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <TagInput tags={editTags} onChange={setEditTags} />
                        </div>
                        {tagsChanged && (
                          <button
                            type="button"
                            onClick={saveTags}
                            disabled={savingTags}
                            className="btn-primary text-xs px-3 py-2 flex-shrink-0 disabled:opacity-50">
                            {savingTags ? '…' : 'Salvar'}
                          </button>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-brand-muted">
                        Organização por tags disponível no plano{' '}
                        <a href="/dashboard/plano" className="text-brand-primary hover:underline font-medium">Pro ou superior</a>.
                      </p>
                    )}
                    {canTags && (
                      <p className="text-[10px] text-brand-muted mt-1.5">
                        Pressione Enter ou vírgula para adicionar · Máximo 5 tags
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* ── TAB: ORIGINAL TEXT ──────────────────────────────────── */}
              {activeTab === 'original' && (
                <div>
                  <div className="bg-brand-elevated rounded-xl px-4 py-4 mb-3">
                    <p className="text-sm text-brand-text-secondary leading-relaxed whitespace-pre-wrap">
                      &ldquo;{selected.originalText}&rdquo;
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyText(selected.originalText)}
                    className="btn-ghost text-xs py-2 px-4 flex items-center gap-1.5">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                    </svg>
                    {copied ? '✓ Copiado!' : 'Copiar texto'}
                  </button>
                </div>
              )}

              {/* ── TAB: IA ─────────────────────────────────────────────── */}
              {activeTab === 'ia' && (
                canAiFeat ? (
                  <div className="space-y-5">

                    {/* Suggested replies */}
                    <div>
                      <div className="text-[10px] font-bold text-brand-text-secondary uppercase tracking-widest mb-3">
                        💬 Resposta Sugerida
                      </div>
                      {suggestedReplies ? (
                        <div className="space-y-2">
                          {suggestedReplies.map((r, i) => (
                            <div
                              key={i}
                              className="flex items-start gap-3 bg-brand-elevated rounded-xl px-3.5 py-3">
                              <p className="text-xs text-brand-text leading-relaxed flex-1">{r}</p>
                              <button
                                type="button"
                                onClick={() => navigator.clipboard.writeText(r)}
                                className="text-brand-muted hover:text-brand-primary transition-colors flex-shrink-0 p-0.5"
                                title="Copiar sugestão">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                                </svg>
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() => loadSuggestedReplies(selected)}
                            className="text-xs text-brand-muted hover:text-brand-primary transition-colors flex items-center gap-1">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
                              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
                            </svg>
                            Gerar novamente
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => loadSuggestedReplies(selected)}
                          disabled={loadingReplies}
                          className="btn-ghost text-xs py-3 w-full justify-center gap-2 flex items-center">
                          {loadingReplies ? (
                            <>
                              <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                              </svg>
                              Gerando sugestões…
                            </>
                          ) : '✨ Sugerir respostas'}
                        </button>
                      )}
                    </div>

                    {/* Divider */}
                    <div className="border-t border-brand-border/40" />

                    {/* Generate document */}
                    <div>
                      <div className="text-[10px] font-bold text-brand-text-secondary uppercase tracking-widest mb-3">
                        📝 Gerar Documento
                      </div>
                      {generatedDoc ? (
                        <div className="space-y-2.5">
                          <div className="bg-brand-elevated rounded-xl px-4 py-3 max-h-40 overflow-y-auto">
                            <p className="text-xs text-brand-text whitespace-pre-wrap leading-relaxed">
                              {generatedDoc.content}
                            </p>
                          </div>
                          <div className="flex gap-2 flex-wrap">
                            <button
                              type="button"
                              onClick={() => downloadGeneratedDoc(selected)}
                              className="btn-ghost text-xs py-1.5 px-3 flex items-center gap-1.5">
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                                <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                              </svg>
                              Baixar .docx
                            </button>
                            <button
                              type="button"
                              onClick={() => navigator.clipboard.writeText(generatedDoc.content)}
                              className="btn-ghost text-xs py-1.5 px-3 flex items-center gap-1.5">
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                              </svg>
                              Copiar
                            </button>
                            <button
                              type="button"
                              onClick={() => setGeneratedDoc(null)}
                              className="text-xs text-brand-muted hover:text-brand-primary py-1.5 px-2 transition-colors">
                              ← Novo
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <select
                            value={docType}
                            onChange={e => setDocType(e.target.value)}
                            className="input text-xs py-2 flex-1">
                            {DOC_TYPES.map(d => (
                              <option key={d.value} value={d.value}>{d.label}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => generateDocument(selected, docType)}
                            disabled={loadingDoc}
                            className="btn-primary text-xs py-2 px-4 flex-shrink-0 disabled:opacity-50 flex items-center gap-1.5">
                            {loadingDoc ? (
                              <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                              </svg>
                            ) : null}
                            {loadingDoc ? 'Gerando…' : 'Gerar'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                ) : (
                  /* IA upsell */
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <div
                      className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 text-2xl"
                      style={{ background: 'rgba(13,150,104,.1)', border: '1px solid rgba(13,150,104,.2)' }}>
                      🤖
                    </div>
                    <p className="font-semibold text-brand-text mb-1">Recursos de Inteligência Artificial</p>
                    <p className="text-sm text-brand-muted mb-5 max-w-xs">
                      Gere respostas sugeridas, atas de reunião, e-mails profissionais e muito mais com IA.
                      Disponível no plano Pro.
                    </p>
                    <a href="/dashboard/plano" className="btn-primary text-sm px-6 py-2.5 inline-block">
                      Ver planos →
                    </a>
                  </div>
                )
              )}

              {/* ── TAB: EXPORTAR ───────────────────────────────────────── */}
              {activeTab === 'exportar' && (
                <div>
                  <p className="text-xs text-brand-muted mb-4">
                    Exporte esta transcrição individualmente no formato desejado.
                  </p>
                  <div className="grid grid-cols-2 gap-2.5">
                    {[
                      {
                        label: 'PDF',
                        desc: 'Para visualizar e imprimir',
                        emoji: '📄',
                        fn: () => exportSinglePdf(selected),
                      },
                      {
                        label: 'Word (.docx)',
                        desc: 'Para editar no Word',
                        emoji: '📝',
                        fn: () => exportSingleDocx(selected),
                      },
                      {
                        label: 'Excel (.xls)',
                        desc: 'Para planilha de dados',
                        emoji: '📊',
                        fn: () => exportSingleXls(selected),
                      },
                      {
                        label: 'CSV',
                        desc: 'Para importar em sistemas',
                        emoji: '📋',
                        fn: () => exportSingleCsv(selected),
                      },
                    ].map(({ label, desc, emoji, fn }) => (
                      <button
                        key={label}
                        type="button"
                        onClick={fn}
                        className="flex items-start gap-3 px-4 py-3.5 rounded-xl border border-brand-border hover:border-brand-primary hover:bg-brand-primary/5 transition-all text-left group/btn">
                        <span className="text-2xl leading-none flex-shrink-0">{emoji}</span>
                        <div>
                          <div className="text-sm font-semibold text-brand-text group-hover/btn:text-brand-primary transition-colors">
                            {label}
                          </div>
                          <div className="text-[10px] text-brand-muted mt-0.5">{desc}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ── Modal Footer — sticky actions ────────────────────────── */}
            <div className="flex-shrink-0 px-5 py-3 border-t border-brand-border/50 flex gap-2 bg-brand-surface">
              <button
                type="button"
                onClick={() => copyText(
                  selected.summaryBullets.length > 0
                    ? selected.summaryBullets.map(b => `• ${b}`).join('\n') + '\n\n' + selected.originalText
                    : selected.originalText
                )}
                className="btn-ghost flex-1 text-xs py-2.5 flex items-center justify-center gap-1.5">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                </svg>
                {copied ? '✓ Copiado!' : 'Copiar resumo'}
              </button>
              <button
                type="button"
                onClick={() => handleDelete(selected.id)}
                className="text-xs py-2.5 px-4 rounded-xl border border-red-400/20 text-red-400 hover:bg-red-400/8 transition-colors flex items-center gap-1.5">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>
                </svg>
                Deletar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── NPS MODAL ───────────────────────────────────────────────────── */}
      {npsVisible && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end md:items-center justify-center p-4">
          <div className="w-full max-w-sm bg-[#0d1c19] border border-[rgba(16,185,129,.15)] rounded-2xl p-6 shadow-2xl">
            {npsDone ? (
              <div className="text-center py-4">
                <div className="text-4xl mb-3">🙏</div>
                <div className="font-bold text-[#d1fae5] text-lg">Obrigado!</div>
                <div className="text-xs text-[rgba(16,185,129,.5)] mt-1">Seu feedback é muito importante para nós.</div>
              </div>
            ) : (
              <>
                <div className="text-center mb-5">
                  <div className="text-3xl mb-2">⭐</div>
                  <div className="font-bold text-[#d1fae5] text-base">
                    O quanto você recomendaria o ZapScript?
                  </div>
                  <div className="text-xs text-[rgba(16,185,129,.4)] mt-1">De 0 (nada) a 10 (com certeza)</div>
                </div>
                <div className="flex justify-between gap-1 mb-4">
                  {Array.from({ length: 11 }, (_, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setNpsScore(i)}
                      className={`flex-1 aspect-square text-xs font-bold rounded-lg transition-all ${
                        npsScore === i
                          ? 'bg-[#10b981] text-[#011a12] scale-110'
                          : 'bg-[#132621] border border-[rgba(16,185,129,.15)] text-[rgba(16,185,129,.6)] hover:border-[rgba(16,185,129,.4)]'
                      }`}>
                      {i}
                    </button>
                  ))}
                </div>
                {npsScore != null && (
                  <textarea
                    value={npsComment}
                    onChange={e => setNpsComment(e.target.value)}
                    placeholder="Deixe um comentário (opcional)…"
                    rows={2}
                    maxLength={500}
                    className="w-full bg-[#132621] border border-[rgba(16,185,129,.12)] rounded-xl px-3 py-2 text-sm text-[#d1fae5] placeholder-[rgba(16,185,129,.3)] outline-none focus:border-[rgba(16,185,129,.3)] resize-none mb-3"
                  />
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setNpsVisible(false)}
                    className="flex-1 py-2.5 rounded-xl text-sm border border-[rgba(16,185,129,.1)] text-[rgba(16,185,129,.4)] hover:text-[rgba(16,185,129,.7)] transition-colors">
                    Agora não
                  </button>
                  <button
                    type="button"
                    onClick={submitNps}
                    disabled={npsScore == null || npsSubmitting}
                    className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-[#10b981] text-[#011a12] hover:bg-[#34d399] disabled:opacity-40 transition-colors">
                    {npsSubmitting ? '…' : 'Enviar'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
