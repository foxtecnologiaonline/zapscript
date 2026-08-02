/**
 * number-provisioning.ts
 *
 * Criação/reaproveitamento de instância Evolution API + solicitação de pairing
 * code para um WhatsappNumber. Extraído das rotas POST /numbers/:id/connect e
 * POST /numbers/:id/pairing-code (apps/api/src/routes/numbers.ts) para poder
 * ser chamado tanto pelo painel (fluxo autenticado) quanto pelo cadastro no
 * site e pelo onboarding conversacional via WhatsApp (nenhum dos dois passa
 * por uma requisição HTTP autenticada do próprio usuário).
 */
import { prisma } from '../lib/prisma';
import {
  evolutionBaseUrl,
  evolutionHeaders,
  instanceName as evoInstanceName,
  createInstance,
  deleteInstance,
  getConnectionState,
  setWebhook,
} from './evolution';

function getApiBase(): string {
  const url = process.env.API_URL || process.env.RENDER_EXTERNAL_URL || process.env.APP_URL;
  if (url) return url.replace(/\/$/, '');
  console.error('[number-provisioning] ⛔ API_URL não configurado! Configure API_URL no .env da Vultr.');
  return '';
}

export function buildWebhookUrl(): string {
  const base   = getApiBase();
  const url    = `${base}/webhook/evolution`;
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET;
  return secret ? `${url}?secret=${encodeURIComponent(secret)}` : url;
}

export interface ProvisionResult {
  ok: boolean;
  message: string;
}

/**
 * Cria (ou reaproveita) a instância Evolution dedicada de um número —
 * mesma lógica de POST /numbers/:id/connect.
 */
export async function provisionInstance(numberId: string, log?: any): Promise<ProvisionResult> {
  if (!process.env.EVOLUTION_API_URL || !process.env.EVOLUTION_API_KEY) {
    return { ok: false, message: 'Evolution API não configurada. Adicione EVOLUTION_API_URL e EVOLUTION_API_KEY no servidor.' };
  }

  const webhookUrl = buildWebhookUrl();
  const instName   = evoInstanceName(numberId);

  try {
    const existingState = await getConnectionState(instName);

    if (existingState === 'open') {
      log?.info?.(`[Evolution] Instância ${instName} já está conectada (open)`);
      await setWebhook(instName, webhookUrl);
      await prisma.whatsappNumber.update({
        where: { id: numberId },
        data: { zapiInstanceId: instName, zapiToken: null, status: 'connected', connectedAt: new Date() },
      });
      return { ok: true, message: 'WhatsApp já conectado.' };

    } else if (existingState === 'connecting') {
      log?.info?.(`[Evolution] Instância ${instName} em "connecting" — reutilizando, re-aplicando webhook`);
      await setWebhook(instName, webhookUrl);

    } else if (existingState === 'close') {
      log?.info?.(`[Evolution] Instância ${instName} em "close" — recriando`);
      await deleteInstance(instName);
      await new Promise(r => setTimeout(r, 1000));
      await createInstance(numberId, webhookUrl);
      log?.info?.(`[Evolution] ✅ Instância recriada: ${instName}`);

    } else {
      log?.info?.(`[Evolution] Criando nova instância: ${instName}`);
      await createInstance(numberId, webhookUrl);
      log?.info?.(`[Evolution] ✅ Instância criada: ${instName}`);
    }

    await prisma.whatsappNumber.update({
      where: { id: numberId },
      data: {
        zapiInstanceId: instName,
        zapiToken:      null,
        status:         'connecting',
      },
    });

    return { ok: true, message: 'Pronto para escanear o QR Code.' };

  } catch (err: any) {
    log?.error?.({ err: err.message }, '[Evolution] Erro ao criar/conectar instância');
    return { ok: false, message: `Erro ao configurar instância: ${err.message}` };
  }
}

export interface PairingCodeResult {
  ok: boolean;
  code?: string;
  error?: string;
  fallbackToQr?: boolean;
}

/**
 * Solicita o pairing code (código de 8 chars digitado no WhatsApp) para um
 * número já provisionado — mesma lógica de POST /numbers/:id/pairing-code.
 * Exige que provisionInstance já tenha rodado (zapiInstanceId preenchido).
 */
export async function requestPairingCode(numberId: string, phone: string, log?: any): Promise<PairingCodeResult> {
  const number = await prisma.whatsappNumber.findUnique({ where: { id: numberId } });
  if (!number) return { ok: false, error: 'Número não encontrado' };

  const instName = number.zapiInstanceId ?? evoInstanceName(numberId);
  if (!number.zapiInstanceId) {
    return { ok: false, error: 'Instância não iniciada. Chame provisionInstance primeiro.' };
  }

  const cleanPhone = phone.replace(/\D/g, '');
  const fullPhone  = cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`;

  try {
    const base = evolutionBaseUrl();

    const res = await fetch(
      `${base}/instance/connect/${instName}?number=${fullPhone}`,
      { headers: evolutionHeaders(), signal: AbortSignal.timeout(15_000) }
    );

    const rawText = await res.text();
    log?.info?.(`[Evolution] pairing-code status=${res.status}: ${rawText.substring(0, 300)}`);

    let data: any = {};
    try { data = JSON.parse(rawText); } catch { /* não é JSON */ }

    if (res.ok) {
      const code = data?.pairingCode ?? data?.code;
      if (code && data?.pairingCode) {
        log?.info?.(`[Evolution] Pairing code gerado: ${code}`);
        return { ok: true, code };
      }
      log?.warn?.(`[Evolution] Resposta sem pairingCode. Data: ${rawText.substring(0, 200)}`);
      return { ok: false, error: 'Código por número indisponível para este número.', fallbackToQr: true };
    }

    log?.warn?.(`[Evolution] pairing-code erro ${res.status}: ${rawText.substring(0, 200)}`);
    return { ok: false, error: 'Erro ao gerar código. Tente o QR Code.', fallbackToQr: true };

  } catch (err: any) {
    log?.error?.({ err: err.message }, '[Evolution] Erro ao solicitar pairing code');
    return { ok: false, error: `Erro ao solicitar código: ${err.message}`, fallbackToQr: true };
  }
}
