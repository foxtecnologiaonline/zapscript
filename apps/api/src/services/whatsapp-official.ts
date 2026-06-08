import axios, { AxiosError } from 'axios';
import { logger } from '../lib/logger';

const META_API_URL = 'https://graph.facebook.com/v18.0';

export interface WhatsAppMessage {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'text' | 'audio' | 'image' | 'document';
  text?: { body: string };
  audio?: { link: string };
  image?: { link: string };
  document?: { link: string; filename: string };
}

export interface WhatsAppIncomingMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'text' | 'audio' | 'image' | 'document' | 'button' | 'interactive';
  text?: { body: string };
  audio?: { mime_type: string; sha256: string; id: string; link?: string };
  image?: { mime_type: string; sha256: string; id: string; link?: string };
  document?: { mime_type: string; sha256: string; id: string; filename: string; link?: string };
}

class WhatsAppOfficialAPI {
  private apiToken: string;
  private phoneNumberId: string;

  constructor() {
    this.apiToken = process.env.WHATSAPP_API_TOKEN || '';
    this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';

    if (!this.apiToken || !this.phoneNumberId) {
      logger.debug('[WhatsApp] WHATSAPP_API_TOKEN não configurado — usando Evolution API');
    }
  }

  /**
   * Enviar mensagem de texto
   */
  async sendMessage(toNumber: string, text: string) {
    const payload: WhatsAppMessage = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toNumber.replace(/\D/g, ''), // Remove caracteres não numéricos
      type: 'text',
      text: { body: text },
    };

    return this._sendRequest(payload, 'sendMessage');
  }

  /**
   * Enviar áudio via URL
   */
  async sendAudio(toNumber: string, audioUrl: string) {
    const payload: WhatsAppMessage = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toNumber.replace(/\D/g, ''),
      type: 'audio',
      audio: { link: audioUrl },
    };

    return this._sendRequest(payload, 'sendAudio');
  }

  /**
   * Enviar imagem
   */
  async sendImage(toNumber: string, imageUrl: string) {
    const payload: WhatsAppMessage = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: toNumber.replace(/\D/g, ''),
      type: 'image',
      image: { link: imageUrl },
    };

    return this._sendRequest(payload, 'sendImage');
  }

  /**
   * Marcar mensagem como lida
   */
  async markAsRead(messageId: string) {
    try {
      const response = await axios.post(
        `${META_API_URL}/${this.phoneNumberId}/messages`,
        {
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId,
        },
        {
          headers: { Authorization: `Bearer ${this.apiToken}` },
        }
      );

      logger.info(`[WhatsApp] ✓ Mensagem ${messageId} marcada como lida`);
      return response.data;
    } catch (error) {
      logger.error(`[WhatsApp] Erro ao marcar como lida: ${this._formatError(error)}`);
      throw error;
    }
  }

  /**
   * Obter mídia (áudio/imagem/documento)
   */
  async getMedia(mediaId: string): Promise<Buffer> {
    try {
      const response = await axios.get(`${META_API_URL}/${mediaId}`, {
        headers: { Authorization: `Bearer ${this.apiToken}` },
      });

      const downloadUrl = response.data.url;

      // Download o arquivo da URL fornecida por WhatsApp
      const mediaResponse = await axios.get(downloadUrl, {
        responseType: 'arraybuffer',
        headers: { Authorization: `Bearer ${this.apiToken}` },
      });

      return Buffer.from(mediaResponse.data);
    } catch (error) {
      logger.error(`[WhatsApp] Erro ao baixar mídia: ${this._formatError(error)}`);
      throw error;
    }
  }

  /**
   * Enviar requisição para Meta API
   */
  private async _sendRequest(payload: WhatsAppMessage, action: string) {
    try {
      const response = await axios.post(
        `${META_API_URL}/${this.phoneNumberId}/messages`,
        payload,
        {
          headers: { Authorization: `Bearer ${this.apiToken}` },
        }
      );

      logger.info(`[WhatsApp] ✓ ${action}: ${response.data.messages?.[0]?.id}`);
      return response.data;
    } catch (error) {
      const errorMsg = this._formatError(error);
      logger.error(`[WhatsApp] ✗ ${action} falhou: ${errorMsg}`);
      throw new Error(`WhatsApp ${action} failed: ${errorMsg}`);
    }
  }

  /**
   * Formatar mensagem de erro
   */
  private _formatError(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<any>;
      return (
        axiosError.response?.data?.error?.message ||
        axiosError.response?.data?.message ||
        axiosError.message ||
        'Unknown error'
      );
    }
    return String(error);
  }
}

export const whatsappAPI = new WhatsAppOfficialAPI();
