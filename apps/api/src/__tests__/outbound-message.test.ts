/**
 * Testes do recurso de envio da API pública v1 (services/outbound-message.ts).
 *
 * Foco no que diferencia este recurso do `POST /atende/avisos` antigo:
 *  - o status devolvido reflete o resultado REAL do envio (o avisos devolvia
 *    201 mesmo quando as 3 tentativas falhavam, e não guardava status);
 *  - idempotência: um POST repetido não manda a mensagem duas vezes para o
 *    WhatsApp do cliente final.
 */
jest.mock('../lib/prisma', () => ({
  prisma: {
    whatsappNumber:  { findFirst: jest.fn() },
    outboundMessage: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  },
}));
jest.mock('../services/send-with-retry', () => ({ sendTextWithRetry: jest.fn() }));
jest.mock('../lib/webhook-events', () => ({
  enqueueWebhook: jest.fn().mockResolvedValue(true),
  WEBHOOK_EVENTS: { MESSAGE_STATUS: 'message.status', MESSAGE_RECEIVED: 'message.received' },
}));
jest.mock('../lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

import { prisma } from '../lib/prisma';
import { sendTextWithRetry } from '../services/send-with-retry';
import { enqueueWebhook } from '../lib/webhook-events';
import { sendOutboundMessage, serializeOutboundMessage } from '../services/outbound-message';

const numberFindFirst = (prisma as any).whatsappNumber.findFirst as jest.Mock;
const msgFindUnique   = (prisma as any).outboundMessage.findUnique as jest.Mock;
const msgCreate       = (prisma as any).outboundMessage.create as jest.Mock;
const msgUpdate       = (prisma as any).outboundMessage.update as jest.Mock;
const sendRetry       = sendTextWithRetry as jest.Mock;
const enqueue         = enqueueWebhook as jest.Mock;

const ARGS = { userId: 'u1', numberId: 'n1', to: '5511999999999', body: 'Confirma sua consulta? SIM/NÃO' };

beforeEach(() => {
  [numberFindFirst, msgFindUnique, msgCreate, msgUpdate, sendRetry, enqueue].forEach((m) => m.mockReset());
  enqueue.mockResolvedValue(true);
  numberFindFirst.mockResolvedValue({ id: 'n1', userId: 'u1', zapiInstanceId: 'inst_1' });
  msgFindUnique.mockResolvedValue(null);
  msgCreate.mockImplementation(({ data }: any) => Promise.resolve({ id: 'msg_1', attempts: 0, ...data }));
  msgUpdate.mockImplementation(({ data }: any) => Promise.resolve({ id: 'msg_1', ...ARGS, ...data }));
});

describe('validação de número', () => {
  it('404 quando o número não é do usuário', async () => {
    numberFindFirst.mockResolvedValue(null);
    const r = await sendOutboundMessage(ARGS);
    expect(r).toEqual({ kind: 'error', code: 404, error: 'Número não encontrado.' });
    expect(sendRetry).not.toHaveBeenCalled();
  });

  it('422 quando o número não está conectado ao WhatsApp', async () => {
    numberFindFirst.mockResolvedValue({ id: 'n1', userId: 'u1', zapiInstanceId: null });
    const r: any = await sendOutboundMessage(ARGS);
    expect(r.kind).toBe('error');
    expect(r.code).toBe(422);
    expect(sendRetry).not.toHaveBeenCalled();
  });
});

describe('status reflete o envio real', () => {
  it('sucesso → status "sent" com sentAt e tentativas', async () => {
    sendRetry.mockResolvedValue({ success: true, attempts: 1 });

    const r: any = await sendOutboundMessage(ARGS);

    expect(r.kind).toBe('created');
    expect(r.message.status).toBe('sent');
    expect(msgUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'sent', attempts: 1 }),
    }));
  });

  it('falha → status "failed" com o motivo (e NÃO 201 silencioso)', async () => {
    // Este é o caso que o /atende/avisos antigo escondia: devolvia sucesso e o
    // integrador nunca descobria que a mensagem não saiu.
    sendRetry.mockResolvedValue({ success: false, attempts: 3, lastError: new Error('instance offline') });

    const r: any = await sendOutboundMessage(ARGS);

    expect(r.message.status).toBe('failed');
    expect(r.message.failureReason).toContain('instance offline');
    expect(msgUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'failed', attempts: 3, sentAt: null }),
    }));
  });

  it('dispara message.status depois de resolver o envio', async () => {
    sendRetry.mockResolvedValue({ success: true, attempts: 1 });
    await sendOutboundMessage(ARGS);
    expect(enqueue).toHaveBeenCalledWith(
      'u1', 'message.status', expect.objectContaining({ status: 'sent', to: ARGS.to }),
    );
  });
});

describe('idempotência', () => {
  it('replay com a mesma chave devolve o registro original e NÃO reenvia', async () => {
    const original = { id: 'msg_orig', status: 'sent', ...ARGS, idempotencyKey: 'chave-123' };
    msgFindUnique.mockResolvedValue(original);

    const r: any = await sendOutboundMessage({ ...ARGS, idempotencyKey: 'chave-123' });

    expect(r.kind).toBe('replayed');
    expect(r.message.id).toBe('msg_orig');
    // O ponto central: nada de mandar a mesma mensagem duas vezes pro paciente.
    expect(sendRetry).not.toHaveBeenCalled();
    expect(msgCreate).not.toHaveBeenCalled();
  });

  it('sem chave de idempotência, cada chamada envia (comportamento esperado)', async () => {
    sendRetry.mockResolvedValue({ success: true, attempts: 1 });
    await sendOutboundMessage(ARGS);
    await sendOutboundMessage(ARGS);
    expect(sendRetry).toHaveBeenCalledTimes(2);
    expect(msgFindUnique).not.toHaveBeenCalled();
  });

  it('corrida: P2002 no create devolve o registro vencedor em vez de erro', async () => {
    // Dois POSTs simultâneos com a mesma chave — o unique do banco decide.
    msgFindUnique
      .mockResolvedValueOnce(null)                                   // checagem inicial: ainda não existe
      .mockResolvedValueOnce({ id: 'msg_winner', status: 'sent' });   // após o conflito
    msgCreate.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));

    const r: any = await sendOutboundMessage({ ...ARGS, idempotencyKey: 'chave-123' });

    expect(r.kind).toBe('replayed');
    expect(r.message.id).toBe('msg_winner');
    expect(sendRetry).not.toHaveBeenCalled();
  });

  it('chave em branco é tratada como ausente (não cria colisão com string vazia)', async () => {
    sendRetry.mockResolvedValue({ success: true, attempts: 1 });
    await sendOutboundMessage({ ...ARGS, idempotencyKey: '   ' });
    expect(msgCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ idempotencyKey: null }),
    }));
  });
});

describe('serializeOutboundMessage', () => {
  it('não expõe userId nem colunas internas', () => {
    const out = serializeOutboundMessage({
      id: 'm1', userId: 'u1', numberId: 'n1', to: '55', body: 'oi',
      status: 'sent', attempts: 1, createdAt: new Date(), source: 'public_api',
    });
    expect(out).not.toHaveProperty('userId');
    expect(out).not.toHaveProperty('source');
    expect(out).toMatchObject({ id: 'm1', status: 'sent' });
  });
});
