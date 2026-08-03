'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface Task {
  id: string;
  title: string;
  description: string | null;
  status: 'pending' | 'done';
  dueAt: string | null;
  completedAt: string | null;
  assignedToId: string | null;
  assignedTo: { id: string; name: string | null; email: string } | null;
  contactId: string | null;
  contact: { id: string; name: string; phone: string } | null;
  createdAt: string;
}

interface TeamMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  status: string;
}

interface CrmContactOption {
  id: string;
  name: string;
  phone: string;
}

interface TaskComment {
  id: string;
  content: string;
  createdAt: string;
  user: { id: string; name: string | null; email: string };
}

function isOverdue(t: Task): boolean {
  return t.status === 'pending' && !!t.dueAt && new Date(t.dueAt) < new Date();
}

export default function TarefasPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [contacts, setContacts] = useState<CrmContactOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notEntitled, setNotEntitled] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignedToId, setAssignedToId] = useState('');
  const [contactId, setContactId] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [openComments, setOpenComments] = useState<string | null>(null);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [commentText, setCommentText] = useState('');
  const [commentsLoading, setCommentsLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const [taskList, teamRes, contactsRes] = await Promise.all([
        api.get<Task[]>('/tarefas'),
        api.get<{ team: { members: TeamMember[] } | null }>('/teams/mine').catch(() => ({ team: null })),
        // CRM é opcional — quem só tem Tarefas (Empresas sempre tem os dois, mas por segurança) segue sem o seletor.
        api.get<CrmContactOption[]>('/crm/contacts?limit=200').catch(() => [] as CrmContactOption[]),
      ]);
      setTasks(taskList);
      setMembers((teamRes.team?.members || []).filter(m => m.status === 'active'));
      setContacts(Array.isArray(contactsRes) ? contactsRes : []);
      setError(null);
    } catch (e: any) {
      if (e?.moduleRequired) setNotEntitled(true);
      else setError(e?.message || 'Não foi possível carregar as tarefas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      await api.post('/tarefas', {
        title, description: description || undefined,
        assignedToId: assignedToId || undefined,
        contactId: contactId || undefined,
        dueAt: dueAt || undefined,
      });
      setTitle(''); setDescription(''); setAssignedToId(''); setContactId(''); setDueAt('');
      setShowNew(false);
      load();
    } catch (err: any) {
      setFormError(err?.message || 'Erro ao criar tarefa.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleComments(taskId: string) {
    if (openComments === taskId) { setOpenComments(null); return; }
    setOpenComments(taskId);
    setCommentsLoading(true);
    try {
      setComments(await api.get<TaskComment[]>(`/tarefas/${taskId}/comentarios`));
    } catch {
      setComments([]);
    } finally {
      setCommentsLoading(false);
    }
  }

  async function handleAddComment(taskId: string) {
    const content = commentText.trim();
    if (!content) return;
    try {
      const created = await api.post<TaskComment>(`/tarefas/${taskId}/comentarios`, { content });
      setComments(cur => [...cur, created]);
      setCommentText('');
    } catch { /* mantém o texto pro usuário tentar de novo */ }
  }

  async function toggleStatus(t: Task) {
    const next = t.status === 'done' ? 'pending' : 'done';
    setTasks(cur => cur.map(x => x.id === t.id ? { ...x, status: next } : x));
    try {
      await api.patch(`/tarefas/${t.id}`, { status: next });
    } catch {
      load(); // reverte em caso de erro
    }
  }

  async function handleDelete(id: string) {
    setTasks(cur => cur.filter(t => t.id !== id));
    try {
      await api.delete(`/tarefas/${id}`);
    } catch {
      load();
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center">
        <div className="text-neutral-500">Carregando...</div>
      </main>
    );
  }

  if (notEntitled) {
    return (
      <main className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center px-5 py-10">
        <div className="max-w-md w-full rounded-xl border border-neutral-800 bg-neutral-900 p-8 text-center">
          <div className="text-4xl mb-4">✅</div>
          <h1 className="text-xl font-bold mb-2">Tarefas</h1>
          <p className="text-neutral-400 mb-6">
            Designe tarefas pro time, acompanhe status e prazo — exclusivo do plano Empresas.
          </p>
          <Link href="/dashboard/plano" className="inline-block rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-500">
            Ver planos
          </Link>
          <div className="mt-4">
            <Link href="/app" className="text-sm text-neutral-500 hover:text-neutral-300">← Voltar aos módulos</Link>
          </div>
        </div>
      </main>
    );
  }

  const pending = tasks.filter(t => t.status === 'pending');
  const done = tasks.filter(t => t.status === 'done');

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="border-b border-neutral-800 bg-neutral-900/60 px-4 sm:px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/app" className="text-neutral-500 hover:text-neutral-300 text-sm">← Módulos</Link>
            <h1 className="text-lg font-bold flex items-center gap-2">✅ Tarefas</h1>
            <span className="text-xs text-neutral-500">{pending.length} pendente{pending.length !== 1 ? 's' : ''}</span>
          </div>
          <button
            onClick={() => setShowNew(true)}
            className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            + Nova tarefa
          </button>
        </div>
        {error && (
          <div className="mt-3 rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">{error}</div>
        )}
      </header>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        {showNew && (
          <form onSubmit={handleCreate} className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 mb-6 space-y-3">
            <input
              value={title} onChange={e => setTitle(e.target.value)} required maxLength={150}
              placeholder="Título da tarefa"
              className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
            />
            <textarea
              value={description} onChange={e => setDescription(e.target.value)} maxLength={2000} rows={2}
              placeholder="Descrição (opcional)"
              className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm resize-none"
            />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-neutral-500 mb-1">Responsável</label>
                <select
                  value={assignedToId} onChange={e => setAssignedToId(e.target.value)}
                  className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
                >
                  <option value="">Sem responsável</option>
                  {members.map(m => <option key={m.userId} value={m.userId}>{m.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-neutral-500 mb-1">Prazo (opcional)</label>
                <input
                  type="date" value={dueAt} onChange={e => setDueAt(e.target.value)}
                  className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
                />
              </div>
            </div>
            {contacts.length > 0 && (
              <div>
                <label className="block text-xs text-neutral-500 mb-1">Vincular a um contato do CRM (opcional)</label>
                <select
                  value={contactId} onChange={e => setContactId(e.target.value)}
                  className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
                >
                  <option value="">Nenhum</option>
                  {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
            {formError && (
              <div className="rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-xs text-red-300">{formError}</div>
            )}
            <div className="flex gap-2">
              <button type="submit" disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50">
                {saving ? 'Criando...' : 'Criar tarefa'}
              </button>
              <button type="button" onClick={() => setShowNew(false)} className="rounded-lg border border-neutral-800 px-4 py-2 text-sm text-neutral-400 hover:text-neutral-200">
                Cancelar
              </button>
            </div>
          </form>
        )}

        <h2 className="text-sm font-bold text-neutral-300 mb-3">Pendentes</h2>
        <div className="space-y-2 mb-8">
          {pending.length === 0 && (
            <div className="text-sm text-neutral-600 text-center py-6 rounded-xl border border-neutral-800">Nenhuma tarefa pendente.</div>
          )}
          {pending.map(t => (
            <div key={t.id} className={`rounded-lg border p-3 ${isOverdue(t) ? 'border-red-900 bg-red-950/20' : 'border-neutral-800 bg-neutral-900'}`}>
              <div className="flex items-start gap-3">
                <input type="checkbox" checked={false} onChange={() => toggleStatus(t)} className="mt-1" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{t.title}</div>
                  {t.description && <div className="text-xs text-neutral-500 mt-0.5">{t.description}</div>}
                  <div className="flex items-center gap-2 mt-1 text-[11px] text-neutral-500 flex-wrap">
                    {t.assignedTo && <span>👤 {t.assignedTo.name || t.assignedTo.email}</span>}
                    {t.contact && <span>🔗 {t.contact.name}</span>}
                    {t.dueAt && (
                      <span className={isOverdue(t) ? 'text-red-400 font-semibold' : ''}>
                        {isOverdue(t) ? '⚠ Atrasada — ' : '🗓️ '}{new Date(t.dueAt).toLocaleDateString('pt-BR')}
                      </span>
                    )}
                    <button onClick={() => toggleComments(t.id)} className="hover:text-neutral-300">💬 comentários</button>
                  </div>
                </div>
                <button onClick={() => handleDelete(t.id)} className="text-neutral-600 hover:text-red-400 text-xs shrink-0">✕</button>
              </div>
              {openComments === t.id && (
                <div className="mt-3 pl-7 space-y-2">
                  {commentsLoading ? (
                    <div className="text-xs text-neutral-600">Carregando...</div>
                  ) : (
                    <>
                      {comments.length === 0 && <div className="text-xs text-neutral-600">Nenhum comentário ainda.</div>}
                      {comments.map(c => (
                        <div key={c.id} className="text-xs">
                          <span className="font-medium text-neutral-300">{c.user.name || c.user.email}</span>{' '}
                          <span className="text-neutral-500">{c.content}</span>
                        </div>
                      ))}
                    </>
                  )}
                  <div className="flex gap-2">
                    <input
                      value={commentText} onChange={e => setCommentText(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleAddComment(t.id)}
                      maxLength={2000} placeholder="Escrever um comentário..."
                      className="flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1 text-xs"
                    />
                    <button onClick={() => handleAddComment(t.id)} className="text-xs text-emerald-400 hover:text-emerald-300 shrink-0">Enviar</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {done.length > 0 && (
          <>
            <h2 className="text-sm font-bold text-neutral-500 mb-3">Concluídas</h2>
            <div className="space-y-2">
              {done.map(t => (
                <div key={t.id} className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3 flex items-start gap-3 opacity-60">
                  <input type="checkbox" checked onChange={() => toggleStatus(t)} className="mt-1" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium line-through">{t.title}</div>
                    {t.assignedTo && <div className="text-[11px] text-neutral-500 mt-0.5">👤 {t.assignedTo.name || t.assignedTo.email}</div>}
                  </div>
                  <button onClick={() => handleDelete(t.id)} className="text-neutral-600 hover:text-red-400 text-xs shrink-0">✕</button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
