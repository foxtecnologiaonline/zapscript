'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { bv, errMsg } from '@/lib/balcao/api';
import { useBvSession } from '@/lib/balcao/session';
import { fmtDateTime } from '@/lib/balcao/format';
import { Banner, Button, DataTable, LoadMore, Select, Spinner, TextArea, TextField } from '../../../_ui/ui';
import { Modal, SOURCE_LABEL, STATUS_LABEL, StatusBadge, type KbArticle, type KbListResponse } from '../../conhecimento/_kb';
import { ArticleDialog } from './ArticleDialog';

interface ImportResult { created: number; skipped: number; errors: Array<{ row: number; message: string }>; articleIds: string[] }

/** Aba "Artigos": todos os status, filtros, criação, edição, histórico e importação em lote. */
export function Articles({ categories, onChanged }: { categories: string[]; onChanged?: () => void }) {
  const { can } = useBvSession();
  const [status, setStatus] = useState(''); const [category, setCategory] = useState(''); const [source, setSource] = useState('');
  const [tag, setTag] = useState(''); const [q, setQ] = useState(''); const [qDebounced, setQd] = useState('');
  const [items, setItems] = useState<KbArticle[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true); const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const seq = useRef(0);

  useEffect(() => { const t = setTimeout(() => setQd(q.trim()), 350); return () => clearTimeout(t); }, [q]);

  const load = useCallback(async (after?: string) => {
    const my = ++seq.current;
    if (after) setMore(true); else setLoading(true);
    setError(null);
    try {
      const r = await bv.get<KbListResponse>('/kb/articles', { status, category, tag, source, q: qDebounced, limit: 50, cursor: after });
      if (my !== seq.current) return;
      setItems((cur) => (after ? [...cur, ...r.items] : r.items)); setCursor(r.nextCursor);
    } catch (e) { if (my === seq.current) setError(errMsg(e, 'Não foi possível carregar os artigos.')); }
    finally { if (my === seq.current) { setLoading(false); setMore(false); } }
  }, [status, category, tag, source, qDebounced]);
  useEffect(() => { void load(); }, [load]);

  const changed = () => { void load(); onChanged?.(); };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <p className="text-sm text-bv-muted">Todos os artigos da base, em qualquer situação.</p>
        <div className="flex flex-wrap gap-2">
          {can('kb:write') && <Button variant="secondary" onClick={() => setImportOpen(true)}>Importar em lote</Button>}
          {can('kb:write') && <Button onClick={() => setCreating(true)}>Novo artigo</Button>}
        </div>
      </div>

      <form role="search" aria-label="Filtrar artigos" onSubmit={(e) => e.preventDefault()} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <TextField label="Texto" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Título, pergunta ou resposta" />
        <Select label="Situação" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todas</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select label="Categoria" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Todas</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
        <TextField label="Etiqueta" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Etiqueta exata" />
        <Select label="Origem" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">Todas</option>
          {Object.entries(SOURCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </form>

      {error && <Banner tone="danger" title="Erro">{error}</Banner>}
      {loading ? <div className="p-6 text-center"><Spinner /></div> : !error && (
        <>
          <p role="status" className="text-sm text-bv-muted">{items.length} {items.length === 1 ? 'artigo' : 'artigos'}{cursor ? ' (há mais)' : ''}.</p>
          <DataTable caption="Artigos da base de conhecimento" rows={items} rowKey={(a) => a.id} empty="Nenhum artigo com estes filtros."
            columns={[
              { key: 't', header: 'Título', render: (a) => <><span className="font-medium">{a.title}</span>{a.tags.length > 0 && <span className="block text-xs text-bv-muted">{a.tags.join(', ')}</span>}</> },
              { key: 's', header: 'Situação', render: (a) => <StatusBadge status={a.status} /> },
              { key: 'c', header: 'Categoria', render: (a) => a.category ?? '—' },
              { key: 'o', header: 'Origem', render: (a) => SOURCE_LABEL[a.source] ?? a.source },
              { key: 'v', header: 'Versão', render: (a) => `v${a.version}` },
              { key: 'us', header: 'Usos', render: (a) => a.useCount },
              { key: 'r', header: 'Próx. revisão', render: (a) => a.nextReviewAt ? fmtDateTime(a.nextReviewAt) : '—' },
              { key: 'u', header: 'Atualizado', render: (a) => fmtDateTime(a.updatedAt) },
              { key: 'a', header: 'Ação', render: (a) => <Button size="sm" variant="secondary" onClick={() => setOpenId(a.id)}>Abrir<span className="bv-sr-only">: {a.title}</span></Button> },
            ]} />
          <LoadMore hasMore={!!cursor} loading={more} onClick={() => void load(cursor!)} />
        </>
      )}

      {(openId || creating) && <ArticleDialog articleId={openId} creating={creating} categories={categories} onClose={() => { setOpenId(null); setCreating(false); }} onChanged={changed} />}
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} onImported={changed} />}
    </div>
  );
}

const CSV_SAMPLE = 'titulo;pergunta;resposta;categoria;tags\nCertidão de objeto e pé;Como solicito a certidão de objeto e pé?;A certidão é solicitada pelo portal...;Certidões;certidao|processo';
const JSON_SAMPLE = '[\n  { "title": "Certidão de objeto e pé", "question": "Como solicito a certidão?", "answer": "A certidão é solicitada pelo portal...", "category": "Certidões", "tags": ["certidao", "processo"] }\n]';

function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [format, setFormat] = useState<'csv' | 'json'>('csv');
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ImportResult | null>(null);

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    if (f.size > 2_000_000) { setErr('O arquivo excede 2 MB. Divida em arquivos menores.'); return; }
    setErr(null); setFileName(f.name);
    setText(await f.text());
    setFormat(/\.json$/i.test(f.name) ? 'json' : 'csv');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setRes(null);
    if (!text.trim()) { setErr('Selecione um arquivo ou cole o conteúdo.'); return; }
    let body: unknown;
    if (format === 'csv') body = { format: 'csv', csv: text };
    else {
      try {
        const parsed = JSON.parse(text);
        const articles = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.articles) ? parsed.articles : null;
        if (!articles) { setErr('O JSON deve ser uma lista de artigos ou um objeto com a chave "articles".'); return; }
        if (articles.length > 500) { setErr('Máximo de 500 artigos por importação.'); return; }
        body = { format: 'json', articles };
      } catch { setErr('JSON inválido. Verifique vírgulas, aspas e colchetes.'); return; }
    }
    setBusy(true);
    try { const r = await bv.post<ImportResult>('/kb/import', body); setRes(r); if (r.created) onImported(); }
    catch (er) { setErr(errMsg(er)); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title="Importar artigos em lote" size="lg"
      footer={res ? <Button onClick={onClose}>Concluir</Button> : <><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="kb-import-form" loading={busy}>Importar</Button></>}>
      {res ? (
        <div className="flex flex-col gap-3">
          <Banner tone={res.created ? 'success' : 'warning'} title="Importação concluída">
            {res.created} {res.created === 1 ? 'artigo criado' : 'artigos criados'} (aguardando revisão na fila) · {res.skipped} ignorados por já existirem · {res.errors.length - res.skipped} com erro.
          </Banner>
          {res.errors.length > 0 && (
            <DataTable caption="Linhas não importadas" rows={res.errors} rowKey={(r) => `${r.row}-${r.message}`}
              columns={[{ key: 'r', header: 'Linha', render: (r) => r.row }, { key: 'm', header: 'Motivo', render: (r) => r.message }]} />
          )}
        </div>
      ) : (
        <form id="kb-import-form" onSubmit={submit} className="flex flex-col gap-3" noValidate>
          <p className="text-sm text-bv-muted">Os artigos importados entram como <strong>Em revisão</strong> e só serão usados pelo assistente depois de aprovados. Perguntas que já existem na base são ignoradas. Máximo de 500 artigos ou 2 MB.</p>
          <Select label="Formato" value={format} onChange={(e) => setFormat(e.target.value as 'csv' | 'json')}>
            <option value="csv">CSV (colunas: titulo, pergunta, resposta, categoria, tags)</option>
            <option value="json">JSON (lista de artigos)</option>
          </Select>
          <div className="flex flex-col gap-1">
            <label htmlFor="kb-import-file" className="text-sm font-medium">Arquivo (.csv ou .json)</label>
            <input id="kb-import-file" type="file" accept=".csv,.json,text/csv,application/json" onChange={pick} className="text-sm" />
            {fileName && <p className="text-xs text-bv-muted">Arquivo carregado: {fileName}</p>}
          </div>
          <TextArea label="Ou cole o conteúdo" value={text} onChange={(e) => setText(e.target.value)} className="min-h-[140px] font-mono text-xs" placeholder={format === 'csv' ? CSV_SAMPLE : JSON_SAMPLE} />
          <details className="text-sm">
            <summary className="cursor-pointer">Ver exemplo de {format === 'csv' ? 'CSV' : 'JSON'}</summary>
            <pre className="mt-1 overflow-x-auto rounded-md bg-bv-subtle p-2 text-xs">{format === 'csv' ? CSV_SAMPLE : JSON_SAMPLE}</pre>
            {format === 'csv' && <p className="mt-1 text-xs text-bv-muted">Separador “;” ou “,”. Em tags, separe por “|”, “;” ou “,”. Cabeçalhos também aceitos em inglês (title, question, answer, category, tags).</p>}
          </details>
          {err && <Banner tone="danger">{err}</Banner>}
        </form>
      )}
    </Modal>
  );
}
