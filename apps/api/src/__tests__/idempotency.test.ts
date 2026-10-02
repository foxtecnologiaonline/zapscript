/**
 * Idempotência das escritas (item 3 do escopo ZapScript × Twilio).
 *
 * O que está em jogo nestes testes: mensagem de WhatsApp DUPLICADA no celular
 * do contato final. Um retry de rede do cliente não pode executar o envio duas
 * vezes, e uma chave reusada com outro corpo não pode receber a resposta da
 * requisição anterior.
 */

jest.mock('../lib/prisma', () => ({
  prisma: {
    idempotencyRecord: {
      create: jest.fn(), findUnique: jest.fn(), update: jest.fn(),
      delete: jest.fn(), deleteMany: jest.fn(),
    },
  },
}));

import { prisma } from '../lib/prisma';
import {
  canonicalJson, hashPayload, readIdempotencyKey, withIdempotency,
  purgeExpiredIdempotencyRecords,
} from '../lib/idempotency';
import { ApiError } from '../lib/apiErrors';

const rec = prisma.idempotencyRecord as any;

/** Erro de unique violation do Prisma. */
const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });

const futuro = () => new Date(Date.now() + 3_600_000);
const passado = () => new Date(Date.now() - 1_000);

beforeEach(() => {
  jest.clearAllMocks();
  rec.create.mockResolvedValue({ id: 'idem-1' });
  rec.update.mockResolvedValue({});
  rec.delete.mockResolvedValue({});
});

describe('canonicalJson', () => {
  it('ordena chaves — ordem do objeto não muda o hash', () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }));
    expect(hashPayload('s', { to: '55', text: 'oi' })).toBe(hashPayload('s', { text: 'oi', to: '55' }));
  });

  it('ignora undefined e desce em aninhados e listas', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalJson({ t: { z: 1, a: [{ y: 1, x: 2 }] } })).toBe('{"t":{"a":[{"x":2,"y":1}],"z":1}}');
  });

  it('escopo diferente gera hash diferente para o mesmo corpo', () => {
    expect(hashPayload('POST /a', { x: 1 })).not.toBe(hashPayload('POST /b', { x: 1 }));
  });

  it('não entra em laço com referência circular', () => {
    const circular: any = { a: 1 };
    circular.self = circular;
    expect(() => canonicalJson(circular)).not.toThrow();
  });
});

describe('readIdempotencyKey', () => {
  it('lê Idempotency-Key e X-Idempotency-Key', () => {
    expect(readIdempotencyKey({ 'idempotency-key': 'abcdefgh' })).toBe('abcdefgh');
    expect(readIdempotencyKey({ 'x-idempotency-key': 'abcdefgh' })).toBe('abcdefgh');
  });

  it('ausente não é erro — devolve null', () => {
    expect(readIdempotencyKey({})).toBeNull();
    expect(readIdempotencyKey({ 'idempotency-key': '   ' })).toBeNull();
  });

  it('recusa chave curta ou com caractere inválido', () => {
    expect(() => readIdempotencyKey({ 'idempotency-key': 'curta' })).toThrow(ApiError);
    expect(() => readIdempotencyKey({ 'idempotency-key': 'com espaço aqui' })).toThrow(ApiError);
    try {
      readIdempotencyKey({ 'idempotency-key': 'abc' });
    } catch (err) {
      expect((err as ApiError).code).toBe('idempotency.key_invalid');
    }
  });
});

describe('withIdempotency — caminho novo', () => {
  it('executa e grava a resposta', async () => {
    const run = jest.fn().mockImplementation(async ({ setResourceId }: any) => {
      setResourceId('msg-1');
      return { statusCode: 202, body: { data: { id: 'msg-1' } } };
    });

    const out = await withIdempotency({
      userId: 'u1', scope: 'POST /m', headers: { 'idempotency-key': 'chave-do-cliente-1' },
      payload: { to: '5511' }, run,
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ statusCode: 202, replayed: false, key: 'chave-do-cliente-1', autoDerived: false });
    expect(rec.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'idem-1' },
      data: expect.objectContaining({ status: 'completed', statusCode: 202, resourceId: 'msg-1' }),
    }));
  });

  it('sem header, deriva chave do corpo (rede de segurança) e marca autoDerived', async () => {
    const run = jest.fn().mockResolvedValue({ statusCode: 202, body: {} });
    const out = await withIdempotency({
      userId: 'u1', scope: 'POST /m', headers: {}, payload: { to: '5511' }, run,
    });

    expect(out.autoDerived).toBe(true);
    expect(out.key).toMatch(/^auto:[0-9a-f]{48}$/);
    expect(rec.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ autoDerived: true }),
    }));
  });
});

describe('withIdempotency — repetição da mesma chave', () => {
  it('replay: devolve a resposta gravada SEM executar de novo', async () => {
    rec.create.mockRejectedValueOnce(p2002);
    rec.findUnique.mockResolvedValueOnce({
      id: 'idem-1', status: 'completed', statusCode: 202,
      responseBody: { data: { id: 'msg-ja-enviada' } },
      requestHash: hashPayload('POST /m', { to: '5511' }),
      expiresAt: futuro(),
    });

    const run = jest.fn();
    const out = await withIdempotency({
      userId: 'u1', scope: 'POST /m', headers: { 'idempotency-key': 'chave-repetida-1' },
      payload: { to: '5511' }, run,
    });

    // Este é O teste do item 3: o envio NÃO acontece de novo.
    expect(run).not.toHaveBeenCalled();
    expect(out.replayed).toBe(true);
    expect(out.statusCode).toBe(202);
    expect(out.body).toEqual({ data: { id: 'msg-ja-enviada' } });
  });

  it('mesma chave com corpo diferente → 422 request_mismatch', async () => {
    rec.create.mockRejectedValueOnce(p2002);
    rec.findUnique.mockResolvedValueOnce({
      id: 'idem-1', status: 'completed', statusCode: 202, responseBody: {},
      requestHash: hashPayload('POST /m', { to: '5511', text: 'primeira' }),
      expiresAt: futuro(),
    });

    const run = jest.fn();
    await expect(withIdempotency({
      userId: 'u1', scope: 'POST /m', headers: { 'idempotency-key': 'chave-reusada-1' },
      payload: { to: '5511', text: 'OUTRA mensagem' }, run,
    })).rejects.toMatchObject({ code: 'idempotency.request_mismatch', status: 422 });

    expect(run).not.toHaveBeenCalled();
  });

  it('chave ainda em execução → 409 in_progress (retryable)', async () => {
    rec.create.mockRejectedValueOnce(p2002);
    rec.findUnique.mockResolvedValueOnce({
      id: 'idem-1', status: 'in_progress', statusCode: null, responseBody: null,
      requestHash: hashPayload('POST /m', { to: '5511' }),
      expiresAt: futuro(),
    });

    const run = jest.fn();
    const err = await withIdempotency({
      userId: 'u1', scope: 'POST /m', headers: { 'idempotency-key': 'chave-em-voo-1' },
      payload: { to: '5511' }, run,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('idempotency.in_progress');
    expect(err.retryable).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });

  it('registro vencido é descartado e a execução acontece de novo', async () => {
    rec.create.mockRejectedValueOnce(p2002).mockResolvedValueOnce({ id: 'idem-2' });
    rec.findUnique.mockResolvedValueOnce({
      id: 'idem-velho', status: 'completed', statusCode: 202, responseBody: {},
      requestHash: hashPayload('POST /m', { to: '5511' }),
      expiresAt: passado(),
    });

    const run = jest.fn().mockResolvedValue({ statusCode: 202, body: { novo: true } });
    const out = await withIdempotency({
      userId: 'u1', scope: 'POST /m', headers: { 'idempotency-key': 'chave-vencida-1' },
      payload: { to: '5511' }, run,
    });

    expect(rec.delete).toHaveBeenCalledWith({ where: { id: 'idem-velho' } });
    expect(run).toHaveBeenCalledTimes(1);
    expect(out.body).toEqual({ novo: true });
  });
});

describe('withIdempotency — tratamento de erro', () => {
  it('erro definitivo do cliente (4xx) fica GRAVADO — o retry recebe o mesmo erro', async () => {
    const run = jest.fn().mockRejectedValue(new ApiError('template.param_mismatch'));

    await expect(withIdempotency({
      userId: 'u1', scope: 'POST /m', headers: { 'idempotency-key': 'chave-com-erro-1' },
      payload: {}, run,
    })).rejects.toMatchObject({ code: 'template.param_mismatch' });

    expect(rec.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'completed', statusCode: 400 }),
    }));
    expect(rec.delete).not.toHaveBeenCalled();
  });

  it('falha transitória LIBERA a chave — senão o cliente não consegue reenviar o que nunca saiu', async () => {
    const run = jest.fn().mockRejectedValue(new ApiError('provider.unavailable'));

    await expect(withIdempotency({
      userId: 'u1', scope: 'POST /m', headers: { 'idempotency-key': 'chave-transitoria-1' },
      payload: {}, run,
    })).rejects.toMatchObject({ code: 'provider.unavailable' });

    expect(rec.delete).toHaveBeenCalledWith({ where: { id: 'idem-1' } });
  });

  it('erro inesperado (não-ApiError) também libera a chave', async () => {
    const run = jest.fn().mockRejectedValue(new Error('boom'));
    await expect(withIdempotency({
      userId: 'u1', scope: 'POST /m', headers: { 'idempotency-key': 'chave-boom-12' },
      payload: {}, run,
    })).rejects.toThrow('boom');
    expect(rec.delete).toHaveBeenCalled();
  });

  it('falha ao GRAVAR a resposta não derruba um envio que já aconteceu', async () => {
    rec.update.mockRejectedValueOnce(new Error('banco fora'));
    const run = jest.fn().mockResolvedValue({ statusCode: 202, body: { ok: true } });

    const out = await withIdempotency({
      userId: 'u1', scope: 'POST /m', headers: { 'idempotency-key': 'chave-db-fora-1' },
      payload: {}, run,
    });
    expect(out.body).toEqual({ ok: true });
  });
});

describe('purga', () => {
  it('remove os vencidos', async () => {
    (prisma.idempotencyRecord as any).deleteMany.mockResolvedValueOnce({ count: 7 });
    await expect(purgeExpiredIdempotencyRecords()).resolves.toBe(7);
    expect((prisma.idempotencyRecord as any).deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: expect.any(Date) } },
    });
  });
});
