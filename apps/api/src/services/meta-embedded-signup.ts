/**
 * Helpers do Embedded Signup da Meta (modelo Tech Provider).
 *
 * Fluxo de onboarding multi-tenant:
 *   1. Frontend abre o Embedded Signup (FB SDK) → retorna um `code` (OAuth) e o `waba_id`/`phone_number_id`.
 *   2. exchangeCodeForToken(code) → token de acesso do cliente (curto). No modelo System User,
 *      operamos a WABA com META_SYSTEM_USER_TOKEN; o token do cliente serve para descobrir os números.
 *   3. subscribeWabaToApp(wabaId) → assina nosso app à WABA p/ receber webhooks dela.
 *   4. registerPhoneNumber(phoneNumberId, pin) → registra o número na Cloud API (opcional, se ainda não registrado).
 *   5. getWabaPhoneNumbers(wabaId) → lista os números (phone_number_id + display) para persistir.
 *
 * Tokens: usamos META_SYSTEM_USER_TOKEN (com fallback ao WHATSAPP_API_TOKEN legado) para chamadas
 * administrativas sobre as WABAs dos clientes. META_APP_ID/META_APP_SECRET (com fallback
 * WHATSAPP_APP_* legado) para a troca do code.
 */
import axios, { AxiosError } from 'axios';
import { logger } from '../lib/logger';

const META_API_URL = 'https://graph.facebook.com/v18.0';

function systemUserToken(): string {
  const token = process.env.META_SYSTEM_USER_TOKEN || process.env.WHATSAPP_API_TOKEN;
  if (!token) throw new Error('META_SYSTEM_USER_TOKEN não configurado');
  return token;
}

function appCredentials(): { appId: string; appSecret: string } {
  const appId = process.env.META_APP_ID || process.env.WHATSAPP_APP_ID || '';
  const appSecret = process.env.META_APP_SECRET || process.env.WHATSAPP_APP_SECRET || '';
  if (!appId || !appSecret) throw new Error('META_APP_ID / META_APP_SECRET não configurados');
  return { appId, appSecret };
}

function formatErr(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const e = error as AxiosError<any>;
    return e.response?.data?.error?.message || e.response?.data?.message || e.message || 'Unknown error';
  }
  return String(error);
}

/**
 * Troca o `code` do Embedded Signup por um token de acesso do cliente.
 */
export async function exchangeCodeForToken(code: string): Promise<string> {
  const { appId, appSecret } = appCredentials();
  try {
    const { data } = await axios.get(`${META_API_URL}/oauth/access_token`, {
      params: { client_id: appId, client_secret: appSecret, code },
    });
    const token = data.access_token as string;
    logger.info('[Meta Signup] Code trocado por access_token com sucesso');
    return token;
  } catch (error) {
    const msg = formatErr(error);
    logger.error(`[Meta Signup] Falha ao trocar code: ${msg}`);
    throw new Error(`exchangeCodeForToken failed: ${msg}`);
  }
}

/**
 * Assina nosso app à WABA do cliente para receber os webhooks dela.
 */
export async function subscribeWabaToApp(wabaId: string): Promise<void> {
  try {
    await axios.post(
      `${META_API_URL}/${wabaId}/subscribed_apps`,
      {},
      { headers: { Authorization: `Bearer ${systemUserToken()}` } }
    );
    logger.info(`[Meta Signup] App assinado à WABA ${wabaId}`);
  } catch (error) {
    const msg = formatErr(error);
    logger.error(`[Meta Signup] Falha ao assinar WABA ${wabaId}: ${msg}`);
    throw new Error(`subscribeWabaToApp failed: ${msg}`);
  }
}

/**
 * Registra o número na Cloud API (necessário antes de enviar/receber).
 * @param pin PIN de verificação em duas etapas (6 dígitos). Se a 2FA estiver desativada,
 *            a Meta ainda exige um PIN no register; usamos META_DEFAULT_REGISTER_PIN como padrão.
 */
export async function registerPhoneNumber(phoneNumberId: string, pin?: string): Promise<void> {
  const registerPin = pin || process.env.META_DEFAULT_REGISTER_PIN || '000000';
  try {
    await axios.post(
      `${META_API_URL}/${phoneNumberId}/register`,
      { messaging_product: 'whatsapp', pin: registerPin },
      { headers: { Authorization: `Bearer ${systemUserToken()}` } }
    );
    logger.info(`[Meta Signup] Número ${phoneNumberId} registrado na Cloud API`);
  } catch (error) {
    const msg = formatErr(error);
    // Já registrado não é fatal — apenas registramos o aviso
    logger.warn(`[Meta Signup] register de ${phoneNumberId}: ${msg}`);
  }
}

export interface WabaPhoneNumber {
  id: string;            // phone_number_id
  display_phone_number: string;
  verified_name?: string;
}

/**
 * Lista os números de uma WABA (para persistir phone_number_id + display).
 */
export async function getWabaPhoneNumbers(wabaId: string): Promise<WabaPhoneNumber[]> {
  try {
    const { data } = await axios.get(`${META_API_URL}/${wabaId}/phone_numbers`, {
      headers: { Authorization: `Bearer ${systemUserToken()}` },
    });
    return (data.data || []) as WabaPhoneNumber[];
  } catch (error) {
    const msg = formatErr(error);
    logger.error(`[Meta Signup] Falha ao listar números da WABA ${wabaId}: ${msg}`);
    throw new Error(`getWabaPhoneNumbers failed: ${msg}`);
  }
}
