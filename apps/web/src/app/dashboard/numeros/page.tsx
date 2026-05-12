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

// ── Spinner inline ────────────────────────────────────────────────────────────
function Spinner({ size = 4 }: { size?: number }) {
  return (
    <svg className={`animate-spin h-${size} w-${size}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
    </svg>
  );
}

// ── QR Code Modal ─────────────────────────────────────────────────────────────
function QrModal({ number, onClose, onConnected }: {
  number: WNumber;
  onClose: () => void;
  onConnected: () => void;
}) {
  const [tab, setTab]       = useState<'qr' | 'phone'>('qr');
  const [qr, setQr]         = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'waiting' | 'connected' | 'error'>('loading');
  const [error, setError]   = useState('');

  // Tab telefone
  const [phoneInput, setPhoneInput]   = useState(
    number.phoneNumber !== 'pending' ? number.phoneNumber.replace(/^55/, '') : ''
  );
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [requesting, setRequesting]  = useState(false);
  const [phoneError, setPhoneError]  = useState('');
  const [phoneUnavailable, setPhoneUnavailable] = useState(false);

  const pollRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const qrRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchQr = useCallback(async () => {
    try {
      const res = await api.get<{ qr: string } | null>(`/numbers/${number.id}/qr`);
      if (res && 'qr' in res) { setQr(res.qr); setStatus('waiting'); }
    } catch {
      // Não mostrar erro de QR quando usuário está na aba telefone
    }
  }, [number.id]);

  const pollStatus = useCallback(async () => {
    try {
      const res = await api.get<{ connected: boolean }>(`/numbers/${number.id}/zapi-status`);
      if (res.connected) {
        setStatus('connected');
        clearInterval(pollRef.current!);
        clearInterval(qrRefreshRef.current!);
        setTimeout(() => { onConnected(); onClose(); }, 2000);
      }
    } catch { /* ignora */ }
  }, [number.id, onConnected, onClose]);

  useEffect(() => {
    async function init() {
      try {
        await api.post(`/numbers/${number.id}/connect`, {});
      } catch (err: any) {
        setError(err.message || 'Erro ao iniciar conexão Z-API. Verifique as configurações.');
        setStatus('error');
        return;
      }
      setStatus('waiting');
      fetchQr();
      pollRef.current      = setInterval(pollStatus, 2000);
      qrRefreshRef.current = setInterval(fetchQr, 30_000);
    }
    init();
    return () => { clearInterval(pollRef.current!); clearInterval(qrRefreshRef.current!); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tab === 'qr' && status === 'waiting') {
      if (!qr) fetchQr();
      if (!qrRefreshRef.current) qrRefreshRef.current = setInterval(fetchQr, 30_000);
    } else if (tab === 'phone') {
      clearInterval(qrRefreshRef.current!);
      qrRefreshRef.current = null;
    }
  }, [tab, qr, status, fetchQr]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleRequestPairingCode() {
    const digits = phoneInput.replace(/\D/g, '');
    if (digits.length < 10) { setPhoneError('Informe DDD + número (mínimo 10 dígitos).'); return; }
    setRequesting(true); setPhoneError(''); setPairingCode(null); setPhoneUnavailable(false);
    try {
      const res = await api.post<{ code: string }>(`/numbers/${number.id}/pairing-code`, { phone: digits });
      setPairingCode(res.code);
    } catch (err: any) {
      const msg: string = err.message || '';
      if (msg.includes('NOT_FOUND') || msg.includes('not available') || msg.includes('indisponível')) {
        setPhoneUnavailable(true);
      } else {
        setPhoneError(msg || 'Erro ao solicitar código. Tente o QR Code.');
      }
    } finally {
      setRequesting(false);
    }
  }

  function formatCode(code: string) {
    return code.length >= 8 ? `${code.slice(0, 4)}-${code.slice(4, 8)}` : code;
  }

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      {/* Modal — desliza de baixo no mobile */}
      <div
        className="modal-panel w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 pb-3 sticky top-0 bg-[var(--color-surface,#1c1c1c)] z-10 border-b border-brand-border">
          <div>
            <h2 className="font-bold text-base text-brand-text">Conectar WhatsApp</h2>
            <p className="text-xs text-brand-muted mt-0.5">{number.displayName}</p>
          </div>
          <button onClick={onClose} className="text-brand-muted hover:text-brand-text text-xl leading-none p-1 transition-colors">✕</button>
        </div>

        <div className="p-5 pt-4">
          {/* ── Conectado ── */}
          {status === 'connected' ? (
            <div className="text-center py-10">
              <div className="text-5xl mb-3">✅</div>
              <p className="font-bold text-brand-primary text-lg">WhatsApp conectado!</p>
              <p className="text-xs text-brand-muted mt-1">Fechando...</p>
            </div>

          ) : status === 'error' ? (
            <div className="text-center py-8">
              <div className="text-4xl mb-3">❌</div>
              <p className="text-red-400 text-sm font-semibold mb-2">Erro na conexão</p>
              <p className="text-xs text-brand-muted mb-4 leading-relaxed">{error}</p>
              <button
                onClick={() => { setStatus('loading'); setError(''); fetchQr(); }}
                className="btn-primary text-sm px-5 py-2"
              >
                Tentar novamente
              </button>
            </div>

          ) : (
            <>
              {/* Tabs */}
              <div className="flex rounded-xl bg-brand-elevated p-1 mb-5 gap-1">
                {(['qr', 'phone'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`flex-1 text-xs font-semibold py-2.5 rounded-lg transition-all ${
                      tab === t ? 'bg-brand-primary text-white shadow-sm' : 'text-brand-muted hover:text-brand-text'
                    }`}
                  >
                    {t === 'qr' ? '📷 QR Code' : '📱 Código por telefone'}
                  </button>
                ))}
              </div>

              {/* ── Tab QR ── */}
              {tab === 'qr' && (
                <div className="space-y-4">
                  {/* QR image */}
                  <div className="flex items-center justify-center bg-white rounded-2xl p-4 min-h-[220px]">
                    {!qr ? (
                      <div className="flex flex-col items-center gap-3 text-gray-400">
                        <Spinner size={8} />
                        <span className="text-sm">Gerando QR Code...</span>
                      </div>
                    ) : (
                      <img src={qr} alt="QR Code WhatsApp" className="w-52 h-52 object-contain" />
                    )}
                  </div>

                  {/* Instruções colapsadas */}
                  <details className="group bg-brand-elevated rounded-xl">
                    <summary className="flex items-center justify-between px-4 py-3 cursor-pointer text-xs font-semibold text-brand-text select-none">
                      Como escanear
                      <span className="text-brand-muted group-open:rotate-180 transition-transform">▾</span>
                    </summary>
                    <div className="px-4 pb-3 space-y-1.5">
                      {[
                        'Abra o WhatsApp no celular',
                        'Toque em ⋮ (Android) ou Configurações (iPhone)',
                        'Selecione "Dispositivos conectados"',
                        'Toque em "Conectar dispositivo"',
                        'Aponte a câmera para o QR Code acima',
                      ].map((s, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs text-brand-text-secondary">
                          <span className="w-4 h-4 rounded-full bg-brand-primary/20 text-brand-primary flex-shrink-0 flex items-center justify-center text-[10px] font-bold mt-0.5">{i+1}</span>
                          {s}
                        </div>
                      ))}
                    </div>
                  </details>

                  <div className="flex items-center gap-2 text-xs text-brand-muted">
                    <Spinner size={3} />
                    Aguardando escaneamento... QR atualiza a cada 30s.
                  </div>
                </div>
              )}

              {/* ── Tab Telefone ── */}
              {tab === 'phone' && (
                <div className="space-y-4">
                  {/* Indisponível para instâncias web */}
                  {phoneUnavailable ? (
                    <div className="bg-amber-400/10 border border-amber-400/20 rounded-xl p-4 text-center">
                      <div className="text-2xl mb-2">⚠️</div>
                      <p className="text-sm font-semibold text-amber-500 mb-1">Não disponível nesta configuração</p>
                      <p className="text-xs text-brand-muted mb-3">
                        O código por telefone requer uma instância Z-API do tipo <strong>Mobile</strong>.
                        Sua instância atual é do tipo <strong>Web</strong>.
                      </p>
                      <button
                        onClick={() => setTab('qr')}
                        className="btn-primary text-xs px-4 py-2"
                      >
                        Usar QR Code →
                      </button>
                    </div>
                  ) : (
                    <>
                      <details className="group bg-brand-elevated rounded-xl">
                        <summary className="flex items-center justify-between px-4 py-3 cursor-pointer text-xs font-semibold text-brand-text select-none">
                          Como conectar pelo número
                          <span className="text-brand-muted group-open:rotate-180 transition-transform">▾</span>
                        </summary>
                        <div className="px-4 pb-3 space-y-1.5">
                          {[
                            'Informe seu número do WhatsApp abaixo',
                            'Clique em "Solicitar código"',
                            'Abra o WhatsApp → Dispositivos conectados → Conectar dispositivo',
                            'Escolha "Conectar pelo número do telefone"',
                            'Digite o código de 8 caracteres exibido',
                          ].map((s, i) => (
                            <div key={i} className="flex items-start gap-2 text-xs text-brand-text-secondary">
                              <span className="w-4 h-4 rounded-full bg-brand-primary/20 text-brand-primary flex-shrink-0 flex items-center justify-center text-[10px] font-bold mt-0.5">{i+1}</span>
                              {s}
                            </div>
                          ))}
                        </div>
                      </details>

                      {/* Input número — sem prefixo absoluto */}
                      <div>
                        <label className="text-xs text-brand-muted mb-1.5 block">Número do WhatsApp (Brasil)</label>
                        <div className="flex rounded-xl border border-brand-border bg-brand-elevated overflow-hidden focus-within:border-brand-primary transition-colors">
                          <span className="flex items-center px-3 text-sm font-mono text-brand-text-secondary bg-brand-border/30 border-r border-brand-border select-none">
                            +55
                          </span>
                          <input
                            className="flex-1 bg-transparent px-3 py-2.5 text-sm text-brand-text placeholder:text-brand-muted outline-none"
                            placeholder="11 9 8765-4321"
                            value={phoneInput}
                            onChange={e => setPhoneInput(e.target.value.replace(/\D/g, '').slice(0, 11))}
                            inputMode="numeric"
                          />
                        </div>
                        <p className="text-[10px] text-brand-muted mt-1">DDD + número (ex: 11987654321 — sem o +55)</p>
                      </div>

                      <button
                        onClick={handleRequestPairingCode}
                        disabled={requesting || phoneInput.replace(/\D/g,'').length < 10}
                        className="btn-primary w-full py-3 flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        {requesting ? <><Spinner size={4}/> Solicitando...</> : 'Solicitar código'}
                      </button>

                      {phoneError && (
                        <div className="bg-red-400/10 border border-red-400/20 rounded-xl px-4 py-3">
                          <p className="text-red-400 text-xs">{phoneError}</p>
                        </div>
                      )}

                      {pairingCode && (
                        <div className="text-center bg-brand-primary/10 border border-brand-primary/20 rounded-2xl p-5">
                          <p className="text-xs text-brand-muted mb-2">Seu código de conexão</p>
                          <p className="text-4xl font-black font-mono tracking-[0.2em] text-brand-primary">
                            {formatCode(pairingCode)}
                          </p>
                          <p className="text-[10px] text-brand-muted mt-2">
                            Abra o WhatsApp → Dispositivos → Conectar pelo número → digite o código
                          </p>
                        </div>
                      )}
                    </>
                  )}

                  <div className="flex items-center gap-2 text-xs text-brand-muted">
                    <Spinner size={3} />
                    Aguardando conexão...
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function NumerosPage() {
  const [numbers, setNumbers]               = useState<WNumber[]>([]);
  const [loading, setLoading]               = useState(true);
  const [addName, setAddName]               = useState('');
  const [addPhone, setAddPhone]             = useState('');
  const [adding, setAdding]                 = useState(false);
  const [error, setError]                   = useState('');
  const [userId, setUserId]                 = useState('');
  const [confirmDelete, setConfirmDelete]   = useState<string | null>(null);
  const [deleting, setDeleting]             = useState(false);
  const [qrNumber, setQrNumber]             = useState<WNumber | null>(null);

  const loadNumbers = useCallback(async () => {
    setLoading(true); setError('');
    try { setNumbers((await api.get<WNumber[]>('/numbers')) ?? []); }
    catch (err: any) { setError(`Erro ao carregar: ${err.message}`); }
    finally { setLoading(false); }
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
      const cleanPhone = addPhone.replace(/\D/g, '');
      await api.post('/numbers', {
        displayName: addName.trim(),
        ...(cleanPhone ? { phoneNumber: cleanPhone } : {}),
      });
      setAddName(''); setAddPhone('');
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
    } catch (err: any) { setError(err.message || 'Erro ao remover.'); }
    finally { setDeleting(false); setConfirmDelete(null); }
  }

  const statusColor = (s: string) =>
    s === 'connected'  ? 'text-green-500 bg-green-400/10 border-green-400/20' :
    s === 'connecting' ? 'text-yellow-500 bg-yellow-400/10 border-yellow-400/20' :
                         'text-brand-muted bg-brand-elevated border-brand-border';

  const statusLabel = (s: string) =>
    s === 'connected'  ? '● Online' :
    s === 'connecting' ? '◌ Conectando...' : '○ Offline';

  return (
    <div className="p-4 sm:p-6 max-w-4xl">

      {/* Header */}
      <div className="flex items-start justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-brand-text">Números WhatsApp</h1>
          <p className="text-sm text-brand-text-secondary font-light mt-0.5">
            Conecte como dispositivo adicional — igual ao WhatsApp Web
          </p>
        </div>
        <div className={`flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${
          socketOk ? 'text-green-500 bg-green-400/10 border-green-400/20'
                   : 'text-amber-500 bg-amber-400/10 border-amber-400/20'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${socketOk ? 'bg-green-400 animate-pulse' : 'bg-amber-400'}`} />
          {socketOk ? 'Tempo real' : 'Modo polling'}
        </div>
      </div>

      {/* ── Formulário de adição ── */}
      <div className="card p-4 sm:p-5 mb-5">
        <p className="text-sm font-bold text-brand-text mb-3">Adicionar dispositivo</p>

        {/* Passos — colapsável */}
        <details className="group mb-4">
          <summary className="flex items-center gap-2 text-xs text-brand-muted cursor-pointer select-none hover:text-brand-text transition-colors">
            <span className="group-open:rotate-90 transition-transform">▶</span>
            Como funciona?
          </summary>
          <div className="mt-2 bg-brand-elevated rounded-xl p-3 space-y-1.5">
            {[
              'Preencha o nome e número do WhatsApp',
              'Clique em "+ Adicionar"',
              'Clique em "📱 Conectar WhatsApp" e escaneie o QR',
              'Pronto! Áudios recebidos serão transcritos automaticamente',
            ].map((t, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-brand-text-secondary">
                <span className="w-4 h-4 rounded-full bg-brand-primary/20 text-brand-primary flex-shrink-0 flex items-center justify-center text-[10px] font-bold mt-0.5">{i+1}</span>
                {t}
              </div>
            ))}
          </div>
        </details>

        <form onSubmit={handleAdd} className="space-y-2">
          <input
            className="input w-full"
            placeholder="Nome do dispositivo (ex: Comercial, Pessoal)"
            value={addName}
            onChange={e => setAddName(e.target.value)}
            required
          />

          {/* Campo número com prefixo integrado */}
          <div className="flex gap-2">
            <div className="flex flex-1 rounded-xl border border-brand-border bg-brand-elevated overflow-hidden focus-within:border-brand-primary transition-colors">
              <span className="flex items-center px-3 text-sm font-mono text-brand-text-secondary bg-brand-border/30 border-r border-brand-border select-none whitespace-nowrap">
                +55
              </span>
              <input
                className="flex-1 bg-transparent px-3 py-2.5 text-sm text-brand-text placeholder:text-brand-muted outline-none min-w-0"
                placeholder="11 9 8765-4321"
                value={addPhone}
                onChange={e => setAddPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
                inputMode="numeric"
              />
            </div>
            <button type="submit" disabled={adding} className="btn-primary px-4 sm:px-5 whitespace-nowrap">
              {adding ? <Spinner size={4} /> : '+ Adicionar'}
            </button>
          </div>

          <p className="text-[10px] text-brand-muted">DDD + número sem o +55 (ex: 11987654321)</p>
        </form>

        {error && !loading && (
          <p className="text-red-400 text-xs mt-3 bg-red-400/10 px-3 py-2 rounded-lg">{error}</p>
        )}
      </div>

      {/* ── Lista de números ── */}
      {loading ? (
        <div className="flex items-center justify-center py-12 gap-2 text-brand-muted text-sm">
          <Spinner size={4} /> Carregando...
        </div>
      ) : error && numbers.length === 0 ? (
        <div className="card p-6 text-center border-red-400/20">
          <div className="text-3xl mb-2">⚠️</div>
          <div className="text-sm text-red-400 font-semibold mb-1">Erro ao carregar</div>
          <div className="text-xs text-brand-muted mb-3">{error}</div>
          <button onClick={loadNumbers} className="btn-primary text-xs px-4 py-2">Tentar novamente</button>
        </div>
      ) : numbers.length === 0 ? (
        <div className="card p-10 sm:p-12 text-center">
          <div className="text-4xl mb-3">📱</div>
          <div className="text-sm text-brand-muted">Nenhum dispositivo ainda. Adicione um acima para começar.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {numbers.map(n => (
            <div key={n.id} className="card p-4 sm:p-5 hover:border-brand-primary/20 transition-colors">

              {/* Cabeçalho do card */}
              <div className="flex items-start justify-between mb-3 gap-2">
                <div className="min-w-0">
                  <div className="font-bold text-sm text-brand-text truncate">{n.displayName || 'Dispositivo'}</div>
                  <div className="text-xs text-brand-muted font-mono mt-0.5">
                    {n.phoneNumber !== 'pending' ? `+${n.phoneNumber}` : 'Aguardando conexão'}
                  </div>
                </div>
                <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border flex-shrink-0 ${statusColor(n.status)}`}>
                  {statusLabel(n.status)}
                </span>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-2 mb-4">
                <div className="bg-brand-elevated rounded-lg p-2.5">
                  <div className="text-base font-black text-brand-primary leading-none">{n.messageCount}</div>
                  <div className="text-[10px] text-brand-muted mt-0.5">transcrições</div>
                </div>
                <div className="bg-brand-elevated rounded-lg p-2.5">
                  <div className="text-base font-black text-brand-primary leading-none">{n.minutesUsed.toFixed(1)}</div>
                  <div className="text-[10px] text-brand-muted mt-0.5">min usados</div>
                </div>
              </div>

              {/* Ações */}
              {n.status === 'connected' ? (
                <div className="flex gap-2">
                  <button onClick={() => handleDisconnect(n.id)}
                    className="btn-ghost flex-1 justify-center text-xs py-2">
                    ⏹ Desconectar
                  </button>
                  {confirmDelete === n.id ? (
                    <div className="flex gap-1">
                      <button onClick={() => handleDelete(n.id)} disabled={deleting}
                        className="text-xs px-2 py-1.5 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors">
                        {deleting ? '...' : 'Confirmar'}
                      </button>
                      <button onClick={() => setConfirmDelete(null)}
                        className="text-xs px-2 py-1.5 rounded-lg border border-brand-border text-brand-muted">
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
                      Remover dispositivo
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal QR */}
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
