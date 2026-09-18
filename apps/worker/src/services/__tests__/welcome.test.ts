import { maybeSendWelcome } from '../welcome';
import { prisma } from '../../lib/prisma';
import { sendMessageViaEvolution, sendPtt, sendVideo } from '../evolution';

jest.mock('../../lib/prisma', () => ({
  prisma: {
    welcomeConfig: { findUnique: jest.fn() },
    atendeConversation: { updateMany: jest.fn() },
  },
}));

jest.mock('../../lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../evolution', () => ({
  sendMessageViaEvolution: jest.fn(),
  sendPtt: jest.fn(),
  sendImage: jest.fn(),
  sendVideo: jest.fn(),
}));

describe('welcome — maybeSendWelcome', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (sendMessageViaEvolution as jest.Mock).mockResolvedValue({ id: null });
    (sendPtt as jest.Mock).mockResolvedValue(undefined);
    (sendVideo as jest.Mock).mockResolvedValue(undefined);
  });

  it('não envia nada quando welcomeConfig não existe', async () => {
    (prisma.welcomeConfig.findUnique as jest.Mock).mockResolvedValueOnce(null);

    await maybeSendWelcome('conv-1', 'number-1', 'instance-1', '5511999998888');

    expect(prisma.atendeConversation.updateMany).not.toHaveBeenCalled();
    expect(sendMessageViaEvolution).not.toHaveBeenCalled();
  });

  it('não envia nada quando welcomeConfig existe mas está desabilitado', async () => {
    (prisma.welcomeConfig.findUnique as jest.Mock).mockResolvedValueOnce({ enabled: false, text: 'oi' });

    await maybeSendWelcome('conv-1', 'number-1', 'instance-1', '5511999998888');

    expect(sendMessageViaEvolution).not.toHaveBeenCalled();
  });

  it('não envia nada quando não há texto, áudio nem vídeo configurados', async () => {
    (prisma.welcomeConfig.findUnique as jest.Mock).mockResolvedValueOnce({
      enabled: true, text: null, audioBytes: null, videoBytes: null,
    });

    await maybeSendWelcome('conv-1', 'number-1', 'instance-1', '5511999998888');

    expect(prisma.atendeConversation.updateMany).not.toHaveBeenCalled();
  });

  it('trata Buffer vazio como "sem mídia" (Buffer é objeto — truthy mesmo com length 0)', async () => {
    (prisma.welcomeConfig.findUnique as jest.Mock).mockResolvedValueOnce({
      enabled: true, text: null, audioBytes: Buffer.alloc(0), videoBytes: Buffer.alloc(0),
    });

    await maybeSendWelcome('conv-1', 'number-1', 'instance-1', '5511999998888');

    expect(prisma.atendeConversation.updateMany).not.toHaveBeenCalled();
    expect(sendPtt).not.toHaveBeenCalled();
    expect(sendVideo).not.toHaveBeenCalled();
  });

  it('envia texto mas pula áudio vazio quando só o vídeo tem bytes de verdade', async () => {
    (prisma.welcomeConfig.findUnique as jest.Mock).mockResolvedValueOnce({
      enabled: true, text: 'Oi!', audioBytes: Buffer.alloc(0), videoBytes: Buffer.from('video-bytes'), videoMime: 'video/mp4',
    });
    (prisma.atendeConversation.updateMany as jest.Mock).mockResolvedValueOnce({ count: 1 });

    await maybeSendWelcome('conv-1', 'number-1', 'instance-1', '5511999998888');

    expect(sendMessageViaEvolution).toHaveBeenCalled();
    expect(sendPtt).not.toHaveBeenCalled();
    expect(sendVideo).toHaveBeenCalled();
  });

  it('envia texto quando o guard atômico afeta 1 linha (venceu a corrida)', async () => {
    (prisma.welcomeConfig.findUnique as jest.Mock).mockResolvedValueOnce({
      enabled: true, text: 'Bem-vindo!', audioBytes: null, videoBytes: null,
    });
    (prisma.atendeConversation.updateMany as jest.Mock).mockResolvedValueOnce({ count: 1 });

    await maybeSendWelcome('conv-1', 'number-1', 'instance-1', '5511999998888');

    expect(sendMessageViaEvolution).toHaveBeenCalledWith('instance-1', '5511999998888', 'Bem-vindo!');
  });

  it('NÃO envia quando o guard atômico afeta 0 linhas — já recebeu boas-vindas hoje (ou outro job venceu a corrida)', async () => {
    (prisma.welcomeConfig.findUnique as jest.Mock).mockResolvedValueOnce({
      enabled: true, text: 'Bem-vindo!', audioBytes: null, videoBytes: null,
    });
    (prisma.atendeConversation.updateMany as jest.Mock).mockResolvedValueOnce({ count: 0 });

    await maybeSendWelcome('conv-1', 'number-1', 'instance-1', '5511999998888');

    expect(sendMessageViaEvolution).not.toHaveBeenCalled();
  });

  it('envia áudio e vídeo em base64 quando configurados, além do texto', async () => {
    (prisma.welcomeConfig.findUnique as jest.Mock).mockResolvedValueOnce({
      enabled: true,
      text: 'Bem-vindo!',
      audioBytes: Buffer.from('audio-bytes'),
      videoBytes: Buffer.from('video-bytes'),
      videoMime: 'video/mp4',
    });
    (prisma.atendeConversation.updateMany as jest.Mock).mockResolvedValueOnce({ count: 1 });

    await maybeSendWelcome('conv-1', 'number-1', 'instance-1', '5511999998888');

    expect(sendMessageViaEvolution).toHaveBeenCalledTimes(1);
    expect(sendPtt).toHaveBeenCalledWith('instance-1', '5511999998888', Buffer.from('audio-bytes').toString('base64'));
    expect(sendVideo).toHaveBeenCalledWith('instance-1', '5511999998888', Buffer.from('video-bytes').toString('base64'), 'video/mp4');
  });

  it('falha ao enviar áudio não impede o envio do vídeo (best-effort por mídia)', async () => {
    (prisma.welcomeConfig.findUnique as jest.Mock).mockResolvedValueOnce({
      enabled: true,
      text: null,
      audioBytes: Buffer.from('audio-bytes'),
      videoBytes: Buffer.from('video-bytes'),
      videoMime: 'video/mp4',
    });
    (prisma.atendeConversation.updateMany as jest.Mock).mockResolvedValueOnce({ count: 1 });
    (sendPtt as jest.Mock).mockRejectedValueOnce(new Error('falhou'));

    await expect(maybeSendWelcome('conv-1', 'number-1', 'instance-1', '5511999998888')).resolves.not.toThrow();

    expect(sendVideo).toHaveBeenCalled();
  });

  it('nunca lança mesmo se prisma explodir (best-effort, não pode derrubar o job do Atende)', async () => {
    (prisma.welcomeConfig.findUnique as jest.Mock).mockRejectedValueOnce(new Error('db caiu'));

    await expect(maybeSendWelcome('conv-1', 'number-1', 'instance-1', '5511999998888')).resolves.toBeUndefined();
  });
});
