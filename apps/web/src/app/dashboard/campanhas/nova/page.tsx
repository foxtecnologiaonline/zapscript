'use client';

import { useEffect, useState, useCallback, useRef, ChangeEvent, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import ConnectionCard, { MetaConnection } from '../_components/ConnectionCard';

interface MetaTemplateComponent {
  type: string;
  format?: string;
  text?: string;
}

interface MetaTemplate {
  id: string;
  name: string;
  status: string;
  category: string;
  language: string;
  components: MetaTemplateComponent[];
}

interface EvolutionNumero {
  id: string;
  phoneNumber: string | null;
  displayName: string | null;
}

interface ListaItem {
  id: string;
  name: string;
  contatosCount: number;
}

interface CampanhaState {
  id: string;
  status: string;
  channel: string;
  templateVarCount: number | null;
  audienceCount: number;
  consentConfirmedAt: string | null;
  whatsappNumberId: string;
}

function bodyOf(t: MetaTemplate) {
  return t.components?.find((c) => c.type === 'BODY');
}
function headerOf(t: MetaTemplate) {
  return t.components?.find((c) => c.type === 'HEADER');
}
function countVars(text?: string): number {
  if (!text) return 0;
  const nums = [...text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => parseInt(m[1], 10));
  return nums.length ? Math.max(...nums) : 0;
}
function hasComplexHeader(t: MetaTemplate): boolean {
  const h = headerOf(t);
  if (!h) return false;
  if (h.format && h.format !== 'TEXT') return true;
  if (h.format === 'TEXT' && countVars(h.text) > 0) return true;
  return false;
}
/** Valor mínimo aceito pelo <input type="datetime-local"> — pelo menos 5 min no futuro. */
function minDatetimeLocal(): string {
  const d = new Date(Date.now() + 5 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const STEPS = ['Campanha', 'Números', 'Enviar'] as const;

function Stepper({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className="mb-8 flex items-center">
      {STEPS.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const done = step > n;
        const active = step === n;
        return (
          <div key={label} className="flex items-center">
            <div className="flex items-center gap-2">
              <div
                className={`h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-xs font-semibold ${
                  active
                    ? 'bg-brand-primary text-white'
                    : done
                    ? 'bg-emerald-500/15 text-emerald-600'
                    : 'border border-brand-border text-brand-muted'
                }`}
              >
                {done ? '✓' : n}
              </div>
              <span className={`text-sm whitespace-nowrap ${active ? 'font-medium text-brand-text' : 'text-brand-muted'}`}>
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && <div className="w-8 sm:w-14 h-px bg-brand-border mx-2 sm:mx-3" />}
          </div>
        );
      })}
    </div>
  );
}

export default function NovaCampanhaPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [campanhaId, setCampanhaId] = useState<string | null>(null);
  const [campanha, setCampanha] = useState<CampanhaState | null>(null);

  // ── Passo 1: escolher campanha (canal, nome, template/mensagem) ─────────
  // Default 'evolution' — usa o número que o usuário já tem conectado no ZapScript
  // (o mesmo do core/Atende), sem exigir configurar WABA oficial da Meta antes de
  // conseguir disparar. Meta continua disponível pra quem quer volume maior/menos risco.
  const [channel, setChannel] = useState<'meta' | 'evolution'>('evolution');
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [meta, setMeta] = useState<MetaConnection | null | undefined>(undefined);
  const [templates, setTemplates] = useState<MetaTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState('');

  useEffect(() => {
    if (channel !== 'meta' || meta === undefined || !meta || campanhaId) return;
    (async () => {
      setLoadingTemplates(true);
      setTemplatesError(null);
      try {
        const res = await api.get<{ templates: MetaTemplate[] }>(
          `/modules/campanhas/templates?whatsappNumberId=${encodeURIComponent(meta.id)}`,
        );
        setTemplates(res.templates || []);
      } catch (e: any) {
        setTemplatesError(e?.message || 'Não foi possível buscar os templates aprovados.');
      } finally {
        setLoadingTemplates(false);
      }
    })();
  }, [channel, meta, campanhaId]);

  const selected = templates.find((t) => t.name === templateName);
  const varCount = selected ? countVars(bodyOf(selected)?.text) : 0;
  const complexHeader = selected ? hasComplexHeader(selected) : false;

  const [evoNumeros, setEvoNumeros] = useState<EvolutionNumero[]>([]);
  const [loadingEvoNumeros, setLoadingEvoNumeros] = useState(false);
  const [evoNumeroId, setEvoNumeroId] = useState('');
  const [messageBody, setMessageBody] = useState('');

  const [abTestEnabled, setAbTestEnabled] = useState(false);
  const [variantBTemplateName, setVariantBTemplateName] = useState('');
  const [variantBMessageBody, setVariantBMessageBody] = useState('');
  const variantBSelected = templates.find((t) => t.name === variantBTemplateName);

  useEffect(() => {
    if (channel !== 'evolution' || campanhaId) return;
    (async () => {
      setLoadingEvoNumeros(true);
      try {
        const res = await api.get<{ numeros: EvolutionNumero[] }>('/modules/campanhas/numeros-evolution');
        setEvoNumeros(res.numeros || []);
      } catch {
        setEvoNumeros([]);
      } finally {
        setLoadingEvoNumeros(false);
      }
    })();
  }, [channel, campanhaId]);

  const variantBReady = !abTestEnabled || (channel === 'meta' ? !!variantBSelected : variantBMessageBody.trim().length > 0);
  const canSubmitStep1 = (channel === 'meta'
    ? !!meta && !!selected && !!name
    : !!evoNumeroId && messageBody.trim().length > 0 && !!name) && variantBReady;

  async function handleCreateCampanha(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const payload = channel === 'meta'
        ? {
          name, whatsappNumberId: meta?.id, channel, templateName: selected?.name,
          templateLanguage: selected?.language, templateVarCount: varCount,
          ...(abTestEnabled ? {
            abTestEnabled: true,
            variantBTemplateName: variantBSelected?.name,
            variantBTemplateLanguage: variantBSelected?.language,
            variantBTemplateVarCount: variantBSelected ? countVars(bodyOf(variantBSelected)?.text) : undefined,
          } : {}),
        }
        : {
          name, whatsappNumberId: evoNumeroId, channel, messageBody,
          ...(abTestEnabled ? { abTestEnabled: true, variantBMessageBody } : {}),
        };
      const res = await api.post<{ campanha: { id: string } }>('/modules/campanhas/', payload);
      setCampanhaId(res.campanha.id);
      setStep(2);
    } catch (err: any) {
      setCreateError(err?.message || 'Não foi possível criar a campanha.');
    } finally {
      setCreating(false);
    }
  }

  // ── Passo 2: escolher números ─────────────────────────────────────────────
  const reloadCampanha = useCallback(async () => {
    if (!campanhaId) return;
    const res = await api.get<{ campanha: CampanhaState }>(`/modules/campanhas/${campanhaId}`);
    setCampanha(res.campanha);
  }, [campanhaId]);

  useEffect(() => { if (campanhaId) reloadCampanha(); }, [campanhaId, reloadCampanha]);

  const [listas, setListas] = useState<ListaItem[]>([]);
  const [selectedListaId, setSelectedListaId] = useState('');
  const [applyingLista, setApplyingLista] = useState(false);

  const [crmTags, setCrmTags] = useState<string[]>([]);
  const [selectedCrmTag, setSelectedCrmTag] = useState('');
  const [importingCrm, setImportingCrm] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [importingConversas, setImportingConversas] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [audienceMsg, setAudienceMsg] = useState<string | null>(null);
  const [audienceError, setAudienceError] = useState<string | null>(null);

  useEffect(() => {
    if (step !== 2 || !campanhaId) return;
    (async () => {
      try {
        const res = await api.get<{ listas: ListaItem[] }>('/modules/campanhas/listas');
        setListas(res.listas || []);
      } catch { /* seleção de lista salva é opcional */ }
      try {
        const res = await api.get<{ tags: string[] }>('/modules/campanhas/crm-tags');
        setCrmTags(res.tags || []);
      } catch { /* segmentação por tag é opcional */ }
    })();
  }, [step, campanhaId]);

  function fmtImportResult(res: { imported: number; skippedOptOut?: number; skippedDuplicate?: number; skippedInvalid?: number; skippedVarMismatch?: number; skippedCold?: number; elegiveis?: number }) {
    const base = res.elegiveis != null
      ? `${res.imported} de ${res.elegiveis} contato${res.elegiveis === 1 ? '' : 's'} elegíve${res.elegiveis === 1 ? 'l' : 'is'} importado${res.imported === 1 ? '' : 's'}.`
      : `${res.imported} contato${res.imported === 1 ? '' : 's'} importado${res.imported === 1 ? '' : 's'}.`;
    const extras = [
      res.skippedOptOut ? `${res.skippedOptOut} já em opt-out.` : '',
      res.skippedDuplicate ? `${res.skippedDuplicate} já estava(m) na campanha.` : '',
      res.skippedInvalid ? `${res.skippedInvalid} inválido(s).` : '',
      res.skippedVarMismatch ? `${res.skippedVarMismatch} com nº de variáveis diferente do template.` : '',
      res.skippedCold ? `${res.skippedCold} sem conversa recente (não elegível pro Evolution).` : '',
    ].filter(Boolean).join(' ');
    return extras ? `${base} ${extras}` : base;
  }

  async function handleApplyLista() {
    if (!campanhaId || !selectedListaId) return;
    setApplyingLista(true);
    setAudienceError(null);
    setAudienceMsg(null);
    try {
      const res = await api.post<any>(`/modules/campanhas/${campanhaId}/contatos/from-lista`, { listaId: selectedListaId });
      setAudienceMsg(fmtImportResult(res));
      await reloadCampanha();
    } catch (err: any) {
      setAudienceError(err?.message || 'Não foi possível aplicar a lista.');
    } finally {
      setApplyingLista(false);
    }
  }

  async function handleImportCrm() {
    if (!campanhaId || !selectedCrmTag) return;
    setImportingCrm(true);
    setAudienceError(null);
    setAudienceMsg(null);
    try {
      const res = await api.post<any>(`/modules/campanhas/${campanhaId}/contatos/from-crm`, { tag: selectedCrmTag });
      setAudienceMsg(fmtImportResult(res));
      await reloadCampanha();
    } catch (err: any) {
      setAudienceError(err?.message || 'Falha ao importar contatos por tag.');
    } finally {
      setImportingCrm(false);
    }
  }

  async function handleUploadCsv(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !campanhaId) return;
    setUploading(true);
    setAudienceError(null);
    setAudienceMsg(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.postFormData<any>(`/modules/campanhas/${campanhaId}/contatos`, fd);
      setAudienceMsg(fmtImportResult(res));
      await reloadCampanha();
    } catch (err: any) {
      setAudienceError(err?.message || 'Falha ao importar CSV.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleImportConversas() {
    if (!campanhaId) return;
    setImportingConversas(true);
    setAudienceError(null);
    setAudienceMsg(null);
    try {
      const res = await api.post<any>(`/modules/campanhas/${campanhaId}/contatos/from-conversas`, {});
      setAudienceMsg(fmtImportResult(res));
      await reloadCampanha();
    } catch (err: any) {
      setAudienceError(err?.message || 'Falha ao importar contatos.');
    } finally {
      setImportingConversas(false);
    }
  }

  // ── Passo 3: revisar e enviar ─────────────────────────────────────────────
  const [consentAcknowledged, setConsentAcknowledged] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [tierExceeded, setTierExceeded] = useState<{ tier: string; cap: number; count: number } | null>(null);

  async function runStart(extra?: Record<string, any>) {
    if (!campanhaId) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const needsAck = !campanha?.consentConfirmedAt;
      await api.post(`/modules/campanhas/${campanhaId}/start`, {
        ...(needsAck ? { confirmConsent: consentAcknowledged } : {}),
        ...extra,
      });
      router.push(`/dashboard/campanhas/${campanhaId}`);
    } catch (err: any) {
      if (typeof err?.metaTierCap === 'number') {
        setTierExceeded({ tier: err.metaMessagingLimitTier, cap: err.metaTierCap, count: err.pendentesCount });
      } else {
        setActionError(err?.message || 'Não foi possível iniciar o disparo.');
      }
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
      if (typeof err?.metaTierCap === 'number') {
        setTierExceeded({ tier: err.metaMessagingLimitTier, cap: err.metaTierCap, count: err.pendentesCount });
      } else {
        setActionError(err?.message || 'Não foi possível agendar a campanha.');
      }
    } finally {
      setActionLoading(false);
    }
  }

  const canSendStep3 = !!campanha && campanha.audienceCount > 0
    && (!!campanha.consentConfirmedAt || consentAcknowledged);

  return (
    <div className="min-h-screen px-5 py-10">
      <div className="max-w-2xl mx-auto">
        <Link href="/dashboard/campanhas" className="text-sm text-brand-muted hover:text-brand-text">← Campanhas</Link>
        <h1 className="text-2xl font-bold mt-2 mb-6 text-brand-text">Nova campanha</h1>

        <Stepper step={step} />

        {/* ── Passo 1 — Campanha ──────────────────────────────────────────── */}
        {step === 1 && (
          <>
            <div className="mb-6 flex rounded-lg border border-brand-border overflow-hidden text-sm">
              <button
                type="button"
                onClick={() => setChannel('evolution')}
                className={`flex-1 px-4 py-2 font-medium ${channel === 'evolution' ? 'bg-brand-primary text-white' : 'bg-brand-elevated text-brand-text-secondary hover:text-brand-text'}`}
              >
                Meu número atual (recomendado)
              </button>
              <button
                type="button"
                onClick={() => setChannel('meta')}
                className={`flex-1 px-4 py-2 font-medium ${channel === 'meta' ? 'bg-brand-primary text-white' : 'bg-brand-elevated text-brand-text-secondary hover:text-brand-text'}`}
              >
                WhatsApp oficial (Meta)
              </button>
            </div>

            {channel === 'meta' ? (
              <>
                <div className="mb-6">
                  <ConnectionCard onReady={setMeta} />
                </div>

                {meta && (
                  <>
                    <div className="mb-6 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-brand-text-secondary">
                      ⚠️ <strong className="text-brand-text">Números novos na API oficial começam com um limite diário de envio</strong>{' '}
                      definido pela própria Meta, que sobe conforme o número acumula histórico de boas
                      entregas. Se sua campanha tiver muitos contatos, o disparo pode ficar limitado nos
                      primeiros dias — isso é normal e não depende do ZapScript.
                    </div>

                    <form onSubmit={handleCreateCampanha} className="space-y-5">
                      <div>
                        <label className="block text-sm font-medium text-brand-text-secondary mb-1">Nome da campanha</label>
                        <input
                          required
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="Ex: Promoção de julho"
                          className="input"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-brand-text-secondary mb-1">Template aprovado</label>
                        {loadingTemplates ? (
                          <p className="text-sm text-brand-muted">Buscando templates aprovados na Meta…</p>
                        ) : templatesError ? (
                          <p className="text-sm text-red-500">{templatesError}</p>
                        ) : templates.length === 0 ? (
                          <p className="text-sm text-brand-muted">
                            Nenhum template aprovado encontrado. Crie e aguarde aprovação no Gerenciador de Negócios da Meta.
                          </p>
                        ) : (
                          <select
                            required
                            value={templateName}
                            onChange={(e) => setTemplateName(e.target.value)}
                            className="input"
                          >
                            <option value="">Selecione…</option>
                            {templates.map((t) => (
                              <option key={t.id} value={t.name}>
                                {t.name} ({t.language})
                              </option>
                            ))}
                          </select>
                        )}
                      </div>

                      {selected && (
                        <div className="inner-block text-sm">
                          <div className="text-brand-muted mb-1">Prévia do corpo da mensagem:</div>
                          <div className="whitespace-pre-wrap text-brand-text">{bodyOf(selected)?.text}</div>
                          {varCount > 0 && (
                            <p className="mt-3 text-emerald-600">
                              {varCount === 1
                                ? 'Este template usa 1 variável — inclua na coluna 3 do seu CSV de contatos.'
                                : `Este template usa ${varCount} variáveis — inclua nas colunas 3 a ${2 + varCount} do seu CSV de contatos, nessa ordem.`}
                            </p>
                          )}
                          {complexHeader && (
                            <p className="mt-3 text-amber-600">
                              ⚠️ Este template tem cabeçalho com mídia ou variável — não suportado neste fluxo simples. O
                              envio usará apenas o corpo do template.
                            </p>
                          )}
                        </div>
                      )}

                      <div className="inner-block">
                        <label className="flex items-center gap-2 text-sm text-brand-text">
                          <input type="checkbox" checked={abTestEnabled} onChange={(e) => setAbTestEnabled(e.target.checked)} />
                          <span>Testar 2 versões (A/B) — divide a audiência 50/50, só reporta as métricas por variante</span>
                        </label>
                        {abTestEnabled && (
                          <div className="mt-3">
                            <label className="block text-sm font-medium text-brand-text-secondary mb-1">Template da variante B</label>
                            <select
                              required={abTestEnabled}
                              value={variantBTemplateName}
                              onChange={(e) => setVariantBTemplateName(e.target.value)}
                              className="input"
                            >
                              <option value="">Selecione…</option>
                              {templates.map((t) => (
                                <option key={t.id} value={t.name}>{t.name} ({t.language})</option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>

                      {createError && (
                        <div className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-red-600 text-sm">
                          {createError}
                        </div>
                      )}

                      <button
                        type="submit"
                        disabled={creating || !canSubmitStep1}
                        className="btn-primary px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {creating ? 'Criando…' : 'Próximo: escolher números →'}
                      </button>
                    </form>
                  </>
                )}
              </>
            ) : (
              <>
                <div className="mb-6 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-brand-text-secondary">
                  ⚠️ <strong className="text-brand-text">Isto não é a API oficial do WhatsApp.</strong> Usa o mesmo número que você já
                  conectou pra transcrição/Atende — e o WhatsApp pode banir números usados pra envio em
                  massa automatizado. Por isso: só contatos que já falaram com você (sem CSV livre) e um
                  ritmo de envio bem mais lento e espaçado. Você vai precisar confirmar que entende o
                  risco antes de iniciar o disparo.
                </div>

                <form onSubmit={handleCreateCampanha} className="space-y-5">
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

                  <div>
                    <label className="block text-sm font-medium text-brand-text-secondary mb-1">Número Evolution</label>
                    {loadingEvoNumeros ? (
                      <p className="text-sm text-brand-muted">Buscando seus números conectados…</p>
                    ) : evoNumeros.length === 0 ? (
                      <p className="text-sm text-brand-muted">
                        Nenhum número Evolution conectado. Conecte um em{' '}
                        <Link href="/dashboard/numeros" className="text-emerald-600 hover:text-emerald-500">/dashboard/numeros</Link>.
                      </p>
                    ) : (
                      <select
                        required
                        value={evoNumeroId}
                        onChange={(e) => setEvoNumeroId(e.target.value)}
                        className="input"
                      >
                        <option value="">Selecione…</option>
                        {evoNumeros.map((n) => (
                          <option key={n.id} value={n.id}>
                            {n.displayName || n.phoneNumber || n.id}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

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
                      <span>Testar 2 versões (A/B) — divide a audiência 50/50, só reporta as métricas por variante</span>
                    </label>
                    {abTestEnabled && (
                      <div className="mt-3">
                        <label className="block text-sm font-medium text-brand-text-secondary mb-1">Mensagem da variante B</label>
                        <textarea
                          required={abTestEnabled}
                          value={variantBMessageBody}
                          onChange={(e) => setVariantBMessageBody(e.target.value)}
                          rows={4}
                          maxLength={4096}
                          placeholder="Oi {{nome}}, tudo bem? ..."
                          className="input"
                        />
                      </div>
                    )}
                  </div>

                  {createError && (
                    <div className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-red-600 text-sm">
                      {createError}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={creating || !canSubmitStep1}
                    className="btn-primary px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {creating ? 'Criando…' : 'Próximo: escolher números →'}
                  </button>
                </form>
              </>
            )}
          </>
        )}

        {/* ── Passo 2 — Números ───────────────────────────────────────────── */}
        {step === 2 && campanha && (
          <div className="space-y-5">
            <div className="card rounded-xl p-4 flex items-center justify-between">
              <span className="text-sm text-brand-text-secondary">Números nesta campanha</span>
              <span className="text-lg font-semibold text-brand-text">{campanha.audienceCount}</span>
            </div>

            {audienceError && (
              <div className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-red-600 text-sm">
                {audienceError}
              </div>
            )}
            {audienceMsg && (
              <div className="card rounded-lg p-3 text-sm text-brand-text-secondary">{audienceMsg}</div>
            )}

            {listas.length > 0 && (
              <div className="card rounded-xl p-4">
                <h2 className="text-sm font-semibold text-brand-text">Usar uma lista salva</h2>
                <p className="mt-1 text-xs text-brand-muted">
                  {campanha.channel === 'meta' && campanha.templateVarCount
                    ? 'Este template usa variáveis — listas salvas não preenchem variáveis automaticamente. Use o upload de CSV abaixo.'
                    : 'Aplica os números de uma lista que você já montou antes.'}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <select
                    value={selectedListaId}
                    onChange={(e) => setSelectedListaId(e.target.value)}
                    disabled={campanha.channel === 'meta' && !!campanha.templateVarCount}
                    className="input w-auto"
                  >
                    <option value="">Selecione uma lista…</option>
                    {listas.map((l) => (
                      <option key={l.id} value={l.id}>{l.name} ({l.contatosCount})</option>
                    ))}
                  </select>
                  <button
                    onClick={handleApplyLista}
                    disabled={!selectedListaId || applyingLista || (campanha.channel === 'meta' && !!campanha.templateVarCount)}
                    className="btn-ghost text-xs disabled:opacity-50"
                  >
                    {applyingLista ? 'Aplicando…' : '📋 Usar esta lista'}
                  </button>
                </div>
              </div>
            )}

            {campanha.channel === 'evolution' ? (
              <div className="card rounded-xl p-4">
                <h2 className="text-sm font-semibold text-brand-text">Importar contatos que já falaram com você</h2>
                <p className="mt-1 text-xs text-brand-muted">
                  Guardrail do canal Evolution: só contatos com conversa recente entram na campanha.
                </p>
                <button
                  onClick={handleImportConversas}
                  disabled={importingConversas}
                  className="btn-ghost text-xs mt-3 disabled:opacity-50"
                >
                  {importingConversas ? 'Importando…' : '💬 Importar contatos'}
                </button>
              </div>
            ) : (
              <div className="card rounded-xl p-4">
                <h2 className="text-sm font-semibold text-brand-text">Importar CSV</h2>
                <p className="mt-1 text-xs text-brand-muted">
                  Coluna 1 = telefone (obrigatório) · coluna 2 = nome (opcional) · colunas 3+ = variáveis do
                  template, na ordem.
                </p>
                <label className="btn-ghost text-xs mt-3 cursor-pointer inline-block">
                  {uploading ? 'Importando…' : '📄 Escolher arquivo'}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    onChange={handleUploadCsv}
                    disabled={uploading}
                    className="hidden"
                  />
                </label>
              </div>
            )}

            {crmTags.length > 0 && (
              <div className="card rounded-xl p-4">
                <h2 className="text-sm font-semibold text-brand-text">Segmentar por tag do CRM</h2>
                <p className="mt-1 text-xs text-brand-muted">
                  Importa só os contatos do seu CRM com a tag escolhida
                  {campanha.channel === 'evolution' ? ' (ainda restrito a quem já falou com você).' : '.'}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <select
                    value={selectedCrmTag}
                    onChange={(e) => setSelectedCrmTag(e.target.value)}
                    className="input w-auto"
                  >
                    <option value="">Selecione uma tag…</option>
                    {crmTags.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  <button
                    onClick={handleImportCrm}
                    disabled={!selectedCrmTag || importingCrm}
                    className="btn-ghost text-xs disabled:opacity-50"
                  >
                    {importingCrm ? 'Importando…' : '🏷️ Importar por tag'}
                  </button>
                </div>
              </div>
            )}

            <p className="text-xs text-brand-muted">
              Precisa de uma lista nova? <Link href="/dashboard/campanhas/listas" className="text-emerald-600 hover:text-emerald-500">Crie uma em Listas de números →</Link>
            </p>

            <button
              onClick={() => setStep(3)}
              disabled={campanha.audienceCount === 0}
              className="btn-primary px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Próximo: revisar e enviar →
            </button>
          </div>
        )}

        {/* ── Passo 3 — Revisar e enviar ──────────────────────────────────── */}
        {step === 3 && campanha && (
          <div className="space-y-5">
            <button
              onClick={() => setStep(2)}
              className="text-xs text-brand-muted hover:text-brand-text"
            >
              ← Voltar e ajustar os números
            </button>

            <div className="card rounded-xl p-4">
              <h2 className="text-sm font-semibold text-brand-text">Resumo</h2>
              <dl className="mt-3 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-brand-muted">Nome</dt>
                  <dd className="text-brand-text">{name}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-brand-muted">Canal</dt>
                  <dd className="text-brand-text">{campanha.channel === 'evolution' ? 'Evolution (meu número)' : 'WhatsApp oficial (Meta)'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-brand-muted">Números</dt>
                  <dd className="text-brand-text font-semibold">{campanha.audienceCount}</dd>
                </div>
              </dl>
            </div>

            {actionError && (
              <div className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-red-600 text-sm">
                {actionError}
              </div>
            )}

            {tierExceeded && (
              <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-brand-text-secondary space-y-3">
                <p>
                  ⚠️ Seu número está no tier <strong className="text-brand-text">{tierExceeded.tier}</strong> da Meta — até{' '}
                  <strong className="text-brand-text">{tierExceeded.cap.toLocaleString('pt-BR')}</strong> contatos únicos por 24h.
                  Esta campanha tem <strong className="text-brand-text">{tierExceeded.count.toLocaleString('pt-BR')}</strong> contatos
                  pendentes, acima desse limite. A Meta pode rejeitar parte dos envios em massa se você prosseguir agora.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => runStart({ confirmExceedsTier: true })}
                    disabled={actionLoading}
                    className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500 disabled:opacity-50"
                  >
                    Prosseguir mesmo assim
                  </button>
                  <button
                    onClick={() => setTierExceeded(null)}
                    className="rounded-lg border border-amber-400/30 px-3 py-1.5 text-xs text-amber-600 hover:bg-amber-400/10"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {campanha.channel === 'evolution' && (
              <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-brand-text-secondary space-y-3">
                <p>
                  ⚠️ Este envio usa o seu número Evolution comum, não a API oficial do WhatsApp.
                  O WhatsApp pode banir o número usado para envio em massa automatizado — o
                  <strong className="text-brand-text"> mesmo número que também atende core/Atende/Copiloto</strong>. Por isso o
                  disparo é deliberadamente lento e restrito a contatos que já conversaram com você.
                </p>
                {!campanha.consentConfirmedAt && (
                  <label className="flex items-start gap-2 text-brand-text">
                    <input
                      type="checkbox"
                      checked={consentAcknowledged}
                      onChange={(e) => setConsentAcknowledged(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>Entendo o risco de banimento e vou usar isso só com clientes que já falaram comigo.</span>
                  </label>
                )}
              </div>
            )}

            {campanha.channel !== 'evolution' && !campanha.consentConfirmedAt && (
              <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-brand-text-secondary space-y-3">
                <p>
                  Antes de iniciar, confirme que você tem consentimento (opt-in) dos contatos desta
                  lista para receber mensagens de marketing — exigido pela LGPD e pela política da Meta.
                </p>
                <label className="flex items-start gap-2 text-brand-text">
                  <input
                    type="checkbox"
                    checked={consentAcknowledged}
                    onChange={(e) => setConsentAcknowledged(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>Confirmo que tenho consentimento destes contatos para campanhas de marketing.</span>
                </label>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => runStart()}
                disabled={actionLoading || !canSendStep3}
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
                disabled={actionLoading || !scheduleAt || !canSendStep3}
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
