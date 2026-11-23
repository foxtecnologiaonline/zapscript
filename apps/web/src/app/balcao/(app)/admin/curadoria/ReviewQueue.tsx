'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { bv, errMsg } from '@/lib/balcao/api';
import { fmtDateTime } from '@/lib/balcao/format';
import { Banner, Button, DataTable, LoadMore, Spinner } from '../../../_ui/ui';
import { SOURCE_LABEL, StatusBadge, useUserNames, type KbArticle, type KbListResponse } from '../../conhecimento/_kb';
import { ArticleDialog } from './ArticleDialog';

/** Aba "Fila de revisão": artigos PENDING_REVIEW, mais antigos primeiro na leitura (a API ordena por atualização). */
export function ReviewQueue({ categories, onCount }: { categories: string[]; onCount?: (n: number) => void }) {
  const nameOf = useUserNames();
  const [items, setItems] = useState<KbArticle[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async (after?: string) => {
    if (after) setMore(true); else setLoading(true);
    setError(null);
    try {
      const r = await bv.get<KbListResponse>('/kb/articles', { status: 'PENDING_REVIEW', limit: 50, cursor: after });
      setItems((cur) => { const next = after ? [...cur, ...r.items] : r.items; onCount?.(next.length); return next; });
      setCursor(r.nextCursor);
    } catch (e) { setError(errMsg(e, 'Não foi possível carregar a fila de revisão.')); }
    finally { setLoading(false); setMore(false); }
  }, [onCount]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-bv-muted">Artigos enviados para revisão. Só depois de aprovados eles passam a ser usados pelo assistente virtual. Abra um artigo para ler, editar, aprovar ou rejeitar com motivo.</p>
      {error && <Banner tone="danger" title="Erro">{error} <Button size="sm" variant="secondary" onClick={() => void load()}>Tentar de novo</Button></Banner>}
      {loading ? <div className="p-6 text-center"><Spinner /></div> : !error && (
        <>
          <p role="status" className="text-sm font-medium">{items.length} {items.length === 1 ? 'artigo aguardando revisão' : 'artigos aguardando revisão'}{cursor ? ' (ou mais)' : ''}.</p>
          <DataTable caption="Artigos pendentes de revisão" rows={items} rowKey={(a) => a.id} empty="Nenhum artigo aguardando revisão. A fila está em dia."
            columns={[
              { key: 't', header: 'Artigo', render: (a) => <><span className="font-medium">{a.title}</span><span className="block max-w-md truncate text-xs text-bv-muted">{a.question}</span></> },
              { key: 'c', header: 'Categoria', render: (a) => a.category ?? '—' },
              { key: 'a', header: 'Autor', render: (a) => nameOf(a.authorId) },
              { key: 's', header: 'Origem', render: (a) => SOURCE_LABEL[a.source] ?? a.source },
              { key: 'v', header: 'Versão', render: (a) => `v${a.version}` },
              { key: 'u', header: 'Enviado em', render: (a) => fmtDateTime(a.updatedAt) },
              { key: 'st', header: 'Situação', render: (a) => <StatusBadge status={a.status} /> },
              { key: 'o', header: 'Ação', render: (a) => <Button size="sm" onClick={() => setOpenId(a.id)}>Revisar<span className="bv-sr-only">: {a.title}</span></Button> },
            ]} />
          <LoadMore hasMore={!!cursor} loading={more} onClick={() => void load(cursor!)} />
        </>
      )}
      {openId && <ArticleDialog articleId={openId} categories={categories} onClose={() => setOpenId(null)} onChanged={() => void load()} />}
    </div>
  );
}
