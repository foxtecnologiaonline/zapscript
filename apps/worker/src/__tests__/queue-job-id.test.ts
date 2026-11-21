/**
 * Regressão: os jobIds compostos têm que passar pela validação REAL do BullMQ.
 * Os testes de rota mockam a fila, então nunca pegariam o "Custom Id cannot
 * contain :" — foi assim que `${campanhaId}:${contatoId}` ficou latente.
 */
import { Job } from 'bullmq';
import { campanhaSendJobId, mktfastSendJobId } from '../lib/queue-job-id';

function bullmqAccepts(jobId: string): void {
  // Fila de mentira: validateOptions só olha as opções, não toca o Redis.
  const fakeQueue = { toKey: (k: string) => `bull:q:${k}`, qualifiedName: 'bull:q', opts: {}, keys: {} } as any;
  const job = new Job(fakeQueue, 'send', {}, { jobId });
  (job as any).validateOptions(job.opts);
}

describe('queue-job-id', () => {
  it('sanidade: o BullMQ instalado rejeita o formato antigo com ":"', () => {
    expect(() => bullmqAccepts('campanhaX:contatoY')).toThrow('Custom Id cannot contain :');
  });

  it('campanhaSendJobId é aceito pelo BullMQ e é determinístico', () => {
    const id = campanhaSendJobId('cmabc123', 'cmdef456');
    expect(() => bullmqAccepts(id)).not.toThrow();
    expect(id).toBe('camp-cmabc123-cmdef456');
    expect(campanhaSendJobId('cmabc123', 'cmdef456')).toBe(id);
  });

  it('mktfastSendJobId é aceito pelo BullMQ', () => {
    const id = mktfastSendJobId('m1', 'e1');
    expect(() => bullmqAccepts(id)).not.toThrow();
    expect(id).toBe('mkt-m1-e1');
  });

  it('IDs diferentes não colidem entre campanhas/contatos', () => {
    expect(campanhaSendJobId('a', 'b')).not.toBe(campanhaSendJobId('b', 'a'));
  });

  it('recusa partes vazias ou com ":" em vez de gerar um ID inválido', () => {
    expect(() => campanhaSendJobId('a:b', 'c')).toThrow(/inválido/);
    expect(() => campanhaSendJobId('', 'c')).toThrow(/inválido/);
  });
});
