/**
 * Testes da integração do Chatbot Campanhas em onboarding-whatsapp.ts — o
 * MESMO número oficial (isPublic) serve onboarding/suporte geral E Campanhas
 * (não precisa de um número dedicado à parte): a intenção é detectada por
 * palavra-chave ("campanha ...") ou por uma CampanhaChatSession já em
 * andamento. Isola campanhas-chat-commands.ts (mockado) — sua lógica interna
 * já é coberta por campanhas-chat-commands.test.ts; aqui o foco é o
 * DESPACHO: getOfficialInstanceName com/sem purpose, o pitch por flavor, e
 * handleOfficialNumberText decidindo entre onboarding padrão, Campanhas
 * (lead novo ou cliente existente) e o fallback de suporte.
 */

const numbers = [
  { id: 'num_generico', zapiInstanceId: 'inst_generico', isPublic: true, publicPurpose: null },
  { id: 'num_campanhas', zapiInstanceId: 'inst_campanhas', isPublic: true, publicPurpose: 'campanhas' },
];

const leads = new Map<string, any>();
const users = new Map<string, { id: string; name: string | null; phone: string }>();
const ownNumbers = new Map<string, { id: string }>(); // userId -> número Evolution próprio
const campanhaSessions = new Map<string, any>();

jest.mock('../lib/prisma', () => ({
  prisma: {
    whatsappNumber: {
      findFirst: jest.fn(async ({ where }: any) => {
        // busca do número Evolution PRÓPRIO do cliente (userId, provider evolution)
        if (where.userId) return ownNumbers.get(where.userId) ?? null;
        if (where.isPublic !== undefined) {
          return numbers.find((n) => n.isPublic === where.isPublic && (where.publicPurpose === undefined || n.publicPurpose === where.publicPurpose)) ?? null;
        }
        return null;
      }),
      findUnique: jest.fn(async () => null),
    },
    whatsappOnboardingLead: {
      findUnique: jest.fn(async ({ where }: any) => leads.get(where.phone) ?? null),
      findFirst:  jest.fn(async ({ where }: any) => {
        for (const lead of leads.values()) {
          if (where.numberId && lead.numberId !== where.numberId) continue;
          if (where.stage?.not && lead.stage === where.stage.not) continue;
          return lead;
        }
        return null;
      }),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const row = leads.has(where.phone) ? { ...leads.get(where.phone), ...update } : { phone: where.phone, ...create };
        leads.set(where.phone, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = { ...leads.get(where.phone), ...data };
        leads.set(where.phone, row);
        return row;
      }),
    },
    user: {
      findFirst: jest.fn(async ({ where }: any) => {
        const digits = where?.phone?.contains;
        if (!digits) return null;
        return [...users.values()].find((u) => u.phone.endsWith(digits)) ?? null;
      }),
    },
    campanhaChatSession: {
      findUnique: jest.fn(async ({ where }: any) => campanhaSessions.get(where.phone) ?? null),
    },
  },
}));

jest.mock('../services/evolution', () => ({
  sendText: jest.fn(async () => ({ id: 'msg_1' })),
  instanceName: (id: string) => `zs-${id}`,
}));
jest.mock('../services/number-provisioning', () => ({
  provisionInstance: jest.fn(async () => ({ ok: true })),
  requestPairingCode: jest.fn(async () => ({ ok: true, code: '123-456' })),
}));
jest.mock('../services/account-provisioning', () => ({
  createPasswordlessAccount: jest.fn(async () => ({ ok: true, userId: 'new_user', alreadyExisted: false })),
}));
jest.mock('../services/support-intake', () => ({ intakeMessage: jest.fn(async () => {}) }));
jest.mock('../services/campanhas-chat-commands', () => ({
  isCampanhaChatCommand:    jest.fn((text: string) => /^\s*campanha\b/i.test(text ?? '')),
  handleCampanhaChatCommand: jest.fn(async () => {}),
  handleCampanhaChatReply:   jest.fn(async () => false),
  offerPlanUpgrade:          jest.fn(async () => {}),
}));

import { sendText } from '../services/evolution';
import { intakeMessage } from '../services/support-intake';
import {
  handleCampanhaChatCommand, handleCampanhaChatReply, offerPlanUpgrade,
} from '../services/campanhas-chat-commands';
import {
  getOfficialInstanceName, startFromOfficialNumber, handleOfficialNumberText, closeLeadOnConnected,
} from '../services/onboarding-whatsapp';

function lastSendArgs() {
  const calls = (sendText as jest.Mock).mock.calls;
  return calls[calls.length - 1];
}

describe('onboarding-whatsapp — Chatbot Campanhas no mesmo número oficial', () => {
  beforeEach(() => {
    leads.clear(); users.clear(); ownNumbers.clear(); campanhaSessions.clear();
    jest.clearAllMocks();
  });

  it('getOfficialInstanceName() sem purpose preserva o comportamento antigo (1º isPublic, ignora publicPurpose)', async () => {
    const name = await getOfficialInstanceName();
    expect(name).toBe('inst_generico');
  });

  it('getOfficialInstanceName("campanhas") resolve o número marcado com esse purpose, quando existir', async () => {
    const name = await getOfficialInstanceName('campanhas');
    expect(name).toBe('inst_campanhas');
  });

  it('startFromOfficialNumber sem flavor manda o pitch genérico e grava source="oficial"', async () => {
    await startFromOfficialNumber('5511988887777', 'Maria', 'inst_generico');
    expect(leads.get('5511988887777').source).toBe('oficial');
    expect(lastSendArgs()[2]).toMatch(/converto e resumo áudios/);
  });

  it('startFromOfficialNumber com flavor="campanhas" manda o pitch de Campanhas e grava source="campanhas"', async () => {
    await startFromOfficialNumber('5511988887777', 'Maria', 'inst_generico', 'campanhas');
    expect(leads.get('5511988887777').source).toBe('campanhas');
    expect(lastSendArgs()[2]).toMatch(/crio e disparo campanhas/);
  });

  it('estranho manda "campanha" pro número oficial → inicia o cadastro já com o pitch de Campanhas', async () => {
    const handled = await handleOfficialNumberText('inst_generico', '5511977776666', 'João', 'campanha nova', 'msg1');
    expect(handled).toBe(true);
    expect(leads.get('5511977776666').source).toBe('campanhas');
    expect(lastSendArgs()[2]).toMatch(/crio e disparo campanhas/);
  });

  it('estranho manda mensagem qualquer (sem "campanha") → pitch genérico, sem tocar no bot de Campanhas', async () => {
    await handleOfficialNumberText('inst_generico', '5511977776666', 'João', 'oi', 'msg1');
    expect(leads.get('5511977776666').source).toBe('oficial');
    expect(handleCampanhaChatCommand).not.toHaveBeenCalled();
  });

  it('cliente existente manda "campanha nova" pro número oficial → despacha pro bot com o número Evolution PRÓPRIO dele', async () => {
    users.set('u1', { id: 'u1', name: 'Fulano', phone: '5511900001111' });
    ownNumbers.set('u1', { id: 'meu_numero_evolution' });

    const handled = await handleOfficialNumberText('inst_generico', '5511900001111', 'Fulano', 'campanha nova', 'msg1');
    expect(handled).toBe(true);
    expect(handleCampanhaChatCommand).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u1', numberId: 'meu_numero_evolution', instanceName: 'inst_generico', selfPhone: '5511900001111', text: 'campanha nova',
    }));
    expect(intakeMessage).not.toHaveBeenCalled();
  });

  it('cliente existente sem WhatsApp próprio conectado ainda ganha numberId vazio (o bot avisa pra conectar)', async () => {
    users.set('u1', { id: 'u1', name: 'Fulano', phone: '5511900001111' });
    // sem ownNumbers.set — cliente ainda não conectou nenhum número Evolution

    await handleOfficialNumberText('inst_generico', '5511900001111', 'Fulano', 'campanha nova', 'msg1');
    expect(handleCampanhaChatCommand).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', numberId: '' }));
  });

  it('cliente existente com sessão ativa responde sem prefixo "campanha" → cai em handleCampanhaChatReply', async () => {
    users.set('u1', { id: 'u1', name: 'Fulano', phone: '5511900001111' });
    ownNumbers.set('u1', { id: 'meu_numero_evolution' });
    campanhaSessions.set('5511900001111', { phone: '5511900001111', stage: 'previewing' });
    (handleCampanhaChatReply as jest.Mock).mockResolvedValueOnce(true);

    const handled = await handleOfficialNumberText('inst_generico', '5511900001111', 'Fulano', '👍', 'msg1');
    expect(handled).toBe(true);
    expect(handleCampanhaChatReply).toHaveBeenCalledWith(expect.objectContaining({ selfPhone: '5511900001111', text: '👍' }));
    expect(intakeMessage).not.toHaveBeenCalled();
  });

  it('cliente existente sem sessão ativa e sem prefixo "campanha" → cai no fallback de suporte, não no bot', async () => {
    users.set('u1', { id: 'u1', name: 'Fulano', phone: '5511900001111' });
    ownNumbers.set('u1', { id: 'meu_numero_evolution' });

    const handled = await handleOfficialNumberText('inst_generico', '5511900001111', 'Fulano', 'preciso de ajuda com outra coisa', 'msg1');
    expect(handled).toBe(true);
    expect(handleCampanhaChatCommand).not.toHaveBeenCalled();
    expect(handleCampanhaChatReply).not.toHaveBeenCalled();
    expect(intakeMessage).toHaveBeenCalledWith(expect.objectContaining({ clienteWhatsapp: '5511900001111' }), expect.anything());
  });

  it('closeLeadOnConnected (source="campanhas") confirma pelo número oficial e chama offerPlanUpgrade pelo número recém-conectado', async () => {
    leads.set('5511900001111', { phone: '5511900001111', stage: 'code_sent', numberId: 'meu_numero', name: null, pushName: 'Ana', source: 'campanhas', userId: 'user_ana' });
    await closeLeadOnConnected('meu_numero');
    expect(leads.get('5511900001111').stage).toBe('completed');
    expect(lastSendArgs()[0]).toBe('inst_campanhas'); // confirmação sai pelo oficial (fallback: só o dedicado, se existir)
    expect(offerPlanUpgrade).toHaveBeenCalledWith('zs-meu_numero', 'user_ana', '5511900001111');
  });

  it('closeLeadOnConnected mantém o comportamento padrão (sem oferta de upgrade) quando lead.source="oficial"', async () => {
    leads.set('5511900001111', { phone: '5511900001111', stage: 'code_sent', numberId: 'meu_numero', name: null, pushName: 'Ana', source: 'oficial' });
    await closeLeadOnConnected('meu_numero');
    expect(lastSendArgs()[2]).toMatch(/áudio que chegar/);
    expect(offerPlanUpgrade).not.toHaveBeenCalled();
  });
});
