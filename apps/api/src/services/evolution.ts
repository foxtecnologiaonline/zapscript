/**
 * evolution.ts — Helpers centralizados para Evolution API
 *
 * Evolution API é self-hosted, open-source e suporta N instâncias dedicas,
 * uma por usuário — resolve o problema de isolamento multi-tenant do Z-API.
 *
 * Docs: https://doc.evolution-api.com
 * Repo: https://github.com/EvolutionAPI/evolution-api
 *
 * Env vars necessárias:
 *   EVOLUTION_API_URL  — URL da instância Evolution (ex: https://evolution.zapscript.me)
 *   EVOLUTION_API_KEY  — Chave global da API (configurada no Evolution)
 */

// ── Config ─────────────────────────────────────────────────────────────────────

export function evolutionBaseUrl(): string {
  const url = process.env.EVOLUTION_API_URL;
  if (!url) throw new Error('EVOLUTION_API_URL não configurado');
  return url.replace(/\/$/, '');
}

export function evolutionHeaders(): Record<string, string> {
  const key = process.env.EVOLUTION_API_KEY;
  if (!key) throw new Error('EVOLUTION_API_KEY não configurado');
  return { 'apikey': key, 'Content-Type': 'application/json' };
}

/** Nome da instância Evolution para um numberId.
 *  Formato: zs-{numberId} — URL-safe, único, identificável no painel Evolution. */
export function instanceName(numberId: string): string {
  return `zs-${numberId}`;
}

// ── Instance management ────────────────────────────────────────────────────────

export interface CreateInstanceResult {
  instanceName: string;
}

/**
 * Cria uma instância dedicada para o número no Evolution API.
 * Configura webhooks automaticamente na criação.
 */
export async function createInstance(
  numberId: string,
  webhookUrl: string,
): Promise<CreateInstanceResult> {
  const base = evolutionBaseUrl();
  const name = instanceName(numberId);

  const res = await fetch(`${base}/instance/create`, {
    method:  'POST',
    headers: evolutionHeaders(),
    body: JSON.stringify({
      instanceName:        name,
      qrcode:              false,          // QR gerado on-demand via /instance/connect
      integration:         'WHATSAPP-BAILEYS',
      rejectCall:          false,
      groupsIgnore:        true,           // ignorar grupos — só mensagens diretas
      alwaysOnline:        false,
      readMessages:        false,          // não marcar como lido automaticamente
      readStatus:          false,
      syncFullHistory:     false,
      webhook: {
        url:      webhookUrl,
        byEvents: false,   // true appende /event-name à URL quebrando o secret no query param
        base64:   false,                   // não enviar mídia em base64 no webhook (buscar on-demand)
        events: [
          'MESSAGES_UPSERT',
          'CONNECTION_UPDATE',
          'QRCODE_UPDATED',
        ],
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Evolution API falhou ao criar instância (${res.status}): ${text}`);
  }

  const data = await res.json() as any;
  // Evolution retorna { instance: { instanceName: '...' } } ou { instanceName: '...' }
  const createdName = data?.instance?.instanceName ?? data?.instanceName ?? name;
  return { instanceName: createdName };
}

/**
 * Remove a instância do Evolution API (desconecta WhatsApp + deleta).
 * Ignora erros — pode já ter sido deletada.
 */
export async function deleteInstance(name: string): Promise<void> {
  try {
    const base = evolutionBaseUrl();
    // Logout primeiro (disconecta WhatsApp)
    await fetch(`${base}/instance/logout/${name}`, {
      method:  'DELETE',
      headers: evolutionHeaders(),
      signal:  AbortSignal.timeout(8_000),
    }).catch(() => {});
    // Depois deleta a instância
    await fetch(`${base}/instance/delete/${name}`, {
      method:  'DELETE',
      headers: evolutionHeaders(),
      signal:  AbortSignal.timeout(8_000),
    });
  } catch { /* ignora */ }
}

/**
 * Verifica o estado de conexão de uma instância.
 * Retorna: 'open' | 'close' | 'connecting' | null (inconclusivo)
 */
export async function getConnectionState(name: string): Promise<'open' | 'close' | 'connecting' | null> {
  try {
    const base = evolutionBaseUrl();
    const res = await fetch(`${base}/instance/connectionState/${name}`, {
      headers: evolutionHeaders(),
      signal:  AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    const state = data?.instance?.state ?? data?.state;
    if (state === 'open')       return 'open';
    if (state === 'close')      return 'close';
    if (state === 'connecting') return 'connecting';
    return null;
  } catch {
    return null;  // timeout / rede — inconclusivo
  }
}

/**
 * Re-aplica webhooks em uma instância existente.
 * Útil após restart do servidor para garantir que Evolution sabe para onde enviar eventos.
 */
export async function setWebhook(name: string, webhookUrl: string): Promise<boolean> {
  try {
    const base = evolutionBaseUrl();
    const res = await fetch(`${base}/webhook/set/${name}`, {
      method:  'POST',
      headers: evolutionHeaders(),
      body: JSON.stringify({
        webhook: {
          enabled:  true,
          url:      webhookUrl,
          byEvents: false,
          base64:   false,
          events: [
            'MESSAGES_UPSERT',
            'CONNECTION_UPDATE',
            'QRCODE_UPDATED',
          ],
        },
      }),
      signal: AbortSignal.timeout(8_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Liga/desliga a leitura de mensagens de grupo numa instância já conectada,
 * sem recriar nada — usado pelo módulo Copiloto (Função 2): toda instância
 * nasce com groupsIgnore=true (ver createInstance acima); isso é ligado
 * (groupsIgnore=false) só quando o usuário tem ao menos 1 grupo com opt-in
 * ativo, e desligado de volta quando ele desativa o último grupo.
 */
export async function setGroupsIgnore(instanceNameStr: string, ignore: boolean): Promise<void> {
  const base = evolutionBaseUrl();
  const res = await fetch(`${base}/settings/set/${instanceNameStr}`, {
    method:  'POST',
    headers: evolutionHeaders(),
    body: JSON.stringify({ groupsIgnore: ignore }),
    signal:  AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Evolution settings/set falhou (${res.status}): ${text}`);
  }
}

export interface EvolutionGroup {
  jid:  string; // '<id>@g.us'
  name: string;
}

/**
 * Lista os grupos da instância — usado pelo Copiloto para o usuário escolher
 * quais acompanhar (opt-in explícito, nunca todos por padrão).
 */
export async function fetchGroups(instanceNameStr: string): Promise<EvolutionGroup[]> {
  const base = evolutionBaseUrl();
  const res = await fetch(`${base}/group/fetchAllGroups/${instanceNameStr}?getParticipants=false`, {
    method:  'GET',
    headers: evolutionHeaders(),
    signal:  AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Evolution fetchAllGroups falhou (${res.status}): ${text}`);
  }
  const data = await res.json().catch(() => []) as any[];
  if (!Array.isArray(data)) return [];
  return data
    .map((g) => ({ jid: g?.id ?? '', name: g?.subject ?? g?.id ?? '(sem nome)' }))
    .filter((g) => g.jid.endsWith('@g.us'));
}

/**
 * Envia mensagem de texto via Evolution API.
 * Retorna o id da mensagem enviada (quando a Evolution devolve) — usado pelo
 * Copiloto para correlacionar um reply/citação do usuário (stanzaId) de volta
 * ao card específico que o gerou. Chamadores que não precisam disso seguem
 * só dando `await sendText(...)` normalmente, sem usar o retorno.
 */
export async function sendText(instanceNameStr: string, phone: string, message: string): Promise<{ id: string | null }> {
  const base  = evolutionBaseUrl();
  const clean = phone.replace(/\D/g, '');
  const res = await fetch(`${base}/message/sendText/${instanceNameStr}`, {
    method:  'POST',
    headers: evolutionHeaders(),
    body: JSON.stringify({ number: clean, text: message }),
    signal:  AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Evolution sendText falhou (${res.status}): ${text}`);
  }
  const data = await res.json().catch(() => null) as any;
  return { id: data?.key?.id ?? null };
}

/**
 * Envia mensagem de áudio (PTT/nota de voz) via Evolution API.
 * O áudio é enviado como base64 inline — sem depender de URL pública.
 */
export async function sendPtt(instanceNameStr: string, phone: string, audioBase64: string): Promise<void> {
  const base  = evolutionBaseUrl();
  const clean = phone.replace(/\D/g, '');
  const res = await fetch(`${base}/message/sendPtt/${instanceNameStr}`, {
    method:  'POST',
    headers: evolutionHeaders(),
    body: JSON.stringify({
      number: clean,
      ptt: {
        base64: audioBase64,
        caption: '',
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Evolution sendPtt falhou (${res.status}): ${text}`);
  }
}

/**
 * Busca áudio de uma mensagem como Buffer (via getBase64FromMediaMessage).
 * messageData = objeto { key, message } extraído do webhook MESSAGES_UPSERT.
 */
export async function getAudioBuffer(instanceNameStr: string, messageData: any): Promise<Buffer> {
  const base = evolutionBaseUrl();
  const res = await fetch(`${base}/chat/getBase64FromMediaMessage/${instanceNameStr}`, {
    method:  'POST',
    headers: evolutionHeaders(),
    body: JSON.stringify({
      message: {
        key:     messageData.key,
        message: messageData.message,
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Evolution getBase64 falhou (${res.status}): ${text}`);
  }
  const data = await res.json() as any;
  const b64  = data?.base64 ?? data?.data;
  if (!b64) throw new Error('Evolution não retornou base64 do áudio');
  return Buffer.from(b64, 'base64');
}
