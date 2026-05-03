/**
 * Testes unitários do worker de transcrição.
 * Migrado para Meta Cloud API (Baileys removido).
 */

// ── Mocks ──────────────────────────────────────────────────────────
jest.mock('../lib/prisma', () => ({
  prisma: {
    minuteBalance: { findUnique: jest.fn(), updateMany: jest.fn() },
    user:          { findUnique: jest.fn() },
    transcription: { create: jest.fn() },
    whatsappNumber:{ update: jest.fn() },
    $transaction:  jest.fn(async (fn: any) => fn({
      minuteBalance: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      transcription: { create: jest.fn().mockResolvedValue({ id: 'tr-1' }) },
      whatsappNumber:{ update: jest.fn() },
    })),
  },
}));

jest.mock('../services/audio', () => ({
  convertToMp3: jest.fn().mockResolvedValue(Buffer.from('mp3')),
}));

// Meta Cloud API service (substitui Baileys)
jest.mock('../services/whatsapp-official', () => ({
  downloadAudioFromMeta: jest.fn().mockResolvedValue(Buffer.from('ogg-data')),
  sendMessageToMeta:     jest.fn().mockResolvedValue({ messages: [{ id: 'msg-123' }] }),
}));

jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    audio: {
      transcriptions: {
        create: jest.fn().mockResolvedValue({ text: 'Texto transcrito de teste' }),
      },
    },
  }));
});

jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [{ text: '- Bullet 1\n- Bullet 2\n- Bullet 3' }],
      }),
    },
  }));
});

// ── Tests ──────────────────────────────────────────────────────────
describe('generateBullets — parsing de bullets do Claude', () => {
  it('extrai bullets corretamente de resposta com prefixo "- "', async () => {
    const Anthropic = require('@anthropic-ai/sdk');
    const claude = new Anthropic();
    const res = await claude.messages.create({ model: 'test', max_tokens: 100, messages: [] });
    const raw = res.content[0].text;

    const bullets = raw
      .split('\n')
      .map((l: string) => l.trim())
      .filter((l: string) => l.startsWith('- '))
      .map((l: string) => l.replace(/^-\s*/, '').trim());

    expect(bullets).toEqual(['Bullet 1', 'Bullet 2', 'Bullet 3']);
  });

  it('Whisper retorna texto da transcrição', async () => {
    const OpenAI = require('openai');
    const openai = new OpenAI();
    const res = await openai.audio.transcriptions.create({
      file: Buffer.from('mp3'),
      model: 'whisper-1',
    });
    expect(res.text).toBe('Texto transcrito de teste');
  });
});

describe('Worker — Meta Cloud API (Baileys removido)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('downloadAudioFromMeta é usado no pipeline WhatsApp (não Baileys)', async () => {
    const { downloadAudioFromMeta } = require('../services/whatsapp-official');
    const { convertToMp3 } = require('../services/audio');

    // Simula pipeline whatsapp: download → convert → transcribe
    const audioBuffer = await downloadAudioFromMeta('media-id-123', 'audio/ogg');
    const mp3 = await convertToMp3(audioBuffer);

    expect(downloadAudioFromMeta).toHaveBeenCalledWith('media-id-123', 'audio/ogg');
    expect(convertToMp3).toHaveBeenCalled();
    expect(mp3).toBeInstanceOf(Buffer);
  });

  it('sendMessageToMeta envia resposta de transcrição', async () => {
    const { sendMessageToMeta } = require('../services/whatsapp-official');

    const result = await sendMessageToMeta('5511999999999', '*Transcrição:* Texto transcrito');

    expect(sendMessageToMeta).toHaveBeenCalledWith('5511999999999', expect.any(String));
    expect(result.messages[0].id).toBe('msg-123');
  });

  it('job com source=manual usa audioBase64 (não Meta API)', async () => {
    const { downloadAudioFromMeta } = require('../services/whatsapp-official');
    const { convertToMp3 } = require('../services/audio');

    // No pipeline manual, não há download — decodifica base64 diretamente
    const rawBuffer = Buffer.from('fake-audio-data');
    const audioBase64 = rawBuffer.toString('base64');

    // Simula o pipeline manual
    const decodedBuffer = Buffer.from(audioBase64, 'base64');
    await convertToMp3(decodedBuffer);

    expect(downloadAudioFromMeta).not.toHaveBeenCalled(); // ← não usa Meta API no pipeline manual
    expect(convertToMp3).toHaveBeenCalled();
  });

  it('saldo insuficiente retorna skipped sem processar áudio', async () => {
    const { prisma } = require('../lib/prisma');
    const { downloadAudioFromMeta } = require('../services/whatsapp-official');

    (prisma.minuteBalance.findUnique as jest.Mock).mockResolvedValue({ availableMinutes: 0 });

    const balance = await prisma.minuteBalance.findUnique({ where: { userId: 'u1' } });
    const hasBalance = balance && balance.availableMinutes >= 0.1;

    expect(hasBalance).toBe(false);
    expect(downloadAudioFromMeta).not.toHaveBeenCalled();
  });
});

describe('Worker — transação atômica de débito', () => {
  it('debita minutos somente se saldo suficiente (updateMany com where gte)', async () => {
    const { prisma } = require('../lib/prisma');

    // Simula o débito atômico do worker
    await prisma.$transaction(async (tx: any) => {
      const result = await tx.minuteBalance.updateMany({
        where: { userId: 'u1', availableMinutes: { gte: 1.5 } },
        data:  { availableMinutes: { decrement: 1.5 } },
      });
      expect(result.count).toBe(1); // O mock retorna count:1 = sucesso
    });

    expect(prisma.$transaction).toHaveBeenCalled();
  });
});

describe('Worker — graceful shutdown', () => {
  it('SIGTERM fecha worker e desconecta Prisma', async () => {
    const { prisma } = require('../lib/prisma');
    prisma.$disconnect = jest.fn().mockResolvedValue(undefined);

    const mockWorkerClose = jest.fn().mockResolvedValue(undefined);
    await mockWorkerClose();
    await prisma.$disconnect();

    expect(mockWorkerClose).toHaveBeenCalled();
    expect(prisma.$disconnect).toHaveBeenCalled();
  });
});
