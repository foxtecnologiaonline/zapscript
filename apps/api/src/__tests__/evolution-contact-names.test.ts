/**
 * fetchAllChats/fetchUnreadChats — nome de perfil do contato (pushName) na
 * lista de conversas. Antes desta correção, o nome de uma conversa
 * individual só vinha de campos do próprio objeto de chat (`chat/findChats`),
 * que no self-host normalmente não carrega `pushName` — toda conversa
 * individual caía no fallback `+telefone` na tela do WhatsApp Web, mesmo
 * quando o contato tinha nome de perfil definido no WhatsApp dele. Agora
 * busca também `chat/findContacts` (endpoint separado) e usa o pushName de
 * lá como fonte primária pra conversas individuais.
 */
import { fetchAllChats, fetchUnreadChats } from '../services/evolution';

describe('fetchAllChats/fetchUnreadChats — nome de perfil do contato', () => {
  const realFetch = global.fetch;
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV, EVOLUTION_API_URL: 'https://evo.example.com', EVOLUTION_API_KEY: 'test-key' };
  });

  afterEach(() => {
    global.fetch = realFetch;
    process.env = OLD_ENV;
  });

  function mockEvolution(chats: any[], contacts: any[]) {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (String(url).includes('/chat/findContacts/')) {
        return Promise.resolve({ ok: true, json: async () => contacts });
      }
      return Promise.resolve({ ok: true, json: async () => chats });
    }) as any;
  }

  it('usa o pushName de findContacts quando o chat não traz nome', async () => {
    mockEvolution(
      [{ remoteJid: '5511999999999@s.whatsapp.net', unreadMessages: 1, updatedAt: '2026-01-01T00:00:00.000Z' }],
      [{ id: '5511999999999@s.whatsapp.net', pushName: 'Maria Silva' }],
    );

    const [chat] = await fetchAllChats('instance-1');
    expect(chat.name).toBe('Maria Silva');
    expect(chat.phone).toBe('5511999999999');
  });

  it('sem correspondência em findContacts, cai pro fallback do próprio chat', async () => {
    mockEvolution(
      [{ remoteJid: '5511988888888@s.whatsapp.net', name: 'Nome salvo no chat' }],
      [],
    );

    const [chat] = await fetchAllChats('instance-1');
    expect(chat.name).toBe('Nome salvo no chat');
  });

  it('sem nome em nenhuma fonte, name fica null (fallback pro telefone é responsabilidade do front)', async () => {
    mockEvolution([{ remoteJid: '5511977777777@s.whatsapp.net' }], []);
    const [chat] = await fetchAllChats('instance-1');
    expect(chat.name).toBeNull();
  });

  it('grupo usa subject, nunca findContacts', async () => {
    mockEvolution(
      [{ remoteJid: '120363000000000000@g.us', subject: 'Família' }],
      [{ id: '120363000000000000@g.us', pushName: 'não deveria aparecer' }],
    );
    const [chat] = await fetchAllChats('instance-1');
    expect(chat.name).toBe('Família');
    expect(chat.type).toBe('group');
  });

  it('falha em findContacts não derruba a lista de chats (best-effort)', async () => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (String(url).includes('/chat/findContacts/')) return Promise.reject(new Error('boom'));
      return Promise.resolve({
        ok: true,
        json: async () => [{ remoteJid: '5511966666666@s.whatsapp.net', name: 'Nome do chat' }],
      });
    }) as any;

    const [chat] = await fetchAllChats('instance-1');
    expect(chat.name).toBe('Nome do chat');
  });

  it('fetchUnreadChats (backfill do Copiloto) também recebe o pushName resolvido', async () => {
    mockEvolution(
      [{ remoteJid: '5511955555555@s.whatsapp.net', unreadMessages: 2 }],
      [{ id: '5511955555555@s.whatsapp.net', pushName: 'Cliente Fiel' }],
    );
    const [chat] = await fetchUnreadChats('instance-1');
    expect(chat.name).toBe('Cliente Fiel');
  });
});
