/**
 * Testes unitários do processador de disparo de campanhas (fila 'campanhas').
 */

// ── Mocks ──────────────────────────────────────────────────────────
jest.mock('../lib/prisma', () => ({
  prisma: {
    campanha:        { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    campanhaContato: { findUnique: jest.fn(), update: jest.fn(), count: jest.fn() },
    $transaction:    jest.fn(async (ops: any[]) => Promise.all(ops)),
  },
}));

jest.mock('../services/encryption', () => ({
  decryptStr: jest.fn().mockReturnValue('decrypted-token'),
}));

jest.mock('../services/whatsapp-campaigns', () => ({
  sendTemplateMessage: jest.fn(),
}));

import { prisma } from '../lib/prisma';
import { sendTemplateMessage } from '../services/whatsapp-campaigns';
import { processCampanhaJob, markCampanhaJobExhausted } from '../modules/campanhas';

const numeroConectado = {
  status: 'connected',
  metaAccessTokenEnc: 'enc-token',
  metaPhoneNumberId: 'phone-id-1',
};

function job(data: any) {
  return { data } as any;
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
    (prisma.campanhaContato.count as jest.Mock).mockResolvedValueOnce(0);

    const res = await processCampanhaJob(job({ campanhaId: 'c1', contatoId: 'ct1' }));
    expect(res).toEqual({ skipped: true, reason: 'número desconectado' });
    expect(prisma.campanhaContato.update).toHaveBeenCalledWith({
      where: { id: 'ct1' },
      data: expect.objectContaining({ status: 'failed', errorMessage: expect.stringMatching(/desconectado/i) }),
    });
    // completude reconferida mesmo em falha
    expect(prisma.campanha.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', status: 'running' },
      data: expect.objectContaining({ status: 'completed' }),
    });
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
    (prisma.campanhaContato.count as jest.Mock).mockResolvedValueOnce(2); // ainda restam pendentes

    const res = await processCampanhaJob(job({ campanhaId: 'c1', contatoId: 'ct1' }));

    expect(res).toEqual({});
    expect(sendTemplateMessage).toHaveBeenCalledWith(
      'decrypted-token', 'phone-id-1', '5511999999999', 'promo_verao', 'pt_BR',
      [
        { type: 'header', parameters: [] },
        { type: 'body', parameters: [{ type: 'text', text: 'João' }, { type: 'text', text: '20%' }] },
      ],
    );
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.campanhaContato.update).toHaveBeenCalledWith({
      where: { id: 'ct1' },
      data: expect.objectContaining({ status: 'sent', wamid: 'wamid-123' }),
    });
    // ainda restam 2 pendentes — não completa a campanha
    expect(prisma.campanha.updateMany).not.toHaveBeenCalled();
  });

  it('completa a campanha quando o envio esgota os contatos pendentes', async () => {
    (prisma.campanha.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'c1', status: 'running', templateName: 'promo_verao', templateLanguage: 'pt_BR',
      templateComponents: null, whatsappNumber: numeroConectado,
    });
    (prisma.campanhaContato.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'ct1', status: 'pending', phone: '5511999999999', variables: null,
    });
    (sendTemplateMessage as jest.Mock).mockResolvedValueOnce('wamid-999');
    (prisma.campanhaContato.count as jest.Mock).mockResolvedValueOnce(0); // último contato

    await processCampanhaJob(job({ campanhaId: 'c1', contatoId: 'ct1' }));

    expect(prisma.campanha.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', status: 'running' },
      data: expect.objectContaining({ status: 'completed' }),
    });
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
  });
});

describe('markCampanhaJobExhausted', () => {
  beforeEach(() => jest.clearAllMocks());

  it('marca o contato como failed quando as tentativas se esgotam', async () => {
    (prisma.campanhaContato.findUnique as jest.Mock).mockResolvedValueOnce({ status: 'pending' });
    (prisma.campanhaContato.count as jest.Mock).mockResolvedValueOnce(0);

    await markCampanhaJobExhausted(job({ campanhaId: 'c1', contatoId: 'ct1' }), new Error('boom'));

    expect(prisma.campanhaContato.update).toHaveBeenCalledWith({
      where: { id: 'ct1' },
      data: expect.objectContaining({ status: 'failed', errorMessage: 'boom' }),
    });
    expect(prisma.campanha.updateMany).toHaveBeenCalled();
  });

  it('não sobrescreve se o contato já saiu de "pending" por outro caminho (idempotência)', async () => {
    (prisma.campanhaContato.findUnique as jest.Mock).mockResolvedValueOnce({ status: 'failed' });

    await markCampanhaJobExhausted(job({ campanhaId: 'c1', contatoId: 'ct1' }), new Error('boom'));

    expect(prisma.campanhaContato.update).not.toHaveBeenCalled();
  });

  it('não faz nada se faltar campanhaId/contatoId no job', async () => {
    await markCampanhaJobExhausted(job({}), new Error('boom'));
    expect(prisma.campanhaContato.findUnique).not.toHaveBeenCalled();
  });
});
