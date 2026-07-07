import { prisma } from './prisma';

/**
 * Billing multi-produto (Opção A) — cada produto do usuário tem sua própria
 * linha em `Subscription`, identificada por `productKey`. 'transcription' é o
 * produto histórico (default); 'atende' é o Agente de Atendimento multi-tenant.
 *
 * Toda a base de billing/analytics existente lida com o produto 'transcription'.
 * Use `TRANSCRIPTION_SUB` como seletor único ao buscar/atualizar a assinatura de
 * transcrição, para manter as chamadas `findUnique/update` válidas agora que
 * `userId` sozinho não é mais único.
 */
export const PRODUCT = {
  TRANSCRIPTION: 'transcription',
  ATENDE: 'atende',
} as const;

export type ProductKey = (typeof PRODUCT)[keyof typeof PRODUCT];

/** Seletor único (userId, productKey) para findUnique/update/upsert de Subscription. */
export function subWhere(userId: string, productKey: ProductKey = PRODUCT.TRANSCRIPTION) {
  return { userId_productKey: { userId, productKey } };
}

/** Escolhe a assinatura de transcrição de uma lista `user.subscriptions`. */
export function primarySub<T extends { productKey: string }>(subs: T[] | null | undefined): T | null {
  if (!subs?.length) return null;
  return subs.find(s => s.productKey === PRODUCT.TRANSCRIPTION) ?? subs[0];
}

/**
 * O usuário tem o produto Atende habilitado?
 * Fase 1: gate manual por AtendeConfig.ativo (sem compra self-service). Quando o
 * billing self-service do Atende entrar, esta função passa a considerar também a
 * Subscription do produto 'atende'.
 */
export async function hasAtendeEnabled(userId: string): Promise<boolean> {
  const cfg = await prisma.atendeConfig
    .findUnique({ where: { userId }, select: { ativo: true } })
    .catch(() => null);
  return !!cfg?.ativo;
}
