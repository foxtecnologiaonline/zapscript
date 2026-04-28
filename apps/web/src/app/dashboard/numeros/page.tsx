'use client';
import { useEffect, useRef, useState } from 'react';
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

export default function NumerosPage() {
  const [numbers, setNumbers]       = useState<WNumber[]>([]);
  const [loading, setLoading]       = useState(true);
  const [addName, setAddName]       = useState('');
  const [addPhone, setAddPhone]     = useState('');
  const [adding, setAdding]         = useState(false);
  const [error, setError]           = useState('');

  // QR code state
  const [qr, setQr]                 = useState<{ numberId: string; dataUrl: string } | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);

  // Pairing code state
  const [pairingModal, setPairingModal] = useState<{
    numberId: string;
    phone: string;
    code: string | null;
    loading: boolean;
  } | null>(null);

  const [userId, setUserId] = useState('');

  // Polling refs
  const qrPollRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const statusPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadNumbers();
    api.get<any>('/auth/me').then(u => setUserId(u.id));
    return () => { stopQRPoll(); stopStatusPoll(); };
  }, []);

  async function loadNumbers() {
    setLoading(true);
    try { setNumbers(await api.get<WNumber[]>('/numbers')); }
    finally { setLoading(false); }
  }

  /* ────────────────────────────────────────
     QR CODE POLLING (funciona sem Socket.IO)
     Busca o QR via REST a cada 2s por até 90s.
     ──────────────────────────────────────── */
  function stopQRPoll() {
    if (qrPollRef.current) { clearInterval(qrPollRef.current); qrPollRef.current = null; }
  }

  function startQRPoll(numberId: string) {
    stopQRPoll();
    let attempts = 0;
    qrPollRef.current = setInterval(async () => {
      if (++attempts > 45) {           // 90 segundos máximo
        stopQRPoll();
        setConnectingId(null);
        setError('Tempo esgotado aguardando QR Code. Verifique os logs da API e tente novamente.');
        return;
      }
      try {
        const res = await api.get<{ qr: string }>(`/numbers/${numberId}/qr`);
        if (res?.qr) {
          stopQRPoll();
          const QRCode = (await import('qrcode')).default;
          const dataUrl = await QRCode.toDataURL(res.qr, { width: 300, margin: 2 });
          setQr({ numberId, dataUrl });
        }
      } catch { /* 404 = QR ainda não gerado, continua */ }
    }, 2000);
  }

  /* ────────────────────────────────────────
     STATUS POLLING (detecta conexão sem WS)
     Checa se o número ficou "connected" a cada 4s.
     ──────────────────────────────────────── */
  function stopStatusPoll() {
    if (statusPollRef.current) { clearInterval(statusPollRef.current); statusPollRef.current = null; }
  }

  function startStatusPoll(numberId: string) {
    stopStatusPoll();
    statusPollRef.current = setInterval(async () => {
      try {
        const data = await api.get<WNumber[]>('/numbers');
        const n = data.find(x => x.id === numberId);
        if (n?.status === 'connected') {
          stopStatusPoll(); stopQRPoll();
          setQr(null); setConnectingId(null); setPairingModal(null);
          setNumbers(data);
        }
      } catch { /* ignora falhas pontuais */ }
    }, 4000);
  }

  /* ────────────────────────────────────────
     SOCKET.IO — bonus em cima do polling
     Eventos chegam mais rápido quando o WS funciona.
     ──────────────────────────────────────── */
  const { connected: socketOk } = useSocket(userId, {
    qr_code: async ({ numberId, qr: rawQr }: { numberId: string; qr: string }) => {
      stopQRPoll();
      try {
        const QRCode = (await import('qrcode')).default;
        const dataUrl = await QRCode.toDataURL(rawQr, { width: 300, margin: 2 });
        setQr({ numberId, dataUrl });
      } catch { setQr({ numberId, dataUrl: '' }); }
    },
    pairing_code: ({ numberId, code }: { numberId: string; code: string }) => {
      setPairingModal(prev =>
        prev?.numberId === numberId ? { ...prev, code, loading: false } : prev
      );
    },
    wa_connected: () => {
      stopStatusPoll(); stopQRPoll();
      setQr(null); setConnectingId(null); setPairingModal(null);
      loadNumbers();
    },
    wa_disconnected: () => {
      stopStatusPoll(); loadNumbers();
    },
  });

  /* ──────── Actions ──────── */

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!addName.trim()) return;
    setAdding(true); setError('');
    try {
      await api.post('/numbers', {
        displayName: addName.trim(),
        phoneNumber: addPhone.replace(/\D/g, '') || undefined,
      });
      setAddName(''); setAddPhone('');
      loadNumbers();
    } catch (err: any) { setError(err.message); }
    finally { setAdding(false); }
  }

  async function handleConnectQR(id: string) {
    setConnectingId(id); setError(''); setQr(null);
    try {
      await api.post(`/numbers/${id}/connect`, {});
      startQRPoll(id);     // polling REST para QR
      startStatusPoll(id); // polling para detectar conexão
    } catch (err: any) {
      setError(err.message); setConnectingId(null);
      stopQRPoll(); stopStatusPoll();
    }
  }

  function openPairingModal(n: WNumber) {
    const knownPhone = n.phoneNumber !== 'pending' ? n.phoneNumber : '';
    setPairingModal({ numberId: n.id, phone: knownPhone, code: null, loading: false });
    setError('');
  }

  async function handleRequestPairing() {
    if (!pairingModal) return;
    const clean = pairingModal.phone.replace(/\D/g, '');
    if (clean.length < 10) {
      setError('Digite o número completo com DDI e DDD (ex: 5511999999999).'); return;
    }
    setError('');
    setPairingModal(prev => prev ? { ...prev, loading: true, code: null } : prev);
    try {
      const res = await api.post<{ code: string }>(
        `/numbers/${pairingModal.numberId}/connect-pairing`,
        { phoneNumber: clean }
      );
      setPairingModal(prev => prev ? { ...prev, code: res.code, loading: false } : prev);
      setConnectingId(pairingModal.numberId);
      startStatusPoll(pairingModal.numberId);
    } catch (err: any) {
      setError(err.message);
      setPairingModal(prev => prev ? { ...prev, loading: false } : prev);
    }
  }

  async function handleDisconnect(id: string) {
    await api.post(`/numbers/${id}/disconnect`, {});
    loadNumbers();
  }

  async function handleDelete(id: string) {
    if (!confirm('Remover este número? Todos os dados serão perdidos.')) return;
    await api.delete(`/numbers/${id}`);
    setNumbers(n => n.filter(x => x.id !== id));
  }

  function cancelConnect() {
    stopQRPoll(); stopStatusPoll();
    setQr(null); setConnectingId(null); setPairingModal(null); setError('');
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
            Gerencie os dispositivos conectados ao ZapScript
          </p>
        </div>
        {/* Socket.IO status indicator */}
        <div className={`flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${
          socketOk
            ? 'text-green-500 bg-green-400/10 border-green-400/20'
            : 'text-amber-500 bg-amber-400/10 border-amber-400/20'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${socketOk ? 'bg-green-400 animate-pulse' : 'bg-amber-400'}`} />
          {socketOk ? 'Tempo real ativo' : 'Modo polling'}
        </div>
      </div>

      {/* ── Add number form ── */}
      <div className="card p-5 mb-5">
        <div className="text-sm font-bold mb-3 text-brand-text">Adicionar dispositivo</div>
        <form onSubmit={handleAdd} className="space-y-3">

          <input
            className="input w-full"
            placeholder="Nome do dispositivo (ex: Comercial, Pessoal, Suporte)"
            value={addName}
            onChange={e => setAddName(e.target.value)}
            required
          />

          <div>
            <input
              className="input w-full"
              placeholder="Número do WhatsApp — opcional (ex: 5511999999999)"
              value={addPhone}
              onChange={e => setAddPhone(e.target.value)}
              type="tel"
            />
            <p className="text-[11px] text-brand-muted mt-1.5 leading-relaxed">
              📞 <strong>DDI + DDD + Número</strong>, somente dígitos, sem + ou espaços.
              {' '}<span className="opacity-70">
                Ex: Brasil SP → <code className="bg-brand-elevated px-1 rounded">55</code>
                +<code className="bg-brand-elevated px-1 rounded">11</code>
                +<code className="bg-brand-elevated px-1 rounded">999999999</code>
                {' '}= <code className="bg-brand-elevated px-1 rounded">5511999999999</code>
              </span>
            </p>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button type="submit" disabled={adding} className="btn-primary">
              {adding ? 'Adicionando...' : '+ Adicionar'}
            </button>
            <span className="text-xs text-brand-muted">
              Após adicionar, escolha QR Code ou Código por Número para conectar.
            </span>
          </div>
        </form>

        {error && (
          <p className="text-red-400 text-xs mt-3 bg-red-400/10 px-3 py-2 rounded-lg">{error}</p>
        )}
      </div>

      {/* ── Number cards ── */}
      {loading ? (
        <div className="text-center py-12 text-brand-muted text-sm">Carregando...</div>
      ) : numbers.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-4xl mb-3">📱</div>
          <div className="text-sm text-brand-muted">
            Nenhum dispositivo cadastrado ainda. Adicione um acima.
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

              {/* Action buttons */}
              {n.status === 'connected' ? (
                <div className="flex gap-2">
                  <button onClick={() => handleDisconnect(n.id)}
                    className="btn-ghost flex-1 justify-center text-xs py-2">
                    ⏹ Desconectar
                  </button>
                  <button onClick={() => handleDelete(n.id)}
                    className="text-xs px-3 py-2 rounded-lg border border-red-400/15 text-brand-muted hover:text-red-400 hover:border-red-400/30 transition-colors">
                    🗑
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {/* QR Code */}
                  <button
                    onClick={() => handleConnectQR(n.id)}
                    disabled={!!connectingId}
                    className="btn-primary w-full justify-center text-xs py-2.5 flex items-center gap-2"
                  >
                    <span>📷</span>
                    {connectingId === n.id && !pairingModal
                      ? '⟳ Aguardando QR Code...'
                      : 'Conectar por QR Code'}
                  </button>

                  {/* Pairing Code */}
                  <button
                    onClick={() => openPairingModal(n)}
                    disabled={!!connectingId}
                    className="btn-ghost w-full justify-center text-xs py-2.5 flex items-center gap-2"
                  >
                    <span>🔢</span>
                    {connectingId === n.id && pairingModal
                      ? '⟳ Aguardando vinculação...'
                      : 'Conectar por Número'}
                  </button>

                  <button onClick={() => handleDelete(n.id)}
                    className="w-full text-[11px] px-3 py-1 rounded-lg border border-red-400/10 text-red-400/50 hover:text-red-400 hover:border-red-400/30 transition-colors">
                    Remover
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ════════════════════════
          QR Code Modal
          ════════════════════════ */}
      {(qr || (connectingId && !pairingModal)) && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="modal-panel max-w-sm w-full text-center">
            <div className="text-lg font-bold mb-1 text-brand-text">📷 Escanear QR Code</div>
            <p className="text-xs text-brand-text-secondary font-light mb-5">
              Abra o <strong>WhatsApp</strong> → Menu ⋮ →{' '}
              <strong>Dispositivos conectados</strong> → <strong>Conectar dispositivo</strong>
            </p>

            {qr?.dataUrl ? (
              <div className="bg-white p-3 rounded-xl inline-block mb-5">
                <img src={qr.dataUrl} alt="QR Code" width={280} height={280} />
              </div>
            ) : (
              <div className="w-[280px] h-[280px] bg-brand-elevated rounded-xl flex flex-col items-center justify-center mx-auto mb-5 gap-3">
                <div className="w-8 h-8 border-2 border-brand-primary/30 border-t-brand-primary rounded-full animate-spin" />
                <span className="text-xs text-brand-muted">Gerando QR Code...</span>
                <span className="text-[10px] text-brand-muted opacity-60">Pode levar até 30s na primeira vez</span>
              </div>
            )}

            <div className="flex items-center justify-center gap-2 text-xs text-brand-text-secondary mb-5">
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
              {qr ? 'Aguardando escaneamento...' : 'Iniciando sessão WhatsApp...'}
            </div>

            <button onClick={cancelConnect} className="btn-ghost w-full justify-center text-sm py-2">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* ════════════════════════
          Pairing Code Modal
          ════════════════════════ */}
      {pairingModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="modal-panel max-w-sm w-full">
            <div className="text-lg font-bold mb-1 text-brand-text">🔢 Conectar por Número</div>
            <p className="text-xs text-brand-text-secondary font-light mb-5">
              Sem precisar escanear QR Code — ideal para quem está no celular.
            </p>

            {!pairingModal.code ? (
              /* Step 1: enter phone number */
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-brand-text-secondary mb-1.5">
                    Número do WhatsApp
                  </label>
                  <input
                    className="input w-full"
                    placeholder="5511999999999"
                    type="tel"
                    value={pairingModal.phone}
                    onChange={e =>
                      setPairingModal(prev => prev ? { ...prev, phone: e.target.value } : prev)
                    }
                    autoFocus
                  />
                  <p className="text-[11px] text-brand-muted mt-1.5 leading-relaxed">
                    <strong>DDI + DDD + Número</strong>, somente dígitos.<br />
                    🇧🇷 Exemplo São Paulo:{' '}
                    <code className="bg-brand-elevated px-1 rounded">5511999999999</code>
                  </p>
                </div>

                {error && (
                  <p className="text-red-400 text-xs bg-red-400/10 px-3 py-2 rounded-lg">{error}</p>
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    onClick={handleRequestPairing}
                    disabled={pairingModal.loading}
                    className="btn-primary flex-1 justify-center text-sm py-2.5"
                  >
                    {pairingModal.loading ? (
                      <span className="flex items-center gap-2">
                        <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Gerando código...
                      </span>
                    ) : 'Gerar Código'}
                  </button>
                  <button onClick={cancelConnect} className="btn-ghost px-4">
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              /* Step 2: show the code */
              <div className="space-y-4">
                <div className="text-center py-3">
                  <p className="text-xs text-brand-muted mb-2">Código de vinculação:</p>
                  <div className="text-5xl font-black tracking-[.25em] font-mono text-brand-primary select-all">
                    {pairingModal.code}
                  </div>
                  <p className="text-[11px] text-amber-500 mt-2">⏱ Válido por ~60 segundos</p>
                </div>

                <div className="inner-block space-y-2.5">
                  <p className="text-xs font-bold text-brand-text mb-1">Como usar:</p>
                  {[
                    'Abra o WhatsApp no celular',
                    'Toque em ⋮ Menu → Dispositivos conectados',
                    'Toque em "Conectar dispositivo"',
                    'Escolha "Vincular por número de telefone"',
                    `Digite: ${pairingModal.code}`,
                  ].map((step, i) => (
                    <div key={i} className="flex items-start gap-2.5 text-xs text-brand-text-secondary">
                      <span className="w-4 h-4 rounded-full bg-brand-primary/15 text-brand-primary flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5">
                        {i + 1}
                      </span>
                      {step}
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-2 text-xs text-brand-text-secondary">
                  <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
                  Aguardando vinculação... (verificando a cada 4 segundos)
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setPairingModal(prev => prev ? { ...prev, code: null } : prev);
                      setError('');
                    }}
                    className="btn-ghost flex-1 justify-center text-xs py-2"
                  >
                    ↩ Gerar novo código
                  </button>
                  <button onClick={cancelConnect} className="btn-ghost flex-1 justify-center text-xs py-2">
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
