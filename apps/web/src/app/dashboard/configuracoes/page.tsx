'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function ConfiguracoesPage() {
  const [user, setUser]     = useState<any>(null);
  const [form, setForm]     = useState({ name: '', document: '' });
  const [loading, setLoading] = useState(false);
  const [msg, setMsg]       = useState('');

  useEffect(() => {
    api.get<any>('/auth/me').then(u => {
      setUser(u);
      setForm({ name: u.name || '', document: u.document || '' });
    });
  }, []);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setMsg('');
    try {
      await api.put('/auth/profile', { name: form.name, document: form.document });
      setMsg('✅ Perfil atualizado com sucesso!');
    } catch (err: any) {
      setMsg(`❌ ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-bold mb-2 text-brand-text">Configurações</h1>
      <p className="text-brand-text-secondary text-sm font-light mb-8">Gerencie seus dados e preferências</p>

      <div className="card rounded-2xl p-6 mb-5">
        <h2 className="font-bold text-sm mb-4 text-brand-text">Dados da Conta</h2>
        <form onSubmit={saveProfile} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-brand-text-secondary mb-1.5">Nome</label>
            <input className="field-input"
              value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} placeholder="Seu nome"/>
          </div>
          <div>
            <label className="block text-xs font-semibold text-brand-text-secondary mb-1.5">E-mail</label>
            <input className="field-input" value={user?.email || ''} disabled readOnly/>
            <p className="text-xs text-brand-muted mt-1">E-mail não pode ser alterado após o cadastro.</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-brand-text-secondary mb-1.5">CPF / CNPJ</label>
            <input className="field-input"
              value={form.document} onChange={e => setForm(f => ({...f, document: e.target.value}))} placeholder="000.000.000-00"/>
          </div>
          {msg && (
            <div className={`text-xs px-3 py-2 rounded-lg ${
              msg.startsWith('✅')
                ? 'bg-green-500/10 border border-green-500/20 text-green-500'
                : 'bg-red-400/10 border border-red-400/20 text-red-400'
            }`}>
              {msg}
            </div>
          )}
          <button type="submit" disabled={loading}
            className="btn-primary px-6 py-2.5 text-sm disabled:opacity-50">
            {loading ? 'Salvando...' : 'Salvar Alterações'}
          </button>
        </form>
      </div>

      <div className="card rounded-2xl p-6" style={{ borderColor: 'rgba(248,113,113,.15)' }}>
        <h2 className="font-bold text-sm mb-2 text-brand-text">Zona de Perigo</h2>
        <p className="text-xs text-brand-muted mb-4">A exclusão da conta é permanente e remove todos os seus dados.</p>
        <button
          className="border border-red-400/20 text-red-400 hover:bg-red-400/5 transition-colors text-xs font-semibold px-4 py-2 rounded-lg"
          onClick={() => confirm('Tem certeza? Esta ação é irreversível.') && alert('Entre em contato: contato@zapscript.me')}>
          Solicitar exclusão da conta
        </button>
      </div>
    </div>
  );
}
