'use client';
import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import AtendeHeader from '../AtendeHeader';

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
}

const TONE_OPTIONS = [
  { value: 'profissional-amigavel', label: 'Profissional e amigável' },
  { value: 'formal', label: 'Formal' },
  { value: 'descontraido', label: 'Descontraído' },
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
      })
      .catch((e) => setError(e?.message || 'Não foi possível carregar a configuração.'))
      .finally(() => setLoadingConfig(false));
  }, []);

  useEffect(() => {
    if (numberId) loadConfig(numberId);
  }, [numberId, loadConfig]);

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
      <main className="min-h-screen flex items-center justify-center bg-neutral-950 text-neutral-300">
        Carregando…
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 px-5 py-10">
      <div className="max-w-2xl mx-auto">
        <AtendeHeader />

        {numbers.length === 0 ? (
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-8 text-center">
            <p className="text-neutral-300 font-medium">Você ainda não tem um número conectado.</p>
            <p className="text-neutral-500 text-sm mt-2">
              Conecte um número de WhatsApp primeiro para poder configurar o Atende.
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
                    <p className="font-medium">Atende ativo</p>
                    <p className="text-sm text-neutral-500 mt-0.5">
                      Quando ligado, mensagens novas recebem resposta automática por IA.
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

                <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-neutral-300 mb-1.5">
                      Sobre o seu negócio
                    </label>
                    <p className="text-xs text-neutral-500 mb-2">
                      Conte o que a IA precisa saber pra responder bem: o que você vende, horários,
                      formas de pagamento, políticas etc.
                    </p>
                    <textarea
                      value={businessContext}
                      onChange={(e) => setBusinessContext(e.target.value)}
                      maxLength={4000}
                      rows={6}
                      placeholder="Ex: Somos uma clínica odontológica em São Paulo. Atendemos de segunda a sábado, 8h às 18h. Aceitamos convênios X e Y, além de particular no PIX ou cartão..."
                      className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 resize-y"
                    />
                    <p className="text-xs text-neutral-600 mt-1 text-right">{businessContext.length}/4000</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-neutral-300 mb-1.5">Tom de voz</label>
                    <select
                      value={tone}
                      onChange={(e) => setTone(e.target.value)}
                      className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                    >
                      {TONE_OPTIONS.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-neutral-300 mb-1.5">
                      Mensagem de fallback
                    </label>
                    <p className="text-xs text-neutral-500 mb-2">
                      Enviada quando a IA não tem confiança suficiente pra responder sozinha.
                    </p>
                    <textarea
                      value={fallbackMessage}
                      onChange={(e) => setFallbackMessage(e.target.value)}
                      maxLength={500}
                      rows={2}
                      className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 resize-y"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-neutral-300 mb-1.5">
                      Telefone para escalonamento <span className="text-neutral-600">(opcional)</span>
                    </label>
                    <p className="text-xs text-neutral-500 mb-2">
                      Recebe um aviso quando uma conversa precisa de atenção humana.
                    </p>
                    <input
                      type="text"
                      value={escalationPhone}
                      onChange={(e) => setEscalationPhone(e.target.value)}
                      placeholder="11999998888"
                      className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                    />
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
