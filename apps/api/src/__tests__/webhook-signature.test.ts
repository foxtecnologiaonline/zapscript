/**
 * Testes do contrato de assinatura dos webhooks de saída (API pública v1).
 *
 * O teste mais importante deste arquivo é o último: ele trava o bug que
 * existia em apps/worker/src/index.ts, onde o payload era assinado com o
 * secret CRIPTOGRAFADO em vez do secret em claro. A assinatura resultante
 * nunca validava no receptor — e como o endpoint /webhook-config/test
 * assinava certo, o teste manual passava e só o evento real falhava.
 */
import crypto from 'crypto';
import {
  signWebhookBody,
  verifyWebhookSignature,
  buildWebhookHeaders,
} from '../lib/webhook-signature';

const SECRET = 'a'.repeat(64);

describe('signWebhookBody', () => {
  it('produz sha256=<hex> estável para o mesmo corpo e secret', () => {
    const body = JSON.stringify({ event: 'message.received', data: { text: 'sim' } });
    const a = signWebhookBody(SECRET, body);
    const b = signWebhookBody(SECRET, body);
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it('bate com o HMAC-SHA256 que um receptor externo calcularia', () => {
    // Exatamente o que o integrador faz do outro lado — se este teste quebrar,
    // todo mundo que valida assinatura para de aceitar nossos eventos.
    const body = JSON.stringify({ event: 'message.received', timestamp: '2026-10-02T14:30:00Z' });
    const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex');
    expect(signWebhookBody(SECRET, body)).toBe(expected);
  });

  it('muda se o corpo muda (um byte basta)', () => {
    expect(signWebhookBody(SECRET, '{"a":1}')).not.toBe(signWebhookBody(SECRET, '{"a":2}'));
  });

  it('muda se o secret muda', () => {
    const body = '{"a":1}';
    expect(signWebhookBody(SECRET, body)).not.toBe(signWebhookBody('b'.repeat(64), body));
  });
});

describe('verifyWebhookSignature', () => {
  const body = JSON.stringify({ event: 'message.status', data: { status: 'sent' } });

  it('aceita a assinatura correta', () => {
    expect(verifyWebhookSignature(SECRET, body, signWebhookBody(SECRET, body))).toBe(true);
  });

  it('rejeita assinatura de outro secret', () => {
    expect(verifyWebhookSignature(SECRET, body, signWebhookBody('b'.repeat(64), body))).toBe(false);
  });

  it('rejeita corpo adulterado', () => {
    const sig = signWebhookBody(SECRET, body);
    expect(verifyWebhookSignature(SECRET, body + ' ', sig)).toBe(false);
  });

  it('rejeita ausência de assinatura sem explodir', () => {
    expect(verifyWebhookSignature(SECRET, body, undefined)).toBe(false);
    expect(verifyWebhookSignature(SECRET, body, null)).toBe(false);
    expect(verifyWebhookSignature(SECRET, body, '')).toBe(false);
  });

  it('rejeita assinatura de tamanho diferente sem quebrar o timingSafeEqual', () => {
    // timingSafeEqual lança se os buffers têm tamanhos diferentes — o guard de
    // tamanho precisa vir antes, senão um header curto vira erro 500.
    expect(() => verifyWebhookSignature(SECRET, body, 'sha256=abc')).not.toThrow();
    expect(verifyWebhookSignature(SECRET, body, 'sha256=abc')).toBe(false);
  });
});

describe('buildWebhookHeaders', () => {
  const base = {
    secretPlain: SECRET,
    rawBody:     JSON.stringify({ event: 'message.received', timestamp: '2026-10-02T14:30:00Z' }),
    event:       'message.received',
    deliveryId:  'c0ffee00-0000-4000-8000-000000000000',
    timestamp:   '2026-10-02T14:30:00Z',
  };

  it('inclui assinatura, evento, id de entrega e timestamp', () => {
    const h = buildWebhookHeaders(base);
    expect(h['X-ZapScript-Signature']).toBe(signWebhookBody(SECRET, base.rawBody));
    expect(h['X-ZapScript-Event']).toBe('message.received');
    expect(h['X-ZapScript-Delivery']).toBe(base.deliveryId);
    expect(h['X-ZapScript-Timestamp']).toBe(base.timestamp);
    expect(h['Content-Type']).toBe('application/json');
  });

  it('a assinatura cobre o timestamp, porque ele está dentro do corpo', () => {
    // É isso que dá proteção contra replay sem precisar de um segundo esquema
    // de assinatura: mexer no timestamp do payload invalida a assinatura.
    const tampered = base.rawBody.replace('2026-10-02T14:30:00Z', '2026-10-02T15:30:00Z');
    const h = buildWebhookHeaders(base);
    expect(verifyWebhookSignature(SECRET, tampered, h['X-ZapScript-Signature'])).toBe(false);
  });

  it('REGRESSÃO: assinar com o secret criptografado não valida do lado do receptor', () => {
    // Reproduz o bug corrigido: `WebhookConfig.secret` é guardado como
    // `iv:tag:ciphertext`. Se o disparo assina com esse blob em vez do secret
    // em claro, o receptor (que só conhece o secret em claro) rejeita tudo.
    const encryptedBlob = 'd34db33f:c0ffee:abcdef0123456789';
    const wrong = signWebhookBody(encryptedBlob, base.rawBody);
    expect(verifyWebhookSignature(SECRET, base.rawBody, wrong)).toBe(false);

    // E com o secret em claro, valida.
    const right = buildWebhookHeaders(base)['X-ZapScript-Signature'];
    expect(verifyWebhookSignature(SECRET, base.rawBody, right)).toBe(true);
  });
});
