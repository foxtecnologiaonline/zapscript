const incr = jest.fn();
const expire = jest.fn();
jest.mock('../lib/queue', () => ({ redis: { incr: (...a: any[]) => incr(...a), expire: (...a: any[]) => expire(...a) } }));
jest.mock('../lib/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));

import { acquireSendSlot } from '../lib/send-rate-limit';

describe('acquireSendSlot', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('permite até o teto da janela e bloqueia o excedente', async () => {
    incr.mockResolvedValueOnce(1).mockResolvedValueOnce(5).mockResolvedValueOnce(6);
    expect(await acquireSendSlot('n1', 5)).toBe(true);
    expect(await acquireSendSlot('n1', 5)).toBe(true);  // 5º ainda cabe
    expect(await acquireSendSlot('n1', 5)).toBe(false); // 6º estoura
  });

  it('só define expiração na 1ª contagem da janela', async () => {
    incr.mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    await acquireSendSlot('n1', 5);
    await acquireSendSlot('n1', 5);
    expect(expire).toHaveBeenCalledTimes(1);
    expect(expire).toHaveBeenCalledWith(expect.stringMatching(/^campanhas:rl:n1:\d+$/), 2);
  });

  it('isola por número: chaves diferentes por numberId', async () => {
    incr.mockResolvedValue(1);
    await acquireSendSlot('nA', 5);
    await acquireSendSlot('nB', 5);
    const keys = incr.mock.calls.map((c) => c[0] as string);
    expect(keys[0]).toContain(':nA:');
    expect(keys[1]).toContain(':nB:');
  });

  it('fail-open: se o Redis falhar, não trava o disparo', async () => {
    incr.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await acquireSendSlot('n1', 5)).toBe(true);
  });
});
