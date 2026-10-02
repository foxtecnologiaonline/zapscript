/**
 * Log unificado de mensagens (item 5 do escopo ZapScript × Twilio).
 *
 * O caso que esta implementação precisa acertar e que uma ingênua erra: os
 * webhooks de status da Meta chegam FORA DE ORDEM. Um `delivered` atrasado não
 * pode apagar um `read` que já chegou.
 */

jest.mock('../lib/prisma', () => ({
  prisma: {
    messageLog: {
      create: jest.fn(), update: jest.fn(), findFirst: jest.fn(), deleteMany: jest.fn(),
    },
  },
}));

jest.mock('../services/events', () => ({ emitEvent: jest.fn().mockResolvedValue('evt-1') }));

import { prisma } from '../lib/prisma';
import { emitEvent } from '../services/events';
import {
  BODY_MAX_CHARS, isStatusProgress, truncateBody, normalizePhone,
  logQueuedOutbound, logSentOutbound, logInbound, markMessageSent, markMessageFailed,
  applyProviderStatus, toPublicMessage, purgeOldMessageLogs,
} from '../services/message-log';
import { ApiError } from '../lib/apiErrors';

const db = prisma as any;

const linha = (over: any = {}) => ({
  id: 'msg-1', userId: 'u1', status: 'queued', queuedAt: new Date('2026-10-02T10:00:00Z'),
  direction: 'outbound', channel: 'meta', source: 'api', toPhone: '5511999999999',
  fromPhone: null, type: 'text', body: 'oi', ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  db.messageLog.create.mockImplementation(({ data }: any) => Promise.resolve(linha(data)));
  db.messageLog.update.mockImplementation(({ data }: any) => Promise.resolve(linha(data)));
});

describe('helpers', () => {
  it('normaliza telefone para dígitos', () => {
    expect(normalizePhone('+55 (11) 99999-9999')).toBe('5511999999999');
    expect(normalizePhone('')).toBe('');
  });

  it('trunca o corpo no limite da mensagem de WhatsApp', () => {
    expect(truncateBody(null)).toBeNull();
    expect(truncateBody('curto')).toBe('curto');
    expect(truncateBody('x'.repeat(BODY_MAX_CHARS + 50))).toHaveLength(BODY_MAX_CHARS);
  });
});

describe('isStatusProgress — webhook da Meta chega fora de ordem', () => {
  it('avança na ordem do ciclo de vida', () => {
    expect(isStatusProgress('queued', 'sent')).toBe(true);
    expect(isStatusProgress('sent', 'delivered')).toBe(true);
    expect(isStatusProgress('delivered', 'read')).toBe(true);
  });

  it('NÃO regride — delivered atrasado não apaga read', () => {
    expect(isStatusProgress('read', 'delivered')).toBe(false);
    expect(isStatusProgress('delivered', 'sent')).toBe(false);
    expect(isStatusProgress('read', 'read')).toBe(false);
  });

  it('failed é terminal e vence qualquer estado, menos a si mesmo', () => {
    expect(isStatusProgress('read', 'failed')).toBe(true);
    expect(isStatusProgress('queued', 'failed')).toBe(true);
    expect(isStatusProgress('failed', 'failed')).toBe(false);
    expect(isStatusProgress('failed', 'delivered')).toBe(false);
  });
});

describe('gravação e emissão de evento', () => {
  it('logQueuedOutbound grava queued e emite message.queued', async () => {
    await logQueuedOutbound({
      userId: 'u1', channel: 'meta', source: 'api', toPhone: '+55 11 99999-9999', type: 'text', body: 'oi',
    });

    expect(db.messageLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ direction: 'outbound', status: 'queued', toPhone: '5511999999999' }),
    });
    expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'message.queued' }));
  });

  it('logSentOutbound (campanha/atende) grava sent e emite message.sent', async () => {
    await logSentOutbound({
      userId: 'u1', channel: 'evolution', source: 'campanha', toPhone: '5511999999999',
      type: 'text', body: 'promo', providerMessageId: 'evo-1',
    });
    expect(db.messageLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'sent', providerMessageId: 'evo-1', attempts: 1 }),
    });
    expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'message.sent' }));
  });

  it('logInbound grava received e emite message.received', async () => {
    await logInbound({
      userId: 'u1', channel: 'evolution', source: 'sistema', toPhone: '5511988887777',
      fromPhone: '5511999999999', type: 'audio', providerMessageId: 'evo-2',
    });
    expect(db.messageLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ direction: 'inbound', status: 'received' }),
    });
    expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'message.received' }));
  });

  it('falha de gravação NÃO propaga — a mensagem já saiu', async () => {
    db.messageLog.create.mockRejectedValueOnce(new Error('banco fora'));
    await expect(logSentOutbound({
      userId: 'u1', channel: 'meta', source: 'campanha', toPhone: '5511999999999', type: 'template',
    })).resolves.toBeNull();
  });
});

describe('markMessageSent / markMessageFailed', () => {
  it('sent limpa o erro anterior e guarda o wamid', async () => {
    await markMessageSent('msg-1', 'wamid.1', { attempts: 2 });
    expect(db.messageLog.update).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: expect.objectContaining({
        status: 'sent', providerMessageId: 'wamid.1', errorCode: null, errorMessage: null, attempts: 2,
      }),
    });
  });

  it('failed guarda o CÓDIGO do catálogo e a frase do provedor em separado', async () => {
    await markMessageFailed('msg-1', new ApiError('message.outside_window', { message: 'Re-engagement message' }));
    expect(db.messageLog.update).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: expect.objectContaining({
        status: 'failed',
        errorCode: 'message.outside_window',
        errorMessage: 'Re-engagement message',
      }),
    });
  });

  it('erro cru da Meta é traduzido antes de gravar', async () => {
    await markMessageFailed('msg-1', {
      response: { status: 400, data: { error: { code: 132001, message: 'Template not found' } } },
    }, { provider: 'meta' });
    expect(db.messageLog.update).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: expect.objectContaining({ errorCode: 'template.not_found' }),
    });
  });
});

describe('applyProviderStatus', () => {
  it('aplica delivered e emite o evento correspondente', async () => {
    db.messageLog.findFirst.mockResolvedValueOnce(linha({ status: 'sent' }));
    await applyProviderStatus('wamid.1', 'delivered');

    expect(db.messageLog.update).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: expect.objectContaining({ status: 'delivered', deliveredAt: expect.any(Date) }),
    });
    expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'message.delivered' }));
  });

  it('IGNORA regressão — delivered depois de read não altera nada', async () => {
    db.messageLog.findFirst.mockResolvedValueOnce(linha({ status: 'read' }));
    await expect(applyProviderStatus('wamid.1', 'delivered')).resolves.toBeNull();
    expect(db.messageLog.update).not.toHaveBeenCalled();
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it('sem correlação (mensagem anterior ao log) não cria linha nova', async () => {
    db.messageLog.findFirst.mockResolvedValueOnce(null);
    await expect(applyProviderStatus('wamid.desconhecido', 'read')).resolves.toBeNull();
    expect(db.messageLog.update).not.toHaveBeenCalled();
  });

  it('providerMessageId vazio é ignorado sem consultar o banco', async () => {
    await expect(applyProviderStatus('', 'delivered')).resolves.toBeNull();
    expect(db.messageLog.findFirst).not.toHaveBeenCalled();
  });

  it('failed grava código e frase vindos do webhook', async () => {
    db.messageLog.findFirst.mockResolvedValueOnce(linha({ status: 'sent' }));
    await applyProviderStatus('wamid.1', 'failed', {
      errorCode: 'message.undeliverable', errorMessage: 'Message undeliverable',
    });
    expect(db.messageLog.update).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: expect.objectContaining({
        status: 'failed', errorCode: 'message.undeliverable', failedAt: expect.any(Date),
      }),
    });
  });
});

describe('toPublicMessage', () => {
  it('expõe só o contrato público, com datas ISO e erro como objeto', () => {
    const pub = toPublicMessage({
      ...linha({ status: 'failed', errorCode: 'message.throttled', errorMessage: 'rate limit' }),
      providerMessageId: 'wamid.1', numberId: 'num-1', attempts: 3, idempotencyKey: 'k',
      sourceId: 'ct-1', updatedAt: new Date(), sentAt: new Date('2026-10-02T10:00:01Z'),
      deliveredAt: null, readAt: null, failedAt: new Date('2026-10-02T10:00:02Z'),
      templateName: null, templateLanguage: null, mediaUrl: null,
    });

    expect(pub.error).toEqual({ code: 'message.throttled', message: 'rate limit' });
    expect(pub.queuedAt).toBe('2026-10-02T10:00:00.000Z');
    expect(pub.deliveredAt).toBeNull();
    // Campos internos não vazam no contrato público.
    for (const k of ['attempts', 'idempotencyKey', 'sourceId', 'updatedAt', 'userId', 'errorCode']) {
      expect(pub).not.toHaveProperty(k);
    }
  });

  it('sem erro, o campo error é null (não um objeto vazio)', () => {
    expect(toPublicMessage(linha({ errorCode: null })).error).toBeNull();
  });
});

describe('purga', () => {
  it('MESSAGE_LOG_RETENTION_DAYS=0 guarda para sempre', async () => {
    const antes = process.env.MESSAGE_LOG_RETENTION_DAYS;
    process.env.MESSAGE_LOG_RETENTION_DAYS = '0';
    await expect(purgeOldMessageLogs()).resolves.toBe(0);
    expect(db.messageLog.deleteMany).not.toHaveBeenCalled();
    process.env.MESSAGE_LOG_RETENTION_DAYS = antes;
  });

  it('apaga acima da retenção configurada', async () => {
    const antes = process.env.MESSAGE_LOG_RETENTION_DAYS;
    process.env.MESSAGE_LOG_RETENTION_DAYS = '90';
    db.messageLog.deleteMany.mockResolvedValueOnce({ count: 42 });
    await expect(purgeOldMessageLogs()).resolves.toBe(42);
    process.env.MESSAGE_LOG_RETENTION_DAYS = antes;
  });
});

describe('sincronia de escopos da API pública', () => {
  it('ALLOWED_SCOPES e o schema de criação de chave listam exatamente o mesmo', () => {
    // Divergir aqui cria escopo que a autenticação não reconhece (ou escopo
    // reconhecido que ninguém consegue criar) — falha silenciosa dos dois lados.
    const { ALLOWED_SCOPES } = require('../lib/apiKeyAuth');
    const { createApiKeySchema } = require('../lib/validation');
    const doSchema: string[] = createApiKeySchema.shape.scopes._def.type.options;
    expect([...doSchema].sort()).toEqual([...ALLOWED_SCOPES].sort());
  });
});
