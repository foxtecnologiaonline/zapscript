/**
 * Testes unitários do processador de disparo de campanhas (fila 'campanhas').
 */

// ── Mocks ──────────────────────────────────────────────────────────
jest.mock('../lib/prisma', () => ({
  prisma: {
    campanha:        { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    campanhaContato: { findUnique: jest.fn(), update: jest.fn(), groupBy: jest.fn().mockResolvedValue([]) },
    whatsappNumber:  { findUnique: jest.fn() },
  },
}));

jest.mock('../services/encryption', () => ({
  decryptStr: jest.fn().mockReturnValue('decrypted-token'),
}));

jest.mock('../services/whatsapp-campaigns', () => ({
  sendTemplateMessage: jest.fn(),
}));

jest.mock('../services/evolution', () => ({
  sendMessageViaEvolution: jest.fn(),
}));

jest.mock('../services/mailer', () => ({
  sendEmail: jest.fn().mockResolvedValue(undefined),
}));

import { prisma } from '../lib/prisma';
import { sendTemplateMessage } from '../services/whatsapp-campaigns';
import { sendMessageViaEvolution } from '../services/evolution';
import { sendEmail } from '../services/mailer';
import { processCampanhaJob, markCampanhaJobExhausted } from '../modules/campanhas';

const numeroConectado = {
  id: 'wn-primary',
  status: 'connected',
  metaAccessTokenEnc: 'enc-token',
  metaPhoneNumberId: 'phone-id-1',
};

const numeroEvolutionConectado = {
  status: 'connected',
  zapiInstanceId: 'zs-abc123',
};

function job(data: any) {
  return { data } as any;
}

/** Espera a fila de microtasks esvaziar — necessário porque as notificações por
 *  e-mail (item 10) são disparadas fire-and-forget (sem await) pra não bloquear
 *  o processamento do job. */
function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('processCampanhaJob', () => {
  beforeEach(() => jest.clearAllMocks());

  it('ignora se a campanha não existe', async () => {
    (prisma.campanha.findUnique as jest.Mock).mockResolvedValueOnce(null);

    const res = await processCampanhaJob(job({ campanhaId: 'c1', contatoId: 'ct1' }));
    expect(res).toEqual({ skipped: true, reason: 'campanha não encontrada' });
    expect(prisma.campanhaContato.findUnique).not.toHaveBeenCalled();
  });

  it('ignora se a campanha não está "running" (ex: pausada)', async () => {
    (prisma.campanha.findUnique as jest.Mock).mockResolvedValueOnce({ status: 'paused' });

    const res = await processCampanhaJob(job({ campanhaId: 'c1', contatoId: 'ct1' }));
    expect(res).toEqual({ skipped: true, reason: 'campanha em status "paused"' });
    expect(prisma.campanhaContato.findUnique).not.toHaveBeenCalled();
  });

  it('ignora se o contato não existe', async () => {
    (prisma.campanha.findUnique as jest.Mock).mockResolvedValueOnce({ status: 'running' });
    (prisma.campanhaContato.findUnique as jest.Mock).mockResolvedValueOnce(null);

    const res = await processCampanhaJob(job({ campanhaId: 'c1', contatoId: 'ct1' }));
    expect(res).toEqual({ skipped: true, reason: 'contato não encontrado' });
  });

  it('ignora se o contato já foi processado (ex: optout mudou status fora de "pending")', async () => {
    (prisma.campanha.findUnique as jest.Mock).mockResolvedValueOnce({ status: 'running' });
    (prisma.campanhaContato.findUnique as jest.Mock).mockResolvedValueOnce({ status: 'failed' });

    const res = await processCampanhaJob(job({ campanhaId: 'c1', contatoId: 'ct1' }));
    expect(res).toEqual({ skipped: true, reason: 'contato já processado (status "failed")' });
    expect(sendTemplateMessage).not.toHaveBeenCalled();
  });

  it('marca contato como failed quando o número Meta está desconectado', async () => {
    (prisma.campanha.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'c1', status: 'running', whatsappNumber: { status: 'disconnected' },
    });
    (prisma.campanhaContato.findUnique as jest.Mock).mockResolvedValueOnce({ id: 'ct1', status: 'pending' });
    (prisma.campanha.update as jest.Mock).mockResolvedValueOnce({
      processedCount: 1, audienceCount: 5, consecutiveFailures: 1, status: 'running',
    });

    const res = await processCampanhaJob(job({ campanhaId: 'c1', contatoId: 'ct1' }));
    expect(res).toEqual({ skipped: true, reason: 'número desconectado' });
    expect(prisma.campanhaContato.update).toHaveBeenCalledWith({
      where: { id: 'ct1' },
      data: expect.objectContaining({ status: 'failed', errorMessage: expect.stringMatching(/desconectado/i) }),
    });
    // falha conta pro processedCount e incrementa consecutiveFailures (circuit breaker)
    expect(prisma.campanha.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { processedCount: { increment: 1 }, consecutiveFailures: { increment: 1 } },
      select: { processedCount: true, audienceCount: true, consecutiveFailures: true, status: true },
    });
    // 1 falha (< threshold) e 1/5 processados — nem pausa nem completa
    expect(prisma.campanha.updateMany).not.toHaveBeenCalled();
  });

  it('pausa automaticamente a campanha após N falhas consecutivas (circuit breaker) e notifica por e-mail', async () => {
    (prisma.campanha.findUnique as jest.Mock)
      .mockResolvedValueOnce({ id: 'c1', status: 'running', whatsappNumber: { status: 'disconnected' } })
      .mockResolvedValueOnce({ id: 'c1', name: 'Black Friday', user: { email: 'dono@x.com', name: 'Dono' } });
    (prisma.campanhaContato.findUnique as jest.Mock).mockResolvedValueOnce({ id: 'ct1', status: 'pending' });
    (prisma.campanha.update as jest.Mock).mockResolvedValueOnce({
      processedCount: 3, audienceCount: 10, consecutiveFailures: 5, status: 'running',
    });
    (prisma.campanha.updateMany as jest.Mock).mockResolvedValueOnce({ count: 1 });

    const res = await processCampanhaJob(job({ campanhaId: 'c1', contatoId: 'ct1' }));

    expect(res).toEqual({ skipped: true, reason: 'número desconectado' });
    expect(prisma.campanha.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', status: 'running' },
      data: {
        status: 'paused',
        pausedReason: expect.stringMatching(/5 falhas de envio seguidas/i),
      },
    });

    await flushPromises();
    expect(sendEmail).toHaveBeenCalledWith(
      'dono@x.com',
      expect.stringContaining('pausada automaticamente'),
      expect.stringContaining('Black Friday'),
    );
  });

  it('envia com sucesso, marca sent e incrementa sentCount', async () => {
    (prisma.campanha.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'c1', status: 'running', templateName: 'promo_verao', templateLanguage: 'pt_BR',
      templateComponents: [{ type: 'header', parameters: [] }],
      whatsappNumber: numeroConectado,
    });
    (prisma.campanhaContato.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'ct1', status: 'pending', phone: '5511999999999', variables: ['João', '20%'],
    });
    (sendTemplateMessage as jest.Mock).mockResolvedValueOnce('wamid-123');
    (prisma.campanha.update as jest.Mock)
      .mockResolvedValueOnce({}) // increment de sentCount — retorno não usado
      .mockResolvedValueOnce({ processedCount: 1, audienceCount: 3, consecutiveFailures: 0, status: 'running' });

    const res = await processCampanhaJob(job({ campanhaId: 'c1', contatoId: 'ct1' }));

    expect(res).toEqual({});
    expect(sendTemplateMessage).toHaveBeenCalledWith(
      'decrypted-token', 'phone-id-1', '5511999999999', 'promo_verao', 'pt_BR',
      [
        { type: 'header', parameters: [] },
        { type: 'body', parameters: [{ type: 'text', text: 'João' }, { type: 'text', text: '20%' }] },
      ],
    );
    expect(prisma.campanhaContato.update).toHaveBeenCalledWith({
      where: { id: 'ct1' },
      data: expect.objectContaining({ status: 'sent', wamid: 'wamid-123' }),
    });
    expect(prisma.campanha.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { sentCount: { increment: 1 } } });
    expect(prisma.campanha.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { processedCount: { increment: 1 }, consecutiveFailures: 0 },
      select: { processedCount: true, audienceCount: true, consecutiveFailures: true, status: true },
    });
    // ainda restam pendentes (1/3) — não completa a campanha
    expect(prisma.campanha.updateMany).not.toHaveBeenCalled();
  });

  it('completa a campanha quando o envio esgota os contatos pendentes, e notifica por e-mail', async () => {
    (prisma.campanha.findUnique as jest.Mock)
      .mockResolvedValueOnce({
        id: 'c1', status: 'running', templateName: 'promo_verao', templateLanguage: 'pt_BR',
        templateComponents: null, whatsappNumber: numeroConectado,
      })
      .mockResolvedValueOnce({ id: 'c1', name: 'Promo Verão', sentCount: 3, user: { email: 'ana@x.com', name: 'Ana' } });
    (prisma.campanhaContato.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'ct1', status: 'pending', phone: '5511999999999', variables: null,
    });
    (sendTemplateMessage as jest.Mock).mockResolvedValueOnce('wamid-999');
    (prisma.campanha.update as jest.Mock)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ processedCount: 3, audienceCount: 3, consecutiveFailures: 0, status: 'running' });
    (prisma.campanha.updateMany as jest.Mock).mockResolvedValueOnce({ count: 1 });
    (prisma.campanhaContato.groupBy as jest.Mock).mockResolvedValueOnce([{ status: 'sent', _count: 3 }]);

    await processCampanhaJob(job({ campanhaId: 'c1', contatoId: 'ct1' }));

    expect(prisma.campanha.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', status: 'running' },
      data: expect.objectContaining({ status: 'completed' }),
    });

    await flushPromises();
    expect(sendEmail).toHaveBeenCalledWith(
      'ana@x.com',
      expect.stringContaining('Promo Verão'),
      expect.stringContaining('Enviados'),
    );
  });

  it('usa o número do pool (assignedNumberId) quando setado, não o número primário da campanha', async () => {
    (prisma.campanha.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'c1', status: 'running', whatsappNumberId: 'wn-primary', templateName: 'promo',
      templateLanguage: 'pt_BR', templateComponents: [],
      whatsappNumber: { id: 'wn-primary', status: 'disconnected' }, // primário fora do ar
    });
    (prisma.campanhaContato.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'ct1', status: 'pending', phone: '5511999999999', variables: null, assignedNumberId: 'wn-pool-2',
    });
    (prisma.whatsappNumber.findUnique as jest.Mock).mockResolvedValueOnce(numeroConectado); // número do pool, conectado
    (sendTemplateMessage as jest.Mock).mockResolvedValueOnce('wamid-pool');
    (prisma.campanha.update as jest.Mock)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ processedCount: 1, audienceCount: 5, consecutiveFailures: 0, status: 'running' });

    const res = await processCampanhaJob(job({ campanhaId: 'c1', contatoId: 'ct1' }));

    expect(res).toEqual({});
    expect(prisma.whatsappNumber.findUnique).toHaveBeenCalledWith({ where: { id: 'wn-pool-2' } });
    expect(sendTemplateMessage).toHaveBeenCalledWith(
      'decrypted-token', 'phone-id-1', '5511999999999', 'promo', 'pt_BR', [],
    );
  });

  it('propaga o erro da Meta API para o BullMQ decidir o retry', async () => {
    (prisma.campanha.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'c1', status: 'running', templateName: 'promo_verao', templateLanguage: 'pt_BR',
      templateComponents: [], whatsappNumber: numeroConectado,
    });
    (prisma.campanhaContato.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'ct1', status: 'pending', phone: '5511999999999', variables: null,
    });
    (sendTemplateMessage as jest.Mock).mockRejectedValueOnce(new Error('Meta API timeout'));

    await expect(processCampanhaJob(job({ campanhaId: 'c1', contatoId: 'ct1' }))).rejects.toThrow('Meta API timeout');
    expect(prisma.campanhaContato.update).not.toHaveBeenCalled();
    expect(prisma.campanha.update).not.toHaveBeenCalled();
  });

  describe('canal evolution', () => {
    it('envia via Evolution, renderiza {{nome}} e marca sent com o id retornado', async () => {
      (prisma.campanha.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'c1', status: 'running', channel: 'evolution', messageBody: 'Oi {{nome}}, tudo bem?',
        whatsappNumber: numeroEvolutionConectado,
      });
      (prisma.campanhaContato.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'ct1', status: 'pending', phone: '5511999999999', name: 'João',
      });
      (sendMessageViaEvolution as jest.Mock).mockResolvedValueOnce({ id: 'evo-msg-1' });
      (prisma.campanha.update as jest.Mock)
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ processedCount: 1, audienceCount: 2, consecutiveFailures: 0, status: 'running' });

      const res = await processCampanhaJob(job({ campanhaId: 'c1', contatoId: 'ct1' }));

      expect(res).toEqual({});
      expect(sendMessageViaEvolution).toHaveBeenCalledWith('zs-abc123', '5511999999999', 'Oi João, tudo bem?');
      expect(sendTemplateMessage).not.toHaveBeenCalled();
      expect(prisma.campanhaContato.update).toHaveBeenCalledWith({
        where: { id: 'ct1' },
        data: expect.objectContaining({ status: 'sent', wamid: 'evo-msg-1' }),
      });
    });

    it('usa o telefone quando o contato não tem nome salvo', async () => {
      (prisma.campanha.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'c1', status: 'running', channel: 'evolution', messageBody: 'Oi {{nome}}!',
        whatsappNumber: numeroEvolutionConectado,
      });
      (prisma.campanhaContato.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'ct1', status: 'pending', phone: '5511999999999', name: null,
      });
      (sendMessageViaEvolution as jest.Mock).mockResolvedValueOnce({ id: 'evo-msg-2' });
      (prisma.campanha.update as jest.Mock)
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ processedCount: 1, audienceCount: 4, consecutiveFailures: 0, status: 'running' });

      await processCampanhaJob(job({ campanhaId: 'c1', contatoId: 'ct1' }));

      expect(sendMessageViaEvolution).toHaveBeenCalledWith('zs-abc123', '5511999999999', 'Oi 5511999999999!');
    });

    it('marca failed quando o número Evolution está desconectado (não checa credenciais Meta)', async () => {
      (prisma.campanha.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'c1', status: 'running', channel: 'evolution', messageBody: 'Oi {{nome}}!',
        whatsappNumber: { status: 'disconnected' },
      });
      (prisma.campanhaContato.findUnique as jest.Mock).mockResolvedValueOnce({ id: 'ct1', status: 'pending', phone: '5511999999999' });
      (prisma.campanha.update as jest.Mock).mockResolvedValueOnce({
        processedCount: 1, audienceCount: 4, consecutiveFailures: 1, status: 'running',
      });

      const res = await processCampanhaJob(job({ campanhaId: 'c1', contatoId: 'ct1' }));

      expect(res).toEqual({ skipped: true, reason: 'número desconectado' });
      expect(sendMessageViaEvolution).not.toHaveBeenCalled();
      expect(prisma.campanhaContato.update).toHaveBeenCalledWith({
        where: { id: 'ct1' },
        data: expect.objectContaining({ status: 'failed', errorMessage: expect.stringMatching(/evolution desconectado/i) }),
      });
    });
  });
});

describe('markCampanhaJobExhausted', () => {
  beforeEach(() => jest.clearAllMocks());

  it('marca o contato como failed quando as tentativas se esgotam', async () => {
    (prisma.campanhaContato.findUnique as jest.Mock).mockResolvedValueOnce({ status: 'pending' });
    (prisma.campanha.update as jest.Mock).mockResolvedValueOnce({
      processedCount: 1, audienceCount: 3, consecutiveFailures: 1, status: 'running',
    });

    await markCampanhaJobExhausted(job({ campanhaId: 'c1', contatoId: 'ct1' }), new Error('boom'));

    expect(prisma.campanhaContato.update).toHaveBeenCalledWith({
      where: { id: 'ct1' },
      data: expect.objectContaining({ status: 'failed', errorMessage: 'boom' }),
    });
    expect(prisma.campanha.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { processedCount: { increment: 1 }, consecutiveFailures: { increment: 1 } },
      select: { processedCount: true, audienceCount: true, consecutiveFailures: true, status: true },
    });
  });

  it('não sobrescreve se o contato já saiu de "pending" por outro caminho (idempotência)', async () => {
    (prisma.campanhaContato.findUnique as jest.Mock).mockResolvedValueOnce({ status: 'failed' });

    await markCampanhaJobExhausted(job({ campanhaId: 'c1', contatoId: 'ct1' }), new Error('boom'));

    expect(prisma.campanhaContato.update).not.toHaveBeenCalled();
    expect(prisma.campanha.update).not.toHaveBeenCalled();
  });

  it('não faz nada se faltar campanhaId/contatoId no job', async () => {
    await markCampanhaJobExhausted(job({}), new Error('boom'));
    expect(prisma.campanhaContato.findUnique).not.toHaveBeenCalled();
  });
});
