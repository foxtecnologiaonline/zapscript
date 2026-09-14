// Interface comum entre motores de envio (Fase 1: Evolution/Baileys, Fase 2:
// Meta Cloud API) — o resto da aplicação (webhook receiver, inbox, endpoints
// públicos do widget) chama SÓ isso, nunca `evolution-engine.ts` diretamente.
// Trocar de motor é trocar qual implementação `getMessagingEngine()` devolve.

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

export interface QrResult {
  qrCode: string | null; // data URL (base64 PNG) ou string do QR — null se ainda não gerado
  pairingCode?: string | null;
}

export interface MessagingEngine {
  readonly provider: 'evolution' | 'meta';

  /** Provisiona a instância/canal para uma conexão recém-criada. */
  createConnection(instanceName: string, webhookUrl: string): Promise<void>;

  /** Gera/retorna o QR Code atual para parear o número. */
  getQrCode(instanceName: string): Promise<QrResult>;

  /** Estado atual da conexão, consultado sob demanda (ex.: polling do painel). */
  getStatus(instanceName: string): Promise<ConnectionStatus>;

  /** Desconecta e remove a instância/canal. */
  disconnect(instanceName: string): Promise<void>;

  /** Envia texto simples para um número (só dígitos, com DDI). */
  sendText(instanceName: string, phone: string, text: string): Promise<{ id: string | null }>;
}

import { evolutionEngine } from './evolution-engine';
import { metaEngine } from './meta-engine';

export function getMessagingEngine(provider: 'evolution' | 'meta' = 'evolution'): MessagingEngine {
  return provider === 'meta' ? metaEngine : evolutionEngine;
}
