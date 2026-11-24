'use client';
import React, { useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { errMsg } from '@/lib/balcao/api';
import { emitSocket } from '@/lib/balcao/socket';
import { Badge, Banner, Button, Spinner, cx, useToast } from '../../_ui/ui';
import { ClipIcon, LockIcon, SparkIcon } from './Icons';
import { GOVBR_PLACEHOLDER, filterCanned, findSlashToken, humanSize, replaceRange } from './lib';
import { api } from './service';
import type { Attachment, CannedResponse, ChatMessage, Channel, ComposerHandle, Suggestion } from './types';

const MAX_TEXT = 4096;
const MAX_FILE = 15 * 1024 * 1024;
const ACCEPT = '.jpg,.jpeg,.png,.gif,.webp,.pdf,.txt,.csv,.ogg,.mp3,.m4a,.aac,.amr,.wav,.weba,.mp4,.webm,.3gp,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods';

/** Rascunhos sobrevivem à troca de conversa (módulo, não estado do componente). */
const DRAFTS = new Map<string, { text: string; note: boolean }>();

interface Pending { uid: string; name: string; size: number; state: 'uploading' | 'ready' | 'error'; att?: Attachment; error?: string }

interface Props {
  conversationId: string; channel: Channel; token: string | null;
  /** Pode enviar ao cidadão (responsável ou supervisão, conversa aberta). */
  canReply: boolean; canNote: boolean; canAi: boolean;
  waWindowClosed: boolean; canTemplate: boolean; onOpenTemplate: () => void;
  canned: CannedResponse[] | null; cannedLoading: boolean; onNeedCanned: () => void;
  suggestion: Suggestion | null; suggestionBusy: boolean; onSuggest: () => void; onDismissSuggestion: () => void;
  onSent: (m: ChatMessage, delivery: { status: string; error: string | null } | null) => void;
  handleRef: React.Ref<ComposerHandle>;
}

export function Composer(p: Props) {
  const toast = useToast();
  const uid = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const draft = DRAFTS.get(p.conversationId);
  const [text, setText] = useState(draft?.text ?? '');
  const [note, setNote] = useState(p.canReply ? draft?.note ?? false : true);
  const [pending, setPending] = useState<Pending[]>([]);
  const [sending, setSending] = useState(false);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const typingAt = useRef(0);

  const noteMode = note || !p.canReply;
  const textRef = useRef(text); textRef.current = text;
  const noteRef = useRef(noteMode); noteRef.current = noteMode;
  useEffect(() => () => { DRAFTS.set(p.conversationId, { text: textRef.current, note: noteRef.current }); }, [p.conversationId]);
  useEffect(() => { if (!p.canReply) setNote(true); }, [p.canReply]);

  // ── respostas prontas ──
  const token = useMemo(() => findSlashToken(text, caret), [text, caret]);
  const tokenKey = token ? `${token.start}:${token.query}` : null;
  const matches = useMemo(() => (token && p.canned ? filterCanned(p.canned, token.query) : []), [token, p.canned]);
  const popupOpen = !!token && dismissedKey !== tokenKey;
  const listId = `${uid}-canned`;
  useEffect(() => { if (token && p.canned == null && !p.cannedLoading) p.onNeedCanned(); }, [token, p]);
  useEffect(() => { setActive(0); }, [tokenKey]);

  const setCaretFromEl = () => setCaret(area.current?.selectionStart ?? 0);
  const place = useCallback((next: string, pos: number) => {
    setText(next); setCaret(pos);
    requestAnimationFrame(() => { const el = area.current; if (el) { el.focus(); el.setSelectionRange(pos, pos); } });
  }, []);

  const pick = (c: CannedResponse) => {
    if (!token) return;
    const r = replaceRange(text, token.start, token.end, c.body);
    place(r.text.slice(0, MAX_TEXT), Math.min(r.caret, MAX_TEXT));
  };

  const insertText = useCallback((t: string, mode?: 'reply' | 'note') => {
    if (mode === 'note') setNote(true); else if (mode === 'reply' && p.canReply) setNote(false);
    const cur = textRef.current;
    const next = cur.trim() ? `${cur.replace(/\s+$/, '')}\n\n${t}` : t;
    place(next.slice(0, MAX_TEXT), Math.min(next.length, MAX_TEXT));
  }, [p.canReply, place]);

  useImperativeHandle(p.handleRef, () => ({
    insert: insertText,
    focus(mode) {
      if (mode === 'note') setNote(true); else if (mode === 'reply' && p.canReply) setNote(false);
      requestAnimationFrame(() => area.current?.focus());
    },
  }), [insertText, p.canReply]);

  // ── anexos ──
  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    for (const file of Array.from(list)) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      if (file.size > MAX_FILE) { setPending((l) => [...l, { uid: id, name: file.name, size: file.size, state: 'error', error: 'Arquivo acima de 15 MB.' }]); continue; }
      setPending((l) => [...l, { uid: id, name: file.name, size: file.size, state: 'uploading' }]);
      try {
        const r = await api.uploadAttachment(p.conversationId, file);
        setPending((l) => l.map((x) => (x.uid === id ? { ...x, state: 'ready', att: r.attachment } : x)));
      } catch (e) {
        setPending((l) => l.map((x) => (x.uid === id ? { ...x, state: 'error', error: errMsg(e, 'Falha no envio do arquivo.') } : x)));
      }
    }
    if (files.current) files.current.value = '';
  };

  const ready = pending.filter((x) => x.state === 'ready' && x.att).map((x) => x.att!);
  const uploading = pending.some((x) => x.state === 'uploading');
  const trimmed = text.trim();
  const canSend = !sending && !uploading && (noteMode ? !!trimmed : !!trimmed || ready.length > 0) && (p.canReply || noteMode) && p.canNote;

  const send = async () => {
    if (!canSend) return;
    if (!noteMode && trimmed.includes(GOVBR_PLACEHOLDER)) { toast.error(`Substitua o marcador ${GOVBR_PLACEHOLDER} pelo link antes de enviar.`); area.current?.focus(); return; }
    setSending(true);
    try {
      if (noteMode) {
        const r = await api.sendNote(p.conversationId, trimmed);
        p.onSent(r.message, null);
      } else {
        const r = await api.sendMessage(p.conversationId, { ...(trimmed ? { text: trimmed } : {}), ...(ready.length ? { attachments: ready } : {}) });
        p.onSent(r.message, r.delivery);
        if (r.delivery.error) toast.error(`Não foi possível entregar: ${r.delivery.error === 'whatsapp.outside_window' ? 'janela de 24 h do WhatsApp expirada. Envie um modelo aprovado.' : r.delivery.error}`);
      }
      setText(''); setCaret(0); setPending([]); DRAFTS.delete(p.conversationId);
      area.current?.focus();
    } catch (e) {
      toast.error(errMsg(e, 'Não foi possível enviar a mensagem.'));
    } finally { setSending(false); }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void send(); return; }
    if (popupOpen && matches.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % matches.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + matches.length) % matches.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(matches[active]); return; }
    }
    if (popupOpen && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDismissedKey(tokenKey); }
  };

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value); setCaret(e.target.selectionStart ?? 0);
    if (p.channel === 'WEBCHAT' && !noteMode && Date.now() - typingAt.current > 3000) { typingAt.current = Date.now(); emitSocket(p.token, 'typing', p.conversationId); }
  };

  const insertSlash = () => {
    const el = area.current; const pos = el?.selectionStart ?? text.length;
    const sep = pos > 0 && !/\s$/.test(text.slice(0, pos)) ? ' ' : '';
    place(`${text.slice(0, pos)}${sep}/${text.slice(pos)}`, pos + sep.length + 1);
  };

  const sug = p.suggestion;
  const labelId = `${uid}-label`;
  const left = MAX_TEXT - text.length;

  return (
    <div className={cx('border-t border-bv-border p-3', noteMode ? 'bg-bv-warning-soft' : 'bg-bv-surface')}>
      {p.waWindowClosed && !noteMode && (
        <div className="mb-2">
          <Banner tone="warning" title="Janela de 24 h do WhatsApp expirada">
            O WhatsApp só permite mensagem livre até 24 h após a última mensagem do cidadão.{' '}
            {p.canTemplate ? <Button size="sm" variant="secondary" onClick={p.onOpenTemplate}>Enviar modelo aprovado</Button> : 'Peça a um supervisor para enviar um modelo aprovado.'}
          </Banner>
        </div>
      )}

      {sug && (
        <section aria-label="Sugestão da IA" className="mb-2 rounded-md border border-bv-primary bg-bv-primary-soft p-3 text-sm">
          <p className="mb-1 flex flex-wrap items-center gap-2 font-semibold"><SparkIcon />Sugestão da IA <Badge tone={sug.confidence >= 0.6 ? 'success' : 'warning'}>Confiança {Math.round(sug.confidence * 100)}%</Badge></p>
          <p className="mb-1 text-xs text-bv-muted">Rascunho: nada é enviado ao cidadão sem a sua revisão e confirmação.</p>
          <p className="whitespace-pre-wrap break-words">{sug.suggestion || 'A IA não encontrou base para sugerir uma resposta.'}</p>
          {sug.articles.length > 0 && <p className="mt-1 text-xs text-bv-muted">Base de conhecimento: {sug.articles.map((a) => a.title).join('; ')}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            {sug.suggestion && p.canReply && <Button size="sm" onClick={() => { insertText(sug.suggestion, 'reply'); p.onDismissSuggestion(); }}>Aceitar e editar no campo</Button>}
            <Button size="sm" variant="secondary" onClick={p.onDismissSuggestion}>Descartar</Button>
          </div>
        </section>
      )}

      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <label id={labelId} htmlFor={`${uid}-ta`} className="flex items-center gap-1 text-sm font-medium">
          {noteMode ? <><LockIcon /> Nota interna (não é enviada ao cidadão)</> : 'Resposta ao cidadão'}
        </label>
        {p.canReply && (
          <div role="group" aria-label="Tipo de mensagem" className="inline-flex overflow-hidden rounded-md border border-bv-border">
            <button type="button" aria-pressed={!noteMode} onClick={() => setNote(false)} className={cx('min-h-[32px] px-3 text-sm', !noteMode ? 'bg-bv-primary text-bv-primary-fg' : 'bg-bv-surface hover:bg-bv-subtle')}>Resposta</button>
            <button type="button" aria-pressed={noteMode} onClick={() => setNote(true)} className={cx('min-h-[32px] px-3 text-sm', noteMode ? 'bg-bv-primary text-bv-primary-fg' : 'bg-bv-surface hover:bg-bv-subtle')}>Nota interna</button>
          </div>
        )}
      </div>

      {!p.canReply && <p className="mb-1 text-xs text-bv-muted">Você não é o responsável por esta conversa: pode registrar notas internas, mas não responder ao cidadão.</p>}

      <div className="relative">
        {popupOpen && (
          <div className="absolute inset-x-0 bottom-full z-10 mb-1 max-h-56 overflow-y-auto rounded-md border border-bv-border bg-bv-surface shadow-lg">
            {p.canned == null ? <p className="flex items-center gap-2 p-3 text-sm"><Spinner size={14} label="Carregando respostas prontas" />Carregando respostas prontas…</p>
              : matches.length === 0 ? <p className="p-3 text-sm text-bv-muted">Nenhuma resposta pronta com “/{token?.query}”. Continue digitando ou apague a barra.</p>
                : (
                  <ul role="listbox" id={listId} aria-label="Respostas prontas">
                    {matches.map((c, i) => (
                      <li key={c.id} id={`${listId}-${i}`} role="option" aria-selected={i === active} onMouseDown={(e) => { e.preventDefault(); pick(c); }} onMouseEnter={() => setActive(i)}
                        className={cx('cursor-pointer border-b border-bv-border px-3 py-2 text-sm last:border-0', i === active && 'bg-bv-primary-soft')}>
                        <span className="font-mono font-semibold">/{c.shortcut}</span> <span className="font-medium">{c.title}</span>
                        <span className="block truncate text-xs text-bv-muted">{c.body}</span>
                      </li>
                    ))}
                  </ul>
                )}
          </div>
        )}
        <textarea id={`${uid}-ta`} ref={area} value={text} rows={3} maxLength={MAX_TEXT} readOnly={sending} disabled={!p.canNote}
          role="combobox" aria-expanded={popupOpen && matches.length > 0} aria-controls={popupOpen && matches.length ? listId : undefined} aria-autocomplete="list"
          aria-activedescendant={popupOpen && matches.length ? `${listId}-${active}` : undefined} aria-describedby={`${uid}-hint`}
          placeholder={noteMode ? 'Escreva uma nota para a equipe…' : 'Digite a resposta. Use /atalho para respostas prontas.'}
          onChange={onChange} onKeyDown={onKeyDown} onKeyUp={setCaretFromEl} onClick={setCaretFromEl} onSelect={setCaretFromEl}
          className="max-h-60 min-h-[88px] w-full resize-y rounded-md border border-bv-border bg-bv-surface px-3 py-2 text-bv-text placeholder:text-bv-muted disabled:opacity-60" />
      </div>
      <p id={`${uid}-hint`} className="mt-1 text-xs text-bv-muted">
        Ctrl+Enter (ou ⌘+Enter) envia. Digite “/” para respostas prontas.{left < 500 && <span className="font-medium"> Restam {left} caracteres.</span>}
      </p>
      <p role="status" className="bv-sr-only">{popupOpen && p.canned ? `${matches.length} respostas prontas disponíveis` : ''}</p>

      {pending.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1" aria-label="Anexos a enviar">
          {pending.map((a) => (
            <li key={a.uid} className="flex flex-wrap items-center gap-2 rounded-md border border-bv-border bg-bv-surface px-2 py-1 text-sm">
              <ClipIcon /><span className="break-all font-medium">{a.name}</span><span className="text-xs text-bv-muted">({humanSize(a.size)})</span>
              {a.state === 'uploading' && <span className="inline-flex items-center gap-1 text-xs"><Spinner size={12} label="" />Enviando arquivo…</span>}
              {a.state === 'ready' && <span className="text-xs text-bv-success">Pronto para enviar</span>}
              {a.state === 'error' && <span role="alert" className="text-xs text-bv-danger">{a.error}</span>}
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setPending((l) => l.filter((x) => x.uid !== a.uid))} aria-label={`Remover anexo ${a.name}`}>Remover</Button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input ref={files} type="file" multiple accept={ACCEPT} className="hidden" tabIndex={-1} aria-hidden="true" onChange={(e) => void upload(e.target.files)} />
        <Button variant="secondary" size="sm" disabled={noteMode || !p.canReply} onClick={() => files.current?.click()} aria-label="Anexar arquivo (até 15 MB)"><ClipIcon />Anexar</Button>
        <Button variant="secondary" size="sm" disabled={!p.canNote} onClick={insertSlash}>Respostas prontas</Button>
        {p.canAi && p.canReply && <Button variant="secondary" size="sm" loading={p.suggestionBusy} onClick={p.onSuggest}><SparkIcon />Sugerir resposta (IA)</Button>}
        <Button className="ml-auto" loading={sending} disabled={!canSend} onClick={() => void send()}>{noteMode ? 'Salvar nota' : 'Enviar'}</Button>
      </div>
    </div>
  );
}
