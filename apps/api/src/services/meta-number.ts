import { prisma } from '../lib/prisma';
import { ApiError } from '../lib/apiErrors';
import { decryptStr } from './encryption';

/**
 * Resolve o número oficial (Meta) do cliente e devolve as credenciais já
 * descriptografadas. Usado por tudo que fala com a Graph API em nome do
 * cliente: templates (item 4), limites de número e envio.
 *
 * Existe para que a mesma pergunta ("qual WABA e qual token eu uso para este
 * usuário?") tenha UMA resposta. Antes, cada rota repetia o findFirst +
 * checagem de token + decrypt, com mensagens de erro diferentes para a mesma
 * situação.
 */

export interface MetaNumberContext {
  numberId: string;
  phoneNumberId: string;
  wabaId: string;
  accessToken: string;
  phoneNumber: string | null;
  displayName: string | null;
}

export async function resolveMetaNumber(
  userId: string,
  numberId?: string | null,
): Promise<MetaNumberContext> {
  const number = numberId
    ? await prisma.whatsappNumber.findFirst({ where: { id: numberId, userId, provider: 'meta' } })
    : await prisma.whatsappNumber.findFirst({
        where:   { userId, provider: 'meta' },
        orderBy: { connectedAt: 'desc' },
      });

  if (!number) {
    throw new ApiError('number.not_found', {
      message: numberId
        ? `Número oficial "${numberId}" não existe nesta conta.`
        : 'Nenhum número oficial (Meta) conectado. Conecte um em /dashboard/numeros.',
    });
  }
  if (!number.metaAccessTokenEnc || !number.metaWabaId || !number.metaPhoneNumberId) {
    throw new ApiError('number.missing_credentials', {
      message: 'O número oficial está sem credenciais da Meta — reconecte-o em /dashboard/numeros.',
    });
  }

  return {
    numberId:      number.id,
    phoneNumberId: number.metaPhoneNumberId,
    wabaId:        number.metaWabaId,
    accessToken:   decryptStr(number.metaAccessTokenEnc),
    phoneNumber:   number.phoneNumber === 'pending' ? null : number.phoneNumber,
    displayName:   number.displayName,
  };
}
