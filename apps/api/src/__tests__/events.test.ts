/**
 * Sistema de eventos de saída (item 2 do escopo ZapScript × Twilio).
 *
 * O que estes testes protegem:
 *  • a assinatura HMAC (um cliente que valida errado para de receber tudo);
 *  • a inscrição por tipo (receber evento não assinado é vazamento de dado);
 *  • a migração do WebhookConfig antigo (quem já tinha webhook não pode parar
 *    de receber porque o sistema novo entrou);
 *  • o portão de "tem alguém escutando?" (campanha de 10 mil contatos não pode
 *    gravar 10 mil eventos que ninguém lê).
 */
import crypto from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

jest.mock('../lib/prisma', () => ({
  prisma: {
    platformEvent:   { create: jest.fn(), deleteMany: jest.fn() },
    webhookEndpoint: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), count: jest.fn() },
    webhookDelivery: { create: jest.fn() },
    webhookConfig:   { findUnique: jest.fn(), count: jest.fn() },
  },
}));

jest.mock('../services/queue', () => ({
  redis:         { get: jest.fn(), set: jest.fn(), del: jest.fn() },
  webhooksQueue: { add: jest.fn().mockResolvedValue({}) },
}));

jest.mock('../services/encryption', () => ({
  encryptStr: jest.fn((v: string) => `enc(${v})`),
  decryptStr: jest.fn((v: string) => v.replace(/^enc\(/, '').replace(/\)$/, '')),
}));

import { prisma } from '../lib/prisma';
import { redis, webhooksQueue } from '../services/queue';
import {
  EVENT_TYPES, isKnownEventType, endpointSubscribes, signV1, signLegacy,
  buildSignature, generateWebhookSecret, revealWebhookSecret, emitEvent,
  ensureLegacyEndpointMigrated, toEventEnvelope, purgeOldEvents,
} from '../services/events';

const db = prisma as any;

beforeEach(() => {
  jest.clearAllMocks();
  (redis.get as jest.Mock).mockResolvedValue(null);
  (redis.set as jest.Mock).mockResolvedValue('OK');
  db.webhookConfig.count.mockResolvedValue(0);
  db.webhookConfig.findUnique.mockResolvedValue(null);
  db.webhookEndpoint.count.mockResolvedValue(1); // por padrão há ouvinte
  db.webhookEndpoint.findMany.mockResolvedValue([]);
  db.webhookEndpoint.findFirst.mockResolvedValue(null);
  db.platformEvent.create.mockResolvedValue({ id: 'evt-1', type: 'message.sent', createdAt: new Date(), data: {} });
  db.webhookDelivery.create.mockImplementation(({ data }: any) =>
    Promise.resolve({ id: `del-${data.endpointId}`, ...data }));
});

describe('catálogo de tipos', () => {
  it('tipos publicados não podem ser renomeados', () => {
    // Renomear um tipo quebra silenciosamente a inscrição de todo cliente.
    for (const t of [
      'message.queued', 'message.sent', 'message.delivered', 'message.read',
      'message.failed', 'message.received', 'transcription.completed',
      'campaign.completed',
    ]) {
      expect(EVENT_TYPES as readonly string[]).toContain(t);
    }
    expect(isKnownEventType('message.sent')).toBe(true);
    expect(isKnownEventType('coisa.inventada')).toBe(false);
  });
});

describe('endpointSubscribes', () => {
  it('"*" recebe tudo, inclusive tipo futuro', () => {
    expect(endpointSubscribes(['*'], 'message.sent')).toBe(true);
    expect(endpointSubscribes(['*'], 'tipo.que.nao.existe.ainda')).toBe(true);
  });

  it('tipo exato só recebe o seu', () => {
    expect(endpointSubscribes(['message.sent'], 'message.sent')).toBe(true);
    expect(endpointSubscribes(['message.sent'], 'message.failed')).toBe(false);
  });

  it('curinga por prefixo funciona — é o que todo integrador tenta escrever', () => {
    expect(endpointSubscribes(['message.*'], 'message.delivered')).toBe(true);
    expect(endpointSubscribes(['message.*'], 'campaign.completed')).toBe(false);
  });

  it('lista vazia não recebe nada', () => {
    expect(endpointSubscribes([], 'message.sent')).toBe(false);
    expect(endpointSubscribes(undefined as any, 'message.sent')).toBe(false);
  });
});

describe('assinatura', () => {
  it('v1 carrega timestamp DENTRO do hmac (resiste a replay)', () => {
    const sig = signV1('segredo', '{"a":1}', 1_700_000_000);
    expect(sig).toMatch(/^t=1700000000,v1=[0-9a-f]{64}$/);

    const esperado = crypto.createHmac('sha256', 'segredo')
      .update('1700000000.{"a":1}').digest('hex');
    expect(sig).toBe(`t=1700000000,v1=${esperado}`);

    // O mesmo corpo em outro instante produz assinatura diferente — é o que
    // impede reenviar uma entrega capturada.
    expect(signV1('segredo', '{"a":1}', 1_700_000_001)).not.toBe(sig);
  });

  it('legado mantém exatamente o formato do webhook antigo', () => {
    // Formato que as integrações em produção já validam: mudar isto as quebra.
    const esperado = crypto.createHmac('sha256', 'segredo').update('{"a":1}').digest('hex');
    expect(signLegacy('segredo', '{"a":1}')).toBe(`sha256=${esperado}`);
  });

  it('buildSignature escolhe o esquema pelo endpoint', () => {
    expect(buildSignature('legacy', 's', 'b')).toMatch(/^sha256=/);
    expect(buildSignature('v1', 's', 'b')).toMatch(/^t=\d+,v1=/);
  });

  it('segredo nasce com prefixo reconhecível e volta do cofre', () => {
    const { secret, encrypted } = generateWebhookSecret();
    expect(secret).toMatch(/^whsec_[0-9a-f]{48}$/);
    expect(encrypted).toBe(`enc(${secret})`);
    expect(revealWebhookSecret(encrypted)).toBe(secret);
  });
});

describe('emitEvent', () => {
  it('não grava nada quando ninguém está escutando', async () => {
    // Campanha de 10 mil contatos num cliente sem webhook: 10 mil linhas que
    // ninguém leria. O MessageLog já guarda o que aconteceu.
    db.webhookEndpoint.count.mockResolvedValueOnce(0);
    db.webhookConfig.count.mockResolvedValueOnce(0);

    await expect(emitEvent({ userId: 'u1', type: 'message.sent', data: {} })).resolves.toBeNull();
    expect(db.platformEvent.create).not.toHaveBeenCalled();
  });

  it('grava o evento e enfileira uma entrega por endpoint inscrito', async () => {
    db.webhookEndpoint.findMany.mockResolvedValueOnce([
      { id: 'ep-1', events: ['message.sent'], active: true },
      { id: 'ep-2', events: ['*'],            active: true },
      { id: 'ep-3', events: ['campaign.completed'], active: true }, // não inscrito
    ]);

    const id = await emitEvent({ userId: 'u1', type: 'message.sent', data: { message: { id: 'm1' } }, resourceId: 'm1' });

    expect(id).toBe('evt-1');
    expect(db.webhookDelivery.create).toHaveBeenCalledTimes(2);
    expect(webhooksQueue.add).toHaveBeenCalledTimes(2);
    // jobId = id da entrega: reenfileiramento no Redis não entrega duas vezes.
    expect(webhooksQueue.add).toHaveBeenCalledWith('deliver', { deliveryId: 'del-ep-1' }, { jobId: 'del-ep-1' });
  });

  it('entrega duplicada (P2002) é ignorada sem enfileirar', async () => {
    db.webhookEndpoint.findMany.mockResolvedValueOnce([{ id: 'ep-1', events: ['*'], active: true }]);
    db.webhookDelivery.create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }));

    await emitEvent({ userId: 'u1', type: 'message.sent', data: {} });
    expect(webhooksQueue.add).not.toHaveBeenCalled();
  });

  it('NUNCA lança — falha de evento não pode derrubar um envio', async () => {
    db.platformEvent.create.mockRejectedValueOnce(new Error('banco fora'));
    await expect(emitEvent({ userId: 'u1', type: 'message.sent', data: {} })).resolves.toBeNull();
  });

  it('usa o cache de ouvinte em vez de consultar por mensagem', async () => {
    (redis.get as jest.Mock).mockResolvedValueOnce('1');
    db.webhookEndpoint.findMany.mockResolvedValueOnce([]);
    await emitEvent({ userId: 'u1', type: 'message.sent', data: {} });
    expect(db.webhookEndpoint.count).not.toHaveBeenCalled();
  });

  it('cache negativo evita gravar evento sem releitura', async () => {
    (redis.get as jest.Mock).mockResolvedValueOnce('0');
    await expect(emitEvent({ userId: 'u1', type: 'message.sent', data: {} })).resolves.toBeNull();
    expect(db.webhookEndpoint.count).not.toHaveBeenCalled();
    expect(db.platformEvent.create).not.toHaveBeenCalled();
  });
});

describe('migração do webhook legado', () => {
  it('cria endpoint com formato de assinatura LEGADO e inscrito em tudo', async () => {
    db.webhookConfig.findUnique.mockResolvedValueOnce({
      userId: 'u1', url: 'https://cliente.com/hook', secret: 'enc(segredo-antigo)', active: true,
    });
    db.webhookEndpoint.findFirst.mockResolvedValueOnce(null);
    db.webhookEndpoint.create.mockResolvedValueOnce({ id: 'ep-legacy' });

    await ensureLegacyEndpointMigrated('u1');

    expect(db.webhookEndpoint.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'u1',
        url: 'https://cliente.com/hook',
        // Reaproveita o segredo JÁ criptografado: regerar quebraria a validação
        // que o cliente tem em produção.
        secret: 'enc(segredo-antigo)',
        events: ['*'],
        signatureScheme: 'legacy',
      }),
    });
  });

  it('não duplica quando já migrado', async () => {
    db.webhookConfig.findUnique.mockResolvedValueOnce({ userId: 'u1', url: 'x', secret: 'y', active: true });
    db.webhookEndpoint.findFirst.mockResolvedValueOnce({ id: 'ep-legacy' });
    await ensureLegacyEndpointMigrated('u1');
    expect(db.webhookEndpoint.create).not.toHaveBeenCalled();
  });

  it('config inativo não migra', async () => {
    db.webhookConfig.findUnique.mockResolvedValueOnce({ userId: 'u1', url: 'x', secret: 'y', active: false });
    await ensureLegacyEndpointMigrated('u1');
    expect(db.webhookEndpoint.create).not.toHaveBeenCalled();
  });
});

describe('envelope e purga', () => {
  it('envelope do evento tem id, type, createdAt ISO e data', () => {
    const createdAt = new Date('2026-10-02T12:00:00.000Z');
    expect(toEventEnvelope({ id: 'evt-1', type: 'message.sent', createdAt, data: { a: 1 } })).toEqual({
      id: 'evt-1', type: 'message.sent', createdAt: '2026-10-02T12:00:00.000Z', data: { a: 1 },
    });
  });

  it('data nulo vira objeto vazio (nunca null no payload público)', () => {
    expect(toEventEnvelope({ id: 'e', type: 't', createdAt: new Date(), data: null }).data).toEqual({});
  });

  it('purga respeita EVENT_RETENTION_DAYS=0 como "guardar para sempre"', async () => {
    const antes = process.env.EVENT_RETENTION_DAYS;
    process.env.EVENT_RETENTION_DAYS = '0';
    await expect(purgeOldEvents()).resolves.toBe(0);
    expect(db.platformEvent.deleteMany).not.toHaveBeenCalled();
    process.env.EVENT_RETENTION_DAYS = antes;
  });

  it('purga apaga acima da retenção', async () => {
    const antes = process.env.EVENT_RETENTION_DAYS;
    process.env.EVENT_RETENTION_DAYS = '30';
    db.platformEvent.deleteMany.mockResolvedValueOnce({ count: 12 });
    await expect(purgeOldEvents()).resolves.toBe(12);
    process.env.EVENT_RETENTION_DAYS = antes;
  });
});

describe('cópia no worker', () => {
  it('é byte a byte idêntica à da API', () => {
    const api    = readFileSync(join(__dirname, '../services/events.ts'), 'utf8');
    const worker = readFileSync(join(__dirname, '../../../worker/src/services/events.ts'), 'utf8');
    expect(worker).toBe(api);
  });
});
