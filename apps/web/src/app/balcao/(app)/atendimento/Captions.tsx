'use client';
/**
 * Legendas em tempo real da conversa de WEBCHAT (acessibilidade — surdez/baixa audição, chat de vídeo).
 * Relé efêmero (docs/balcao/api-webchat.md §4.1): nada é gravado em banco.
 *  - recebe `caption {conversationId, from:'VISITOR'|'AGENT', text, final}` no namespace /bv (a sala da conversa já foi
 *    assinada pelo console com `conv:join`); `final:false` = parcial (substitui o parcial anterior), `final:true` = frase concluída;
 *  - envia a fala do atendente por `POST /webchat/conversations/:id/caption {text, final}` → 200 `{delivered}`;
 *    a fala vem do SpeechRecognition do navegador (pt-BR, parciais e finais) ou é digitada à mão.
 * Leitores de tela: só as frases FINAIS do cidadão entram na região aria-live (polite); o parcial aparece só na tela.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { bv, errMsg } from '@/lib/balcao/api';
import { useBvSocket } from '@/lib/balcao/socket';
import { Banner, Button, TextField, cx } from '../../_ui/ui';

interface Props { conversationId: string; token: string | null; /** pode enviar legendas (atendente atribuído/supervisão e conversa aberta) */ canSend: boolean }
interface Line { id: number; text: string }
type SpeechState = 'checking' | 'unsupported' | 'idle' | 'listening' | 'denied' | 'nomic' | 'error';

const MAX_LINES = 30;
const PARTIAL_THROTTLE_MS = 500; // o servidor limita ~240 trechos/min por atendente
const VISITOR_PARTIAL_TTL_MS = 8000;

const getRecognitionCtor = (): any => (typeof window === 'undefined' ? null : (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null);

export function Captions({ conversationId, token, canSend }: Props) {
  const [on, setOn] = useState(false);
  const [visitorLines, setVisitorLines] = useState<Line[]>([]);
  const [visitorPartial, setVisitorPartial] = useState('');
  const [agentLines, setAgentLines] = useState<Line[]>([]);
  const [agentPartial, setAgentPartial] = useState('');
  const [speech, setSpeech] = useState<SpeechState>('checking');
  const [manual, setManual] = useState('');
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [delivered, setDelivered] = useState<boolean | null>(null);
  const [status, setStatus] = useState('');
  const [manualBusy, setManualBusy] = useState(false);

  const seq = useRef(0);
  const recRef = useRef<any>(null);
  const wantRef = useRef(false); // atendente quer a captura ligada (o navegador a encerra sozinho após silêncio)
  const restartsRef = useRef<number[]>([]);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const partialTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPartial = useRef<string | null>(null);
  const lastPartialAt = useRef(0);
  const visitorTtl = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const aliveRef = useRef(true);

  useEffect(() => { setSpeech(getRecognitionCtor() ? 'idle' : 'unsupported'); }, []);
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);

  const addLine = (setter: React.Dispatch<React.SetStateAction<Line[]>>, text: string) => setter((l) => [...l.slice(-(MAX_LINES - 1)), { id: ++seq.current, text }]);

  // ── recepção: fala do cidadão ───────────────────────────────────────────────────────────────────
  useBvSocket(on ? token : null, {
    caption: (p: { conversationId?: string; from?: string; text?: string; final?: boolean }) => {
      if (!p || p.conversationId !== conversationId || p.from !== 'VISITOR' || typeof p.text !== 'string') return;
      const text = p.text.trim();
      if (visitorTtl.current) clearTimeout(visitorTtl.current);
      if (p.final) { setVisitorPartial(''); if (text) addLine(setVisitorLines, text); return; }
      setVisitorPartial(text);
      visitorTtl.current = setTimeout(() => setVisitorPartial(''), VISITOR_PARTIAL_TTL_MS);
    },
  });

  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [visitorLines, visitorPartial]);

  // ── envio: fala do atendente (ordem preservada; falha de um trecho não trava os seguintes) ────────────
  const post = useCallback((text: string, final: boolean): Promise<boolean> => {
    const t = text.trim().slice(0, 500);
    if (!t) return Promise.resolve(false);
    let ok = false;
    const run = async () => {
      try {
        const r = await bv.post<{ delivered?: boolean }>(`/webchat/conversations/${conversationId}/caption`, { text: t, final });
        ok = true;
        if (!aliveRef.current) return;
        setSendErr(null);
        if (typeof r?.delivered === 'boolean') setDelivered(r.delivered);
      } catch (e) { if (aliveRef.current) setSendErr(errMsg(e, 'Não foi possível enviar a legenda.')); }
    };
    chainRef.current = chainRef.current.then(run);
    return chainRef.current.then(() => ok);
  }, [conversationId]);

  const clearPartialTimer = () => { if (partialTimer.current) { clearTimeout(partialTimer.current); partialTimer.current = null; } pendingPartial.current = null; };
  const sendPartial = (text: string) => {
    const wait = PARTIAL_THROTTLE_MS - (Date.now() - lastPartialAt.current);
    pendingPartial.current = text;
    if (wait <= 0) { lastPartialAt.current = Date.now(); pendingPartial.current = null; void post(text, false); return; }
    if (!partialTimer.current) {
      partialTimer.current = setTimeout(() => {
        partialTimer.current = null;
        const t = pendingPartial.current; pendingPartial.current = null;
        if (t) { lastPartialAt.current = Date.now(); void post(t, false); }
      }, wait);
    }
  };

  // ── reconhecimento de fala (Web Speech API; Chrome/Edge) ──────────────────────────────────────────
  const stopSpeech = useCallback((nextState: SpeechState = 'idle') => {
    wantRef.current = false;
    clearPartialTimer();
    const r = recRef.current; recRef.current = null;
    if (r) { r.onend = null; r.onerror = null; r.onresult = null; try { r.stop(); } catch { /* já parado */ } }
    setAgentPartial('');
    setSpeech((s) => (s === 'unsupported' ? s : nextState));
  }, []);

  const startSpeech = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) { setSpeech('unsupported'); return; }
    const r = new Ctor();
    r.lang = 'pt-BR'; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
    r.onresult = (ev: any) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i]; const text = String(res[0]?.transcript ?? '').trim();
        if (!text) continue;
        if (res.isFinal) {
          clearPartialTimer(); setAgentPartial('');
          addLine(setAgentLines, text); void post(text, true);
        } else interim += (interim ? ' ' : '') + text;
      }
      if (interim) { setAgentPartial(interim); sendPartial(interim); }
    };
    r.onerror = (ev: any) => {
      const code = String(ev?.error ?? '');
      if (code === 'no-speech' || code === 'aborted') return; // silêncio: o onend reinicia
      if (code === 'not-allowed' || code === 'service-not-allowed') stopSpeech('denied');
      else if (code === 'audio-capture') stopSpeech('nomic');
      else stopSpeech('error');
    };
    r.onend = () => { // o navegador encerra após silêncio: reinicia, com trava contra laço de falhas
      if (!wantRef.current) return;
      const now = Date.now(); restartsRef.current = [...restartsRef.current.filter((t) => now - t < 10_000), now];
      if (restartsRef.current.length > 6) { stopSpeech('error'); return; }
      try { r.start(); } catch { stopSpeech('error'); }
    };
    recRef.current = r; wantRef.current = true; restartsRef.current = [];
    try { r.start(); setSpeech('listening'); setStatus('Capturando a sua fala para legendar.'); } catch { stopSpeech('error'); }
  }, [post, stopSpeech]);

  // desligar o painel, trocar de conversa ou sair: encerra tudo e descarta o que estava em memória
  useEffect(() => () => {
    wantRef.current = false;
    const r = recRef.current; if (r) { r.onend = null; r.onerror = null; r.onresult = null; try { r.stop(); } catch { /* ok */ } }
    if (partialTimer.current) clearTimeout(partialTimer.current);
    if (visitorTtl.current) clearTimeout(visitorTtl.current);
  }, []);

  const toggle = () => {
    if (on) {
      stopSpeech(); setOn(false);
      setVisitorLines([]); setVisitorPartial(''); setAgentLines([]); setManual(''); setSendErr(null); setDelivered(null);
      setStatus('Legendas desativadas.');
    } else { setOn(true); setStatus('Legendas ativadas. As legendas do cidadão aparecem aqui.'); }
  };

  const sendManual = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = manual.trim(); if (!t) return;
    setManualBusy(true);
    const ok = await post(t, true);
    if (!aliveRef.current) return;
    setManualBusy(false);
    if (ok) { addLine(setAgentLines, t); setManual(''); } // em caso de falha o texto fica no campo e o erro aparece abaixo
  };

  const speechMsg: Record<Exclude<SpeechState, 'idle' | 'listening' | 'checking'>, string> = {
    unsupported: 'Este navegador não oferece reconhecimento de fala. Para legendar a sua fala automaticamente, use o Google Chrome ou o Microsoft Edge com um microfone. Enquanto isso, você pode digitar as legendas abaixo.',
    denied: 'O acesso ao microfone ou ao reconhecimento de fala foi negado. Libere o microfone nas permissões do navegador e tente de novo, ou digite as legendas.',
    nomic: 'Nenhum microfone foi encontrado. Conecte um microfone e tente de novo, ou digite as legendas.',
    error: 'A captura da fala parou por um erro do navegador. Tente de novo ou digite as legendas.',
  };

  return (
    <section aria-label="Legendas da conversa" className="shrink-0 border-t border-bv-border px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={on ? 'primary' : 'secondary'} aria-pressed={on} aria-controls="bv-captions-panel" onClick={toggle}>Legendas</Button>
        <span className="text-xs text-bv-muted">{on ? 'Ativadas' : 'Desativadas'} · para chat de vídeo ou conversa por voz com o cidadão</span>
        <span role="status" className="bv-sr-only">{status}</span>
      </div>

      {on && (
        <div id="bv-captions-panel" className="mt-2 flex flex-col gap-2">
          <p className="text-xs text-bv-muted">As legendas são retransmitidas em tempo real e <strong>nada é gravado</strong> em banco de dados. Quem não estiver conectado no momento não recebe o trecho.</p>

          <div>
            <h3 className="text-sm font-semibold" id="bv-cap-visitor-h">O que o cidadão fala</h3>
            <div ref={logRef} role="log" aria-live="polite" aria-relevant="additions" aria-labelledby="bv-cap-visitor-h" tabIndex={0}
              className="mt-1 max-h-40 min-h-[3rem] overflow-y-auto rounded-md border border-bv-border bg-bv-subtle p-2 text-base">
              {visitorLines.length === 0 && !visitorPartial && <p className="text-sm text-bv-muted">Aguardando a fala do cidadão… (o cidadão precisa ativar “Legendas” no chat dele).</p>}
              {visitorLines.map((l) => <p key={l.id}><span className="bv-sr-only">Cidadão: </span>{l.text}</p>)}
            </div>
            {visitorPartial && <p aria-hidden="true" className="mt-1 rounded-md border border-dashed border-bv-border px-2 py-1 text-base italic text-bv-muted"><span className="not-italic font-medium">Cidadão falando (parcial): </span>{visitorPartial}…</p>}
          </div>

          {!canSend ? (
            <Banner tone="primary">Você vê as legendas do cidadão. Para enviar as suas, assuma a conversa (ou use o monitoramento, se for supervisor).</Banner>
          ) : (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">O que você fala (enviado ao cidadão)</h3>
              {speech !== 'idle' && speech !== 'listening' && speech !== 'checking' && (
                <Banner tone={speech === 'unsupported' ? 'warning' : 'danger'} title={speech === 'unsupported' ? 'Fala automática indisponível' : 'Captura de fala interrompida'}>{speechMsg[speech]}</Banner>
              )}
              {(speech === 'idle' || speech === 'listening') && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant={speech === 'listening' ? 'danger' : 'secondary'} aria-pressed={speech === 'listening'} onClick={() => (speech === 'listening' ? stopSpeech() : startSpeech())}>
                    {speech === 'listening' ? 'Parar captura da minha fala' : 'Capturar minha fala'}
                  </Button>
                  <span className={cx('text-xs', speech === 'listening' ? 'font-medium text-bv-text' : 'text-bv-muted')}>
                    {speech === 'listening' ? '● Ouvindo o microfone (pt-BR)' : 'Desligada'}
                  </span>
                </div>
              )}
              {speech === 'idle' && <p className="text-xs text-bv-muted">A captura usa o reconhecimento de voz do navegador, que pode enviar o áudio ao fornecedor dele (Google/Microsoft). Ative somente se isso for aceitável.</p>}
              {(speech === 'denied' || speech === 'nomic' || speech === 'error') && <div><Button size="sm" variant="secondary" onClick={() => { setSpeech('idle'); startSpeech(); }}>Tentar de novo</Button></div>}
              {(agentLines.length > 0 || agentPartial) && (
                <div className="max-h-24 overflow-y-auto rounded-md border border-bv-border p-2 text-sm" tabIndex={0} role="region" aria-label="Legendas enviadas por você">
                  {agentLines.map((l) => <p key={l.id}><span className="font-medium">Você: </span>{l.text}</p>)}
                  {agentPartial && <p className="italic text-bv-muted"><span className="not-italic font-medium">Você (parcial): </span>{agentPartial}…</p>}
                </div>
              )}
              <form onSubmit={(e) => void sendManual(e)} className="flex flex-wrap items-end gap-2">
                <div className="min-w-[12rem] flex-1">
                  <TextField label="Digitar uma legenda" value={manual} onChange={(e) => setManual(e.target.value)} maxLength={500} autoComplete="off" hint="Enter envia o texto como uma frase completa." />
                </div>
                <Button type="submit" size="sm" variant="secondary" loading={manualBusy} disabled={!manual.trim()} className="mb-5">Enviar legenda</Button>
              </form>
              <div aria-live="polite">
                {delivered === false && !sendErr && <p className="text-sm text-bv-warning">Nenhum cidadão está conectado ao chat agora: as legendas enviadas não foram entregues.</p>}
                {sendErr && <p role="alert" className="text-sm text-bv-danger">{sendErr}</p>}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
