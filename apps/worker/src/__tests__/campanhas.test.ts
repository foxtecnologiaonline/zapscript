/**
 * Testes unitários do processador de disparo de campanhas (fila 'campanhas').
 */

// ── Mocks ──────────────────────────────────────────────────────────
jest.mock('../lib/prisma', () => ({
  prisma: {
    campanha:        { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    campanhaContato: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn(), updateMany: jest.fn(), groupBy: jest.fn().mockResolvedValue([]) },
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

jest.mock('../lib/send-rate-limit', () => ({
  acquireSendSlot: jest.fn().mockResolvedValue(true),
}));

jest.mock('../services/mailer', () => ({
  sendEmail: jest.fn().mockResolvedValue(undefined),
}));

import { prisma } from '../lib/prisma';
import { sendTemplateMessage } from '../services/whatsapp-campaigns';
import { sendMessageViaEvolution } from '../services/evolution';
import { sendEmail } from '../services/mailer';
import { processCampanhaJob, markCampanhaJobExhausted, expireOptinTimeouts } from '../modules/campanhas';
import { acquireSendSlot } from '../lib/send-rate-limit';
import { MetaSendError } from '../lib/meta-errors';
import { DelayedError } from 'bullmq';

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
  beforeEach(() => { jest.clearAllMocks(); (acquireSendSlot as jest.Mock).mockResolvedValue(true); });

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
    expect(prisma.campanha.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { processedCount: { increment: 1 }, sentCount: { increment: 1 }, consecutiveFailures: 0 },
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
        id: 'ct1', status: 'pending', phone: '5511999999999', name: 'João', optinConfirmedAt: new Date(),
      });
      (sendMessageViaEvolution as jest.Mock).mockResolvedValueOnce({ id: 'evo-msg-1' });
      (prisma.campanha.update as jest.Mock)
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
        id: 'ct1', status: 'pending', phone: '5511999999999', name: null, optinConfirmedAt: new Date(),
      });
      (sendMessageViaEvolution as jest.Mock).mockResolvedValueOnce({ id: 'evo-msg-2' });
      (prisma.campanha.update as jest.Mock)
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

describe('A/B test — 2 variantes (§15.3)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('contato com variant B usa o template da variante B (canal meta)', async () => {
    (prisma.campanha.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'c1', status: 'running', abTestEnabled: true,
      templateName: 'promoA', templateLanguage: 'pt_BR', templateComponents: [],
      variantBTemplateName: 'promoB', variantBTemplateLanguage: 'en_US', variantBTemplateComponents: [{ type: 'header', parameters: [] }],
      whatsappNumber: numeroConectado,
    });
    (prisma.campanhaContato.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'ct1', status: 'pending', phone: '5511999999999', variables: null, variant: 'B',
    });
    (sendTemplateMessage as jest.Mock).mockResolvedValueOnce('wamid-b');
    (prisma.campanha.update as jest.Mock)
      .mockResolvedValueOnce({ processedCount: 1, audienceCount: 2, consecutiveFailures: 0, status: 'running' });

    const res = await processCampanhaJob(job({ campanhaId: 'c1', contatoId: 'ct1' }));

    expect(res).toEqual({});
    expect(sendTemplateMessage).toHaveBeenCalledWith(
      'decrypted-token', 'phone-id-1', '5511999999999', 'promoB', 'en_US',
      [{ type: 'header', parameters: [] }],
    );
  });

  it('contato com variant A (ou sem variant) usa o template normal mesmo com abTestEnabled', async () => {
    (prisma.campanha.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'c1', status: 'running', abTestEnabled: true,
      templateName: 'promoA', templateLanguage: 'pt_BR', templateComponents: [],
      variantBTemplateName: 'promoB', variantBTemplateLanguage: 'en_US', variantBTemplateComponents: [],
      whatsappNumber: numeroConectado,
    });
    (prisma.campanhaContato.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'ct1', status: 'pending', phone: '5511999999999', variables: null, variant: 'A',
    });
    (sendTemplateMessage as jest.Mock).mockResolvedValueOnce('wamid-a');
    (prisma.campanha.update as jest.Mock)
      .mockResolvedValueOnce({ processedCount: 1, audienceCount: 2, consecutiveFailures: 0, status: 'running' });

    await processCampanhaJob(job({ campanhaId: 'c1', contatoId: 'ct1' }));

    expect(sendTemplateMessage).toHaveBeenCalledWith(
      'decrypted-token', 'phone-id-1', '5511999999999', 'promoA', 'pt_BR', [],
    );
  });

  it('contato com variant B usa a mensagem da variante B (canal evolution)', async () => {
    (prisma.campanha.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'c1', status: 'running', channel: 'evolution', abTestEnabled: true,
      messageBody: 'Versão A: oi {{nome}}', variantBMessageBody: 'Versão B: e aí {{nome}}',
      whatsappNumber: numeroEvolutionConectado,
    });
    (prisma.campanhaContato.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'ct1', status: 'pending', phone: '5511999999999', name: 'João', variant: 'B', optinConfirmedAt: new Date(),
    });
    (sendMessageViaEvolution as jest.Mock).mockResolvedValueOnce({ id: 'evo-b' });
    (prisma.campanha.update as jest.Mock)
      .mockResolvedValueOnce({ processedCount: 1, audienceCount: 2, consecutiveFailures: 0, status: 'running' });

    await processCampanhaJob(job({ campanhaId: 'c1', contatoId: 'ct1' }));

    expect(sendMessageViaEvolution).toHaveBeenCalledWith('zs-abc123', '5511999999999', 'Versão B: e aí João');
  });
});

describe('opt-in (Evolution)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('pergunta de opt-in NÃO conta como processado (senão SIM contava 2x e a campanha concluía cedo)', async () => {
    (prisma.campanha.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'c1', status: 'running', channel: 'evolution', messageBody: 'Oi {{nome}}', whatsappNumber: numeroEvolutionConectado,
    });
    (prisma.campanhaContato.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'ct1', status: 'pending', phone: '5511999999999', name: 'João', optinConfirmedAt: null,
    });
    (sendMessageViaEvolution as jest.Mock).mockResolvedValueOnce({ id: 'evo-1' });
    (prisma.campanha.update as jest.Mock).mockResolvedValueOnce({});

    await processCampanhaJob(job({ campanhaId: 'c1', contatoId: 'ct1' }));

    expect(prisma.campanhaContato.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'pending_optin' }) }));
    expect(prisma.campanha.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { consecutiveFailures: 0 } });
    expect(prisma.campanha.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ processedCount: expect.anything() }) }));
  });

  it('timeout tira da campanha e conta como processado, sem opt-out global', async () => {
    (prisma.campanhaContato.findMany as jest.Mock).mockResolvedValueOnce([
      { id: 'ct1', campanhaId: 'c1' }, { id: 'ct2', campanhaId: 'c1' },
    ]);
    (prisma.campanhaContato.updateMany as jest.Mock).mockResolvedValueOnce({ count: 2 });
    (prisma.campanha.update as jest.Mock).mockResolvedValueOnce({ processedCount: 2, audienceCount: 10, consecutiveFailures: 0, status: 'running' });

    const n = await expireOptinTimeouts();

    expect(n).toBe(2);
    expect(prisma.campanhaContato.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['ct1', 'ct2'] }, status: 'pending_optin' },
      data:  expect.objectContaining({ status: 'optout' }),
    });
    expect(prisma.campanha.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ processedCount: { increment: 2 } }),
    }));
    expect((prisma as any).campanhaOptOut).toBeUndefined(); // nenhuma escrita na lista global
  });
});


describe('processCampanhaJob — throttling da Meta (§3.2) e teto por número (§3.3)', () => {
  const campanhaMeta = { id: 'c1', status: 'running', channel: 'meta', whatsappNumberId: 'wn-primary', whatsappNumber: numeroConectado, templateName: 't', templateLanguage: 'pt_BR', templateComponents: null, abTestEnabled: false };
  const contatoPendente = { id: 'ct1', status: 'pending', phone: '5511999990000', name: 'Ana', variables: [], assignedNumberId: null };

  beforeEach(() => {
    jest.clearAllMocks();
    (acquireSendSlot as jest.Mock).mockResolvedValue(true);
    (prisma.campanha.findUnique as jest.Mock).mockResolvedValue(campanhaMeta);
    (prisma.campanhaContato.findUnique as jest.Mock).mockResolvedValue(contatoPendente);
  });

  it('throttle da Meta (130429) pausa a campanha SEM marcar o contato como falha nem contar processado', async () => {
    (sendTemplateMessage as jest.Mock).mockRejectedValueOnce(new MetaSendError('Throughput limit', 130429, undefined, 400));
    (prisma.campanha.updateMany as jest.Mock).mockResolvedValueOnce({ count: 1 });
    // 1ª leitura: o processador; 2ª: o e-mail de aviso (precisa do dono da campanha)
    (prisma.campanha.findUnique as jest.Mock)
      .mockResolvedValueOnce(campanhaMeta)
      .mockResolvedValueOnce({ ...campanhaMeta, name: 'Black Friday', user: { email: 'dono@x.com', name: 'Dono' } });

    const res = await processCampanhaJob(job({ campanhaId: 'c1', contatoId: 'ct1' }));
    await flushPromises();

    expect(res.skipped).toBe(true);
    expect(res.reason).toMatch(/throttle da Meta \(código 130429\)/);
    expect(prisma.campanha.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'c1', status: 'running' },
      data: expect.objectContaining({ status: 'paused', pausedReason: expect.stringContaining('130429') }),
    }));
    // contato continua pending: nada de update em CampanhaContato nem em contadores da campanha
    expect(prisma.campanhaContato.update).not.toHaveBeenCalled();
    expect(prisma.campanha.update).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect((sendEmail as jest.Mock).mock.calls[0][2]).toContain('limitou a taxa');
  });

  it('HTTP 429 também é tratado como throttle', async () => {
    (sendTemplateMessage as jest.Mock).mockRejectedValueOnce(new MetaSendError('Too many', undefined, undefined, 429));
    (prisma.campanha.updateMany as jest.Mock).mockResolvedValueOnce({ count: 1 });
    const res = await processCampanhaJob(job({ campanhaId: 'c1', contatoId: 'ct1' }));
    expect(res.skipped).toBe(true);
  });

  it('segunda chamada concorrente não pausa nem notifica de novo (idempotente)', async () => {
    (sendTemplateMessage as jest.Mock).mockRejectedValueOnce(new MetaSendError('limit', 80007));
    (prisma.campanha.updateMany as jest.Mock).mockResolvedValueOnce({ count: 0 }); // outro job já pausou
    await processCampanhaJob(job({ campanhaId: 'c1', contatoId: 'ct1' }));
    await flushPromises();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('falha permanente do contato (131026) continua propagando para o retry/failed do BullMQ', async () => {
    (sendTemplateMessage as jest.Mock).mockRejectedValueOnce(new MetaSendError('Undeliverable', 131026, undefined, 400));
    await expect(processCampanhaJob(job({ campanhaId: 'c1', contatoId: 'ct1' }))).rejects.toThrow('Undeliverable');
    expect(prisma.campanha.updateMany).not.toHaveBeenCalled(); // não pausa por erro por-contato
  });

  it('limite do PAR (131056) é por contato — não pausa a campanha', async () => {
    (sendTemplateMessage as jest.Mock).mockRejectedValueOnce(new MetaSendError('pair rate limit', 131056, undefined, 400));
    await expect(processCampanhaJob(job({ campanhaId: 'c1', contatoId: 'ct1' }))).rejects.toThrow('pair rate limit');
    expect(prisma.campanha.updateMany).not.toHaveBeenCalled();
  });

  it('teto por número estourado: reagenda com moveToDelayed + DelayedError, sem enviar e sem gastar retry', async () => {
    (acquireSendSlot as jest.Mock).mockResolvedValueOnce(false);
    const moveToDelayed = jest.fn().mockResolvedValue(undefined);
    const before = Date.now();

    await expect(processCampanhaJob({ data: { campanhaId: 'c1', contatoId: 'ct1' }, moveToDelayed } as any, 'tok-1'))
      .rejects.toBeInstanceOf(DelayedError);

    expect(acquireSendSlot).toHaveBeenCalledWith('wn-primary');
    expect(sendTemplateMessage).not.toHaveBeenCalled();
    expect(moveToDelayed).toHaveBeenCalledTimes(1);
    const [when, tok] = moveToDelayed.mock.calls[0];
    expect(tok).toBe('tok-1');
    expect(when).toBeGreaterThanOrEqual(before + 1000);
    expect(when).toBeLessThanOrEqual(Date.now() + 1600);
    expect(prisma.campanhaContato.update).not.toHaveBeenCalled();
  });

  it('com slot livre envia normalmente', async () => {
    (sendTemplateMessage as jest.Mock).mockResolvedValueOnce('wamid.OK');
    (prisma.campanha.update as jest.Mock).mockResolvedValue({ processedCount: 1, audienceCount: 10, consecutiveFailures: 0, status: 'running' });
    const res = await processCampanhaJob(job({ campanhaId: 'c1', contatoId: 'ct1' }));
    expect(res).toEqual({});
    expect(sendTemplateMessage).toHaveBeenCalledWith('decrypted-token', 'phone-id-1', '5511999990000', 't', 'pt_BR', expect.anything());
  });

  it('canal evolution NÃO passa pelo limitador por número (já é espaçado no enqueue)', async () => {
    (prisma.campanha.findUnique as jest.Mock).mockResolvedValue({ ...campanhaMeta, channel: 'evolution', whatsappNumber: numeroEvolutionConectado, messageBody: 'oi' });
    (prisma.campanhaContato.findUnique as jest.Mock).mockResolvedValue({ ...contatoPendente, optinConfirmedAt: new Date() });
    (sendMessageViaEvolution as jest.Mock).mockResolvedValueOnce({ id: 'evo-1' });
    (prisma.campanha.update as jest.Mock).mockResolvedValue({ processedCount: 1, audienceCount: 10, consecutiveFailures: 0, status: 'running' });
    await processCampanhaJob(job({ campanhaId: 'c1', contatoId: 'ct1' }));
    expect(acquireSendSlot).not.toHaveBeenCalled();
  });
});
