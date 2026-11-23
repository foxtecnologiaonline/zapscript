'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { bv, errMsg } from '@/lib/balcao/api';
import { useBvSession } from '@/lib/balcao/session';
import { fmtDate } from '@/lib/balcao/format';
import { Badge, Banner, Button, Card, Dialog, EmptyState, LoadMore, PageHeader, Select, Spinner, TextArea, TextField, useToast } from '../../_ui/ui';
import { ArticleMeta, copyText, parseTags, StatusBadge, type KbArticle, type KbListResponse } from './_kb';

interface Hit { id: string; title: string; question: string; category: string | null; tags: string[]; rank: number; snippet: string }

export default function ConhecimentoPage() {
  const { can } = useBvSession();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [tag, setTag] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [items, setItems] = useState<KbArticle[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [facets, setFacets] = useState<{ categories: string[]; tags: string[] }>({ categories: [], tags: [] });
  const [selId, setSelId] = useState<string | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const seq = useRef(0);

  const searching = q.trim().length > 0;

  // facetas (categorias e etiquetas) a partir dos artigos aprovados
  useEffect(() => {
    (async () => {
      try {
        const r = await bv.get<KbListResponse>('/kb/articles', { status: 'APPROVED', limit: 200 });
        setFacets({
          categories: Array.from(new Set(r.items.map((a) => a.category).filter((c): c is string => !!c))).sort((a, b) => a.localeCompare(b, 'pt-BR')),
          tags: Array.from(new Set(r.items.flatMap((a) => a.tags))).sort((a, b) => a.localeCompare(b, 'pt-BR')),
        });
      } catch { /* facetas são opcionais */ }
    })();
  }, []);

  // navegação por categoria/etiqueta (sem busca)
  const loadBrowse = useCallback(async (after?: string) => {
    const my = ++seq.current;
    if (after) setMoreLoading(true); else setLoading(true);
    setError(null);
    try {
      const r = await bv.get<KbListResponse>('/kb/articles', { status: 'APPROVED', category, tag, limit: 30, cursor: after });
      if (my !== seq.current) return;
      setItems((cur) => (after ? [...cur, ...r.items] : r.items)); setCursor(r.nextCursor);
    } catch (e) { if (my === seq.current) setError(errMsg(e, 'Não foi possível carregar os artigos.')); }
    finally { if (my === seq.current) { setLoading(false); setMoreLoading(false); } }
  }, [category, tag]);

  // busca em tempo real (com atraso de 300 ms)
  useEffect(() => {
    const term = q.trim();
    if (!term) { setHits(null); void loadBrowse(); return; }
    const my = ++seq.current;
    setLoading(true); setError(null);
    const t = setTimeout(async () => {
      try {
        const r = await bv.get<{ items: Hit[] }>('/kb/search', { q: term, limit: 20 });
        if (my !== seq.current) return;
        setHits(r.items);
      } catch (e) { if (my === seq.current) setError(errMsg(e, 'A busca falhou. Tente novamente.')); }
      finally { if (my === seq.current) setLoading(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q, loadBrowse]);

  const shownHits = (hits ?? []).filter((h) => (!category || h.category === category) && (!tag || h.tags.includes(tag)));
  const count = searching ? shownHits.length : items.length;

  return (
    <div>
      <PageHeader title="Base de conhecimento" subtitle="Respostas aprovadas pela curadoria. Busque, leia e copie a resposta para o atendimento."
        actions={can('kb:write') ? <Button onClick={() => setSuggestOpen(true)}>Sugerir artigo</Button> : undefined} />

      <div role="search" aria-label="Buscar na base de conhecimento" className="mb-4 grid gap-3 md:grid-cols-[2fr_1fr_1fr]">
        <TextField label="Buscar" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ex.: prazo para recurso, certidão, audiência"
          hint="A busca acontece enquanto você digita." autoComplete="off" />
        <Select label="Categoria" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Todas</option>
          {facets.categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
        <Select label="Etiqueta" value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">Todas</option>
          {facets.tags.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
      </div>

      <p role="status" aria-live="polite" className="bv-sr-only">
        {loading ? 'Carregando…' : error ? '' : `${count} ${count === 1 ? 'resultado' : 'resultados'}`}
      </p>

      <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section aria-label={searching ? 'Resultados da busca' : 'Artigos'} className="min-w-0">
          {error && <Banner tone="danger" title="Erro">{error}</Banner>}
          {loading && !error && <div className="p-6 text-center"><Spinner /></div>}
          {!loading && !error && count === 0 && (
            <EmptyState title={searching ? 'Nenhum artigo encontrado para esta busca.' : 'Nenhum artigo aprovado nesta seleção.'}>
              {searching ? 'Tente outras palavras ou remova os filtros.' : can('kb:write') ? 'Você pode sugerir um novo artigo.' : undefined}
            </EmptyState>
          )}
          {!loading && !error && count > 0 && (
            <>
              <p className="mb-2 text-sm text-bv-muted" aria-hidden="true">{count} {count === 1 ? 'resultado' : 'resultados'}{searching ? ` para “${q.trim()}”` : ''}</p>
              <ul className="flex flex-col gap-2">
                {(searching ? shownHits.map((h) => ({ id: h.id, title: h.title, text: h.snippet, category: h.category, tags: h.tags }))
                  : items.map((a) => ({ id: a.id, title: a.title, text: a.question, category: a.category, tags: a.tags }))).map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => setSelId(r.id)} aria-current={selId === r.id ? 'true' : undefined}
                      className={`block w-full rounded-lg border p-3 text-left hover:bg-bv-subtle ${selId === r.id ? 'border-bv-primary bg-bv-primary-soft' : 'border-bv-border bg-bv-surface'}`}>
                      <span className="block font-medium">{r.title}</span>
                      <span className="mt-1 line-clamp-2 block text-sm text-bv-muted">{r.text}</span>
                      <span className="mt-2 flex flex-wrap gap-1">
                        {r.category && <Badge tone="primary">{r.category}</Badge>}
                        {r.tags.slice(0, 4).map((t) => <Badge key={t}>{t}</Badge>)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {!searching && <LoadMore hasMore={!!cursor} loading={moreLoading} onClick={() => void loadBrowse(cursor!)} />}
            </>
          )}
        </section>

        <div className="min-w-0">
          {selId ? <ArticleReader id={selId} key={selId} /> : (
            <EmptyState title="Selecione um artigo para ler">A resposta completa, a versão e a data de revisão aparecem aqui.</EmptyState>
          )}
        </div>
      </div>

      <SuggestDialog open={suggestOpen} onClose={() => setSuggestOpen(false)} categories={facets.categories}
        onDone={(msg) => { toast.success(msg); setSuggestOpen(false); }} />
    </div>
  );
}

function ArticleReader({ id }: { id: string }) {
  const toast = useToast();
  const [a, setA] = useState<KbArticle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vote, setVote] = useState<'helpful' | 'unhelpful' | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const headRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let off = false;
    setA(null); setError(null);
    bv.get<KbArticle>(`/kb/articles/${id}`).then((r) => { if (!off) setA(r); }).catch((e) => { if (!off) setError(errMsg(e, 'Não foi possível abrir o artigo.')); });
    return () => { off = true; };
  }, [id]);
  useEffect(() => { if (a) headRef.current?.focus(); }, [a]);

  if (error) return <Banner tone="danger" title="Erro">{error}</Banner>;
  if (!a) return <div className="p-6 text-center"><Spinner /></div>;

  const copy = async () => {
    const ok = await copyText(a.answer);
    if (ok) { setCopied(true); toast.success('Resposta copiada.'); setTimeout(() => setCopied(false), 3000); }
    else toast.error('Não foi possível copiar. Selecione o texto e use Ctrl+C.');
  };
  const send = async (helpful: boolean) => {
    setBusy(true);
    try { await bv.post(`/kb/articles/${a.id}/feedback`, { helpful }); setVote(helpful ? 'helpful' : 'unhelpful'); toast.success('Obrigado pelo retorno.'); }
    catch (e) { toast.error(errMsg(e, 'Não foi possível registrar o retorno.')); }
    finally { setBusy(false); }
  };

  return (
    <article aria-labelledby={`art-${a.id}`} className="rounded-lg border border-bv-border bg-bv-surface p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <StatusBadge status={a.status} />
        {a.category && <Badge tone="primary">{a.category}</Badge>}
        {a.tags.map((t) => <Badge key={t}>{t}</Badge>)}
      </div>
      <h2 id={`art-${a.id}`} ref={headRef} tabIndex={-1} className="text-xl font-semibold outline-none">{a.title}</h2>
      <h3 className="mt-4 text-sm font-semibold text-bv-muted">Pergunta</h3>
      <p className="whitespace-pre-wrap">{a.question}</p>
      <h3 className="mt-4 text-sm font-semibold text-bv-muted">Resposta</h3>
      <div className="whitespace-pre-wrap rounded-md border border-bv-border bg-bv-subtle p-3" data-testid="kb-answer">{a.answer}</div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button onClick={copy}>{copied ? 'Resposta copiada' : 'Copiar resposta'}</Button>
        <span role="group" aria-label="Esta resposta foi útil?" className="flex items-center gap-2">
          <span className="text-sm">Esta resposta ajudou?</span>
          <Button variant="secondary" size="sm" disabled={busy || vote !== null} aria-pressed={vote === 'helpful'} onClick={() => void send(true)}>Foi útil</Button>
          <Button variant="secondary" size="sm" disabled={busy || vote !== null} aria-pressed={vote === 'unhelpful'} onClick={() => void send(false)}>Não foi útil</Button>
        </span>
      </div>
      {vote && <p role="status" className="mt-2 text-sm text-bv-muted">Retorno registrado: {vote === 'helpful' ? 'útil' : 'não útil'}.</p>}

      <div className="mt-4 border-t border-bv-border pt-3">
        <h3 className="mb-1 text-sm font-semibold">Informações do artigo</h3>
        <ArticleMeta a={a} />
        <p className="mt-1 text-xs text-bv-muted">Última revisão do conteúdo: {fmtDate(a.approvedAt ?? a.updatedAt)}.</p>
      </div>
    </article>
  );
}

function SuggestDialog({ open, onClose, onDone, categories }: { open: boolean; onClose: () => void; onDone: (msg: string) => void; categories: string[] }) {
  const [title, setTitle] = useState(''); const [question, setQuestion] = useState(''); const [answer, setAnswer] = useState('');
  const [category, setCategory] = useState(''); const [tags, setTags] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({}); const [formErr, setFormErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setTitle(''); setQuestion(''); setAnswer(''); setCategory(''); setTags(''); setErrs({}); setFormErr(null); } }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const er: Record<string, string> = {};
    if (title.trim().length < 3) er.title = 'Informe um título com pelo menos 3 caracteres.';
    if (question.trim().length < 3) er.question = 'Informe a pergunta (mínimo de 3 caracteres).';
    if (answer.trim().length < 3) er.answer = 'Informe a resposta (mínimo de 3 caracteres).';
    setErrs(er); setFormErr(null);
    if (Object.keys(er).length) return;
    setBusy(true);
    let createdId: string | null = null;
    try {
      const a = await bv.post<KbArticle>('/kb/articles', { title: title.trim(), question: question.trim(), answer: answer.trim(), category: category.trim() || null, tags: parseTags(tags) });
      createdId = a.id;
      await bv.post(`/kb/articles/${a.id}/submit`);
      onDone('Sugestão enviada para revisão da curadoria.');
    } catch (err) {
      if (createdId) { onDone('Rascunho salvo, mas não foi possível enviar para revisão. Tente enviar depois.'); }
      else setFormErr(errMsg(err));
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Sugerir artigo" size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="kb-suggest-form" loading={busy}>Enviar para revisão</Button></>}>
      <form id="kb-suggest-form" onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <p className="text-sm text-bv-muted">O artigo será criado como rascunho e enviado ao supervisor para aprovação. Só depois de aprovado ele passa a ser usado pelo assistente virtual.</p>
        <TextField label="Título" required value={title} maxLength={200} error={errs.title} onChange={(e) => setTitle(e.target.value)} />
        <TextArea label="Pergunta" required value={question} maxLength={1000} error={errs.question} onChange={(e) => setQuestion(e.target.value)} hint="Como o cidadão costuma perguntar." />
        <TextArea label="Resposta" required value={answer} maxLength={8000} error={errs.answer} className="min-h-[160px]" onChange={(e) => setAnswer(e.target.value)} hint="Não inclua dados pessoais (CPF, telefone, número de processo real)." />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Categoria" list="kb-cats" value={category} maxLength={100} onChange={(e) => setCategory(e.target.value)} />
          <datalist id="kb-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          <TextField label="Etiquetas" value={tags} onChange={(e) => setTags(e.target.value)} hint="Separe por vírgula." />
        </div>
        {formErr && <Banner tone="danger">{formErr}</Banner>}
      </form>
    </Dialog>
  );
}
