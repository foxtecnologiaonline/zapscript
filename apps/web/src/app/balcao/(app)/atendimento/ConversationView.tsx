'use client';
import React, { useState } from 'react';
import { errMsg } from '@/lib/balcao/api';
import { fmtDateTime, STATUS_LABEL } from '@/lib/balcao/format';
import { useBvSession } from '@/lib/balcao/session';
import { Badge, Banner, Button, EmptyState, Spinner, useToast } from '../../_ui/ui';
import { Composer } from './Composer';
import { BackIcon } from './Icons';
import { ChannelTag } from './Icons';
import { MessageList } from './MessageList';
import { failedOutsideWindow, priorityLabel, slaInfo, windowExpired } from './lib';
import { api } from './service';
import type { Attachment, CannedResponse, ChatMessage, ComposerHandle, ConvDetail, Suggestion } from './types';

export type ViewAction = 'transfer' | 'close' | 'task' | 'summary' | 'template';

interface Props {
  detail: ConvDetail | null; loading: boolean; error: string | null; onRetry: () => void;
  meId: string; token: string | null; now: number; typing: boolean;
  onPickup: () => void; picking: boolean; onBack: () => void; onAction: (a: ViewAction) => void;
  onPreview: (conversationId: string, att: Attachment) => void;
  onSent: (m: ChatMessage, delivery: { status: string; error: string | null } | null) => void;
  composerRef: React.Ref<ComposerHandle>; headingRef: React.RefObject<HTMLHeadingElement>;
  canned: CannedResponse[] | null; cannedLoading: boolean; onNeedCanned: () => void;
  suggestion: Suggestion | null; suggestionBusy: boolean; onSuggest: () => void; onDismissSuggestion: () => void;
}

export function ConversationView(p: Props) {
  const { can } = useBvSession();
  const toast = useToast();
  const [resendingId, setResendingId] = useState<string | null>(null);

  if (p.loading && !p.detail) return <div className="flex h-full items-center justify-center rounded-lg border border-bv-border bg-bv-surface"><Spinner size={28} label="Carregando conversa" /></div>;
  if (p.error && !p.detail) {
    return (
      <div className="flex h-full flex-col items-start gap-3 rounded-lg border border-bv-border bg-bv-surface p-4">
        <MobileBack onBack={p.onBack} />
        <Banner tone="danger" title="Não foi possível abrir a conversa">{p.error}</Banner>
        <Button variant="secondary" onClick={p.onRetry}>Tentar de novo</Button>
      </div>
    );
  }
  if (!p.detail) {
    return (
      <div className="flex h-full flex-col items-center justify-center rounded-lg border border-bv-border bg-bv-surface p-6">
        <div className="max-w-sm"><EmptyState title="Nenhuma conversa selecionada">Escolha uma conversa na lista, ou use as teclas J e K para navegar. Pressione ? para ver todos os atalhos.</EmptyState></div>
      </div>
    );
  }

  const { conversation: c, contact } = p.detail;
  const closed = c.status === 'CLOSED';
  const canReplyPerm = can('conversation:reply');
  const sla = slaInfo(c, p.now);
  const prio = priorityLabel(c.priority);
  const waClosed = c.channel === 'WHATSAPP' && !closed && (windowExpired(c.lastInboundAt, p.now) || failedOutsideWindow(p.detail.messages, c.lastInboundAt));
  const canPickup = canReplyPerm && c.status === 'WAITING' && !c.assignedUserId;
  const canTemplate = canReplyPerm && c.channel === 'WHATSAPP' && p.detail.canReply;

  const resend = async (m: ChatMessage) => {
    setResendingId(m.id);
    try {
      const r = await api.sendMessage(c.id, { ...(m.body ? { text: m.body } : {}), ...(m.attachments?.length ? { attachments: m.attachments } : {}) });
      p.onSent(r.message, r.delivery);
      if (r.delivery.error) toast.error('O reenvio também falhou. Veja o motivo na mensagem.'); else toast.success('Mensagem reenviada.');
    } catch (e) { toast.error(errMsg(e, 'Não foi possível reenviar.')); } finally { setResendingId(null); }
  };

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-bv-border bg-bv-surface">
      <header className="border-b border-bv-border p-3">
        <MobileBack onBack={p.onBack} />
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 ref={p.headingRef} tabIndex={-1} className="break-words text-lg font-semibold outline-none">
              <span className="font-mono">{c.protocol}</span> · {contact?.name || 'Cidadão sem nome'}
            </h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-bv-muted">
              <ChannelTag channel={c.channel} />
              <span>Fila: {c.queue?.name ?? 'sem fila'}</span>
              <span>Responsável: {c.assignee?.name ?? 'ninguém'}</span>
              <span>Início: {fmtDateTime(c.startedAt)}</span>
            </p>
            <p className="mt-2 flex flex-wrap items-center gap-1">
              <Badge tone={c.status === 'WAITING' ? 'warning' : c.status === 'ACTIVE' ? 'primary' : 'neutral'}>{STATUS_LABEL[c.status] ?? c.status}</Badge>
              {sla && <Badge tone={sla.tone}>{sla.kind ? `${sla.kind}: ` : ''}{sla.label}{sla.detail ? ` · ${sla.detail}` : ''}</Badge>}
              {prio && <Badge>{prio}</Badge>}
              {c.subject && <Badge>{c.subject}</Badge>}
              {c.transferCount > 0 && <Badge>{c.transferCount} {c.transferCount === 1 ? 'transferência' : 'transferências'}</Badge>}
            </p>
          </div>
          <div role="group" aria-label="Ações da conversa" className="flex flex-wrap gap-2">
            {canPickup && <Button size="sm" loading={p.picking} onClick={p.onPickup}>Assumir</Button>}
            {!closed && p.detail.canReply && can('conversation:transfer') && <Button size="sm" variant="secondary" onClick={() => p.onAction('transfer')}>Transferir</Button>}
            {!closed && p.detail.canReply && can('conversation:close') && <Button size="sm" variant="secondary" onClick={() => p.onAction('close')}>Encerrar</Button>}
            {can('task:write') && <Button size="sm" variant="secondary" onClick={() => p.onAction('task')}>Criar tarefa</Button>}
            {canReplyPerm && <Button size="sm" variant="secondary" onClick={() => p.onAction('summary')}>Resumo por IA</Button>}
          </div>
        </div>
      </header>

      {p.error && <div className="p-2"><Banner tone="warning" title="Não foi possível atualizar a conversa">{p.error}</Banner></div>}

      <MessageList conversationId={c.id} messages={p.detail.messages} events={p.detail.events} meId={p.meId} contactName={contact?.name ?? null} assignee={c.assignee}
        typing={p.typing} truncated={p.detail.messages.length >= 200} onPreview={p.onPreview} onResend={(m) => void resend(m)} resendingId={resendingId}
        onOpenTemplate={canTemplate ? () => p.onAction('template') : null} />

      {closed ? (
        <div className="border-t border-bv-border p-3"><Banner tone="primary" title="Conversa encerrada">Encerrada em {fmtDateTime(c.closedAt)}. Se o cidadão escrever de novo, ela volta para a fila.</Banner></div>
      ) : (
        <>
          {!p.detail.canReply && canPickup && (
            <div className="border-t border-bv-border p-3"><Banner tone="warning" title="Conversa aguardando atendimento">Assuma a conversa para responder ao cidadão. Enquanto isso, você pode registrar notas internas.</Banner></div>
          )}
          {canReplyPerm ? (
            <Composer key={c.id} conversationId={c.id} channel={c.channel} token={p.token}
              canReply={p.detail.canReply} canNote canAi={can('conversation:reply')} waWindowClosed={waClosed} canTemplate={canTemplate} onOpenTemplate={() => p.onAction('template')}
              canned={p.canned} cannedLoading={p.cannedLoading} onNeedCanned={p.onNeedCanned}
              suggestion={p.suggestion} suggestionBusy={p.suggestionBusy} onSuggest={p.onSuggest} onDismissSuggestion={p.onDismissSuggestion}
              onSent={p.onSent} handleRef={p.composerRef} />
          ) : <div className="border-t border-bv-border p-3 text-sm text-bv-muted">Seu perfil não pode responder conversas.</div>}
        </>
      )}
    </div>
  );
}

function MobileBack({ onBack }: { onBack: () => void }) {
  return <div className="mb-2 xl:hidden"><Button size="sm" variant="ghost" onClick={onBack}><BackIcon />Voltar para a lista</Button></div>;
}
