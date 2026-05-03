/**
 * Testes de validação de entrada com Zod.
 */
import {
  signupSchema,
  loginSchema,
  createNumberSchema,
  createTranscriptionSchema,
  adminUpdateUserSchema,
} from '../lib/validation';

describe('Input Validation with Zod', () => {
  describe('signupSchema', () => {
    it('valida email e password válidos', () => {
      const result = signupSchema.safeParse({
        email: 'user@example.com',
        password: 'securepass123',
      });
      expect(result.success).toBe(true);
    });

    it('rejeita email inválido', () => {
      const result = signupSchema.safeParse({
        email: 'invalid-email',
        password: 'securepass123',
      });
      expect(result.success).toBe(false);
    });

    it('rejeita password < 8 caracteres', () => {
      const result = signupSchema.safeParse({
        email: 'user@example.com',
        password: 'short',
      });
      expect(result.success).toBe(false);
    });

    it('converte email para lowercase', () => {
      const result = signupSchema.safeParse({
        email: 'USER@EXAMPLE.COM',
        password: 'securepass123',
      });
      if (result.success) {
        expect(result.data.email).toBe('user@example.com');
      }
    });
  });

  describe('loginSchema', () => {
    it('valida login com email e password', () => {
      const result = loginSchema.safeParse({
        email: 'user@example.com',
        password: 'pass',
      });
      expect(result.success).toBe(true);
    });

    it('rejeita email faltando', () => {
      const result = loginSchema.safeParse({
        password: 'pass',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('createNumberSchema', () => {
    it('valida número com 10-15 dígitos', () => {
      const result = createNumberSchema.safeParse({
        phoneNumber: '5511999999999',
        displayName: 'Número Principal',
      });
      expect(result.success).toBe(true);
    });

    it('rejeita número < 10 dígitos', () => {
      const result = createNumberSchema.safeParse({
        phoneNumber: '123',
        displayName: 'Número',
      });
      expect(result.success).toBe(false);
    });

    it('rejeita número > 15 dígitos', () => {
      const result = createNumberSchema.safeParse({
        phoneNumber: '551199999999991234567',
        displayName: 'Número',
      });
      expect(result.success).toBe(false);
    });

    it('rejeita números com caracteres não-numéricos', () => {
      const result = createNumberSchema.safeParse({
        phoneNumber: '55 11 99999-9999',
        displayName: 'Número',
      });
      expect(result.success).toBe(false);
    });

    it('rejeita displayName vazio', () => {
      const result = createNumberSchema.safeParse({
        phoneNumber: '5511999999999',
        displayName: '',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('createTranscriptionSchema', () => {
    it('valida transcrição com dados válidos', () => {
      const result = createTranscriptionSchema.safeParse({
        numberId: 'clid0000000000000000000a',
        audioBase64: Buffer.from('test').toString('base64'),
        contactPhone: '5511999999999',
        language: 'pt',
      });
      expect(result.success).toBe(true);
    });

    it('rejeita audioBase64 vazio', () => {
      const result = createTranscriptionSchema.safeParse({
        numberId: 'clid0000000000000000000a',
        audioBase64: '',
        contactPhone: '5511999999999',
      });
      expect(result.success).toBe(false);
    });

    it('aceita idiomas: pt, en, es', () => {
      for (const lang of ['pt', 'en', 'es']) {
        const result = createTranscriptionSchema.safeParse({
          numberId: 'clid0000000000000000000a',
          audioBase64: Buffer.from('test').toString('base64'),
          contactPhone: '5511999999999',
          language: lang,
        });
        expect(result.success).toBe(true);
      }
    });

    it('rejeita idioma inválido', () => {
      const result = createTranscriptionSchema.safeParse({
        numberId: 'clid0000000000000000000a',
        audioBase64: Buffer.from('test').toString('base64'),
        contactPhone: '5511999999999',
        language: 'fr', // Francês não suportado
      });
      expect(result.success).toBe(false);
    });
  });

  describe('adminUpdateUserSchema', () => {
    it('valida atualização com campos opcionais', () => {
      const result = adminUpdateUserSchema.safeParse({
        name: 'New Name',
        isAdmin: true,
      });
      expect(result.success).toBe(true);
    });

    it('permite objeto vazio (all optional)', () => {
      const result = adminUpdateUserSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('rejeita email inválido', () => {
      const result = adminUpdateUserSchema.safeParse({
        email: 'invalid',
      });
      expect(result.success).toBe(false);
    });
  });
});
