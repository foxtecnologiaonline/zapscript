'use client';
/**
 * ZapScript Legendas — upload de vídeo → legenda .srt/.vtt via Whisper.
 * Upload dos bytes vai direto do browser ao Supabase Storage (signed URL),
 * nunca passa pelo Fastify (que tem teto de 15MB). Ver MODULOS_ARQUITETURA.md.
 */
import { useEffect, useState, useRef, useCallback } from 'react';
import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { formatBrl, ModuleCatalogItem } from '@/lib/modules';
import ModuleCheckoutInline from '@/components/ModuleCheckoutInline';

interface LegendaJob {
  id: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  originalFilename: string | null;
  inputSizeBytes: number | null;
  durationSec: number | null;
  errorMessage: string | null;
  createdAt: string;
}

const ALLOWED_TYPES = new Set([
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska', 'video/3gpp', 'video/x-msvideo',
]);
const MAX_BYTES = 500 * 1024 * 1024;

const STATUS_META: Record<LegendaJob['status'], { label: string; cls: string }> = {
  pending:    { label: 'Na fila',       cls: 'text-amber-400 border-amber-400/20 bg-amber-400/10' },
  processing: { label: 'Processando…',  cls: 'text-sky-400 border-sky-400/20 bg-sky-400/10' },
  done:       { label: '✓ Pronta',      cls: 'text-emerald-400 border-emerald-400/20 bg-emerald-400/10' },
  error:      { label: 'Erro',          cls: 'text-red-400 border-red-400/20 bg-red-400/10' },
};

function formatBytes(n: number | null): string {
  if (!n) return '—';
  const mb = n / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

function formatDuration(s: number | null): string {
  if (!s) return '—';
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export default function LegendaPage() {
  const [loading, setLoading]           = useState(true);
  const [owned, setOwned]               = useState(false);
  const [moduleInfo, setModuleInfo]     = useState<ModuleCatalogItem | null>(null);
  const [loadError, setLoadError]       = useState<string | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const [jobs, setJobs]                 = useState<LegendaJob[]>([]);
  const [dragOver, setDragOver]         = useState(false);
  const [uploading, setUploading]       = useState(false);
  const [uploadStep, setUploadStep]     = useState<string | null>(null);
  const [uploadError, setUploadError]   = useState<string | null>(null);
  const [busyIds, setBusyIds]           = useState<Set<string>>(new Set());
  const fileInputRef                    = useRef<HTMLInputElement>(null);
  const pollRef                         = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadAccess = useCallback(async () => {
    try {
      const [me, mods] = await Promise.all([
        api.get<{ modules?: string[] }>('/auth/me'),
        api.get<{ modules: ModuleCatalogItem[] }>('/modules'),
      ]);
      setOwned((me?.modules || []).includes('legenda'));
      setModuleInfo(mods?.modules?.find((m) => m.key === 'legenda') || null);
    } catch (e: any) {
      if (e?.statusCode !== 401) setLoadError('Não foi possível carregar seu acesso ao módulo.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadJobs = useCallback(async () => {
    try {
      const res = await api.get<{ items: LegendaJob[] }>('/legendas');
      setJobs(res.items || []);
    } catch {
      /* silencioso — próximo poll tenta de novo */
    }
  }, []);

  useEffect(() => { loadAccess(); }, [loadAccess]);

  useEffect(() => {
    if (!owned) return;
    loadJobs();
    const hasActive = () => jobs.some((j) => j.status === 'pending' || j.status === 'processing');
    pollRef.current = setInterval(() => { if (hasActive() || jobs.length === 0) loadJobs(); }, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owned, loadJobs]);

  async function handleFile(file: File) {
    setUploadError(null);
    if (!ALLOWED_TYPES.has(file.type)) {
      setUploadError('Formato não suportado. Envie MP4, MOV, WebM, MKV, 3GP ou AVI.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setUploadError('Arquivo acima do limite de 500MB.');
      return;
    }
    setUploading(true);
    try {
      setUploadStep('Preparando upload...');
      const up = await api.post<{ legendaJobId: string; bucket: string; path: string; token: string }>(
        '/legendas/upload-url',
        { filename: file.name, contentType: file.type, sizeBytes: file.size }
      );

      setUploadStep('Enviando vídeo...');
      const { error: upErr } = await supabase.storage.from(up.bucket).uploadToSignedUrl(up.path, up.token, file);
      if (upErr) throw new Error(upErr.message || 'Falha ao enviar o vídeo.');

      setUploadStep('Enfileirando processamento...');
      await api.post(`/legendas/${up.legendaJobId}/confirm`, {});

      await loadJobs();
    } catch (e: any) {
      setUploadError(e?.message || e?.error || 'Erro ao enviar o vídeo. Tente novamente.');
    } finally {
      setUploading(false);
      setUploadStep(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (uploading) return;
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  async function handleDownload(id: string, format: 'srt' | 'vtt') {
    setBusyIds((s) => new Set(s).add(`${id}:${format}`));
    try {
      const res = await api.get<{ url: string }>(`/legendas/${id}/download?format=${format}`);
      window.open(res.url, '_blank');
    } catch (e: any) {
      alert(e?.message || 'Legenda ainda não disponível para download.');
    } finally {
      setBusyIds((s) => { const n = new Set(s); n.delete(`${id}:${format}`); return n; });
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Excluir esta legenda? Essa ação não pode ser desfeita.')) return;
    setBusyIds((s) => new Set(s).add(id));
    try {
      await api.delete(`/legendas/${id}`);
      setJobs((js) => js.filter((j) => j.id !== id));
    } catch (e: any) {
      alert(e?.message || 'Erro ao excluir.');
    } finally {
      setBusyIds((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-neutral-950 text-neutral-300">
        Carregando módulo Legendas…
      </main>
    );
  }

  // ── Não contratado: upsell + checkout inline ──
  if (!owned) {
    const priceMonthly = moduleInfo?.priceMonthly ?? 34.9;
    return (
      <main className="min-h-screen bg-neutral-950 text-neutral-100 px-5 py-10">
        <div className="max-w-md mx-auto">
          <div className="text-center mb-8">
            <div className="text-5xl mb-3">🎬</div>
            <h1 className="text-2xl font-bold">ZapScript Legendas</h1>
            <p className="text-neutral-400 mt-2">
              Envie um vídeo e receba a legenda pronta em .srt ou .vtt — sem editar na mão.
            </p>
          </div>

          {loadError && (
            <div className="mb-6 rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-red-200 text-sm">
              {loadError}
            </div>
          )}

          {checkoutOpen ? (
            <ModuleCheckoutInline
              moduleKey="legenda"
              moduleName="ZapScript Legendas"
              priceMonthly={priceMonthly}
              onSuccess={() => { setCheckoutOpen(false); loadAccess(); }}
              onCancel={() => setCheckoutOpen(false)}
            />
          ) : (
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
              <ul className="space-y-2.5 mb-6">
                {[
                  'Legenda automática via IA (Whisper)',
                  'Formatos .srt e .vtt prontos para Reels, Stories e Shorts',
                  'Upload direto — vídeos de até 500MB',
                  'Sem edição manual, sem plugin de vídeo',
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-neutral-300">
                    <span className="text-emerald-400 mt-0.5">✓</span>{f}
                  </li>
                ))}
              </ul>
              <div className="flex items-baseline gap-1 mb-4">
                <span className="text-3xl font-black text-emerald-400">{formatBrl(priceMonthly)}</span>
                <span className="text-sm text-neutral-400">/mês</span>
              </div>
              <button
                onClick={() => setCheckoutOpen(true)}
                className="w-full py-3.5 rounded-xl text-sm font-bold bg-emerald-600 hover:bg-emerald-500 transition-colors"
              >
                Contratar módulo →
              </button>
              <p className="text-center text-[11px] text-neutral-500 mt-3">
                🔒 Pix ou cartão · Cancele quando quiser
              </p>
            </div>
          )}
        </div>
      </main>
    );
  }

  // ── Contratado: upload + lista de jobs ──
  const hasJobs = jobs.length > 0;

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 px-5 py-10">
      <div className="max-w-3xl mx-auto">
        <header className="mb-8">
          <h1 className="text-2xl font-bold flex items-center gap-2">🎬 ZapScript Legendas</h1>
          <p className="text-neutral-400 mt-1">Envie um vídeo e receba a legenda em .srt e .vtt.</p>
        </header>

        {loadError && (
          <div className="mb-6 rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-red-200 text-sm">
            {loadError}
          </div>
        )}

        {/* Dropzone */}
        <div
          onDragOver={(e) => { e.preventDefault(); if (!uploading) setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => !uploading && fileInputRef.current?.click()}
          className={`rounded-2xl border-2 border-dashed px-6 py-10 text-center cursor-pointer transition-colors ${
            uploading ? 'border-neutral-800 bg-neutral-900/40 cursor-default'
              : dragOver ? 'border-emerald-500 bg-emerald-500/5' : 'border-neutral-700 bg-neutral-900 hover:border-emerald-600'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="video/mp4,video/quicktime,video/webm,video/x-matroska,video/3gpp,video/x-msvideo,.mp4,.mov,.webm,.mkv,.3gp,.avi"
            className="hidden"
            disabled={uploading}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
          {uploading ? (
            <div className="text-neutral-300">
              <div className="animate-pulse text-3xl mb-2">⏳</div>
              {uploadStep || 'Enviando...'}
            </div>
          ) : (
            <div className="text-neutral-400">
              <div className="text-3xl mb-2">📤</div>
              <div className="font-semibold text-neutral-200">Arraste um vídeo ou clique para escolher</div>
              <div className="text-xs mt-1">MP4, MOV, WebM, MKV, 3GP ou AVI · até 500MB</div>
            </div>
          )}
        </div>

        {uploadError && (
          <div className="mt-3 rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-red-200 text-sm">
            {uploadError}
          </div>
        )}

        {/* Lista de jobs */}
        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400 mb-3">
            Suas legendas
          </h2>
          {!hasJobs ? (
            <p className="text-neutral-500 text-sm">Nenhum vídeo enviado ainda.</p>
          ) : (
            <div className="space-y-3">
              {jobs.map((j) => {
                const meta = STATUS_META[j.status];
                const busy = (fmt: 'srt' | 'vtt') => busyIds.has(`${j.id}:${fmt}`);
                return (
                  <div key={j.id} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate max-w-[220px] sm:max-w-xs">
                          {j.originalFilename || 'vídeo'}
                        </span>
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${meta.cls}`}>
                          {meta.label}
                        </span>
                      </div>
                      <div className="text-xs text-neutral-500 mt-1">
                        {formatBytes(j.inputSizeBytes)}
                        {j.durationSec ? ` · ${formatDuration(j.durationSec)}` : ''}
                        {' · '}
                        {new Date(j.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </div>
                      {j.status === 'error' && j.errorMessage && (
                        <div className="text-xs text-red-400 mt-1">{j.errorMessage}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {j.status === 'done' && (
                        <>
                          <button
                            onClick={() => handleDownload(j.id, 'srt')}
                            disabled={busy('srt')}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600/15 text-emerald-400 hover:bg-emerald-600/25 disabled:opacity-50"
                          >
                            {busy('srt') ? '...' : '.srt'}
                          </button>
                          <button
                            onClick={() => handleDownload(j.id, 'vtt')}
                            disabled={busy('vtt')}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600/15 text-emerald-400 hover:bg-emerald-600/25 disabled:opacity-50"
                          >
                            {busy('vtt') ? '...' : '.vtt'}
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => handleDelete(j.id)}
                        disabled={busyIds.has(j.id)}
                        className="text-xs px-2.5 py-1.5 rounded-lg text-neutral-500 hover:text-red-400 hover:bg-red-950/30 disabled:opacity-50"
                        title="Excluir"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
