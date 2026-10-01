/**
 * Testes do notifier de progresso (Chatbot Campanhas) — updates periódicos no
 * self-chat para campanhas criadas via bot. O módulo não registra mais timer na
 * importação (sobe por startCampanhaChatNotifier() no boot do worker — ver
 * lib/poller.ts); os fake timers ficam como salvaguarda de que nenhum timer
 * real escape durante os testes.
 */
jest.useFakeTimers();

jest.mock('../lib/prisma', () => ({
  prisma: {
    campanha:        { findMany: jest.fn(async () => []) },
    campanhaContato: { groupBy:  jest.fn(async () => []) },
  },
}));
jest.mock('../services/evolution', () => ({ sendMessageViaEvolution: jest.fn(async () => ({ id: 'wamid_1' })) }));

import { prisma } from '../lib/prisma';
import { sendMessageViaEvolution } from '../services/evolution';
import { runCampanhaChatNotifierTick } from '../modules/campanhas-chat-notifier';

const numeroConectado = { zapiInstanceId: 'zs-abc', phoneNumber: '5511900000000', status: 'connected' };

function campanha(overrides: any) {
  return { id: 'camp1', audienceCount: 10, status: 'running', whatsappNumber: numeroConectado, ...overrides };
}

describe('runCampanhaChatNotifierTick', () => {
  beforeEach(() => jest.clearAllMocks());

  it('não manda nada quando não há campanhas via chat em andamento', async () => {
    (prisma.campanha.findMany as jest.Mock).mockResolvedValueOnce([]);
    await runCampanhaChatNotifierTick();
    expect(sendMessageViaEvolution).not.toHaveBeenCalled();
  });

  it('manda o progresso quando o snapshot muda', async () => {
    (prisma.campanha.findMany as jest.Mock).mockResolvedValueOnce([campanha({ id: 'campA' })]);
    (prisma.campanhaContato.groupBy as jest.Mock).mockResolvedValueOnce([{ status: 'sent', _count: 3 }, { status: 'pending', _count: 7 }]);

    await runCampanhaChatNotifierTick();
    expect(sendMessageViaEvolution).toHaveBeenCalledTimes(1);
    expect(sendMessageViaEvolution).toHaveBeenCalledWith('zs-abc', '5511900000000', expect.stringContaining('3 ✅'));
  });

  it('não repete o mesmo snapshot em ticks seguidos', async () => {
    (prisma.campanha.findMany as jest.Mock).mockResolvedValue([campanha({ id: 'campB' })]);
    (prisma.campanhaContato.groupBy as jest.Mock).mockResolvedValue([{ status: 'sent', _count: 3 }, { status: 'pending', _count: 7 }]);

    await runCampanhaChatNotifierTick();
    await runCampanhaChatNotifierTick();
    expect(sendMessageViaEvolution).toHaveBeenCalledTimes(1);
  });

  it('manda de novo quando o snapshot muda entre ticks', async () => {
    (prisma.campanha.findMany as jest.Mock).mockResolvedValue([campanha({ id: 'campC' })]);
    (prisma.campanhaContato.groupBy as jest.Mock)
      .mockResolvedValueOnce([{ status: 'sent', _count: 3 }, { status: 'pending', _count: 7 }])
      .mockResolvedValueOnce([{ status: 'sent', _count: 5 }, { status: 'pending', _count: 5 }]);

    await runCampanhaChatNotifierTick();
    await runCampanhaChatNotifierTick();
    expect(sendMessageViaEvolution).toHaveBeenCalledTimes(2);
  });

  it('manda o relatório final uma única vez quando a campanha completa', async () => {
    (prisma.campanha.findMany as jest.Mock).mockResolvedValue([campanha({ id: 'campD', status: 'completed' })]);
    (prisma.campanhaContato.groupBy as jest.Mock).mockResolvedValue([{ status: 'sent', _count: 8 }, { status: 'read', _count: 6 }, { status: 'failed', _count: 2 }]);

    await runCampanhaChatNotifierTick();
    expect(sendMessageViaEvolution).toHaveBeenCalledTimes(1);
    expect(sendMessageViaEvolution).toHaveBeenCalledWith('zs-abc', '5511900000000', expect.stringContaining('concluída'));

    // segundo tick: mesma campanha completed ainda aparece na query (janela de 10min),
    // mas o relatório já foi mandado — não repete.
    await runCampanhaChatNotifierTick();
    expect(sendMessageViaEvolution).toHaveBeenCalledTimes(1);
  });

  it('não manda nada quando o número não está conectado', async () => {
    (prisma.campanha.findMany as jest.Mock).mockResolvedValueOnce([
      campanha({ id: 'campE', whatsappNumber: { ...numeroConectado, status: 'disconnected' } }),
    ]);
    await runCampanhaChatNotifierTick();
    expect(sendMessageViaEvolution).not.toHaveBeenCalled();
  });

  // ── Sinal de cadência consumido pelo poller adaptativo (lib/poller.ts) ─────
  describe('sinal worked (define a cadência do poller)', () => {
    it('é false sem campanha via chat em andamento → poller desacelera', async () => {
      (prisma.campanha.findMany as jest.Mock).mockResolvedValueOnce([]);
      await expect(runCampanhaChatNotifierTick()).resolves.toEqual({ worked: false });
    });

    it('é true com campanha rodando → poller mantém a cadência de 30s', async () => {
      (prisma.campanha.findMany as jest.Mock).mockResolvedValueOnce([campanha({ id: 'campF' })]);
      (prisma.campanhaContato.groupBy as jest.Mock).mockResolvedValueOnce([{ status: 'sent', _count: 1 }]);
      await expect(runCampanhaChatNotifierTick()).resolves.toEqual({ worked: true });
    });

    it('volta a false quando a única campanha completed já teve o relatório enviado', async () => {
      // Regressão: contar a campanha 'completed' já reportada como trabalho
      // prendia a cadência em 30s pelos 10min da janela da query, sem nada a fazer.
      (prisma.campanha.findMany as jest.Mock).mockResolvedValue([campanha({ id: 'campG', status: 'completed' })]);
      (prisma.campanhaContato.groupBy as jest.Mock).mockResolvedValue([{ status: 'sent', _count: 4 }]);

      await expect(runCampanhaChatNotifierTick()).resolves.toEqual({ worked: true });  // mandou o relatório
      await expect(runCampanhaChatNotifierTick()).resolves.toEqual({ worked: false }); // nada mais a fazer
      expect(sendMessageViaEvolution).toHaveBeenCalledTimes(1);
    });

    it('é false quando o tick falha (aplica backoff em vez de martelar o banco)', async () => {
      (prisma.campanha.findMany as jest.Mock).mockRejectedValueOnce(new Error('banco fora'));
      await expect(runCampanhaChatNotifierTick()).resolves.toEqual({ worked: false });
    });
  });
});
