'use client';
import React, { useState } from 'react';
import { Banner, Button, TextArea, TextField } from '../../../_ui/ui';
import { parseTags } from '../../conhecimento/_kb';

export interface ArticleValues { title: string; question: string; answer: string; category: string; tags: string }

export const toValues = (a?: { title?: string; question?: string; answer?: string; category?: string | null; tags?: string[] } | null): ArticleValues => ({
  title: a?.title ?? '', question: a?.question ?? '', answer: a?.answer ?? '', category: a?.category ?? '', tags: (a?.tags ?? []).join(', '),
});

/** Corpo aceito pela API (mesmos limites do zod de /kb/articles). */
export const toPayload = (v: ArticleValues) => ({ title: v.title.trim(), question: v.question.trim(), answer: v.answer.trim(), category: v.category.trim() || null, tags: parseTags(v.tags) });

/** Formulário de artigo (criar, editar, aceitar sugestão). Valida no cliente com as mesmas regras do servidor. */
export function ArticleForm({ id, initial, categories = [], busy, error, submitLabel, onSubmit, onCancel, children, answerHint }: {
  id: string; initial: ArticleValues; categories?: string[]; busy?: boolean; error?: string | null; submitLabel: string;
  onSubmit: (v: ArticleValues) => void | Promise<void>; onCancel?: () => void; children?: React.ReactNode; answerHint?: string;
}) {
  const [v, setV] = useState<ArticleValues>(initial);
  const [errs, setErrs] = useState<Partial<Record<keyof ArticleValues, string>>>({});
  const set = (k: keyof ArticleValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV((c) => ({ ...c, [k]: e.target.value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const er: typeof errs = {};
    if (v.title.trim().length < 3) er.title = 'O título precisa de pelo menos 3 caracteres.';
    if (v.question.trim().length < 3) er.question = 'A pergunta precisa de pelo menos 3 caracteres.';
    if (v.answer.trim().length < 3) er.answer = 'A resposta precisa de pelo menos 3 caracteres.';
    if (parseTags(v.tags).some((t) => t.length > 40)) er.tags = 'Cada etiqueta pode ter no máximo 40 caracteres.';
    setErrs(er);
    if (Object.keys(er).length) return;
    void onSubmit(v);
  };

  return (
    <form id={id} onSubmit={submit} noValidate className="flex flex-col gap-3">
      <TextField label="Título" required maxLength={200} value={v.title} onChange={set('title')} error={errs.title} />
      <TextArea label="Pergunta" required maxLength={1000} value={v.question} onChange={set('question')} error={errs.question} hint="Como o cidadão costuma perguntar (até 1.000 caracteres)." />
      <TextArea label="Resposta" required maxLength={8000} value={v.answer} onChange={set('answer')} error={errs.answer} className="min-h-[180px]"
        hint={answerHint ?? 'Texto que o assistente e os atendentes usarão. Não inclua dados pessoais nem invente prazos ou valores.'} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Categoria" list={`${id}-cats`} maxLength={100} value={v.category} onChange={set('category')} />
        <datalist id={`${id}-cats`}>{categories.map((c) => <option key={c} value={c} />)}</datalist>
        <TextField label="Etiquetas" value={v.tags} onChange={set('tags')} error={errs.tags} hint="Separe por vírgula (até 20)." />
      </div>
      {children}
      {error && <Banner tone="danger">{error}</Banner>}
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && <Button variant="secondary" onClick={onCancel}>Cancelar</Button>}
        <Button type="submit" loading={busy}>{submitLabel}</Button>
      </div>
    </form>
  );
}
