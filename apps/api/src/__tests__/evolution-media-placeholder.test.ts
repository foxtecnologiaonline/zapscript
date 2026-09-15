/**
 * mediaPlaceholderText — placeholder mínimo pra mídia sem áudio nem texto
 * (foto, figurinha, documento, localização, contato) que, sem isto, era
 * completamente invisível pro Copiloto (nem a triagem chegava a rodar).
 *
 * Áudio fica de fora de propósito: tem pipeline própria de transcrição
 * (processEvolutionJob, apps/worker/src/index.ts) — aqui geraria um
 * placeholder cego onde o conteúdo real já está disponível.
 */
import { mediaPlaceholderText, fetchChatMessages } from '../services/evolution';

describe('mediaPlaceholderText', () => {
  it('foto sem legenda', () => {
    expect(mediaPlaceholderText('imageMessage', {})).toBe('[foto]');
  });

  it('foto com legenda', () => {
    expect(mediaPlaceholderText('imageMessage', { imageMessage: { caption: 'chegou assim' } }))
      .toBe('[foto] chegou assim');
  });

  it('vídeo com legenda', () => {
    expect(mediaPlaceholderText('videoMessage', { videoMessage: { caption: 'olha isso' } }))
      .toBe('[vídeo] olha isso');
  });

  it('figurinha nunca tem legenda', () => {
    expect(mediaPlaceholderText('stickerMessage', { stickerMessage: {} })).toBe('[figurinha]');
  });

  it('documento com legenda', () => {
    expect(mediaPlaceholderText('documentMessage', { documentMessage: { caption: 'contrato.pdf' } }))
      .toBe('[documento] contrato.pdf');
  });

  it('documento com legenda (envelope documentWithCaptionMessage)', () => {
    expect(mediaPlaceholderText('documentWithCaptionMessage', {
      documentWithCaptionMessage: { message: { documentMessage: { caption: 'nota fiscal' } } },
    })).toBe('[documento] nota fiscal');
  });

  it('localização (e live location) não tem legenda', () => {
    expect(mediaPlaceholderText('locationMessage', {})).toBe('[localização]');
    expect(mediaPlaceholderText('liveLocationMessage', {})).toBe('[localização]');
  });

  it('contato (e lista de contatos)', () => {
    expect(mediaPlaceholderText('contactMessage', {})).toBe('[contato]');
    expect(mediaPlaceholderText('contactsArrayMessage', {})).toBe('[contato]');
  });

  it('áudio fica de fora — tem pipeline própria de transcrição', () => {
    expect(mediaPlaceholderText('audioMessage', {})).toBeNull();
    expect(mediaPlaceholderText('pttMessage', {})).toBeNull();
  });

  it('tipo desconhecido/não mapeado retorna null', () => {
    expect(mediaPlaceholderText('reactionMessage', {})).toBeNull();
    expect(mediaPlaceholderText(undefined, {})).toBeNull();
  });
});

/**
 * fetchChatMessages (backfill) — antes desta correção, uma conversa cujas
 * mensagens não lidas eram só mídia (foto/figurinha/documento) devolvia uma
 * lista VAZIA, e o backfill nunca ingeria nada dela (silêncio total pro
 * Copiloto). Confirma que mídia reconhecida agora vira placeholder na saída,
 * lado a lado com texto puro, sem perder ordenação.
 */
describe('fetchChatMessages — placeholder de mídia no backfill', () => {
  const realFetch = global.fetch;
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV, EVOLUTION_API_URL: 'https://evo.example.com', EVOLUTION_API_KEY: 'test-key' };
  });

  afterEach(() => {
    global.fetch = realFetch;
    process.env = OLD_ENV;
  });

  function mockFindMessages(records: any[]) {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => records,
    }) as any;
  }

  it('mistura texto puro e placeholder de mídia, mantendo ordem cronológica', async () => {
    mockFindMessages([
      { key: { id: 'm1', fromMe: false }, messageType: 'conversation', message: { conversation: 'Oi, bom dia' }, messageTimestamp: 100 },
      { key: { id: 'm2', fromMe: false }, messageType: 'imageMessage', message: { imageMessage: { caption: 'ficou assim' } }, messageTimestamp: 200 },
      { key: { id: 'm3', fromMe: false }, messageType: 'stickerMessage', message: {}, messageTimestamp: 300 },
      { key: { id: 'm4', fromMe: false }, messageType: 'reactionMessage', message: {}, messageTimestamp: 400 },
    ]);

    const out = await fetchChatMessages('instance-1', '5511999999999@s.whatsapp.net');

    expect(out.map((m) => m.text)).toEqual(['Oi, bom dia', '[foto] ficou assim', '[figurinha]']);
    expect(out.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']); // reactionMessage (m4) descartada
  });

  it('conversa só com mídia não lida deixa de devolver vazio (bug corrigido)', async () => {
    mockFindMessages([
      { key: { id: 'm1', fromMe: false }, messageType: 'imageMessage', message: {}, messageTimestamp: 100 },
    ]);
    const out = await fetchChatMessages('instance-1', '5511999999999@s.whatsapp.net');
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('[foto]');
  });
});
