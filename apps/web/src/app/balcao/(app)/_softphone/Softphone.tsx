'use client';
/**
 * Softphone WebRTC do atendente (SIP.js sobre WSS → Asterisk/PJSIP).
 * Fluxo (ver apps/api/src/balcao/channels/voice): o Asterisk (ARI) origina uma perna SIP para o ramal do atendente;
 * este componente atende o INVITE. Discagem ("click-to-call"): POST /voice/calls/dial faz o servidor tocar o ramal
 * primeiro — o INVITE que chega em seguida é atendido automaticamente e o servidor disca o número pelo tronco.
 * Eventos de socket usados: call:ringing | call:active | call:ended | call:transfer_failed (payload com callId).
 * Acessibilidade: chamada recebida anunciada em região aria-live "assertive"; atalhos Alt+Shift+A (atender),
 * Alt+Shift+R (recusar/encerrar), Alt+Shift+T (abrir/focar o telefone); tudo operável por teclado.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Invitation, Inviter, Registerer, Session, UserAgent, Web } from 'sip.js';
import { bv, errMsg } from '@/lib/balcao/api';
import { useBvSession } from '@/lib/balcao/session';
import { useBvSocket } from '@/lib/balcao/socket';
import { Badge, Banner, Button, Checkbox, TextField, cx, useToast } from '../../_ui/ui';

interface SoftphoneCreds { wssUrl: string; sipUri: string; domain: string; ramal: string; senha: string; iceServers: RTCIceServer[]; displayName: string }
type Conn = 'loading' | 'connecting' | 'registered' | 'error' | 'offline' | 'unavailable';
type Phase = 'idle' | 'incoming' | 'dialing' | 'active';
interface CallInfo { callId?: string; conversationId?: string; protocol?: string | null; number: string; name?: string | null; direction: 'IN' | 'OUT'; uraSummary?: string[]; transferredTo?: string }
interface RingPayload { callId: string; conversationId?: string; direction?: 'IN' | 'OUT'; from?: string; to?: string; agentUserId?: string }

const NUMBER_RE = /^\+?[0-9*#]{2,20}$/;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
const LS_RING = 'bv_softphone_ring';
const LS_OPEN = 'bv_softphone_open';

const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage indisponível */ } };

const clock = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
/** Número falado em dígitos separados para leitores de tela. */
const spoken = (n: string) => n.replace(/[^\d*#+]/g, '').split('').join(' ');
const pretty = (n: string) => (/^\d{12,13}$/.test(n) ? n.replace(/^(\d{2})(\d{2})(\d{4,5})(\d{4})$/, '+$1 ($2) $3-$4') : n);

/** Resumo legível da trilha da URA gravada em BvCall.ivrPath. */
function uraSummary(trail: any): string[] {
  if (!Array.isArray(trail)) return [];
  const out: string[] = [];
  for (const t of trail) {
    if (t?.event === 'choice' && t.input) out.push(`opção ${t.input} (${t.node})`);
    else if (t?.event === 'language' && t.result) out.push(`idioma ${t.result}`);
    else if (t?.event === 'queue') out.push(`fila/assunto: ${t.result || t.node}`);
    else if (t?.event === 'collected' && t.node && !t.sensitive && t.value) out.push(`${t.node}: ${t.value}`);
  }
  return out;
}

export default function Softphone() {
  const { me, token, can } = useBvSession();
  const toast = useToast();
  const userId = me?.user.id ?? null;
  const visible = !!me?.user.sipExtension && can('conversation:reply');

  const [open, setOpen] = useState(false);
  const [conn, setConn] = useState<Conn>('loading');
  const [connMsg, setConnMsg] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhaseState] = useState<Phase>('idle');
  const [call, setCallState] = useState<CallInfo | null>(null);
  const [muted, setMuted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [showKeys, setShowKeys] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferTo, setTransferTo] = useState('');
  const [transferBusy, setTransferBusy] = useState(false);
  const [dialNumber, setDialNumber] = useState('');
  const [dialErr, setDialErr] = useState<string | null>(null);
  const [dialBusy, setDialBusy] = useState(false);
  const [ringOn, setRingOn] = useState(true);
  const [mic, setMic] = useState<'unknown' | 'granted' | 'denied' | 'prompt'>('unknown');
  const [micMsg, setMicMsg] = useState<string | null>(null);
  const [assertive, setAssertive] = useState('');
  const [polite, setPolite] = useState('');

  // refs (valores lidos dentro de callbacks do SIP.js, que não podem ficar com estado velho)
  const phaseRef = useRef<Phase>('idle');
  const callRef = useRef<CallInfo | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const invRef = useRef<Invitation | null>(null);
  const uaRef = useRef<UserAgent | null>(null);
  const pendingDialRef = useRef<{ callId: string; number: string; ts: number } | null>(null); // callId vazio até o POST /dial responder (o INVITE pode chegar antes)
  const lastRingRef = useRef<(RingPayload & { ts: number }) | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const prevPresenceRef = useRef<string | null>(null);
  const ringOnRef = useRef(true);
  const ringCtxRef = useRef<AudioContext | null>(null);
  const ringTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clockRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const answeredAtRef = useRef(0);
  const titleRef = useRef('');
  const answerBtnRef = useRef<HTMLButtonElement>(null);
  const dockRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const sipRef = useRef<typeof import('sip.js') | null>(null);
  const isUp = (x: Session | null | undefined) => !!x && !!sipRef.current && x.state === sipRef.current.SessionState.Established;

  const setPhase = useCallback((p: Phase) => { phaseRef.current = p; setPhaseState(p); }, []);
  const setCall = useCallback((c: CallInfo | null) => { callRef.current = c; setCallState(c); }, []);
  const patchCall = useCallback((p: Partial<CallInfo>) => { if (callRef.current) setCall({ ...callRef.current, ...p }); }, [setCall]);

  useEffect(() => {
    const r = lsGet(LS_RING) !== '0'; setRingOn(r); ringOnRef.current = r;
    setOpen(lsGet(LS_OPEN) === '1');
  }, []);

  // ── toque (WebAudio, gerado; sem arquivo) ─────────────────────────────────────────────────────────
  const stopRing = useCallback(() => {
    if (ringTimerRef.current) { clearInterval(ringTimerRef.current); ringTimerRef.current = null; }
    try { void ringCtxRef.current?.close(); } catch { /* já fechado */ }
    ringCtxRef.current = null;
  }, []);
  const startRing = useCallback(() => {
    if (!ringOnRef.current || ringTimerRef.current) return;
    try {
      const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
      const ctx: AudioContext = new Ctx();
      ringCtxRef.current = ctx;
      void ctx.resume?.();
      const burst = () => {
        const t0 = ctx.currentTime;
        [0, 0.55].forEach((off) => [440, 480].forEach((f) => {
          const o = ctx.createOscillator(); const g = ctx.createGain();
          o.frequency.value = f; g.gain.setValueAtTime(0.0001, t0 + off);
          g.gain.linearRampToValueAtTime(0.12, t0 + off + 0.03); g.gain.setValueAtTime(0.12, t0 + off + 0.4); g.gain.linearRampToValueAtTime(0.0001, t0 + off + 0.45);
          o.connect(g).connect(ctx.destination); o.start(t0 + off); o.stop(t0 + off + 0.5);
        }));
      };
      burst();
      ringTimerRef.current = setInterval(burst, 3000);
    } catch { /* navegador sem WebAudio ou bloqueado: o aviso visual/leitor de tela continua */ }
  }, []);

  // ── microfone ─────────────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let st: PermissionStatus | null = null;
    (async () => {
      try {
        st = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        const sync = () => st && setMic(st.state as 'granted' | 'denied' | 'prompt');
        sync(); st.onchange = sync;
      } catch { /* Permissions API indisponível (Safari/Firefox antigos) */ }
    })();
    return () => { if (st) st.onchange = null; };
  }, []);

  const ensureMic = useCallback(async (): Promise<boolean> => {
    if (!navigator.mediaDevices?.getUserMedia) { setMic('denied'); setMicMsg('Este navegador não permite usar o microfone. É necessário acessar o sistema por HTTPS em um navegador atual.'); return false; }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      setMic('granted'); setMicMsg(null); return true;
    } catch (e) {
      const n = (e as DOMException)?.name;
      setMic('denied');
      setMicMsg(n === 'NotFoundError' ? 'Nenhum microfone foi encontrado. Conecte um fone com microfone e tente novamente.'
        : n === 'NotReadableError' ? 'O microfone está em uso por outro programa. Feche-o e tente novamente.'
        : 'A permissão do microfone foi negada. Libere o microfone nas configurações do navegador (ícone de cadeado ao lado do endereço) e tente novamente.');
      return false;
    }
  }, []);

  // ── presença: ocupado durante a chamada ──────────────────────────────────────────────────────────
  const markBusy = useCallback(async () => {
    try {
      const cur = await bv.get<any>('/agents/me').catch(() => null);
      const p = cur?.presence ?? cur?.user?.presence ?? me?.user.presence ?? 'ONLINE';
      prevPresenceRef.current = p === 'BUSY' ? 'ONLINE' : p;
      await bv.put('/agents/me/presence', { presence: 'BUSY' });
      window.dispatchEvent(new CustomEvent('bv:presence', { detail: 'BUSY' }));
    } catch { /* presença é conveniência; a chamada segue */ }
  }, [me?.user.presence]);
  const restorePresence = useCallback(async () => {
    const prev = prevPresenceRef.current; prevPresenceRef.current = null;
    if (!prev) return;
    try { await bv.put('/agents/me/presence', { presence: prev }); window.dispatchEvent(new CustomEvent('bv:presence', { detail: prev })); } catch { /* idem */ }
  }, []);

  // ── fim de chamada ───────────────────────────────────────────────────────────────────────────────
  const finishCall = useCallback((message?: string) => {
    stopRing();
    if (clockRef.current) { clearInterval(clockRef.current); clockRef.current = null; }
    sessionRef.current = null; invRef.current = null;
    if (audioRef.current) audioRef.current.srcObject = null;
    const wasActive = answeredAtRef.current > 0;
    answeredAtRef.current = 0;
    setPhase('idle'); setCall(null); setMuted(false); setShowKeys(false); setShowTransfer(false); setTransferTo(''); setElapsed(0);
    if (titleRef.current) { document.title = titleRef.current; titleRef.current = ''; }
    if (message) setPolite(message);
    if (wasActive) void restorePresence();
  }, [restorePresence, setCall, setPhase, stopRing]);

  const attachRemoteAudio = useCallback((s: Session) => {
    const sdh = s.sessionDescriptionHandler as Web.SessionDescriptionHandler | undefined;
    const pc = sdh?.peerConnection;
    if (!pc || !audioRef.current) return;
    const stream = new MediaStream();
    pc.getReceivers().forEach((r) => { if (r.track?.kind === 'audio') stream.addTrack(r.track); });
    audioRef.current.srcObject = stream;
    void audioRef.current.play().catch(() => setPolite('O navegador bloqueou o áudio da chamada. Use qualquer botão do telefone para liberar o som.'));
  }, []);

  /** Liga os listeners de estado de uma sessão (Invitation recebida ou Inviter). */
  const watchSession = useCallback((s: Session, sip: typeof import('sip.js')) => {
    s.stateChange.addListener((state) => {
      if (sessionRef.current !== s && invRef.current !== s) return;
      if (state === sip.SessionState.Established) {
        sessionRef.current = s;
        attachRemoteAudio(s);
        answeredAtRef.current = Date.now();
        setPhase('active'); setOpen(true); stopRing();
        setElapsed(0);
        if (clockRef.current) clearInterval(clockRef.current);
        clockRef.current = setInterval(() => setElapsed(Math.round((Date.now() - answeredAtRef.current) / 1000)), 1000);
        setPolite('Chamada conectada.');
        void markBusy();
      } else if (state === sip.SessionState.Terminated) {
        const was = phaseRef.current;
        finishCall(was === 'incoming' ? 'A chamada foi cancelada pelo originador antes de ser atendida.' : was === 'dialing' ? 'A ligação não foi completada.' : 'Chamada encerrada.');
      }
    });
  }, [attachRemoteAudio, finishCall, markBusy, setPhase, stopRing]);

  // ── enriquecer a chamada com dados do servidor ──────────────────────────────────────────────────
  const enrich = useCallback(async (callId: string) => {
    try {
      const d = await bv.get<any>(`/voice/calls/${callId}`);
      if (callRef.current?.callId !== callId) return;
      patchCall({ protocol: d.protocol ?? null, conversationId: d.conversationId ?? callRef.current?.conversationId, uraSummary: uraSummary(d.ivrPath) });
    } catch { /* sem permissão/rede: segue só com o essencial */ }
  }, [patchCall]);

  // ── aceitar / recusar ───────────────────────────────────────────────────────────────────────────
  const acceptInvitation = useCallback(async (inv: Invitation, info: CallInfo) => {
    if (!(await ensureMic())) {
      if (info.direction === 'OUT' && info.callId) void bv.post(`/voice/calls/${info.callId}/hangup`).catch(() => undefined);
      return false;
    }
    stopRing();
    sessionRef.current = inv; invRef.current = inv;
    try {
      await inv.accept({ sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } } });
      return true;
    } catch (e) {
      sessionRef.current = null;
      toast.error(`Não foi possível atender: ${errMsg(e, 'falha na negociação de áudio.')}`);
      return false;
    }
  }, [ensureMic, stopRing, toast]);

  const answer = useCallback(async () => {
    const inv = invRef.current; const info = callRef.current;
    if (!inv || !info || phaseRef.current !== 'incoming') return;
    await acceptInvitation(inv, info);
  }, [acceptInvitation]);

  const decline = useCallback(async () => {
    const inv = invRef.current;
    stopRing();
    if (inv) { try { await inv.reject({ statusCode: 603 }); } catch { /* já encerrada */ } }
    finishCall('Chamada recusada.');
  }, [finishCall, stopRing]);

  const hangup = useCallback(async () => {
    const s = sessionRef.current; const info = callRef.current;
    try {
      if (isUp(s)) await s!.bye();
      else if (invRef.current) await invRef.current.reject({ statusCode: 603 });
      else if (info?.callId && phaseRef.current === 'dialing') await bv.post(`/voice/calls/${info.callId}/hangup`);
    } catch { /* já encerrada */ }
    finishCall('Chamada encerrada.');
  }, [finishCall]);

  // ── INVITE recebido ─────────────────────────────────────────────────────────────────────────────
  const onInvite = useCallback((inv: Invitation, sip: typeof import('sip.js')) => {
    if (phaseRef.current === 'active' || (phaseRef.current === 'incoming')) { void inv.reject({ statusCode: 486 }); return; }
    const number = inv.remoteIdentity.uri.user ?? 'desconhecido';
    const name = inv.remoteIdentity.displayName || null;
    invRef.current = inv;
    watchSession(inv, sip);
    const pd = pendingDialRef.current;
    if (pd && Date.now() - pd.ts < 30_000) { // discagem que eu mesmo pedi: atende sozinho
      pendingDialRef.current = null;
      const info: CallInfo = { callId: pd.callId || undefined, number: pd.number, direction: 'OUT' };
      setCall(info);
      void acceptInvitation(inv, info).then((ok) => { if (!ok) finishCall('Não foi possível iniciar a ligação.'); });
      return;
    }
    const lr = lastRingRef.current;
    const match = lr && Date.now() - lr.ts < 20_000 && lr.direction !== 'OUT' ? lr : null;
    const info: CallInfo = { number: match?.from ?? number, name, direction: 'IN', callId: match?.callId, conversationId: match?.conversationId };
    setCall(info); setPhase('incoming'); setOpen(true);
    if (match?.callId) void enrich(match.callId);
    startRing();
    titleRef.current = titleRef.current || document.title;
    document.title = '(Chamada recebida) ' + titleRef.current;
    setAssertive(`Chamada recebida de ${spoken(info.number) || 'número desconhecido'}. Para atender, pressione Alt, Shift e A. Para recusar, Alt, Shift e R. Também é possível usar os botões do painel do telefone.`);
    // leva o foco ao botão Atender, exceto se a pessoa estiver digitando
    setTimeout(() => {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if (!typing) answerBtnRef.current?.focus();
    }, 60);
  }, [acceptInvitation, enrich, finishCall, setCall, setPhase, startRing, watchSession]);

  // ── registro SIP ────────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!visible) return;
    let disposed = false;
    let ua: UserAgent | null = null;
    let registerer: Registerer | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    let onlineFn: (() => void) | null = null;

    const reconnect = (immediate = false) => {
      if (disposed || timer) return;
      const delay = immediate ? 300 : Math.min(30_000, 1000 * 2 ** tries++);
      setAttempt(tries);
      timer = setTimeout(async () => {
        timer = undefined;
        if (disposed || !ua || !registerer) return;
        try { await ua.reconnect(); await registerer.register(); } catch { reconnect(); }
      }, delay);
    };

    (async () => {
      setConn('loading');
      let creds: SoftphoneCreds;
      try { creds = await bv.get<SoftphoneCreds>('/voice/softphone'); }
      catch (e) { if (!disposed) { setConn('unavailable'); setConnMsg(errMsg(e, 'Não foi possível obter as credenciais do telefone.')); } return; }
      if (disposed) return;
      const sip = await import('sip.js');
      if (disposed) return;
      sipRef.current = sip;
      const uri = sip.UserAgent.makeURI(creds.sipUri);
      if (!uri) { setConn('error'); setConnMsg('Endereço SIP inválido recebido do servidor.'); return; }
      setConn('connecting');
      ua = new sip.UserAgent({
        uri, authorizationUsername: creds.ramal, authorizationPassword: creds.senha, displayName: creds.displayName,
        transportOptions: { server: creds.wssUrl, connectionTimeout: 10, keepAliveInterval: 25 },
        sessionDescriptionHandlerFactoryOptions: { iceGatheringTimeout: 2000, peerConnectionConfiguration: { iceServers: creds.iceServers } },
        logLevel: 'error',
        delegate: {
          onInvite: (inv) => onInvite(inv, sip),
          onDisconnect: () => { if (disposed) return; setConn('offline'); reconnect(); },
          onConnect: () => { tries = 0; setAttempt(0); },
        },
      });
      uaRef.current = ua;
      registerer = new sip.Registerer(ua, { expires: 300 });
      registerer.stateChange.addListener((s) => {
        if (disposed) return;
        if (s === sip.RegistererState.Registered) { setConn('registered'); setConnMsg(''); tries = 0; setAttempt(0); }
        else if (s === sip.RegistererState.Unregistered) setConn((c) => (c === 'offline' || c === 'error' ? c : 'connecting'));
      });
      try {
        await ua.start();
        if (disposed) return;
        await registerer.register({
          requestDelegate: {
            onReject: (resp) => { if (!disposed) { setConn('error'); setConnMsg(`O servidor recusou o registro do ramal (código ${resp.message.statusCode}). Avise o administrador.`); } },
          },
        });
      } catch (e) {
        if (disposed) return;
        setConn('offline'); setConnMsg(errMsg(e, 'Não foi possível conectar ao servidor de voz.'));
        reconnect();
      }
      onlineFn = () => reconnect(true);
      window.addEventListener('online', onlineFn);
    })();

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      if (onlineFn) window.removeEventListener('online', onlineFn);
      stopRing();
      if (clockRef.current) { clearInterval(clockRef.current); clockRef.current = null; }
      try { if (isUp(sessionRef.current)) void sessionRef.current!.bye(); } catch { /* ignore */ }
      sessionRef.current = null; invRef.current = null;
      try { void registerer?.unregister().catch(() => undefined); } catch { /* ignore */ }
      try { void ua?.stop().catch(() => undefined); } catch { /* ignore */ }
      uaRef.current = null;
      if (audioRef.current) audioRef.current.srcObject = null;
      if (titleRef.current) { document.title = titleRef.current; titleRef.current = ''; }
      if (answeredAtRef.current > 0) { answeredAtRef.current = 0; void restorePresence(); }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // ── eventos de socket ───────────────────────────────────────────────────────────────────────────
  useBvSocket(visible ? token : null, {
    'call:ringing': (p: RingPayload) => {
      if (!p || (p.agentUserId && p.agentUserId !== userId)) return; // supervisores recebem eventos de todos
      lastRingRef.current = { ...p, ts: Date.now() };
      const cur = callRef.current;
      if (cur && !cur.callId && ((phaseRef.current === 'incoming' && p.direction !== 'OUT') || (cur.direction === 'OUT' && p.direction === 'OUT'))) {
        patchCall({ callId: p.callId, conversationId: p.conversationId }); void enrich(p.callId);
      }
    },
    'call:active': (p: any) => {
      if (!p || p.callId !== callRef.current?.callId) return;
      if (p.transferred && p.to) { patchCall({ transferredTo: String(p.to) }); setPolite(`Transferência concluída para ${spoken(String(p.to))}.`); }
      if (p.conversationId && !callRef.current?.conversationId) patchCall({ conversationId: p.conversationId });
    },
    'call:transfer_failed': (p: any) => {
      if (!p || p.callId !== callRef.current?.callId) return;
      toast.error('A transferência não foi concluída (o destino não atendeu). A chamada continua com você.');
    },
    'call:ended': (p: any) => {
      if (!p || p.callId !== callRef.current?.callId) return;
      const s = sessionRef.current; const inv = invRef.current;
      try { if (isUp(s)) void s!.bye(); else if (inv && phaseRef.current === 'incoming') void inv.reject({ statusCode: 487 }); } catch { /* ignore */ }
      finishCall(`Chamada encerrada${p.durationSec != null ? ` após ${clock(p.durationSec)}` : ''}.`);
    },
  });

  // ── atalhos de teclado ──────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.altKey && e.shiftKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'a' && phaseRef.current === 'incoming') { e.preventDefault(); void answer(); }
      else if (k === 'r' && (phaseRef.current === 'incoming' || phaseRef.current === 'active' || phaseRef.current === 'dialing')) { e.preventDefault(); void (phaseRef.current === 'incoming' ? decline() : hangup()); }
      else if (k === 't') { e.preventDefault(); setOpen(true); setTimeout(() => (answerBtnRef.current ?? dockRef.current?.querySelector<HTMLElement>('input,button:not([aria-expanded])'))?.focus(), 50); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, answer, decline, hangup]);

  // ── ações ───────────────────────────────────────────────────────────────────────────────────────
  const toggleOpen = () => { const n = !open; setOpen(n); lsSet(LS_OPEN, n ? '1' : '0'); };

  const startDial = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = dialNumber.replace(/[\s().-]/g, '');
    if (!NUMBER_RE.test(n)) { setDialErr('Digite um número válido, apenas dígitos (com DDD), podendo iniciar com +.'); return; }
    if (conn !== 'registered') { setDialErr('O telefone ainda não está registrado. Aguarde a conexão.'); return; }
    setDialErr(null); setDialBusy(true);
    const mark = { callId: '', number: n, ts: Date.now() };
    try {
      if (!(await ensureMic())) return;
      pendingDialRef.current = mark; // o INVITE do servidor pode chegar antes da resposta HTTP
      setCall({ number: n, direction: 'OUT' }); setPhase('dialing');
      const r = await bv.post<{ callId: string; conversationId: string }>('/voice/calls/dial', { number: n });
      if (pendingDialRef.current === mark) mark.callId = r.callId;
      if (callRef.current?.direction === 'OUT' && !callRef.current.callId) patchCall({ callId: r.callId, conversationId: r.conversationId });
      setPolite(`Ligando para ${spoken(n)}. O sistema toca primeiro o seu ramal e atende automaticamente.`);
      setTimeout(() => { // se o INVITE não vier, desfaz
        if (pendingDialRef.current === mark) { pendingDialRef.current = null; if (phaseRef.current === 'dialing') finishCall('A ligação não foi completada: o ramal não recebeu a chamada.'); }
      }, 30_000);
    } catch (err) {
      if (pendingDialRef.current === mark) pendingDialRef.current = null;
      if (phaseRef.current === 'dialing') { setPhase('idle'); setCall(null); }
      setDialErr(errMsg(err, 'Não foi possível iniciar a ligação.'));
    }
    finally { setDialBusy(false); }
  };

  const toggleMute = () => {
    const s = sessionRef.current;
    const pc = (s?.sessionDescriptionHandler as Web.SessionDescriptionHandler | undefined)?.peerConnection;
    if (!pc) return;
    const next = !muted;
    pc.getSenders().forEach((snd) => { if (snd.track?.kind === 'audio') snd.track.enabled = !next; });
    setMuted(next); setPolite(next ? 'Microfone silenciado.' : 'Microfone ativado.');
  };

  const sendDtmf = (tone: string) => {
    const s = sessionRef.current;
    const sdh = s?.sessionDescriptionHandler as Web.SessionDescriptionHandler | undefined;
    try { if (!sdh?.sendDtmf(tone, { duration: 120, interToneGap: 70 })) toast.error('Não foi possível enviar o tom.'); } catch { toast.error('Não foi possível enviar o tom.'); }
  };

  const doTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    const info = callRef.current; if (!info?.callId) return;
    const n = transferTo.replace(/[\s().-]/g, '');
    if (!NUMBER_RE.test(n)) { toast.error('Digite um número ou ramal válido para transferir.'); return; }
    setTransferBusy(true);
    try { await bv.post(`/voice/calls/${info.callId}/transfer`, { number: n }); setPolite(`Transferência solicitada para ${spoken(n)}.`); toast.success('Transferência solicitada.'); setShowTransfer(false); setTransferTo(''); }
    catch (err) { toast.error(errMsg(err, 'Não foi possível transferir.')); }
    finally { setTransferBusy(false); }
  };

  if (!visible) return null;

  const connLabel: Record<Conn, string> = {
    loading: 'Carregando configuração do telefone…',
    connecting: 'Conectando e registrando o ramal…',
    registered: `Pronto para chamadas (ramal ${me?.user.sipExtension})`,
    error: 'Erro no registro do telefone',
    offline: attempt > 0 ? `Sem conexão com o servidor de voz. Reconectando (tentativa ${attempt})…` : 'Sem conexão com o servidor de voz. Reconectando…',
    unavailable: 'Telefone indisponível',
  };
  const connTone = conn === 'registered' ? 'success' : conn === 'error' || conn === 'unavailable' ? 'danger' : 'warning';
  const connShort = conn === 'registered' ? 'Registrado' : conn === 'error' ? 'Erro' : conn === 'unavailable' ? 'Indisponível' : conn === 'offline' ? 'Offline' : 'Conectando';
  const headline = phase === 'incoming' ? `Chamada recebida de ${pretty(call?.number ?? '')}` : phase === 'dialing' ? `Ligando para ${pretty(call?.number ?? '')}` : phase === 'active' ? `Em chamada com ${pretty(call?.number ?? '')} · ${clock(elapsed)}` : 'Telefone';

  return (
    <section ref={dockRef} aria-label="Telefone do atendente" id="bv-softphone"
      className={cx('fixed bottom-4 right-4 z-40 w-[22rem] max-w-[calc(100vw-2rem)] rounded-lg border bg-bv-surface shadow-xl', phase === 'incoming' ? 'border-bv-danger border-2' : 'border-bv-border')}>
      <audio ref={audioRef} autoPlay />
      {/* Regiões ao vivo: sempre no DOM para que as mudanças sejam anunciadas */}
      <div role="alert" aria-live="assertive" aria-atomic="true" className="bv-sr-only">{assertive}</div>
      <div role="status" aria-live="polite" aria-atomic="true" className="bv-sr-only">{polite}</div>

      <button ref={toggleRef} type="button" aria-expanded={open} aria-controls="bv-softphone-body" onClick={toggleOpen}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-t-lg px-3 py-2 text-left text-sm font-semibold hover:bg-bv-subtle">
        <span className="truncate">{headline}</span>
        <span className="flex shrink-0 items-center gap-2">
          <Badge tone={phase === 'incoming' ? 'danger' : connTone}>{phase === 'incoming' ? 'Tocando' : phase === 'active' ? 'Em chamada' : phase === 'dialing' ? 'Chamando' : connShort}</Badge>
          <span aria-hidden="true">{open ? '▾' : '▴'}</span>
          <span className="bv-sr-only">{open ? 'Recolher telefone' : 'Expandir telefone'}</span>
        </span>
      </button>

      <div id="bv-softphone-body" hidden={!open} className="flex flex-col gap-3 border-t border-bv-border p-3">
        <p className="text-sm" data-testid="softphone-status">{connLabel[conn]}</p>
        {(conn === 'error' || conn === 'unavailable' || (conn === 'offline' && connMsg)) && connMsg && <Banner tone={conn === 'offline' ? 'warning' : 'danger'}>{connMsg}</Banner>}
        {micMsg && <Banner tone="danger" title="Microfone indisponível">{micMsg}</Banner>}

        {phase === 'incoming' && call && (
          <div className="flex flex-col gap-2 rounded-md bg-bv-danger-soft p-3">
            <p className="text-lg font-semibold">{pretty(call.number)}{call.name && call.name !== call.number ? ` (${call.name})` : ''}</p>
            {call.protocol && <p className="text-sm">Protocolo: <strong>{call.protocol}</strong></p>}
            {call.uraSummary && call.uraSummary.length > 0 && <p className="text-sm">Escolhas na URA: {call.uraSummary.join(' → ')}</p>}
            <div className="mt-1 flex gap-2">
              <Button ref={answerBtnRef} variant="primary" className="flex-1" onClick={() => void answer()} aria-keyshortcuts="Alt+Shift+A">Atender</Button>
              <Button variant="danger" className="flex-1" onClick={() => void decline()} aria-keyshortcuts="Alt+Shift+R">Recusar</Button>
            </div>
            <p className="text-xs">Atalhos: Alt+Shift+A atende, Alt+Shift+R recusa.</p>
          </div>
        )}

        {phase === 'dialing' && call && (
          <div className="flex flex-col gap-2 rounded-md bg-bv-subtle p-3">
            <p className="text-sm">Chamando <strong>{pretty(call.number)}</strong>… O sistema toca primeiro o seu ramal; ele atende sozinho e então disca o número.</p>
            <Button variant="danger" onClick={() => void hangup()}>Cancelar ligação</Button>
          </div>
        )}

        {phase === 'active' && call && (
          <div className="flex flex-col gap-3">
            <div className="rounded-md bg-bv-success-soft p-3">
              <p className="text-base font-semibold">{pretty(call.number)}{call.name && call.name !== call.number ? ` (${call.name})` : ''}</p>
              <p className="text-sm">Duração: <span role="timer" aria-live="off">{clock(elapsed)}</span></p>
              {call.protocol && <p className="text-sm">Protocolo: <strong>{call.protocol}</strong></p>}
              {call.uraSummary && call.uraSummary.length > 0 && <p className="text-sm">Escolhas na URA: {call.uraSummary.join(' → ')}</p>}
              {call.transferredTo && <p className="text-sm">Transferida para {pretty(call.transferredTo)}.</p>}
              {call.conversationId && <p className="mt-1 text-sm"><a className="underline" href={`/balcao/atendimento/${encodeURIComponent(call.conversationId)}`}>Abrir o atendimento desta chamada</a></p>}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" aria-pressed={muted} onClick={toggleMute}>{muted ? 'Ativar microfone' : 'Silenciar'}</Button>
              <Button variant="secondary" aria-pressed={showKeys} aria-expanded={showKeys} aria-controls="bv-sp-keys" onClick={() => setShowKeys((v) => !v)}>Teclado</Button>
              {can('conversation:transfer') && <Button variant="secondary" aria-expanded={showTransfer} aria-controls="bv-sp-transfer" disabled={!call.callId} onClick={() => setShowTransfer((v) => !v)}>Transferir</Button>}
              <Button variant="danger" onClick={() => void hangup()} aria-keyshortcuts="Alt+Shift+R">Encerrar</Button>
            </div>
            {muted && <p className="text-sm font-medium text-bv-warning">Você está com o microfone silenciado.</p>}
            {showKeys && (
              <div id="bv-sp-keys" role="group" aria-label="Teclado numérico (tons DTMF)" className="grid grid-cols-3 gap-2">
                {KEYS.map((k) => <Button key={k} variant="secondary" aria-label={k === '*' ? 'Tecla asterisco' : k === '#' ? 'Tecla jogo da velha' : `Tecla ${k}`} onClick={() => sendDtmf(k)}>{k}</Button>)}
              </div>
            )}
            {showTransfer && can('conversation:transfer') && (
              <form id="bv-sp-transfer" onSubmit={doTransfer} className="flex flex-col gap-2 rounded-md border border-bv-border p-2">
                <TextField label="Transferir para (número ou ramal)" inputMode="tel" value={transferTo} onChange={(e) => setTransferTo(e.target.value)} placeholder="Ex.: 6002 ou 6332123456" hint="O destino toca; se não atender, a chamada continua com você." />
                <Button type="submit" loading={transferBusy} disabled={!transferTo.trim()}>Transferir chamada</Button>
              </form>
            )}
          </div>
        )}

        {phase === 'idle' && (
          <form onSubmit={startDial} className="flex flex-col gap-2">
            <TextField label="Ligar para" inputMode="tel" value={dialNumber} onChange={(e) => { setDialNumber(e.target.value); setDialErr(null); }}
              placeholder="DDD + número" error={dialErr} hint="Disca pelo tronco da central; a chamada é gravada e registrada em atendimento." autoComplete="off" />
            <Button type="submit" loading={dialBusy} disabled={conn !== 'registered' || !dialNumber.trim()}>Ligar</Button>
          </form>
        )}

        <div className="flex flex-col gap-2 border-t border-bv-border pt-2">
          <Checkbox label="Tocar sinal sonoro em chamadas recebidas" checked={ringOn}
            onChange={(e) => { setRingOn(e.target.checked); ringOnRef.current = e.target.checked; lsSet(LS_RING, e.target.checked ? '1' : '0'); if (!e.target.checked) stopRing(); }} />
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>Microfone: {mic === 'granted' ? 'liberado' : mic === 'denied' ? 'bloqueado' : mic === 'prompt' ? 'aguardando permissão' : 'não verificado'}</span>
            {mic !== 'granted' && <Button size="sm" variant="secondary" onClick={() => void ensureMic()}>Testar microfone</Button>}
          </div>
          {mic !== 'granted' && <p className="text-xs text-bv-muted">O navegador pedirá permissão para usar o microfone. Ele só é usado durante as chamadas.</p>}
          <p className="text-xs text-bv-muted">Atalho para abrir o telefone: Alt+Shift+T.</p>
        </div>
      </div>
    </section>
  );
}
