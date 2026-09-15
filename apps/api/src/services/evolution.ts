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
      // Grupos ligados desde a criação — decisão de produto (WhatsApp Web
      // simplificado mostra e envia em grupos, não só conversas individuais).
      // Instâncias antigas (criadas quando isto era `true`) são corrigidas à
      // parte: syncAllEvolutionConfigs (boot) e connection.update (runtime)
      // chamam setGroupsIgnore(instance, false) pra toda instância conectada.
      groupsIgnore:        false,
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
 * Força a instância a reabrir o socket usando as credenciais de sessão já
 * salvas (auth state do Baileys) — NÃO gera QR novo e não é um "novo login".
 * Cobre o caso comum de socket caído por instabilidade momentânea (rede,
 * restart do container Evolution, etc.) sem depender de ação do usuário.
 *
 * Se o WhatsApp tiver de fato invalidado a sessão (logout pelo celular,
 * banimento, "conflito" com outro dispositivo), isso NÃO resolve — é uma
 * limitação do próprio WhatsApp (Baileys/multi-device), não nossa: só um
 * novo QR Code/código de pareamento, escaneado pelo usuário, resolve nesse
 * caso. O chamador deve reconferir o estado após o restart e, se continuar
 * fechado, tratar como desconexão real (ver health-monitor.ts checkWhatsApp).
 */
export async function restartInstance(name: string): Promise<boolean> {
  try {
    const base = evolutionBaseUrl();
    const res = await fetch(`${base}/instance/restart/${name}`, {
      method:  'PUT',
      headers: evolutionHeaders(),
      signal:  AbortSignal.timeout(15_000),
    });
    return res.ok;
  } catch {
    return false;
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
 * sem recriar nada. Toda instância nova já nasce com groupsIgnore=false (ver
 * createInstance acima) — grupos ligados globalmente é decisão de produto
 * desde o WhatsApp Web simplificado (fase 3). Esta função hoje só é chamada
 * com `ignore=false`, pra corrigir instâncias antigas (criadas quando o
 * padrão era `true`).
 *
 * IMPORTANTE pra quem mexer em fluxo de conexão: todo lugar que marca um
 * WhatsappNumber como status='connected' precisa chamar
 * `setGroupsIgnore(instName, false).catch(...)` (fire-and-forget) logo
 * depois — não é só o connection.update do webhook. Hoje são 5 lugares
 * (não deixe esta lista ficar desatualizada de novo — foi assim que 3 deles
 * ficaram de fora na primeira versão desta função, achado só na revisão):
 * evolution-sync.ts (boot), evolution-webhook.ts (connection.update),
 * evolution-heartbeat.ts (runStatusSync), number-provisioning.ts
 * (provisionInstance, instância já open) e routes/numbers.ts (zapi-status).
 * Esquecer um deles deixa grupo faltando silenciosamente pro usuário daquele
 * número — sem erro, sem log óbvio, só "não aparece".
 *
 * NÃO existe mais nenhum caminho que desliga de volta (`ignore=true`) — o
 * Copiloto (Função 2) usava fazer isso ao desativar o último grupo opt-in,
 * mas isso quebraria o WhatsApp Web pro usuário; ver comentário em
 * copiloto.ts.
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

export interface EvolutionUnreadChat {
  jid: string;                  // remoteJid completo ('5511999999999@s.whatsapp.net' ou 'xxx@g.us')
  phone: string;                 // só dígitos (pra grupo: o ID numérico do grupo, não um telefone de verdade)
  name: string | null;
  type: 'individual' | 'group';
  unreadCount: number;
  lastMessageAt: number | null; // epoch ms, quando a Evolution devolve updatedAt
}

/**
 * Busca e normaliza TODOS os chats (individuais + grupos) de uma instância —
 * base compartilhada por fetchUnreadChats (backfill do Copiloto, só
 * individuais) e fetchAllChats (lista de conversas do WhatsApp Web
 * simplificado, individuais + grupos). `unreadMessages` é o nome do campo na
 * Evolution API a partir da v2.3.1; como o self-host pode rodar um
 * fork/versão levemente diferente, aceita `unreadCount` também e trata
 * ausência como 0.
 */
async function fetchChatsRaw(instanceNameStr: string): Promise<EvolutionUnreadChat[]> {
  const base = evolutionBaseUrl();
  const res = await fetch(`${base}/chat/findChats/${instanceNameStr}`, {
    method:  'POST',
    headers: evolutionHeaders(),
    body:    JSON.stringify({}),
    signal:  AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Evolution findChats falhou (${res.status}): ${text}`);
  }
  const raw = await res.json().catch(() => []);
  const data: any[] = Array.isArray(raw) ? raw : (raw?.chats ?? raw?.records ?? []);
  return data
    .map((c) => {
      const jid     = c?.remoteJid ?? c?.id ?? '';
      const isGroup = String(jid).endsWith('@g.us');
      return {
        jid,
        phone:         String(jid).replace('@s.whatsapp.net', '').replace('@g.us', '').replace('@c.us', '').replace(/\D/g, ''),
        name:          c?.subject ?? c?.pushName ?? c?.name ?? null,
        type:          (isGroup ? 'group' : 'individual') as 'individual' | 'group',
        unreadCount:   c?.unreadMessages ?? c?.unreadCount ?? 0,
        lastMessageAt: c?.updatedAt ? new Date(c.updatedAt).getTime() : null,
      };
    })
    .filter((c) => c.phone && (c.jid.endsWith('@s.whatsapp.net') || c.jid.endsWith('@g.us')));
}

/**
 * Lista chats individuais (nunca grupos) com mensagens não lidas — usado só
 * pelo backfill do Copiloto (ver copiloto-backfill.ts), que tem seu próprio
 * pipeline de grupo à parte (opt-in por grupo, CopilotoGroup). O filtro por
 * `type` aqui é o que preserva esse comportamento mesmo agora que
 * fetchChatsRaw devolve grupos também.
 */
export async function fetchUnreadChats(instanceNameStr: string): Promise<EvolutionUnreadChat[]> {
  const chats = await fetchChatsRaw(instanceNameStr);
  return chats.filter((c) => c.type === 'individual' && c.unreadCount > 0);
}

/**
 * Lista TODOS os chats (individuais + grupos), mais recente primeiro — base
 * da tela de WhatsApp Web simplificado (lista de conversas).
 */
export async function fetchAllChats(instanceNameStr: string, limit = 50): Promise<EvolutionUnreadChat[]> {
  const chats = await fetchChatsRaw(instanceNameStr);
  return chats
    .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))
    .slice(0, limit);
}

export interface EvolutionChatMessage {
  id: string;
  fromMe: boolean;
  text: string;
  timestamp: number; // epoch seconds (Baileys messageTimestamp)
  // Só preenchido em mensagens de GRUPO — quem mandou dentro do grupo. Em
  // chat individual o remetente já é óbvio pelo `fromMe`/dono da conversa,
  // por isso fica undefined ali (evita ruído no tipo pro caso comum).
  senderJid?: string;
  senderName?: string;
}

/**
 * Últimas mensagens de um chat (individual ou grupo), mais antiga primeiro.
 * Só extrai texto puro (conversation/extendedTextMessage) — mesmo filtro que
 * o webhook de mensagens em tempo real já aplica pro Copiloto
 * (evolution-webhook.ts); mídia/áudio não vira contexto do Copiloto aqui
 * também. Em mensagens de grupo, captura remetente via `key.participant`
 * (Baileys: JID de quem mandou dentro do grupo — `key.remoteJid` é sempre o
 * JID do grupo em si, não ajuda a saber quem falou).
 *
 * `beforeTimestamp` pagina pra trás — passa o `timestamp` da mensagem mais
 * antiga já carregada na tela pra buscar o lote anterior a ela ("carregar
 * mensagens mais antigas"). Sem verificação contra uma Evolution ao vivo
 * (mesma ressalva de sempre neste arquivo) — o filtro `where.messageTimestamp`
 * segue o mesmo formato passthrough Prisma-like que `where.key.remoteJid` já
 * usa; se a versão em produção não aceitar, o pior caso é a Evolution ignorar
 * o filtro extra e devolver as mesmas mensagens de sempre (não quebra nada,
 * só não pagina).
 */
export async function fetchChatMessages(
  instanceNameStr: string, remoteJid: string, limit = 20, beforeTimestamp?: number,
): Promise<EvolutionChatMessage[]> {
  const base  = evolutionBaseUrl();
  const where: any = { key: { remoteJid } };
  // !== undefined (não truthy simples) — 0 é um timestamp legítimo (é o
  // fallback de mensagem sem messageTimestamp válido, logo abaixo), e um
  // `if (beforeTimestamp)` trataria isso como "sem cursor" e devolveria a
  // primeira página nas costas de quem pediu histórico mais antigo.
  if (beforeTimestamp !== undefined) where.messageTimestamp = { lt: beforeTimestamp };
  const res = await fetch(`${base}/chat/findMessages/${instanceNameStr}`, {
    method:  'POST',
    headers: evolutionHeaders(),
    body:    JSON.stringify({ where, limit }),
    signal:  AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Evolution findMessages falhou (${res.status}): ${text}`);
  }
  const raw = await res.json().catch(() => null);
  // A Evolution pagina algumas respostas em { messages: { records: [...] } };
  // outras devolvem o array direto. Aceita as duas formas.
  const list: any[] = Array.isArray(raw) ? raw : (raw?.messages?.records ?? raw?.records ?? []);
  const isGroup = remoteJid.endsWith('@g.us');

  const out: EvolutionChatMessage[] = [];
  for (const m of list) {
    const messageType = m?.messageType;
    const text: string | undefined =
      messageType === 'conversation'      ? m?.message?.conversation :
      messageType === 'extendedTextMessage' ? m?.message?.extendedTextMessage?.text :
      undefined;
    if (!text) continue; // só texto — mesmo filtro do webhook em tempo real
    const fromMe = !!m?.key?.fromMe;
    out.push({
      id:        m?.key?.id ?? `evo_backfill_${m?.messageTimestamp ?? Date.now()}`,
      fromMe,
      text,
      timestamp: typeof m?.messageTimestamp === 'number' ? m.messageTimestamp : 0,
      ...(isGroup && !fromMe ? {
        senderJid:  m?.key?.participant ?? undefined,
        senderName: m?.pushName ?? undefined,
      } : {}),
    });
  }
  out.sort((a, b) => a.timestamp - b.timestamp); // mais antiga primeiro
  return out.slice(-limit);
}

export interface MessageKeyRef {
  id: string;
  fromMe: boolean;
  remoteJid: string;
  participant?: string; // grupo: quem mandou (key.participant)
}

/**
 * Marca mensagens como lidas de verdade no WhatsApp (envia o recibo de
 * leitura) — usado quando o dono abre uma conversa no WhatsApp Web
 * simplificado, pra não ficar só um badge que zera na tela sem avisar o
 * WhatsApp de fato.
 *
 * NÃO verificado contra uma instância Evolution ao vivo (mesma ressalva de
 * deleteMessageForEveryone acima) — rota e shape (`PUT
 * /chat/markMessageAsRead/:instance`, body `{ readMessages: [...] }`)
 * inferidos da documentação pública da Evolution API. Best-effort: o
 * chamador trata falha sem quebrar o carregamento da conversa — se a versão
 * da instância usar outro shape, só a confirmação de leitura não funciona,
 * não derruba nada.
 */
export async function markChatAsRead(instanceNameStr: string, keys: MessageKeyRef[]): Promise<void> {
  if (keys.length === 0) return;
  const base = evolutionBaseUrl();
  const res = await fetch(`${base}/chat/markMessageAsRead/${instanceNameStr}`, {
    method:  'PUT',
    headers: evolutionHeaders(),
    body: JSON.stringify({
      readMessages: keys.map(k => ({
        remoteJid: k.remoteJid,
        id:        k.id,
        fromMe:    k.fromMe,
        ...(k.participant ? { participant: k.participant } : {}),
      })),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Evolution markMessageAsRead falhou (${res.status}): ${text}`);
  }
}

/**
 * Envia mensagem de texto pra um JID completo — obrigatório pra GRUPO
 * (`xxx@g.us`): passar só dígitos (como sendText faz) manda um grupo pro
 * limbo, porque a Evolution interpretaria os dígitos como um número de
 * telefone qualquer, não como o ID do grupo. Implementação única — sendText
 * abaixo é uma casca fina em cima desta, pra número individual não precisar
 * montar o JID na mão.
 */
export async function sendTextToJid(instanceNameStr: string, jid: string, message: string): Promise<{ id: string | null }> {
  const base = evolutionBaseUrl();
  const res = await fetch(`${base}/message/sendText/${instanceNameStr}`, {
    method:  'POST',
    headers: evolutionHeaders(),
    body: JSON.stringify({ number: jid, text: message }),
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
 * Envia mensagem de texto pra um número individual via Evolution API — versão
 * digits-only de sendTextToJid, NÃO funciona pra grupo (ver doc acima).
 * Retorna o id da mensagem enviada (quando a Evolution devolve) — usado pelo
 * Copiloto para correlacionar um reply/citação do usuário (stanzaId) de volta
 * ao card específico que o gerou. Chamadores que não precisam disso seguem
 * só dando `await sendText(...)` normalmente, sem usar o retorno.
 */
export async function sendText(instanceNameStr: string, phone: string, message: string): Promise<{ id: string | null }> {
  return sendTextToJid(instanceNameStr, phone.replace(/\D/g, ''), message);
}

/**
 * Apaga "para todos" uma mensagem que o próprio número mandou — usado pelo
 * comando "copiloto desfazer" (janela curta de 2min após enviar uma sugestão).
 *
 * NÃO verificado contra uma instância Evolution ao vivo — o sandbox não
 * alcança doc.evolution-api.com (rede bloqueada) pra confirmar o payload
 * exato. Rota e shape (`DELETE /chat/deleteMessageForEveryone/:instance`,
 * body `{ id, remoteJid, fromMe }`) inferidos do controller open-source do
 * Evolution API. Best-effort: o chamador trata falha sem quebrar o fluxo —
 * se a versão da instância usar outro shape, o "desfazer" só não funciona,
 * não derruba nada.
 */
export async function deleteMessageForEveryone(
  instanceNameStr: string, messageId: string, phone: string,
): Promise<void> {
  const base  = evolutionBaseUrl();
  const clean = phone.replace(/\D/g, '');
  const res = await fetch(`${base}/chat/deleteMessageForEveryone/${instanceNameStr}`, {
    method:  'DELETE',
    headers: evolutionHeaders(),
    body: JSON.stringify({ id: messageId, remoteJid: `${clean}@s.whatsapp.net`, fromMe: true }),
    signal:  AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Evolution deleteMessageForEveryone falhou (${res.status}): ${text}`);
  }
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
 * Envia uma imagem via Evolution API — base64 inline, sem depender de URL
 * pública (mesmo padrão de sendPtt). Usado pelo Chatbot Campanhas pra mandar
 * o QR code do Pix junto do código copia-e-cola.
 */
export async function sendImage(instanceNameStr: string, phone: string, imageBase64: string, caption = ''): Promise<void> {
  const base  = evolutionBaseUrl();
  const clean = phone.replace(/\D/g, '');
  const res = await fetch(`${base}/message/sendMedia/${instanceNameStr}`, {
    method:  'POST',
    headers: evolutionHeaders(),
    body: JSON.stringify({
      number: clean,
      mediatype: 'image',
      mimetype: 'image/png',
      caption,
      media: imageBase64,
      fileName: 'pix-qrcode.png',
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Evolution sendMedia falhou (${res.status}): ${text}`);
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
