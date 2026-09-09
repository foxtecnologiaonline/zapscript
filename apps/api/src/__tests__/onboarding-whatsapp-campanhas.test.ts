/**
 * Testes da extensão "flavor='campanhas'" em onboarding-whatsapp.ts — o mesmo
 * motor de onboarding (WhatsappOnboardingLead) passa a servir também o número
 * oficial dedicado do Chatbot Campanhas, sem alterar o comportamento default
 * (número oficial de suporte/onboarding geral) usado pelos chamadores já
 * existentes. Foco: getOfficialInstanceName() com/sem purpose, a mensagem de
 * boas-vindas por flavor, e o fechamento (closeLeadOnConnected) escolhendo a
 * instância/mensagem certa por lead.source.
 */

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0'.repeat(64);
process.env.ASAAS_API_KEY  = 'test-key';

const numbers = [
  { id: 'num_generico', zapiInstanceId: 'inst_generico', isPublic: true, publicPurpose: null },
  { id: 'num_campanhas', zapiInstanceId: 'inst_campanhas', isPublic: true, publicPurpose: 'campanhas' },
];

const leads = new Map<string, any>();

jest.mock('../lib/prisma', () => ({
  prisma: {
    whatsappNumber: {
      findFirst: jest.fn(async ({ where }: any) => {
        return numbers.find((n) => n.isPublic === where.isPublic && (where.publicPurpose === undefined || n.publicPurpose === where.publicPurpose)) ?? null;
      }),
      // número recém-conectado do lead (não um dos oficiais) — sem zapiInstanceId no
      // mock, então offerPlanUpgrade cai no fallback evoInstanceName(numberId).
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
    user:                { findFirst: jest.fn(async () => null) },
    campanhaChatSession: { upsert: jest.fn(async () => ({})) },
  },
}));

jest.mock('../services/evolution', () => ({
  sendText: jest.fn(async () => ({ id: 'msg_1' })),
  sendImage: jest.fn(async () => {}),
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
jest.mock('../lib/moduleGate', () => ({ getUserModules: jest.fn(async () => [] as string[]) }));
// campanhas-chat-commands.ts (importado por onboarding-whatsapp.ts p/ offerPlanUpgrade)
// puxa routes/billing.ts e routes/modules/campanhas.ts, que por sua vez importam
// services/queue.ts — sem mock aqui, isso abriria uma conexão Redis real e travaria
// o teste (ioredis tentando conectar e ficando em retry indefinido).
jest.mock('../services/queue', () => ({
  redis: { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK'), del: jest.fn().mockResolvedValue(1) },
  campanhasQueue: { addBulk: jest.fn(async () => []) },
}));

import { sendText } from '../services/evolution';
import { getUserModules } from '../lib/moduleGate';
import {
  getOfficialInstanceName, startFromOfficialNumber, handleOfficialNumberText, closeLeadOnConnected,
} from '../services/onboarding-whatsapp';

function lastSendArgs() {
  const calls = (sendText as jest.Mock).mock.calls;
  return calls[calls.length - 1];
}
function sendArgsAt(i: number) {
  return (sendText as jest.Mock).mock.calls[i];
}

describe('onboarding-whatsapp — flavor campanhas', () => {
  beforeEach(() => { leads.clear(); jest.clearAllMocks(); });

  it('getOfficialInstanceName() sem purpose preserva o comportamento antigo (1º isPublic, ignora publicPurpose)', async () => {
    const name = await getOfficialInstanceName();
    expect(name).toBe('inst_generico');
  });

  it('getOfficialInstanceName("campanhas") resolve só o número dedicado', async () => {
    const name = await getOfficialInstanceName('campanhas');
    expect(name).toBe('inst_campanhas');
  });

  it('startFromOfficialNumber sem flavor manda o pitch genérico e grava source="oficial"', async () => {
    await startFromOfficialNumber('5511988887777', 'Maria', 'inst_generico');
    expect(leads.get('5511988887777').source).toBe('oficial');
    expect(lastSendArgs()[2]).toMatch(/converto e resumo áudios/);
  });

  it('startFromOfficialNumber com flavor="campanhas" manda o pitch de Campanhas e grava source="campanhas"', async () => {
    await startFromOfficialNumber('5511988887777', 'Maria', 'inst_campanhas', 'campanhas');
    expect(leads.get('5511988887777').source).toBe('campanhas');
    expect(lastSendArgs()[2]).toMatch(/crio e disparo campanhas/);
    expect(lastSendArgs()[0]).toBe('inst_campanhas');
  });

  it('handleOfficialNumberText propaga o flavor até o início do lead (estranho no número de Campanhas)', async () => {
    const handled = await handleOfficialNumberText('inst_campanhas', '5511977776666', 'João', 'oi', 'msg1', 'campanhas');
    expect(handled).toBe(true);
    expect(leads.get('5511977776666').source).toBe('campanhas');
    expect(lastSendArgs()[2]).toMatch(/crio e disparo campanhas/);
  });

  it('handleOfficialNumberText sem flavor continua com o pitch genérico (número de suporte)', async () => {
    await handleOfficialNumberText('inst_generico', '5511977776666', 'João', 'oi', 'msg1');
    expect(leads.get('5511977776666').source).toBe('oficial');
    expect(lastSendArgs()[2]).toMatch(/converto e resumo áudios/);
  });

  it('closeLeadOnConnected (source="campanhas") confirma pelo número oficial e, sem módulo ainda, oferece upgrade de plano pelo número recém-conectado', async () => {
    leads.set('5511900001111', { phone: '5511900001111', stage: 'code_sent', numberId: 'meu_numero', name: null, pushName: 'Ana', source: 'campanhas', userId: 'user_ana' });
    await closeLeadOnConnected('meu_numero');
    expect(leads.get('5511900001111').stage).toBe('completed');

    // 1ª mensagem: confirmação pelo número oficial de Campanhas
    expect(sendArgsAt(0)[0]).toBe('inst_campanhas');
    expect(sendArgsAt(0)[2]).toMatch(/já está conectado/);

    // 2ª mensagem: oferta de upgrade, pelo número que ELE acabou de conectar (self-chat)
    expect(sendArgsAt(1)[0]).toBe('zs-meu_numero');
    expect(sendArgsAt(1)[2]).toMatch(/Profissional/);
  });

  it('closeLeadOnConnected (source="campanhas") não oferece upgrade se o módulo já está ativo', async () => {
    (getUserModules as jest.Mock).mockResolvedValueOnce(['campanhas']);
    leads.set('5511900001111', { phone: '5511900001111', stage: 'code_sent', numberId: 'meu_numero', name: null, pushName: 'Ana', source: 'campanhas', userId: 'user_ana' });
    await closeLeadOnConnected('meu_numero');
    expect(sendArgsAt(1)[2]).toMatch(/já tem o módulo Campanhas ativo/);
  });

  it('closeLeadOnConnected mantém a mensagem genérica quando lead.source="oficial" (sem oferta de upgrade)', async () => {
    leads.set('5511900001111', { phone: '5511900001111', stage: 'code_sent', numberId: 'meu_numero', name: null, pushName: 'Ana', source: 'oficial' });
    await closeLeadOnConnected('meu_numero');
    expect(lastSendArgs()[2]).toMatch(/áudio que chegar/);
    expect(sendText).toHaveBeenCalledTimes(1);
  });
});
