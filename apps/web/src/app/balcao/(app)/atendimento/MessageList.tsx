'use client';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { bv, errMsg } from '@/lib/balcao/api';
import { fmtDate, fmtTime } from '@/lib/balcao/format';
import { Badge, Button, cx, useToast } from '../../_ui/ui';
import { useBlobUrl } from './hooks';
import { DownIcon, LockIcon, RobotIcon } from './Icons';
import { attachmentPath, buildTimeline, canPreview, deliveryInfo, humanSize, isImage, isNote, senderLabel, type TimelineItem } from './lib';
import type { Attachment, ChatMessage, ConvEvent } from './types';

interface Props {
  conversationId: string; messages: ChatMessage[]; events: ConvEvent[]; meId: string;
  contactName: string | null; assignee: { id: string; name: string } | null;
  typing: boolean; truncated: boolean;
  onPreview: (conversationId: string, att: Attachment) => void;
  onResend: (m: ChatMessage) => void; resendingId: string | null;
  onOpenTemplate: (() => void) | null;
}

/** Histórico: região rolável focável; rolagem inteligente (só segue o fim se o atendente já estava no fim). */
export function MessageList(p: Props) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lastKey = useRef<string | null>(null);
  const lastConv = useRef<string | null>(null);
  const [below, setBelow] = useState(0);

  const timeline = useMemo(() => buildTimeline(p.messages, p.events, p.meId, (iso) => fmtDate(iso)), [p.messages, p.events, p.meId]);

  const toBottom = () => { const el = box.current; if (el) el.scrollTop = el.scrollHeight; };

  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const tail = timeline[timeline.length - 1];
    const key = tail?.key ?? null;
    if (lastConv.current !== p.conversationId) { lastConv.current = p.conversationId; lastKey.current = key; stick.current = true; setBelow(0); toBottom(); return; }
    if (key !== lastKey.current) {
      lastKey.current = key;
      if (stick.current) toBottom();
      else if (tail?.type === 'message' && tail.m.direction === 'IN') setBelow((n) => n + 1);
    }
  }, [timeline, p.conversationId]);

  // anexos/imagens carregam depois e aumentam a altura: mantém no fim se já estava
  useEffect(() => {
    const el = box.current; if (!el || typeof ResizeObserver === 'undefined') return;
    const inner = el.firstElementChild; if (!inner) return;
    const ro = new ResizeObserver(() => { if (stick.current) toBottom(); });
    ro.observe(inner);
    return () => ro.disconnect();
  }, [p.conversationId]);

  const onScroll = () => {
    const el = box.current; if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (stick.current) setBelow(0);
  };

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={box} onScroll={onScroll} tabIndex={0} role="region" aria-label="Histórico da conversa" className="h-full overflow-y-auto px-3 py-3">
        <div>
          {p.truncated && <p className="mb-3 text-center text-xs text-bv-muted">Exibindo as últimas 200 mensagens da conversa.</p>}
          {timeline.length === 0 ? <p className="py-8 text-center text-sm text-bv-muted">Ainda não há mensagens nesta conversa.</p> : (
            <ol className="flex flex-col gap-3">
              {timeline.map((it) => <TimelineRow key={it.key} it={it} {...p} />)}
            </ol>
          )}
          {p.typing && <p className="mt-2 text-sm italic text-bv-muted">{p.contactName || 'O cidadão'} está digitando…</p>}
        </div>
      </div>
      {below > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
          <button type="button" className="pointer-events-auto inline-flex min-h-[36px] items-center gap-2 rounded-full bg-bv-primary px-4 text-sm font-medium text-bv-primary-fg shadow-lg"
            onClick={() => { toBottom(); setBelow(0); box.current?.focus(); }}>
            <DownIcon />{below} {below === 1 ? 'nova mensagem' : 'novas mensagens'}
          </button>
        </div>
      )}
    </div>
  );
}

function TimelineRow({ it, ...p }: { it: TimelineItem } & Props) {
  if (it.type === 'day') return <li className="my-1 text-center text-xs font-medium text-bv-muted"><time dateTime={it.at}>{fmtDate(it.at)}</time></li>;
  if (it.type === 'event') return <li className="text-center"><span className="inline-block rounded-full bg-bv-subtle px-3 py-1 text-xs text-bv-muted">{it.text} · <time dateTime={it.at}>{fmtTime(it.at)}</time></span></li>;
  return <Bubble m={it.m} {...p} />;
}

const Bubble = React.memo(function Bubble({ m, conversationId, meId, contactName, assignee, onPreview, onResend, resendingId, onOpenTemplate }: { m: ChatMessage } & Props) {
  const note = isNote(m);
  const label = senderLabel(m, { meId, contactName, assignee });
  const incoming = m.direction === 'IN';

  if (!note && (m.senderType === 'SYSTEM' || m.kind === 'EVENT')) {
    return (
      <li className="text-center">
        <span className="inline-block max-w-[90%] whitespace-pre-wrap break-words rounded-lg bg-bv-subtle px-3 py-1 text-xs text-bv-muted">
          <span className="font-semibold">Sistema:</span> {m.body} · <time dateTime={m.createdAt}>{fmtTime(m.createdAt)}</time>
        </span>
      </li>
    );
  }

  const style = note ? 'border-2 border-dashed border-bv-warning bg-bv-warning-soft'
    : incoming ? 'border border-bv-border bg-bv-surface'
      : m.senderType === 'BOT' ? 'border border-dashed border-bv-border bg-bv-subtle'
        : 'border border-bv-primary bg-bv-primary-soft';
  const dl = !incoming && !note ? deliveryInfo(m.status, m.errorCode) : null;
  const atts = m.attachments ?? [];
  const mediaMissing = !atts.length && ['IMAGE', 'AUDIO', 'VIDEO', 'DOCUMENT'].includes(m.kind);

  return (
    <li className={cx('flex', incoming ? 'justify-start' : 'justify-end')}>
      <article aria-label={`${label}, ${fmtTime(m.createdAt)}`} className={cx('max-w-[85%] rounded-lg px-3 py-2 text-sm', style)}>
        <header className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {note && <span className="inline-flex items-center gap-1 font-semibold text-bv-warning"><LockIcon />Nota interna</span>}
          {m.senderType === 'BOT' && !note && <span className="inline-flex items-center gap-1 font-semibold text-bv-muted"><RobotIcon /></span>}
          <span className="font-semibold">{label}</span>
          {m.kind === 'TEMPLATE' && <Badge>Modelo do WhatsApp</Badge>}
          <time dateTime={m.createdAt} className="text-bv-muted">{fmtTime(m.createdAt)}</time>
        </header>
        {note && <p className="mb-1 text-xs text-bv-muted">Visível só para a equipe — nunca é enviada ao cidadão.</p>}
        {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
        {atts.length > 0 && (
          <ul className="mt-2 flex flex-col gap-2">
            {atts.map((a) => <li key={a.key}><AttachmentView conversationId={conversationId} att={a} onPreview={onPreview} /></li>)}
          </ul>
        )}
        {mediaMissing && <p className="mt-1 text-xs italic text-bv-muted">Anexo ainda não disponível (em processamento ou não recebido).</p>}
        {dl && (
          <div className={cx('mt-1 flex flex-wrap items-center gap-2 text-xs', dl.failed ? 'font-medium text-bv-danger' : 'text-bv-muted')}>
            <span role={dl.failed ? 'alert' : undefined}>{dl.failed ? '⚠ ' : '✓ '}{dl.label}</span>
            {dl.failed && (
              <>
                <Button size="sm" variant="secondary" loading={resendingId === m.id} onClick={() => onResend(m)}>Reenviar</Button>
                {m.errorCode === 'whatsapp.outside_window' && onOpenTemplate && <Button size="sm" variant="secondary" onClick={onOpenTemplate}>Enviar modelo</Button>}
              </>
            )}
          </div>
        )}
      </article>
    </li>
  );
});

function AttachmentView({ conversationId, att, onPreview }: { conversationId: string; att: Attachment; onPreview: (c: string, a: Attachment) => void }) {
  const toast = useToast();
  const path = attachmentPath(conversationId, att.key);
  const img = isImage(att);
  const thumb = useBlobUrl(path, { inline: 1 }, img && canPreview(att));
  const [media, setMedia] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isAv = att.mime.startsWith('audio/') || att.mime.startsWith('video/');
  useEffect(() => () => { if (media) URL.revokeObjectURL(media); }, [media]);

  const download = async () => {
    setBusy(true);
    try { await bv.download(path, att.name); } catch (e) { toast.error(errMsg(e, 'Não foi possível baixar o anexo.')); } finally { setBusy(false); }
  };
  const loadMedia = async () => {
    setBusy(true);
    try { setMedia(await bv.blobUrl(path)); } catch (e) { toast.error(errMsg(e, 'Não foi possível carregar o arquivo.')); } finally { setBusy(false); }
  };

  return (
    <div className="rounded-md border border-bv-border bg-bv-surface p-2">
      {img && thumb.url && (
        <button type="button" className="mb-2 block" onClick={() => onPreview(conversationId, att)} aria-label={`Ampliar imagem ${att.name}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={thumb.url} alt={`Imagem enviada: ${att.name}`} className="max-h-48 max-w-full rounded" />
        </button>
      )}
      {img && !thumb.url && !thumb.error && <p className="mb-2 text-xs text-bv-muted">Carregando imagem…</p>}
      {img && thumb.error && <p className="mb-2 text-xs text-bv-danger">Não foi possível carregar a miniatura.</p>}
      {media && att.mime.startsWith('audio/') && <audio controls src={media} className="mb-2 w-full" aria-label={`Áudio ${att.name}`} />}
      {media && att.mime.startsWith('video/') && <video controls src={media} className="mb-2 max-h-64 w-full" aria-label={`Vídeo ${att.name}`} />}
      <p className="break-all text-xs"><span className="font-medium">{att.name}</span> <span className="text-bv-muted">({humanSize(att.size)})</span></p>
      <div className="mt-1 flex flex-wrap gap-2">
        {canPreview(att) && !img && <Button size="sm" variant="secondary" onClick={() => onPreview(conversationId, att)}>Visualizar<span className="bv-sr-only"> {att.name}</span></Button>}
        {isAv && !media && <Button size="sm" variant="secondary" loading={busy} onClick={loadMedia}>{att.mime.startsWith('audio/') ? 'Ouvir' : 'Assistir'}<span className="bv-sr-only"> {att.name}</span></Button>}
        <Button size="sm" variant="secondary" loading={busy && !isAv} onClick={download}>Baixar<span className="bv-sr-only"> {att.name}</span></Button>
      </div>
    </div>
  );
}
