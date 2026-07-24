'use client';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import MetaEmbeddedSignup from './MetaEmbeddedSignup';

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

// ── Passo grande (legível no mobile) ───────────────────────────────────────────
function BigStep({ n, children, done }: { n: number; children: React.ReactNode; done?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <span className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-black transition-colors ${
        done ? 'bg-green-500 text-white' : 'bg-brand-primary/20 text-brand-primary'
      }`}>
        {done ? '✓' : n}
      </span>
      <div className="text-sm text-brand-text leading-snug pt-1">{children}</div>
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
  const [phase, setPhase]             = useState<'intro' | 'init' | 'ready' | 'code' | 'waiting' | 'connected' | 'error'>('intro');
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
  const [qrCountdown, setQrCountdown] = useState(25);
  const [copied, setCopied]           = useState(false);

  // Detecta telefone fixo: 10 dígitos = DDD(2) + 8 dígitos (sem o "9" do celular)
  const isLandline = phoneInput.replace(/\D/g, '').length === 10;

  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const qrPollRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoReqRef = useRef(false);  // garante auto-solicitação do código só 1×

  // Iniciar conexão — só após o usuário confirmar na tela de introdução
  const startConnection = useCallback(async () => {
    setPhase('init');
    try {
      await api.post(`/numbers/${number.id}/connect`, {});
      setPhase('ready');
    } catch (err: any) {
      setError(err.message || 'Erro ao iniciar conexão. Verifique as configurações do servidor.');
      setPhase('error');
    }
  }, [number.id]);

  // Cleanup polling ao fechar
  useEffect(() => {
    return () => { clearInterval(pollRef.current!); clearInterval(qrPollRef.current!); };
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

  // Carrega/renova o QR e reinicia a contagem regressiva (reutilizável: polling + botão manual)
  const loadQr = useCallback(async () => {
    setQrLoading(true);
    setQrCountdown(25);
    try {
      const res = await api.get<{ qr?: string }>(`/numbers/${number.id}/qr`);
      if (res?.qr) setQrImage(res.qr);
    } catch { /* ignora */ } finally { setQrLoading(false); }
  }, [number.id]);

  // Polling de QR code (atualiza a cada 25s antes do QR expirar)
  useEffect(() => {
    if (connectMode !== 'qr' || phase === 'intro' || phase === 'init' || phase === 'error' || phase === 'connected') return;
    // Primeira tentativa imediata; o backend já faz retry interno com 3s de intervalo
    loadQr();
    // Polling periódico a cada 25s para renovar o QR antes de expirar
    qrPollRef.current = setInterval(loadQr, 25_000);
    // Também inicia polling de status
    setPhase(p => (p === 'ready' ? 'waiting' : p));
    return () => { clearInterval(qrPollRef.current!); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectMode, phase === 'ready' || phase === 'waiting' || phase === 'code', loadQr]);

  // Contador regressivo visível até a próxima renovação do QR
  useEffect(() => {
    if (connectMode !== 'qr' || !qrImage) return;
    const t = setInterval(() => setQrCountdown(c => (c > 0 ? c - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [connectMode, qrImage]);

  // QR vindo do Socket.IO (evento qr:updated emitido pelo webhook Evolution)
  // Só troca para a tab QR se o usuário NÃO estiver na intro ou já em modo phone (código por número)
  useEffect(() => {
    if (!externalQr || phase === 'intro') return;
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
      setPhoneError(
        useQr
          ? 'Código indisponível para este número. Clique em "Gerar QR Code" abaixo para conectar via câmera.'
          : msg || 'Erro ao solicitar código. Tente novamente.'
      );
    } finally {
      setRequesting(false);
    }
  }

  function formatCode(code: string) {
    return code.length >= 8 ? `${code.slice(0, 4)}-${code.slice(4, 8)}` : code;
  }

  // Auto-gerar o código assim que a conexão fica pronta, quando já conhecemos o
  // número (reconexão / phoneNumber sincronizado pelo backend). Assim o cliente
  // vê o PAIRING CODE de imediato — QR só se ele clicar em "Gerar QR Code".
  useEffect(() => {
    if (phase !== 'ready' || connectMode !== 'phone') return;
    if (autoReqRef.current || pairingCode || requesting) return;
    if (phoneInput.replace(/\D/g, '').length >= 10) {
      autoReqRef.current = true;
      handleRequestCode();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, connectMode]);

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

          {/* ══════════════════════════════════════════════════════
              TELA DE INTRODUÇÃO — Tranquiliza antes de conectar.
              O usuário precisa CONFIAR antes de escanear QR.
          ══════════════════════════════════════════════════════ */}
          {phase === 'intro' && (
            <div className="space-y-4">
              {/* Cabeçalho visual */}
              <div className="text-center space-y-2">
                <div className="text-5xl">🔐</div>
                <h3 className="text-base font-bold text-brand-text">Seu WhatsApp, só seu</h3>
                <p className="text-xs text-brand-text-secondary leading-relaxed max-w-sm mx-auto">
                  Você está conectando <strong className="text-brand-text">seu próprio WhatsApp</strong> como um dispositivo adicional — igual ao WhatsApp Web. Nada muda no seu celular.
                </p>
              </div>

              {/* ── O que o ZapScript FAZ ── */}
              <div className="bg-green-400/5 border border-green-400/20 rounded-xl p-4 space-y-2.5">
                <p className="text-xs font-bold text-green-400 flex items-center gap-1.5">
                  <span>✅</span> O que o ZapScript vai fazer:
                </p>
                {[
                  'Ouvir apenas áudios que você recebe e convertê-los em texto',
                  'Entregar a transcrição e o resumo no seu próprio WhatsApp',
                  'Funcionar 24h por dia — você nem precisa abrir o app',
                ].map((t, i) => (
                  <div key={i} className="flex items-start gap-2 text-[11px] text-brand-text-secondary leading-relaxed">
                    <span className="text-green-400 mt-0.5 flex-shrink-0">▸</span>
                    {t}
                  </div>
                ))}
              </div>

              {/* ── O que o ZapScript NÃO FAZ ── */}
              <div className="bg-red-400/5 border border-red-400/20 rounded-xl p-4 space-y-2.5">
                <p className="text-xs font-bold text-red-400 flex items-center gap-1.5">
                  <span>🚫</span> O que o ZapScript <strong>NÃO</strong> faz:
                </p>
                {[
                  'Não lê suas mensagens de texto — só processa áudios',
                  'Nenhum humano vê suas conversas — é tudo automatizado',
                  'Não envia mensagens nem notifica seus contatos',
                  'Não acessa sua lista de contatos nem grupos',
                ].map((t, i) => (
                  <div key={i} className="flex items-start gap-2 text-[11px] text-brand-text-secondary leading-relaxed">
                    <span className="text-red-400 mt-0.5 flex-shrink-0">✕</span>
                    {t}
                  </div>
                ))}
              </div>

              {/* ── Selos de segurança ── */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { icon: '🔒', title: 'Criptografado', sub: 'AES-256' },
                  { icon: '🇧🇷', title: 'Servidores', sub: 'No Brasil (LGPD)' },
                  { icon: '🗑️', title: 'Áudio', sub: 'Descartado após uso' },
                ].map(s => (
                  <div key={s.title} className="text-center bg-brand-elevated rounded-xl py-2.5 px-1">
                    <div className="text-lg">{s.icon}</div>
                    <div className="text-[10px] font-semibold text-brand-text mt-1">{s.title}</div>
                    <div className="text-[9px] text-brand-muted">{s.sub}</div>
                  </div>
                ))}
              </div>

              {/* ── Depoimento social proof ── */}
              <div className="text-center bg-brand-elevated rounded-xl px-3 py-2.5">
                <p className="text-[11px] text-brand-text-secondary italic leading-relaxed">
                  &ldquo;Funciona igual WhatsApp Web — seu celular nem precisa estar ligado. E se quiser, desconecta em 1 clique.&rdquo;
                </p>
              </div>

              {/* ── CTA principal ── */}
              <button
                onClick={startConnection}
                className="btn-primary w-full py-3 flex items-center justify-center gap-2 text-sm font-semibold"
              >
                📱 Entendi — quero conectar meu WhatsApp
              </button>

              {/* ── Link sutil para política ── */}
              <p className="text-center text-[10px] text-brand-muted">
                Ao conectar você concorda com nossa{' '}
                <a href="/termos" target="_blank" rel="noopener noreferrer" className="text-brand-primary hover:underline font-medium">
                  Política de Privacidade
                </a>
              </p>
            </div>
          )}

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
                      <p className="text-[10px] text-brand-muted">Método recomendado — mais rápido e confiável</p>
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
                      <button
                        type="button"
                        onClick={() => { setConnectMode('qr'); setPairingCode(null); setPhoneError(''); setQrImage(null); }}
                        className="mt-3 text-[11px] text-brand-muted hover:text-brand-text underline underline-offset-2 transition-colors"
                      >
                        Prefere escanear? Gerar QR Code
                      </button>
                      {/* Aviso de localização — IP de datacenter */}
                      <div className="mt-4 rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-left">
                        <p className="text-[10px] text-amber-400/80 leading-relaxed">
                          <strong className="text-amber-400">📍 O WhatsApp pode indicar uma localização suspeita</strong> — é normal em plataformas de automação.
                          O aviso ocorre porque IPs de servidores cloud são identificados pelo WhatsApp independente do país. Basta <strong>confirmar a conexão</strong>.
                        </p>
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

                      {/* Alternativa — QR Code (opt-in explícito) */}
                      <button
                        type="button"
                        onClick={() => { setConnectMode('qr'); setPhoneError(''); setQrImage(null); }}
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-brand-border text-brand-text-secondary text-xs font-semibold hover:border-brand-primary/40 hover:text-brand-text transition-colors"
                      >
                        🔳 Gerar QR Code
                      </button>
                    </div>
                  )}

                  {/* Passos resumidos — 3 passos grandes e legíveis */}
                  <div className="bg-brand-elevated rounded-2xl p-4 sm:p-5 space-y-3">
                    <p className="text-base font-bold text-brand-text">
                      {pairingCode ? '✅ Código gerado! Agora no seu celular:' : 'Como conectar — 3 passos:'}
                    </p>
                    <BigStep n={1} done={!!pairingCode}>
                      Abra o seu <strong>WhatsApp</strong> ou <strong>WhatsApp Business</strong>
                    </BigStep>
                    <BigStep n={2} done={!!pairingCode}>
                      Toque nos <strong>3 pontos ⋮</strong> (canto superior direito) → <strong>Dispositivos conectados</strong>
                    </BigStep>
                    <BigStep n={3} done={false}>
                      Toque em <strong>Conectar dispositivo</strong> e{' '}
                      {pairingCode
                        ? <>insira ou cole o código abaixo:{' '}
                            <span className="font-mono font-black text-brand-primary text-xl tracking-wider whitespace-nowrap">
                              {formatCode(pairingCode)}
                            </span>
                          </>
                        : <>insira ou cole o <strong>código de conexão</strong> que vai aparecer aqui</>}
                    </BigStep>
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

                  {/* QR */}
                  <div className="flex flex-col items-center justify-center bg-brand-elevated rounded-2xl p-5 gap-3">
                    {qrImage ? (
                      <>
                        <img src={qrImage} alt="QR Code WhatsApp" className="w-52 h-52 rounded-xl border-2 border-brand-primary/30" />
                        <div className="flex items-center gap-1.5 text-xs text-brand-muted">
                          <Spinner size={3} />
                          Aguardando leitura do QR…
                        </div>
                        <p className="text-[10px] text-brand-muted">
                          {qrLoading ? 'Gerando novo QR…' : `Renova automaticamente em ${qrCountdown}s`}
                        </p>
                        <button
                          type="button"
                          onClick={loadQr}
                          disabled={qrLoading}
                          className="text-[11px] px-3 py-1.5 rounded-lg bg-brand-primary/10 border border-brand-primary/25 text-brand-primary hover:bg-brand-primary/20 transition-all disabled:opacity-50"
                        >
                          🔄 Gerar novo QR agora
                        </button>
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

                  {/* Passos QR — resumidos */}
                  <div className="bg-brand-elevated rounded-2xl p-4 sm:p-5 space-y-3">
                    <p className="text-base font-bold text-brand-text">Como conectar via QR — 3 passos:</p>
                    <BigStep n={1} done={!!qrImage}>
                      Abra o seu <strong>WhatsApp</strong> ou <strong>WhatsApp Business</strong>
                    </BigStep>
                    <BigStep n={2} done={false}>
                      Toque nos <strong>3 pontos ⋮</strong> (canto superior direito) → <strong>Dispositivos conectados</strong>
                    </BigStep>
                    <BigStep n={3} done={false}>
                      Toque em <strong>Conectar dispositivo</strong> e <strong>aponte a câmera</strong> para o QR Code acima
                    </BigStep>
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

              {/* Menus dinâmicos — abrem ao clicar (fechados por padrão) */}
              <div className="space-y-2">
                {/* 📖 Como Conectar */}
                <details className="group bg-brand-elevated border border-brand-border/60 rounded-xl overflow-hidden">
                  <summary className="flex items-center justify-between gap-2 px-3 py-2.5 cursor-pointer list-none select-none">
                    <span className="text-[13px] font-semibold text-brand-text">📖 Como conectar</span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                         className="text-brand-muted transition-transform group-open:rotate-180">
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </summary>
                  <div className="px-3 pb-3 pt-0.5 space-y-2.5 text-[11px] text-brand-muted leading-relaxed border-t border-brand-border/40">
                    <ol className="space-y-1.5 mt-2 list-decimal list-inside">
                      <li>Abra o <strong className="text-brand-text">WhatsApp</strong> ou <strong className="text-brand-text">WhatsApp Business</strong> no celular.</li>
                      <li>Toque nos <strong className="text-brand-text">3 pontos ⋮</strong> (canto superior direito) → <strong className="text-brand-text">Dispositivos conectados</strong>.</li>
                      <li>Toque em <strong className="text-brand-text">Conectar dispositivo</strong>.</li>
                      <li>Cole o <strong className="text-brand-text">código</strong> (modo recomendado) ou <strong className="text-brand-text">aponte a câmera</strong> para o QR.</li>
                    </ol>
                    <div className="pt-1.5 border-t border-brand-border/30 space-y-1.5">
                      <p><span className="mr-1">📞</span><strong className="text-brand-text">Telefone fixo?</strong> Use o código normalmente. Se não chegar, troque para o QR Code.</p>
                      <p><span className="mr-1">📍</span><strong className="text-brand-text">Avisou "localização suspeita"?</strong> É normal em automação — pode confirmar com tranquilidade.</p>
                      <p><span className="mr-1">📱</span><strong className="text-brand-text">Só tem o celular?</strong> Abra o ZapScript no computador, ou use <strong className="text-brand-text">tela dividida</strong> no Android (browser em cima, WhatsApp embaixo).</p>
                    </div>
                  </div>
                </details>

                {/* 🔒 Explicações do acesso */}
                <details className="group bg-brand-elevated border border-brand-border/60 rounded-xl overflow-hidden">
                  <summary className="flex items-center justify-between gap-2 px-3 py-2.5 cursor-pointer list-none select-none">
                    <span className="text-[13px] font-semibold text-brand-text">🔒 Explicações do acesso</span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                         className="text-brand-muted transition-transform group-open:rotate-180">
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </summary>
                  <div className="px-3 pb-3 pt-0.5 space-y-2.5 text-[11px] text-brand-muted leading-relaxed border-t border-brand-border/40">
                    <p className="mt-2">
                      Você está conectando ao <strong className="text-brand-text">seu próprio WhatsApp</strong> — o mesmo processo do WhatsApp Web.
                      O ZapScript entra como um <strong className="text-brand-text">dispositivo adicional</strong>, não dá acesso a terceiros.
                    </p>
                    <p>
                      <strong className="text-brand-text">Não desconecta nada:</strong> seu WhatsApp Web, o app no celular e o WhatsApp Business
                      continuam funcionando normalmente, ao mesmo tempo.
                    </p>
                    <ul className="space-y-1.5 pt-1.5 border-t border-brand-border/30">
                      <li>✅ Áudio descartado logo após a conversão.</li>
                      <li>✅ Criptografia <strong className="text-brand-text">AES-256</strong> de ponta a ponta no armazenamento.</li>
                      <li>✅ Servidores <strong className="text-brand-text">no Brasil</strong> — conformidade com a LGPD.</li>
                      <li>✅ <strong className="text-brand-text">Nenhum humano</strong> lê seus áudios ou suas conversas.</li>
                    </ul>
                    <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-brand-border/30">
                      <a href="/privacidade" target="_blank" rel="noopener noreferrer"
                         className="text-brand-primary hover:underline font-semibold">
                        Ver política de privacidade →
                      </a>
                      <span className="text-brand-muted">Desconecte quando quiser, em 1 clique.</span>
                    </div>
                  </div>
                </details>
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
  const [addPhone, setAddPhone]             = useState('');
  const [adding, setAdding]                 = useState(false);
  const [error, setError]                   = useState('');
  const [userId, setUserId]                 = useState('');
  const [planName, setPlanName]             = useState('free');
  const [confirmDelete, setConfirmDelete]   = useState<string | null>(null);
  const [deleting, setDeleting]             = useState(false);
  const [connectNumber, setConnectNumber]   = useState<WNumber | null>(null);
  const [liveQr, setLiveQr]                = useState<string | null>(null);
  const [savingPrivate, setSavingPrivate]   = useState<string | null>(null);
  const [hidePrivadoTip, setHidePrivadoTip] = useState(true);

  const isPaid = planName === 'pro' || planName === 'pro-tester' || planName === 'executive';

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
      const plan = u.subscription?.plan?.name || 'free';
      setPlanName(plan);
      const paid = plan === 'pro' || plan === 'pro-tester' || plan === 'executive';
      // Dica de primeira vez do Modo Privado: só para pago, uma vez.
      if (paid && typeof window !== 'undefined' && !localStorage.getItem('zs_privado_tip_v1')) {
        setHidePrivadoTip(false);
      }
    });
  }, [loadNumbers]);

  function dismissPrivadoTip() {
    setHidePrivadoTip(true);
    try { localStorage.setItem('zs_privado_tip_v1', '1'); } catch {}
  }

  const { connected: socketOk } = useSocket(userId, {
    audio_received: () => { loadNumbers(); },
    'qr:updated':   (d: { numberId: string; qr: string }) => {
      if (connectNumber?.id === d.numberId) setLiveQr(d.qr);
    },
    'number:connected': () => { loadNumbers(); },
  });

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true); setError('');
    try {
      const cleanPhone = addPhone.replace(/\D/g, '');
      await api.post('/numbers', {
        ...(cleanPhone ? { phoneNumber: cleanPhone } : {}),
      });
      setAddPhone('');
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

  async function handlePrivateMode(id: string, next: boolean) {
    setSavingPrivate(id); setError('');
    // Otimista: reflete na hora, reverte se falhar.
    setNumbers(ns => ns.map(x => x.id === id ? { ...x, privateMode: next } : x));
    try {
      await api.patch(`/numbers/${id}`, { privateMode: next });
    } catch (err: any) {
      setNumbers(ns => ns.map(x => x.id === id ? { ...x, privateMode: !next } : x));
      setError(err.message || 'Não foi possível salvar o Modo Privado.');
    } finally { setSavingPrivate(null); }
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

      {/* ── Dica de primeira vez: Modo Privado automático (só pago) ── */}
      {isPaid && !hidePrivadoTip && (
        <div className="mb-5 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 flex items-start gap-3">
          <span className="text-lg leading-none mt-0.5">🔒</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-brand-text">Modo Privado já está ligado</p>
            <p className="text-xs text-brand-text-secondary mt-1 leading-relaxed">
              Como você é assinante, cada resumo chega <strong>só no seu número</strong> — nunca na conversa de quem mandou o áudio.
              Prefere que apareça na própria conversa? É só desligar o Modo Privado no cartão do número.
            </p>
          </div>
          <button onClick={dismissPrivadoTip} aria-label="Entendi"
            className="text-brand-muted hover:text-brand-text transition-colors text-lg leading-none flex-shrink-0">×</button>
        </div>
      )}

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
              'Informe o número do WhatsApp (ou deixe em branco para conectar via QR)',
              'Clique em "+ Adicionar" — o nome é gerado automaticamente',
              'Clique em "Conectar WhatsApp" e siga as instruções',
              'Pronto! Áudios recebidos serão convertidos automaticamente',
            ].map((t, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-brand-text-secondary">
                <span className="w-4 h-4 rounded-full bg-brand-primary/20 text-brand-primary flex-shrink-0 flex items-center justify-center text-[10px] font-bold mt-0.5">{i+1}</span>
                {t}
              </div>
            ))}
          </div>
        </details>

        <form onSubmit={handleAdd} className="space-y-2">
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
                  <div className="text-[10px] text-brand-muted mt-0.5">áudios</div>
                </div>
                <div className="bg-brand-elevated rounded-lg p-2.5">
                  <div className="text-base font-black text-brand-primary leading-none">{n.minutesUsed.toFixed(1)}</div>
                  <div className="text-[10px] text-brand-muted mt-0.5">min usados</div>
                </div>
              </div>

              {/* Modo Privado — opt-in (apenas planos pagos) */}
              {isPaid ? (
                <div className="bg-brand-elevated rounded-xl px-3 py-2.5 mb-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-brand-text flex items-center gap-1.5">
                        🔒 Modo Privado
                        {n.privateMode === true && (
                          <span className="text-[9px] font-bold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded-full">ativado</span>
                        )}
                      </div>
                      <div className="text-[10px] text-brand-muted mt-0.5">
                        {n.privateMode === true
                          ? <>Resumo enviado só para o seu número{n.phoneNumber && n.phoneNumber !== 'pending' ? <> (<span className="text-brand-text font-medium">{n.phoneNumber}</span>)</> : null} — nunca na conversa do contato.</>
                          : <>Resumo entregue na própria conversa do contato. Ative para receber só no seu número.</>}
                      </div>
                    </div>
                    {/* Toggle opt-in */}
                    <button
                      role="switch"
                      aria-checked={n.privateMode === true}
                      aria-label="Alternar Modo Privado"
                      disabled={savingPrivate === n.id}
                      onClick={() => handlePrivateMode(n.id, !(n.privateMode === true))}
                      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${n.privateMode === true ? 'bg-amber-400' : 'bg-brand-border'}`}>
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${n.privateMode === true ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </div>
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

      {/* Conexão via API oficial da Meta (gated por env — só p/ App Review) */}
      <MetaEmbeddedSignup />

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
