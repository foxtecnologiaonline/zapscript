'use client';

import { useEffect, useState, useCallback, FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import AudienceImporter from '../_components/AudienceImporter';

interface Campanha {
  id: string;
  name: string;
  status: string;
  channel: string; // 'meta' | 'evolution'
  templateName: string | null;
  templateLanguage: string;
  templateVarCount: number | null;
  messageBody: string | null;
  consentConfirmedAt: string | null;
  audienceCount: number;
  sentCount: number;
  processedCount: number;
  poolNumberIds: string[];
  pausedReason: string | null;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  sequenceParentId: string | null;
  abTestEnabled: boolean;
  whatsappNumber: {
    id: string; phoneNumber: string | null; displayName: string | null;
    metaMessagingLimitTier: string | null; metaQualityRating: string | null;
  } | null;
}

interface PoolCandidate {
  id: string;
  phoneNumber: string | null;
  displayName: string | null;
  status: string;
}

interface PoolNumberInfo {
  id: string;
  phoneNumber: string | null;
  displayName: string | null;
}

interface Contato {
  id: string;
  phone: string;
  name: string | null;
  status: string;
  errorMessage: string | null;
  createdAt: string;
}

interface MetaTemplateComponent {
  type: string;
  format?: string;
  text?: string;
}

interface MetaTemplate {
  id: string;
  name: string;
  language: string;
  components: MetaTemplateComponent[];
}

interface SequenceStep {
  id: string;
  name: string;
  status: string;
  sequenceIndex: number;
  sequenceDelayDays: number;
  scheduledAt: string | null;
}

interface SequenceParent {
  id: string;
  name: string;
}

function bodyOf(t: MetaTemplate) {
  return t.components?.find((c) => c.type === 'BODY');
}
function countVars(text?: string): number {
  if (!text) return 0;
  const nums = [...text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => parseInt(m[1], 10));
  return nums.length ? Math.max(...nums) : 0;
}

const CAMP_STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho',
  scheduled: 'Agendada',
  running: 'Em andamento',
  paused: 'Pausada',
  completed: 'Concluída',
  canceled: 'Cancelada',
  failed: 'Falhou',
};

const CONTATO_STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente',
  sent: 'Enviado',
  delivered: 'Entregue',
  read: 'Lido',
  failed: 'Falhou',
  optout: 'Opt-out',
};

const CONTATO_STATUS_COLOR: Record<string, string> = {
  pending: 'text-brand-muted',
  sent: 'text-blue-500',
  delivered: 'text-emerald-600',
  read: 'text-emerald-500',
  failed: 'text-red-500',
  optout: 'text-amber-600',
};

/** Valor mínimo aceito pelo <input type="datetime-local"> — pelo menos 5 min no futuro. */
function minDatetimeLocal(): string {
  const d = new Date(Date.now() + 5 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Estimativa simples de tempo restante (item 4) a partir do ritmo observado desde o início — sem depender de dados extras do backend. */
function estimateEta(c: Campanha): string | null {
  if (c.status !== 'running' || !c.startedAt || c.processedCount <= 0) return null;
  const elapsedMin = (Date.now() - new Date(c.startedAt).getTime()) / 60000;
  const remaining = c.audienceCount - c.processedCount;
  if (elapsedMin <= 0 || remaining <= 0) return null;
  const rate = c.processedCount / elapsedMin;
  if (rate <= 0) return null;
  const etaMin = remaining / rate;
  if (etaMin < 1) return 'menos de 1 min restante';
  if (etaMin < 60) return `~${Math.ceil(etaMin)} min restantes`;
  const h = Math.floor(etaMin / 60);
  const m = Math.round(etaMin % 60);
  return `~${h}h${m > 0 ? ` ${m}min` : ''} restantes`;
}

const CONTATOS_PAGE_SIZE = 100;

export default function CampanhaDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [campanha, setCampanha] = useState<Campanha | null>(null);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [activeTab, setActiveTab] = useState<'audiencia' | 'avancado'>('audiencia');

  const [contatos, setContatos] = useState<Contato[]>([]);
  const [contatosTotal, setContatosTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);

  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');
  const [consentAcknowledged, setConsentAcknowledged] = useState(false);
  const [tierExceeded, setTierExceeded] = useState<{ tier: string; cap: number; count: number } | null>(null);

  const [testPhone, setTestPhone] = useState('');
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const [poolCandidates, setPoolCandidates] = useState<PoolCandidate[]>([]);
  const [poolSelected, setPoolSelected] = useState<string[]>([]);
  const [poolSaving, setPoolSaving] = useState(false);
  const [poolMessage, setPoolMessage] = useState<string | null>(null);
  const [statsByNumber, setStatsByNumber] = useState<Record<string, Record<string, number>> | undefined>();
  const [poolNumbersInfo, setPoolNumbersInfo] = useState<PoolNumberInfo[] | undefined>();

  // ── Sequência/drip (§15.2) ───────────────────────────────────────────────
  const [sequenceSteps, setSequenceSteps] = useState<SequenceStep[] | undefined>();
  const [sequenceParent, setSequenceParent] = useState<SequenceParent | undefined>();
  const [templates, setTemplates] = useState<MetaTemplate[]>([]);
  const [showSequenceForm, setShowSequenceForm] = useState(false);
  const [seqSteps, setSeqSteps] = useState<{ delayDays: string; templateName: string; messageBody: string }[]>([
    { delayDays: '3', templateName: '', messageBody: '' },
  ]);
  const [seqSaving, setSeqSaving] = useState(false);
  const [seqError, setSeqError] = useState<string | null>(null);

  // ── A/B test (§15.3) ──────────────────────────────────────────────────────
  const [statsByVariant, setStatsByVariant] = useState<Record<string, Record<string, number>> | undefined>();

  const loadCampanha = useCallback(async () => {
    try {
      const res = await api.get<{
        campanha: Campanha; stats: Record<string, number>;
        statsByNumber?: Record<string, Record<string, number>>;
        poolNumbers?: PoolNumberInfo[];
        sequenceSteps?: SequenceStep[];
        sequenceParent?: SequenceParent;
        statsByVariant?: Record<string, Record<string, number>>;
      }>(`/modules/campanhas/${id}`);
      setCampanha(res.campanha);
      setStats(res.stats || {});
      setStatsByNumber(res.statsByNumber);
      setPoolNumbersInfo(res.poolNumbers);
      setSequenceSteps(res.sequenceSteps);
      setSequenceParent(res.sequenceParent);
      setStatsByVariant(res.statsByVariant);
    } catch (e: any) {
      if (e?.error === 'Campanha não encontrada.') setNotFound(true);
      else if (e?.statusCode !== 401) setError(e?.message || 'Não foi possível carregar a campanha.');
    }
  }, [id]);

  const loadContatos = useCallback(async () => {
    try {
      const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}&limit=${CONTATOS_PAGE_SIZE}` : `?limit=${CONTATOS_PAGE_SIZE}`;
      const res = await api.get<{ contatos: Contato[]; total: number }>(`/modules/campanhas/${id}/contatos${qs}`);
      setContatos(res.contatos || []);
      setContatosTotal(res.total || 0);
    } catch {
      /* erro de carregamento da campanha acima já cobre o estado visível */
    }
  }, [id, statusFilter]);

  async function handleLoadMoreContatos() {
    setLoadingMore(true);
    try {
      const qs = new URLSearchParams({ limit: String(CONTATOS_PAGE_SIZE), offset: String(contatos.length) });
      if (statusFilter) qs.set('status', statusFilter);
      const res = await api.get<{ contatos: Contato[]; total: number }>(`/modules/campanhas/${id}/contatos?${qs}`);
      setContatos((prev) => [...prev, ...(res.contatos || [])]);
      setContatosTotal(res.total || 0);
    } catch {
      /* falha ao paginar não precisa de banner próprio — usuário pode tentar de novo */
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([loadCampanha(), loadContatos()]);
      setLoading(false);
    })();
  }, [loadCampanha, loadContatos]);

  // Poll enquanto a campanha está em andamento, para refletir progresso ao vivo.
  useEffect(() => {
    if (campanha?.status !== 'running') return;
    const t = setInterval(() => {
      loadCampanha();
      loadContatos();
    }, 5000);
    return () => clearInterval(t);
  }, [campanha?.status, loadCampanha, loadContatos]);

  // Pool de números (item 2) — só faz sentido editar antes/entre disparos.
  const canEditPool = campanha ? ['draft', 'scheduled', 'paused'].includes(campanha.status) : false;
  useEffect(() => {
    if (!id || !canEditPool) return;
    (async () => {
      try {
        const res = await api.get<{ numeros: PoolCandidate[] }>(`/modules/campanhas/${id}/pool-candidates`);
        setPoolCandidates(res.numeros || []);
      } catch {
        /* pool é um recurso opcional — falha aqui não deve travar a tela */
      }
    })();
  }, [id, canEditPool]);
  useEffect(() => {
    if (campanha) setPoolSelected(campanha.poolNumberIds || []);
  }, [campanha?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Templates Meta (§15.2) — só pra montar os passos de uma sequência nova.
  useEffect(() => {
    if (!campanha || campanha.channel !== 'meta' || campanha.status !== 'draft' || !campanha.whatsappNumber) return;
    (async () => {
      try {
        const res = await api.get<{ templates: MetaTemplate[] }>(
          `/modules/campanhas/templates?whatsappNumberId=${encodeURIComponent(campanha.whatsappNumber!.id)}`,
        );
        setTemplates(res.templates || []);
      } catch {
        setTemplates([]);
      }
    })();
  }, [campanha?.id, campanha?.channel, campanha?.status, campanha?.whatsappNumber?.id]);

  async function handleSavePool() {
    setPoolSaving(true);
    setPoolMessage(null);
    try {
      await api.post(`/modules/campanhas/${id}/pool`, { numberIds: poolSelected });
      setPoolMessage('Pool salvo.');
      await loadCampanha();
    } catch (err: any) {
      setPoolMessage(err?.message || 'Não foi possível salvar o pool.');
    } finally {
      setPoolSaving(false);
    }
  }

  async function handleTestSend(e: FormEvent) {
    e.preventDefault();
    if (!testPhone.trim()) return;
    setTestSending(true);
    setTestResult(null);
    try {
      await api.post(`/modules/campanhas/${id}/test-send`, { phone: testPhone.trim() });
      setTestResult({ ok: true, message: 'Mensagem de teste enviada.' });
    } catch (err: any) {
      setTestResult({ ok: false, message: err?.message || 'Falha ao enviar teste.' });
    } finally {
      setTestSending(false);
    }
  }

  async function runAction(action: 'start' | 'pause' | 'cancel' | 'unschedule', extra?: Record<string, any>) {
    setActionLoading(true);
    setActionError(null);
    try {
      const needsAck = action === 'start' && !campanha?.consentConfirmedAt;
      await api.post(`/modules/campanhas/${id}/${action}`, {
        ...(needsAck ? { confirmConsent: consentAcknowledged } : {}),
        ...extra,
      });
      setTierExceeded(null);
      await loadCampanha();
    } catch (err: any) {
      if (action === 'start' && typeof err?.metaTierCap === 'number') {
        setTierExceeded({ tier: err.metaMessagingLimitTier, cap: err.metaTierCap, count: err.pendentesCount });
      } else {
        setActionError(err?.message || 'Ação falhou.');
      }
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSchedule(e: FormEvent) {
    e.preventDefault();
    if (!scheduleAt) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const needsAck = !campanha?.consentConfirmedAt;
      await api.post(`/modules/campanhas/${id}/schedule`, {
        scheduledAt: new Date(scheduleAt).toISOString(),
        ...(needsAck ? { confirmConsent: consentAcknowledged } : {}),
      });
      setScheduleAt('');
      await loadCampanha();
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

  function addSeqStep() {
    setSeqSteps((prev) => (prev.length >= 5 ? prev : [...prev, { delayDays: '3', templateName: '', messageBody: '' }]));
  }
  function removeSeqStep(i: number) {
    setSeqSteps((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)));
  }
  function updateSeqStep(i: number, patch: Partial<{ delayDays: string; templateName: string; messageBody: string }>) {
    setSeqSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  async function handleCreateSequence(e: FormEvent) {
    e.preventDefault();
    if (!campanha) return;
    setSeqSaving(true);
    setSeqError(null);
    try {
      const steps = seqSteps.map((s) => {
        const delayDays = parseInt(s.delayDays, 10);
        if (campanha.channel === 'meta') {
          const tpl = templates.find((t) => t.name === s.templateName);
          return {
            delayDays,
            templateName: tpl?.name,
            templateLanguage: tpl?.language,
            templateVarCount: tpl ? countVars(bodyOf(tpl)?.text) : undefined,
          };
        }
        return { delayDays, messageBody: s.messageBody };
      });
      await api.post(`/modules/campanhas/${id}/sequence`, { steps });
      setShowSequenceForm(false);
      setSeqSteps([{ delayDays: '3', templateName: '', messageBody: '' }]);
      await loadCampanha();
    } catch (err: any) {
      setSeqError(err?.message || 'Não foi possível criar a sequência.');
    } finally {
      setSeqSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Excluir esta campanha? Esta ação não pode ser desfeita.')) return;
    setActionLoading(true);
    try {
      await api.delete(`/modules/campanhas/${id}`);
      router.push('/dashboard/campanhas');
    } catch (err: any) {
      setActionError(err?.message || 'Não foi possível excluir.');
      setActionLoading(false);
    }
  }

  async function handleCancel() {
    if (!confirm('Cancelar esta campanha? Contatos ainda não enviados não receberão a mensagem.')) return;
    await runAction('cancel');
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-brand-text-secondary">
        Carregando…
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="mb-4 text-brand-text">Campanha não encontrada.</p>
          <Link href="/dashboard/campanhas" className="text-emerald-600 hover:text-emerald-500">← Voltar</Link>
        </div>
      </div>
    );
  }

  if (!campanha) {
    return (
      <div className="min-h-screen flex items-center justify-center text-red-500 px-5 text-center">
        {error || 'Erro ao carregar campanha.'}
      </div>
    );
  }

  const canCreateSequence = campanha.status === 'draft' && campanha.audienceCount > 0
    && !campanha.sequenceParentId && (!sequenceSteps || sequenceSteps.length === 0);
  const seqStepsReady = seqSteps.every((s) => {
    const d = parseInt(s.delayDays, 10);
    if (!(d >= 1 && d <= 90)) return false;
    return campanha.channel === 'meta' ? !!s.templateName : s.messageBody.trim().length > 0;
  });

  const progressPct = campanha.audienceCount > 0 ? Math.min(100, (campanha.processedCount / campanha.audienceCount) * 100) : 0;
  const showProgress = campanha.audienceCount > 0 && ['running', 'paused', 'completed'].includes(campanha.status);
  const eta = estimateEta(campanha);

  const statCards: [string, number, string][] = [
    ['Contatos', campanha.audienceCount, ''],
    ['Enviados', campanha.sentCount, ''],
    ['Entregues', stats.delivered || 0, ''],
    ['Lidos', stats.read || 0, ''],
    ['Falharam', stats.failed || 0, 'text-red-500'],
    ['Opt-out', stats.optout || 0, 'text-amber-600'],
  ];

  return (
    <div className="min-h-screen px-5 py-10">
      <div className="max-w-3xl mx-auto">
        <Link href="/dashboard/campanhas" className="text-sm text-brand-muted hover:text-brand-text">← Campanhas</Link>

        <div className="mt-2 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-brand-text">{campanha.name}</h1>
            <p className="text-brand-text-secondary mt-1 text-sm">
              {campanha.channel === 'evolution'
                ? `Mensagem livre (Evolution): "${campanha.messageBody?.slice(0, 60)}${(campanha.messageBody?.length || 0) > 60 ? '…' : ''}"`
                : `Template: ${campanha.templateName} (${campanha.templateLanguage})`}
              {campanha.whatsappNumber?.displayName ? ` · ${campanha.whatsappNumber.displayName}` : ''}
            </p>
            {campanha.channel !== 'evolution'
              && (campanha.whatsappNumber?.metaMessagingLimitTier || campanha.whatsappNumber?.metaQualityRating) && (
              <p className="mt-1 text-xs text-brand-muted">
                Meta: tier {campanha.whatsappNumber?.metaMessagingLimitTier || '—'}
                {campanha.whatsappNumber?.metaQualityRating ? ` · qualidade ${campanha.whatsappNumber.metaQualityRating}` : ''}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="text-xs rounded-full border border-brand-border px-2.5 py-1 text-brand-text-secondary whitespace-nowrap">
              {CAMP_STATUS_LABEL[campanha.status] || campanha.status}
            </span>
            {campanha.channel === 'evolution' && (
              <span className="text-xs rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-amber-600 whitespace-nowrap">
                ⚠️ Evolution (experimental)
              </span>
            )}
          </div>
        </div>

        {campanha.status === 'scheduled' && campanha.scheduledAt && (
          <p className="mt-2 text-sm text-emerald-600">
            🗓️ Agendada para {new Date(campanha.scheduledAt).toLocaleString('pt-BR')}
          </p>
        )}

        {campanha.status === 'paused' && campanha.pausedReason && (
          <div className="mt-4 rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-brand-text-secondary">
            ⛔ {campanha.pausedReason}
          </div>
        )}

        <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {statCards.map(([label, value, color]) => (
            <div key={label} className="card rounded-lg p-3 text-center">
              <div className={`text-lg font-semibold ${color || 'text-brand-text'}`}>{value}</div>
              <div className="text-[11px] text-brand-muted">{label}</div>
            </div>
          ))}
        </div>

        {showProgress && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-brand-muted mb-1">
              <span>{Math.round(progressPct)}% processado ({campanha.processedCount} de {campanha.audienceCount})</span>
              {eta && <span>{eta}</span>}
            </div>
            <div className="h-2 rounded-full bg-brand-elevated overflow-hidden">
              <div
                className={`h-full transition-all ${campanha.status === 'completed' ? 'bg-emerald-500' : 'bg-brand-primary'}`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        {actionError && (
          <div className="mt-4 rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-red-600 text-sm">
            {actionError}
          </div>
        )}

        {tierExceeded && (
          <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-brand-text-secondary space-y-3">
            <p>
              ⚠️ Seu número está no tier <strong className="text-brand-text">{tierExceeded.tier}</strong> da Meta — até{' '}
              <strong className="text-brand-text">{tierExceeded.cap.toLocaleString('pt-BR')}</strong> contatos únicos por 24h.
              Esta campanha tem <strong className="text-brand-text">{tierExceeded.count.toLocaleString('pt-BR')}</strong> contatos
              pendentes, acima desse limite. A Meta pode rejeitar parte dos envios em massa se você
              prosseguir agora.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => runAction('start', { confirmExceedsTier: true })}
                disabled={actionLoading}
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500 disabled:opacity-50"
              >
                Prosseguir mesmo assim
              </button>
              <button
                onClick={() => setTierExceeded(null)}
                className="rounded-lg border border-amber-400/30 px-3 py-1.5 text-xs text-amber-600 hover:bg-amber-400/10"
              >
                Cancelar e reduzir a lista
              </button>
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          {campanha.status === 'draft' && (
            <>
              <button
                onClick={() => runAction('start')}
                disabled={
                  actionLoading || campanha.audienceCount === 0
                  || (!campanha.consentConfirmedAt && !consentAcknowledged)
                }
                className="btn-primary px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                ▶ Iniciar disparo
              </button>
              <button
                onClick={handleDelete}
                disabled={actionLoading}
                className="rounded-lg border border-red-400/30 px-4 py-2 text-sm text-red-500 hover:bg-red-400/10"
              >
                Excluir
              </button>
            </>
          )}
          {campanha.status === 'scheduled' && (
            <>
              <button
                onClick={() => runAction('start')}
                disabled={actionLoading}
                className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
              >
                ▶ Iniciar agora
              </button>
              <button
                onClick={() => runAction('unschedule')}
                disabled={actionLoading}
                className="btn-ghost disabled:opacity-50"
              >
                Cancelar agendamento
              </button>
              <button
                onClick={handleDelete}
                disabled={actionLoading}
                className="rounded-lg border border-red-400/30 px-4 py-2 text-sm text-red-500 hover:bg-red-400/10"
              >
                Excluir
              </button>
            </>
          )}
          {campanha.status === 'running' && (
            <>
              <button
                onClick={() => runAction('pause')}
                disabled={actionLoading}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
              >
                ⏸ Pausar
              </button>
              <button
                onClick={handleCancel}
                disabled={actionLoading}
                className="rounded-lg border border-red-400/30 px-4 py-2 text-sm text-red-500 hover:bg-red-400/10"
              >
                Cancelar
              </button>
            </>
          )}
          {campanha.status === 'paused' && (
            <>
              <button
                onClick={() => runAction('start')}
                disabled={actionLoading}
                className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
              >
                ▶ Retomar
              </button>
              <button
                onClick={handleCancel}
                disabled={actionLoading}
                className="rounded-lg border border-red-400/30 px-4 py-2 text-sm text-red-500 hover:bg-red-400/10"
              >
                Cancelar
              </button>
            </>
          )}
        </div>

        {campanha.status === 'draft' && campanha.channel === 'evolution' && (
          <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-brand-text-secondary space-y-3">
            <p>
              ⚠️ Este envio usa o seu número Evolution comum, não a API oficial do WhatsApp.
              O WhatsApp pode banir o número usado para envio em massa automatizado — o
              <strong className="text-brand-text"> mesmo número que também atende core/Atende/Copiloto</strong>. Por isso o
              disparo é deliberadamente lento (poucas dezenas de mensagens por dia) e restrito a
              contatos que já conversaram com você.
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

        {campanha.status === 'draft' && campanha.channel !== 'evolution' && !campanha.consentConfirmedAt && (
          <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-brand-text-secondary space-y-3">
            <p>
              Antes de iniciar, confirme que você tem consentimento (opt-in) dos contatos desta
              lista para receber mensagens de marketing — exigido pela LGPD e pela política da
              Meta.
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

        {campanha.status === 'draft' && campanha.audienceCount > 0 && (
          <form onSubmit={handleSchedule} className="mt-4 flex flex-wrap items-center gap-2">
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
              disabled={
                actionLoading || !scheduleAt
                || (!campanha.consentConfirmedAt && !consentAcknowledged)
              }
              className="btn-ghost disabled:opacity-50 disabled:cursor-not-allowed"
            >
              🗓️ Agendar disparo
            </button>
          </form>
        )}

        {/* ── Abas (item 2): Audiência fica em foco, Avançado agrupa o resto ── */}
        <div className="mt-8 mb-6 flex rounded-lg border border-brand-border overflow-hidden text-sm">
          <button
            type="button"
            onClick={() => setActiveTab('audiencia')}
            className={`flex-1 px-4 py-2 font-medium ${activeTab === 'audiencia' ? 'bg-brand-primary text-white' : 'bg-brand-elevated text-brand-text-secondary hover:text-brand-text'}`}
          >
            Audiência
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('avancado')}
            className={`flex-1 px-4 py-2 font-medium ${activeTab === 'avancado' ? 'bg-brand-primary text-white' : 'bg-brand-elevated text-brand-text-secondary hover:text-brand-text'}`}
          >
            Avançado
          </button>
        </div>

        {activeTab === 'audiencia' && (
          <div className="space-y-6">
            {campanha.status === 'draft' && (
              <>
                <AudienceImporter
                  campanhaId={campanha.id}
                  channel={campanha.channel}
                  templateVarCount={campanha.templateVarCount}
                  onImported={loadCampanha}
                />
                {campanha.channel !== 'evolution' && (
                  <p className="text-xs text-brand-muted">
                    CSV: coluna 1 = telefone (obrigatório) · coluna 2 = nome (opcional) · colunas 3+ = variáveis do
                    template, na ordem.
                  </p>
                )}
              </>
            )}

            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-brand-muted">
                  Contatos ({contatosTotal})
                </h2>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="rounded-lg border border-brand-border bg-brand-elevated px-2 py-1 text-xs text-brand-text-secondary"
                >
                  <option value="">Todos</option>
                  {Object.entries(CONTATO_STATUS_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>

              {contatos.length === 0 ? (
                <p className="text-sm text-brand-muted">Nenhum contato {statusFilter ? 'com esse status' : 'ainda'}.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-brand-border">
                  <table className="w-full text-sm">
                    <thead className="bg-brand-elevated text-brand-text-secondary text-left">
                      <tr>
                        <th className="px-3 py-2 font-medium">Telefone</th>
                        <th className="px-3 py-2 font-medium">Nome</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-brand-border">
                      {contatos.map((c) => (
                        <tr key={c.id} title={c.errorMessage || undefined}>
                          <td className="px-3 py-2 text-brand-text-secondary">{c.phone}</td>
                          <td className="px-3 py-2 text-brand-muted">{c.name || '—'}</td>
                          <td className={`px-3 py-2 ${CONTATO_STATUS_COLOR[c.status] || 'text-brand-muted'}`}>
                            {CONTATO_STATUS_LABEL[c.status] || c.status}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {contatosTotal > contatos.length && (
                    <div className="px-3 py-2 text-xs bg-brand-elevated flex items-center justify-between">
                      <span className="text-brand-muted">Mostrando {contatos.length} de {contatosTotal}.</span>
                      <button
                        onClick={handleLoadMoreContatos}
                        disabled={loadingMore}
                        className="text-emerald-600 hover:text-emerald-500 font-medium disabled:opacity-50"
                      >
                        {loadingMore ? 'Carregando…' : 'Carregar mais →'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'avancado' && (
          <div className="space-y-6">
            {canEditPool && poolCandidates.length > 0 && (
              <div className="card rounded-xl p-4">
                <h2 className="text-sm font-semibold text-brand-text">Pool de números</h2>
                <p className="mt-1 text-xs text-brand-muted">
                  Divida o disparo entre números extras do mesmo canal — reduz o volume por número e o
                  risco de bater no teto/qualidade de um único número.
                </p>
                <div className="mt-3 space-y-1.5">
                  {poolCandidates.map((n) => (
                    <label key={n.id} className="flex items-center gap-2 text-sm text-brand-text-secondary">
                      <input
                        type="checkbox"
                        checked={poolSelected.includes(n.id)}
                        onChange={(e) => setPoolSelected((prev) => (
                          e.target.checked ? [...prev, n.id] : prev.filter((x) => x !== n.id)
                        ))}
                      />
                      <span>{n.displayName || n.phoneNumber || n.id}</span>
                      {n.status !== 'connected' && (
                        <span className="text-xs text-amber-600">(desconectado — só entra se reconectar antes do disparo)</span>
                      )}
                    </label>
                  ))}
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <button
                    onClick={handleSavePool}
                    disabled={poolSaving}
                    className="btn-ghost text-xs disabled:opacity-50"
                  >
                    {poolSaving ? 'Salvando…' : 'Salvar pool'}
                  </button>
                  {poolMessage && <span className="text-xs text-brand-muted">{poolMessage}</span>}
                </div>
              </div>
            )}

            {statsByNumber && Object.keys(statsByNumber).length > 0 && (
              <div className="card rounded-xl p-4">
                <h2 className="text-sm font-semibold text-brand-text">Envio por número (pool)</h2>
                <p className="mt-1 text-xs text-brand-muted">
                  Quanto cada número da rotação já processou nesta campanha.
                </p>
                <div className="mt-3 space-y-2">
                  {Object.entries(statsByNumber).map(([numberId, byStatus]) => {
                    const info = numberId === campanha.whatsappNumber?.id
                      ? campanha.whatsappNumber
                      : poolNumbersInfo?.find((n) => n.id === numberId);
                    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
                    return (
                      <div key={numberId} className="flex items-center justify-between text-sm border-t border-brand-border pt-2 first:border-t-0 first:pt-0">
                        <span className="text-brand-text-secondary">{info?.displayName || info?.phoneNumber || numberId}</span>
                        <span className="text-xs text-brand-muted">
                          {total} processado{total === 1 ? '' : 's'}
                          {byStatus.failed ? ` · ${byStatus.failed} falhou/falharam` : ''}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {sequenceParent && (
              <div className="card rounded-xl p-4">
                <h2 className="text-sm font-semibold text-brand-text">Sequência/drip</h2>
                <p className="mt-1 text-sm text-brand-text-secondary">
                  Este é um passo da sequência disparada por{' '}
                  <Link href={`/dashboard/campanhas/${sequenceParent.id}`} className="text-emerald-600 hover:text-emerald-500">
                    {sequenceParent.name}
                  </Link>.
                </p>
              </div>
            )}

            {sequenceSteps && sequenceSteps.length > 0 && (
              <div className="card rounded-xl p-4">
                <h2 className="text-sm font-semibold text-brand-text">Sequência/drip</h2>
                <p className="mt-1 text-xs text-brand-muted">
                  Passos seguintes, disparados automaticamente após o início desta campanha.
                </p>
                <div className="mt-3 space-y-2">
                  {sequenceSteps.map((s) => (
                    <div key={s.id} className="flex items-center justify-between text-sm border-t border-brand-border pt-2 first:border-t-0 first:pt-0">
                      <Link href={`/dashboard/campanhas/${s.id}`} className="text-brand-text-secondary hover:text-brand-text">
                        Passo {s.sequenceIndex} — {s.name}
                      </Link>
                      <span className="text-xs text-brand-muted">
                        {s.sequenceDelayDays}d depois · {CAMP_STATUS_LABEL[s.status] || s.status}
                        {s.scheduledAt && ` · ${new Date(s.scheduledAt).toLocaleString('pt-BR')}`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {canCreateSequence && (
              <div className="card rounded-xl p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-brand-text">Sequência/drip</h2>
                    <p className="mt-1 text-xs text-brand-muted">
                      Crie até 5 passos seguintes (ex: lembrete, follow-up) — disparados automaticamente
                      depois de X dias do início desta campanha, pra mesma audiência.
                    </p>
                  </div>
                  {!showSequenceForm && (
                    <button onClick={() => setShowSequenceForm(true)} className="btn-ghost text-xs whitespace-nowrap">
                      + Criar sequência
                    </button>
                  )}
                </div>

                {showSequenceForm && (
                  <form onSubmit={handleCreateSequence} className="mt-4 space-y-4">
                    {seqSteps.map((s, i) => (
                      <div key={i} className="inner-block space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-brand-text-secondary">Passo {i + 1}</span>
                          {seqSteps.length > 1 && (
                            <button type="button" onClick={() => removeSeqStep(i)} className="text-xs text-red-500 hover:underline">
                              Remover
                            </button>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-brand-muted whitespace-nowrap">Disparar</label>
                          <input
                            type="number"
                            min={1}
                            max={90}
                            required
                            value={s.delayDays}
                            onChange={(e) => updateSeqStep(i, { delayDays: e.target.value })}
                            className="input w-20"
                          />
                          <span className="text-xs text-brand-muted">dia(s) após o início</span>
                        </div>
                        {campanha.channel === 'meta' ? (
                          <select
                            required
                            value={s.templateName}
                            onChange={(e) => updateSeqStep(i, { templateName: e.target.value })}
                            className="input"
                          >
                            <option value="">Selecione o template…</option>
                            {templates.map((t) => (
                              <option key={t.id} value={t.name}>{t.name} ({t.language})</option>
                            ))}
                          </select>
                        ) : (
                          <textarea
                            required
                            value={s.messageBody}
                            onChange={(e) => updateSeqStep(i, { messageBody: e.target.value })}
                            rows={3}
                            maxLength={4096}
                            placeholder="Oi {{nome}}, tudo bem? ..."
                            className="input"
                          />
                        )}
                      </div>
                    ))}

                    {seqSteps.length < 5 && (
                      <button type="button" onClick={addSeqStep} className="text-xs text-emerald-600 hover:text-emerald-500">
                        + Adicionar passo
                      </button>
                    )}

                    {seqError && (
                      <div className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-red-600 text-sm">
                        {seqError}
                      </div>
                    )}

                    <div className="flex items-center gap-3">
                      <button
                        type="submit"
                        disabled={seqSaving || !seqStepsReady}
                        className="btn-primary px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {seqSaving ? 'Criando…' : 'Salvar sequência'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowSequenceForm(false)}
                        className="text-xs text-brand-muted hover:text-brand-text"
                      >
                        Cancelar
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}

            {campanha.abTestEnabled && statsByVariant && (
              <div className="card rounded-xl p-4">
                <h2 className="text-sm font-semibold text-brand-text">Teste A/B — por variante</h2>
                <p className="mt-1 text-xs text-brand-muted">
                  Audiência dividida 50/50 entre as 2 versões. Sem promoção automática de vencedor — compare abaixo.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-4">
                  {(['A', 'B'] as const).map((v) => {
                    const s = statsByVariant[v] || {};
                    const total = Object.values(s).reduce((a, b) => a + b, 0);
                    return (
                      <div key={v}>
                        <div className="text-xs font-medium text-brand-muted mb-1">Variante {v}</div>
                        <div className="text-lg font-semibold text-brand-text">{total}</div>
                        <div className="text-[11px] text-brand-muted">
                          {s.delivered || 0} entregue{s.delivered === 1 ? '' : 's'} · {s.read || 0} lido{s.read === 1 ? '' : 's'} ·{' '}
                          {s.failed || 0} falhou/falharam
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="card rounded-xl p-4">
              <h2 className="text-sm font-semibold text-brand-text">Enviar teste</h2>
              <p className="mt-1 text-xs text-brand-muted">
                Manda esta mensagem pra um número (ex: o seu) sem contar nas métricas da campanha.
              </p>
              <form onSubmit={handleTestSend} className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  placeholder="Telefone com DDD"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  className="input flex-1 min-w-[160px] max-w-xs"
                />
                <button
                  type="submit"
                  disabled={testSending || !testPhone.trim()}
                  className="btn-ghost text-xs disabled:opacity-50"
                >
                  {testSending ? 'Enviando…' : '🧪 Enviar teste'}
                </button>
                {testResult && (
                  <span className={`text-xs ${testResult.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                    {testResult.message}
                  </span>
                )}
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
