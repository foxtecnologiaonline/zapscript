'use client';

import { useEffect, useState, useCallback, useRef, ChangeEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';

interface Campanha {
  id: string;
  name: string;
  status: string;
  templateName: string;
  templateLanguage: string;
  audienceCount: number;
  sentCount: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  whatsappNumber: { id: string; phoneNumber: string | null; displayName: string | null } | null;
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

  async function runAction(action: 'start' | 'pause' | 'cancel') {
    setActionLoading(true);
    setActionError(null);
    try {
      await api.post(`/modules/campanhas/${id}/${action}`, {});
      await loadCampanha();
    } catch (err: any) {
      setActionError(err?.message || 'Ação falhou.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Excluir esta campanha em rascunho? Esta ação não pode ser desfeita.')) return;
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
              Template: {campanha.templateName} ({campanha.templateLanguage})
              {campanha.whatsappNumber?.displayName ? ` · ${campanha.whatsappNumber.displayName}` : ''}
            </p>
          </div>
          <span className="text-xs rounded-full border border-neutral-700 px-2.5 py-1 text-neutral-300 whitespace-nowrap">
            {CAMP_STATUS_LABEL[campanha.status] || campanha.status}
          </span>
        </div>

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

        <div className="mt-6 flex flex-wrap gap-3">
          {campanha.status === 'draft' && (
            <>
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
              <button
                onClick={() => runAction('start')}
                disabled={actionLoading || campanha.audienceCount === 0}
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

        {campanha.status === 'draft' && (
          <p className="mt-3 text-xs text-neutral-500">
            CSV: coluna 1 = telefone (obrigatório) · coluna 2 = nome (opcional) · colunas 3+ = variáveis do
            template, na ordem.
          </p>
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
