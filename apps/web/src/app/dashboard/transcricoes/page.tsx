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
  source: string;  // 'whatsapp-evolution' | 'manual' | 'whatsapp-meta' | etc.
  filename: string | null;  // nome original do arquivo (apenas uploads manuais)
  number: { displayName: string | null; phoneNumber: string } | null;
}

/* ─── Resumo estruturado (sentinels do worker) ──────────────────────────────
 * O worker codifica seções e pendências dentro do array de bullets:
 *   "::H::Decisões" → cabeçalho de seção
 *   "::P::texto"    → pendência/pergunta destacada
 * Helpers abaixo convertem para exibição. */
const B_HEADER  = '::H::';
const B_PENDING = '::P::';
function bulletKind(b: string): 'header' | 'pending' | 'item' {
  if (b.startsWith(B_HEADER))  return 'header';
  if (b.startsWith(B_PENDING)) return 'pending';
  return 'item';
}
/** Texto legível de um bullet (sem sentinels) — exportações, cópia, preview. */
function bulletText(b: string): string {
  if (b.startsWith(B_HEADER))  return b.slice(B_HEADER.length);
  if (b.startsWith(B_PENDING)) return '⚠️ ' + b.slice(B_PENDING.length);
  return b;
}

/* ─── Agenda (.ics) a partir da pendência ───────────────────────────────────
 * A ação/pendência (sentinel ::P::) vira um evento de calendário. Não há data
 * estruturada garantida, então fazemos uma inferência leve do prazo a partir do
 * próprio texto (hoje/amanhã/dia da semana + hora); default = amanhã 09h.
 * Horário "flutuante" (sem TZID/Z) → o calendário do usuário interpreta na TZ
 * local. É o caminho MVP: o usuário ajusta a data no próprio calendário. */
const WEEKDAYS_PT: Record<string, number> = {
  domingo: 0, segunda: 1, terca: 2, terça: 2, quarta: 3,
  quinta: 4, sexta: 5, sabado: 6, sábado: 6,
};

function inferDeadline(text: string, base = new Date()): Date {
  const t = text.toLowerCase();
  const d = new Date(base);
  d.setSeconds(0, 0);

  // Dia
  if (/\bhoje\b/.test(t)) {
    // mantém o dia
  } else if (/\bamanh[ãa]\b/.test(t)) {
    d.setDate(d.getDate() + 1);
  } else {
    const wd = Object.keys(WEEKDAYS_PT).find(k => t.includes(k));
    if (wd) {
      const target = WEEKDAYS_PT[wd];
      let delta = (target - d.getDay() + 7) % 7;
      if (delta === 0) delta = 7; // próxima ocorrência, não hoje
      d.setDate(d.getDate() + delta);
    } else {
      d.setDate(d.getDate() + 1); // default: amanhã
    }
  }

  // Hora — "15h", "15h30", "15:00", "às 9"
  const hm = t.match(/(\d{1,2})\s*(?:h|:)\s*(\d{2})?/) || t.match(/[àa]s?\s+(\d{1,2})\b/);
  if (hm) {
    const h = Math.min(23, parseInt(hm[1], 10));
    const m = hm[2] ? Math.min(59, parseInt(hm[2], 10)) : 0;
    d.setHours(h, m, 0, 0);
  } else {
    d.setHours(9, 0, 0, 0); // default: 09h
  }
  return d;
}

/** Formata Date como horário local flutuante YYYYMMDDTHHMMSS (sem Z). */
function icsLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`;
}

/** Escapa texto conforme RFC 5545 (vírgula, ponto-e-vírgula, barra, quebra). */
function icsEscape(s: string): string {
  return (s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

/** Monta um VCALENDAR mínimo com 1 evento + alarme 30min antes. */
function buildIcs(summary: string, start: Date, description: string): string {
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const uid = `zs-${start.getTime()}-${Math.random().toString(36).slice(2, 8)}@zapscript.me`;
  const stamp = icsLocal(new Date());
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ZapScript//Agenda//PT-BR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${icsLocal(start)}`,
    `DTEND:${icsLocal(end)}`,
    `SUMMARY:${icsEscape(summary)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT30M',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsEscape(summary)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

/** Rótulo humano do prazo inferido, ex.: "sex, 11 jul, 09:00". */
function fmtDueLabel(d: Date): string {
  return d.toLocaleString('pt-BR', {
    weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  }).replace('.', '');
}

/** Deep-link do Google Agenda para criar o evento direto no navegador. */
function buildGCalUrl(title: string, start: Date, details: string): string {
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${icsLocal(start)}/${icsLocal(end)}`,
    details,
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

/* ─── Constants ───────────────────────────────────────────────────────────── */
const LIMIT       = 20;

const SORT_OPTIONS = [
  { value: 'date_desc',    label: 'Data — Mais recente', icon: '📅' },
  { value: 'date_asc',     label: 'Data — Mais antiga',  icon: '📅' },
  { value: 'contact',      label: 'Contato A → Z',       icon: '👤' },
  { value: 'contact_desc', label: 'Contato Z → A',       icon: '👤' },
] as const;

const SORT_LABELS: Record<string, string> = {
  date_desc:    'Data — Recente',
  date_asc:     'Data — Antiga',
  contact:      'Contato A → Z',
  contact_desc: 'Contato Z → A',
};

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

type ModalTab = 'resumo' | 'original' | 'exportar';

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

/* ─── FilterDrawer ─────────────────────────────────────────────────────────── */
function FilterDrawer({
  onClose,
  filterContact, setFilterContact,
  filterLang, setFilterLang,
  dateFrom, setDateFrom,
  dateTo, setDateTo,
  onApply, onClear,
}: {
  onClose: () => void;
  filterContact: string; setFilterContact: (v: string) => void;
  filterLang: string;   setFilterLang:    (v: string) => void;
  dateFrom: string;     setDateFrom:      (v: string) => void;
  dateTo: string;       setDateTo:        (v: string) => void;
  onApply: () => void;  onClear:          () => void;
}) {
  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" onClick={onClose} />

      {/* Drawer: bottom sheet (mobile) / side panel (desktop) */}
      <div
        className="fixed bottom-0 inset-x-0 sm:inset-x-auto sm:right-0 sm:top-0 sm:bottom-0 sm:w-80 z-50 flex flex-col rounded-t-2xl sm:rounded-none shadow-2xl"
        style={{ background: 'rgb(var(--color-surface-elevated))', borderLeft: '1px solid rgb(var(--color-border))' }}>

        {/* Drag handle — mobile only */}
        <div className="w-10 h-1 rounded-full mx-auto mt-3 mb-1 sm:hidden" style={{ background: 'rgb(var(--color-border))' }} />

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'rgb(var(--color-border))' }}>
          <span className="font-semibold text-sm" style={{ color: 'rgb(var(--color-text))' }}>⚙️ Filtros</span>
          <button type="button" onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-xs transition-colors"
            style={{ color: 'rgb(var(--color-text-muted))' }}
            aria-label="Fechar filtros">✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* Contato */}
          <div>
            <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest mb-2"
              style={{ color: 'rgb(var(--color-text-muted))' }}>
              👤 Contato
            </label>
            <input
              className="input w-full text-sm"
              placeholder="Nome ou telefone..."
              value={filterContact}
              onChange={e => setFilterContact(e.target.value)}
            />
          </div>

          {/* Período */}
          <div>
            <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest mb-2"
              style={{ color: 'rgb(var(--color-text-muted))' }}>
              📅 Período
            </label>
            <div className="grid grid-cols-2 gap-2">
              <div className="relative">
                <input type="date"
                  className="input w-full text-sm"
                  value={dateFrom}
                  onChange={e => setDateFrom(e.target.value)}
                  aria-label="De" />
                {!dateFrom && (
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs pointer-events-none"
                    style={{ color: 'rgb(var(--color-text-muted))' }}>De</span>
                )}
              </div>
              <div className="relative">
                <input type="date"
                  className="input w-full text-sm"
                  value={dateTo}
                  onChange={e => setDateTo(e.target.value)}
                  aria-label="Até" />
                {!dateTo && (
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs pointer-events-none"
                    style={{ color: 'rgb(var(--color-text-muted))' }}>Até</span>
                )}
              </div>
            </div>
          </div>

          {/* Idioma */}
          <div>
            <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest mb-2"
              style={{ color: 'rgb(var(--color-text-muted))' }}>
              🌐 Idioma
            </label>
            <select
              className="input w-full text-sm"
              value={filterLang}
              onChange={e => setFilterLang(e.target.value)}>
              <option value="">Todos os idiomas</option>
              <option value="pt">🇧🇷 Português</option>
              <option value="en">🇺🇸 English</option>
              <option value="es">🇪🇸 Español</option>
              <option value="fr">🇫🇷 Français</option>
              <option value="de">🇩🇪 Deutsch</option>
            </select>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 p-4 border-t" style={{ borderColor: 'rgb(var(--color-border))' }}>
          <button type="button" onClick={onClear}
            className="flex-1 text-sm py-2.5 rounded-xl border transition-colors"
            style={{ borderColor: 'rgb(var(--color-border))', color: 'rgb(var(--color-text-muted))' }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#f87171'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'rgb(var(--color-text-muted))'; }}>
            🗑️ Limpar
          </button>
          <button type="button"
            onClick={() => { onApply(); onClose(); }}
            className="flex-1 btn-primary text-sm py-2.5">
            ✓ Aplicar filtros
          </button>
        </div>
      </div>
    </>
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
  const [filterSource, setFilterSource]     = useState('whatsapp-evolution');

  /* — Page UI state — */
  const [showFilterDrawer, setShowFilterDrawer]   = useState(false);
  const [showSortMenu, setShowSortMenu]           = useState(false);

  /* — Detail modal state — */
  const [selected, setSelected]             = useState<Transcription | null>(null);
  const [activeTab, setActiveTab]           = useState<ModalTab>('resumo');
  const [copied, setCopied]                 = useState(false);

  /* — Export — */
  const [exporting, setExporting]                 = useState(false);
  const [showExportMenu, setShowExportMenu]       = useState(false);

  /* — Failed queue — */
  const [failedCount, setFailedCount]       = useState(0);
  const [clearingFailed, setClearingFailed] = useState(false);

  /* — Toast (feedback rápido, ex.: .ics baixado) — */
  const [toast, setToast]                   = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }

  /* — NPS — */
  const [npsVisible, setNpsVisible]         = useState(false);
  const [npsScore, setNpsScore]             = useState<number | null>(null);
  const [npsComment, setNpsComment]         = useState('');
  const [npsSubmitting, setNpsSubmitting]   = useState(false);
  const [npsDone, setNpsDone]               = useState(false);

  /* ── Boot ──────────────────────────────────────────────────────────────── */
  useEffect(() => {
    api.get<{ failed: number; waiting: number; active: number }>('/transcriptions/queue/status')
      .then(s => setFailedCount(s.failed || 0))
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

  // Carrega com source da tab ativa (whatsapp-evolution por padrão)
  useEffect(() => { load('', 0, '', '', '', '', '', 'date_desc', 'whatsapp-evolution'); }, []); // eslint-disable-line

  /* ── Handlers ──────────────────────────────────────────────────────────── */
  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setOffset(0);
    load(search, 0, filterTag, filterLang, filterContact, dateFrom, dateTo, sortOrder, filterSource);
  }

  function clearFilters() {
    setSearch(''); setFilterTag(''); setFilterLang(''); setFilterContact('');
    setDateFrom(''); setDateTo(''); setSortOrder('date_desc'); setFilterSource('whatsapp-evolution');
    setOffset(0);
    load('', 0, '', '', '', '', '', 'date_desc', 'whatsapp-evolution');
  }

  // Limpa filtros ativos mantendo tab e ordenação atuais
  function clearActiveFilters() {
    setSearch(''); setFilterTag(''); setFilterLang(''); setFilterContact('');
    setDateFrom(''); setDateTo('');
    setOffset(0);
    load('', 0, '', '', '', '', '', sortOrder, filterSource);
  }

  function openDetail(t: Transcription) {
    setSelected(t);
    setActiveTab('resumo');
  }

  function closeDetail() { setSelected(null); }

  function copyText(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleDelete(id: string) {
    if (!confirm('Deletar esta conversão?')) return;
    await api.delete(`/transcriptions/${id}`);
    setItems(i => i.filter(t => t.id !== id));
    setTotal(t => t - 1);
    if (selected?.id === id) setSelected(null);
  }

  async function handleExport(format: 'csv' | 'xls' | 'pdf' | 'docx' = 'csv') {
    setExporting(true);
    setShowExportMenu(false);
    try {
      const month = new Date().toISOString().slice(0, 7);
      const token = typeof window !== 'undefined' ? localStorage.getItem('zs_token') : null;
      const base  = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const url   = `${base}/transcriptions/export?format=${format}&month=${month}`;

      // PDF: abrir em nova aba (o HTML já tem botão de imprimir/salvar)
      if (format === 'pdf') {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) { alert('Erro ao exportar. Verifique seu plano.'); return; }
        const html = await res.text();
        const w = window.open('', '_blank');
        if (w) { w.document.write(html); w.document.close(); }
        return;
      }

      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { alert('Erro ao exportar. Verifique seu plano.'); return; }
      const blob = await res.blob();
      const ext  = { csv: 'csv', xls: 'xls', docx: 'docx', pdf: 'pdf' }[format] || format;
      const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob),
        download: `transcricoes-${month}.${ext}`,
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
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Conversão</title>
<style>body{font-family:Arial,sans-serif;font-size:12px;margin:2cm;color:#111}h1{font-size:18px;color:#0d9668}h2{font-size:13px;color:#0d9668;border-bottom:1px solid #ddd;padding-bottom:4px}p{line-height:1.6}li{margin:4px 0}@media print{body{margin:1.5cm}}</style>
</head><body>
<h1>📝 ${t.contactName || t.contactPhone}</h1>
<p><b>Data:</b> ${date} &nbsp;|&nbsp; <b>Duração:</b> ${fmtDur(t.durationSec)} &nbsp;|&nbsp; <b>Idioma:</b> ${t.language.toUpperCase()}</p>
${t.tags?.length ? `<p><b>Tags:</b> ${t.tags.join(', ')}</p>` : ''}
<h2>✨ Resumo</h2><ul>${t.summaryBullets.map(b => `<li>${bulletText(b)}</li>`).join('')}</ul>
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
<h2>✨ Resumo</h2><ul>${t.summaryBullets.map(b => `<li>${esc(bulletText(b))}</li>`).join('')}</ul>
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
      esc(t.summaryBullets.map(bulletText).join(' | ')),
    ].join(',');
    const blob = new Blob(['﻿' + header + '\n' + row], { type: 'text/csv;charset=utf-8' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `transcricao-${t.id.slice(0, 8)}.csv` });
    a.click(); URL.revokeObjectURL(a.href);
  }

  function exportSingleXls(t: Transcription) {
    const c = (v: string) => `<td>${(v || '').replace(/</g, '&lt;')}</td>`;
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"/></head><body><table>
<tr><th>Data</th><th>Contato</th><th>Telefone</th><th>Duração</th><th>Idioma</th><th>Tags</th><th>Texto</th><th>Resumo</th></tr>
<tr>${c(new Date(t.createdAt).toLocaleString('pt-BR'))}${c(t.contactName||'')}${c(t.contactPhone)}${c(fmtDur(t.durationSec))}${c(t.language)}${c((t.tags||[]).join(', '))}${c(t.originalText)}${c(t.summaryBullets.map(bulletText).join(' | '))}</tr>
</table></body></html>`;
    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `transcricao-${t.id.slice(0, 8)}.xls` });
    a.click(); URL.revokeObjectURL(a.href);
  }

  /** Gera e baixa um .ics de agenda a partir de uma pendência (::P::). */
  function exportPendingIcs(t: Transcription, pendingText: string) {
    const who   = t.contactName || t.contactPhone || 'contato';
    const start = inferDeadline(pendingText, new Date(t.createdAt));
    const desc  = `Pendência do áudio de ${who} — gerado pelo ZapScript. Ajuste a data/hora se necessário.`;
    const ics   = buildIcs(pendingText, start, desc);
    const blob  = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `lembrete-${t.id.slice(0, 8)}.ics`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('📅 Lembrete baixado — abra o arquivo para adicioná-lo à sua agenda');
  }

  /* ── Laudo Jurídico — Upload Manual ──────────────────────────────────── */

  async function openJuridicalPdf(t: Transcription) {
    const token = typeof window !== 'undefined' ? localStorage.getItem('zs_token') : null;
    const base  = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    const url   = `${base}/transcriptions/${t.id}/juridical-pdf`;
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { alert('Laudo não disponível. Tente novamente.'); return; }
      const html = await res.text();
      const w = window.open('', '_blank');
      if (w) { w.document.write(html); w.document.close(); }
    } catch {
      alert('Erro ao gerar laudo. Verifique sua conexão.');
    }
  }

  async function downloadJuridicalAudio(t: Transcription) {
    const token = typeof window !== 'undefined' ? localStorage.getItem('zs_token') : null;
    const base  = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    const url   = `${base}/transcriptions/${t.id}/audio-download`;
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        redirect: 'follow',
      });
      if (!res.ok) {
        if (res.status === 404) {
          alert('Áudio não disponível para download.\n\nNota: o áudio MP3 só é salvo em conversões realizadas após a versão 2.4. Conversões antigas não possuem o arquivo.');
        } else {
          alert('Erro ao baixar áudio. Tente novamente.');
        }
        return;
      }
      // Redireciona para signed URL — browser faz o download
      const blob = await res.blob();
      const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob),
        download: `audio-${t.id.slice(0, 8)}.mp3`,
      });
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      alert('Erro ao baixar áudio. Verifique sua conexão.');
    }
  }

  async function openJuridicalPdfAndDownloadAudio(t: Transcription) {
    // Dispara ambos em paralelo — PDF abre em nova aba, áudio faz download
    await Promise.allSettled([openJuridicalPdf(t), downloadJuridicalAudio(t)]);
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
  // Histórico, filtros, busca e exportação liberados para todos os planos (Core incluso).
  const canExport       = true;
  const hasFilters      = !!(search || filterTag || filterLang || filterContact || dateFrom || dateTo || filterSource);
  const hasActiveFilters = !!(search || filterTag || filterLang || filterContact || dateFrom || dateTo);

  const totalPages = Math.ceil(total / LIMIT);
  const currentPage = Math.floor(offset / LIMIT) + 1;

  /* ─── Keyboard shortcut: Escape closes modal/menus ─────────────────────── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selected) closeDetail();
        setShowExportMenu(false);
        setShowSortMenu(false);
        setShowFilterDrawer(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  /* ─── Close export menu on outside click ──────────────────────────────── */
  useEffect(() => {
    if (!showExportMenu) return;
    const handler = () => setShowExportMenu(false);
    document.addEventListener('click', handler, { capture: true });
    return () => document.removeEventListener('click', handler, { capture: true });
  }, [showExportMenu]);

  /* ─── Close sort menu on outside click ────────────────────────────────── */
  useEffect(() => {
    if (!showSortMenu) return;
    const handler = () => setShowSortMenu(false);
    document.addEventListener('click', handler, { capture: true });
    return () => document.removeEventListener('click', handler, { capture: true });
  }, [showSortMenu]);

  /* ══════════════════════════════════════════════════════════════════════ */
  /*  RENDER                                                                */
  /* ══════════════════════════════════════════════════════════════════════ */
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl">

      {/* ── Toast (feedback rápido) ─────────────────────────────────────── */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[60] max-w-[90vw] px-4 py-2.5 rounded-xl bg-brand-text text-brand-bg text-xs font-medium shadow-xl">
          {toast}
        </div>
      )}

      {/* ── PAGE HEADER ─────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold" style={{ color: 'rgb(var(--color-text))' }}>Conversões</h1>
          <p className="text-sm mt-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>
            {loading ? 'Carregando…'
              : `${total.toLocaleString('pt-BR')} áudio${total !== 1 ? 's' : ''} do WhatsApp`}
          </p>
        </div>
      </div>

      {/* ── HERO SEARCH ─────────────────────────────────────────────────── */}
      <form onSubmit={handleSearch} className="mb-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <div className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'rgb(var(--color-text-muted))' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
            </div>
            <input
              className="input pr-4 py-3 w-full text-sm rounded-xl"
              style={{ paddingLeft: '2.5rem' }}
              placeholder="Buscar por contato, texto ou resumo…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              aria-label="Buscar conversões"
            />
          </div>
          <button type="submit"
            className="btn-primary px-5 text-sm disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0">
            Buscar
          </button>
        </div>
      </form>

      {/* ── FAILED QUEUE BANNER ─────────────────────────────────────────── */}
      {failedCount > 0 && (
        <div className="mb-4 flex items-center justify-between gap-3 px-4 py-3 rounded-xl"
          style={{ background: 'rgba(239,68,68,.06)', border: '1px solid rgba(239,68,68,.2)' }}>
          <div className="flex items-center gap-2.5">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgb(239,68,68)" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span className="text-xs" style={{ color: 'rgb(var(--color-text-muted))' }}>
              {failedCount} conversão{failedCount !== 1 ? 'ões' : ''} falharam na fila e não foram processadas.
            </span>
          </div>
          <button
            type="button"
            disabled={clearingFailed}
            onClick={async () => {
              setClearingFailed(true);
              try {
                await api.post('/transcriptions/queue/clear-failed', {});
                setFailedCount(0);
              } catch {
                // silencia
              } finally {
                setClearingFailed(false);
              }
            }}
            className="text-xs font-semibold flex-shrink-0 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            style={{ background: 'rgba(239,68,68,.15)', color: 'rgb(239,68,68)' }}>
            {clearingFailed ? 'Limpando…' : 'Limpar fila'}
          </button>
        </div>
      )}

      {/* ── ACTIONS ROW ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">

        {/* Filtrar */}
        <button
          type="button"
          onClick={() => setShowFilterDrawer(true)}
          className={`flex items-center gap-2 text-sm px-3.5 py-2 rounded-xl border transition-colors ${
            hasActiveFilters
              ? 'border-brand-primary bg-brand-primary/10 text-brand-primary'
              : ''
          }`}
          style={!hasActiveFilters ? { borderColor: 'rgb(var(--color-border))', color: 'rgb(var(--color-text-muted))' } : {}}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="4" y1="6" x2="20" y2="6"/>
            <line x1="8" y1="12" x2="16" y2="12"/>
            <line x1="11" y1="18" x2="13" y2="18"/>
          </svg>
          Filtrar
          {hasActiveFilters && <span className="w-2 h-2 rounded-full bg-brand-primary flex-shrink-0" />}
        </button>

        {/* Ordenar */}
        <div className="relative">
          <button
            type="button"
            onClick={e => { e.stopPropagation(); setShowSortMenu(v => !v); }}
            className="flex items-center gap-2 text-sm px-3.5 py-2 rounded-xl border transition-colors"
            style={{ borderColor: 'rgb(var(--color-border))', color: 'rgb(var(--color-text-muted))' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M7 12h10M11 18h2"/>
            </svg>
            <span className="hidden sm:inline">{SORT_LABELS[sortOrder] || 'Ordenar'}</span>
            <span className="sm:hidden">Ordenar</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          {showSortMenu && (
            <div className="absolute left-0 top-full mt-1 z-30 rounded-xl border shadow-xl overflow-hidden"
              style={{ background: 'rgb(var(--color-surface-elevated))', borderColor: 'rgb(var(--color-border))', minWidth: 200 }}>
              {SORT_OPTIONS.map(opt => (
                <button key={opt.value} type="button"
                  onClick={e => {
                    e.stopPropagation();
                    setSortOrder(opt.value);
                    setShowSortMenu(false);
                    setOffset(0);
                    load(search, 0, filterTag, filterLang, filterContact, dateFrom, dateTo, opt.value, filterSource);
                  }}
                  className="w-full text-left px-4 py-2.5 flex items-center gap-2.5 text-sm transition-colors hover:bg-brand-primary/8"
                  style={{ color: sortOrder === opt.value ? 'rgb(var(--color-primary))' : 'rgb(var(--color-text))' }}>
                  <span>{opt.icon}</span>
                  <span className={sortOrder === opt.value ? 'font-semibold' : ''}>{opt.label}</span>
                  {sortOrder === opt.value && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="ml-auto flex-shrink-0">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Exportar */}
        <div className="relative">
          <button
            type="button"
            onClick={e => { e.stopPropagation(); setShowExportMenu(v => !v); }}
            disabled={exporting}
            className="flex items-center gap-2 text-sm px-3.5 py-2 rounded-xl border transition-colors disabled:opacity-50"
            style={{ borderColor: 'rgb(var(--color-border))', color: 'rgb(var(--color-text-muted))' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            {exporting ? 'Exportando…' : 'Exportar'}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          {showExportMenu && (
            <div className="absolute left-0 top-full mt-1 z-30 rounded-xl border shadow-xl overflow-hidden"
              style={{ background: 'rgb(var(--color-surface-elevated))', borderColor: 'rgb(var(--color-border))', minWidth: 185 }}>
              {[
                { fmt: 'pdf',  icon: '📄', label: 'PDF',  sub: 'Imprimir / salvar' },
                { fmt: 'docx', icon: '📝', label: 'DOCX', sub: 'Word / LibreOffice' },
                { fmt: 'csv',  icon: '📊', label: 'CSV',  sub: 'Planilhas'         },
                { fmt: 'xls',  icon: '📗', label: 'XLS',  sub: 'Excel nativo'      },
              ].map(({ fmt, icon, label, sub }) => (
                <button key={fmt} type="button"
                  onClick={() => handleExport(fmt as any)}
                  className="w-full text-left px-4 py-2.5 hover:bg-brand-primary/8 transition-colors flex items-center gap-3">
                  <span className="text-base flex-shrink-0">{icon}</span>
                  <div>
                    <div className="text-sm font-medium" style={{ color: 'rgb(var(--color-text))' }}>{label}</div>
                    <div className="text-[10px]" style={{ color: 'rgb(var(--color-text-muted))' }}>{sub}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── ACTIVE FILTER CHIPS ─────────────────────────────────────────── */}
      {hasActiveFilters && (
        <div className="flex items-center gap-1.5 flex-wrap mb-4">
          {filterContact && (
            <FilterChip label={`👤 ${filterContact}`}
              onRemove={() => { setFilterContact(''); setOffset(0); load(search, 0, filterTag, filterLang, '', dateFrom, dateTo, sortOrder, filterSource); }} />
          )}
          {filterTag && (
            <FilterChip label={`🏷️ ${filterTag}`}
              onRemove={() => { setFilterTag(''); setOffset(0); load(search, 0, '', filterLang, filterContact, dateFrom, dateTo, sortOrder, filterSource); }} />
          )}
          {filterLang && (
            <FilterChip label={`${LANG_FLAG[filterLang] || '🌐'} ${LANG_CODE[filterLang] || filterLang.toUpperCase()}`}
              onRemove={() => { setFilterLang(''); setOffset(0); load(search, 0, filterTag, '', filterContact, dateFrom, dateTo, sortOrder, filterSource); }} />
          )}
          {(dateFrom || dateTo) && (
            <FilterChip label={`📅 ${dateFrom || '…'} → ${dateTo || '…'}`}
              onRemove={() => { setDateFrom(''); setDateTo(''); setOffset(0); load(search, 0, filterTag, filterLang, filterContact, '', '', sortOrder, filterSource); }} />
          )}
          <button type="button" onClick={clearActiveFilters}
            className="text-xs transition-colors px-1 py-0.5 hover:text-red-400"
            style={{ color: 'rgb(var(--color-text-muted))' }}>
            Limpar tudo
          </button>
        </div>
      )}

      {/* ── FILTER DRAWER ───────────────────────────────────────────────── */}
      {showFilterDrawer && (
        <FilterDrawer
          onClose={() => setShowFilterDrawer(false)}
          filterContact={filterContact} setFilterContact={setFilterContact}
          filterLang={filterLang}       setFilterLang={setFilterLang}
          dateFrom={dateFrom}           setDateFrom={setDateFrom}
          dateTo={dateTo}               setDateTo={setDateTo}
          onApply={() => { setOffset(0); load(search, 0, filterTag, filterLang, filterContact, dateFrom, dateTo, sortOrder, filterSource); setShowFilterDrawer(false); }}
          onClear={() => { clearActiveFilters(); setShowFilterDrawer(false); }}
        />
      )}

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
              {hasFilters
                ? 'Nenhuma conversão encontrada'
                : 'Nenhum áudio do WhatsApp ainda'}
            </p>
            <p className="text-sm text-brand-muted mb-5">
              {hasFilters
                ? 'Tente ajustar os filtros ou limpar a busca.'
                : 'Conecte um número e envie um áudio no WhatsApp para converter automaticamente.'}
            </p>
            {hasFilters ? (
              <button type="button" onClick={clearFilters} className="btn-ghost text-sm px-5 py-2.5">
                Limpar filtros
              </button>
            ) : (
              <a href="/dashboard/numeros" className="btn-primary text-sm px-6 py-2.5 inline-flex items-center gap-2">
                💬 Conectar número
              </a>
            )}
          </div>

        ) : (
          /* Card list */
          <div className="divide-y divide-brand-border/30">
            {items.map(t => {
              const isManual    = t.source === 'manual';
              const displayName = isManual
                ? (t.filename ? t.filename : 'Upload manual')
                : (t.contactName || t.contactPhone);
              const preview = (t.summaryBullets?.[0] ? bulletText(t.summaryBullets[0]) : '') || t.originalText;
              const numberLabel = isManual
                ? '📁 Upload manual'
                : (t.number ? (t.number.displayName || t.number.phoneNumber) : 'Número removido');
              const showLang = !isPortuguese(t.language);

              return (
                <div
                  key={t.id}
                  className="group flex items-start gap-3 px-4 sm:px-5 py-4 hover:bg-brand-elevated/50 cursor-pointer transition-colors"
                  onClick={() => openDetail(t)}
                  role="button"
                  tabIndex={0}
                  aria-label={`Ver conversão de ${displayName}`}
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
                            background: 'rgba(var(--color-primary)/.1)',
                            color: 'rgb(var(--color-primary))',
                            border: '1px solid rgba(var(--color-primary)/.2)',
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
                    aria-label={`Deletar conversão de ${displayName}`}
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

      {/* ── PAGINATION ───────────────────────────────────────────────────── */}
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

      {/* Upload manual de áudio desativado — função movida para app/site separado. */}

      {/* ── DETAIL MODAL ────────────────────────────────────────────────── */}
      {selected && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={closeDetail}
          role="dialog"
          aria-modal="true"
          aria-label={`Detalhe da conversão de ${selected.contactName || selected.contactPhone}`}>

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
                  <Avatar name={selected.source === 'manual' ? '📁' : (selected.contactName || selected.contactPhone)} />
                  <div className="min-w-0">
                    <div className="font-bold text-brand-text truncate leading-tight">
                      {selected.source === 'manual'
                        ? (selected.filename || 'Upload manual')
                        : (selected.contactName || selected.contactPhone)}
                    </div>
                    {/* Filename abaixo do nome para uploads manuais */}
                    {selected.source === 'manual' && selected.filename && (
                      <div className="text-[10px] font-mono mt-0.5 truncate"
                        style={{ color: 'rgba(var(--color-primary)/.7)' }}
                        title={selected.filename}>
                        📁 {selected.filename}
                      </div>
                    )}
                    <div className="flex items-center flex-wrap gap-x-1.5 gap-y-0.5 mt-0.5">
                      <span className="text-[11px] text-brand-muted truncate">
                        {selected.source === 'manual'
                          ? 'Upload manual'
                          : (selected.number
                            ? (selected.number.displayName || selected.number.phoneNumber)
                            : 'Número removido')}
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
                      {selected.summaryBullets.map((b, i) => {
                        const kind = bulletKind(b);
                        if (kind === 'header') {
                          return (
                            <p
                              key={i}
                              className="text-xs font-bold uppercase tracking-wide text-brand-text/70 pt-3 pb-1 first:pt-0">
                              {b.slice(B_HEADER.length)}
                            </p>
                          );
                        }
                        if (kind === 'pending') {
                          const pendingText = b.slice(B_PENDING.length);
                          const dueDate = inferDeadline(pendingText, new Date(selected.createdAt));
                          const who = selected.contactName || selected.contactPhone || 'contato';
                          const gcalUrl = buildGCalUrl(
                            pendingText, dueDate,
                            `Pendência do áudio de ${who} — gerado pelo ZapScript. Ajuste a data/hora se necessário.`,
                          );
                          return (
                            <div
                              key={i}
                              className="py-2.5 px-3 my-1 rounded-lg border border-amber-400/30 bg-amber-400/10">
                              <div className="flex items-start gap-2">
                                <span aria-hidden>⚠️</span>
                                <p className="text-sm font-medium text-brand-text leading-relaxed flex-1">
                                  {pendingText}
                                </p>
                              </div>
                              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mt-2 pl-6">
                                <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-300/90">
                                  🕑 Sugestão: <span className="font-semibold">{fmtDueLabel(dueDate)}</span>
                                </span>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => exportPendingIcs(selected, pendingText)}
                                    className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-md border border-amber-400/40 text-amber-700 dark:text-amber-300 hover:bg-amber-400/20 transition-colors whitespace-nowrap"
                                    title="Baixar lembrete (.ics) para qualquer agenda"
                                    aria-label="Baixar lembrete .ics">
                                    📅 Agendar (.ics)
                                  </button>
                                  <a
                                    href={gcalUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-md border border-amber-400/40 text-amber-700 dark:text-amber-300 hover:bg-amber-400/20 transition-colors whitespace-nowrap"
                                    title="Criar evento no Google Agenda"
                                    aria-label="Adicionar ao Google Agenda">
                                    📆 Google Agenda
                                  </a>
                                </div>
                              </div>
                            </div>
                          );
                        }
                        return (
                          <div
                            key={i}
                            className="flex gap-3 py-2.5 border-b border-brand-border/25 last:border-0">
                            <div
                              className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-[7px]"
                              style={{ background: 'rgb(var(--color-primary))' }}
                              aria-hidden />
                            <p className="text-sm text-brand-text leading-relaxed">{b}</p>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-brand-muted italic py-2">Sem resumo disponível.</p>
                  )}
                </div>
              )}

              {/* ── TAB: ORIGINAL TEXT ──────────────────────────────────── */}
              {activeTab === 'original' && (
                <div>
                  {/* Badge informativo para uploads manuais com marcação temporal */}
                  {selected.source === 'manual' && /\[\d{2}:\d{2}/.test(selected.originalText) && (
                    <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg"
                      style={{ background: 'rgba(10,92,62,.08)', border: '1px solid rgba(10,92,62,.15)' }}>
                      <span className="text-sm">⏱</span>
                      <p className="text-[11px]" style={{ color: 'rgb(var(--color-primary))' }}>
                        <strong>Conversão literal com marcação temporal</strong> — cada linha indica o instante [MM:SS] no áudio. Use a aba <strong>Exportar</strong> para gerar o PDF.
                      </p>
                    </div>
                  )}
                  <div className="bg-brand-elevated rounded-xl px-4 py-4 mb-3">
                    {selected.source === 'manual' && /\[\d{2}:\d{2}/.test(selected.originalText) ? (
                      /* Texto com timestamps destacados para uploads manuais */
                      <pre className="text-sm leading-relaxed whitespace-pre-wrap font-mono"
                        style={{ color: 'rgb(var(--color-text-secondary))' }}
                        dangerouslySetInnerHTML={{
                          __html: selected.originalText
                            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                            .replace(
                              /\[(\d{2}:\d{2}(?::\d{2})?)\]/g,
                              '<span style="color:rgb(var(--color-primary));font-weight:700;letter-spacing:.3px">[$1]</span>'
                            ),
                        }}
                      />
                    ) : (
                      <p className="text-sm text-brand-text-secondary leading-relaxed whitespace-pre-wrap">
                        &ldquo;{selected.originalText}&rdquo;
                      </p>
                    )}
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

              {/* ── TAB: EXPORTAR ───────────────────────────────────────── */}
              {activeTab === 'exportar' && selected && (
                <div className="py-4 space-y-5">

                  {/* ── Seção: Conversão Profissional (apenas upload manual) ── */}
                  {selected.source === 'manual' && (
                    <div>
                      {/* Header da seção */}
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-base">📋</span>
                        <div>
                          <p className="text-xs font-semibold text-brand-text">Conversão Profissional</p>
                          <p className="text-[10px] text-brand-muted leading-tight">
                            Formato literal com marcação temporal — protocolo rastreável
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        {/* Botão: PDF */}
                        <button
                          type="button"
                          onClick={() => openJuridicalPdf(selected)}
                          className="flex flex-col items-center gap-1.5 py-4 rounded-xl transition-colors"
                          style={{
                            border: '1px solid rgba(10,92,62,.3)',
                            background: 'rgba(10,92,62,.06)',
                          }}
                          onMouseEnter={e => {
                            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(10,92,62,.12)';
                          }}
                          onMouseLeave={e => {
                            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(10,92,62,.06)';
                          }}>
                          <span className="text-xl">📄</span>
                          <span className="text-sm font-semibold" style={{ color: 'rgb(var(--color-primary))' }}>PDF</span>
                          <span className="text-[10px] text-brand-muted">Com marcação temporal</span>
                        </button>

                        {/* Botão: Áudio + PDF */}
                        <button
                          type="button"
                          onClick={() => openJuridicalPdfAndDownloadAudio(selected)}
                          className="flex flex-col items-center gap-1.5 py-4 rounded-xl transition-colors"
                          style={{
                            border: '1px solid rgba(10,92,62,.3)',
                            background: 'rgba(10,92,62,.06)',
                          }}
                          onMouseEnter={e => {
                            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(10,92,62,.12)';
                          }}
                          onMouseLeave={e => {
                            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(10,92,62,.06)';
                          }}>
                          <span className="text-xl">🎵</span>
                          <span className="text-sm font-semibold" style={{ color: 'rgb(var(--color-primary))' }}>Áudio + PDF</span>
                          <span className="text-[10px] text-brand-muted">MP3 + conversão</span>
                        </button>
                      </div>

                      {/* Nota informativa */}
                      <div className="mt-2 px-3 py-2 rounded-lg"
                        style={{ background: 'rgba(10,92,62,.05)', border: '1px solid rgba(10,92,62,.12)' }}>
                        <p className="text-[10px] leading-relaxed" style={{ color: 'rgba(var(--color-primary)/.6)' }}>
                          O documento inclui: protocolo único, data/hora (horário de Brasília), tecnologia utilizada e conversão literal com marcação <strong>[MM:SS]</strong>. O áudio MP3 original fica armazenado separadamente.
                        </p>
                      </div>

                      {/* Separador antes dos exports padrão (Pro+) */}
                      {canExport && (
                        <div className="flex items-center gap-2 mt-5 mb-1">
                          <div className="flex-1 h-px" style={{ background: 'rgba(var(--color-border)/.4)' }} />
                          <span className="text-[10px] text-brand-muted">Outros formatos</span>
                          <div className="flex-1 h-px" style={{ background: 'rgba(var(--color-border)/.4)' }} />
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Seção: Exports padrão (todos os planos) ─────────────────────── */}
                  <div>
                    {selected.source !== 'manual' && (
                      <p className="text-xs text-brand-muted mb-4">Exportar esta conversão individualmente:</p>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { fn: () => exportSinglePdf(selected),  icon: '📄', label: 'PDF',  sub: 'Imprimir / salvar' },
                        { fn: () => exportSingleDocx(selected), icon: '📝', label: 'DOCX', sub: 'Word / LibreOffice' },
                        { fn: () => exportSingleCsv(selected),  icon: '📊', label: 'CSV',  sub: 'Planilhas, dados'  },
                        { fn: () => exportSingleXls(selected),  icon: '📗', label: 'XLS',  sub: 'Excel nativo'      },
                      ].map(({ fn, icon, label, sub }) => (
                        <button key={label} type="button" onClick={fn}
                          className="flex flex-col items-center gap-1.5 py-4 rounded-xl border border-brand-border/50 hover:border-brand-primary/40 hover:bg-brand-primary/5 transition-colors">
                          <span className="text-xl">{icon}</span>
                          <span className="text-sm font-semibold text-brand-text">{label}</span>
                          <span className="text-[10px] text-brand-muted">{sub}</span>
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] text-brand-muted mt-4 text-center">
                      Para exportar todas as conversões do mês, use o botão <b>Exportar</b> na lista.
                    </p>
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
                    ? selected.summaryBullets.map(b => bulletKind(b) === 'item' ? `• ${b}` : bulletText(b)).join('\n') + '\n\n' + selected.originalText
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
