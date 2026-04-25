'use client';
import { useEffect, useState } from 'react';
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
  const [numbers, setNumbers]     = useState<WNumber[]>([]);
  const [loading, setLoading]     = useState(true);
  const [addName, setAddName]     = useState('');
  const [adding, setAdding]       = useState(false);
  const [qr, setQr]               = useState<{ numberId: string; dataUrl: string } | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [userId, setUserId]       = useState('');
  const [error, setError]         = useState('');

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

  // ── WebSocket events ─────────────────────────────────────────
  useSocket(userId, {
    qr_code: async ({ numberId, qr: rawQr }: { numberId: string; qr: string }) => {
      // Convert QR string to data URL using canvas
      try {
        const QRCode = (await import('qrcode')).default;
        const dataUrl = await QRCode.toDataURL(rawQr, { width: 280, margin: 2 });
        setQr({ numberId, dataUrl });
      } catch {
        setQr({ numberId, dataUrl: '' });
      }
    },
    wa_connected: ({ numberId }: { numberId: string }) => {
      setQr(null);
      setConnectingId(null);
      loadNumbers();
    },
    wa_disconnected: () => {
      loadNumbers();
    },
  });

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!addName.trim()) return;
    setAdding(true); setError('');
    try {
      await api.post('/numbers', { displayName: addName.trim() });
      setAddName('');
      loadNumbers();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  }

  async function handleConnect(id: string) {
    setConnectingId(id); setError('');
    try {
      await api.post(`/numbers/${id}/connect`, {});
    } catch (err: any) {
      setError(err.message);
      setConnectingId(null);
    }
  }

  async function handleDisconnect(id: string) {
    await api.post(`/numbers/${id}/disconnect`, {});
    loadNumbers();
  }

  async function handleDelete(id: string) {
    if (!confirm('Remover este número?')) return;
    await api.delete(`/numbers/${id}`);
    setNumbers(n => n.filter(x => x.id !== id));
  }

  const statusColor = (s: string) =>
    s === 'connected'  ? 'text-green-400 bg-green-400/10 border-green-400/20' :
    s === 'connecting' ? 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20' :
                         'text-[#3d6647] bg-[#162012] border-[rgba(34,197,94,.10)]';

  const statusLabel = (s: string) =>
    s === 'connected'  ? '● Online' :
    s === 'connecting' ? '◌ Conectando...' : '○ Offline';

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Números WhatsApp</h1>
        <p className="text-sm text-[#7aaa85] font-light mt-0.5">Gerencie os números conectados ao ZapScript</p>
      </div>

      {/* Add number form */}
      <div className="card p-5 mb-5">
        <div className="text-sm font-bold mb-3">Adicionar número</div>
        <form onSubmit={handleAdd} className="flex gap-2">
          <input className="input flex-1" placeholder="Nome do número (ex: Comercial, Suporte...)"
            value={addName} onChange={e => setAddName(e.target.value)} />
          <button type="submit" disabled={adding} className="btn-primary whitespace-nowrap">
            {adding ? 'Adicionando...' : '+ Adicionar'}
          </button>
        </form>
        {error && <p className="text-red-400 text-xs mt-2 bg-red-400/10 px-3 py-1.5 rounded-lg">{error}</p>}
        <p className="text-xs text-[#3d6647] mt-2">
          Após adicionar, clique em <strong className="text-[#7aaa85]">Conectar</strong> e escaneie o QR Code no WhatsApp (Dispositivos Conectados).
        </p>
      </div>

      {/* Number cards */}
      {loading ? (
        <div className="text-center py-12 text-[#3d6647] text-sm">Carregando...</div>
      ) : numbers.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-4xl mb-3">📱</div>
          <div className="text-sm text-[#3d6647]">Nenhum número cadastrado ainda. Adicione um acima.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {numbers.map(n => (
            <div key={n.id} className="card p-5 hover:border-[rgba(34,197,94,.22)] transition-colors">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="font-bold text-sm">{n.displayName || 'Número'}</div>
                  <div className="text-xs text-[#3d6647] font-mono mt-0.5">
                    {n.phoneNumber !== 'pending' ? `+${n.phoneNumber}` : 'Aguardando conexão'}
                  </div>
                </div>
                <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${statusColor(n.status)}`}>
                  {statusLabel(n.status)}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-[#101a0d] rounded-lg p-2.5">
                  <div className="text-base font-black text-green-400 leading-none">{n.messageCount}</div>
                  <div className="text-[10px] text-[#3d6647] mt-0.5">transcrições</div>
                </div>
                <div className="bg-[#101a0d] rounded-lg p-2.5">
                  <div className="text-base font-black text-green-400 leading-none">{n.minutesUsed.toFixed(1)}</div>
                  <div className="text-[10px] text-[#3d6647] mt-0.5">minutos usados</div>
                </div>
              </div>

              <div className="flex gap-2">
                {n.status !== 'connected' ? (
                  <button onClick={() => handleConnect(n.id)} disabled={connectingId === n.id}
                    className="btn-primary flex-1 justify-center text-xs py-2">
                    {connectingId === n.id ? '⟳ Aguardando QR...' : '📲 Conectar'}
                  </button>
                ) : (
                  <button onClick={() => handleDisconnect(n.id)}
                    className="btn-ghost flex-1 justify-center text-xs py-2">
                    ⏹ Desconectar
                  </button>
                )}
                <button onClick={() => handleDelete(n.id)}
                  className="text-xs px-3 py-2 rounded-lg border border-red-400/15 text-[#3d6647] hover:text-red-400 hover:border-red-400/30 transition-colors">
                  🗑
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* QR Modal */}
      {qr && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0b1209] border border-[rgba(34,197,94,.25)] rounded-2xl p-7 max-w-sm w-full text-center shadow-2xl">
            <div className="text-lg font-bold mb-1">Escanear QR Code</div>
            <p className="text-xs text-[#7aaa85] font-light mb-5">
              Abra o <strong>WhatsApp</strong> → Menu → <strong>Dispositivos conectados</strong> → Conectar dispositivo
            </p>
            {qr.dataUrl ? (
              <div className="bg-white p-3 rounded-xl inline-block mb-5">
                <img src={qr.dataUrl} alt="QR Code" width={256} height={256} />
              </div>
            ) : (
              <div className="w-64 h-64 bg-[#162012] rounded-xl flex items-center justify-center mx-auto mb-5 text-[#3d6647]">
                Gerando QR...
              </div>
            )}
            <div className="flex items-center justify-center gap-2 text-xs text-[#7aaa85] mb-5 animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
              Aguardando escaneamento...
            </div>
            <button onClick={() => { setQr(null); setConnectingId(null); }}
              className="btn-ghost w-full justify-center text-sm py-2">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
