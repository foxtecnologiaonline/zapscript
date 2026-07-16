import { z } from 'zod';

// ── Auth Schemas ──────────────────────────────────────────
export const signupSchema = z.object({
  email: z.string().email('Email inválido').toLowerCase(),
  password: z.string().min(6, 'Senha deve ter pelo menos 6 caracteres'),
  name: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres').optional(),
  referralCode: z.string().optional(),
});

// Schema completo de registro (inclui todos os campos do form)
export const registerSchema = z.object({
  email:        z.string().email('E-mail inválido'),
  password:     z.string().min(8, 'Senha deve ter pelo menos 8 caracteres').max(128), // M1: min 6→8 (OWASP)
  name:         z.string().min(2, 'Nome deve ter pelo menos 2 caracteres').max(100).optional(),
  phone:        z.string().max(20).optional(),
  inviteCode:    z.string().max(100).optional(),
  referralCode:  z.string().max(100).optional(),
  affiliateCode: z.string().max(100).optional(),
  cbTos:        z.boolean().optional(),
  cbContrato:   z.boolean().optional(),
  cbLgpd:       z.boolean().optional(),
  cbMarketing:  z.boolean().optional(),
  docVersion:   z.string().max(100).optional(),
  utmSource:    z.string().max(100).optional(),
  utmCampaign:  z.string().max(100).optional(),
  utmMedium:    z.string().max(100).optional(),
});

export const loginSchema = z.object({
  email:    z.string().email('E-mail inválido'),
  password: z.string().min(1, 'Senha é obrigatória').max(128),
});

export const resetPasswordSchema = z.object({
  email: z.string().email('Email inválido').toLowerCase(),
});

export const confirmResetSchema = z.object({
  token: z.string().min(1, 'Token é obrigatório'),
  newPassword: z.string().min(6, 'Senha deve ter pelo menos 6 caracteres'),
});

// ── Numbers Schemas ──────────────────────────────────────
export const createNumberSchema = z.object({
  displayName: z.string().min(1).max(50).optional(),
  // phoneNumber é opcional — usuário pode conectar via QR sem informar o número
  phoneNumber: z.string().regex(/^\d{10,15}$/, 'Número deve ter 10-15 dígitos').optional(),
});

export const updateNumberSchema = z.object({
  displayName: z.string().min(1, 'Nome é obrigatório').max(50).optional(),
  status: z.enum(['connected', 'disconnected', 'pending']).optional(),
});

// ── Transcriptions Schemas ────────────────────────────────
export const createTranscriptionSchema = z.object({
  numberId: z.string().cuid('ID do número inválido'),
  audioBase64: z.string().min(1, 'Áudio é obrigatório'),
  contactPhone: z.string().regex(/^\d{10,15}$/, 'Telefone inválido'),
  contactName: z.string().max(100).optional(),
  language: z.enum(['pt', 'en', 'es']).default('pt'),
});

export const transcriptionQuerySchema = z.object({
  numberId: z.string().cuid().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});

// ── Billing Schemas ──────────────────────────────────────

// Schema de cartão (checkout transparente Asaas — sem tokenização frontend)
const cardSchema = z.object({
  holderName:  z.string().min(2, 'Nome do titular é obrigatório').max(64),
  number:      z.string().min(13, 'Número do cartão inválido').max(19),
  expiryMonth: z.string().length(2, 'Mês inválido (MM)'),
  expiryYear:  z.string().min(2, 'Ano inválido').max(4),
  ccv:         z.string().min(3, 'CVV inválido').max(4),
});

const billingAddressSchema = z.object({
  postalCode:    z.string().min(8).max(9).optional(),
  addressNumber: z.string().max(20).optional(),
}).optional();

export const billingCheckoutSchema = z.object({
  planName:       z.enum(['pro', 'executive'], { errorMap: () => ({ message: 'Plano inválido. Use pro ou executive.' }) }),
  paymentMethod:  z.enum(['credit_card', 'debit_card', 'pix', 'pix_auto', 'google_pay', 'apple_pay']).default('pix'),
  billingCycle:   z.enum(['monthly', 'yearly']).default('monthly'),
  card:           cardSchema.optional(),   // obrigatório se paymentMethod === 'credit_card' | 'debit_card'
  billingAddress: billingAddressSchema,
});

export const billingUpgradeSchema = z.object({
  targetPlan:     z.enum(['pro', 'executive'], { errorMap: () => ({ message: 'Plano inválido.' }) }),
  paymentMethod:  z.enum(['credit_card', 'debit_card', 'pix', 'pix_auto', 'google_pay', 'apple_pay']).default('pix'),
  card:           cardSchema.optional(),
  billingAddress: billingAddressSchema,
});

// Contratação de módulo da suíte (key vem do param da URL, não do body)
export const moduleSubscribeSchema = z.object({
  paymentMethod:  z.enum(['credit_card', 'debit_card', 'pix', 'pix_auto', 'google_pay', 'apple_pay']).default('pix'),
  card:           cardSchema.optional(),
  billingAddress: billingAddressSchema,
});

// Trial com cartão (opcional): nada é cobrado agora — só CPF/cartão para a
// assinatura cujo 1º vencimento é o fim do trial (D+7).
export const billingTrialCardSchema = z.object({
  card:           cardSchema,
  billingAddress: billingAddressSchema,
});

export const createSubscriptionSchema = z.object({
  planId: z.string().cuid('ID do plano inválido'),
});

export const updateSubscriptionSchema = z.object({
  planId: z.string().cuid('ID do plano inválido').optional(),
});

export const cancelSubscriptionSchema = z.object({
  reason: z.string().max(500).optional(),
});

// ── Admin Schemas ────────────────────────────────────────
export const adminUpdateUserSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  isAdmin: z.boolean().optional(),
  planId: z.string().cuid().optional(),
});

export const adminCreatePlanSchema = z.object({
  name: z.string().min(1).max(50),
  label: z.string().min(1).max(100),
  audiosPerMonth: z.number().min(0).optional(),
  minutesPerMonth: z.number().min(0),
  maxNumbers: z.number().min(1),
  priceBrl: z.number().min(0),
  features: z.array(z.string()).default([]),
});

export const adminUpdatePlanSchema = z.object({
  label: z.string().min(1).max(100).optional(),
  audiosPerMonth: z.number().min(0).optional(),
  minutesPerMonth: z.number().min(0).optional(),
  maxNumbers: z.number().min(1).optional(),
  priceBrl: z.number().min(0).optional(),
  features: z.array(z.string()).optional(),
});

export const adminUpdateTicketSchema = z.object({
  status: z.enum(['open', 'replied', 'closed']),
  response: z.string().max(5000).optional(),
});

// ── CRM Schemas ───────────────────────────────────────────
export const createCrmStageSchema = z.object({
  name:  z.string().min(1, 'Nome é obrigatório').max(50),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor deve ser hex (#rrggbb)').optional(),
});

export const updateCrmStageSchema = z.object({
  name:  z.string().min(1).max(50).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor deve ser hex (#rrggbb)').optional(),
});

export const reorderCrmStagesSchema = z.object({
  order: z.array(z.string().cuid()).min(1, 'Informe ao menos um estágio'),
});

export const createCrmContactSchema = z.object({
  name:    z.string().min(1, 'Nome é obrigatório').max(100),
  phone:   z.string().regex(/^\d{10,15}$/, 'Telefone deve ter 10-15 dígitos'),
  email:   z.string().email('E-mail inválido').max(150).optional(),
  company: z.string().max(100).optional(),
  stageId: z.string().cuid('Estágio inválido').optional(), // se ausente, usa o 1º estágio do funil
  value:   z.number().min(0).max(100_000_000).optional(),
  tags:    z.array(z.string().max(30)).max(20).optional(),
});

export const updateCrmContactSchema = z.object({
  name:       z.string().min(1).max(100).optional(),
  phone:      z.string().regex(/^\d{10,15}$/, 'Telefone deve ter 10-15 dígitos').optional(),
  email:      z.string().email('E-mail inválido').max(150).nullable().optional(),
  company:    z.string().max(100).nullable().optional(),
  value:      z.number().min(0).max(100_000_000).nullable().optional(),
  tags:       z.array(z.string().max(30)).max(20).optional(),
  lostReason: z.string().max(300).nullable().optional(),
});

export const moveCrmContactSchema = z.object({
  stageId:    z.string().cuid('Estágio inválido'),
  lostReason: z.string().max(300).optional(), // usado quando o estágio destino é isLost
});

export const createCrmActivitySchema = z.object({
  type:    z.enum(['note', 'call', 'meeting', 'reminder']),
  content: z.string().min(1, 'Descreva a atividade').max(2000),
  dueAt:   z.coerce.date().optional(), // obrigatório em type=reminder (checado na rota)
});

export const crmImportSchema = z.object({
  // lista de telefones (dedupe) escolhidos na tela de sugestões do histórico de transcrições
  phones: z.array(z.string().regex(/^\d{10,15}$/)).min(1, 'Selecione ao menos um contato').max(200),
});

// ── Support Schemas ──────────────────────────────────────
export const createSupportTicketSchema = z.object({
  subject: z.string().min(5, 'Assunto deve ter pelo menos 5 caracteres').max(200),
  message: z.string().min(10, 'Mensagem deve ter pelo menos 10 caracteres').max(5000),
  category: z.enum(['bug', 'feature', 'billing', 'other']).default('other'),
});

export const replySupportTicketSchema = z.object({
  message: z.string().min(10, 'Resposta deve ter pelo menos 10 caracteres').max(5000),
});

// ── Atende Schemas ────────────────────────────────────────
export const atendeConfigSchema = z.object({
  enabled:         z.boolean().optional(),
  businessContext: z.string().max(4000, 'Máximo de 4000 caracteres').optional(),
  tone:            z.enum(['profissional-amigavel', 'formal', 'descontraido'], {
    errorMap: () => ({ message: 'Tom inválido' }),
  }).optional(),
  fallbackMessage: z.string().min(1, 'Mensagem de fallback não pode ser vazia').max(500).optional(),
  escalationPhone: z.string().regex(/^\d{10,15}$/, 'Telefone deve ter 10-15 dígitos').nullable().optional(),
});

export const atendeKbCreateSchema = z.object({
  question: z.string().min(3, 'Pergunta muito curta').max(300),
  answer:   z.string().min(1, 'Resposta é obrigatória').max(2000),
});

export const atendeKbUpdateSchema = z.object({
  question: z.string().min(3, 'Pergunta muito curta').max(300).optional(),
  answer:   z.string().min(1, 'Resposta não pode ser vazia').max(2000).optional(),
  active:   z.boolean().optional(),
});

// ── Types Export ──────────────────────────────────────────
export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateNumberInput = z.infer<typeof createNumberSchema>;
export type CreateTranscriptionInput = z.infer<typeof createTranscriptionSchema>;
export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>;
export type AdminUpdateUserInput = z.infer<typeof adminUpdateUserSchema>;
export type CreateSupportTicketInput = z.infer<typeof createSupportTicketSchema>;

// ── Middleware helper ──────────────────────────────────
export function validateRequest<T>(schema: z.ZodSchema<T>) {
  return (data: unknown): { valid: true; data: T } | { valid: false; error: string } => {
    const result = schema.safeParse(data);
    if (result.success) {
      return { valid: true, data: result.data as T };
    }
    const errors = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
    return { valid: false, error: errors };
  };
}
