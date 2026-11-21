import { MetaSendError, isMetaThrottleError, META_THROTTLE_CODES } from '../lib/meta-errors';

describe('isMetaThrottleError', () => {
  it.each([4, 17, 32, 613, 80007, 130429, 131048])('código %i é throttle de conta/número', (code) => {
    expect(isMetaThrottleError(new MetaSendError('x', code))).toBe(true);
  });

  it('HTTP 429 é throttle mesmo sem código', () => {
    expect(isMetaThrottleError(new MetaSendError('x', undefined, undefined, 429))).toBe(true);
  });

  it.each([131026, 131047, 131051, 131056, 100, 190])('código %i NÃO pausa a campanha (por contato/permanente/credencial)', (code) => {
    expect(isMetaThrottleError(new MetaSendError('x', code, undefined, 400))).toBe(false);
  });

  it('erro comum, string e nulos nunca são throttle', () => {
    expect(isMetaThrottleError(new Error('rate limit exceeded'))).toBe(false);
    expect(isMetaThrottleError('130429')).toBe(false);
    expect(isMetaThrottleError(null)).toBe(false);
    expect(isMetaThrottleError(undefined)).toBe(false);
  });

  it('a lista de throttle é exatamente a documentada', () => {
    expect([...META_THROTTLE_CODES].sort((a, b) => a - b)).toEqual([4, 17, 32, 613, 80007, 130429, 131048]);
  });
});
