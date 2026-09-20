'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import AtendeHeader from '../AtendeHeader';
import VoiceRecorder from '../VoiceRecorder';
import SuggestionReview, { QaSuggestion } from '../SuggestionReview';
import QuickSetupWizard from '../QuickSetupWizard';
import { NICHE_TEMPLATES, NicheTemplate } from '../nicheTemplates';

interface WNumberLite {
  id: string;
  displayName: string | null;
  phoneNumber: string | null;
  status: string;
}

interface AtendeConfigData {
  numberId: string;
  enabled: boolean;
  businessContext: string | null;
  tone: string;
  fallbackMessage: string;
  escalationPhone: string | null;
  confidenceLevel: string;
  digestFrequency: string;
}

const TONE_OPTIONS = [
  { value: 'profissional-amigavel', label: 'Profissional e amigável' },
  { value: 'formal', label: 'Formal' },
  { value: 'descontraido', label: 'Descontraído' },
];

const CONFIDENCE_OPTIONS = [
  { value: 'conservador', label: 'Conservador — escala mais fácil pra você, evita risco de errar' },
  { value: 'equilibrado', label: 'Equilibrado — recomendado' },
  { value: 'autonomo', label: 'Autônomo — responde mais sozinho, escala menos' },
];

const DIGEST_OPTIONS = [
  { value: 'off', label: 'Desligado — sem resumo automático' },
  { value: 'daily', label: 'Diário' },
  { value: 'weekly', label: 'Semanal' },
];

export default function AtendeConfigPage() {
  const [numbers, setNumbers] = useState<WNumberLite[]>([]);
  const [numberId, setNumberId] = useState<string>('');
  const [loadingNumbers, setLoadingNumbers] = useState(true);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [enabled, setEnabled] = useState(false);
  const [businessContext, setBusinessContext] = useState('');
  const [tone, setTone] = useState('profissional-amigavel');
  const [fallbackMessage, setFallbackMessage] = useState('');
  const [escalationPhone, setEscalationPhone] = useState('');
  const [confidenceLevel, setConfidenceLevel] = useState('equilibrado');
  const [digestFrequency, setDigestFrequency] = useState('off');

  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [contextSuggestion, setContextSuggestion] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [selectedNiche, setSelectedNiche] = useState<NicheTemplate | null>(null);

  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyEmpty, setHistoryEmpty] = useState(false);
  const [historyKbCount, setHistoryKbCount] = useState<number | null>(null);

  function applyNicheTemplate(t: NicheTemplate) {
    setSelectedNiche(t);
    setWizardOpen(false);
    setContextSuggestion(t.businessContext);
  }

  useEffect(() => {
    api.get<WNumberLite[]>('/numbers')
      .then((data) => {
        setNumbers(data);
        if (data.length > 0) setNumberId(data[0].id);
      })
      .catch((e) => setError(e?.message || 'Não foi possível carregar seus números.'))
      .finally(() => setLoadingNumbers(false));
  }, []);

  const loadConfig = useCallback((id: string) => {
    setLoadingConfig(true);
    setError(null);
    api.get<AtendeConfigData>(`/atende/config/${id}`)
      .then((cfg) => {
        setEnabled(cfg.enabled);
        setBusinessContext(cfg.businessContext || '');
        setTone(cfg.tone || 'profissional-amigavel');
        setFallbackMessage(cfg.fallbackMessage || '');
        setEscalationPhone(cfg.escalationPhone || '');
        setConfidenceLevel(cfg.confidenceLevel || 'equilibrado');
        setDigestFrequency(cfg.digestFrequency || 'off');
      })
      .catch((e) => setError(e?.message || 'Não foi possível carregar a configuração.'))
      .finally(() => setLoadingConfig(false));
  }, []);

  useEffect(() => {
    if (numberId) loadConfig(numberId);
  }, [numberId, loadConfig]);

  async function handleVoiceRecorded(blob: Blob) {
    setVoiceError(null);
    setContextSuggestion(null);
    setVoiceBusy(true);
    try {
      const formData = new FormData();
      formData.append('file', blob, 'setup-context.webm');
      const res = await api.postFormData<{ transcript: string; businessContext: string }>(
        '/atende/setup/voice-context',
        formData,
      );
      setContextSuggestion(res.businessContext);
    } catch (e: any) {
      setVoiceError(e?.message || 'Não foi possível processar o áudio. Tente novamente.');
    } finally {
      setVoiceBusy(false);
    }
  }

  async function handleLearnFromHistory() {
    setHistoryError(null);
    setHistoryEmpty(false);
    setHistoryKbCount(null);
    setHistoryBusy(true);
    try {
      const res = await api.post<{
        pairs: number;
        businessContextSuggestion: string | null;
        kbSuggestions: QaSuggestion[];
      }>('/atende/setup/from-history', {});
      if (res.pairs === 0) {
        setHistoryEmpty(true);
        return;
      }
      if (res.businessContextSuggestion) {
        setContextSuggestion(res.businessContextSuggestion);
      }
      if (res.kbSuggestions.length > 0) {
        sessionStorage.setItem('atende_kb_from_history', JSON.stringify(res.kbSuggestions));
        setHistoryKbCount(res.kbSuggestions.length);
      }
    } catch (e: any) {
      setHistoryError(e?.message || 'Não foi possível analisar o histórico. Tente novamente.');
    } finally {
      setHistoryBusy(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!numberId) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.put(`/atende/config/${numberId}`, {
        enabled,
        businessContext: businessContext.trim() || undefined,
        tone,
        fallbackMessage: fallbackMessage.trim() || undefined,
        escalationPhone: escalationPhone.trim() || null,
        confidenceLevel,
        digestFrequency,
      });
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
      <div className="flex items-center justify-center h-64 text-brand-muted">
        Carregando…
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 max-w-5xl">
      <div className="max-w-2xl mx-auto">
        <AtendeHeader />

        {numbers.length === 0 ? (
          <div className="rounded-xl border border-brand-border bg-brand-surface p-8 text-center">
            <p className="text-brand-text-secondary font-medium">Você ainda não tem um número conectado.</p>
            <p className="text-brand-muted text-sm mt-2">
              Conecte um número de WhatsApp primeiro para poder configurar o Atende.
            </p>
          </div>
        ) : (
          <>
            {numbers.length > 1 && (
              <div className="mb-5">
                <label className="block text-sm font-medium text-brand-text-secondary mb-1.5">Número de WhatsApp</label>
                <select
                  value={numberId}
                  onChange={(e) => setNumberId(e.target.value)}
                  className="w-full rounded-lg border border-brand-border bg-brand-surface px-3 py-2 text-sm focus:outline-none focus:border-brand-primary"
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
              <div className="mb-5 rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-red-400 text-sm">
                {error}
              </div>
            )}

            {loadingConfig ? (
              <p className="text-brand-muted text-sm">Carregando configuração…</p>
            ) : (
              <form onSubmit={handleSave} className="space-y-6">
                <div className="rounded-xl border border-brand-border bg-brand-surface p-5 flex items-center justify-between">
                  <div>
                    <p className="font-medium">Atende ativo</p>
                    <p className="text-sm text-brand-muted mt-0.5">
                      Quando ligado, mensagens novas recebem resposta automática por IA.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    onClick={() => setEnabled((v) => !v)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
                      enabled ? 'bg-brand-primary' : 'bg-brand-border'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        enabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <div className="rounded-xl border border-brand-border bg-brand-surface p-5 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-brand-text-secondary mb-1.5">
                      Sobre o seu negócio
                    </label>
                    <p className="text-xs text-brand-muted mb-2">
                      Conte o que a IA precisa saber pra responder bem: o que você vende, horários,
                      formas de pagamento, políticas etc. Prefere não digitar? Grave um áudio ou
                      responda perguntas curtas que a gente organiza o texto pra você.
                    </p>

                    <div className="mb-3">
                      <p className="text-xs text-brand-muted mb-1.5">Ou comece de um modelo pronto:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {NICHE_TEMPLATES.map((t) => (
                          <button
                            key={t.key}
                            type="button"
                            onClick={() => applyNicheTemplate(t)}
                            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                              selectedNiche?.key === t.key
                                ? 'border-brand-primary bg-brand-primary/10 text-brand-primary'
                                : 'border-brand-border text-brand-text-secondary hover:border-brand-primary/30'
                            }`}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {wizardOpen ? (
                      <div className="mb-3">
                        <QuickSetupWizard
                          onComplete={(text) => {
                            setContextSuggestion(text);
                            setWizardOpen(false);
                          }}
                          onCancel={() => setWizardOpen(false)}
                        />
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 mb-3 flex-wrap">
                        <VoiceRecorder onRecorded={handleVoiceRecorded} disabled={voiceBusy} />
                        <button
                          type="button"
                          onClick={() => setWizardOpen(true)}
                          className="rounded-lg border border-brand-border px-4 py-2 text-sm font-medium text-brand-text hover:border-brand-primary/30"
                        >
                          Responder perguntas curtas
                        </button>
                        <button
                          type="button"
                          onClick={handleLearnFromHistory}
                          disabled={historyBusy}
                          className="rounded-lg border border-brand-border px-4 py-2 text-sm font-medium text-brand-text hover:border-brand-primary/30 disabled:opacity-50"
                        >
                          {historyBusy ? 'Analisando histórico…' : 'Aprender com o histórico'}
                        </button>
                        {voiceBusy && <span className="text-xs text-brand-text-secondary">Processando áudio…</span>}
                      </div>
                    )}
                    {voiceError && <p className="text-xs text-red-400 mb-3">{voiceError}</p>}
                    {historyError && <p className="text-xs text-red-400 mb-3">{historyError}</p>}
                    {historyEmpty && (
                      <p className="text-xs text-brand-muted mb-3">
                        Ainda não há respostas suas registradas. Assuma uma conversa escalada e responda o
                        cliente pelo WhatsApp normalmente — da próxima vez vai ter o que aprender aqui.
                      </p>
                    )}
                    {historyKbCount !== null && historyKbCount > 0 && (
                      <div className="mb-3 rounded-lg border border-brand-border bg-brand-elevated/60 px-3 py-2 flex items-center justify-between gap-3 flex-wrap">
                        <p className="text-xs text-brand-text-secondary">
                          {historyKbCount} {historyKbCount === 1 ? 'pergunta identificada' : 'perguntas identificadas'} no
                          histórico pra Base de Conhecimento.
                        </p>
                        <Link
                          href="/dashboard/atende/kb?fromHistory=1"
                          className="text-xs font-medium text-brand-primary hover:opacity-80"
                        >
                          Importar agora →
                        </Link>
                      </div>
                    )}

                    {contextSuggestion !== null && (
                      <div className="mb-3">
                        <SuggestionReview
                          kind="text"
                          title="Sugestão para revisar"
                          description="Revise e ajuste se quiser — ao usar, substitui o texto abaixo."
                          value={contextSuggestion}
                          onAccept={(value) => {
                            setBusinessContext(value);
                            setContextSuggestion(null);
                          }}
                          onReject={() => setContextSuggestion(null)}
                        />
                      </div>
                    )}

                    {selectedNiche && selectedNiche.kb.length > 0 && (
                      <div className="mb-3 rounded-lg border border-brand-border bg-brand-elevated/60 px-3 py-2 flex items-center justify-between gap-3 flex-wrap">
                        <p className="text-xs text-brand-text-secondary">
                          {selectedNiche.kb.length} perguntas prontas de &ldquo;{selectedNiche.label}&rdquo; pra Base de Conhecimento.
                        </p>
                        <Link
                          href={`/dashboard/atende/kb?template=${selectedNiche.key}`}
                          className="text-xs font-medium text-brand-primary hover:opacity-80"
                        >
                          Importar agora →
                        </Link>
                      </div>
                    )}

                    <textarea
                      value={businessContext}
                      onChange={(e) => setBusinessContext(e.target.value)}
                      maxLength={4000}
                      rows={6}
                      placeholder="Ex: Somos uma clínica odontológica em São Paulo. Atendemos de segunda a sábado, 8h às 18h. Aceitamos convênios X e Y, além de particular no PIX ou cartão..."
                      className="w-full rounded-lg border border-brand-border bg-brand-elevated px-3 py-2 text-sm focus:outline-none focus:border-brand-primary resize-y"
                    />
                    <p className="text-xs text-brand-muted mt-1 text-right">{businessContext.length}/4000</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-brand-text-secondary mb-1.5">Tom de voz</label>
                    <select
                      value={tone}
                      onChange={(e) => setTone(e.target.value)}
                      className="w-full rounded-lg border border-brand-border bg-brand-elevated px-3 py-2 text-sm focus:outline-none focus:border-brand-primary"
                    >
                      {TONE_OPTIONS.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-brand-text-secondary mb-1.5">Nível de confiança</label>
                    <p className="text-xs text-brand-muted mb-2">
                      Define o quanto a IA arrisca responder sozinha antes de escalar pra você.
                    </p>
                    <select
                      value={confidenceLevel}
                      onChange={(e) => setConfidenceLevel(e.target.value)}
                      className="w-full rounded-lg border border-brand-border bg-brand-elevated px-3 py-2 text-sm focus:outline-none focus:border-brand-primary"
                    >
                      {CONFIDENCE_OPTIONS.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-brand-text-secondary mb-1.5">Resumo periódico</label>
                    <p className="text-xs text-brand-muted mb-2">
                      Receba um resumo das conversas direto no seu WhatsApp (self-chat), sem precisar abrir o painel.
                    </p>
                    <select
                      value={digestFrequency}
                      onChange={(e) => setDigestFrequency(e.target.value)}
                      className="w-full rounded-lg border border-brand-border bg-brand-elevated px-3 py-2 text-sm focus:outline-none focus:border-brand-primary"
                    >
                      {DIGEST_OPTIONS.map((d) => (
                        <option key={d.value} value={d.value}>{d.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-brand-text-secondary mb-1.5">
                      Mensagem de fallback
                    </label>
                    <p className="text-xs text-brand-muted mb-2">
                      Enviada quando a IA não tem confiança suficiente pra responder sozinha.
                    </p>
                    <textarea
                      value={fallbackMessage}
                      onChange={(e) => setFallbackMessage(e.target.value)}
                      maxLength={500}
                      rows={2}
                      className="w-full rounded-lg border border-brand-border bg-brand-elevated px-3 py-2 text-sm focus:outline-none focus:border-brand-primary resize-y"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-brand-text-secondary mb-1.5">
                      Telefone para escalonamento <span className="text-brand-muted">(opcional)</span>
                    </label>
                    <p className="text-xs text-brand-muted mb-2">
                      Recebe um aviso quando uma conversa precisa de atenção humana.
                    </p>
                    <input
                      type="text"
                      value={escalationPhone}
                      onChange={(e) => setEscalationPhone(e.target.value)}
                      placeholder="11999998888"
                      className="w-full rounded-lg border border-brand-border bg-brand-elevated px-3 py-2 text-sm focus:outline-none focus:border-brand-primary"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-lg bg-brand-primary px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-primary disabled:opacity-50"
                  >
                    {saving ? 'Salvando…' : 'Salvar'}
                  </button>
                  {saved && <span className="text-sm text-brand-primary">Salvo ✓</span>}
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
