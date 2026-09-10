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
 * Card de status da conexão WhatsApp oficial (Meta). Reusado em /dashboard/campanhas
 * e /dashboard/campanhas/nova. onReady expõe a conexão (ou null) ao componente pai
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
      <div className="card rounded-xl p-4 text-sm text-brand-text-secondary">
        Verificando conexão com WhatsApp oficial…
      </div>
    );
  }

  if (!data?.connected || !data.connection) {
    return (
      <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4">
        <div className="font-medium text-brand-text">Nenhum WhatsApp oficial (Meta) conectado</div>
        <p className="mt-1 text-sm text-brand-text-secondary">
          Opcional — só pra quem quer volume maior com menos risco de banimento. Por padrão, suas
          campanhas já disparam pelo número que você conectou no ZapScript (o mesmo do Atende/transcrição).
        </p>
        <Link
          href="/dashboard/numeros"
          className="mt-3 inline-block rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-500"
        >
          Conectar WhatsApp oficial →
        </Link>
      </div>
    );
  }

  const conn = data.connection;
  return (
    <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4 flex items-center justify-between gap-4">
      <div>
        <div className="font-medium text-brand-text">
          WhatsApp oficial conectado{conn.displayName ? ` — ${conn.displayName}` : ''}
        </div>
        <div className="text-sm text-brand-text-secondary">{conn.phoneNumber || 'número não confirmado'}</div>
      </div>
      <Link href="/dashboard/numeros" className="text-sm text-emerald-600 hover:text-emerald-500 whitespace-nowrap">
        Gerenciar →
      </Link>
    </div>
  );
}
