import { recordFailedJob } from '../lib/dlq';

const upsert = jest.fn();
const create = jest.fn();
jest.mock('../lib/prisma', () => ({
  prisma: { failedJob: { upsert: (...a: any[]) => upsert(...a), create: (...a: any[]) => create(...a) } },
}));

const job = (over: any = {}) => ({
  id: 'job-1', name: 'transcribe-evolution', attemptsMade: 4,
  opts: { attempts: 4 }, data: { userId: 'u1', senderPhone: '5511999999999' },
  ...over,
}) as any;

beforeEach(() => { upsert.mockReset().mockResolvedValue({}); create.mockReset().mockResolvedValue({}); });

describe('recordFailedJob', () => {
  test('não grava enquanto ainda há tentativa sobrando', async () => {
    await recordFailedJob('transcriptions', job({ attemptsMade: 2, opts: { attempts: 4 } }), new Error('x'));
    expect(upsert).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  test('grava quando esgota as tentativas, com userId extraído', async () => {
    await recordFailedJob('transcriptions', job(), new Error('Whisper caiu'));
    expect(upsert).toHaveBeenCalledTimes(1);
    const arg = upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ queue_bullJobId: { queue: 'transcriptions', bullJobId: 'job-1' } });
    expect(arg.create.userId).toBe('u1');
    expect(arg.create.attempts).toBe(4);
    expect(arg.create.errorMessage).toBe('Whisper caiu');
  });

  test('remove mídia bruta do payload e marca payloadTrimmed', async () => {
    await recordFailedJob('transcriptions', job({
      data: { userId: 'u1', storageKey: 'u1/a.mp3', audioBase64: 'A'.repeat(5000), messageData: { big: 'x'.repeat(5000) } },
    }), new Error('x'));
    const { create: data } = upsert.mock.calls[0][0];
    expect(data.payload.audioBase64).toBeUndefined();
    expect(data.payload.messageData).toBeUndefined();
    expect(data.payload.storageKey).toBe('u1/a.mp3');   // referência preservada → replay viável
    expect(data.payloadTrimmed).toBe(true);
  });

  test('payload pequeno não é marcado como truncado', async () => {
    await recordFailedJob('atende-replies', job({ data: { userId: 'u1', contatoId: 'c1' } }), new Error('x'));
    expect(upsert.mock.calls[0][0].create.payloadTrimmed).toBe(false);
  });

  test('sem id do BullMQ cai no create (não dá pra deduplicar)', async () => {
    await recordFailedJob('copiloto', job({ id: undefined }), new Error('x'));
    expect(create).toHaveBeenCalledTimes(1);
    expect(upsert).not.toHaveBeenCalled();
  });

  test('erro do banco não propaga — registrar falha não pode derrubar o handler', async () => {
    upsert.mockRejectedValue(new Error('banco fora'));
    await expect(recordFailedJob('transcriptions', job(), new Error('x'))).resolves.toBeUndefined();
  });
});
