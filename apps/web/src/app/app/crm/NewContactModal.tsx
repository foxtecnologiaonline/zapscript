'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { StageWithContacts, formatPhone } from './lib';

interface Props {
  stages: StageWithContacts[];
  onClose: () => void;
  onCreated: () => void;
}

export default function NewContactModal({ stages, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [value, setValue] = useState('');
  const [stageId, setStageId] = useState(stages[0]?.id || '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phoneDigits = phone.replace(/\D/g, '');

  async function handleSubmit() {
    if (!name.trim()) { setError('Informe o nome do contato.'); return; }
    if (!/^\d{10,15}$/.test(phoneDigits)) { setError('Telefone deve ter 10-15 dígitos (com DDD).'); return; }

    setSubmitting(true);
    setError(null);
    try {
      await api.post('/crm/contacts', {
        name: name.trim(),
        phone: phoneDigits,
        email: email.trim() || undefined,
        company: company.trim() || undefined,
        value: value.trim() ? Number(value) : undefined,
        stageId: stageId || undefined,
      });
      onCreated();
    } catch (e: any) {
      setError(e?.message || 'Não foi possível criar o contato.');
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center px-4"
      style={{ background: 'rgba(4,11,9,0.72)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-950 p-5"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold">Novo contato</h2>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-300">✕</button>
        </div>

        {error && (
          <div className="mb-3 rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-neutral-500 mb-1">Nome *</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
              className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm focus:outline-none focus:border-emerald-600"
            />
          </div>
          <div>
            <label className="block text-xs text-neutral-500 mb-1">Telefone (com DDD) *</label>
            <input
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="11987654321"
              className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm placeholder:text-neutral-600 focus:outline-none focus:border-emerald-600"
            />
            {phoneDigits.length >= 10 && (
              <div className="mt-1 text-[11px] text-neutral-600">{formatPhone(phoneDigits)}</div>
            )}
          </div>
          <div>
            <label className="block text-xs text-neutral-500 mb-1">E-mail</label>
            <input
              value={email}
              onChange={e => setEmail(e.target.value)}
              type="email"
              className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm focus:outline-none focus:border-emerald-600"
            />
          </div>
          <div>
            <label className="block text-xs text-neutral-500 mb-1">Empresa</label>
            <input
              value={company}
              onChange={e => setCompany(e.target.value)}
              className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm focus:outline-none focus:border-emerald-600"
            />
          </div>
          <div>
            <label className="block text-xs text-neutral-500 mb-1">Valor estimado (R$)</label>
            <input
              value={value}
              onChange={e => setValue(e.target.value)}
              type="number"
              min="0"
              step="0.01"
              className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm focus:outline-none focus:border-emerald-600"
            />
          </div>
          {stages.length > 0 && (
            <div>
              <label className="block text-xs text-neutral-500 mb-1">Estágio inicial</label>
              <select
                value={stageId}
                onChange={e => setStageId(e.target.value)}
                className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm focus:outline-none focus:border-emerald-600"
              >
                {stages.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="mt-5 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-neutral-800 px-3 py-2 text-sm hover:border-neutral-700"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !name.trim() || phoneDigits.length < 10}
            className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {submitting ? 'Criando...' : 'Criar contato'}
          </button>
        </div>
      </div>
    </div>
  );
}
