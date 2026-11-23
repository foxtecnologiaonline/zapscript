'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { bv, errMsg } from '@/lib/balcao/api';
import { useBvSession } from '@/lib/balcao/session';
import { fmtDateTime } from '@/lib/balcao/format';
import { Badge, Banner, Button, Checkbox, Select, Spinner, TextArea, useToast } from '../../../_ui/ui';
import { Modal } from '../../conhecimento/_kb';
import { ArticleDialog } from './ArticleDialog';
import { ArticleForm, toPayload, toValues, type ArticleValues } from './ArticleForm';

type SType = 'GAP' | 'NEW_ARTICLE' | 'AMBIGUITY' | 'IMPROVE';
interface Suggestion {
  id: string; type: SType; question: string; proposedAnswer: string | null; status: 'OPEN' | 'ACCEPTED' | 'DISMISSED'; articleId: string | null;
  resolvedAt: string | null; createdAt: string; evidenceCount: number;
  evidence: {
    count?: number; sampleMessages?: string[]; hasAgentAnswers?: boolean; kind?: string; intent?: string; meanSimilarity?: number; similarity?: number; articleIds?: string[]; dismissReason?: string | null;
    proposal?: { by?: string; model?: string; title?: string; question?: string; category?: string | null; tags?: string[]; basedOnConversations?: number; requiresHumanReview?: boolean };
  };
}

const TYPE_LABEL: Record<SType, string> = { GAP: 'Lacuna', NEW_ARTICLE: 'Novo artigo', AMBIGUITY: 'Ambiguidade', IMPROVE: 'Melhoria' };
const TYPE_HELP: Record<SType, string> = {
  GAP: 'Perguntas recorrentes sem artigo que as cubra e sem resposta humana aproveitável. Escreva a resposta.',
  NEW_ARTICLE: 'Perguntas recorrentes sem cobertura; a IA propôs um artigo a partir das respostas reais dos atendentes.',
  AMBIGUITY: 'Respostas divergentes, artigos concorrentes ou baixa confiança recorrente do assistente. Exige decisão humana.',
  IMPROVE: 'Já existe artigo parecido, mas as conversas indicam cobertura parcial. Considere melhorar o artigo existente.',
};
const KIND_LABEL: Record<string, string> = {
  DIVERGENT_ANSWERS: 'Atendentes deram respostas divergentes para a mesma intenção',
  COMPETING_ARTICLES: 'Dois artigos aprovados respondem quase a mesma pergunta',
  RECURRING_LOW_CONFIDENCE: 'O assistente teve baixa confiança repetidas vezes nesta intenção',
};
const TYPE_TONE: Record<SType, 'primary' | 'warning' | 'danger' | 'neutral'> = { GAP: 'danger', NEW_ARTICLE: 'primary', AMBIGUITY: 'warning', IMPROVE: 'neutral' };
const STATUS_LABEL_S = { OPEN: 'Aberta', ACCEPTED: 'Aceita', DISMISSED: 'Dispensada' } as const;

/** Aba "Sugestões da curadoria": revisar evidência e proposta da IA, aceitar (vira rascunho) ou dispensar. */
export function Suggestions({ categories, onChanged }: { categories: string[]; onChanged?: () => void }) {
  const { can } = useBvSession();
  const toast = useToast();
  const [status, setStatus] = useState('OPEN'); const [type, setType] = useState('');
  const [items, setItems] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState<Suggestion | null>(null);
  const [dismissing, setDismissing] = useState<Suggestion | null>(null);
  const [openArticle, setOpenArticle] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setItems((await bv.get<{ items: Suggestion[] }>('/kb/suggestions', { status, type, limit: 100 })).items); }
    catch (e) { setError(errMsg(e, 'Não foi possível carregar as sugestões.')); }
    finally { setLoading(false); }
  }, [status, type]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-bv-muted">A curadoria analisa conversas sem cobertura da base e <strong>apenas sugere</strong>: nada é publicado sem aprovação humana. Os exemplos abaixo têm dados pessoais ocultados.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Select label="Situação" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="OPEN">Abertas</option><option value="ACCEPTED">Aceitas</option><option value="DISMISSED">Dispensadas</option>
        </Select>
        <Select label="Tipo" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Todos</option>
          {(Object.keys(TYPE_LABEL) as SType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </Select>
      </div>

      {error && <Banner tone="danger" title="Erro">{error}</Banner>}
      {loading ? <div className="p-6 text-center"><Spinner /></div> : !error && (
        <>
          <p role="status" className="text-sm font-medium">{items.length} {items.length === 1 ? 'sugestão' : 'sugestões'}.</p>
          {items.length === 0 && <p className="rounded-lg border border-dashed border-bv-border p-6 text-center text-sm text-bv-muted">Nenhuma sugestão nesta seleção. Use “Executar curadoria agora” na aba Indicadores para gerar novas.</p>}
          <ul className="flex flex-col gap-3">
            {items.map((s) => {
              const ev = s.evidence ?? {};
              const proposed = s.proposedAnswer;
              return (
                <li key={s.id}>
                  <article aria-labelledby={`sg-${s.id}`} className="rounded-lg border border-bv-border bg-bv-surface p-4">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <Badge tone={TYPE_TONE[s.type]}>{TYPE_LABEL[s.type]}</Badge>
                      <Badge tone={s.status === 'OPEN' ? 'warning' : s.status === 'ACCEPTED' ? 'success' : 'neutral'}>{STATUS_LABEL_S[s.status]}</Badge>
                      <span className="text-xs text-bv-muted">Gerada em {fmtDateTime(s.createdAt)}</span>
                    </div>
                    <h3 id={`sg-${s.id}`} className="font-semibold">{s.question}</h3>
                    <p className="text-xs text-bv-muted">{TYPE_HELP[s.type]}</p>

                    <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                      <div className="flex gap-1"><dt className="text-bv-muted">Ocorrências (conversas):</dt><dd><strong>{s.evidenceCount}</strong></dd></div>
                      {ev.kind && <div className="flex gap-1 sm:col-span-2"><dt className="text-bv-muted">Motivo:</dt><dd>{KIND_LABEL[ev.kind] ?? ev.kind}</dd></div>}
                      {ev.intent && <div className="flex gap-1"><dt className="text-bv-muted">Intenção:</dt><dd>{ev.intent}</dd></div>}
                      {ev.meanSimilarity != null && <div className="flex gap-1"><dt className="text-bv-muted">Similaridade média das respostas:</dt><dd>{Math.round(ev.meanSimilarity * 100)}%</dd></div>}
                      {ev.similarity != null && <div className="flex gap-1"><dt className="text-bv-muted">Similaridade dos artigos:</dt><dd>{Math.round(ev.similarity * 100)}%</dd></div>}
                      {ev.hasAgentAnswers != null && <div className="flex gap-1"><dt className="text-bv-muted">Há respostas de atendentes:</dt><dd>{ev.hasAgentAnswers ? 'Sim' : 'Não'}</dd></div>}
                    </dl>

                    {(ev.sampleMessages?.length ?? 0) > 0 && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-sm font-medium">Exemplos de mensagens ({ev.sampleMessages!.length}) — sem dados pessoais</summary>
                        <ul className="mt-1 list-disc pl-5 text-sm">{ev.sampleMessages!.map((m, i) => <li key={i} className="whitespace-pre-wrap">{m}</li>)}</ul>
                      </details>
                    )}

                    {(s.type === 'IMPROVE' || (ev.articleIds?.length ?? 0) > 0 || s.articleId) && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {s.articleId && <Button size="sm" variant="secondary" onClick={() => setOpenArticle(s.articleId)}>{s.status === 'ACCEPTED' ? 'Abrir artigo criado' : 'Abrir artigo relacionado'}</Button>}
                        {(ev.articleIds ?? []).map((aid, i) => <Button key={aid} size="sm" variant="secondary" onClick={() => setOpenArticle(aid)}>Abrir artigo {i + 1}</Button>)}
                      </div>
                    )}

                    {proposed && (
                      <div className="mt-3 rounded-md border border-bv-primary bg-bv-primary-soft p-3">
                        <p className="text-sm font-semibold">Resposta proposta pela IA{ev.proposal?.model ? ` (${ev.proposal.model})` : ''}</p>
                        <p className="text-xs text-bv-muted">Baseada em respostas reais de atendentes{ev.proposal?.basedOnConversations ? ` de ${ev.proposal.basedOnConversations} conversas` : ''}. Precisa de revisão humana antes de publicar.</p>
                        {ev.proposal?.title && <p className="mt-1 text-sm"><strong>Título:</strong> {ev.proposal.title}</p>}
                        <p className="mt-1 whitespace-pre-wrap text-sm">{proposed}</p>
                      </div>
                    )}
                    {s.status === 'DISMISSED' && ev.dismissReason && <p className="mt-2 text-sm text-bv-muted">Motivo da dispensa: {ev.dismissReason}</p>}

                    {s.status === 'OPEN' && can('kb:write') && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button onClick={() => setAccepting(s)}>{s.type === 'AMBIGUITY' ? 'Marcar como tratada' : proposed ? 'Revisar e aceitar' : 'Escrever resposta e aceitar'}</Button>
                        <Button variant="secondary" onClick={() => setDismissing(s)}>Dispensar</Button>
                      </div>
                    )}
                  </article>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {accepting && <AcceptDialog s={accepting} categories={categories} onClose={() => setAccepting(null)}
        onDone={(msg) => { toast.success(msg); setAccepting(null); void load(); onChanged?.(); }} />}
      {dismissing && <DismissDialog s={dismissing} onClose={() => setDismissing(null)} onDone={() => { toast.success('Sugestão dispensada.'); setDismissing(null); void load(); onChanged?.(); }} />}
      {openArticle && <ArticleDialog articleId={openArticle} categories={categories} onClose={() => setOpenArticle(null)} onChanged={() => onChanged?.()} />}
    </div>
  );
}

function AcceptDialog({ s, categories, onClose, onDone }: { s: Suggestion; categories: string[]; onClose: () => void; onDone: (msg: string) => void }) {
  const [submitForReview, setSubmit] = useState(true);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const p = s.evidence?.proposal;

  if (s.type === 'AMBIGUITY') {
    return (
      <Modal open onClose={onClose} title="Marcar ambiguidade como tratada" size="sm"
        footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button loading={busy} onClick={async () => { setBusy(true); setErr(null); try { await bv.post(`/kb/suggestions/${s.id}/accept`, {}); onDone('Ambiguidade marcada como tratada.'); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } }}>Confirmar</Button></>}>
        <p className="text-sm">Esta sugestão não cria artigo. Antes de confirmar, ajuste os artigos envolvidos (use o botão “Abrir artigo” no cartão) ou alinhe a resposta dos atendentes.</p>
        <p className="mt-2 text-sm font-medium">{s.question}</p>
        {err && <div className="mt-2"><Banner tone="danger">{err}</Banner></div>}
      </Modal>
    );
  }

  const submit = async (v: ArticleValues) => {
    setBusy(true); setErr(null);
    try {
      const body = { ...toPayload(v), submitForReview };
      const r = await bv.post<{ articleId: string | null }>(`/kb/suggestions/${s.id}/accept`, body);
      void r; onDone(submitForReview ? 'Artigo criado e enviado para a fila de revisão.' : 'Rascunho criado a partir da sugestão.');
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Aceitar sugestão" size="lg">
      <p className="mb-3 text-sm text-bv-muted">Revise e edite o texto. Ao aceitar, é criado um artigo <strong>{submitForReview ? 'em revisão' : 'em rascunho'}</strong>; ele só será usado pelo assistente depois de aprovado.</p>
      <ArticleForm id="sg-accept-form" categories={categories} busy={busy} error={err} submitLabel="Aceitar e criar artigo" onSubmit={submit} onCancel={onClose}
        initial={toValues({ title: p?.title ?? s.question.slice(0, 120), question: p?.question ?? s.question, answer: s.proposedAnswer ?? '', category: p?.category ?? null, tags: p?.tags ?? [] })}
        answerHint={s.proposedAnswer ? 'Texto proposto pela IA — confira cada fato (prazos, valores, links) antes de aceitar.' : 'Esta sugestão não tem resposta proposta: escreva a resposta com base em fontes oficiais.'}>
        <Checkbox label="Enviar já para a fila de revisão" hint="Desmarque para manter como rascunho e continuar editando depois." checked={submitForReview} onChange={(e) => setSubmit(e.target.checked)} />
      </ArticleForm>
    </Modal>
  );
}

function DismissDialog({ s, onClose, onDone }: { s: Suggestion; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setBusy(true); setErr(null);
    try { await bv.post(`/kb/suggestions/${s.id}/dismiss`, reason.trim() ? { reason: reason.trim() } : {}); onDone(); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Dispensar sugestão" size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="danger" loading={busy} onClick={() => void go()}>Dispensar</Button></>}>
      <p className="mb-2 text-sm">“{s.question}”</p>
      <p className="mb-2 text-xs text-bv-muted">Sugestões dispensadas não voltam a ser geradas por cerca de 60 dias.</p>
      <TextArea label="Motivo (opcional)" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      {err && <div className="mt-2"><Banner tone="danger">{err}</Banner></div>}
    </Modal>
  );
}
