'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import AffiliateRequest from '@/components/AffiliateRequest';

export default function ConfiguracoesPage() {
  const [user, setUser] = useState<any>(null);
  const [form, setForm] = useState({ name: '', document: '' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    api.get<any>('/auth/me').then(u => {
      setUser(u);
      setForm({ name: u.name || '', document: u.document || '' });
    });
  }, []);

  async function saveProfile() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await api.put<any>('/auth/profile', {
        name: form.name,
        document: form.document,
      });
      if (res?.user) {
        setUser((prev: any) => ({ ...prev, name: res.user.name, document: res.user.document }));
        setForm({ name: res.user.name || '', document: res.user.document || '' });
      }
      setMsg({ type: 'ok', text: 'Dados atualizados com sucesso.' });
    } catch (e: any) {
      setMsg({ type: 'err', text: e?.error || e?.message || 'Não foi possível salvar.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 sm:p-8 max-w-2xl">
      <h1 className="text-2xl font-bold mb-2 text-brand-text">Configurações</h1>
      <p className="text-brand-text-secondary text-sm font-light mb-8">Gerencie seus dados e preferências</p>

      {/* Dados da conta */}
      <div className="card rounded-2xl p-6 mb-5">
        <h2 className="font-bold text-sm mb-4 text-brand-text">Dados da Conta</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-brand-text-secondary mb-1.5">Nome</label>
            <input
              className="field-input"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Seu nome"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-brand-text-secondary mb-1.5">E-mail</label>
            <input className="field-input" disabled readOnly value={user?.email || ''}/>
            <p className="text-xs text-brand-muted mt-1">E-mail não pode ser alterado após o cadastro.</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-brand-text-secondary mb-1.5">CPF / CNPJ</label>
            <input
              className="field-input"
              value={form.document}
              onChange={e => setForm(f => ({ ...f, document: e.target.value }))}
              placeholder="000.000.000-00"
            />
          </div>

          {msg && (
            <p className={`text-xs ${msg.type === 'ok' ? 'text-brand-primary' : 'text-red-400'}`}>
              {msg.text}
            </p>
          )}

          <button
            className="btn-primary text-xs px-4 py-2 disabled:opacity-50"
            disabled={saving}
            onClick={saveProfile}
          >
            {saving ? 'Salvando…' : 'Salvar alterações'}
          </button>
        </div>
      </div>

      {/* Indicar amigos */}
      {user?.refCode && (
        <div className="card rounded-2xl p-6 mb-5">
          <h2 className="font-bold text-sm mb-1 text-brand-text">Indicar Amigos</h2>
          <p className="text-xs text-brand-muted mb-3">
            Compartilhe seu link. Quando alguém se cadastrar, são <strong className="text-brand-primary">5 áudios grátis para você e sua indicação</strong>.
          </p>
          <div className="flex gap-2">
            <input
              className="field-input flex-1 font-mono text-xs"
              readOnly
              value={`https://www.zapscript.me/cadastro?ref=${user.refCode}`}
            />
            <button
              className="btn-primary text-xs px-4 py-2 flex-shrink-0"
              onClick={() => {
                navigator.clipboard.writeText(`https://www.zapscript.me/cadastro?ref=${user.refCode}`);
              }}>
              Copiar
            </button>
          </div>
        </div>
      )}

      {/* Programa de Afiliados — solicitação do código (ponto de entrada do fluxo) */}
      <AffiliateRequest user={user} />

      {/* Zona de perigo */}
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
