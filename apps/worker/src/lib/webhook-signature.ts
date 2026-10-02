import crypto from 'crypto';

/**
 * Contrato de assinatura dos webhooks de saída do ZapScript — fonte única da
 * verdade do formato. Existe uma cópia idêntica em
 * `apps/api/src/lib/webhook-signature.ts`: API e Worker são apps separados,
 * sem pacote de código compartilhado (mesma situação de services/encryption.ts).
 * **Se mudar aqui, mude lá** — divergência entre as duas quebra a validação do
 * integrador de um lado só, que é exatamente o tipo de bug que já aconteceu
 * (ver nota sobre o secret criptografado abaixo).
 *
 * Formato (mantido estável para não quebrar quem já valida):
 *   X-ZapScript-Signature: sha256=<hmac_sha256(secret, corpo_cru)>
 *   X-ZapScript-Event:     <nome do evento>
 *   X-ZapScript-Delivery:  <id único desta entrega — use para deduplicar>
 *   X-ZapScript-Timestamp: <ISO-8601 do disparo>
 *
 * O HMAC cobre o corpo cru, e o corpo cru contém `timestamp`. Ou seja: o
 * timestamp é à prova de adulteração sem precisar de um segundo esquema de
 * assinatura — o receptor rejeita payload velho lendo `payload.timestamp`
 * (recomendamos tolerância de 5 min). O header X-ZapScript-Timestamp é só
 * conveniência; a cópia autoritativa é a de dentro do corpo assinado.
 *
 * ATENÇÃO ao secret: `WebhookConfig.secret` está CRIPTOGRAFADO em repouso
 * (encryptStr). Sempre passe o secret já em claro (decryptStr) para estas
 * funções. Assinar com o blob criptografado gera uma assinatura que nunca
 * valida no receptor — era o bug de apps/worker/src/index.ts antes da API
 * pública v1, e tinha o pior sintoma possível: o endpoint /webhook-config/test
 * assinava certo, então o teste passava e só o evento real falhava.
 */

/** HMAC-SHA256 do corpo cru, no formato `sha256=<hex>`. */
export function signWebhookBody(secretPlain: string, rawBody: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secretPlain).update(rawBody).digest('hex');
}

/**
 * Compara assinaturas em tempo constante (timingSafeEqual). Exportado para os
 * testes e para quem precisar validar um webhook nosso dentro do próprio
 * monorepo — o integrador externo faz o equivalente na linguagem dele.
 */
export function verifyWebhookSignature(
  secretPlain: string,
  rawBody: string,
  received: string | undefined | null,
): boolean {
  if (!received) return false;
  const expected = signWebhookBody(secretPlain, rawBody);
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  // timingSafeEqual exige mesmo tamanho — tamanhos diferentes já são inválidos.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Headers completos de uma entrega. `deliveryId` identifica ESTA tentativa. */
export function buildWebhookHeaders(args: {
  secretPlain: string;
  rawBody: string;
  event: string;
  deliveryId: string;
  timestamp: string;
}): Record<string, string> {
  return {
    'Content-Type':          'application/json',
    'User-Agent':            'ZapScript-Webhooks/1',
    'X-ZapScript-Signature': signWebhookBody(args.secretPlain, args.rawBody),
    'X-ZapScript-Event':     args.event,
    'X-ZapScript-Delivery':  args.deliveryId,
    'X-ZapScript-Timestamp': args.timestamp,
  };
}
