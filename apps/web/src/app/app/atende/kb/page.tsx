'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import AtendeHeader from '../AtendeHeader';

interface KbEntry {
  id: string;
  question: string;
  answer: string;
  active: boolean;
  createdAt: string;
}

export default function AtendeKbPage() {
  const [entries, setEntries] = useState<KbEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQuestion, setEditQuestion] = useState('');
  const [editAnswer, setEditAnswer] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  function load() {
    setLoading(true);
    api.get<KbEntry[]>('/atende/kb')
      .then(setEntries)
      .catch((e) => setError(e?.message || 'Não foi possível carregar a base de conhecimento.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (question.trim().length < 3) {
      setFormError('Pergunta muito curta.');
      return;
    }
    if (answer.trim().length < 1) {
      setFormError('Resposta é obrigatória.');
      return;
    }
    setAdding(true);
    try {
      const entry = await api.post<KbEntry>('/atende/kb', { question: question.trim(), answer: answer.trim() });
      setEntries((es) => [entry, ...es]);
      setQuestion('');
      setAnswer('');
    } catch (e: any) {
      setFormError(e?.message || 'Não foi possível adicionar.');
    } finally {
      setAdding(false);
    }
  }

  async function handleToggleActive(entry: KbEntry) {
    const next = !entry.active;
    setEntries((es) => es.map((e) => (e.id === entry.id ? { ...e, active: next } : e)));
    try {
      await api.put(`/atende/kb/${entry.id}`, { active: next });
    } catch {
      setEntries((es) => es.map((e) => (e.id === entry.id ? { ...e, active: !next } : e)));
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Excluir este item da base de conhecimento?')) return;
    const prev = entries;
    setEntries((es) => es.filter((e) => e.id !== id));
    try {
      await api.delete(`/atende/kb/${id}`);
    } catch (e: any) {
      setEntries(prev);
      alert(e?.message || 'Não foi possível excluir.');
    }
  }

  function startEdit(entry: KbEntry) {
    setEditingId(entry.id);
    setEditQuestion(entry.question);
    setEditAnswer(entry.answer);
  }

  async function handleSaveEdit(id: string) {
    if (editQuestion.trim().length < 3 || editAnswer.trim().length < 1) return;
    setSavingEdit(true);
    try {
      const updated = await api.put<KbEntry>(`/atende/kb/${id}`, {
        question: editQuestion.trim(),
        answer: editAnswer.trim(),
      });
      setEntries((es) => es.map((e) => (e.id === id ? updated : e)));
      setEditingId(null);
    } catch (e: any) {
      alert(e?.message || 'Não foi possível salvar.');
    } finally {
      setSavingEdit(false);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 px-5 py-10">
      <div className="max-w-2xl mx-auto">
        <AtendeHeader />

        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5 mb-6">
          <h2 className="font-medium mb-1">Adicionar pergunta e resposta</h2>
          <p className="text-xs text-neutral-500 mb-4">
            A IA usa essas respostas como referência antes de responder um cliente.
          </p>
          <form onSubmit={handleAdd} className="space-y-3">
            <div>
              <input
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                maxLength={300}
                placeholder="Pergunta (ex: Qual o horário de funcionamento?)"
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                maxLength={2000}
                rows={3}
                placeholder="Resposta (ex: Funcionamos de segunda a sábado, das 8h às 18h.)"
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 resize-y"
              />
            </div>
            {formError && <p className="text-sm text-red-400">{formError}</p>}
            <button
              type="submit"
              disabled={adding}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {adding ? 'Adicionando…' : 'Adicionar'}
            </button>
          </form>
        </div>

        {error && (
          <div className="mb-5 rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-red-200 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-neutral-500 text-sm">Carregando…</p>
        ) : entries.length === 0 ? (
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-8 text-center">
            <p className="text-neutral-300 font-medium">Nenhum item ainda.</p>
            <p className="text-neutral-500 text-sm mt-2">
              Adicione perguntas frequentes acima para deixar a IA mais precisa.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {entries.map((entry) => (
              <div key={entry.id} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                {editingId === entry.id ? (
                  <div className="space-y-2.5">
                    <input
                      type="text"
                      value={editQuestion}
                      onChange={(e) => setEditQuestion(e.target.value)}
                      maxLength={300}
                      className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                    />
                    <textarea
                      value={editAnswer}
                      onChange={(e) => setEditAnswer(e.target.value)}
                      maxLength={2000}
                      rows={3}
                      className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 resize-y"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleSaveEdit(entry.id)}
                        disabled={savingEdit}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                      >
                        {savingEdit ? 'Salvando…' : 'Salvar'}
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:border-neutral-600"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <p className={`font-medium ${!entry.active ? 'text-neutral-500' : ''}`}>{entry.question}</p>
                      <button
                        role="switch"
                        aria-checked={entry.active}
                        onClick={() => handleToggleActive(entry)}
                        className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                          entry.active ? 'bg-emerald-600' : 'bg-neutral-700'
                        }`}
                        title={entry.active ? 'Ativo — clique para desativar' : 'Inativo — clique para ativar'}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                            entry.active ? 'translate-x-5' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>
                    <p className={`text-sm mt-1 whitespace-pre-wrap ${!entry.active ? 'text-neutral-600' : 'text-neutral-400'}`}>
                      {entry.answer}
                    </p>
                    <div className="flex items-center gap-3 mt-3">
                      <button
                        onClick={() => startEdit(entry)}
                        className="text-xs text-neutral-400 hover:text-neutral-200"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => handleDelete(entry.id)}
                        className="text-xs text-red-400 hover:text-red-300"
                      >
                        Excluir
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
