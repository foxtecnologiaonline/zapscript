'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatBrl } from '@/lib/modules';
import {
  ContactDetail,
  StageWithContacts,
  CrmActivity,
  ACTIVITY_ICON,
  ACTIVITY_LABEL,
  formatPhone,
  relativeTime,
} from './lib';

interface Props {
  contactId: string;
  stages: StageWithContacts[];
  onClose: () => void;
  onChanged: () => void;
}

type ActivityFormType = 'note' | 'call' | 'meeting' | 'reminder';

export default function ContactDrawer({ contactId, stages, onClose, onChanged }: Props) {
  const [detail, setDetail] = useState<ContactDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [moving, setMoving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [value, setValue] = useState('');
  const [tags, setTags] = useState('');
  const [lostReason, setLostReason] = useState('');

  const [actType, setActType] = useState<ActivityFormType>('note');
  const [actContent, setActContent] = useState('');
  const [actDueAt, setActDueAt] = useState('');
  const [addingActivity, setAddingActivity] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.get<ContactDetail>(`/crm/contacts/${contactId}`)
      .then(data => {
        if (cancelled) return;
        setDetail(data);
        setName(data.name);
        setPhone(data.phone);
        setEmail(data.email || '');
        setCompany(data.company || '');
        setValue(data.value != null ? String(data.value) : '');
        setTags((data.tags || []).join(', '));
        setLostReason(data.lostReason || '');
      })
      .catch(e => { if (!cancelled) setError(e?.message || 'Não foi possível carregar o contato.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [contactId]);

  async function reload() {
    const data = await api.get<ContactDetail>(`/crm/contacts/${contactId}`);
    setDetail(data);
    return data;
  }

  async function handleSave() {
    if (!name.trim() || !phone.trim()) {
      setError('Nome e telefone são obrigatórios.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/crm/contacts/${contactId}`, {
        name: name.trim(),
        phone: phone.replace(/\D/g, ''),
        email: email.trim() || null,
        company: company.trim() || null,
        value: value.trim() ? Number(value) : null,
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
        lostReason: lostReason.trim() || null,
      });
      await reload();
      onChanged();
    } catch (e: any) {
      setError(e?.message || 'Não foi possível salvar o contato.');
    } finally {
      setSaving(false);
    }
  }

  async function handleMove(stageId: string) {
    if (!detail || stageId === detail.stageId) return;
    setMoving(true);
    setError(null);
    try {
      await api.patch(`/crm/contacts/${contactId}/move`, { stageId });
      await reload();
      onChanged();
    } catch (e: any) {
      setError(e?.message || 'Não foi possível mover o contato.');
    } finally {
      setMoving(false);
    }
  }

  async function handleAddActivity() {
    if (!actContent.trim()) return;
    if (actType === 'reminder' && !actDueAt) {
      setError('Lembretes exigem uma data.');
      return;
    }
    setAddingActivity(true);
    setError(null);
    try {
      await api.post(`/crm/contacts/${contactId}/activities`, {
        type: actType,
        content: actContent.trim(),
        dueAt: actType === 'reminder' ? new Date(actDueAt).toISOString() : undefined,
      });
      setActContent('');
      setActDueAt('');
      setActType('note');
      await reload();
      onChanged();
    } catch (e: any) {
      setError(e?.message || 'Não foi possível adicionar a atividade.');
    } finally {
      setAddingActivity(false);
    }
  }

  async function handleCompleteActivity(activityId: string) {
    try {
      await api.patch(`/crm/activities/${activityId}/complete`, {});
      await reload();
      onChanged();
    } catch (e: any) {
      setError(e?.message || 'Não foi possível concluir o lembrete.');
    }
  }

  async function handleDelete() {
    if (!confirm(`Excluir o contato "${detail?.name}"? Esta ação não pode ser desfeita.`)) return;
    setDeleting(true);
    setError(null);
    try {
      await api.delete(`/crm/contacts/${contactId}`);
      onChanged();
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Não foi possível excluir o contato.');
      setDeleting(false);
    }
  }

  const currentStage = stages.find(s => s.id === detail?.stageId);

  return (
    <div
      className="fixed inset-0 z-[100] flex justify-end"
      style={{ background: 'rgba(4,11,9,0.72)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="h-full w-full sm:w-[440px] bg-neutral-950 border-l border-neutral-800 overflow-y-auto"
      >
        <div className="flex items-center justify-between px-4 py-4 border-b border-neutral-800 sticky top-0 bg-neutral-950 z-10">
          <h2 className="font-bold truncate">{detail?.name || 'Contato'}</h2>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-300 flex-shrink-0">✕</button>
        </div>

        {loading && <div className="p-4 text-sm text-neutral-500">Carregando...</div>}

        {error && (
          <div className="mx-4 mt-3 rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {detail && !loading && (
          <div className="p-4 space-y-5">
            <div>
              <label className="block text-xs text-neutral-500 mb-1">Estágio</label>
              <select
                value={detail.stageId}
                onChange={e => handleMove(e.target.value)}
                disabled={moving}
                className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm focus:outline-none focus:border-emerald-600"
              >
                {stages.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              {currentStage?.isLost && (
                <input
                  type="text"
                  value={lostReason}
                  onChange={e => setLostReason(e.target.value)}
                  placeholder="Motivo da perda (opcional)"
                  className="mt-2 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm placeholder:text-neutral-600 focus:outline-none focus:border-emerald-600"
                />
              )}
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-neutral-500 mb-1">Nome</label>
                <input value={name} onChange={e => setName(e.target.value)}
                  className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm focus:outline-none focus:border-emerald-600" />
              </div>
              <div>
                <label className="block text-xs text-neutral-500 mb-1">Telefone</label>
                <input value={phone} onChange={e => setPhone(e.target.value)}
                  placeholder="Só números, com DDD (ex: 11987654321)"
                  className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm placeholder:text-neutral-600 focus:outline-none focus:border-emerald-600" />
                {phone.replace(/\D/g, '').length >= 10 && (
                  <div className="mt-1 text-[11px] text-neutral-600">{formatPhone(phone)}</div>
                )}
              </div>
              <div>
                <label className="block text-xs text-neutral-500 mb-1">E-mail</label>
                <input value={email} onChange={e => setEmail(e.target.value)} type="email"
                  className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm focus:outline-none focus:border-emerald-600" />
              </div>
              <div>
                <label className="block text-xs text-neutral-500 mb-1">Empresa</label>
                <input value={company} onChange={e => setCompany(e.target.value)}
                  className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm focus:outline-none focus:border-emerald-600" />
              </div>
              <div>
                <label className="block text-xs text-neutral-500 mb-1">Valor estimado (R$)</label>
                <input value={value} onChange={e => setValue(e.target.value)} type="number" min="0" step="0.01"
                  className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm focus:outline-none focus:border-emerald-600" />
                {value.trim() !== '' && !isNaN(Number(value)) && (
                  <div className="mt-1 text-[11px] text-neutral-600">{formatBrl(Number(value))}</div>
                )}
              </div>
              <div>
                <label className="block text-xs text-neutral-500 mb-1">Tags (separadas por vírgula)</label>
                <input value={tags} onChange={e => setTags(e.target.value)}
                  className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm focus:outline-none focus:border-emerald-600" />
              </div>
              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>

            <div className="border-t border-neutral-800 pt-4">
              <h3 className="text-sm font-medium mb-3">Linha do tempo</h3>
              <div className="space-y-2 mb-4">
                {detail.activities.length === 0 && (
                  <div className="text-xs text-neutral-600">Nenhuma atividade ainda.</div>
                )}
                {detail.activities.map((a: CrmActivity) => (
                  <div key={a.id} className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-neutral-400">
                        {ACTIVITY_ICON[a.type] || '•'} {ACTIVITY_LABEL[a.type] || a.type}
                      </span>
                      <span className="text-[11px] text-neutral-600">{relativeTime(a.createdAt)}</span>
                    </div>
                    <div className="text-sm mt-1">{a.content}</div>
                    {a.type === 'reminder' && a.dueAt && (
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className={`text-[11px] ${a.completedAt ? 'text-neutral-600' : 'text-amber-400'}`}>
                          {a.completedAt ? 'Concluído' : `Vence ${relativeTime(a.dueAt)}`}
                        </span>
                        {!a.completedAt && (
                          <button
                            onClick={() => handleCompleteActivity(a.id)}
                            className="rounded border border-neutral-700 px-2 py-0.5 text-[11px] text-neutral-300 hover:border-emerald-600 hover:text-emerald-400"
                          >
                            Concluir
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 space-y-2">
                <select
                  value={actType}
                  onChange={e => setActType(e.target.value as ActivityFormType)}
                  className="w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm focus:outline-none focus:border-emerald-600"
                >
                  <option value="note">📝 Nota</option>
                  <option value="call">📞 Ligação</option>
                  <option value="meeting">🤝 Reunião</option>
                  <option value="reminder">⏰ Lembrete</option>
                </select>
                <textarea
                  value={actContent}
                  onChange={e => setActContent(e.target.value)}
                  placeholder="Descreva..."
                  rows={2}
                  className="w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm placeholder:text-neutral-600 focus:outline-none focus:border-emerald-600"
                />
                {actType === 'reminder' && (
                  <input
                    type="datetime-local"
                    value={actDueAt}
                    onChange={e => setActDueAt(e.target.value)}
                    className="w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm focus:outline-none focus:border-emerald-600"
                  />
                )}
                <button
                  onClick={handleAddActivity}
                  disabled={addingActivity || !actContent.trim()}
                  className="w-full rounded bg-neutral-800 px-3 py-1.5 text-sm font-medium hover:bg-neutral-700 disabled:opacity-50"
                >
                  {addingActivity ? 'Adicionando...' : 'Adicionar'}
                </button>
              </div>
            </div>

            <div className="border-t border-neutral-800 pt-4">
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="w-full rounded-lg border border-red-900 px-3 py-2 text-sm text-red-400 hover:bg-red-950/50 disabled:opacity-50"
              >
                {deleting ? 'Excluindo...' : 'Excluir contato'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
