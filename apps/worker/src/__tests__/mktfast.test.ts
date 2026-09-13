/**
 * Testes unitários do processador de missões do MKT-Fast (fila 'mktfast').
 * Ver MKTFAST_ESCOPO.md.
 */

jest.mock('../lib/prisma', () => ({
  prisma: {
    mission:          { findUnique: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    missionExecution: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn(), count: jest.fn() },
  },
}));

jest.mock('../services/evolution', () => ({
  sendMessageViaEvolution: jest.fn(),
}));

import { prisma } from '../lib/prisma';
import { sendMessageViaEvolution } from '../services/evolution';
import { processMissionJob, markMissionJobExhausted } from '../modules/mktfast';

const numeroConectado = { status: 'connected', zapiInstanceId: 'zs-abc123' };

function job(data: any) {
  return { data } as any;
}

describe('processMissionJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.missionExecution.count as jest.Mock).mockResolvedValue(0); // sem pendentes → completa, por padrão
  });

  it('ignora se a missão não existe', async () => {
    (prisma.mission.findUnique as jest.Mock).mockResolvedValueOnce(null);

    const res = await processMissionJob(job({ missionId: 'm1', executionId: 'e1' }));
    expect(res).toEqual({ skipped: true, reason: 'missão não encontrada' });
    expect(prisma.missionExecution.findUnique).not.toHaveBeenCalled();
  });

  it('ignora se a missão não está "running" (ex: cancelada)', async () => {
    (prisma.mission.findUnique as jest.Mock).mockResolvedValueOnce({ status: 'canceled' });

    const res = await processMissionJob(job({ missionId: 'm1', executionId: 'e1' }));
    expect(res).toEqual({ skipped: true, reason: 'missão em status "canceled"' });
    expect(prisma.missionExecution.findUnique).not.toHaveBeenCalled();
  });

  it('ignora se a execução não existe', async () => {
    (prisma.mission.findUnique as jest.Mock).mockResolvedValueOnce({ status: 'running' });
    (prisma.missionExecution.findUnique as jest.Mock).mockResolvedValueOnce(null);

    const res = await processMissionJob(job({ missionId: 'm1', executionId: 'e1' }));
    expect(res).toEqual({ skipped: true, reason: 'execução não encontrada' });
  });

  it('ignora se a execução já foi processada (não está mais "pending")', async () => {
    (prisma.mission.findUnique as jest.Mock).mockResolvedValueOnce({ status: 'running' });
    (prisma.missionExecution.findUnique as jest.Mock).mockResolvedValueOnce({ status: 'sent' });

    const res = await processMissionJob(job({ missionId: 'm1', executionId: 'e1' }));
    expect(res).toEqual({ skipped: true, reason: 'execução já processada (status "sent")' });
  });

  describe('canal whatsapp', () => {
    it('envia e marca a execução como "sent" com reachCount 1', async () => {
      (prisma.mission.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'm1', status: 'running', content: { text: 'oi' }, whatsappNumber: numeroConectado,
      });
      (prisma.missionExecution.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'e1', channel: 'whatsapp', status: 'pending', targetRef: '5534999998888',
      });
      (sendMessageViaEvolution as jest.Mock).mockResolvedValueOnce({ id: 'wamid-1' });

      await processMissionJob(job({ missionId: 'm1', executionId: 'e1' }));

      expect(sendMessageViaEvolution).toHaveBeenCalledWith('zs-abc123', '5534999998888', 'oi');
      expect(prisma.missionExecution.update).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: { status: 'sent', reachCount: 1, errorReason: null },
      });
    });

    it('marca como failed se o número da missão está desconectado', async () => {
      (prisma.mission.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'm1', status: 'running', content: { text: 'oi' }, whatsappNumber: { status: 'disconnected', zapiInstanceId: null },
      });
      (prisma.missionExecution.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'e1', channel: 'whatsapp', status: 'pending', targetRef: '5534999998888',
      });

      await processMissionJob(job({ missionId: 'm1', executionId: 'e1' }));

      expect(sendMessageViaEvolution).not.toHaveBeenCalled();
      expect(prisma.missionExecution.update).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: { status: 'failed', errorReason: 'Número WhatsApp da missão desconectado ou não configurado.' },
      });
    });
  });

  describe('canal human_share', () => {
    it('envia a convocação e marca a execução como "awaiting_proof" (não conclui sozinha)', async () => {
      (prisma.mission.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'm1', status: 'running', title: 'Divulgar ZapScript.me', objective: 'Trazer testers',
        content: { humanBriefing: 'Poste no seu story' }, whatsappNumber: numeroConectado,
      });
      (prisma.missionExecution.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'e1', channel: 'human_share', status: 'pending', targetRef: '5534999998888',
      });

      await processMissionJob(job({ missionId: 'm1', executionId: 'e1' }));

      expect(sendMessageViaEvolution).toHaveBeenCalled();
      expect(prisma.missionExecution.update).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: { status: 'awaiting_proof', errorReason: null },
      });
      // awaiting_proof não deve contar como concluído — a missão não pode completar sozinha aqui
      expect(prisma.missionExecution.count).toHaveBeenCalledWith({
        where: { missionId: 'm1', status: { in: ['pending', 'awaiting_proof', 'proof_submitted'] } },
      });
    });
  });

  it('marca como failed um canal sem adapter implementado', async () => {
    (prisma.mission.findUnique as jest.Mock).mockResolvedValueOnce({ id: 'm1', status: 'running', content: {}, whatsappNumber: null });
    (prisma.missionExecution.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'e1', channel: 'instagram_feed', status: 'pending', targetRef: null,
    });

    await processMissionJob(job({ missionId: 'm1', executionId: 'e1' }));

    expect(prisma.missionExecution.update).toHaveBeenCalledWith({
      where: { id: 'e1' },
      data: { status: 'failed', errorReason: 'Canal "instagram_feed" sem adapter implementado' },
    });
  });

  it('completa a missão quando não há mais execuções pendentes', async () => {
    (prisma.mission.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'm1', status: 'running', content: { text: 'oi' }, whatsappNumber: numeroConectado,
    });
    (prisma.missionExecution.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'e1', channel: 'whatsapp', status: 'pending', targetRef: '5534999998888',
    });
    (sendMessageViaEvolution as jest.Mock).mockResolvedValueOnce({ id: 'wamid-1' });
    (prisma.missionExecution.count as jest.Mock).mockResolvedValueOnce(0);

    await processMissionJob(job({ missionId: 'm1', executionId: 'e1' }));

    expect(prisma.mission.updateMany).toHaveBeenCalledWith({
      where: { id: 'm1', status: 'running' },
      data: { status: 'completed', completedAt: expect.any(Date) },
    });
  });

  it('NÃO completa a missão enquanto houver execução pendente/aguardando prova', async () => {
    (prisma.mission.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'm1', status: 'running', content: { text: 'oi' }, whatsappNumber: numeroConectado,
    });
    (prisma.missionExecution.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'e1', channel: 'whatsapp', status: 'pending', targetRef: '5534999998888',
    });
    (sendMessageViaEvolution as jest.Mock).mockResolvedValueOnce({ id: 'wamid-1' });
    (prisma.missionExecution.count as jest.Mock).mockResolvedValueOnce(1);

    await processMissionJob(job({ missionId: 'm1', executionId: 'e1' }));

    expect(prisma.mission.updateMany).not.toHaveBeenCalled();
  });
});

describe('markMissionJobExhausted', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.missionExecution.count as jest.Mock).mockResolvedValue(0);
  });

  it('marca a execução como failed quando as tentativas se esgotam', async () => {
    (prisma.missionExecution.findUnique as jest.Mock).mockResolvedValueOnce({ status: 'pending' });

    await markMissionJobExhausted(job({ missionId: 'm1', executionId: 'e1' }), new Error('timeout'));

    expect(prisma.missionExecution.update).toHaveBeenCalledWith({
      where: { id: 'e1' },
      data: { status: 'failed', errorReason: 'timeout' },
    });
  });

  it('não sobrescreve se a execução já saiu de "pending" por outro caminho', async () => {
    (prisma.missionExecution.findUnique as jest.Mock).mockResolvedValueOnce({ status: 'approved' });

    await markMissionJobExhausted(job({ missionId: 'm1', executionId: 'e1' }), new Error('timeout'));

    expect(prisma.missionExecution.update).not.toHaveBeenCalled();
  });
});
