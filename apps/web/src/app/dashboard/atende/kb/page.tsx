'use client';
import { useEffect, useRef, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import AtendeHeader from '../AtendeHeader';
import VoiceRecorder from '../VoiceRecorder';
import SuggestionReview, { QaSuggestion } from '../SuggestionReview';
import { NICHE_TEMPLATES } from '../nicheTemplates';

interface KbEntry {
  id: string;
  question: string;
  answer: string;
  active: boolean;
  createdAt: string;
}

function AtendeKbContent() {
  const searchParams = useSearchParams();
  const templateKey = searchParams.get('template');
  const fromHistory = searchParams.get('fromHistory');
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

  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuggestion, setImportSuggestion] = useState<QaSuggestion[] | null>(null);
  const [importSourceLabel, setImportSourceLabel] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  function load() {
    setLoading(true);
    api.get<KbEntry[]>('/atende/kb')
      .then(setEntries)
      .catch((e) => setError(e?.message || 'Não foi possível carregar a base de conhecimento.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!templateKey) return;
    const template = NICHE_TEMPLATES.find((t) => t.key === templateKey);
    if (template && template.kb.length > 0) {
      setImportSuggestion(template.kb);
      setImportSourceLabel(template.label);
    }
  }, [templateKey]);

  useEffect(() => {
    if (!fromHistory) return;
    const raw = sessionStorage.getItem('atende_kb_from_history');
    sessionStorage.removeItem('atende_kb_from_history');
    if (!raw) return;
    try {
      const items = JSON.parse(raw);
      if (Array.isArray(items) && items.length > 0) {
        setImportSuggestion(items);
        setImportSourceLabel('Histórico de conversas');
      }
    } catch {
      // ignora payload inválido
    }
  }, [fromHistory]);

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

  async function handleImportUpload(blob: Blob, filename: string) {
    setImportError(null);
    setImportSuggestion(null);
    setImportSourceLabel(null);
    setImportBusy(true);
    try {
      const formData = new FormData();
      formData.append('file', blob, filename);
      const res = await api.postFormData<{ rawText: string; items: QaSuggestion[] }>(
        '/atende/setup/kb-import',
        formData,
      );
      if (res.items.length === 0) {
        setImportError('Não consegui identificar perguntas e respostas nesse conteúdo.');
      } else {
        setImportSuggestion(res.items);
      }
    } catch (e: any) {
      setImportError(e?.message || 'Não foi possível processar o arquivo. Tente novamente.');
    } finally {
      setImportBusy(false);
    }
  }

  async function handleAcceptImport(items: QaSuggestion[]) {
    const created: KbEntry[] = [];
    let failed = 0;
    for (const item of items) {
      try {
        created.push(await api.post<KbEntry>('/atende/kb', item));
      } catch {
        failed++;
      }
    }
    setEntries((es) => [...created, ...es]);
    setImportSuggestion(null);
    setImportSourceLabel(null);
    if (failed > 0) {
      alert(`${failed} ${failed === 1 ? 'item não foi salvo' : 'itens não foram salvos'}. Tente adicionar manualmente.`);
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
    <div className="p-4 sm:p-8 max-w-5xl">
      <div className="max-w-2xl mx-auto">
        <AtendeHeader />

        <div className="rounded-xl border border-brand-border bg-brand-surface p-5 mb-6">
          <h2 className="font-medium mb-1">Adicionar pergunta e resposta</h2>
          <p className="text-xs text-brand-muted mb-4">
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
                className="w-full rounded-lg border border-brand-border bg-brand-elevated px-3 py-2 text-sm focus:outline-none focus:border-brand-primary"
              />
            </div>
            <div>
              <textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                maxLength={2000}
                rows={3}
                placeholder="Resposta (ex: Funcionamos de segunda a sábado, das 8h às 18h.)"
                className="w-full rounded-lg border border-brand-border bg-brand-elevated px-3 py-2 text-sm focus:outline-none focus:border-brand-primary resize-y"
              />
            </div>
            {formError && <p className="text-sm text-red-400">{formError}</p>}
            <button
              type="submit"
              disabled={adding}
              className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:bg-brand-primary disabled:opacity-50"
            >
              {adding ? 'Adicionando…' : 'Adicionar'}
            </button>
          </form>
        </div>

        <div className="rounded-xl border border-brand-border bg-brand-surface p-5 mb-6">
          <h2 className="font-medium mb-1">Importar em massa</h2>
          <p className="text-xs text-brand-muted mb-4">
            Grave um áudio contando as perguntas e respostas mais comuns, ou envie uma foto de um
            cardápio ou tabela de preços — a IA organiza tudo em pares de pergunta e resposta pra
            você revisar antes de salvar.
          </p>

          <div className="flex items-center gap-3 flex-wrap">
            <VoiceRecorder
              onRecorded={(blob) => handleImportUpload(blob, 'kb-import.webm')}
              disabled={importBusy}
            />
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              ref={photoInputRef}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImportUpload(file, file.name);
                e.target.value = '';
              }}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              disabled={importBusy}
              className="rounded-lg border border-brand-border px-4 py-2 text-sm font-medium text-brand-text hover:border-brand-primary/30 disabled:opacity-50"
            >
              Enviar foto
            </button>
            {importBusy && <span className="text-xs text-brand-text-secondary">Processando…</span>}
          </div>

          {importError && <p className="text-xs text-red-400 mt-3">{importError}</p>}

          {importSuggestion && (
            <div className="mt-4">
              <SuggestionReview
                kind="qa-list"
                title={importSourceLabel ? `Perguntas prontas — ${importSourceLabel}` : 'Itens identificados'}
                description="Revise, edite ou desmarque antes de salvar."
                items={importSuggestion}
                onAccept={handleAcceptImport}
                onReject={() => {
                  setImportSuggestion(null);
                  setImportSourceLabel(null);
                }}
              />
            </div>
          )}
        </div>

        {error && (
          <div className="mb-5 rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-red-400 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-brand-muted text-sm">Carregando…</p>
        ) : entries.length === 0 ? (
          <div className="rounded-xl border border-brand-border bg-brand-surface p-8 text-center">
            <p className="text-brand-text-secondary font-medium">Nenhum item ainda.</p>
            <p className="text-brand-muted text-sm mt-2">
              Adicione perguntas frequentes acima para deixar a IA mais precisa.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {entries.map((entry) => (
              <div key={entry.id} className="rounded-xl border border-brand-border bg-brand-surface p-4">
                {editingId === entry.id ? (
                  <div className="space-y-2.5">
                    <input
                      type="text"
                      value={editQuestion}
                      onChange={(e) => setEditQuestion(e.target.value)}
                      maxLength={300}
                      className="w-full rounded-lg border border-brand-border bg-brand-elevated px-3 py-2 text-sm focus:outline-none focus:border-brand-primary"
                    />
                    <textarea
                      value={editAnswer}
                      onChange={(e) => setEditAnswer(e.target.value)}
                      maxLength={2000}
                      rows={3}
                      className="w-full rounded-lg border border-brand-border bg-brand-elevated px-3 py-2 text-sm focus:outline-none focus:border-brand-primary resize-y"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleSaveEdit(entry.id)}
                        disabled={savingEdit}
                        className="rounded-lg bg-brand-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-primary disabled:opacity-50"
                      >
                        {savingEdit ? 'Salvando…' : 'Salvar'}
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="rounded-lg border border-brand-border px-3 py-1.5 text-xs font-medium text-brand-text-secondary hover:border-brand-primary/30"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <p className={`font-medium ${!entry.active ? 'text-brand-muted' : ''}`}>{entry.question}</p>
                      <button
                        role="switch"
                        aria-checked={entry.active}
                        onClick={() => handleToggleActive(entry)}
                        className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                          entry.active ? 'bg-brand-primary' : 'bg-brand-border'
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
                    <p className={`text-sm mt-1 whitespace-pre-wrap ${!entry.active ? 'text-brand-muted' : 'text-brand-text-secondary'}`}>
                      {entry.answer}
                    </p>
                    <div className="flex items-center gap-3 mt-3">
                      <button
                        onClick={() => startEdit(entry)}
                        className="text-xs text-brand-text-secondary hover:text-brand-text"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => handleDelete(entry.id)}
                        className="text-xs text-red-400 hover:text-red-400"
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
    </div>
  );
}

export default function AtendeKbPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-brand-elevated" />}>
      <AtendeKbContent />
    </Suspense>
  );
}
