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
  const [numbers, setNumbers] = useState<WNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [addName, setAddName] = useState('');
  const [addPhone, setAddPhone] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [userId, setUserId] = useState('');

  useEffect(() => {
    loadNumbers();
    api.get<any>('/auth/me').then(u => setUserId(u.id));
  }, []);

  async function loadNumbers() {
    setLoading(true);
    try { setNumbers(await api.get<WNumber[]>('/numbers')); }
    finally { setLoading(false); }
  }

  /* ────────────────────────────────────────
     SOCKET.IO — recebe eventos de transcrição em tempo real
     ──────────────────────────────────────── */
  const { connected: socketOk } = useSocket(userId, {
    audio_received: () => { loadNumbers(); },
  });

  /* ──────── Actions ──────── */

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
    } catch (err: any) { setError(err.message); }
    finally { setAdding(false); }
  }

  async function handleDisconnect(id: string) {
    await api.post(`/numbers/${id}/disconnect`, {});
    loadNumbers();
  }

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

      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-brand-text">Números WhatsApp</h1>
          <p className="text-sm text-brand-text-secondary font-light mt-0.5">
            Gerencie os dispositivos conectados ao ZapScript
          </p>
        </div>
        {/* Socket.IO status indicator */}
        <div className={`flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${
          socketOk
            ? 'text-green-500 bg-green-400/10 border-green-400/20'
            : 'text-amber-500 bg-amber-400/10 border-amber-400/20'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${socketOk ? 'bg-green-400 animate-pulse' : 'bg-amber-400'}`} />
          {socketOk ? 'Tempo real ativo' : 'Modo polling'}
        </div>
      </div>

      {/* ── Add number form ── */}
      <div className="card p-5 mb-5">
        <div className="text-sm font-bold mb-3 text-brand-text">Adicionar dispositivo</div>
        <form onSubmit={handleAdd} className="space-y-3">

          <input
            className="input w-full"
            placeholder="Nome do dispositivo (ex: Comercial, Pessoal, Suporte)"
            value={addName}
            onChange={e => setAddName(e.target.value)}
            required
          />

          <div>
            <input
              className="input w-full"
              placeholder="Número do WhatsApp — opcional (ex: 5511999999999)"
              value={addPhone}
              onChange={e => setAddPhone(e.target.value)}
              type="tel"
            />
            <p className="text-[11px] text-brand-muted mt-1.5 leading-relaxed">
              📞 <strong>DDI + DDD + Número</strong>, somente dígitos, sem + ou espaços.
              {' '}<span className="opacity-70">
                Ex: Brasil SP → <code className="bg-brand-elevated px-1 rounded">55</code>
                +<code className="bg-brand-elevated px-1 rounded">11</code>
                +<code className="bg-brand-elevated px-1 rounded">999999999</code>
                {' '}= <code className="bg-brand-elevated px-1 rounded">5511999999999</code>
              </span>
            </p>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button type="submit" disabled={adding} className="btn-primary">
              {adding ? 'Adicionando...' : '+ Adicionar'}
            </button>
            <span className="text-xs text-brand-muted">
              Após adicionar, escolha QR Code ou Código por Número para conectar.
            </span>
          </div>
        </form>

        {error && (
          <p className="text-red-400 text-xs mt-3 bg-red-400/10 px-3 py-2 rounded-lg">{error}</p>
        )}
      </div>

      {/* ── Number cards ── */}
      {loading ? (
        <div className="text-center py-12 text-brand-muted text-sm">Carregando...</div>
      ) : numbers.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-4xl mb-3">📱</div>
          <div className="text-sm text-brand-muted">
            Nenhum dispositivo cadastrado ainda. Adicione um acima.
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {numbers.map(n => (
            <div key={n.id} className="card p-5 hover:border-brand-primary/20 transition-colors">

              {/* Card header */}
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

              {/* Action buttons */}
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
                  {/* Meta Cloud API — instrução de configuração */}
                  <div className="bg-amber-400/8 border border-amber-400/20 rounded-lg px-3 py-2.5 text-[11px] text-amber-400/80 leading-relaxed">
                    <p className="font-semibold mb-1">📡 Conectar via WhatsApp Business API</p>
                    <p>Configure o webhook no <a href="https://developers.facebook.com" target="_blank" rel="noopener noreferrer" className="underline text-amber-400">Meta for Developers</a> apontando para:</p>
                    <code className="block mt-1 bg-brand-elevated px-2 py-1 rounded text-[10px] break-all text-brand-primary">
                      {process.env.NEXT_PUBLIC_API_URL || 'https://zapscript-api.onrender.com'}/webhook/whatsapp
                    </code>
                  </div>
                  <button onClick={() => handleDelete(n.id)}
                    className="w-full text-[11px] px-3 py-1 rounded-lg border border-red-400/10 text-red-400/50 hover:text-red-400 hover:border-red-400/30 transition-colors">
                    Remover
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

    </div>
  );
}
