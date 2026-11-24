'use client';
import React, { useCallback, useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { BvApiError, errMsg } from '@/lib/balcao/api';
import { fmtDate, fmtDateTime, maskPhone, CHANNEL_LABEL, STATUS_LABEL, PRIORITY_LABEL } from '@/lib/balcao/format';
import { useBvSession } from '@/lib/balcao/session';
import { Badge, Banner, Button, Card, Spinner, TextField, useToast } from '../../_ui/ui';
import { GOVBR_DRAFT, GOVBR_PLACEHOLDER, IDENTITY_LABEL, POLO_LABEL, TASK_STATUS_LABEL, formatCnj, processoText, validCnj } from './lib';
import { api } from './service';
import type { ComposerHandle, ContactBrief, ContactDetail, KbHit, ProcessoResumo, TaskRow } from './types';

interface Props {
  conversationId: string; contact: ContactBrief | null; contactId: string; canReply: boolean;
  composer: React.RefObject<ComposerHandle>; onOpenConversation: (id: string) => void; tasksVersion: number;
}

/** Painel lateral: dados do cidadão, histórico entre canais, e-Proc, base de conhecimento e tarefas. */
export function CitizenPanel(p: Props) {
  const { can } = useBvSession();
  const [detail, setDetail] = useState<ContactDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const allowed = can('contact:read');
  const load = useCallback(() => {
    if (!allowed) return;
    setErr(null);
    api.getContact(p.contactId).then(setDetail).catch((e) => setErr(errMsg(e)));
  }, [p.contactId, allowed]);
  useEffect(() => { setDetail(null); load(); }, [load, p.conversationId]);
  return (
    <div className="flex flex-col gap-3">
      <h2 className="bv-sr-only">Painel do cidadão</h2>
      <CitizenData contact={p.contact} detail={detail} composer={p.composer} canReply={p.canReply} conversationId={p.conversationId} />
      {allowed && <History detail={detail} err={err} onRetry={load} conversationId={p.conversationId} onOpenConversation={p.onOpenConversation} />}
      <Eproc composer={p.composer} canReply={p.canReply} />
      {can('kb:read') && <Kb composer={p.composer} canReply={p.canReply} />}
      {can('task:read') && <Tasks contactId={p.contactId} conversationId={p.conversationId} version={p.tasksVersion} />}
    </div>
  );
}

const IDENT_TONE: Record<string, 'success' | 'primary' | 'warning' | 'neutral'> = { ouro: 'success', prata: 'primary', bronze: 'warning' };

function CitizenData({ contact, detail, composer, canReply, conversationId }: { contact: ContactBrief | null; detail: ContactDetail | null; composer: React.RefObject<ComposerHandle>; canReply: boolean; conversationId: string }) {
  const toast = useToast();
  const [linkBusy, setLinkBusy] = useState(false);
  const requestLogin = async () => {
    setLinkBusy(true);
    try { const { url } = await api.govbrLink(conversationId); composer.current?.insert(GOVBR_DRAFT.replace(GOVBR_PLACEHOLDER, url), 'reply'); }
    catch (e) { toast.error(errMsg(e, 'Não foi possível gerar o link do GOV.BR. Verifique se a integração está configurada.')); }
    finally { setLinkBusy(false); }
  };
  const level = detail?.contact.govbrLevel ?? null;
  const verified = detail?.contact.identityVerifiedAt ?? contact?.identityVerifiedAt ?? null;
  return (
    <Card title="Cidadão">
      {!contact ? <p className="text-sm text-bv-muted">Dados do contato indisponíveis.</p> : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-bv-muted">Nome</dt><dd className="break-words font-medium">{contact.name || 'Não informado'}</dd>
          <dt className="text-bv-muted">Categoria</dt><dd>{contact.category}</dd>
          <dt className="text-bv-muted">CPF/CNPJ</dt><dd>{contact.document ?? 'Não informado'}</dd>
          <dt className="text-bv-muted">Telefone</dt><dd>{contact.phone ? maskPhone(contact.phone) : '—'}</dd>
          <dt className="text-bv-muted">E-mail</dt><dd className="break-all">{contact.email || '—'}</dd>
          {contact.tags.length > 0 && <><dt className="text-bv-muted">Etiquetas</dt><dd className="flex flex-wrap gap-1">{contact.tags.map((t) => <Badge key={t}>{t}</Badge>)}</dd></>}
        </dl>
      )}
      <div className="mt-3 border-t border-bv-border pt-3 text-sm">
        <p className="mb-1 font-medium">Identidade GOV.BR</p>
        <p className="flex flex-wrap items-center gap-2">
          <Badge tone={level ? IDENT_TONE[level] ?? 'neutral' : 'neutral'}>{level ? `Nível ${IDENTITY_LABEL[level] ?? level}` : 'Não verificada'}</Badge>
          {verified && <span className="text-xs text-bv-muted">Confirmada em {fmtDateTime(verified)}</span>}
        </p>
        {level !== 'ouro' && canReply && (
          <div className="mt-2">
            <Button size="sm" variant="secondary" loading={linkBusy} onClick={() => void requestLogin()}>Solicitar login GOV.BR</Button>
            <p className="mt-1 text-xs text-bv-muted">Gera um link assinado (válido por 30 minutos) e insere a mensagem pronta no campo de resposta para você revisar e enviar.</p>
          </div>
        )}
      </div>
    </Card>
  );
}

function History({ detail, err, onRetry, conversationId, onOpenConversation }: { detail: ContactDetail | null; err: string | null; onRetry: () => void; conversationId: string; onOpenConversation: (id: string) => void }) {
  const items = detail?.conversations ?? [];
  return (
    <Card title="Histórico entre canais">
      {err ? <div className="flex flex-col items-start gap-2"><Banner tone="danger">{err}</Banner><Button size="sm" variant="secondary" onClick={onRetry}>Tentar de novo</Button></div>
        : !detail ? <Spinner label="Carregando histórico" />
          : items.length === 0 ? <p className="text-sm text-bv-muted">Sem outros atendimentos.</p> : (
            <ul className="flex flex-col gap-2">
              {items.slice(0, 15).map((c) => (
                <li key={c.id} className="rounded-md border border-bv-border p-2 text-sm">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-semibold">{c.protocol}</span>
                    {c.id === conversationId && <Badge tone="primary">Esta conversa</Badge>}
                  </p>
                  <p className="text-xs text-bv-muted">{CHANNEL_LABEL[c.channel] ?? c.channel} · {STATUS_LABEL[c.status] ?? c.status} · {fmtDate(c.startedAt)}</p>
                  {(c.subject || c.category) && <p className="truncate text-xs">{c.subject || c.category}</p>}
                  {c.id !== conversationId && <Button size="sm" variant="ghost" onClick={() => onOpenConversation(c.id)}>Abrir<span className="bv-sr-only"> conversa {c.protocol}</span></Button>}
                </li>
              ))}
            </ul>
          )}
    </Card>
  );
}

const EPROC_MSG: Record<string, { tone: 'warning' | 'danger'; text: string }> = {
  'eproc.sigiloso': { tone: 'warning', text: 'Processo sigiloso ou sem permissão de consulta. Nenhum dado é exibido; oriente o cidadão a procurar a secretaria.' },
  'eproc.not_found': { tone: 'warning', text: 'Processo não encontrado no e-Proc. Confira o número informado.' },
  'eproc.auth': { tone: 'danger', text: 'A credencial de consulta ao e-Proc foi recusada. Avise o administrador.' },
};

function Eproc({ composer, canReply }: { composer: React.RefObject<ComposerHandle>; canReply: boolean }) {
  const [num, setNum] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProcessoResumo | null>(null);
  const [err, setErr] = useState<{ tone: 'warning' | 'danger'; text: string } | null>(null);
  const [fieldErr, setFieldErr] = useState<string | null>(null);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    setResult(null); setErr(null); setFieldErr(null);
    const digits = num.replace(/\D/g, '');
    if (digits.length !== 20) { setFieldErr('Informe os 20 dígitos do número CNJ (NNNNNNN-DD.AAAA.J.TR.OOOO).'); return; }
    if (!validCnj(digits)) { setFieldErr('Número CNJ inválido: o dígito verificador não confere.'); return; }
    setBusy(true);
    try { setResult((await api.eproc(formatCnj(digits))).processo); }
    catch (ex) {
      const code = ex instanceof BvApiError ? ex.code : '';
      const status = ex instanceof BvApiError ? ex.status : 0;
      setErr(EPROC_MSG[code] ?? (status === 409 ? { tone: 'warning', text: 'A integração com o e-Proc não está configurada neste órgão.' }
        : status === 502 ? { tone: 'danger', text: 'O e-Proc está indisponível no momento. Tente novamente em instantes.' } : { tone: 'danger', text: errMsg(ex, 'Não foi possível consultar o processo.') }));
    } finally { setBusy(false); }
  };

  return (
    <Card title="Consulta de processo (e-Proc)">
      <form onSubmit={search} className="flex flex-col gap-2" noValidate>
        <TextField label="Número do processo (CNJ)" inputMode="numeric" autoComplete="off" placeholder="0000000-00.0000.0.00.0000" value={num} error={fieldErr}
          onChange={(e) => setNum(formatCnj(e.target.value))} />
        <div><Button type="submit" size="sm" loading={busy}>Consultar</Button></div>
      </form>
      <div aria-live="polite" className="mt-2">
        {err && <Banner tone={err.tone}>{err.text}</Banner>}
        {result && (
          <div className="rounded-md border border-bv-border p-2 text-sm">
            <p className="font-mono font-semibold">{result.numero}</p>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
              <dt className="text-bv-muted">Classe</dt><dd>{result.classe || '—'}</dd>
              <dt className="text-bv-muted">Assunto</dt><dd>{result.assunto || '—'}</dd>
              <dt className="text-bv-muted">Órgão</dt><dd>{result.orgaoJulgador || '—'}</dd>
              <dt className="text-bv-muted">Situação</dt><dd>{result.situacao || '—'}</dd>
              <dt className="text-bv-muted">Autuação</dt><dd>{fmtDate(result.dataAutuacao)}</dd>
            </dl>
            {result.partes.length > 0 && (
              <>
                <p className="mt-2 font-medium">Partes</p>
                <ul className="list-disc pl-5 text-xs">{result.partes.slice(0, 8).map((x, i) => <li key={i}>{POLO_LABEL[x.polo] ?? x.polo}: {x.nome}</li>)}</ul>
              </>
            )}
            {result.ultimosMovimentos.length > 0 && (
              <>
                <p className="mt-2 font-medium">Últimos movimentos</p>
                <ol className="flex flex-col gap-1 text-xs">{result.ultimosMovimentos.map((m, i) => <li key={i}><span className="font-medium">{fmtDate(m.data)}</span> — {m.descricao}</li>)}</ol>
              </>
            )}
            {canReply && <div className="mt-2"><Button size="sm" variant="secondary" onClick={() => composer.current?.insert(processoText(result), 'reply')}>Inserir resumo no campo de resposta</Button></div>}
          </div>
        )}
      </div>
    </Card>
  );
}

function Kb({ composer, canReply }: { composer: React.RefObject<ComposerHandle>; canReply: boolean }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState<KbHit[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [insertingId, setInsertingId] = useState<string | null>(null);
  const headingId = useId();

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    const term = q.trim(); if (!term) return;
    setBusy(true); setErr(null);
    try { setHits((await api.kbSearch(term)).items); } catch (ex) { setErr(errMsg(ex, 'Não foi possível buscar na base de conhecimento.')); setHits(null); } finally { setBusy(false); }
  };
  const insert = async (h: KbHit) => {
    setInsertingId(h.id);
    try {
      // a busca só devolve um trecho; a resposta aprovada completa vem do artigo
      const a = await api.kbArticle(h.id);
      composer.current?.insert(a.answer, 'reply');
      toast.info('Resposta inserida no campo. Revise antes de enviar.');
    } catch (ex) { toast.error(errMsg(ex, 'Não foi possível carregar o artigo.')); } finally { setInsertingId(null); }
  };

  return (
    <Card title="Base de conhecimento">
      <form onSubmit={search} role="search" className="flex items-end gap-2">
        <div className="min-w-0 flex-1"><TextField label="Buscar artigo" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ex.: certidão negativa" autoComplete="off" /></div>
        <Button type="submit" size="sm" loading={busy}>Buscar</Button>
      </form>
      <div aria-live="polite" className="mt-2">
        {err && <Banner tone="danger">{err}</Banner>}
        {hits && hits.length === 0 && <p className="text-sm text-bv-muted">Nenhum artigo aprovado encontrado.</p>}
        {hits && hits.length > 0 && (
          <ul className="flex flex-col gap-2" aria-labelledby={headingId}>
            <li id={headingId} className="bv-sr-only">{hits.length} artigos encontrados</li>
            {hits.map((h) => (
              <li key={h.id} className="rounded-md border border-bv-border p-2 text-sm">
                <p className="font-semibold">{h.title}</p>
                {h.category && <p className="text-xs text-bv-muted">{h.category}</p>}
                <p className="mt-1 text-xs">{h.snippet}{h.snippet.length >= 280 ? '…' : ''}</p>
                {canReply && <div className="mt-1"><Button size="sm" variant="secondary" loading={insertingId === h.id} onClick={() => void insert(h)}>Inserir no campo de resposta<span className="bv-sr-only">: {h.title}</span></Button></div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function Tasks({ contactId, conversationId, version }: { contactId: string; conversationId: string; version: number }) {
  const [items, setItems] = useState<TaskRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    setErr(null);
    api.listTasks({ contactId, limit: 10 }).then((r) => setItems(r.items)).catch((e) => setErr(errMsg(e)));
  }, [contactId]);
  useEffect(() => { setItems(null); load(); }, [load, version]);
  return (
    <Card title="Tarefas vinculadas" actions={<Link href="/balcao/tarefas" className="text-sm text-bv-primary underline">Ver todas</Link>}>
      {err ? <div className="flex flex-col items-start gap-2"><Banner tone="danger">{err}</Banner><Button size="sm" variant="secondary" onClick={load}>Tentar de novo</Button></div>
        : !items ? <Spinner label="Carregando tarefas" />
          : items.length === 0 ? <p className="text-sm text-bv-muted">Nenhuma tarefa para este cidadão.</p> : (
            <ul className="flex flex-col gap-2">
              {items.map((t) => (
                <li key={t.id} className="rounded-md border border-bv-border p-2 text-sm">
                  <p className="font-semibold"><span className="font-mono">{t.code}</span> {t.title}</p>
                  <p className="mt-1 flex flex-wrap gap-1">
                    <Badge tone={t.status === 'DONE' ? 'success' : t.status === 'CANCELLED' ? 'neutral' : 'primary'}>{TASK_STATUS_LABEL[t.status] ?? t.status}</Badge>
                    <Badge>{PRIORITY_LABEL[t.priority] ?? t.priority}</Badge>
                    {t.conversationId === conversationId && <Badge tone="warning">Desta conversa</Badge>}
                    {t.dueAt && <span className="text-xs text-bv-muted">Prazo {fmtDate(t.dueAt)}</span>}
                  </p>
                </li>
              ))}
            </ul>
          )}
    </Card>
  );
}
