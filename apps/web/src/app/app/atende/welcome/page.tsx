'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '@/lib/api';
import AtendeHeader from '../AtendeHeader';
import VoiceRecorder from '../VoiceRecorder';

interface WNumberLite {
  id: string;
  displayName: string | null;
  phoneNumber: string | null;
  status: string;
}

interface WelcomeConfigData {
  enabled: boolean;
  text: string | null;
  hasAudio: boolean;
  hasVideo: boolean;
  audioMime: string | null;
  videoMime: string | null;
}

const VIDEO_MAX_BYTES = 8 * 1024 * 1024; // ~20s de vídeo curto — mesmo limite validado no backend

export default function AtendeWelcomePage() {
  const [numbers, setNumbers] = useState<WNumberLite[]>([]);
  const [numberId, setNumberId] = useState<string>('');
  const [loadingNumbers, setLoadingNumbers] = useState(true);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [enabled, setEnabled] = useState(false);
  const [text, setText] = useState('');
  const [hasAudio, setHasAudio] = useState(false);
  const [hasVideo, setHasVideo] = useState(false);

  // Novos arquivos escolhidos nesta sessão de edição (ainda não salvos).
  const [newAudioBlob, setNewAudioBlob] = useState<Blob | null>(null);
  const [newVideoFile, setNewVideoFile] = useState<File | null>(null);
  const [removeAudio, setRemoveAudio] = useState(false);
  const [removeVideo, setRemoveVideo] = useState(false);

  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState<'audio' | 'video' | null>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  // Espelha os dois estados acima só para o cleanup de desmontagem abaixo ler
  // o valor mais recente — um useEffect com deps [] captura closure do
  // primeiro render (sempre null), então revogar ali direto nunca funcionaria.
  const previewUrlsRef = useRef<{ audio: string | null; video: string | null }>({ audio: null, video: null });
  previewUrlsRef.current = { audio: audioPreviewUrl, video: videoPreviewUrl };

  useEffect(() => {
    api.get<WNumberLite[]>('/numbers')
      .then((data) => {
        setNumbers(data);
        if (data.length > 0) setNumberId(data[0].id);
      })
      .catch((e) => setError(e?.message || 'Não foi possível carregar seus números.'))
      .finally(() => setLoadingNumbers(false));
  }, []);

  const resetLocalEdits = useCallback(() => {
    setNewAudioBlob(null);
    setNewVideoFile(null);
    setRemoveAudio(false);
    setRemoveVideo(false);
    setAudioPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    setVideoPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    if (videoInputRef.current) videoInputRef.current.value = '';
  }, []);

  const loadConfig = useCallback((id: string) => {
    setLoadingConfig(true);
    setError(null);
    resetLocalEdits();
    api.get<WelcomeConfigData>(`/atende/welcome-config/${id}`)
      .then((cfg) => {
        setEnabled(cfg.enabled);
        setText(cfg.text || '');
        setHasAudio(cfg.hasAudio);
        setHasVideo(cfg.hasVideo);
      })
      .catch((e) => setError(e?.message || 'Não foi possível carregar a configuração.'))
      .finally(() => setLoadingConfig(false));
  }, [resetLocalEdits]);

  useEffect(() => {
    if (numberId) loadConfig(numberId);
  }, [numberId, loadConfig]);

  function handleAudioRecorded(blob: Blob) {
    setNewAudioBlob(blob);
    setRemoveAudio(false);
    setAudioPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob); });
  }

  function handleVideoChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > VIDEO_MAX_BYTES) {
      setError(`Vídeo muito grande (máx ${(VIDEO_MAX_BYTES / 1024 / 1024).toFixed(0)}MB). Escolha um clipe mais curto.`);
      e.target.value = '';
      return;
    }
    setError(null);
    setNewVideoFile(file);
    setRemoveVideo(false);
    setVideoPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file); });
  }

  // Prévia do que já está salvo — <audio>/<video src> não manda o JWT, então
  // busca o blob autenticado e mostra num player inline (nunca abrir janela
  // nova/autoplay aqui: depois de um `await`, o navegador já não considera a
  // ação como gesto do usuário, e bloqueia popup + autoplay silenciosamente).
  async function playSavedMedia(kind: 'audio' | 'video') {
    setLoadingPreview(kind);
    try {
      const blob = await api.getBlob(`/atende/welcome-config/${numberId}/media/${kind}`);
      const url = URL.createObjectURL(blob);
      if (kind === 'audio') {
        setAudioPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return url; });
      } else {
        setVideoPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return url; });
      }
    } catch (e: any) {
      setError(e?.message || 'Não foi possível carregar a prévia.');
    } finally {
      setLoadingPreview(null);
    }
  }

  // Revoga as URLs de prévia ao desmontar — evitam vazar memória entre navegações.
  useEffect(() => () => {
    if (previewUrlsRef.current.audio) URL.revokeObjectURL(previewUrlsRef.current.audio);
    if (previewUrlsRef.current.video) URL.revokeObjectURL(previewUrlsRef.current.video);
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!numberId) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const formData = new FormData();
      formData.append('enabled', String(enabled));
      formData.append('text', text.trim());
      if (newAudioBlob) formData.append('audio', newAudioBlob, 'boas-vindas-audio.webm');
      else if (removeAudio) formData.append('removeAudio', 'true');
      if (newVideoFile) formData.append('video', newVideoFile, newVideoFile.name);
      else if (removeVideo) formData.append('removeVideo', 'true');

      const cfg = await api.putFormData<WelcomeConfigData>(`/atende/welcome-config/${numberId}`, formData);
      setHasAudio(cfg.hasAudio);
      setHasVideo(cfg.hasVideo);
      resetLocalEdits();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: any) {
      setError(e?.message || 'Não foi possível salvar. Tente novamente.');
    } finally {
      setSaving(false);
    }
  }

  if (loadingNumbers) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-neutral-950 text-neutral-300">
        Carregando…
      </main>
    );
  }

  const audioConfigured = !!newAudioBlob || (hasAudio && !removeAudio);
  const videoConfigured = !!newVideoFile || (hasVideo && !removeVideo);

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 px-5 py-10">
      <div className="max-w-2xl mx-auto">
        <AtendeHeader />

        {numbers.length === 0 ? (
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-8 text-center">
            <p className="text-neutral-300 font-medium">Você ainda não tem um número conectado.</p>
            <p className="text-neutral-500 text-sm mt-2">
              Conecte um número de WhatsApp primeiro para poder configurar a boas-vindas.
            </p>
          </div>
        ) : (
          <>
            {numbers.length > 1 && (
              <div className="mb-5">
                <label className="block text-sm font-medium text-neutral-300 mb-1.5">Número de WhatsApp</label>
                <select
                  value={numberId}
                  onChange={(e) => setNumberId(e.target.value)}
                  className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                >
                  {numbers.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.displayName || n.phoneNumber || n.id}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {error && (
              <div className="mb-5 rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-red-200 text-sm">
                {error}
              </div>
            )}

            {loadingConfig ? (
              <p className="text-neutral-500 text-sm">Carregando configuração…</p>
            ) : (
              <form onSubmit={handleSave} className="space-y-6">
                <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5 flex items-center justify-between">
                  <div>
                    <p className="font-medium">Boas-vindas automática</p>
                    <p className="text-sm text-neutral-500 mt-0.5">
                      Ligado, toda vez que um contato escrever pela primeira vez no dia, ele recebe essa
                      mensagem antes de qualquer resposta do Atende.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    onClick={() => setEnabled((v) => !v)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
                      enabled ? 'bg-emerald-600' : 'bg-neutral-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        enabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5 space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-neutral-300 mb-1.5">Texto</label>
                    <textarea
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      maxLength={1000}
                      rows={4}
                      placeholder="Ex: Oi! Obrigado por chegar até a gente 🙂 Já vamos te atender por aqui."
                      className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 resize-y"
                    />
                    <p className="text-xs text-neutral-600 mt-1 text-right">{text.length}/1000</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-neutral-300 mb-1.5">
                      Áudio <span className="text-neutral-600">(opcional)</span>
                    </label>
                    <div className="flex items-center gap-3 flex-wrap">
                      <VoiceRecorder onRecorded={handleAudioRecorded} />
                      {audioConfigured && (
                        <>
                          <span className="text-xs text-emerald-400">
                            {newAudioBlob ? 'Novo áudio gravado ✓' : 'Áudio configurado ✓'}
                          </span>
                          {!newAudioBlob && hasAudio && !audioPreviewUrl && (
                            <button
                              type="button"
                              onClick={() => playSavedMedia('audio')}
                              disabled={loadingPreview === 'audio'}
                              className="text-xs text-neutral-300 underline hover:text-neutral-100 disabled:opacity-50"
                            >
                              {loadingPreview === 'audio' ? 'carregando…' : 'ouvir'}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setNewAudioBlob(null);
                              setRemoveAudio(true);
                              setAudioPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
                            }}
                            className="text-xs text-red-400 hover:text-red-300"
                          >
                            remover
                          </button>
                        </>
                      )}
                    </div>
                    {audioPreviewUrl && (
                      <audio src={audioPreviewUrl} controls className="mt-2 w-full" />
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-neutral-300 mb-1.5">
                      Vídeo <span className="text-neutral-600">(opcional, máx {(VIDEO_MAX_BYTES / 1024 / 1024).toFixed(0)}MB / ~20s)</span>
                    </label>
                    <div className="flex items-center gap-3 flex-wrap">
                      <input
                        ref={videoInputRef}
                        type="file"
                        accept="video/*"
                        onChange={handleVideoChosen}
                        className="text-sm text-neutral-300"
                      />
                      {videoConfigured && (
                        <>
                          <span className="text-xs text-emerald-400">
                            {newVideoFile ? 'Novo vídeo escolhido ✓' : 'Vídeo configurado ✓'}
                          </span>
                          {!newVideoFile && hasVideo && !videoPreviewUrl && (
                            <button
                              type="button"
                              onClick={() => playSavedMedia('video')}
                              disabled={loadingPreview === 'video'}
                              className="text-xs text-neutral-300 underline hover:text-neutral-100 disabled:opacity-50"
                            >
                              {loadingPreview === 'video' ? 'carregando…' : 'ver'}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setNewVideoFile(null);
                              setRemoveVideo(true);
                              setVideoPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
                              if (videoInputRef.current) videoInputRef.current.value = '';
                            }}
                            className="text-xs text-red-400 hover:text-red-300"
                          >
                            remover
                          </button>
                        </>
                      )}
                    </div>
                    {videoPreviewUrl && (
                      <video src={videoPreviewUrl} controls className="mt-2 max-w-full rounded-lg" />
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {saving ? 'Salvando…' : 'Salvar'}
                  </button>
                  {saved && <span className="text-sm text-emerald-400">Salvo ✓</span>}
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </main>
  );
}
