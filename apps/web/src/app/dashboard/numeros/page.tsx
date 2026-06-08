'use client';
import React, { useEffect, useState, useCallback, useRef } from 'react';
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
  privateMode: boolean;
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

// ── Passo visual ──────────────────────────────────────────────────────────────
function Step({ n, children, done }: { n: number; children: React.ReactNode; done?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <span className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-[11px] font-black mt-0.5 transition-colors ${
        done
          ? 'bg-green-500 text-white'
          : 'bg-brand-primary/20 text-brand-primary'
      }`}>
        {done ? '✓' : n}
      </span>
      <div className="text-xs text-brand-text-secondary leading-relaxed pt-0.5">{children}</div>
    </div>
  );
}

// ── Modal de conexão (código por número + QR Code como fallback) ──────────────
function ConnectModal({ number, onClose, onConnected, externalQr }: {
  number: WNumber;
  onClose: () => void;
  onConnected: () => void;
  externalQr?: string | null;
}) {
  const [phase, setPhase]             = useState<'init' | 'ready' | 'code' | 'waiting' | 'connected' | 'error'>('init');
  const [connectMode, setConnectMode] = useState<'phone' | 'qr'>('phone');
  const [error, setError]             = useState('');
  const [phoneInput, setPhoneInput]   = useState(
    number.phoneNumber && number.phoneNumber !== 'pending'
      ? number.phoneNumber.replace(/^55/, '')
      : ''
  );
  const [phoneError, setPhoneError]   = useState('');
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [requesting, setRequesting]   = useState(false);
  const [qrImage, setQrImage]         = useState<string | null>(null);
  const [qrLoading, setQrLoading]     = useState(false);
  const [copied, setCopied]           = useState(false);

  // Detecta telefone fixo: 10 dígitos = DDD(2) + 8 dígitos (sem o "9" do celular)
  const isLandline = phoneInput.replace(/\D/g, '').length === 10;

  const pollRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const qrPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Iniciar conexão ao abrir o modal
  useEffect(() => {
    (async () => {
      try {
        await api.post(`/numbers/${number.id}/connect`, {});
        setPhase('ready');
      } catch (err: any) {
        setError(err.message || 'Erro ao iniciar conexão. Verifique as configurações do servidor.');
        setPhase('error');
      }
    })();
    return () => { clearInterval(pollRef.current!); clearInterval(qrPollRef.current!); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Polling de status (código e QR)
  useEffect(() => {
    if (phase !== 'waiting' && phase !== 'code') return;
    pollRef.current = setInterval(async () => {
      try {
        const res = await api.get<{ connected: boolean }>(`/numbers/${number.id}/zapi-status`);
        if (res.connected) {
          setPhase('connected');
          clearInterval(pollRef.current!);
          clearInterval(qrPollRef.current!);
          setTimeout(() => { onConnected(); onClose(); }, 2000);
        }
      } catch { /* ignora */ }
    }, 2000);
    return () => clearInterval(pollRef.current!);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Polling de QR code (atualiza a cada 25s antes do QR expirar)
  useEffect(() => {
    if (connectMode !== 'qr' || phase === 'init' || phase === 'error' || phase === 'connected') return;
    let active = true;
    async function fetchQr() {
      if (!active) return;
      setQrLoading(true);
      try {
        const res = await api.get<{ qr?: string }>(`/numbers/${number.id}/qr`);
        if (res?.qr) setQrImage(res.qr);
      } catch { /* ignora */ } finally { if (active) setQrLoading(false); }
    }
    // Primeira tentativa imediata; o backend já faz retry interno com 3s de intervalo
    fetchQr();
    // Polling periódico a cada 25s para renovar o QR antes de expirar
    qrPollRef.current = setInterval(fetchQr, 25_000);
    // Também inicia polling de status
    setPhase(p => (p === 'ready' ? 'waiting' : p));
    return () => { active = false; clearInterval(qrPollRef.current!); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectMode, phase === 'ready' || phase === 'waiting' || phase === 'code']);

  // QR vindo do Socket.IO (evento qr:updated emitido pelo webhook Evolution)
  // Só troca para a tab QR se o usuário NÃO estiver já em modo phone (código por número)
  useEffect(() => {
    if (!externalQr) return;
    const qr = externalQr.startsWith('data:') ? externalQr : `data:image/png;base64,${externalQr}`;
    setQrImage(qr);
    setQrLoading(false);
    if (connectMode !== 'phone') setConnectMode('qr');
    if (phase === 'ready' || phase === 'init') setPhase('waiting');
  }, [externalQr]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fechar com ESC
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);

  async function handleRequestCode() {
    const digits = phoneInput.replace(/\D/g, '');
    if (digits.length < 10) { setPhoneError('Informe DDD + número (mínimo 10 dígitos).'); return; }
    setRequesting(true); setPhoneError(''); setPairingCode(null);
    try {
      const res = await api.post<{ code: string }>(`/numbers/${number.id}/pairing-code`, { phone: digits });
      setPairingCode(res.code);
      setPhase('code');
    } catch (err: any) {
      const msg   = (err.message || '') as string;
      const lower = msg.toLowerCase();
      // Fallback para QR: API sinaliza via flag OU mensagem indica indisponibilidade
      const useQr = err.fallbackToQr === true
        || lower.includes('not found')
        || lower.includes('indisponível')
        || lower.includes('qr code')
        || lower.includes('use o qr');
      if (useQr) {
        setPhoneError('');
        setQrImage(null);
        // Recriar instância para garantir estado limpo antes de buscar QR
        setPhase('init');
        api.post(`/numbers/${number.id}/connect`, {})
          .then(() => {
            setPhase('ready');
            setConnectMode('qr');
          })
          .catch(() => {
            setPhase('ready');
            setConnectMode('qr');
          });
      } else {
        setPhoneError(msg || 'Erro ao solicitar código. Tente novamente.');
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
      <div
        className="modal-panel w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto"
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

        <div className="p-5 space-y-4">

          {/* ── Conectado ── */}
          {phase === 'connected' && (
            <div className="text-center py-10">
              <div className="text-5xl mb-3">✅</div>
              <p className="font-bold text-brand-primary text-lg">WhatsApp conectado!</p>
              <p className="text-xs text-brand-muted mt-1">Fechando...</p>
            </div>
          )}

          {/* ── Erro ── */}
          {phase === 'error' && (
            <div className="text-center py-8">
              <div className="text-4xl mb-3">❌</div>
              <p className="text-red-400 text-sm font-semibold mb-2">Erro na conexão</p>
              <p className="text-xs text-brand-muted mb-4 leading-relaxed">{error}</p>
              <button
                onClick={() => { setPhase('init'); setError(''); }}
                className="btn-primary text-sm px-5 py-2"
              >
                Tentar novamente
              </button>
            </div>
          )}

          {/* ── Inicializando ── */}
          {phase === 'init' && (
            <div className="flex flex-col items-center gap-3 py-8 text-brand-muted">
              <Spinner size={8} />
              <p className="text-sm">Preparando conexão...</p>
            </div>
          )}

          {/* ── Pronto / digitando código / aguardando ── */}
          {(phase === 'ready' || phase === 'code' || phase === 'waiting') && (
            <>

              {/* ════════════════════════════════════════════════
                  MÉTODO PRINCIPAL — Código por número
                  (sem aviso de golpe, funciona em celular e fixo)
              ════════════════════════════════════════════════ */}
              {connectMode === 'phone' && (
                <>
                  {/* Cabeçalho do método */}
                  <div className="flex items-center gap-2 pb-1">
                    <div className="w-7 h-7 rounded-lg bg-brand-primary/15 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm">📲</span>
                    </div>
                    <div>
                      <p className="text-xs font-bold text-brand-text">Conectar pelo número</p>
                      <p className="text-[10px] text-brand-muted">Método recomendado — sem avisos do WhatsApp</p>
                    </div>
                  </div>

                  {pairingCode ? (
                    /* ── Código gerado ── */
                    <div className="text-center bg-brand-primary/10 border-2 border-brand-primary/30 rounded-2xl p-6">
                      <p className="text-[10px] text-brand-muted mb-1 font-bold uppercase tracking-widest">
                        Seu código de conexão
                      </p>
                      <p className="text-5xl font-black font-mono tracking-[0.18em] text-brand-primary my-4 select-all">
                        {formatCode(pairingCode)}
                      </p>
                      <button
                        onClick={() => { navigator.clipboard.writeText(pairingCode!); setCopied(true); setTimeout(() => setCopied(false), 2500); }}
                        className="flex items-center gap-2 mx-auto px-4 py-2 rounded-xl bg-brand-primary/15 border border-brand-primary/30 text-brand-primary text-sm font-semibold hover:bg-brand-primary/25 transition-all active:scale-95"
                      >
                        {copied ? '✅ Copiado!' : '📋 Copiar código'}
                      </button>
                      <div className="flex items-center justify-center gap-1.5 text-xs text-brand-muted mt-4">
                        <Spinner size={3} />
                        Aguardando você digitar no WhatsApp…
                      </div>
                    </div>
                  ) : (
                    /* ── Formulário de número ── */
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs font-semibold text-brand-text block mb-1.5">
                          Número do WhatsApp que deseja conectar
                        </label>
                        <div className="flex rounded-xl border border-brand-border bg-brand-elevated overflow-hidden focus-within:border-brand-primary transition-colors">
                          <span className="flex items-center px-3 text-sm font-mono text-brand-text-secondary bg-brand-border/30 border-r border-brand-border select-none">
                            +55
                          </span>
                          <input
                            className="flex-1 bg-transparent px-3 py-3 text-sm text-brand-text placeholder:text-brand-muted outline-none"
                            placeholder="(DDD) 9 8765-4321 ou (DDD) 3333-4567"
                            value={phoneInput}
                            onChange={e => { setPhoneInput(e.target.value.replace(/\D/g, '').slice(0, 11)); setPhoneError(''); }}
                            inputMode="numeric"
                            autoFocus
                          />
                        </div>
                        {phoneError && <p className="text-red-400 text-xs mt-1">{phoneError}</p>}

                        {/* Aviso fixo — neutro, sem forçar QR */}
                        {isLandline && (
                          <div className="flex items-center gap-2 bg-amber-400/8 border border-amber-400/20 rounded-xl px-3 py-2 mt-1.5">
                            <span className="text-sm flex-shrink-0">📞</span>
                            <p className="text-[10px] text-amber-400/90 leading-snug">
                              <strong>Telefone fixo</strong> — tente o código normalmente.
                              Se não funcionar, use QR Code abaixo.
                            </p>
                          </div>
                        )}

                        <p className="text-[10px] text-brand-muted mt-1.5">
                          Celular: DDD + 9 + número (11 dígitos) · Fixo: DDD + número (10 dígitos)
                        </p>
                      </div>

                      <button
                        onClick={handleRequestCode}
                        disabled={requesting || phoneInput.replace(/\D/g, '').length < 10}
                        className="btn-primary w-full py-3 flex items-center justify-center gap-2 disabled:opacity-50 text-sm font-semibold"
                      >
                        {requesting ? <><Spinner size={4} /> Gerando código…</> : '📲 Solicitar código de conexão'}
                      </button>

                      {/* Fallback discreto para QR */}
                      <button
                        type="button"
                        onClick={() => { setConnectMode('qr'); setPhoneError(''); setQrImage(null); }}
                        className="w-full text-center text-[11px] text-brand-muted hover:text-brand-text transition-colors py-1"
                      >
                        🔳 Prefiro escanear QR Code
                      </button>
                    </div>
                  )}

                  {/* Passos — visíveis antes e depois do código */}
                  <div className="bg-brand-elevated rounded-2xl p-4 space-y-2.5">
                    <p className="text-xs font-bold text-brand-text">
                      {pairingCode ? '✅ Código gerado! Agora no celular:' : 'Como vai funcionar:'}
                    </p>
                    <Step n={1} done={!!pairingCode}>
                      {pairingCode ? 'Código gerado com sucesso' : <>Digite o número e clique em <em>"Solicitar código"</em></>}
                    </Step>
                    <Step n={2} done={!!pairingCode}>No celular, abra o <strong>WhatsApp</strong></Step>
                    <Step n={3} done={!!pairingCode}>
                      Toque nos <strong>3 pontos ⋮</strong> → <strong>Dispositivos conectados</strong>
                    </Step>
                    <Step n={4} done={!!pairingCode}>Toque em <strong>"Conectar dispositivo"</strong></Step>
                    <Step n={5} done={false}>Escolha <strong>"Conectar pelo número do telefone"</strong></Step>
                    <Step n={6} done={false}>
                      {pairingCode
                        ? <><strong>Digite o código</strong>{' '}
                            <span className="font-mono font-black text-brand-primary text-base tracking-wider">
                              {formatCode(pairingCode)}
                            </span>
                          </>
                        : <strong>Digite aqui o código de 8 dígitos que vai aparecer</strong>}
                    </Step>
                  </div>
                </>
              )}

              {/* ════════════════════════════════════════════════
                  FALLBACK — QR Code
                  (exibido só quando o usuário escolhe ou código falha)
              ════════════════════════════════════════════════ */}
              {connectMode === 'qr' && (
                <>
                  {/* Voltar para código */}
                  <button
                    type="button"
                    onClick={() => { setConnectMode('phone'); setPairingCode(null); setPhoneError(''); }}
                    className="flex items-center gap-1.5 text-xs text-brand-primary hover:text-brand-primary/80 transition-colors font-semibold"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="15 18 9 12 15 6"/>
                    </svg>
                    Voltar para código por número (recomendado)
                  </button>

                  {/* Aviso de golpe — compacto, sem ser alarmante */}
                  <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 px-3 py-2.5">
                    <div className="flex items-start gap-2">
                      <span className="text-sm flex-shrink-0 mt-0.5">⚠️</span>
                      <div>
                        <p className="text-[11px] font-semibold text-amber-400 leading-snug">
                          O WhatsApp pode exibir "Suspeita de golpe"
                        </p>
                        <p className="text-[10px] text-brand-muted mt-0.5 leading-relaxed">
                          É normal — nossos servidores ficam nos EUA.
                          Basta <strong className="text-brand-text">ignorar e confirmar</strong>.
                          Para evitar o aviso, use o <strong className="text-brand-text">código por número</strong>.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* QR */}
                  <div className="flex flex-col items-center justify-center bg-brand-elevated rounded-2xl p-5 gap-3">
                    {qrImage ? (
                      <>
                        <img src={qrImage} alt="QR Code WhatsApp" className="w-52 h-52 rounded-xl border-2 border-brand-primary/30" />
                        <div className="flex items-center gap-1.5 text-xs text-brand-muted">
                          <Spinner size={3} />
                          Aguardando leitura do QR…
                        </div>
                        <p className="text-[10px] text-brand-muted">QR atualiza automaticamente a cada 20s</p>
                      </>
                    ) : (
                      <div className="flex flex-col items-center gap-3 py-6 text-brand-muted">
                        {qrLoading ? (
                          <><Spinner size={8} /><p className="text-sm">Carregando QR Code… (pode levar até 15s)</p></>
                        ) : (
                          <>
                            <p className="text-xs text-center">QR não disponível ainda.</p>
                            <button
                              onClick={() => {
                                setQrLoading(true);
                                api.get<{ qr?: string }>(`/numbers/${number.id}/qr`)
                                  .then(r => { if (r?.qr) setQrImage(r.qr); })
                                  .catch(() => null)
                                  .finally(() => setQrLoading(false));
                              }}
                              className="text-xs px-4 py-2 rounded-xl bg-brand-primary/15 border border-brand-primary/30 text-brand-primary hover:bg-brand-primary/25 transition-all"
                            >
                              🔄 Tentar novamente
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Passos QR */}
                  <div className="bg-brand-elevated rounded-2xl p-4 space-y-2.5">
                    <p className="text-xs font-bold text-brand-text">Como conectar via QR Code:</p>
                    <Step n={1} done={!!qrImage}>QR Code aparece acima — aguarde carregar</Step>
                    <Step n={2} done={false}>No celular, abra o <strong>WhatsApp</strong></Step>
                    <Step n={3} done={false}>
                      Toque em <strong>3 pontos ⋮</strong> (Android) ou <strong>Ajustes ⚙️</strong> (iPhone)
                    </Step>
                    <Step n={4} done={false}>
                      Selecione <strong>"Dispositivos conectados"</strong> → <strong>"Conectar dispositivo"</strong>
                    </Step>
                    <Step n={5} done={false}>Aponte a câmera para o QR acima e confirme</Step>
                  </div>

                  {/* Dica mobile — só relevante no QR */}
                  <div className="flex items-start gap-2 bg-blue-400/5 border border-blue-400/15 rounded-xl px-3 py-2.5">
                    <span className="text-sm mt-0.5">📱</span>
                    <p className="text-[11px] text-brand-muted leading-relaxed">
                      <strong className="text-brand-text">No celular?</strong>{' '}
                      Abra o ZapScript no computador para escanear o QR.
                      No Android use <strong className="text-brand-text">tela dividida</strong>: browser no topo + WhatsApp embaixo.
                    </p>
                  </div>
                </>
              )}

              {/* Dica de segurança — sempre visível */}
              <div className="flex items-start gap-2 bg-brand-elevated border border-brand-border/60 rounded-xl px-3 py-2.5">
                <span className="text-sm mt-0.5">🔒</span>
                <p className="text-[11px] text-brand-muted leading-relaxed">
                  O ZapScript funciona como um <strong className="text-brand-text">dispositivo adicional</strong> — igual ao WhatsApp Web.
                  Seu WhatsApp permanece intacto no celular.
                </p>
              </div>
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
  const [planName, setPlanName]             = useState('free');
  const [confirmDelete, setConfirmDelete]   = useState<string | null>(null);
  const [deleting, setDeleting]             = useState(false);
  const [connectNumber, setConnectNumber]   = useState<WNumber | null>(null);
  const [liveQr, setLiveQr]                = useState<string | null>(null);

  const loadNumbers = useCallback(async () => {
    setLoading(true); setError('');
    try { setNumbers((await api.get<WNumber[]>('/numbers')) ?? []); }
    catch (err: any) { setError(`Erro ao carregar: ${err.message}`); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    loadNumbers();
    api.get<any>('/auth/me').then(u => {
      setUserId(u.id);
      setPlanName(u.subscription?.plan?.name || 'free');
    });
  }, [loadNumbers]);

  const { connected: socketOk } = useSocket(userId, {
    audio_received: () => { loadNumbers(); },
    'qr:updated':   (d: { numberId: string; qr: string }) => {
      if (connectNumber?.id === d.numberId) setLiveQr(d.qr);
    },
    'number:connected': () => { loadNumbers(); },
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

  async function handlePrivateMode(id: string, current: boolean) {
    try {
      await api.patch(`/numbers/${id}`, { privateMode: !current });
      setNumbers(ns => ns.map(n => n.id === id ? { ...n, privateMode: !current } : n));
    } catch (err: any) {
      alert(err.message || 'Erro ao alterar modo privado.');
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
              'Clique em "Conectar WhatsApp" e siga as instruções para vincular pelo número',
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
                placeholder="(DDD) 9 8765-4321 ou (DDD) 3333-4567"
                value={addPhone}
                onChange={e => setAddPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
                inputMode="numeric"
              />
            </div>
            <button type="submit" disabled={adding} className="btn-primary px-4 sm:px-5 whitespace-nowrap">
              {adding ? <Spinner size={4} /> : '+ Adicionar'}
            </button>
          </div>

          <p className="text-[10px] text-brand-muted">Celular: 11 dígitos (DDD+9+número) · Fixo: 10 dígitos (DDD+número) — conecte via QR Code</p>
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

              {/* Modo Privado — Executive+ */}
              {planName === 'executive' ? (
                <div className="flex items-center justify-between bg-brand-elevated rounded-xl px-3 py-2.5 mb-3 gap-2">
                  <div>
                    <div className="text-xs font-semibold text-brand-text flex items-center gap-1.5">
                      🔒 Modo Privado
                    </div>
                    <div className="text-[10px] text-brand-muted mt-0.5">
                      Transcrições enviadas só ao seu número
                    </div>
                  </div>
                  <button
                    onClick={() => handlePrivateMode(n.id, n.privateMode)}
                    className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${n.privateMode ? 'bg-amber-400' : 'bg-brand-border'}`}>
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${n.privateMode ? 'translate-x-4' : ''}`} />
                  </button>
                </div>
              ) : null}

              {/* Ações */}
              {n.status === 'connected' ? (
                <div className="space-y-2">
                  {/* Desconectar — ação principal */}
                  <button onClick={() => handleDisconnect(n.id)}
                    className="btn-ghost w-full justify-center text-xs py-2">
                    ⏹ Desconectar
                  </button>
                  {/* Remover dispositivo — ação destrutiva */}
                  {confirmDelete === n.id ? (
                    <div className="flex gap-2">
                      <button onClick={() => handleDelete(n.id)} disabled={deleting}
                        className="flex-1 text-xs px-3 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors font-medium">
                        {deleting ? 'Removendo...' : 'Confirmar remoção'}
                      </button>
                      <button onClick={() => setConfirmDelete(null)}
                        className="text-xs px-3 py-2 rounded-lg border border-brand-border text-brand-muted hover:text-brand-text transition-colors">
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDelete(n.id)}
                      className="w-full text-xs px-3 py-2 rounded-lg border border-red-400/20 text-red-400/60 hover:text-red-400 hover:border-red-400/40 hover:bg-red-400/5 transition-colors">
                      🗑 Remover dispositivo
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <button
                    onClick={() => setConnectNumber(n)}
                    className="btn-primary w-full text-sm py-2.5 flex items-center justify-center gap-2">
                    <span>📱</span>
                    {n.status === 'connecting' ? 'Continuar conexão' : 'Conectar WhatsApp'}
                  </button>
                  {confirmDelete === n.id ? (
                    <div className="flex gap-2">
                      <button onClick={() => handleDelete(n.id)} disabled={deleting}
                        className="flex-1 text-xs px-3 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors font-medium">
                        {deleting ? 'Removendo...' : 'Confirmar remoção'}
                      </button>
                      <button onClick={() => setConfirmDelete(null)}
                        className="text-xs px-3 py-2 rounded-lg border border-brand-border text-brand-muted hover:text-brand-text transition-colors">
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDelete(n.id)}
                      className="w-full text-xs px-3 py-2 rounded-lg border border-red-400/20 text-red-400/60 hover:text-red-400 hover:border-red-400/40 hover:bg-red-400/5 transition-colors">
                      🗑 Remover dispositivo
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal de conexão */}
      {connectNumber && (
        <ConnectModal
          number={connectNumber}
          onClose={() => { setConnectNumber(null); setLiveQr(null); }}
          onConnected={() => { loadNumbers(); setLiveQr(null); }}
          externalQr={liveQr}
        />
      )}
    </div>
  );
}
