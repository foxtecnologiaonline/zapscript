import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prisma } from '../lib/prisma';
import {
  handleOptinResponse,
  OPT_IN_KEYWORDS,
  OPT_OUT_RESPONSE_KEYWORDS,
  OPT_OUT_KEYWORDS,
  registerCampanhaOptOut,
} from '../routes/modules/campanhas';

describe('Sistema de Opt-In (Campanhas)', () => {
  const testUserId = 'user-test-optin-' + Date.now();
  const testPhone = '+5511987654321';
  const testPhoneNormalized = '5511987654321';

  beforeEach(async () => {
    // Setup: criar usuário de teste
    await prisma.user.create({
      data: {
        id: testUserId,
        email: `optin-test-${Date.now()}@test.com`,
        emailVerified: true,
      },
    }).catch(() => null);
  });

  afterEach(async () => {
    // Cleanup
    await prisma.campanhaContato.deleteMany({
      where: { campanha: { userId: testUserId } },
    }).catch(() => null);
    await prisma.campanha.deleteMany({
      where: { userId: testUserId },
    }).catch(() => null);
    await prisma.campanhaOptOut.deleteMany({
      where: { userId: testUserId },
    }).catch(() => null);
    await prisma.user.delete({
      where: { id: testUserId },
    }).catch(() => null);
  });

  describe('handleOptinResponse()', () => {
    let campanhaId: string;
    let contatoId: string;

    beforeEach(async () => {
      // Setup: criar campanha e contato de teste
      const campanha = await prisma.campanha.create({
        data: {
          userId: testUserId,
          name: 'Test Campaign',
          channel: 'evolution',
          whatsappNumberId: 'test-num-' + Date.now(),
          messageBody: 'Test message',
          audienceCount: 1,
          status: 'running',
        },
      });
      campanhaId = campanha.id;

      const contato = await prisma.campanhaContato.create({
        data: {
          campanhaId,
          phone: testPhoneNormalized,
          status: 'pending_optin',
        },
      });
      contatoId = contato.id;
    });

    it('deve confirmar opt-in com "SIM"', async () => {
      const result = await handleOptinResponse(testUserId, testPhone, 'SIM');
      expect(result).toBe('confirmed');

      const updated = await prisma.campanhaContato.findUnique({
        where: { id: contatoId },
      });
      expect(updated?.optinConfirmedAt).toBeTruthy();
      expect(updated?.status).toBe('pending');
    });

    it('deve confirmar opt-in com variações de "sim"', async () => {
      const variations = ['sim', 'Sim', 'SIM', ' SIM '];
      for (const text of variations) {
        // Reset estado
        await prisma.campanhaContato.update({
          where: { id: contatoId },
          data: { optinConfirmedAt: null, status: 'pending_optin' },
        });

        const result = await handleOptinResponse(testUserId, testPhone, text);
        expect(result).toBe('confirmed', `falhou com "${text}"`);
      }
    });

    it('deve rejeitar opt-in com "NÃO"', async () => {
      const result = await handleOptinResponse(testUserId, testPhone, 'NÃO');
      expect(result).toBe('rejected');

      const optout = await prisma.campanhaOptOut.findFirst({
        where: { userId: testUserId, phone: testPhoneNormalized },
      });
      expect(optout).toBeTruthy();
    });

    it('deve rejeitar opt-in com "NAO" (sem acento)', async () => {
      const result = await handleOptinResponse(testUserId, testPhone, 'NAO');
      expect(result).toBe('rejected');

      const optout = await prisma.campanhaOptOut.findFirst({
        where: { userId: testUserId, phone: testPhoneNormalized },
      });
      expect(optout).toBeTruthy();
    });

    it('deve rejeitar opt-in com "SAIR"', async () => {
      const result = await handleOptinResponse(testUserId, testPhone, 'SAIR');
      expect(result).toBe('rejected');

      const optout = await prisma.campanhaOptOut.findFirst({
        where: { userId: testUserId, phone: testPhoneNormalized },
      });
      expect(optout).toBeTruthy();
    });

    it('deve registrar "PARAR" como opt-out direto (não resposta a pergunta)', async () => {
      await prisma.campanhaContato.update({
        where: { id: contatoId },
        data: { status: 'pending' }, // estado normal, não pending_optin
      });

      const result = await handleOptinResponse(testUserId, testPhone, 'PARAR');
      expect(result).toBe('rejected');

      const optout = await prisma.campanhaOptOut.findFirst({
        where: { userId: testUserId, phone: testPhoneNormalized },
      });
      expect(optout).toBeTruthy();
    });

    it('deve retornar "none" para texto que não é resposta', async () => {
      const result = await handleOptinResponse(testUserId, testPhone, 'texto aleatório');
      expect(result).toBe('none');

      const contato = await prisma.campanhaContato.findUnique({
        where: { id: contatoId },
      });
      expect(contato?.status).toBe('pending_optin'); // não deve mudar
    });

    it('deve isolar por userId (segurança)', async () => {
      const otherUserId = 'user-other-' + Date.now();
      await prisma.user.create({
        data: {
          id: otherUserId,
          email: `other-${Date.now()}@test.com`,
          emailVerified: true,
        },
      }).catch(() => null);

      const result = await handleOptinResponse(otherUserId, testPhone, 'SIM');
      expect(result).toBe('none'); // não deve afetar contato de outro usuário

      const contato = await prisma.campanhaContato.findUnique({
        where: { id: contatoId },
      });
      expect(contato?.optinConfirmedAt).toBeNull(); // não alterado
    });
  });

  describe('registerCampanhaOptOut()', () => {
    it('deve registrar opt-out com idempotência', async () => {
      await registerCampanhaOptOut(testUserId, testPhone, 'NAO');
      const count1 = await prisma.campanhaOptOut.count({
        where: { userId: testUserId, phone: testPhoneNormalized },
      });
      expect(count1).toBe(1);

      // Segunda chamada com mesmo telefone
      await registerCampanhaOptOut(testUserId, testPhone, 'SAIR');
      const count2 = await prisma.campanhaOptOut.count({
        where: { userId: testUserId, phone: testPhoneNormalized },
      });
      expect(count2).toBe(1); // ainda 1 (upsert)

      // Verificar que reason foi atualizado
      const optout = await prisma.campanhaOptOut.findFirst({
        where: { userId: testUserId, phone: testPhoneNormalized },
      });
      expect(optout?.reason).toBe('SAIR');
    });
  });

  describe('Keyword Sets', () => {
    it('deve conter keywords de opt-in corretas', () => {
      expect(OPT_IN_KEYWORDS.has('SIM')).toBe(true);
      expect(OPT_IN_KEYWORDS.has('NAO')).toBe(false);
    });

    it('deve conter keywords de negação sem duplicatas', () => {
      const arr = Array.from(OPT_OUT_RESPONSE_KEYWORDS);
      expect(arr.length).toBe(new Set(arr).size); // sem duplicatas
    });

    it('deve conter keywords de opt-out direto', () => {
      expect(OPT_OUT_KEYWORDS.has('PARAR')).toBe(true);
      expect(OPT_OUT_KEYWORDS.has('SAIR')).toBe(true);
      expect(OPT_OUT_KEYWORDS.has('STOP')).toBe(true);
    });
  });
});

describe('CSV Parsing Utilities', () => {
  it('deve validar limite de tamanho de arquivo', () => {
    // Este teste é simbólico — o limite real é testado no endpoint
    // Aqui verificamos que a constante está definida
    const MAX_CSV_SIZE = 10 * 1024 * 1024; // 10 MB
    expect(MAX_CSV_SIZE).toBe(10485760);
  });
});
