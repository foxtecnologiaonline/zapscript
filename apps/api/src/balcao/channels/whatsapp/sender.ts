import crypto from 'crypto';
import { prisma } from '../../../lib/prisma';
import { logger } from '../../../lib/logger';
import { ChannelSendError, type OutboundRequest, type OutboundResult } from '../../core/channels';
import { getIntegration, logIntegration } from '../../core/integrations';
import { getObjectBuffer } from '../../core/storage';
import { getOrgSettings } from '../../core/settings';
import { normalizePhone } from '../../core/contacts';
import { assertQuota, QuotaExceededError, recordUsage } from '../../core/usage';
import { graphCall, GraphError, isMock, type WaConfig } from './graph';
import { buildTemplateComponents, TemplateParamError, usageItemFor, type TemplateSendMeta } from './templates';

/** Remetente do canal WHATSAPP (registrado em index.ts via registerChannelSender). */

const TEXT_MAX = 4096;
const MEDIA_LIMITS: Record<'image' | 'audio' | 'video' | 'document', number> = { image: 5 * 1024 * 1024, audio: 16 * 1024 * 1024, video: 16 * 1024 * 1024, document: 100 * 1024 * 1024 };
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png']);
const AUDIO_MIMES = new Set(['audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/amr', 'audio/ogg']);
const VIDEO_MIMES = new Set(['video/mp4', 'video/3gpp']);

export type WaMediaType = 'image' | 'audio' | 'video' | 'document';

export function mediaTypeOf(mime: string): WaMediaType {
  const m = mime.toLowerCase().split(';')[0].trim();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('video/')) return 'video';
  return 'document';
}

function checkMime(type: WaMediaType, mime: string): void {
  const m = mime.toLowerCase().split(';')[0].trim();
  const ok = type === 'image' ? IMAGE_MIMES.has(m) : type === 'audio' ? AUDIO_MIMES.has(m) : type === 'video' ? VIDEO_MIMES.has(m) : true;
  if (!ok) throw new ChannelSendError(`Tipo de mídia não suportado pelo WhatsApp: ${m}`, 'whatsapp.unsupported_media');
}

export function splitText(text: string, max = TEXT_MAX): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n\n', max);
    if (cut < max * 0.5) cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = rest.lastIndexOf(' ', max);
    if (cut < max * 0.5) cut = max;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

const toChannelError = (e: unknown): ChannelSendError => {
  if (e instanceof ChannelSendError) return e;
  if (e instanceof GraphError) return new ChannelSendError(e.message, e.errorCode, e.retryable);
  return new ChannelSendError('Falha inesperada ao enviar pelo WhatsApp', 'whatsapp.send_failed');
};

/** Lê a integração do órgão; lança ChannelSendError se ausente/desabilitada. */
export async function requireWaConfig(orgId: string): Promise<WaConfig> {
  const integ = await getIntegration<WaConfig>(orgId, 'WHATSAPP');
  if (!integ) throw new ChannelSendError('Canal WhatsApp não configurado para o órgão', 'whatsapp.not_configured');
  if (!integ.enabled) throw new ChannelSendError('Canal WhatsApp desabilitado', 'whatsapp.disabled');
  return integ.config;
}

const mockId = () => `wamid.mock.${crypto.randomBytes(9).toString('hex')}`;

async function postMessage(cfg: WaConfig, payload: Record<string, unknown>): Promise<string> {
  if (isMock(cfg)) return mockId();
  const res = await graphCall<{ messages?: Array<{ id: string }> }>(cfg, {
    method: 'POST', path: `${cfg.phoneNumberId}/messages`, noRetryOnTimeout: true,
    json: { messaging_product: 'whatsapp', recipient_type: 'individual', ...payload },
  });
  const id = res?.messages?.[0]?.id;
  if (!id) throw new ChannelSendError('Resposta da Graph sem id de mensagem', 'whatsapp.send_failed', true);
  return id;
}

async function uploadMedia(cfg: WaConfig, orgId: string, a: { key: string; name: string; mime: string }): Promise<{ id: string; type: WaMediaType }> {
  if (!a?.key || !a.key.startsWith(`${orgId}/`)) throw new ChannelSendError('Anexo inválido para este órgão', 'whatsapp.invalid_attachment');
  const type = mediaTypeOf(a.mime || 'application/octet-stream');
  checkMime(type, a.mime || '');
  let data: Buffer;
  try { data = await getObjectBuffer(a.key); } catch { throw new ChannelSendError('Anexo não encontrado no armazenamento', 'whatsapp.invalid_attachment'); }
  if (data.length > MEDIA_LIMITS[type]) throw new ChannelSendError(`Anexo excede o limite do WhatsApp para ${type}`, 'whatsapp.media_too_large');
  if (isMock(cfg)) return { id: `mock-media-${crypto.randomBytes(6).toString('hex')}`, type };
  const res = await graphCall<{ id?: string }>(cfg, {
    method: 'POST', path: `${cfg.phoneNumberId}/media`, noRetryOnTimeout: true,
    multipart: { fields: { messaging_product: 'whatsapp', type: a.mime }, file: { field: 'file', name: a.name || 'arquivo', mime: a.mime, data } },
  });
  if (!res?.id) throw new ChannelSendError('Upload de mídia sem id', 'whatsapp.media_error', true);
  return { id: res.id, type };
}

function interactivePayload(body: string, meta: any): Record<string, unknown> | null {
  const i = meta?.interactive;
  if (!i || typeof i !== 'object') return null;
  if (i.type === 'button') {
    const btns = (Array.isArray(i.buttons) ? i.buttons : []).slice(0, 3);
    if (!btns.length || btns.some((b: any) => !b?.id || !b?.title || String(b.title).length > 20)) throw new ChannelSendError('Botões interativos inválidos (até 3, título ≤ 20)', 'whatsapp.invalid_parameter');
    return { type: 'interactive', interactive: { type: 'button', body: { text: body.slice(0, 1024) }, action: { buttons: btns.map((b: any) => ({ type: 'reply', reply: { id: String(b.id).slice(0, 256), title: String(b.title) } })) } } };
  }
  if (i.type === 'list') {
    const sections = Array.isArray(i.sections) ? i.sections : [];
    const rows = sections.reduce((n: number, s: any) => n + (Array.isArray(s?.rows) ? s.rows.length : 0), 0);
    if (!sections.length || rows < 1 || rows > 10 || !i.buttonText || String(i.buttonText).length > 20) throw new ChannelSendError('Lista interativa inválida (1–10 itens, botão ≤ 20)', 'whatsapp.invalid_parameter');
    return { type: 'interactive', interactive: { type: 'list', body: { text: body.slice(0, 1024) }, action: { button: String(i.buttonText), sections: sections.map((s: any) => ({ title: String(s.title ?? '').slice(0, 24), rows: (s.rows ?? []).map((r: any) => ({ id: String(r.id).slice(0, 200), title: String(r.title).slice(0, 24), ...(r.description ? { description: String(r.description).slice(0, 72) } : {}) })) })) } } };
  }
  return null;
}

export const windowOpen = (lastInboundAt: Date | null | undefined, windowHours: number, now = Date.now()): boolean =>
  !!lastInboundAt && now - new Date(lastInboundAt).getTime() < windowHours * 3600_000;

/** Verifica template aprovado + parâmetros + cota (usado pelo envio e pelo pré-voo do endpoint send-template). */
export async function preflightTemplate(orgId: string, meta: TemplateSendMeta) {
  const name = String(meta?.templateName ?? '');
  const language = String(meta?.language ?? 'pt_BR');
  if (!name) throw new ChannelSendError('templateName é obrigatório', 'whatsapp.template_not_approved');
  const tpl = await prisma.bvWaTemplate.findUnique({ where: { orgId_name_language: { orgId, name, language } } });
  if (!tpl || tpl.status !== 'APPROVED') throw new ChannelSendError(`Template "${name}" (${language}) não está aprovado`, 'whatsapp.template_not_approved');
  const item = usageItemFor(tpl.category);
  let components: any[];
  try { components = buildTemplateComponents(tpl.components, meta); } catch (e) {
    if (e instanceof TemplateParamError) throw new ChannelSendError(e.message, 'whatsapp.template_params_mismatch');
    throw e;
  }
  try { await assertQuota(orgId, item); } catch (e) {
    if (e instanceof QuotaExceededError) throw new ChannelSendError(`Cota excedida para ${item}`, 'whatsapp.quota_exceeded');
    throw e;
  }
  return { tpl, item, components, name, language };
}

export async function whatsappSender(req: OutboundRequest): Promise<OutboundResult> {
  const { orgId, conversation, message } = req;
  const cfg = await requireWaConfig(orgId);
  const to = normalizePhone(conversation.channelRef ?? req.contact.phone);
  if (!to) throw new ChannelSendError('Contato sem número de WhatsApp', 'whatsapp.invalid_recipient');
  const settings = await getOrgSettings(orgId);
  const inWindow = windowOpen(conversation.lastInboundAt, settings.whatsapp.windowHours);
  const needWindow = (): void => {
    if (!inWindow) throw new ChannelSendError(`Fora da janela de ${settings.whatsapp.windowHours} h do WhatsApp: use uma mensagem de template aprovado`, 'whatsapp.outside_window');
  };

  try {
    if (message.kind === 'TEMPLATE') {
      const meta = (message.channelMeta ?? {}) as TemplateSendMeta;
      const pf = await preflightTemplate(orgId, meta);
      const id = await postMessage(cfg, {
        to, type: 'template',
        template: { name: pf.name, language: { code: pf.language }, ...(pf.components.length ? { components: pf.components } : {}) },
      });
      await recordUsage(orgId, pf.item, 1);
      return { channelMessageId: id, status: 'SENT', channelMeta: { wa: { category: pf.tpl.category, usageItem: pf.item, templateId: pf.tpl.id } } };
    }

    if (message.kind === 'NOTE' || message.kind === 'EVENT') throw new ChannelSendError('Tipo de mensagem não enviável pelo WhatsApp', 'whatsapp.unsupported_message_type');

    needWindow(); // texto livre e mídia só dentro da janela de atendimento

    const atts = message.attachments ?? [];
    if (atts.length) {
      let firstId: string | undefined;
      const caption = message.body?.slice(0, 1024) || undefined;
      for (let i = 0; i < atts.length; i++) {
        const up = await uploadMedia(cfg, orgId, atts[i]);
        const obj: Record<string, unknown> = { id: up.id };
        if (i === 0 && caption && up.type !== 'audio') obj.caption = caption;
        if (up.type === 'document') obj.filename = (atts[i].name || 'documento').slice(0, 240);
        const id = await postMessage(cfg, { to, type: up.type, [up.type]: obj });
        firstId ??= id;
      }
      // Áudio não aceita legenda: envia o texto à parte.
      if (caption && mediaTypeOf(atts[0].mime || '') === 'audio') await postMessage(cfg, { to, type: 'text', text: { body: caption } });
      return { channelMessageId: firstId, status: 'SENT', channelMeta: { wa: { media: atts.length } } };
    }

    if (message.kind !== 'TEXT') throw new ChannelSendError('Mensagem de mídia sem anexo', 'whatsapp.invalid_parameter');
    const body = message.body ?? '';
    if (!body.trim()) throw new ChannelSendError('Mensagem vazia', 'whatsapp.invalid_parameter');
    const inter = interactivePayload(body, message.channelMeta);
    if (inter) return { channelMessageId: await postMessage(cfg, { to, ...inter }), status: 'SENT' };
    const chunks = splitText(body);
    let firstId: string | undefined;
    for (const c of chunks) {
      const id = await postMessage(cfg, { to, type: 'text', text: { body: c, preview_url: false } });
      firstId ??= id;
    }
    return { channelMessageId: firstId, status: 'SENT', channelMeta: chunks.length > 1 ? { wa: { chunks: chunks.length } } : undefined };
  } catch (e) {
    const err = toChannelError(e);
    if (!['whatsapp.outside_window', 'whatsapp.quota_exceeded', 'whatsapp.template_not_approved'].includes(err.code)) {
      logger.warn({ orgId, code: err.code }, '[balcao/whatsapp] falha no envio');
      void logIntegration(orgId, 'WHATSAPP', 'send', false, { error: `${err.code}: ${err.message}` });
    }
    throw err;
  }
}
