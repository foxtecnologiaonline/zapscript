/**
 * Catálogo de códigos de erro (item 6 do escopo ZapScript × Twilio).
 *
 * O que estes testes protegem: o contrato público. Código de erro é API — se
 * um `code` muda de nome ou de status, todo cliente que programou `if (code
 * === 'message.outside_window')` quebra silenciosamente.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ApiError, ERROR_CATALOG, errorDocUrl, isRetryable, mapProviderError,
  providerErrorMessage, isApiError,
} from '../lib/apiErrors';

describe('catálogo', () => {
  it('todo código tem status HTTP válido e mensagem em pt-BR', () => {
    for (const [code, spec] of Object.entries(ERROR_CATALOG)) {
      expect(spec.status).toBeGreaterThanOrEqual(400);
      expect(spec.status).toBeLessThan(600);
      expect(spec.message.length).toBeGreaterThan(5);
      // Prefixo de domínio — é o que permite ao cliente tratar código novo/desconhecido.
      expect(code).toMatch(/^[a-z]+\.[a-z0-9_]+$/);
    }
  });

  it('códigos publicados não podem ser renomeados nem mudar de status', () => {
    // Trava intencional: mexer aqui é mudança de contrato público, não refactor.
    const congelados: Record<string, number> = {
      'auth.key_missing': 401,
      'auth.key_invalid': 401,
      'auth.scope_missing': 403,
      'auth.plan_required': 402,
      'request.invalid': 400,
      'request.rate_limited': 429,
      'idempotency.request_mismatch': 422,
      'idempotency.in_progress': 409,
      'message.outside_window': 409,
      'message.recipient_opted_out': 409,
      'message.throttled': 429,
      'template.not_found': 400,
      'template.param_mismatch': 400,
      'number.disconnected': 409,
      'provider.unavailable': 502,
      'provider.timeout': 504,
      'internal.error': 500,
    };
    for (const [code, status] of Object.entries(congelados)) {
      expect((ERROR_CATALOG as any)[code]).toBeDefined();
      expect((ERROR_CATALOG as any)[code].status).toBe(status);
    }
  });

  it('marca como retryable só o que faz sentido repetir', () => {
    expect(isRetryable('provider.unavailable')).toBe(true);
    expect(isRetryable('provider.timeout')).toBe(true);
    expect(isRetryable('request.rate_limited')).toBe(true);
    expect(isRetryable('message.throttled')).toBe(true);
    // Repetir estes dá o MESMO erro — retentar só queima quota.
    expect(isRetryable('message.invalid_recipient')).toBe(false);
    expect(isRetryable('template.param_mismatch')).toBe(false);
    expect(isRetryable('message.outside_window')).toBe(false);
    expect(isRetryable('codigo.que.nao.existe')).toBe(false);
  });
});

describe('ApiError', () => {
  it('serializa no envelope público com docUrl e requestId', () => {
    const err = new ApiError('message.outside_window');
    expect(err.status).toBe(409);
    expect(err.toEnvelope('req-7')).toEqual({
      error: {
        code: 'message.outside_window',
        message: ERROR_CATALOG['message.outside_window'].message,
        docUrl: errorDocUrl('message.outside_window'),
        retryable: false,
        requestId: 'req-7',
      },
    });
  });

  it('aceita mensagem e details sobrepostos, omite requestId quando não há', () => {
    const err = new ApiError('request.invalid', {
      message: 'to é obrigatório',
      details: { field: 'to' },
    });
    const env = err.toEnvelope();
    expect(env.error.message).toBe('to é obrigatório');
    expect(env.error.details).toEqual({ field: 'to' });
    expect(env.error.requestId).toBeUndefined();
  });

  it('isApiError reconhece a instância', () => {
    expect(isApiError(new ApiError('internal.error'))).toBe(true);
    expect(isApiError(new Error('qualquer'))).toBe(false);
  });
});

describe('mapProviderError — Meta Cloud API', () => {
  const metaErr = (code: number, message = 'erro da meta', status = 400) => ({
    isAxiosError: true,
    message: 'Request failed',
    response: { status, data: { error: { code, message } } },
  });

  it.each([
    [131047, 'message.outside_window'],
    [131026, 'message.undeliverable'],
    [132001, 'template.not_found'],
    [132000, 'template.param_mismatch'],
    [132015, 'template.not_approved'],
    [133010, 'number.not_registered'],
    [131031, 'account.restricted'],
    [131042, 'account.balance_insufficient'],
    [130429, 'message.throttled'],
    [80007,  'message.throttled'],
    [131052, 'message.media_url_invalid'],
    [190,    'number.missing_credentials'],
  ])('código %i da Meta → %s', (metaCode, esperado) => {
    const err = mapProviderError(metaErr(metaCode as number), { provider: 'meta' });
    expect(err.code).toBe(esperado);
    expect(err.providerCode).toBe(String(metaCode));
  });

  it('preserva a mensagem da Meta (é o que o suporte precisa ler)', () => {
    const err = mapProviderError(metaErr(131047, 'Re-engagement message'), { provider: 'meta' });
    expect(err.message).toBe('Re-engagement message');
  });

  it('prefere error_user_msg quando a Meta manda texto para o usuário final', () => {
    const raw = {
      response: { status: 400, data: { error: { code: 131009, message: 'tecnico', error_user_msg: 'Número inválido' } } },
    };
    expect(providerErrorMessage(raw)).toBe('Número inválido');
  });

  it('código desconhecido da Meta não quebra — cai no fallback por status', () => {
    const err = mapProviderError(metaErr(999999, 'coisa nova', 400), { provider: 'meta' });
    expect(err.code).toBe('provider.rejected');
    const err5xx = mapProviderError(metaErr(999999, 'instavel', 503), { provider: 'meta' });
    expect(err5xx.code).toBe('provider.unavailable');
    expect(err5xx.retryable).toBe(true);
  });
});

describe('mapProviderError — Evolution API e rede', () => {
  const evoErr = (message: string, status = 400) => ({
    isAxiosError: true,
    message: 'Request failed',
    response: { status, data: { message } },
  });

  it.each([
    ['Connection Closed',                'number.disconnected'],
    ['instance does not exist',          'number.disconnected'],
    ['{"exists": false}',                'message.invalid_recipient'],
    ['number not exists on WhatsApp',    'message.invalid_recipient'],
    ['Too Many Requests',                'request.rate_limited'],
    ['request timed out',                'provider.timeout'],
    ['Unauthorized',                     'number.missing_credentials'],
  ])('Evolution %s → %s', (texto, esperado) => {
    expect(mapProviderError(evoErr(texto as string), { provider: 'evolution' }).code).toBe(esperado);
  });

  it('erro de rede antes de qualquer resposta vira timeout/indisponível', () => {
    expect(mapProviderError({ code: 'ETIMEDOUT', message: 'timeout of 15000ms exceeded' }).code)
      .toBe('provider.timeout');
    expect(mapProviderError({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' }).code)
      .toBe('provider.unavailable');
    expect(mapProviderError({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND' }).code)
      .toBe('provider.unavailable');
  });

  it('ApiError que já tem código passa intacto (não re-mapeia)', () => {
    const original = new ApiError('message.recipient_opted_out');
    expect(mapProviderError(original)).toBe(original);
  });

  it('respeita o fallback pedido pelo chamador', () => {
    const err = mapProviderError({ message: 'algo opaco' }, { fallback: 'template.create_failed' });
    expect(err.code).toBe('template.create_failed');
  });
});

describe('cópia do catálogo no worker', () => {
  it('é byte a byte idêntica à da API', () => {
    // O worker precisa do mesmo catálogo (carimba errorCode no MessageLog e
    // decide retry), mas os Dockerfiles de api e worker não compartilham
    // packages/*. Se este teste falhar: copie o arquivo da API para o worker.
    const api    = readFileSync(join(__dirname, '../lib/apiErrors.ts'), 'utf8');
    const worker = readFileSync(join(__dirname, '../../../worker/src/lib/apiErrors.ts'), 'utf8');
    expect(worker).toBe(api);
  });
});
