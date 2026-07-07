import { sendText, instanceName } from './evolution';
import { prisma } from '../lib/prisma';

/**
 * Envio de respostas do Atende pelo WhatsApp do PRÓPRIO assinante.
 *
 * Diferente do support-send (que usa a instância interna zs-suporte e avisa o
 * admin do ZapScript), aqui a mensagem sai pela instância Evolution do número
 * conectado do assinante — o cliente dele recebe como se o negócio respondesse.
 */

/** Resolve a instância Evolution de um WhatsappNumber. */
export async function resolveInstance(numberId: string): Promise<string> {
  const num = await prisma.whatsappNumber.findUnique({
    where:  { id: numberId },
    select: { zapiInstanceId: true },
  });
  return num?.zapiInstanceId || instanceName(numberId);
}

/** Envia um texto para o cliente (remoteJid) pela instância do assinante. */
export async function sendAtendeReply(numberId: string, remoteJid: string, texto: string): Promise<void> {
  const instance = await resolveInstance(numberId);
  const phone = remoteJid.replace('@s.whatsapp.net', '').replace('@c.us', '').replace(/\D/g, '');
  if (!phone) throw new Error('remoteJid sem telefone válido');
  await sendText(instance, phone, texto);
}
