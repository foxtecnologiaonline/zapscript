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
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Pairing code state
  const [pairingModal, setPairingModal] = useState<{
    numberId: string;
    phone: string;
    code: string | null;
    loading: boolean;
  } | null>(null);

  const [userId, setUserId] = useState('');

  useEffect(() => {
    loadNumbers();
    api.get<any>('/auth/me').then(u => setUserId(u.id));
  }, []);

  async function loadNumbers() {
    setLoading(true);
    try {
      const data = await api.get<WNumber[]>('/numbers');
      setNumbers(data);
    } finally {
      setLoading(false);
    }
  }

  /* ── Convert raw QR string → data URL ── */
  async function applyQR(numberId: string, rawQr: string) {
    try {
      const QRCode = (await import('qrcode')).default;
      const dataUrl = await QRCode.toDataURL(rawQr, { width: 280, margin: 2 });
      setQr({ numberId, dataUrl });
    } catch {
      setQr({ numberId, dataUrl: '' });
    }
  }

  /* ── REST polling for QR (fallback if Socket.IO event missed) ── */
  function stopPoll() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }
  function startQRPoll(numberId: string) {
    stopPoll();
    let attempts = 0;
    pollRef.current = setInterval(async () => {
      if (++attempts > 20) { stopPoll(); return; }
      try {
        const res = await api.get<{ qr: string }>(`/numbers/${numberId}/qr`);
        if (res.qr) { await applyQR(numberId, res.qr); stopPoll(); }
      } catch { /* not ready yet */ }
    }, 2000);
  }

  useSocket(userId, {
    qr_code: async ({ numberId, qr: rawQr }: { numberId: string; qr: string }) => {
      stopPoll();
      await applyQR(numberId, rawQr);
    },
    pairing_code: ({ numberId, code }: { numberId: string; code: string }) => {
      setPairingModal(prev =>
        prev && prev.numberId === numberId
          ? { ...prev, code, loading: false }
          : prev
      );
    },
    wa_connected: () => {
      stopPoll();
      setQr(null);
      setConnectingId(null);
      setPairingModal(null);
      loadNumbers();
    },
    wa_disconnected: () => {
      stopPoll();
      loadNumbers();
    },
  });

  useEffect(() => () => stopPoll(), []);

  /* ── Add number ── */
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
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  }

  /* ── Connect via QR Code ── */
  async function handleConnectQR(id: string) {
    setConnectingId(id); setError(''); setQr(null);
    try {
      await api.post(`/numbers/${id}/connect`, {});
      startQRPoll(id);
    } catch (err: any) {
      setError(err.message);
      setConnectingId(null);
      stopPoll();
    }
  }

  /* ── Connect via Pairing Code ── */
  function openPairingModal(n: WNumber) {
    const knownPhone = n.phoneNumber !== 'pending' ? n.phoneNumber : '';
    setPairingModal({ numberId: n.id, phone: knownPhone, code: null, loading: false });
  }

  async function handleRequestPairing() {
    if (!pairingModal) return;
    const clean = pairingModal.phone.replace(/\D/g, '');
    if (clean.length < 10) {
      setError('Digite o número completo com DDI e DDD (ex: 5511999999999).');
      return;
    }
    setError('');
    setPairingModal(prev => prev ? { ...prev, loading: true, code: null } : prev);
    try {
      const res = await api.post<{ code: string }>(`/numbers/${pairingModal.numberId}/connect-pairing`, {
        phoneNumber: clean,
      });
      setPairingModal(prev => prev ? { ...prev, code: res.code, loading: false } : prev);
      setConnectingId(pairingModal.numberId);
    } catch (err: any) {
      setError(err.message);
      setPairingModal(prev => prev ? { ...prev, loading: false } : prev);
    }
  }

  /* ── Disconnect ── */
  async function handleDisconnect(id: string) {
    await api.post(`/numbers/${id}/disconnect`, {});
    loadNumbers();
  }

  /* ── Delete ── */
  async function handleDelete(id: string) {
    if (!confirm('Remover este número? Todos os dados serão perdidos.')) return;
    await api.delete(`/numbers/${id}`);
    setNumbers(n => n.filter(x => x.id !== id));
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
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-brand-text">Números WhatsApp</h1>
        <p className="text-sm text-brand-text-secondary font-light mt-0.5">
          Gerencie os números conectados ao ZapScript
        </p>
      </div>

      {/* ── Add number form ─────────────────────────── */}
      <div className="card p-5 mb-5">
        <div className="text-sm font-bold mb-3 text-brand-text">Adicionar dispositivo</div>
        <form onSubmit={handleAdd} className="space-y-3">
          <div>
            <input
              className="input w-full"
              placeholder="Nome do dispositivo (ex: Comercial, Pessoal, Suporte)"
              value={addName}
              onChange={e => setAddName(e.target.value)}
              required
            />
          </div>
          <div>
            <input
              className="input w-full"
              placeholder="Número do WhatsApp (opcional — ex: 5511999999999)"
              value={addPhone}
              onChange={e => setAddPhone(e.target.value)}
              type="tel"
            />
            <p className="text-[11px] text-brand-muted mt-1.5 leading-relaxed">
              📞 Formato: <strong>DDI + DDD + Número</strong>, somente dígitos — sem +, espaços ou traços.<br />
              Ex: <code className="bg-brand-elevated px-1 rounded">55</code> (Brasil) +{' '}
              <code className="bg-brand-elevated px-1 rounded">11</code> (São Paulo) +{' '}
              <code className="bg-brand-elevated px-1 rounded">999999999</code> → <code className="bg-brand-elevated px-1 rounded">5511999999999</code>
            </p>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button type="submit" disabled={adding} className="btn-primary">
              {adding ? 'Adicionando...' : '+ Adicionar'}
            </button>
            <span className="text-xs text-brand-muted">
              Após adicionar, escolha como conectar no card abaixo.
            </span>
          </div>
        </form>
        {error && (
          <p className="text-red-400 text-xs mt-3 bg-red-400/10 px-3 py-2 rounded-lg">{error}</p>
        )}
      </div>

      {/* ── Number cards ────────────────────────────── */}
      {loading ? (
        <div className="text-center py-12 text-brand-muted text-sm">Carregando...</div>
      ) : numbers.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-4xl mb-3">📱</div>
          <div className="text-sm text-brand-muted">Nenhum dispositivo cadastrado ainda. Adicione um acima.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {numbers.map(n => (
            <div key={n.id} className="card p-5 hover:border-brand-primary/20 transition-colors">
              {/* Header */}
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
                  <button onClick={() => handleDelete(n.id)}
                    className="text-xs px-3 py-2 rounded-lg border border-red-400/15 text-brand-muted hover:text-red-400 hover:border-red-400/30 transition-colors">
                    🗑
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {/* QR Code button */}
                  <button
                    onClick={() => handleConnectQR(n.id)}
                    disabled={connectingId === n.id}
                    className="btn-primary w-full justify-center text-xs py-2.5 flex items-center gap-2"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                      <rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3M17 20h3M20 17v3"/>
                    </svg>
                    {connectingId === n.id && !pairingModal ? '⟳ Aguardando QR...' : '📷 Conectar por QR Code'}
                  </button>

                  {/* Pairing Code button */}
                  <button
                    onClick={() => openPairingModal(n)}
                    disabled={connectingId === n.id}
                    className="btn-ghost w-full justify-center text-xs py-2.5 flex items-center gap-2"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>
                    </svg>
                    {connectingId === n.id && pairingModal ? '⟳ Aguardando código...' : '🔢 Conectar por Número'}
                  </button>

                  {/* Delete */}
                  <button onClick={() => handleDelete(n.id)}
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-red-400/10 text-red-400/60 hover:text-red-400 hover:border-red-400/30 transition-colors">
                    Remover dispositivo
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ════════════════════════════════════════
          QR Code Modal
          ════════════════════════════════════════ */}
      {qr && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="modal-panel max-w-sm w-full text-center">
            <div className="text-lg font-bold mb-1 text-brand-text">📷 Escanear QR Code</div>
            <p className="text-xs text-brand-text-secondary font-light mb-5">
              Abra o <strong>WhatsApp</strong> → Menu ⋮ → <strong>Dispositivos conectados</strong> → <strong>Conectar dispositivo</strong>
            </p>
            {qr.dataUrl ? (
              <div className="bg-white p-3 rounded-xl inline-block mb-5">
                <img src={qr.dataUrl} alt="QR Code" width={256} height={256} />
              </div>
            ) : (
              <div className="w-64 h-64 bg-brand-elevated rounded-xl flex items-center justify-center mx-auto mb-5 text-brand-muted text-sm animate-pulse">
                Gerando QR Code...
              </div>
            )}
            <div className="flex items-center justify-center gap-2 text-xs text-brand-text-secondary mb-5">
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
              Aguardando escaneamento...
            </div>
            <button
              onClick={() => { stopPoll(); setQr(null); setConnectingId(null); }}
              className="btn-ghost w-full justify-center text-sm py-2"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════
          Pairing Code Modal
          ════════════════════════════════════════ */}
      {pairingModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="modal-panel max-w-sm w-full">
            <div className="text-lg font-bold mb-1 text-brand-text">🔢 Conectar por Número</div>
            <p className="text-xs text-brand-text-secondary font-light mb-5">
              Sem câmera? Use o código de vinculação diretamente no WhatsApp.
            </p>

            {!pairingModal.code ? (
              /* ── Step 1: enter phone ── */
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
                    onChange={e => setPairingModal(prev => prev ? { ...prev, phone: e.target.value } : prev)}
                  />
                  <p className="text-[11px] text-brand-muted mt-1.5 leading-relaxed">
                    DDI + DDD + Número, somente dígitos. Exemplo:<br />
                    🇧🇷 Brasil São Paulo: <code className="bg-brand-elevated px-1 rounded">5511999999999</code>
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
                        <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Gerando código...
                      </span>
                    ) : 'Gerar Código'}
                  </button>
                  <button
                    onClick={() => { setPairingModal(null); setConnectingId(null); setError(''); }}
                    className="btn-ghost px-4"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              /* ── Step 2: show code ── */
              <div className="space-y-4">
                <div className="text-center py-4">
                  <p className="text-xs text-brand-muted mb-2">Seu código de vinculação:</p>
                  <div className="text-4xl font-black tracking-[.3em] font-mono text-brand-primary">
                    {pairingModal.code}
                  </div>
                  <p className="text-[11px] text-brand-muted mt-2">
                    Válido por aproximadamente 60 segundos
                  </p>
                </div>

                <div className="inner-block space-y-2">
                  <p className="text-xs font-bold text-brand-text">Como usar:</p>
                  {[
                    'Abra o WhatsApp no celular',
                    'Toque em ⋮ Menu → Dispositivos conectados',
                    'Toque em "Conectar dispositivo"',
                    'Escolha "Vincular por número de telefone"',
                    `Digite o código: ${pairingModal.code}`,
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
                  Aguardando vinculação...
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setPairingModal(prev => prev ? { ...prev, code: null } : prev);
                      setError('');
                    }}
                    className="btn-ghost flex-1 justify-center text-xs py-2"
                  >
                    ↩ Tentar novamente
                  </button>
                  <button
                    onClick={() => { setPairingModal(null); setConnectingId(null); }}
                    className="btn-ghost flex-1 justify-center text-xs py-2"
                  >
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
