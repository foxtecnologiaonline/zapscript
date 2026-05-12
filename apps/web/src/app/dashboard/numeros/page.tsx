'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';

interface WNumber {
  id: string;
  displayName: string | null;
  phoneNumber: string;
  status: string;
  messageCount: number;
  minutesUsed: number;
  connectedAt: string | null;
  createdAt: string;
}

// ── QR Code Modal ─────────────────────────────────────────────────────────────
function QrModal({ number, onClose, onConnected }: {
  number: WNumber;
  onClose: () => void;
  onConnected: () => void;
}) {
  const [qr, setQr]           = useState<string | null>(null);
  const [status, setStatus]   = useState<'loading' | 'waiting' | 'connected' | 'error'>('loading');
  const [error, setError]     = useState('');
  const pollRef               = useRef<ReturnType<typeof setInterval> | null>(null);
  const qrRefreshRef          = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchQr = useCallback(async () => {
    try {
      const res = await api.get<{ qr: string } | null>(`/numbers/${number.id}/qr`);
      if (res && 'qr' in res) {
        setQr(res.qr);
        setStatus('waiting');
      }
    } catch {
      setError('Não foi possível obter o QR Code. Verifique as configurações Z-API.');
      setStatus('error');
    }
  }, [number.id]);

  const pollStatus = useCallback(async () => {
    try {
      const res = await api.get<{ connected: boolean; phone: string }>(`/numbers/${number.id}/zapi-status`);
      if (res.connected) {
        setStatus('connected');
        clearInterval(pollRef.current!);
        clearInterval(qrRefreshRef.current!);
        setTimeout(() => { onConnected(); onClose(); }, 2000);
      }
    } catch { /* ignora erro de polling */ }
  }, [number.id, onConnected, onClose]);

  useEffect(() => {
    async function init() {
      // 1. Iniciar conexão (criar instância Z-API se necessário) — AGUARDAR
      try {
        await api.post(`/numbers/${number.id}/connect`, {});
      } catch (err: any) {
        setError(err.message || 'Erro ao iniciar conexão Z-API.');
        setStatus('error');
        return;
      }
      // 2. Só busca QR depois que connect terminou com sucesso
      fetchQr();
      // 3. Polling de status a cada 2s
      pollRef.current = setInterval(pollStatus, 2000);
      // 4. Refresh do QR a cada 30s (expira)
      qrRefreshRef.current = setInterval(fetchQr, 30_000);
    }
    init();
    return () => {
      clearInterval(pollRef.current!);
      clearInterval(qrRefreshRef.current!);
    };
  }, [fetchQr, pollStatus, number.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}>
      <div className="modal-panel max-w-sm w-full" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="font-bold text-base text-brand-text">Conectar WhatsApp</h2>
            <p className="text-xs text-brand-muted mt-0.5">{number.displayName}</p>
          </div>
          <button onClick={onClose} className="text-brand-muted hover:text-brand-text text-xl leading-none transition-colors">✕</button>
        </div>

        {status === 'connected' ? (
          <div className="text-center py-8">
            <div className="text-5xl mb-3">✅</div>
            <p className="font-bold text-brand-primary text-lg">WhatsApp conectado!</p>
            <p className="text-xs text-brand-muted mt-1">Redirecionando...</p>
          </div>

        ) : status === 'error' ? (
          <div className="text-center py-6">
            <div className="text-4xl mb-3">❌</div>
            <p className="text-red-400 text-sm font-semibold mb-1">Erro ao obter QR Code</p>
            <p className="text-xs text-brand-muted">{error}</p>
            <button onClick={fetchQr} className="btn-primary text-sm px-5 py-2 mt-4">
              Tentar novamente
            </button>
          </div>

        ) : (
          <>
            {/* QR Code */}
            <div className="flex items-center justify-center bg-white rounded-2xl p-3 mb-4 min-h-[240px]">
              {status === 'loading' || !qr ? (
                <div className="flex flex-col items-center gap-3 text-gray-400">
                  <svg className="animate-spin h-8 w-8" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                  <span className="text-sm">Gerando QR Code...</span>
                </div>
              ) : (
                <img src={qr} alt="QR Code WhatsApp" className="w-56 h-56 object-contain" />
              )}
            </div>

            {/* Instruções */}
            <div className="bg-brand-elevated rounded-xl p-4 mb-4 space-y-2">
              <p className="text-xs font-bold text-brand-text mb-2">Como conectar:</p>
              {[
                'Abra o WhatsApp no seu celular',
                'Toque em ⋮ (Android) ou Configurações (iPhone)',
                'Selecione "Dispositivos conectados"',
                'Toque em "Conectar dispositivo"',
                'Aponte a câmera para o QR Code acima',
              ].map((step, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-brand-text-secondary">
                  <span className="w-4 h-4 rounded-full bg-brand-primary/20 text-brand-primary flex-shrink-0 flex items-center justify-center text-[10px] font-bold mt-0.5">
                    {i + 1}
                  </span>
                  {step}
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 text-xs text-brand-muted">
              <svg className="animate-spin h-3 w-3 flex-shrink-0" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
              Aguardando escaneamento... O QR atualiza a cada 30s.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function NumerosPage() {
  const [numbers, setNumbers]     = useState<WNumber[]>([]);
  const [loading, setLoading]     = useState(true);
  const [addName, setAddName]     = useState('');
  const [adding, setAdding]       = useState(false);
  const [error, setError]         = useState('');
  const [userId, setUserId]       = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting]   = useState(false);
  const [qrNumber, setQrNumber]   = useState<WNumber | null>(null);

  const loadNumbers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.get<WNumber[]>('/numbers');
      setNumbers(result ?? []);
    } catch (err: any) {
      setError(`Erro ao carregar números: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNumbers();
    api.get<any>('/auth/me').then(u => setUserId(u.id));
  }, [loadNumbers]);

  const { connected: socketOk } = useSocket(userId, {
    audio_received: () => { loadNumbers(); },
  });

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!addName.trim()) return;
    setAdding(true); setError('');
    try {
      await api.post('/numbers', { displayName: addName.trim() });
      setAddName('');
      loadNumbers();
    } catch (err: any) { setError(err.message); }
    finally { setAdding(false); }
  }

  async function handleDisconnect(id: string) {
    await api.post(`/numbers/${id}/disconnect`, {});
    loadNumbers();
  }

  async function handleDelete(id: string) {
    setDeleting(true);
    try {
      await api.delete(`/numbers/${id}`);
      setNumbers(n => n.filter(x => x.id !== id));
    } catch (err: any) {
      setError(err.message || 'Erro ao remover número.');
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  }

  const statusColor = (s: string) =>
    s === 'connected'  ? 'text-green-500 bg-green-400/10 border-green-400/20' :
    s === 'connecting' ? 'text-yellow-500 bg-yellow-400/10 border-yellow-400/20' :
                         'text-brand-muted bg-brand-elevated border-brand-border';

  const statusLabel = (s: string) =>
    s === 'connected'  ? '● Online' :
    s === 'connecting' ? '◌ Conectando...' : '○ Offline';

  return (
    <div className="p-4 sm:p-8 max-w-4xl">

      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-brand-text">Números WhatsApp</h1>
          <p className="text-sm text-brand-text-secondary font-light mt-0.5">
            Conecte seu WhatsApp como dispositivo adicional — como o WhatsApp Web
          </p>
        </div>
        <div className={`flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${
          socketOk
            ? 'text-green-500 bg-green-400/10 border-green-400/20'
            : 'text-amber-500 bg-amber-400/10 border-amber-400/20'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${socketOk ? 'bg-green-400 animate-pulse' : 'bg-amber-400'}`} />
          {socketOk ? 'Tempo real ativo' : 'Modo polling'}
        </div>
      </div>

      {/* ── Add form ── */}
      <div className="card p-5 mb-5">
        <div className="text-sm font-bold mb-1 text-brand-text">Adicionar dispositivo</div>
        <p className="text-xs text-brand-muted mb-3">
          Após adicionar, escaneie o QR Code para conectar seu WhatsApp.
        </p>
        <form onSubmit={handleAdd} className="flex gap-2">
          <input
            className="input flex-1"
            placeholder="Nome do dispositivo (ex: Comercial, Pessoal)"
            value={addName}
            onChange={e => setAddName(e.target.value)}
            required
          />
          <button type="submit" disabled={adding} className="btn-primary px-5">
            {adding ? '...' : '+ Adicionar'}
          </button>
        </form>
        {error && (
          <p className="text-red-400 text-xs mt-3 bg-red-400/10 px-3 py-2 rounded-lg">{error}</p>
        )}
      </div>

      {/* ── Cards ── */}
      {loading ? (
        <div className="text-center py-12 text-brand-muted text-sm">Carregando...</div>
      ) : error && numbers.length === 0 ? (
        <div className="card p-6 text-center border-red-400/20">
          <div className="text-3xl mb-2">⚠️</div>
          <div className="text-sm text-red-400 font-semibold mb-1">Erro ao carregar dispositivos</div>
          <div className="text-xs text-brand-muted mb-3">{error}</div>
          <button onClick={loadNumbers} className="btn-primary text-xs px-4 py-2">Tentar novamente</button>
        </div>
      ) : numbers.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-4xl mb-3">📱</div>
          <div className="text-sm text-brand-muted">
            Nenhum dispositivo ainda. Adicione um acima para começar.
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {numbers.map(n => (
            <div key={n.id} className="card p-5 hover:border-brand-primary/20 transition-colors">

              {/* Card header */}
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="font-bold text-sm text-brand-text">{n.displayName || 'Dispositivo'}</div>
                  <div className="text-xs text-brand-muted font-mono mt-0.5">
                    {n.phoneNumber !== 'pending' ? `+${n.phoneNumber}` : 'Aguardando conexão'}
                  </div>
                </div>
                <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${statusColor(n.status)}`}>
                  {statusLabel(n.status)}
                </span>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-brand-elevated rounded-lg p-2.5">
                  <div className="text-base font-black text-brand-primary leading-none">{n.messageCount}</div>
                  <div className="text-[10px] text-brand-muted mt-0.5">transcrições</div>
                </div>
                <div className="bg-brand-elevated rounded-lg p-2.5">
                  <div className="text-base font-black text-brand-primary leading-none">{n.minutesUsed.toFixed(1)}</div>
                  <div className="text-[10px] text-brand-muted mt-0.5">min usados</div>
                </div>
              </div>

              {/* Actions */}
              {n.status === 'connected' ? (
                <div className="flex gap-2">
                  <button onClick={() => handleDisconnect(n.id)}
                    className="btn-ghost flex-1 justify-center text-xs py-2">
                    ⏹ Desconectar
                  </button>
                  {confirmDelete === n.id ? (
                    <div className="flex gap-1">
                      <button onClick={() => handleDelete(n.id)} disabled={deleting}
                        className="text-xs px-2 py-1 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors">
                        {deleting ? '...' : 'Confirmar'}
                      </button>
                      <button onClick={() => setConfirmDelete(null)}
                        className="text-xs px-2 py-1 rounded-lg border border-brand-border text-brand-muted">
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDelete(n.id)}
                      className="text-xs px-3 py-2 rounded-lg border border-red-400/15 text-brand-muted hover:text-red-400 hover:border-red-400/30 transition-colors">
                      🗑
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <button
                    onClick={() => setQrNumber(n)}
                    className="btn-primary w-full text-sm py-2.5 flex items-center justify-center gap-2">
                    <span>📱</span>
                    {n.status === 'connecting' ? 'Ver QR Code' : 'Conectar WhatsApp'}
                  </button>
                  {confirmDelete === n.id ? (
                    <div className="flex gap-2">
                      <button onClick={() => handleDelete(n.id)} disabled={deleting}
                        className="flex-1 text-[11px] px-3 py-1.5 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors">
                        {deleting ? 'Removendo...' : 'Confirmar remoção'}
                      </button>
                      <button onClick={() => setConfirmDelete(null)}
                        className="text-[11px] px-3 py-1.5 rounded-lg border border-brand-border text-brand-muted">
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDelete(n.id)}
                      className="w-full text-[11px] px-3 py-1 rounded-lg border border-red-400/10 text-red-400/50 hover:text-red-400 hover:border-red-400/30 transition-colors">
                      Remover
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* QR Modal */}
      {qrNumber && (
        <QrModal
          number={qrNumber}
          onClose={() => setQrNumber(null)}
          onConnected={loadNumbers}
        />
      )}
    </div>
  );
}
