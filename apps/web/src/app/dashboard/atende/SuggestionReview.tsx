'use client';
import { useState } from 'react';

/**
 * Revisão de sugestão gerada por IA (voz, foto ou histórico) — o dono do negócio
 * sempre confirma antes de qualquer coisa virar config/KB de verdade. Reusado por
 * config por voz, importação de KB (voz/foto) e sugestões geradas do histórico.
 */

export interface QaSuggestion {
  question: string;
  answer: string;
}

type SuggestionReviewProps =
  | {
      kind: 'text';
      title: string;
      description?: string;
      value: string;
      busy?: boolean;
      onAccept: (value: string) => void | Promise<void>;
      onReject: () => void;
    }
  | {
      kind: 'qa-list';
      title: string;
      description?: string;
      items: QaSuggestion[];
      busy?: boolean;
      onAccept: (items: QaSuggestion[]) => void | Promise<void>;
      onReject: () => void;
    };

export default function SuggestionReview(props: SuggestionReviewProps) {
  if (props.kind === 'text') return <TextSuggestion {...props} />;
  return <QaListSuggestion {...props} />;
}

function TextSuggestion(props: Extract<SuggestionReviewProps, { kind: 'text' }>) {
  const [text, setText] = useState(props.value);
  const [saving, setSaving] = useState(false);

  async function accept() {
    setSaving(true);
    try {
      await props.onAccept(text.trim());
    } finally {
      setSaving(false);
    }
  }

  const busy = saving || !!props.busy;

  return (
    <div className="rounded-xl border border-brand-primary/60 bg-brand-primary/20 p-5">
      <h3 className="font-medium text-brand-primary">{props.title}</h3>
      {props.description && <p className="text-xs text-brand-text-secondary mt-1 mb-3">{props.description}</p>}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        className="w-full rounded-lg border border-brand-border bg-brand-elevated px-3 py-2 text-sm text-brand-text focus:outline-none focus:border-brand-primary resize-y mt-3"
      />
      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={accept}
          disabled={busy || text.trim().length === 0}
          className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:bg-brand-primary disabled:opacity-50"
        >
          {saving ? 'Salvando…' : 'Usar esta sugestão'}
        </button>
        <button
          onClick={props.onReject}
          disabled={busy}
          className="rounded-lg border border-brand-border px-4 py-2 text-sm font-medium text-brand-text-secondary hover:border-brand-primary/30 disabled:opacity-50"
        >
          Descartar
        </button>
      </div>
    </div>
  );
}

function QaListSuggestion(props: Extract<SuggestionReviewProps, { kind: 'qa-list' }>) {
  const [items, setItems] = useState(
    props.items.map((it) => ({ ...it, included: true })),
  );
  const [saving, setSaving] = useState(false);

  function update(i: number, field: 'question' | 'answer', value: string) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, [field]: value } : it)));
  }

  function toggle(i: number) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, included: !it.included } : it)));
  }

  const selected = items.filter((it) => it.included);

  async function accept() {
    setSaving(true);
    try {
      await props.onAccept(selected.map(({ question, answer }) => ({ question: question.trim(), answer: answer.trim() })));
    } finally {
      setSaving(false);
    }
  }

  const busy = saving || !!props.busy;

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-brand-border bg-brand-surface p-5 text-center">
        <p className="text-brand-text-secondary text-sm">Nenhuma pergunta e resposta foi identificada.</p>
        <button onClick={props.onReject} className="text-xs text-brand-text-secondary hover:text-brand-text mt-2">
          Voltar
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-brand-primary/60 bg-brand-primary/20 p-5">
      <h3 className="font-medium text-brand-primary">{props.title}</h3>
      {props.description && <p className="text-xs text-brand-text-secondary mt-1 mb-3">{props.description}</p>}

      <div className="space-y-2.5 mt-3">
        {items.map((it, i) => (
          <div
            key={i}
            className={`rounded-lg border p-3 transition-colors ${
              it.included ? 'border-brand-border bg-brand-surface' : 'border-brand-border bg-brand-elevated/60 opacity-50'
            }`}
          >
            <div className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={it.included}
                onChange={() => toggle(i)}
                className="mt-1.5 h-3.5 w-3.5 accent-emerald-600 flex-shrink-0"
                title={it.included ? 'Incluir no salvamento' : 'Excluído do salvamento'}
              />
              <div className="flex-1 space-y-1.5">
                <input
                  type="text"
                  value={it.question}
                  onChange={(e) => update(i, 'question', e.target.value)}
                  disabled={!it.included}
                  maxLength={300}
                  className="w-full rounded-lg border border-brand-border bg-brand-elevated px-2.5 py-1.5 text-sm font-medium text-brand-text focus:outline-none focus:border-brand-primary disabled:opacity-60"
                />
                <textarea
                  value={it.answer}
                  onChange={(e) => update(i, 'answer', e.target.value)}
                  disabled={!it.included}
                  maxLength={2000}
                  rows={2}
                  className="w-full rounded-lg border border-brand-border bg-brand-elevated px-2.5 py-1.5 text-sm text-brand-text-secondary focus:outline-none focus:border-brand-primary resize-y disabled:opacity-60"
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 mt-4">
        <button
          onClick={accept}
          disabled={busy || selected.length === 0}
          className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:bg-brand-primary disabled:opacity-50"
        >
          {saving ? 'Salvando…' : `Salvar ${selected.length} ${selected.length === 1 ? 'item' : 'itens'}`}
        </button>
        <button
          onClick={props.onReject}
          disabled={busy}
          className="rounded-lg border border-brand-border px-4 py-2 text-sm font-medium text-brand-text-secondary hover:border-brand-primary/30 disabled:opacity-50"
        >
          Descartar tudo
        </button>
      </div>
    </div>
  );
}
