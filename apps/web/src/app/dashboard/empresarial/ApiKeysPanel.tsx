'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

const SCOPES = [
  { value: 'conversations:read', label: 'Conversas (Atende)' },
  { value: 'contacts:read',      label: 'Contatos (CRM)' },
];

/** Painel de chaves da API pública — só renderizado para o dono do tier Empresas (ver page.tsx). */
export default function ApiKeysPanel() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['conversations:read']);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [newToken, setNewToken] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  async function load() {
    try {
      const res = await api.get<{ keys: ApiKey[] }>('/api-keys');
      setKeys(res.keys);
    } catch {
      // Não-Empresas cai aqui (402) — painel simplesmente fica vazio, sem erro visível.
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function toggleScope(value: string) {
    setScopes(s => s.includes(value) ? s.filter(x => x !== value) : [...s, value]);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setCreating(true);
    try {
      const res = await api.post<{ token: string }>('/api-keys', { name, scopes });
      setNewToken(res.token);
      setName('');
      load();
    } catch (err: any) {
      setError(err?.message || 'Erro ao criar chave.');
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    setRevoking(id);
    try {
      await api.delete(`/api-keys/${id}`);
      load();
    } catch (err: any) {
      alert(err?.message || 'Erro ao revogar chave.');
    } finally {
      setRevoking(null);
    }
  }

  if (loading) return null;

  return (
    <div className="rounded-2xl p-6 mt-6" style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgb(var(--color-border))' }}>
      <h2 className="font-bold text-base mb-1">🔌 API pública</h2>
      <p className="text-xs font-light mb-4" style={{ color: 'rgb(var(--color-text-secondary))' }}>
        Chaves para integrar com Zapier, Make e outras ferramentas. Cabeçalho <code>X-Api-Key</code> nas chamadas a{' '}
        <code>/public/v1/*</code>.
      </p>

      {newToken && (
        <div className="rounded-xl p-4 mb-4" style={{ background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.25)' }}>
          <div className="text-xs font-bold mb-2" style={{ color: 'rgb(var(--color-primary))' }}>
            Copie sua chave agora — ela não será mostrada de novo:
          </div>
          <code className="block text-xs break-all rounded-lg px-3 py-2" style={{ background: 'rgb(var(--color-bg))' }}>
            {newToken}
          </code>
          <button onClick={() => setNewToken(null)} className="text-xs mt-2 underline" style={{ color: 'rgb(var(--color-text-muted))' }}>
            Já copiei, fechar
          </button>
        </div>
      )}

      <div className="space-y-2 mb-4">
        {keys.length === 0 && (
          <div className="text-xs text-center py-4" style={{ color: 'rgb(var(--color-text-muted))' }}>
            Nenhuma chave criada ainda.
          </div>
        )}
        {keys.map(k => (
          <div key={k.id} className="flex items-center justify-between rounded-xl px-4 py-2.5"
            style={{ background: 'rgb(var(--color-surface-elevated))', border: '1px solid rgb(var(--color-border))' }}>
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">
                {k.name}
                {k.revokedAt && (
                  <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(239,68,68,.1)', color: '#f87171' }}>
                    Revogada
                  </span>
                )}
              </div>
              <div className="text-[11px]" style={{ color: 'rgb(var(--color-text-muted))' }}>
                {k.keyPrefix}… · {k.scopes.join(', ')}
                {k.lastUsedAt && <> · usada em {new Date(k.lastUsedAt).toLocaleDateString('pt-BR')}</>}
              </div>
            </div>
            {!k.revokedAt && (
              <button
                onClick={() => handleRevoke(k.id)}
                disabled={revoking === k.id}
                className="text-[10px] font-medium px-2 py-1 rounded-lg transition-colors hover:bg-red-500/10 disabled:opacity-50 shrink-0"
                style={{ color: 'rgb(var(--color-text-muted))' }}
              >
                {revoking === k.id ? '...' : 'Revogar'}
              </button>
            )}
          </div>
        ))}
      </div>

      <form onSubmit={handleCreate} className="pt-4 space-y-2" style={{ borderTop: '1px solid rgb(var(--color-border))' }}>
        <div className="flex gap-2">
          <input
            className="field-input flex-1"
            placeholder="Nome da chave (ex: Zapier)"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={60}
            required
          />
          <button type="submit" disabled={creating || !name || scopes.length === 0} className="btn-primary px-4 py-2 text-sm font-semibold disabled:opacity-50 shrink-0">
            {creating ? '...' : 'Gerar chave'}
          </button>
        </div>
        <div className="flex gap-4">
          {SCOPES.map(s => (
            <label key={s.value} className="flex items-center gap-1.5 text-xs" style={{ color: 'rgb(var(--color-text-secondary))' }}>
              <input type="checkbox" checked={scopes.includes(s.value)} onChange={() => toggleScope(s.value)} />
              {s.label}
            </label>
          ))}
        </div>
        {error && (
          <div className="text-xs px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,.1)', color: '#f87171' }}>
            {error}
          </div>
        )}
      </form>
    </div>
  );
}
