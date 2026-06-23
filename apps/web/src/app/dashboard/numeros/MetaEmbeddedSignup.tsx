'use client';
import React, { useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { api } from '@/lib/api';

/**
 * Conexão via API oficial da Meta (WhatsApp Cloud API / Embedded Signup).
 *
 * Caminho usado para o App Review da Meta. Os usuários reais seguem conectando
 * pelo Evolution (fluxo guiado acima). Esta seção SÓ aparece quando as env
 * NEXT_PUBLIC_META_APP_ID e NEXT_PUBLIC_META_CONFIG_ID estão configuradas —
 * portanto zero impacto na experiência padrão.
 */

const APP_ID    = process.env.NEXT_PUBLIC_META_APP_ID || '';
const CONFIG_ID = process.env.NEXT_PUBLIC_META_CONFIG_ID || '';
const GRAPH_VERSION = process.env.NEXT_PUBLIC_META_GRAPH_VERSION || 'v23.0';

interface MetaStatus {
  connected: boolean;
  connection: { phoneNumber: string; displayName: string | null; metaWabaId: string | null } | null;
}

export default function MetaEmbeddedSignup() {
  // Renderiza somente quando a integração está configurada no ambiente.
  const enabled = Boolean(APP_ID && CONFIG_ID);

  const [sdkReady, setSdkReady] = useState(false);
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [status, setStatus]     = useState<MetaStatus | null>(null);
  const sessionInfo = useRef<{ wabaId?: string; phoneNumberId?: string }>({});

  // Carrega o status atual da conexão Meta deste usuário
  useEffect(() => {
    if (!enabled) return;
    api.get<MetaStatus>('/meta/status').then(setStatus).catch(() => null);
  }, [enabled]);

  // Inicializa o SDK do Facebook quando o script termina de carregar
  function onSdkLoad() {
    const w = window as any;
    w.fbAsyncInit = function () {
      w.FB.init({ appId: APP_ID, autoLogAppEvents: true, xfbml: false, version: GRAPH_VERSION });
      setSdkReady(true);
    };
    // Se o SDK já estava presente, init imediato
    if (w.FB) { w.fbAsyncInit(); }
  }

  // Captura o sessionInfo (waba_id, phone_number_id) emitido pelo popup
  useEffect(() => {
    if (!enabled) return;
    function onMessage(event: MessageEvent) {
      if (event.origin !== 'https://www.facebook.com' && event.origin !== 'https://web.facebook.com') return;
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data?.type === 'WA_EMBEDDED_SIGNUP' && data?.event === 'FINISH') {
          sessionInfo.current = {
            wabaId:        data.data?.waba_id,
            phoneNumberId: data.data?.phone_number_id,
          };
        }
      } catch { /* mensagens não-JSON do Facebook são ignoradas */ }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [enabled]);

  function launch() {
    const w = window as any;
    if (!w.FB) { setError('SDK da Meta ainda não carregou. Tente novamente.'); return; }
    setError(null);
    setBusy(true);

    w.FB.login(
      async (response: any) => {
        const code = response?.authResponse?.code;
        if (!code) {
          setBusy(false);
          setError('Conexão cancelada ou sem autorização.');
          return;
        }
        try {
          const res = await api.post<{ ok: boolean; phoneNumber: string | null; wabaId: string | null }>(
            '/meta/connect',
            {
              code,
              wabaId:        sessionInfo.current.wabaId,
              phoneNumberId: sessionInfo.current.phoneNumberId,
            },
          );
          if (res.ok) {
            const fresh = await api.get<MetaStatus>('/meta/status').catch(() => null);
            if (fresh) setStatus(fresh);
          }
        } catch (e: any) {
          setError(e?.detail || e?.error || e?.message || 'Falha ao conectar com a Meta.');
        } finally {
          setBusy(false);
        }
      },
      {
        config_id:                     CONFIG_ID,
        response_type:                 'code',
        override_default_response_type: true,
        extras:                        { setup: {} },
      },
    );
  }

  async function disconnect() {
    setBusy(true);
    try {
      await api.post('/meta/disconnect', {});
      setStatus({ connected: false, connection: null });
    } catch { /* noop */ }
    finally { setBusy(false); }
  }

  if (!enabled) return null;

  const connected = status?.connected;

  return (
    <div className="card p-4 sm:p-5 mb-5">
      <Script
        src="https://connect.facebook.net/en_US/sdk.js"
        strategy="afterInteractive"
        onLoad={onSdkLoad}
      />

      <div className="flex items-center gap-2 mb-1">
        <p className="text-sm font-bold text-brand-text">Conectar via API oficial (Meta)</p>
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-brand-primary/15 text-brand-primary">
          Oficial
        </span>
      </div>
      <p className="text-xs text-brand-text-secondary font-light mb-4 leading-relaxed">
        Conecte um WhatsApp Business pela API oficial da Meta (Cloud API). Recomendado para
        contas Business verificadas.
      </p>

      {connected ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-green-500 font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            Conectado{status?.connection?.displayName ? ` — ${status.connection.displayName}` : ''}
          </div>
          <button
            onClick={disconnect}
            disabled={busy}
            className="text-xs px-3 py-2 rounded-lg border border-red-400/20 text-red-400/70 hover:text-red-400 hover:border-red-400/40 hover:bg-red-400/5 transition-colors disabled:opacity-50"
          >
            Desconectar
          </button>
        </div>
      ) : (
        <button
          onClick={launch}
          disabled={busy || !sdkReady}
          className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl bg-[#1877F2] text-white hover:brightness-110 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? 'Conectando…' : sdkReady ? 'Conectar com a Meta' : 'Carregando…'}
        </button>
      )}

      {error && (
        <p className="mt-3 text-xs text-red-400 leading-relaxed">{error}</p>
      )}
    </div>
  );
}
