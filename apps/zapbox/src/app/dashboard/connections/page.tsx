'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '@/lib/apiClient';

interface Connection {
  id: string;
  label: string;
  status: 'disconnected' | 'connecting' | 'connected';
  phoneNumber: string | null;
  instanceName: string;
}

export default function ConnectionsPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [disclaimerAcceptedAt, setDisclaimerAcceptedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [qrModal, setQrModal] = useState<{ connectionId: string; qrCode: string | null } | null>(null);
  const [ackChecked, setAckChecked] = useState(false);

  const load = useCallback(async () => {
    const [conns, settings] = await Promise.all([
      apiFetch('/api/connections'),
      apiFetch('/api/settings'),
    ]);
    setConnections(conns.connections);
    setDisclaimerAcceptedAt(settings.disclaimerAcceptedAt);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function acceptDisclaimer() {
    await apiFetch('/api/disclaimer', { method: 'POST' });
    setDisclaimerAcceptedAt(new Date().toISOString());
  }

  async function createConnection() {
    setCreating(true);
    try {
      const data = await apiFetch('/api/connections', { method: 'POST', body: JSON.stringify({}) });
      await load();
      openQr(data.connection.id);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setCreating(false);
    }
  }

  function openQr(connectionId: string) {
    setQrModal({ connectionId, qrCode: null });
  }

  // Efeito dedicado ao modal de QR: busca o QR e monitora o status enquanto
  // o modal estiver aberto, e limpa os timers sozinho ao fechar/desmontar —
  // evita polling "fantasma" continuando em segundo plano depois de fechar
  // o modal (bug: antes disso não havia cleanup nenhum).
  //
  // Duas frequências propositalmente diferentes: reconsultar
  // /instance/connect na Evolution a cada poucos segundos pode reemitir um
  // QR NOVO a cada chamada, invalidando o que a pessoa está tentando
  // escanear. Por isso o status (leve, só lê do nosso banco) é checado a
  // cada 3s, e o QR em si (pesado, chama a Evolution de verdade) só é
  // buscado ao abrir e depois a cada 20s — tempo de sobra pra escanear.
  useEffect(() => {
    if (!qrModal) return;
    const { connectionId } = qrModal;
    let cancelled = false;

    async function fetchQr() {
      try {
        const data = await apiFetch(`/api/connections/${connectionId}/qr`);
        if (cancelled) return;
        if (data.status === 'connected') {
          setQrModal(null);
          load();
          return;
        }
        setQrModal((cur) => (cur && cur.connectionId === connectionId ? { ...cur, qrCode: data.qrCode } : cur));
      } catch {
        // rede instável — tenta de novo no próximo ciclo
      }
    }

    async function checkStatus() {
      try {
        const data = await apiFetch('/api/connections');
        if (cancelled) return;
        const current = data.connections.find((c: Connection) => c.id === connectionId);
        if (current?.status === 'connected') {
          setQrModal(null);
          load();
        }
      } catch {
        /* idem */
      }
    }

    fetchQr();
    const qrInterval = setInterval(fetchQr, 20_000);
    const statusInterval = setInterval(checkStatus, 3_000);
    const giveUpTimeout = setTimeout(() => setQrModal(null), 3 * 60 * 1000); // desiste depois de 3min

    return () => {
      cancelled = true;
      clearInterval(qrInterval);
      clearInterval(statusInterval);
      clearTimeout(giveUpTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrModal?.connectionId]);

  async function disconnect(id: string) {
    if (!confirm('Desconectar este número?')) return;
    await apiFetch(`/api/connections/${id}/disconnect`, { method: 'POST' });
    load();
  }

  if (loading) return <p>Carregando...</p>;

  if (!disclaimerAcceptedAt) {
    return (
      <div className="max-w-xl bg-amber-50 border border-amber-300 rounded-xl p-6">
        <h1 className="text-lg font-bold text-amber-900 mb-2">Antes de conectar um número</h1>
        <p className="text-sm text-amber-900 mb-4">
          A conexão do WhatsApp nesta fase usa um motor <strong>não-oficial</strong> (Evolution API / Baileys),
          via QR Code. Isso significa que existe <strong>risco real de bloqueio do número pelo WhatsApp/Meta</strong>,
          especialmente em caso de alto volume de mensagens ou denúncias. Recomendamos usar um número que não seja
          crítico para o negócio até validar o volume, e migrar para a API oficial (Meta Cloud API) quando o volume
          ou uma exigência de compliance justificar.
        </p>
        <label className="flex items-start gap-2 text-sm text-amber-900 mb-4">
          <input type="checkbox" checked={ackChecked} onChange={(e) => setAckChecked(e.target.checked)} className="mt-1" />
          Li e entendo o risco de bloqueio do número nesta fase.
        </label>
        <button
          disabled={!ackChecked}
          onClick={acceptDisclaimer}
          className="bg-amber-600 text-white px-4 py-2 rounded-lg font-medium disabled:opacity-40"
        >
          Aceitar e continuar
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">Números conectados</h1>
        <button
          onClick={createConnection}
          disabled={creating}
          className="bg-green-600 text-white px-4 py-2 rounded-lg font-medium disabled:opacity-50"
        >
          {creating ? 'Criando...' : '+ Conectar número'}
        </button>
      </div>

      <div className="grid gap-3">
        {connections.length === 0 && <p className="text-gray-500">Nenhum número conectado ainda.</p>}
        {connections.map((c) => (
          <div key={c.id} className="bg-white border rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="font-medium">{c.label}</p>
              <p className="text-sm text-gray-500">{c.phoneNumber ? `+${c.phoneNumber}` : c.instanceName}</p>
            </div>
            <div className="flex items-center gap-3">
              <span
                className={`text-xs font-medium px-2 py-1 rounded-full ${
                  c.status === 'connected'
                    ? 'bg-green-100 text-green-700'
                    : c.status === 'connecting'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-gray-100 text-gray-600'
                }`}
              >
                {c.status}
              </span>
              {c.status !== 'connected' && (
                <button onClick={() => openQr(c.id)} className="text-sm text-green-700 font-medium">
                  Ver QR
                </button>
              )}
              {c.status === 'connected' && (
                <button onClick={() => disconnect(c.id)} className="text-sm text-red-600 font-medium">
                  Desconectar
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {qrModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setQrModal(null)}>
          <div className="bg-white rounded-xl p-6 w-80 text-center" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold mb-3">Escaneie no WhatsApp</h2>
            {qrModal.qrCode ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrModal.qrCode} alt="QR Code" className="mx-auto rounded-lg" />
            ) : (
              <p className="text-sm text-gray-500 py-16">Gerando QR Code...</p>
            )}
            <p className="text-xs text-gray-400 mt-3">Aparelho &gt; WhatsApp &gt; Aparelhos conectados &gt; Conectar aparelho</p>
            <button onClick={() => setQrModal(null)} className="mt-4 text-sm text-gray-500">
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
