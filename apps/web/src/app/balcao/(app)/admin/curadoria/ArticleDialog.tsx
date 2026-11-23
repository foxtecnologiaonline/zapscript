'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { bv, errMsg } from '@/lib/balcao/api';
import { useBvSession } from '@/lib/balcao/session';
import { fmtDateTime } from '@/lib/balcao/format';
import { Badge, Banner, Button, ConfirmDialog, DataTable, Select, Spinner, Tabs, TextArea, useToast } from '../../../_ui/ui';
import { ArticleMeta, DiffText, Modal, StatusBadge, STATUS_LABEL, useUserNames, type KbArticle, type KbVersion } from '../../conhecimento/_kb';
import { ArticleForm, toPayload, toValues } from './ArticleForm';

/** Descrição curta de cada aviso devolvido pela aprovação. */
const warningText = (w: string) => (w.startsWith('SELF_APPROVAL') ? 'Você aprovou um artigo de sua autoria havendo outro supervisor disponível. Recomenda-se revisão por outra pessoa; o evento foi registrado na auditoria.' : w);

type Pending = null | 'approve' | 'reject' | 'archive' | 'restore' | 'reviewed' | { revert: number };

/**
 * Detalhe de um artigo da base: conteúdo, edição, fluxo de revisão (enviar/aprovar/rejeitar/arquivar/restaurar)
 * e histórico de versões com comparação. `articleId = null` + `creating` abre o formulário de novo artigo.
 */
export function ArticleDialog({ articleId, creating, categories, onClose, onChanged }: {
  articleId: string | null; creating?: boolean; categories: string[]; onClose: () => void; onChanged: () => void;
}) {
  const { can, me } = useBvSession();
  const toast = useToast();
  const nameOf = useUserNames();
  const [id, setId] = useState<string | null>(articleId);
  const [a, setA] = useState<KbArticle | null>(null);
  const [versions, setVersions] = useState<KbVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [mode, setMode] = useState<'view' | 'edit'>(creating ? 'edit' : 'view');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [reason, setReason] = useState(''); const [reasonErr, setReasonErr] = useState<string | null>(null);
  const [reviewDays, setReviewDays] = useState('180');
  const isNew = !id;

  const load = useCallback(async (aid: string) => {
    setError(null);
    try {
      const [art, vs] = await Promise.all([bv.get<KbArticle>(`/kb/articles/${aid}`), bv.get<{ items: KbVersion[] }>(`/kb/articles/${aid}/versions`).catch(() => null)]);
      setA(art); setVersions(vs?.items ?? null);
    } catch (e) { setError(errMsg(e, 'Não foi possível carregar o artigo.')); }
  }, []);
  useEffect(() => { if (id) void load(id); }, [id, load]);

  const done = async (msg: string) => { toast.success(msg); onChanged(); if (id) await load(id); };
  const run = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true); setFormErr(null);
    try { await fn(); setPending(null); await done(okMsg); } catch (e) { toast.error(errMsg(e)); setPending(null); }
    finally { setBusy(false); }
  };

  const save = async (v: ReturnType<typeof toValues>) => {
    setBusy(true); setFormErr(null);
    try {
      if (isNew) {
        const created = await bv.post<KbArticle>('/kb/articles', toPayload(v));
        toast.success('Rascunho criado.'); onChanged(); setId(created.id); setMode('view');
      } else {
        const upd = await bv.put<KbArticle>(`/kb/articles/${id}`, toPayload(v));
        toast.success(upd.version !== a?.version ? `Artigo salvo (versão ${upd.version}, ${STATUS_LABEL[upd.status].toLowerCase()}).` : 'Nenhuma alteração de conteúdo.');
        onChanged(); setMode('view'); await load(id!);
      }
    } catch (e) { setFormErr(errMsg(e)); } finally { setBusy(false); }
  };

  const approve = () => run(async () => {
    const r = await bv.post<KbArticle & { warnings?: string[] }>(`/kb/articles/${id}/approve`, { reviewInDays: Number(reviewDays) });
    (r.warnings ?? []).forEach((w) => toast.info(warningText(w)));
  }, 'Artigo aprovado e publicado para o assistente.');
  const reject = async () => {
    if (reason.trim().length < 3) { setReasonErr('Informe o motivo (mínimo de 3 caracteres).'); return; }
    setReasonErr(null);
    await run(() => bv.post(`/kb/articles/${id}/reject`, { reason: reason.trim() }), 'Artigo rejeitado. O autor poderá corrigir e reenviar.');
    setReason('');
  };

  const title = isNew ? 'Novo artigo' : a ? a.title : 'Artigo';
  const canEdit = !!a && a.status !== 'ARCHIVED' && can('kb:write');
  const isAuthor = !!a && a.authorId === me?.user.id;

  let body: React.ReactNode;
  if (isNew || mode === 'edit') {
    body = (
      <div>
        {a?.status === 'APPROVED' && <div className="mb-3"><Banner tone="primary">Você é aprovador: ao salvar, o artigo continua aprovado e a edição conta como revisão (nova versão registrada).</Banner></div>}
        {a?.status === 'REJECTED' && <div className="mb-3"><Banner tone="warning" title="Artigo rejeitado">Motivo: {a.rejectedReason}. Ao salvar, volta a rascunho.</Banner></div>}
        <ArticleForm id="curadoria-article-form" initial={toValues(a)} categories={categories} busy={busy} error={formErr}
          submitLabel={isNew ? 'Criar rascunho' : 'Salvar alterações'} onSubmit={save} onCancel={isNew ? onClose : () => { setMode('view'); setFormErr(null); }} />
      </div>
    );
  } else if (error) body = <Banner tone="danger" title="Erro">{error}</Banner>;
  else if (!a) body = <div className="p-6 text-center"><Spinner /></div>;
  else {
    body = (
      <Tabs label="Detalhes do artigo" tabs={[
        {
          id: 'conteudo', title: 'Conteúdo', content: (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={a.status} />
                {a.category && <Badge tone="primary">{a.category}</Badge>}
                {a.tags.map((t) => <Badge key={t}>{t}</Badge>)}
              </div>
              {a.status === 'REJECTED' && <Banner tone="danger" title="Rejeitado">{a.rejectedReason}</Banner>}
              {a.status === 'PENDING_REVIEW' && isAuthor && <Banner tone="warning" title="Você é o autor deste artigo">Recomenda-se que outra pessoa aprove. A aprovação própria é permitida, mas fica registrada na auditoria.</Banner>}
              <div><h3 className="text-sm font-semibold text-bv-muted">Pergunta</h3><p className="whitespace-pre-wrap">{a.question}</p></div>
              <div><h3 className="text-sm font-semibold text-bv-muted">Resposta</h3><div className="whitespace-pre-wrap rounded-md border border-bv-border bg-bv-subtle p-3">{a.answer}</div></div>
              <ArticleMeta a={a} nameOf={nameOf} />
              {a.version > 1 && versions && versions.length > 1 && a.status === 'PENDING_REVIEW' && (
                <details className="rounded-md border border-bv-border p-3" open>
                  <summary className="cursor-pointer text-sm font-semibold">Alterações desde a versão anterior (v{a.version - 1} → v{a.version})</summary>
                  <div className="mt-2"><VersionCompare versions={versions} initialA={a.version - 1} initialB={a.version} compact /></div>
                </details>
              )}
              {a.sourceConversationIds.length > 0 && <p className="text-xs text-bv-muted">Gerado a partir de {a.sourceConversationIds.length} conversa(s) analisadas pela curadoria (dados pessoais ocultados).</p>}
            </div>
          ),
        },
        {
          id: 'historico', title: `Histórico (${versions?.length ?? '…'})`, content: !versions ? <p className="text-sm text-bv-muted">Histórico indisponível.</p> : (
            <div className="flex flex-col gap-4">
              <DataTable caption="Versões do artigo" rows={versions} rowKey={(v) => v.id} columns={[
                { key: 'v', header: 'Versão', render: (v) => <>v{v.version}{v.version === a.version && <> <Badge tone="primary">Atual</Badge></>}</> },
                { key: 'when', header: 'Data', render: (v) => fmtDateTime(v.createdAt) },
                { key: 'who', header: 'Alterado por', render: (v) => nameOf(v.changedById) },
                { key: 'st', header: 'Situação na época', render: (v) => v.snapshot.status ? <StatusBadge status={v.snapshot.status} /> : '—' },
                { key: 'act', header: 'Ações', render: (v) => v.version !== a.version && canEdit
                  ? <Button size="sm" variant="secondary" onClick={() => setPending({ revert: v.version })}>Restaurar v{v.version}<span className="bv-sr-only"> como nova versão</span></Button> : null },
              ]} />
              {versions.length > 1 && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold">Comparar versões</h3>
                  <VersionCompare versions={versions} initialA={versions[1]?.version ?? versions[0].version} initialB={versions[0].version} />
                </div>
              )}
            </div>
          ),
        },
      ]} />
    );
  }

  const footer = (isNew || mode === 'edit') ? undefined : (
    <>
      <Button variant="secondary" onClick={onClose}>Fechar</Button>
      {a && (
        <>
          {canEdit && <Button variant="secondary" onClick={() => setMode('edit')}>Editar</Button>}
          {(a.status === 'DRAFT' || a.status === 'REJECTED') && can('kb:write') && <Button variant="secondary" loading={busy} onClick={() => void run(() => bv.post(`/kb/articles/${a.id}/submit`), 'Enviado para revisão.')}>Enviar para revisão</Button>}
          {a.status === 'APPROVED' && can('kb:approve') && <Button variant="secondary" onClick={() => setPending('reviewed')}>Marcar como revisado</Button>}
          {a.status === 'ARCHIVED' && can('kb:write') && <Button variant="secondary" onClick={() => setPending('restore')}>Restaurar</Button>}
          {a.status !== 'ARCHIVED' && can('kb:write') && (a.status !== 'APPROVED' || can('kb:approve')) && <Button variant="secondary" onClick={() => setPending('archive')}>Arquivar</Button>}
          {a.status === 'PENDING_REVIEW' && can('kb:approve') && <Button variant="danger" onClick={() => { setReason(''); setReasonErr(null); setPending('reject'); }}>Rejeitar</Button>}
          {a.status === 'PENDING_REVIEW' && can('kb:approve') && <Button onClick={() => setPending('approve')}>Aprovar</Button>}
        </>
      )}
    </>
  );

  const reviewSelect = (
    <Select label="Revisar novamente em" value={reviewDays} onChange={(e) => setReviewDays(e.target.value)} hint="Prazo para a próxima revisão periódica do conteúdo.">
      <option value="90">90 dias</option><option value="180">180 dias (padrão)</option><option value="365">1 ano</option><option value="730">2 anos</option>
    </Select>
  );

  return (
    <>
      <Modal open onClose={onClose} title={title} size="lg" footer={footer}>{body}</Modal>

      <Modal open={pending === 'approve'} onClose={() => setPending(null)} title="Aprovar artigo" size="sm"
        footer={<><Button variant="secondary" onClick={() => setPending(null)}>Cancelar</Button><Button loading={busy} onClick={() => void approve()}>Aprovar</Button></>}>
        <p className="mb-3 text-sm">Ao aprovar, o conteúdo passa a poder ser usado pelo assistente virtual e pela busca dos atendentes.</p>
        {reviewSelect}
      </Modal>

      <Modal open={pending === 'reviewed'} onClose={() => setPending(null)} title="Marcar como revisado" size="sm"
        footer={<><Button variant="secondary" onClick={() => setPending(null)}>Cancelar</Button><Button loading={busy} onClick={() => void run(() => bv.post(`/kb/articles/${id}/reviewed`, { reviewInDays: Number(reviewDays) }), 'Revisão periódica registrada.')}>Confirmar</Button></>}>
        <p className="mb-3 text-sm">Confirma que o conteúdo continua válido. Nenhuma nova versão é criada.</p>
        {reviewSelect}
      </Modal>

      <Modal open={pending === 'reject'} onClose={() => setPending(null)} title="Rejeitar artigo" size="sm"
        footer={<><Button variant="secondary" onClick={() => setPending(null)}>Cancelar</Button><Button variant="danger" loading={busy} onClick={() => void reject()}>Rejeitar</Button></>}>
        <TextArea label="Motivo da rejeição" required maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} error={reasonErr}
          hint="O autor verá este motivo para corrigir e reenviar." />
      </Modal>

      <ConfirmDialog open={pending === 'archive'} onClose={() => setPending(null)} title="Arquivar artigo" danger confirmLabel="Arquivar"
        message="O artigo deixa de ser usado pelo assistente e pela busca. Você pode restaurá-lo depois (volta como rascunho)."
        onConfirm={() => run(() => bv.post(`/kb/articles/${id}/archive`), 'Artigo arquivado.')} />
      <ConfirmDialog open={pending === 'restore'} onClose={() => setPending(null)} title="Restaurar artigo" confirmLabel="Restaurar"
        message="O artigo volta como rascunho e precisará ser enviado e aprovado novamente."
        onConfirm={() => run(() => bv.post(`/kb/articles/${id}/restore`), 'Artigo restaurado como rascunho.')} />
      <ConfirmDialog open={typeof pending === 'object' && pending !== null} onClose={() => setPending(null)} title="Restaurar versão anterior" confirmLabel="Restaurar versão"
        message={`O conteúdo da versão ${typeof pending === 'object' && pending ? pending.revert : ''} será gravado como uma nova versão (o histórico nunca é apagado). ${a?.status === 'APPROVED' && !can('kb:approve') ? 'O artigo voltará para revisão.' : ''}`}
        onConfirm={() => run(() => bv.post(`/kb/articles/${id}/revert`, { version: (pending as { revert: number }).revert }), 'Versão restaurada como nova versão.')} />
    </>
  );
}

/** Compara duas versões campo a campo (inclusões e remoções marcadas por texto, não só por cor). */
export function VersionCompare({ versions, initialA, initialB, compact }: { versions: KbVersion[]; initialA: number; initialB: number; compact?: boolean }) {
  const [va, setVa] = useState(initialA); const [vb, setVb] = useState(initialB);
  const A = versions.find((v) => v.version === va)?.snapshot; const B = versions.find((v) => v.version === vb)?.snapshot;
  const opts = [...versions].sort((x, y) => y.version - x.version);
  const fields: Array<[string, (s: NonNullable<typeof A>) => string]> = [
    ['Título', (s) => s.title], ['Pergunta', (s) => s.question], ['Resposta', (s) => s.answer], ['Categoria', (s) => s.category ?? ''], ['Etiquetas', (s) => (s.tags ?? []).join(', ')],
  ];
  return (
    <div className="flex flex-col gap-3">
      {!compact && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Versão base" value={va} onChange={(e) => setVa(Number(e.target.value))}>{opts.map((v) => <option key={v.id} value={v.version}>v{v.version} — {fmtDateTime(v.createdAt)}</option>)}</Select>
          <Select label="Comparar com" value={vb} onChange={(e) => setVb(Number(e.target.value))}>{opts.map((v) => <option key={v.id} value={v.version}>v{v.version} — {fmtDateTime(v.createdAt)}</option>)}</Select>
        </div>
      )}
      {A && B ? fields.map(([label, get]) => {
        const x = get(A), y = get(B);
        return (
          <div key={label}>
            <h4 className="text-sm font-semibold text-bv-muted">{label}{x === y && <span className="font-normal"> (sem alteração)</span>}</h4>
            <DiffText before={x} after={y} />
          </div>
        );
      }) : <p className="text-sm text-bv-muted">Selecione duas versões.</p>}
      <p className="text-xs text-bv-muted">Legenda: texto <ins className="bg-bv-success-soft underline">sublinhado</ins> foi incluído; texto <del className="bg-bv-danger-soft line-through">tachado</del> foi removido.</p>
    </div>
  );
}
