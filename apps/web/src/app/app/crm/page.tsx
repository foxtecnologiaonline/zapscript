'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { formatBrl } from '@/lib/modules';
import {
  CrmContact,
  StageWithContacts,
  ReminderItem,
  formatPhone,
  relativeTime,
  sumValue,
} from './lib';
import ContactDrawer from './ContactDrawer';
import NewContactModal from './NewContactModal';
import ImportModal from './ImportModal';

export default function CrmBoardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notEntitled, setNotEntitled] = useState(false);
  const [stages, setStages] = useState<StageWithContacts[]>([]);
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showReminders, setShowReminders] = useState(false);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [board, rem] = await Promise.all([
        api.get<{ stages: StageWithContacts[] }>('/crm/board'),
        api.get<ReminderItem[]>('/crm/reminders'),
      ]);
      setStages(board.stages);
      setReminders(rem);
      setError(null);
    } catch (e: any) {
      if (e?.moduleRequired) {
        setNotEntitled(true);
      } else if (typeof window !== 'undefined' && !localStorage.getItem('zs_token')) {
        // api.ts já limpou o token (401) mas só redireciona automaticamente em /dashboard/*
        router.push('/login');
      } else {
        setError(e?.message || 'Não foi possível carregar o CRM.');
      }
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { load(); }, [load]);

  const moveContact = useCallback(async (contactId: string, targetStageId: string) => {
    let prevStages: StageWithContacts[] = [];
    let didMove = false;
    setStages(current => {
      prevStages = current;
      let moved: CrmContact | undefined;
      const stripped = current.map(s => {
        const idx = s.contacts.findIndex(c => c.id === contactId);
        if (idx === -1) return s;
        moved = s.contacts[idx];
        return { ...s, contacts: s.contacts.filter(c => c.id !== contactId) };
      });
      if (!moved || moved.stageId === targetStageId) return current;
      didMove = true;
      const movedContact = moved;
      return stripped.map(s => s.id === targetStageId
        ? { ...s, contacts: [{ ...movedContact, stageId: targetStageId }, ...s.contacts] }
        : s);
    });
    if (!didMove) return;
    try {
      await api.patch(`/crm/contacts/${contactId}/move`, { stageId: targetStageId });
    } catch (e: any) {
      setStages(prevStages);
      setError(e?.message || 'Não foi possível mover o contato.');
    }
  }, []);

  const filteredStages = useMemo(() => {
    if (!search.trim()) return stages;
    const q = search.trim().toLowerCase();
    return stages.map(s => ({
      ...s,
      contacts: s.contacts.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        (c.company || '').toLowerCase().includes(q)
      ),
    }));
  }, [stages, search]);

  const totalContacts = useMemo(() => stages.reduce((n, s) => n + s.contacts.length, 0), [stages]);
  const pendingReminders = useMemo(() => reminders.filter(r => !r.completedAt), [reminders]);

  function handleContactChanged() {
    load();
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
          <div className="text-4xl mb-4">📊</div>
          <h1 className="text-xl font-bold mb-2">Módulo CRM</h1>
          <p className="text-neutral-400 mb-6">
            Organize seus leads em um funil visual direto do WhatsApp: estágios, notas, lembretes e importação automática de contatos.
          </p>
          <Link href="/dashboard/plano?add=crm" className="inline-block rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-500">
            Contratar módulo CRM
          </Link>
          <div className="mt-4">
            <Link href="/app" className="text-sm text-neutral-500 hover:text-neutral-300">← Voltar aos módulos</Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col">
      <header className="border-b border-neutral-800 bg-neutral-900/60 px-4 sm:px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/app" className="text-neutral-500 hover:text-neutral-300 text-sm">← Módulos</Link>
            <h1 className="text-lg font-bold flex items-center gap-2">📊 CRM</h1>
            <span className="text-xs text-neutral-500">{totalContacts} contato{totalContacts === 1 ? '' : 's'}</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar nome, telefone, empresa..."
              className="w-48 sm:w-64 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm placeholder:text-neutral-600 focus:outline-none focus:border-emerald-600"
            />
            <Link
              href="/app/crm/dashboard"
              className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm hover:border-neutral-700"
            >
              📈 Dashboard
            </Link>
            <button
              onClick={() => setShowReminders(true)}
              className="relative rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm hover:border-neutral-700"
              title="Lembretes"
            >
              🔔
              {pendingReminders.length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                  {pendingReminders.length > 9 ? '9+' : pendingReminders.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setShowImport(true)}
              className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm hover:border-neutral-700"
            >
              Importar do WhatsApp
            </button>
            <button
              onClick={() => setShowNew(true)}
              className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              + Novo contato
            </button>
          </div>
        </div>
        {error && (
          <div className="mt-3 rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}
      </header>

      <div className="flex-1 overflow-x-auto px-4 sm:px-6 py-5">
        <div className="flex gap-4 min-w-max h-full">
          {filteredStages.map(stage => (
            <div
              key={stage.id}
              onDragOver={e => { e.preventDefault(); setDragOverStage(stage.id); }}
              onDragLeave={() => setDragOverStage(current => current === stage.id ? null : current)}
              onDrop={e => {
                e.preventDefault();
                setDragOverStage(null);
                const contactId = e.dataTransfer.getData('text/plain');
                if (contactId) moveContact(contactId, stage.id);
              }}
              className={`w-72 flex-shrink-0 flex flex-col rounded-xl border bg-neutral-900/40 ${
                dragOverStage === stage.id ? 'border-emerald-600' : 'border-neutral-800'
              }`}
            >
              <div className="flex items-center justify-between px-3 py-3 border-b border-neutral-800">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: stage.color }} />
                  <span className="font-medium text-sm truncate">{stage.name}</span>
                  <span className="text-xs text-neutral-500 flex-shrink-0">{stage.contacts.length}</span>
                </div>
              </div>
              {sumValue(stage.contacts) > 0 && (
                <div className="px-3 pt-2 text-xs text-neutral-500">{formatBrl(sumValue(stage.contacts))}</div>
              )}
              <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2 min-h-[120px]">
                {stage.contacts.length === 0 && (
                  <div className="text-xs text-neutral-600 text-center py-6">Nenhum contato</div>
                )}
                {stage.contacts.map(contact => (
                  <div
                    key={contact.id}
                    draggable
                    onDragStart={e => {
                      e.dataTransfer.setData('text/plain', contact.id);
                      setDraggingId(contact.id);
                    }}
                    onDragEnd={() => setDraggingId(null)}
                    onClick={() => setSelectedId(contact.id)}
                    className={`cursor-pointer rounded-lg border border-neutral-800 bg-neutral-900 p-3 hover:border-neutral-700 transition-colors ${
                      draggingId === contact.id ? 'opacity-40' : ''
                    }`}
                  >
                    <div className="font-medium text-sm truncate">{contact.name}</div>
                    <div className="text-xs text-neutral-500 mt-0.5">{formatPhone(contact.phone)}</div>
                    {contact.company && (
                      <div className="text-xs text-neutral-500 truncate">{contact.company}</div>
                    )}
                    {contact.value != null && (
                      <div className="text-xs text-emerald-400 mt-1 font-medium">{formatBrl(contact.value)}</div>
                    )}
                    <div className="text-[11px] text-neutral-600 mt-1">{relativeTime(contact.lastActivityAt)}</div>
                    <select
                      value={contact.stageId}
                      onChange={e => moveContact(contact.id, e.target.value)}
                      onClick={e => e.stopPropagation()}
                      className="mt-2 w-full rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-[11px] text-neutral-400 focus:outline-none focus:border-emerald-600"
                    >
                      {stages.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {selectedId && (
        <ContactDrawer
          contactId={selectedId}
          stages={stages}
          onClose={() => setSelectedId(null)}
          onChanged={handleContactChanged}
        />
      )}
      {showNew && (
        <NewContactModal
          stages={stages}
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); load(); }}
        />
      )}
      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); load(); }}
        />
      )}
      {showReminders && (
        <div
          className="fixed inset-0 z-[100] flex justify-end"
          style={{ background: 'rgba(4,11,9,0.72)', backdropFilter: 'blur(4px)' }}
          onClick={() => setShowReminders(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="h-full w-full sm:w-[380px] bg-neutral-950 border-l border-neutral-800 overflow-y-auto"
          >
            <div className="flex items-center justify-between px-4 py-4 border-b border-neutral-800">
              <h2 className="font-bold">Lembretes</h2>
              <button onClick={() => setShowReminders(false)} className="text-neutral-500 hover:text-neutral-300">✕</button>
            </div>
            <div className="p-4 space-y-2">
              {reminders.length === 0 && (
                <div className="text-sm text-neutral-600 text-center py-8">Nenhum lembrete pendente.</div>
              )}
              {reminders.map(r => (
                <button
                  key={r.id}
                  onClick={() => { setSelectedId(r.contact.id); setShowReminders(false); }}
                  className="w-full text-left rounded-lg border border-neutral-800 bg-neutral-900 p-3 hover:border-neutral-700"
                >
                  <div className="font-medium text-sm">{r.contact.name}</div>
                  <div className="text-xs text-neutral-500 mt-0.5">{formatPhone(r.contact.phone)}</div>
                  <div className="text-xs text-neutral-400 mt-1">{r.content}</div>
                  {r.dueAt && (
                    <div className="text-[11px] text-amber-400 mt-1">{relativeTime(r.dueAt)}</div>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
