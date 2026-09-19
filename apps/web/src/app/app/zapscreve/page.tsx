'use client';
/**
 * ZapScript ZapScreve — grava um áudio para SI, ele vira texto refinado
 * (gramática/pontuação/acentuação) e sai como mensagem de texto no lugar do
 * áudio, pro contato escolhido. Direção contrária da transcrição de entrada.
 *
 * Sem módulo/gate próprio — quem tem Atende ou Copiloto já usa (entra por
 * ambos: aba no Atende, link no painel do Copiloto). Ver ESCOPO_ZAPSCREVE.md.
 */
import { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import VoiceRecorder from '@/components/VoiceRecorder';

interface WNumber {
  id: string;
  displayName: string | null;
  phoneNumber: string | null;
  status: string;
}

interface Contact {
  phone: string;
  name: string | null;
}

interface Draft {
  id: string;
  targetPhone: string;
  targetName: string | null;
  status: 'uploading' | 'processing' | 'ready' | 'sent' | 'discarded' | 'expired' | 'error';
  errorMessage: string | null;
  quickText: string | null;
  copilotoText: string | null;
  sentText: string | null;
  sentVia: string | null;
  durationSec: number | null;
  createdAt: string;
  sentAt: string | null;
  hasAudio: boolean;
}

const STATUS_META: Record<Draft['status'], { label: string; cls: string }> = {
  uploading:  { label: 'Enviando…',         cls: 'text-amber-400 border-amber-400/20 bg-amber-400/10' },
  processing: { label: 'Transcrevendo…',    cls: 'text-sky-400 border-sky-400/20 bg-sky-400/10' },
  ready:      { label: 'Pronto p/ revisar', cls: 'text-emerald-400 border-emerald-400/20 bg-emerald-400/10' },
  sent:       { label: '✓ Enviado',         cls: 'text-emerald-400 border-emerald-400/20 bg-emerald-400/10' },
  discarded:  { label: 'Descartado',        cls: 'text-neutral-500 border-neutral-700 bg-neutral-800/40' },
  expired:    { label: 'Expirado',          cls: 'text-neutral-500 border-neutral-700 bg-neutral-800/40' },
  error:      { label: 'Erro',              cls: 'text-red-400 border-red-400/20 bg-red-400/10' },
};

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function ZapScrevePageInner() {
  const searchParams = useSearchParams();
  const sourceModule: 'atende' | 'copiloto' = searchParams.get('from') === 'copiloto' ? 'copiloto' : 'atende';

  const [loading, setLoading]     = useState(true);
  const [owned, setOwned]         = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [numbers, setNumbers]   = useState<WNumber[]>([]);
  const [numberId, setNumberId] = useState('');

  const [contacts, setContacts]         = useState<Contact[]>([]);
  const [contactQuery, setContactQuery] = useState('');
  const [manualPhone, setManualPhone]   = useState('');
  const [manualName, setManualName]     = useState('');
  const [selected, setSelected]         = useState<Contact | null>(null);

  const [uploading, setUploading]     = useState(false);
  const [uploadStep, setUploadStep]   = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [drafts, setDrafts]       = useState<Draft[]>([]);
  const [editTexts, setEditTexts] = useState<Record<string, string>>({});
  const [busyIds, setBusyIds]     = useState<Set<string>>(new Set());
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadAccess = useCallback(async () => {
    try {
      const [me, nums] = await Promise.all([
        api.get<{ modules?: string[] }>('/auth/me'),
        api.get<WNumber[]>('/numbers'),
      ]);
      const mods = me?.modules || [];
      setOwned(mods.includes('atende') || mods.includes('copiloto'));
      setNumbers(nums || []);
      const connected = (nums || []).find((n) => n.status === 'connected');
      if (connected) setNumberId(connected.id);
    } catch (e: any) {
      if (e?.statusCode !== 401) setLoadError('Não foi possível carregar seu acesso.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadContacts = useCallback(async (nId: string) => {
    if (!nId) return;
    try {
      const res = await api.get<{ items: Contact[] }>(`/zapscreve/contacts?numberId=${encodeURIComponent(nId)}`);
      setContacts(res.items || []);
    } catch {
      /* silencioso — busca manual do número continua disponível */
    }
  }, []);

  const loadDrafts = useCallback(async () => {
    try {
      const res = await api.get<{ items: Draft[] }>('/zapscreve');
      setDrafts(res.items || []);
      setEditTexts((prev) => {
        const next = { ...prev };
        for (const d of res.items || []) {
          if (next[d.id] === undefined) next[d.id] = d.quickText || '';
        }
        return next;
      });
    } catch {
      /* próximo poll tenta de novo */
    }
  }, []);

  useEffect(() => { loadAccess(); }, [loadAccess]);
  useEffect(() => { if (owned && numberId) loadContacts(numberId); }, [owned, numberId, loadContacts]);
  useEffect(() => { if (owned) loadDrafts(); }, [owned, loadDrafts]);

  useEffect(() => {
    if (!owned) return;
    pollRef.current = setInterval(() => {
      if (drafts.some((d) => d.status === 'uploading' || d.status === 'processing')) loadDrafts();
    }, 2500);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owned, drafts, loadDrafts]);

  const target = selected || (manualPhone.trim() ? { phone: manualPhone.trim(), name: manualName.trim() || null } : null);

  const filteredContacts = contactQuery.trim()
    ? contacts.filter((c) =>
        (c.name || '').toLowerCase().includes(contactQuery.toLowerCase()) || c.phone.includes(contactQuery.replace(/\D/g, '')))
    : contacts.slice(0, 20);

  async function handleRecorded(blob: Blob) {
    setUploadError(null);
    if (!numberId) { setUploadError('Selecione um número conectado antes de gravar.'); return; }
    if (!target) { setUploadError('Escolha o contato de destino antes de gravar.'); return; }

    setUploading(true);
    try {
      setUploadStep('Preparando upload...');
      const contentType = blob.type || 'audio/webm';
      const ext = contentType.includes('ogg') ? 'ogg' : 'webm';
      const up = await api.post<{ draftId: string; bucket: string; path: string; token: string }>(
        '/zapscreve/upload-url',
        {
          filename:     `zapscreve.${ext}`,
          contentType,
          sizeBytes:    blob.size,
          numberId,
          targetPhone:  target.phone,
          targetName:   target.name || undefined,
          sourceModule,
        }
      );

      setUploadStep('Enviando áudio...');
      const { error: upErr } = await supabase.storage.from(up.bucket).uploadToSignedUrl(up.path, up.token, blob);
      if (upErr) throw new Error(upErr.message || 'Falha ao enviar o áudio.');

      setUploadStep('Transcrevendo...');
      await api.post(`/zapscreve/${up.draftId}/confirm`, {});

      await loadDrafts();
    } catch (e: any) {
      setUploadError(e?.message || e?.error || 'Erro ao processar o áudio. Tente novamente.');
    } finally {
      setUploading(false);
      setUploadStep(null);
    }
  }

  async function handlePlayAudio(id: string) {
    if (audioUrls[id]) return;
    try {
      const res = await api.get<{ url: string }>(`/zapscreve/${id}/audio-url`);
      setAudioUrls((m) => ({ ...m, [id]: res.url }));
    } catch {
      /* sem áudio disponível — o player só não aparece */
    }
  }

  async function handleSend(draft: Draft, variant: 'quick' | 'copiloto' | 'edited') {
    setBusyIds((s) => new Set(s).add(draft.id));
    try {
      const text = variant === 'edited' ? editTexts[draft.id] : undefined;
      await api.post(`/zapscreve/${draft.id}/send`, { variant, text });
      await loadDrafts();
    } catch (e: any) {
      alert(e?.message || e?.error || 'Erro ao enviar.');
    } finally {
      setBusyIds((s) => { const n = new Set(s); n.delete(draft.id); return n; });
    }
  }

  async function handleDiscard(id: string) {
    setBusyIds((s) => new Set(s).add(id));
    try {
      await api.delete(`/zapscreve/${id}`);
      setDrafts((ds) => ds.filter((d) => d.id !== id));
    } catch (e: any) {
      alert(e?.message || e?.error || 'Erro ao descartar.');
    } finally {
      setBusyIds((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-neutral-950 text-neutral-300">
        Carregando ZapScreve…
      </main>
    );
  }

  if (!owned) {
    return (
      <main className="min-h-screen bg-neutral-950 text-neutral-100 px-5 py-10">
        <div className="max-w-md mx-auto text-center">
          <div className="text-5xl mb-3">🎙️</div>
          <h1 className="text-2xl font-bold">ZapScript ZapScreve</h1>
          <p className="text-neutral-400 mt-2">
            Grave um áudio pra você e o ZapScript envia como texto — corrigido e revisado — pro contato que você escolher.
          </p>
          {loadError && (
            <div className="mt-6 rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-red-200 text-sm">
              {loadError}
            </div>
          )}
          <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-6 text-left">
            <p className="text-sm text-neutral-300 mb-4">
              O ZapScreve vive dentro do Atende e do Copiloto — quem já tem qualquer um dos dois já pode usar, sem contratar nada novo.
            </p>
            <div className="flex flex-col gap-2">
              <Link href="/app/atende" className="text-center py-2.5 rounded-xl text-sm font-bold bg-emerald-600 hover:bg-emerald-500 transition-colors">
                Ver o ZapScript Atende →
              </Link>
              <Link href="/dashboard/copiloto" className="text-center py-2.5 rounded-xl text-sm font-bold border border-neutral-700 hover:border-neutral-500 transition-colors">
                Ver o ZapScript Copiloto →
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  const activeDrafts = drafts.filter((d) => d.status !== 'discarded' && d.status !== 'expired');

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 px-5 py-10">
      <div className="max-w-2xl mx-auto">
        <header className="mb-8">
          <h1 className="text-2xl font-bold flex items-center gap-2">🎙️ ZapScript ZapScreve</h1>
          <p className="text-neutral-400 mt-1">Grave um áudio — ele vira texto revisado e sai pro contato escolhido, no lugar do áudio.</p>
        </header>

        {loadError && (
          <div className="mb-6 rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-red-200 text-sm">{loadError}</div>
        )}

        {!numberId && (
          <div className="mb-6 rounded-lg border border-amber-800 bg-amber-950/30 px-4 py-3 text-amber-200 text-sm">
            {numbers.length === 0
              ? <>Você ainda não tem um número conectado. <Link href="/dashboard/numeros" className="underline">Conectar número →</Link></>
              : <>Nenhum número conectado no momento. <Link href="/dashboard/numeros" className="underline">Ver status →</Link></>}
          </div>
        )}

        {/* ── Número conectado ── */}
        {numbers.length > 1 && (
          <div className="mb-4">
            <label className="block text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1.5">Número</label>
            <select
              value={numberId}
              onChange={(e) => { setNumberId(e.target.value); setSelected(null); setContacts([]); }}
              className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm"
            >
              {numbers.map((n) => (
                <option key={n.id} value={n.id} disabled={n.status !== 'connected'}>
                  {n.displayName || n.phoneNumber || n.id}{n.status !== 'connected' ? ' (desconectado)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* ── Destino ── */}
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4 mb-6">
          <label className="block text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-2">Para quem vai a mensagem?</label>
          {target ? (
            <div className="flex items-center justify-between gap-2 rounded-lg bg-neutral-800/60 px-3 py-2">
              <span className="text-sm font-medium truncate">{target.name || target.phone}</span>
              <button onClick={() => { setSelected(null); setManualPhone(''); setManualName(''); }} className="text-xs text-neutral-400 hover:text-neutral-200 shrink-0">
                trocar
              </button>
            </div>
          ) : (
            <>
              <input
                value={contactQuery}
                onChange={(e) => setContactQuery(e.target.value)}
                placeholder="Buscar por nome ou número..."
                className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm mb-2"
              />
              {filteredContacts.length > 0 && (
                <div className="max-h-40 overflow-y-auto rounded-lg border border-neutral-800 divide-y divide-neutral-800 mb-2">
                  {filteredContacts.map((c) => (
                    <button
                      key={c.phone}
                      onClick={() => setSelected(c)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-neutral-800/60 truncate"
                    >
                      {c.name || c.phone}{c.name ? <span className="text-neutral-500"> · {c.phone}</span> : null}
                    </button>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-neutral-500 mb-2">Não achou? Digite o número manualmente:</p>
              <div className="flex gap-2">
                <input
                  value={manualPhone}
                  onChange={(e) => setManualPhone(e.target.value)}
                  placeholder="DDI+DDD+número"
                  className="flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
                />
                <input
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  placeholder="Nome (opcional)"
                  className="flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
                />
              </div>
            </>
          )}
        </div>

        {/* ── Gravar ── */}
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4 mb-6 text-center">
          {uploading ? (
            <div className="text-neutral-300 py-2">
              <div className="animate-pulse text-2xl mb-2">⏳</div>
              {uploadStep || 'Processando...'}
            </div>
          ) : (
            <VoiceRecorder onRecorded={handleRecorded} disabled={!target || !numberId} />
          )}
          {!target && !uploading && (
            <p className="text-xs text-neutral-500 mt-2">Escolha o destino acima antes de gravar.</p>
          )}
          {uploadError && (
            <p className="text-xs text-red-400 mt-2">{uploadError}</p>
          )}
        </div>

        {/* ── Rascunhos ── */}
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400 mb-3">Mensagens</h2>
          {activeDrafts.length === 0 ? (
            <p className="text-neutral-500 text-sm">Nenhuma mensagem gravada ainda.</p>
          ) : (
            <div className="space-y-3">
              {activeDrafts.map((d) => {
                const meta = STATUS_META[d.status];
                const busy = busyIds.has(d.id);
                const editedDiffers = d.status === 'ready' && (editTexts[d.id] ?? '') !== (d.quickText || '');
                return (
                  <div key={d.id} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-sm font-medium truncate">{d.targetName || d.targetPhone}</span>
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${meta.cls}`}>{meta.label}</span>
                    </div>
                    <div className="text-xs text-neutral-500 mb-2">
                      {formatWhen(d.createdAt)}
                      {d.durationSec ? ` · ${d.durationSec}s de áudio` : ''}
                    </div>

                    {d.status === 'error' && d.errorMessage && (
                      <p className="text-xs text-red-400 mb-2">{d.errorMessage}</p>
                    )}

                    {d.status === 'ready' && (
                      <div className="space-y-2">
                        {d.hasAudio && (
                          audioUrls[d.id] ? (
                            <audio controls src={audioUrls[d.id]} className="w-full h-9" />
                          ) : (
                            <button onClick={() => handlePlayAudio(d.id)} className="text-xs text-neutral-400 hover:text-neutral-200 underline">
                              ▶ ouvir áudio original
                            </button>
                          )
                        )}
                        <textarea
                          value={editTexts[d.id] ?? ''}
                          onChange={(e) => setEditTexts((m) => ({ ...m, [d.id]: e.target.value }))}
                          rows={3}
                          className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
                        />
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => handleSend(d, editedDiffers ? 'edited' : 'quick')}
                            disabled={busy}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50"
                          >
                            {busy ? 'Enviando...' : editedDiffers ? 'Enviar (editado)' : 'Enviar'}
                          </button>
                          <button
                            onClick={() => handleDiscard(d.id)}
                            disabled={busy}
                            className="text-xs px-3 py-1.5 rounded-lg text-neutral-500 hover:text-red-400 hover:bg-red-950/30 disabled:opacity-50"
                          >
                            Descartar
                          </button>
                        </div>
                      </div>
                    )}

                    {d.status === 'sent' && d.sentText && (
                      <p className="text-sm text-neutral-300 whitespace-pre-wrap">{d.sentText}</p>
                    )}

                    {(d.status === 'uploading' || d.status === 'processing') && (
                      <button
                        onClick={() => handleDiscard(d.id)}
                        disabled={busy}
                        className="text-xs px-2.5 py-1.5 rounded-lg text-neutral-500 hover:text-red-400 hover:bg-red-950/30 disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                    )}
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

export default function ZapScrevePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-neutral-950" />}>
      <ZapScrevePageInner />
    </Suspense>
  );
}
