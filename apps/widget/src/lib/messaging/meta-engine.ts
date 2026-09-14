// Implementação Fase 2 do MessagingEngine — Meta Cloud API (WhatsApp Business
// Platform oficial). Stub proposital: a migração da Fase 1 (Evolution) para
// cá deve ser SÓ preencher estes métodos com chamadas à Graph API (o mesmo
// desenho que apps/api/src/services/whatsapp-official.ts já usa no
// ZapScript.me) — nenhum outro arquivo deste produto precisa mudar, porque
// tudo chama a interface `MessagingEngine`, nunca este arquivo diretamente.
//
// Critério de corte para ligar isso em produção (ver escopo §2): volume
// mensal de mensagens acima do limite seguro do motor não-oficial, ou
// exigência de compliance do cliente.

import type { MessagingEngine, QrResult, ConnectionStatus } from './engine';

function notImplemented(): never {
  throw new Error(
    'Meta Cloud API ainda não implementada (Fase 2). Provider "meta" existe no schema ' +
    'e nesta interface para não exigir retrabalho na migração — ver comentário no topo deste arquivo.',
  );
}

export const metaEngine: MessagingEngine = {
  provider: 'meta',
  async createConnection(): Promise<void> {
    notImplemented();
  },
  async getQrCode(): Promise<QrResult> {
    notImplemented();
  },
  async getStatus(): Promise<ConnectionStatus> {
    return 'disconnected';
  },
  async disconnect(): Promise<void> {
    notImplemented();
  },
  async sendText(): Promise<{ id: string | null }> {
    notImplemented();
  },
};
