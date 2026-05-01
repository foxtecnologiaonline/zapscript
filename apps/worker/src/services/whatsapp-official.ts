import axios from 'axios';

const META_API_URL = 'https://graph.facebook.com/v18.0';

/**
 * Baixar áudio da Meta API e retornar como Buffer
 */
export async function downloadAudioFromMeta(mediaId: string): Promise<Buffer> {
  const apiToken = process.env.WHATSAPP_API_TOKEN;

  if (!apiToken) {
    throw new Error('WHATSAPP_API_TOKEN não configurado');
  }

  try {
    // Primeiro, obter URL de download do media ID
    console.log(`[Meta] Obtendo URL para mídia ${mediaId}`);
    const infoResponse = await axios.get(`${META_API_URL}/${mediaId}`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });

    const downloadUrl = infoResponse.data.url;
    console.log(`[Meta] ✓ URL obtida`);

    // Depois, fazer download do arquivo
    console.log(`[Meta] Fazendo download...`);
    const mediaResponse = await axios.get(downloadUrl, {
      responseType: 'arraybuffer',
      headers: { Authorization: `Bearer ${apiToken}` },
    });

    console.log(`[Meta] ✓ Áudio baixado (${mediaResponse.data.length} bytes)`);
    return Buffer.from(mediaResponse.data);
  } catch (error) {
    console.error('[Meta] Erro ao baixar áudio:', error);
    throw error;
  }
}

/**
 * Enviar mensagem de texto via Meta API
 */
export async function sendMessageToMeta(phoneNumber: string, text: string): Promise<string> {
  const apiToken = process.env.WHATSAPP_API_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!apiToken || !phoneNumberId) {
    throw new Error('WHATSAPP_API_TOKEN ou WHATSAPP_PHONE_NUMBER_ID não configurado');
  }

  try {
    const response = await axios.post(
      `${META_API_URL}/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phoneNumber.replace(/\D/g, ''),
        type: 'text',
        text: { body: text },
      },
      {
        headers: { Authorization: `Bearer ${apiToken}` },
      }
    );

    const messageId = response.data.messages?.[0]?.id;
    console.log(`[Meta] ✓ Mensagem enviada: ${messageId}`);
    return messageId;
  } catch (error: any) {
    const errorMsg = error.response?.data?.error?.message || error.message;
    console.error('[Meta] Erro ao enviar mensagem:', errorMsg);
    throw error;
  }
}
