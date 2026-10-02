import { FastifyReply } from 'fastify';

/**
 * Gate comercial da API pública v1 (chaves, envio de mensagens e webhooks de
 * saída). Existe como um lugar ÚNICO porque antes os três recursos tinham
 * gates independentes e incompatíveis entre si:
 *
 *   - POST /webhook-config exigia plano 'executive'
 *   - POST /api-keys       exigia plano 'empresas'
 *   - /atende/avisos       exigia o módulo 'atende' ('profissional'|'empresas')
 *
 * E 'executive' (trilha antiga de transcrição) com 'empresas' (trilha
 * ZapScript 2.0) são catálogos PARALELOS, não uma hierarquia — ver
 * packages/database/prisma/seed.ts. Resultado prático: nenhum plano conseguia
 * ter webhook de saída E envio de mensagem ao mesmo tempo, que é exatamente a
 * combinação que qualquer integração servidor-a-servidor precisa. Uma
 * integração que manda pergunta e recebe resposta era impossível de montar.
 *
 * Decisão de produto (2026-10-02): liberar para TODOS os planos no início,
 * para não travar as primeiras integrações enquanto o empacotamento comercial
 * é definido. Para restringir depois, troque `'all'` pela lista de planos —
 * é o único ponto que precisa mudar.
 */
export const INTEGRATION_PLANS: 'all' | string[] = 'all';

export function planAllowsIntegration(planName: string): boolean {
  return INTEGRATION_PLANS === 'all' || INTEGRATION_PLANS.includes(planName);
}

/**
 * Responde 402 e devolve false se o plano não pode usar a API pública.
 * Mesmo formato de erro do planGate, para o front tratar igual.
 */
export function requireIntegrationPlan(planName: string, reply: FastifyReply): boolean {
  if (planAllowsIntegration(planName)) return true;
  reply.code(402).send({
    error:        'Plano insuficiente',
    message:      'A API pública e os webhooks exigem um plano superior. Acesse /dashboard/plano para fazer upgrade.',
    planRequired: Array.isArray(INTEGRATION_PLANS) ? INTEGRATION_PLANS[0] : 'empresas',
    planCurrent:  planName,
  });
  return false;
}
