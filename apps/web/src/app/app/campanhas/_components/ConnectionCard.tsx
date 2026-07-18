'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

export interface MetaConnection {
  id: string;
  status: string;
  phoneNumber: string | null;
  displayName: string | null;
  metaWabaId: string | null;
  metaPhoneNumberId: string | null;
  connectedAt: string | null;
}

interface MetaStatusResponse {
  connected: boolean;
  connection: MetaConnection | null;
}

/**
 * Card de status da conexão WhatsApp oficial (Meta). Reusado em /app/campanhas
 * e /app/campanhas/nova. onReady expõe a conexão (ou null) ao componente pai
 * para gating de ações que exigem whatsappNumberId.
 */
export default function ConnectionCard({ onReady }: { onReady?: (conn: MetaConnection | null) => void }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<MetaStatusResponse | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<MetaStatusResponse>('/meta/status');
        setData(res);
        onReady?.(res.connected ? res.connection : null);
      } catch {
        onReady?.(null);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 text-sm text-neutral-400">
        Verificando conexão com WhatsApp oficial…
      </div>
    );
  }

  if (!data?.connected || !data.connection) {
    return (
      <div className="rounded-xl border border-amber-800 bg-amber-950/30 p-4">
        <div className="font-medium text-amber-200">Nenhum WhatsApp oficial conectado</div>
        <p className="mt-1 text-sm text-amber-200/70">
          Campanhas exigem um número conectado via API oficial da Meta (diferente do QR Code do Evolution).
        </p>
        <Link
          href="/dashboard/numeros"
          className="mt-3 inline-block rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-500"
        >
          Conectar número →
        </Link>
      </div>
    );
  }

  const conn = data.connection;
  return (
    <div className="rounded-xl border border-emerald-800 bg-emerald-950/20 p-4 flex items-center justify-between gap-4">
      <div>
        <div className="font-medium text-emerald-200">
          WhatsApp oficial conectado{conn.displayName ? ` — ${conn.displayName}` : ''}
        </div>
        <div className="text-sm text-emerald-200/70">{conn.phoneNumber || 'número não confirmado'}</div>
      </div>
      <Link href="/dashboard/numeros" className="text-sm text-emerald-300 hover:text-emerald-200 whitespace-nowrap">
        Gerenciar →
      </Link>
    </div>
  );
}
