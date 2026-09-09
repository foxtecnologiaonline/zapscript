'use client';

import { useEffect, useState, useCallback, useRef, ChangeEvent, FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';

interface Campanha {
  id: string;
  name: string;
  status: string;
  channel: string; // 'meta' | 'evolution'
  templateName: string | null;
  templateLanguage: string;
  messageBody: string | null;
  consentConfirmedAt: string | null;
  audienceCount: number;
  sentCount: number;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  whatsappNumber: {
    id: string; phoneNumber: string | null; displayName: string | null;
    metaMessagingLimitTier: string | null; metaQualityRating: string | null;
  } | null;
}

interface FromConversasResult {
  imported: number;
  skippedOptOut: number;
  skippedDuplicate: number;
  elegiveis: number;
}

interface Contato {
  id: string;
  phone: string;
  name: string | null;
  status: string;
  errorMessage: string | null;
  createdAt: string;
}

interface UploadResult {
  imported: number;
  skippedOptOut: number;
  skippedInvalid: number;
  skippedDuplicate: number;
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
  pending: 'text-neutral-400',
  sent: 'text-blue-400',
  delivered: 'text-emerald-400',
  read: 'text-emerald-300',
  failed: 'text-red-400',
  optout: 'text-amber-400',
};

/** Valor mínimo aceito pelo <input type="datetime-local"> — pelo menos 5 min no futuro. */
function minDatetimeLocal(): string {
  const d = new Date(Date.now() + 5 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function CampanhaDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [campanha, setCampanha] = useState<Campanha | null>(null);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [contatos, setContatos] = useState<Contato[]>([]);
  const [contatosTotal, setContatosTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');

  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [scheduleAt, setScheduleAt] = useState('');
  const [consentAcknowledged, setConsentAcknowledged] = useState(false);
  const [importingConversas, setImportingConversas] = useState(false);
  const [importResult, setImportResult] = useState<FromConversasResult | null>(null);
  const [tierExceeded, setTierExceeded] = useState<{ tier: string; cap: number; count: number } | null>(null);

  const loadCampanha = useCallback(async () => {
    try {
      const res = await api.get<{ campanha: Campanha; stats: Record<string, number> }>(`/modules/campanhas/${id}`);
      setCampanha(res.campanha);
      setStats(res.stats || {});
    } catch (e: any) {
      if (e?.error === 'Campanha não encontrada.') setNotFound(true);
      else if (e?.statusCode !== 401) setError(e?.message || 'Não foi possível carregar a campanha.');
    }
  }, [id]);

  const loadContatos = useCallback(async () => {
    try {
      const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}&limit=100` : '?limit=100';
      const res = await api.get<{ contatos: Contato[]; total: number }>(`/modules/campanhas/${id}/contatos${qs}`);
      setContatos(res.contatos || []);
      setContatosTotal(res.total || 0);
    } catch {
      /* erro de carregamento da campanha acima já cobre o estado visível */
    }
  }, [id, statusFilter]);

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

  async function handleUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setActionError(null);
    setUploadResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.postFormData<UploadResult>(`/modules/campanhas/${id}/contatos`, fd);
      setUploadResult(res);
      await Promise.all([loadCampanha(), loadContatos()]);
    } catch (err: any) {
      setActionError(err?.message || 'Falha ao importar CSV.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
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
      setActionError(err?.message || 'Não foi possível agendar a campanha.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleImportConversas() {
    setImportingConversas(true);
    setActionError(null);
    setImportResult(null);
    try {
      const res = await api.post<FromConversasResult>(`/modules/campanhas/${id}/contatos/from-conversas`, {});
      setImportResult(res);
      await Promise.all([loadCampanha(), loadContatos()]);
    } catch (err: any) {
      setActionError(err?.message || 'Falha ao importar contatos.');
    } finally {
      setImportingConversas(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Excluir esta campanha? Esta ação não pode ser desfeita.')) return;
    setActionLoading(true);
    try {
      await api.delete(`/modules/campanhas/${id}`);
      router.push('/app/campanhas');
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
      <main className="min-h-screen flex items-center justify-center bg-neutral-950 text-neutral-300">
        Carregando…
      </main>
    );
  }

  if (notFound) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-neutral-950 text-neutral-100">
        <div className="text-center">
          <p className="mb-4">Campanha não encontrada.</p>
          <Link href="/app/campanhas" className="text-emerald-400 hover:text-emerald-300">← Voltar</Link>
        </div>
      </main>
    );
  }

  if (!campanha) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-neutral-950 text-red-300 px-5 text-center">
        {error || 'Erro ao carregar campanha.'}
      </main>
    );
  }

  const statCards: [string, number, string][] = [
    ['Contatos', campanha.audienceCount, ''],
    ['Enviados', campanha.sentCount, ''],
    ['Entregues', stats.delivered || 0, ''],
    ['Lidos', stats.read || 0, ''],
    ['Falharam', stats.failed || 0, 'text-red-400'],
    ['Opt-out', stats.optout || 0, 'text-amber-400'],
  ];

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 px-5 py-10">
      <div className="max-w-3xl mx-auto">
        <Link href="/app/campanhas" className="text-sm text-neutral-500 hover:text-neutral-300">← Campanhas</Link>

        <div className="mt-2 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{campanha.name}</h1>
            <p className="text-neutral-400 mt-1 text-sm">
              {campanha.channel === 'evolution'
                ? `Mensagem livre (Evolution): "${campanha.messageBody?.slice(0, 60)}${(campanha.messageBody?.length || 0) > 60 ? '…' : ''}"`
                : `Template: ${campanha.templateName} (${campanha.templateLanguage})`}
              {campanha.whatsappNumber?.displayName ? ` · ${campanha.whatsappNumber.displayName}` : ''}
            </p>
            {campanha.channel !== 'evolution'
              && (campanha.whatsappNumber?.metaMessagingLimitTier || campanha.whatsappNumber?.metaQualityRating) && (
              <p className="mt-1 text-xs text-neutral-500">
                Meta: tier {campanha.whatsappNumber?.metaMessagingLimitTier || '—'}
                {campanha.whatsappNumber?.metaQualityRating ? ` · qualidade ${campanha.whatsappNumber.metaQualityRating}` : ''}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="text-xs rounded-full border border-neutral-700 px-2.5 py-1 text-neutral-300 whitespace-nowrap">
              {CAMP_STATUS_LABEL[campanha.status] || campanha.status}
            </span>
            {campanha.channel === 'evolution' && (
              <span className="text-xs rounded-full border border-amber-800 bg-amber-950/30 px-2.5 py-1 text-amber-300 whitespace-nowrap">
                ⚠️ Evolution (experimental)
              </span>
            )}
          </div>
        </div>

        {campanha.status === 'scheduled' && campanha.scheduledAt && (
          <p className="mt-2 text-sm text-emerald-400">
            🗓️ Agendada para {new Date(campanha.scheduledAt).toLocaleString('pt-BR')}
          </p>
        )}

        <div className="mt-6 grid grid-cols-3 sm:grid-cols-6 gap-3">
          {statCards.map(([label, value, color]) => (
            <div key={label} className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-center">
              <div className={`text-lg font-semibold ${color}`}>{value}</div>
              <div className="text-[11px] text-neutral-500">{label}</div>
            </div>
          ))}
        </div>

        {actionError && (
          <div className="mt-4 rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-red-200 text-sm">
            {actionError}
          </div>
        )}

        {tierExceeded && (
          <div className="mt-4 rounded-xl border border-amber-800 bg-amber-950/30 p-4 text-sm text-amber-200 space-y-3">
            <p>
              ⚠️ Seu número está no tier <strong>{tierExceeded.tier}</strong> da Meta — até{' '}
              <strong>{tierExceeded.cap.toLocaleString('pt-BR')}</strong> contatos únicos por 24h.
              Esta campanha tem <strong>{tierExceeded.count.toLocaleString('pt-BR')}</strong> contatos
              pendentes, acima desse limite. A Meta pode rejeitar parte dos envios em massa se você
              prosseguir agora.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => runAction('start', { confirmExceedsTier: true })}
                disabled={actionLoading}
                className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50"
              >
                Prosseguir mesmo assim
              </button>
              <button
                onClick={() => setTierExceeded(null)}
                className="rounded-lg border border-amber-700 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-900/40"
              >
                Cancelar e reduzir a lista
              </button>
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          {campanha.status === 'draft' && (
            <>
              {campanha.channel === 'evolution' ? (
                <button
                  onClick={handleImportConversas}
                  disabled={importingConversas}
                  className="rounded-lg bg-neutral-800 px-4 py-2 text-sm font-medium hover:bg-neutral-700 disabled:opacity-50"
                >
                  {importingConversas ? 'Importando…' : '💬 Importar contatos que já falaram com você'}
                </button>
              ) : (
                <label className="rounded-lg bg-neutral-800 px-4 py-2 text-sm font-medium hover:bg-neutral-700 cursor-pointer">
                  {uploading ? 'Importando…' : '📄 Importar contatos (CSV)'}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    onChange={handleUpload}
                    disabled={uploading}
                    className="hidden"
                  />
                </label>
              )}
              <button
                onClick={() => runAction('start')}
                disabled={
                  actionLoading || campanha.audienceCount === 0
                  || (!campanha.consentConfirmedAt && !consentAcknowledged)
                }
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                ▶ Iniciar disparo
              </button>
              <button
                onClick={handleDelete}
                disabled={actionLoading}
                className="rounded-lg border border-red-800 px-4 py-2 text-sm text-red-300 hover:bg-red-950/40"
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
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                ▶ Iniciar agora
              </button>
              <button
                onClick={() => runAction('unschedule')}
                disabled={actionLoading}
                className="rounded-lg bg-neutral-800 px-4 py-2 text-sm font-medium hover:bg-neutral-700 disabled:opacity-50"
              >
                Cancelar agendamento
              </button>
              <button
                onClick={handleDelete}
                disabled={actionLoading}
                className="rounded-lg border border-red-800 px-4 py-2 text-sm text-red-300 hover:bg-red-950/40"
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
                className="rounded-lg border border-red-800 px-4 py-2 text-sm text-red-300 hover:bg-red-950/40"
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
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                ▶ Retomar
              </button>
              <button
                onClick={handleCancel}
                disabled={actionLoading}
                className="rounded-lg border border-red-800 px-4 py-2 text-sm text-red-300 hover:bg-red-950/40"
              >
                Cancelar
              </button>
            </>
          )}
        </div>

        {campanha.status === 'draft' && campanha.channel !== 'evolution' && (
          <p className="mt-3 text-xs text-neutral-500">
            CSV: coluna 1 = telefone (obrigatório) · coluna 2 = nome (opcional) · colunas 3+ = variáveis do
            template, na ordem.
          </p>
        )}

        {campanha.status === 'draft' && campanha.channel === 'evolution' && (
          <div className="mt-4 rounded-xl border border-amber-800 bg-amber-950/30 p-4 text-sm text-amber-200 space-y-3">
            <p>
              ⚠️ Este envio usa o seu número Evolution comum, não a API oficial do WhatsApp.
              O WhatsApp pode banir o número usado para envio em massa automatizado — o
              <strong> mesmo número que também atende core/Atende/Copiloto</strong>. Por isso o
              disparo é deliberadamente lento (poucas dezenas de mensagens por dia) e restrito a
              contatos que já conversaram com você.
            </p>
            {!campanha.consentConfirmedAt && (
              <label className="flex items-start gap-2 text-amber-100">
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
          <div className="mt-4 rounded-xl border border-amber-800 bg-amber-950/30 p-4 text-sm text-amber-200 space-y-3">
            <p>
              Antes de iniciar, confirme que você tem consentimento (opt-in) dos contatos desta
              lista para receber mensagens de marketing — exigido pela LGPD e pela política da
              Meta.
            </p>
            <label className="flex items-start gap-2 text-amber-100">
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

        {importResult && (
          <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-sm text-neutral-300">
            {importResult.imported} de {importResult.elegiveis} contato{importResult.elegiveis === 1 ? '' : 's'} elegíve{importResult.elegiveis === 1 ? 'l' : 'is'} importado{importResult.imported === 1 ? '' : 's'}.
            {importResult.skippedOptOut > 0 && ` ${importResult.skippedOptOut} já em opt-out.`}
            {importResult.skippedDuplicate > 0 && ` ${importResult.skippedDuplicate} já estava(m) na campanha.`}
          </div>
        )}

        {campanha.status === 'draft' && campanha.audienceCount > 0 && (
          <form onSubmit={handleSchedule} className="mt-4 flex flex-wrap items-center gap-2">
            <label className="text-sm text-neutral-400">Ou agende para depois:</label>
            <input
              type="datetime-local"
              required
              value={scheduleAt}
              min={minDatetimeLocal()}
              onChange={(e) => setScheduleAt(e.target.value)}
              className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-emerald-600"
            />
            <button
              type="submit"
              disabled={
                actionLoading || !scheduleAt
                || (!campanha.consentConfirmedAt && !consentAcknowledged)
              }
              className="rounded-lg border border-neutral-700 px-4 py-2 text-sm font-medium text-neutral-200 hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              🗓️ Agendar disparo
            </button>
          </form>
        )}

        {uploadResult && (
          <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-sm text-neutral-300">
            {uploadResult.imported} contato{uploadResult.imported === 1 ? '' : 's'} importado
            {uploadResult.imported === 1 ? '' : 's'}.
            {uploadResult.skippedOptOut > 0 && ` ${uploadResult.skippedOptOut} já em opt-out.`}
            {uploadResult.skippedInvalid > 0 && ` ${uploadResult.skippedInvalid} inválido(s).`}
            {uploadResult.skippedDuplicate > 0 && ` ${uploadResult.skippedDuplicate} duplicado(s).`}
          </div>
        )}

        <div className="mt-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
              Contatos ({contatosTotal})
            </h2>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-300"
            >
              <option value="">Todos</option>
              {Object.entries(CONTATO_STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>

          {contatos.length === 0 ? (
            <p className="text-sm text-neutral-500">Nenhum contato {statusFilter ? 'com esse status' : 'ainda'}.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-neutral-800">
              <table className="w-full text-sm">
                <thead className="bg-neutral-900 text-neutral-400 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Telefone</th>
                    <th className="px-3 py-2 font-medium">Nome</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800">
                  {contatos.map((c) => (
                    <tr key={c.id} title={c.errorMessage || undefined}>
                      <td className="px-3 py-2 text-neutral-300">{c.phone}</td>
                      <td className="px-3 py-2 text-neutral-400">{c.name || '—'}</td>
                      <td className={`px-3 py-2 ${CONTATO_STATUS_COLOR[c.status] || 'text-neutral-400'}`}>
                        {CONTATO_STATUS_LABEL[c.status] || c.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {contatosTotal > contatos.length && (
                <div className="px-3 py-2 text-xs text-neutral-500 bg-neutral-900/50">
                  Mostrando {contatos.length} de {contatosTotal}.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
