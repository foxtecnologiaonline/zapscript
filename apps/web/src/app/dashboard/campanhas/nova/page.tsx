'use client';

import { useEffect, useState, useCallback, Suspense, FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import AudienceImporter from '../_components/AudienceImporter';

interface EvolutionNumero {
  id: string;
  phoneNumber: string | null;
  displayName: string | null;
}

interface CampanhaState {
  id: string;
  name: string;
  status: string;
  channel: string;
  templateVarCount: number | null;
  audienceCount: number;
  consentConfirmedAt: string | null;
  whatsappNumberId: string;
}

/** Valor mínimo aceito pelo <input type="datetime-local"> — pelo menos 5 min no futuro. */
function minDatetimeLocal(): string {
  const d = new Date(Date.now() + 5 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function NovaCampanhaInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const resumeId = searchParams.get('campanhaId');

  const [campanhaId, setCampanhaId] = useState<string | null>(resumeId);
  const [campanha, setCampanha] = useState<CampanhaState | null>(null);

  // ── 1. Campanha (nome, número, mensagem) ─────────────────────────────────
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [evoNumeros, setEvoNumeros] = useState<EvolutionNumero[]>([]);
  const [loadingEvoNumeros, setLoadingEvoNumeros] = useState(false);
  const [evoNumeroId, setEvoNumeroId] = useState('');
  const [messageBody, setMessageBody] = useState('');

  const [abTestEnabled, setAbTestEnabled] = useState(false);
  const [variantBMessageBody, setVariantBMessageBody] = useState('');

  useEffect(() => {
    if (campanhaId) return;
    (async () => {
      setLoadingEvoNumeros(true);
      try {
        const res = await api.get<{ numeros: EvolutionNumero[] }>('/modules/campanhas/numeros-evolution');
        setEvoNumeros(res.numeros || []);
        if ((res.numeros || []).length === 1) setEvoNumeroId(res.numeros[0].id);
      } catch {
        setEvoNumeros([]);
      } finally {
        setLoadingEvoNumeros(false);
      }
    })();
  }, [campanhaId]);

  const variantBReady = !abTestEnabled || variantBMessageBody.trim().length > 0;
  const canSubmit = !!evoNumeroId && messageBody.trim().length > 0 && !!name.trim() && variantBReady;

  async function handleCreateCampanha(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const payload = {
        name, whatsappNumberId: evoNumeroId, channel: 'evolution', messageBody,
        ...(abTestEnabled ? { abTestEnabled: true, variantBMessageBody } : {}),
      };
      const res = await api.post<{ campanha: { id: string } }>('/modules/campanhas/', payload);
      setCampanhaId(res.campanha.id);
    } catch (err: any) {
      setCreateError(err?.message || 'Não foi possível criar a campanha.');
    } finally {
      setCreating(false);
    }
  }

  // ── 2. Números ────────────────────────────────────────────────────────────
  const reloadCampanha = useCallback(async () => {
    if (!campanhaId) return;
    const res = await api.get<{ campanha: CampanhaState }>(`/modules/campanhas/${campanhaId}`);
    setCampanha(res.campanha);
  }, [campanhaId]);

  useEffect(() => { if (campanhaId) reloadCampanha(); }, [campanhaId, reloadCampanha]);

  // ── 3. Enviar ─────────────────────────────────────────────────────────────
  const [consentAcknowledged, setConsentAcknowledged] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function runStart() {
    if (!campanhaId) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const needsAck = !campanha?.consentConfirmedAt;
      await api.post(`/modules/campanhas/${campanhaId}/start`, {
        ...(needsAck ? { confirmConsent: consentAcknowledged } : {}),
      });
      router.push(`/dashboard/campanhas/${campanhaId}`);
    } catch (err: any) {
      setActionError(err?.message || 'Não foi possível iniciar o disparo.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSchedule(e: FormEvent) {
    e.preventDefault();
    if (!scheduleAt || !campanhaId) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const needsAck = !campanha?.consentConfirmedAt;
      await api.post(`/modules/campanhas/${campanhaId}/schedule`, {
        scheduledAt: new Date(scheduleAt).toISOString(),
        ...(needsAck ? { confirmConsent: consentAcknowledged } : {}),
      });
      router.push(`/dashboard/campanhas/${campanhaId}`);
    } catch (err: any) {
      setActionError(err?.message || 'Não foi possível agendar a campanha.');
    } finally {
      setActionLoading(false);
    }
  }

  const canSend = !!campanha && campanha.audienceCount > 0
    && (!!campanha.consentConfirmedAt || consentAcknowledged);

  return (
    <div className="min-h-screen px-5 py-10">
      <div className="max-w-2xl mx-auto">
        <Link href="/dashboard/campanhas" className="text-sm text-brand-muted hover:text-brand-text">← Campanhas</Link>
        <h1 className="text-2xl font-bold mt-2 text-brand-text">
          {resumeId ? 'Continuar campanha' : 'Nova campanha'}
        </h1>
        <p className="text-sm text-brand-muted mt-1 mb-6">Escreva a mensagem, escolha os números e envie — tudo em um só lugar.</p>

        {/* ── 1. Campanha ─────────────────────────────────────────────────── */}
        {!campanha ? (
          <form onSubmit={handleCreateCampanha} className="card rounded-xl p-5 space-y-4">
            <div>
              <label className="block text-sm font-medium text-brand-text-secondary mb-1">Nome da campanha</label>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Aviso pros clientes de julho"
                className="input"
              />
            </div>

            {loadingEvoNumeros ? (
              <p className="text-sm text-brand-muted">Buscando seus números conectados…</p>
            ) : evoNumeros.length === 0 ? (
              <p className="text-sm text-brand-muted">
                Nenhum número conectado. Conecte um em{' '}
                <Link href="/dashboard/numeros" className="text-emerald-600 hover:text-emerald-500">/dashboard/numeros</Link>.
              </p>
            ) : evoNumeros.length > 1 ? (
              <div>
                <label className="block text-sm font-medium text-brand-text-secondary mb-1">Número de envio</label>
                <select required value={evoNumeroId} onChange={(e) => setEvoNumeroId(e.target.value)} className="input">
                  <option value="">Selecione…</option>
                  {evoNumeros.map((n) => (
                    <option key={n.id} value={n.id}>{n.displayName || n.phoneNumber || n.id}</option>
                  ))}
                </select>
              </div>
            ) : null}

            <div>
              <label className="block text-sm font-medium text-brand-text-secondary mb-1">Mensagem</label>
              <textarea
                required
                value={messageBody}
                onChange={(e) => setMessageBody(e.target.value)}
                rows={4}
                maxLength={4096}
                placeholder="Oi {{nome}}, tudo bem? ..."
                className="input"
              />
              <p className="mt-1 text-xs text-brand-muted">
                Use <code className="text-brand-text-secondary">{'{{nome}}'}</code> pra personalizar com o nome de cada contato
                (quando conhecido — senão usamos o telefone).
              </p>
            </div>

            <div className="inner-block">
              <label className="flex items-center gap-2 text-sm text-brand-text">
                <input type="checkbox" checked={abTestEnabled} onChange={(e) => setAbTestEnabled(e.target.checked)} />
                <span>Testar 2 versões (A/B) — divide a audiência 50/50</span>
              </label>
              {abTestEnabled && (
                <textarea
                  required={abTestEnabled}
                  value={variantBMessageBody}
                  onChange={(e) => setVariantBMessageBody(e.target.value)}
                  rows={3}
                  maxLength={4096}
                  placeholder="Mensagem da variante B…"
                  className="input mt-3"
                />
              )}
            </div>

            {createError && (
              <div className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-red-600 text-sm">
                {createError}
              </div>
            )}

            <button
              type="submit"
              disabled={creating || !canSubmit}
              className="btn-primary px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creating ? 'Criando…' : 'Continuar →'}
            </button>
          </form>
        ) : (
          <div className="card rounded-xl p-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xs text-brand-muted uppercase tracking-wide">Campanha</div>
              <div className="font-medium text-brand-text truncate">{campanha.name}</div>
            </div>
            <span className="text-xs rounded-full border border-brand-border px-2.5 py-1 text-brand-text-secondary whitespace-nowrap">
              {campanha.audienceCount} número{campanha.audienceCount === 1 ? '' : 's'}
            </span>
          </div>
        )}

        {/* ── 2. Números ───────────────────────────────────────────────────── */}
        {campanha && (
          <div className="mt-6">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-brand-muted mb-3">Números</h2>
            <AudienceImporter
              campanhaId={campanha.id}
              channel={campanha.channel}
              templateVarCount={campanha.templateVarCount}
              onImported={reloadCampanha}
            />
          </div>
        )}

        {/* ── 3. Enviar ────────────────────────────────────────────────────── */}
        {campanha && campanha.audienceCount > 0 && (
          <div className="mt-6 space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-brand-muted">Enviar</h2>

            {actionError && (
              <div className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-red-600 text-sm">
                {actionError}
              </div>
            )}

            {!campanha.consentConfirmedAt && (
              <label className="flex items-start gap-2 text-sm text-brand-text-secondary">
                <input
                  type="checkbox"
                  checked={consentAcknowledged}
                  onChange={(e) => setConsentAcknowledged(e.target.checked)}
                  className="mt-0.5"
                />
                <span>Confirmo que estes contatos já falaram comigo e assumo o risco de bloqueio do número em envios automatizados.</span>
              </label>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={runStart}
                disabled={actionLoading || !canSend}
                className="btn-primary px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {actionLoading ? 'Enviando…' : '▶ Enviar agora'}
              </button>
            </div>

            <form onSubmit={handleSchedule} className="flex flex-wrap items-center gap-2">
              <label className="text-sm text-brand-text-secondary">Ou agende para depois:</label>
              <input
                type="datetime-local"
                required
                value={scheduleAt}
                min={minDatetimeLocal()}
                onChange={(e) => setScheduleAt(e.target.value)}
                className="input w-auto"
              />
              <button
                type="submit"
                disabled={actionLoading || !scheduleAt || !canSend}
                className="btn-ghost disabled:opacity-50 disabled:cursor-not-allowed"
              >
                🗓️ Agendar disparo
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

export default function NovaCampanhaPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-brand-text-secondary">Carregando…</div>}>
      <NovaCampanhaInner />
    </Suspense>
  );
}
