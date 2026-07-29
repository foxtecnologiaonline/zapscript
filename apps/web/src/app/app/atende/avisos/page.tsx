'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import AtendeHeader from '../AtendeHeader';

interface Aviso {
  id: string;
  numberId: string;
  contactPhone: string;
  contactName: string | null;
  category: string;
  message: string;
  createdAt: string;
}

interface WNumber {
  id: string;
  displayName: string | null;
  phoneNumber: string;
  status: string;
}

const CATEGORIES = [
  { value: 'cobranca',          label: '💰 Cobrança' },
  { value: 'agendamento',       label: '🗓️ Agendamento' },
  { value: 'mercadoria_pronta', label: '📦 Mercadoria pronta' },
  { value: 'outro',             label: '✉️ Outro' },
];
const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(CATEGORIES.map(c => [c.value, c.label]));

function formatPhone(phone: string): string {
  let d = phone.replace(/\D/g, '');
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return phone;
}

export default function AvisosPage() {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [numbers, setNumbers] = useState<WNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [numberId, setNumberId] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactName, setContactName] = useState('');
  const [category, setCategory] = useState('cobranca');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');

  function load() {
    Promise.all([
      api.get<Aviso[]>('/atende/avisos'),
      api.get<WNumber[]>('/numbers'),
    ]).then(([av, nums]) => {
      setAvisos(av);
      setNumbers(nums.filter(n => n.status === 'connected'));
      if (!numberId && nums.length > 0) setNumberId(nums.find(n => n.status === 'connected')?.id || '');
    }).catch((e) => setError(e?.message || 'Não foi possível carregar os avisos.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setSendError('');
    setSending(true);
    try {
      await api.post('/atende/avisos', {
        numberId, contactPhone: contactPhone.replace(/\D/g, ''), contactName: contactName || undefined,
        category, message,
      });
      setContactPhone(''); setContactName(''); setMessage('');
      load();
    } catch (err: any) {
      setSendError(err?.message || 'Erro ao enviar aviso.');
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 px-5 py-10">
      <div className="max-w-2xl mx-auto">
        <AtendeHeader />

        {error && (
          <div className="mb-5 rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSend} className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 mb-6 space-y-3">
          <h2 className="text-sm font-bold text-neutral-300">Enviar aviso ao cliente</h2>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-neutral-500 mb-1">Número (de onde envia)</label>
              <select
                value={numberId} onChange={e => setNumberId(e.target.value)} required
                className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
              >
                <option value="" disabled>Selecione…</option>
                {numbers.map(n => (
                  <option key={n.id} value={n.id}>{n.displayName || formatPhone(n.phoneNumber)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-neutral-500 mb-1">Categoria</label>
              <select
                value={category} onChange={e => setCategory(e.target.value)}
                className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
              >
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-neutral-500 mb-1">Telefone do cliente</label>
              <input
                value={contactPhone} onChange={e => setContactPhone(e.target.value)} required
                placeholder="11999999999"
                className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-500 mb-1">Nome (opcional)</label>
              <input
                value={contactName} onChange={e => setContactName(e.target.value)}
                placeholder="Fulano"
                className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-neutral-500 mb-1">Mensagem</label>
            <textarea
              value={message} onChange={e => setMessage(e.target.value)} required maxLength={1000} rows={3}
              placeholder="Ex: Olá! Sua encomenda já está pronta pra retirada."
              className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm resize-none"
            />
          </div>

          {sendError && (
            <div className="rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-xs text-red-300">
              {sendError}
            </div>
          )}

          <button
            type="submit" disabled={sending || !numberId}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {sending ? 'Enviando...' : 'Enviar aviso →'}
          </button>
        </form>

        <h2 className="text-sm font-bold text-neutral-300 mb-3">Histórico</h2>
        {loading ? (
          <div className="text-neutral-500 text-sm">Carregando...</div>
        ) : avisos.length === 0 ? (
          <div className="text-sm text-neutral-600 text-center py-8 rounded-xl border border-neutral-800">Nenhum aviso enviado ainda.</div>
        ) : (
          <div className="space-y-2">
            {avisos.map(a => (
              <div key={a.id} className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">{a.contactName || formatPhone(a.contactPhone)}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-neutral-800 text-neutral-400">
                    {CATEGORY_LABEL[a.category] || a.category}
                  </span>
                </div>
                <div className="text-xs text-neutral-500 mb-1">{formatPhone(a.contactPhone)}</div>
                <div className="text-sm text-neutral-300">{a.message}</div>
                <div className="text-[11px] text-neutral-600 mt-1">{new Date(a.createdAt).toLocaleString('pt-BR')}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
