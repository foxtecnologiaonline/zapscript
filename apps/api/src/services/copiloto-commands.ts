/**
 * copiloto-commands.ts
 *
 * O lado do DONO no ZapScript Copiloto: comandos de configuração que ele
 * manda no self-chat ("copiloto ligar/negocio/agressividade/...").
 *
 * v3.0 (ESCOPO_COPILOTO.md §15) — o envio ao cliente NÃO é mais respondendo
 * "1/2/3" aqui: é clicando "Enviar" em /dashboard/copiloto, que chama
 * copiloto-actions.ts. Este arquivo cuida só de configuração + "desfazer".
 *
 * Reaproveita a mesma detecção de self-chat já usada pelo Atende (Feature 8) em
 * routes/evolution-webhook.ts.
 */

import { prisma } from '../lib/prisma';
import { sendText, deleteMessageForEveryone } from './evolution';
import { copilotoQueue } from './queue';
import { backfillUnreadConversations } from './copiloto-backfill';
import { buildModelChain, callAiWithFallback } from './ai-fallback';

const COMMAND_PREFIX = /^\s*copiloto\b/i;

/** Janela do "copiloto desfazer" — depois disso o WhatsApp normalmente já não deixa apagar "para todos". */
const UNDO_WINDOW_MS = 2 * 60 * 1000; // 2 min

const AGGRESSIVENESS_LEVELS = ['consultivo', 'equilibrado', 'direto'] as const;

export function isCopilotoOwnerCommand(text: string): boolean {
  return COMMAND_PREFIX.test(text ?? '');
}

const HELP_TEXT = [
  '*Comandos do Copiloto* (mande aqui, pra você mesmo):',
  '• copiloto status — resumo rápido (não lidas hoje, ações enviadas)',
  '• copiloto ligar / desligar — liga ou pausa o processamento pro painel',
  '• copiloto negocio <texto> — o que seu negócio faz (melhora as sugestões)',
  '• copiloto agressividade consultivo|equilibrado|direto — o tom das sugestões',
  '• copiloto desfazer — apaga a última mensagem enviada, até 2min depois',
  '• copiloto testar — checa se a IA está respondendo agora',
  '',
  'A fila de verdade — resumo, 3 opções e o botão de enviar — vive em */dashboard/copiloto*, não aqui no WhatsApp.',
  '',
  '*Harvey* — closer de negociação e fechamento, pra qualquer parada da sua vida (não só cliente do WhatsApp): mande "harvey <situação>" — pessoal, carreira, cliente de banco ou venda da FOX. Ele te devolve o roteiro pronto.',
].join('\n');

/** Config do número, criada na primeira interação (MVP: ligada por padrão). */
async function ensureConfig(userId: string, numberId: string) {
  return prisma.copilotoConfig.upsert({
    where: { numberId },
    update: {},
    create: { userId, numberId },
  });
}

/** v3.0 — status aponta pro painel, que é onde a fila de verdade vive agora. */
async function buildStatus(numberId: string): Promise<string> {
  const config = await prisma.copilotoConfig.findUnique({ where: { numberId } });

  const [unreadConversations, sentToday] = await Promise.all([
    prisma.copilotoConversation.findMany({
      where: { numberId },
      select: { lastMessageAt: true, lastBriefedAt: true },
    }).then((rows) => rows.filter((c) => !c.lastBriefedAt || c.lastBriefedAt < c.lastMessageAt).length),
    prisma.copilotoSuggestion.count({
      where: {
        status: { in: ['sent', 'edited'] },
        briefing: { numberId },
        createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
    }),
  ]);

  return [
    '*Copiloto — status*',
    `Estado: ${config?.enabled === false ? 'pausado ⏸️' : 'ligado ✅'}`,
    `Conversas não lidas: ${unreadConversations}`,
    `Ações enviadas hoje: ${sentToday}`,
    '',
    'Acesse /dashboard/copiloto pra ver o resumo, as 3 opções e enviar direto por lá.',
  ].join('\n');
}

/**
 * Comandos com o prefixo "copiloto". Devolve true se tratou (o webhook deve parar).
 */
export async function handleCopilotoOwnerCommand(params: {
  userId: string;
  numberId: string;
  instanceName: string;
  selfPhone: string;
  text: string;
}): Promise<boolean> {
  const { userId, numberId, instanceName, selfPhone } = params;
  const body = params.text.replace(COMMAND_PREFIX, '').trim();
  const lower = body.toLowerCase();

  const reply = async (msg: string) => { await sendText(instanceName, selfPhone, msg); };

  if (!body || /^(ajuda|help|\?)$/.test(lower)) {
    await reply(HELP_TEXT);
    return true;
  }

  if (/^status$/.test(lower)) {
    await ensureConfig(userId, numberId);
    await reply(await buildStatus(numberId));
    return true;
  }

  // v3.0 — "ligar/desligar" não controla mais push nenhum (não existe mais):
  // é só o botão mestre de "o painel /dashboard/copiloto processa este
  // número quando eu clicar Atualizar" (ver processBrief, apps/worker/src/
  // copiloto.ts). Backfill de mensagens não lidas continua no "ligar" —
  // garante que o painel já enxerga conversa perdida antes do módulo ligar.
  if (/^(ligar|ativar|on)$/.test(lower)) {
    await ensureConfig(userId, numberId);
    await prisma.copilotoConfig.update({ where: { numberId }, data: { enabled: true } });
    await reply('✅ Copiloto ligado. Acesse /dashboard/copiloto e clique em "Atualizar" pra ver as conversas pendentes.');
    backfillUnreadConversations({
      userId, numberId, instanceId: instanceName, ownPhoneDigits: selfPhone.replace(/\D/g, ''),
    }).catch(() => null);
    return true;
  }

  if (/^(desligar|pausar|off)$/.test(lower)) {
    await ensureConfig(userId, numberId);
    await prisma.copilotoConfig.update({ where: { numberId }, data: { enabled: false } });
    await reply('⏸️ Copiloto pausado — o painel não vai mais processar conversas deste número até "copiloto ligar".');
    return true;
  }

  const negocio = body.match(/^neg[óo]cio\s+([\s\S]+)$/i);
  if (negocio) {
    const ctx = negocio[1].trim().slice(0, 2000);
    await ensureConfig(userId, numberId);
    await prisma.copilotoConfig.update({ where: { numberId }, data: { businessContext: ctx } });
    await reply('✅ Anotado. Vou usar isso pra deixar as sugestões mais certeiras.');
    return true;
  }

  const agressividade = lower.match(/^agressividade\s+(\w+)$/);
  if (agressividade) {
    const level = agressividade[1];
    if (!AGGRESSIVENESS_LEVELS.includes(level as any)) {
      await reply(`Opções: ${AGGRESSIVENESS_LEVELS.join(', ')}.`);
      return true;
    }
    await ensureConfig(userId, numberId);
    await prisma.copilotoConfig.update({ where: { numberId }, data: { aggressiveness: level } });
    await reply(`✅ Agressividade ajustada pra *${level}*. Vale a partir do próximo briefing.`);
    return true;
  }

  // v3.0 — removido "copiloto confianca <tipo> <valor>": era o piso de
  // confiança da triagem que decidia se uma conversa merecia te interromper
  // no WhatsApp. Sem interrupção, não tem mais "vale a pena" pra filtrar —
  // toda conversa não lida vira card no painel (ESCOPO_COPILOTO.md §15).

  // "copiloto testar" — chamada mínima pela mesma rede de fallback do
  // briefing, só pra ver qual provedor responde. Resolve o "como sei que está
  // online" sem precisar de docker logs no servidor.
  if (/^testar$/.test(lower)) {
    const t0 = Date.now();
    try {
      const models = buildModelChain({
        anthropic: [process.env.COPILOTO_TRIAGE_MODEL || 'claude-haiku-4-5'],
        openaiModel: process.env.COPILOTO_TRIAGE_MODEL_OPENAI || 'gpt-4o-mini',
        groqModel: process.env.COPILOTO_TRIAGE_MODEL_GROQ || 'llama-3.3-70b-versatile',
        geminiModel: process.env.COPILOTO_TRIAGE_MODEL_GEMINI || 'gemini-2.5-flash',
      });
      if (models.length === 0) {
        await reply('⚠️ Nenhum provedor de IA configurado (nem chave nem fallback disponível).');
        return true;
      }
      const usedBefore = models.map((m) => `${m.provider}:${m.model}`);
      let usedIndex = 0;
      // callAiWithFallback não devolve qual modelo respondeu — testa cada um
      // isoladamente até o primeiro que funcionar, o que é exatamente o que
      // "testar" precisa mostrar (qual está de pé agora).
      let ok = false;
      let lastErr = '';
      for (const spec of models) {
        try {
          await callAiWithFallback({
            models: [spec],
            system: 'Responda apenas com o JSON {"ok": true}, sem markdown.',
            user: 'teste',
            maxTokens: 20,
            label: '[Copiloto/testar]',
          });
          ok = true;
          break;
        } catch (err: any) {
          lastErr = err.message;
          usedIndex++;
        }
      }
      const ms = Date.now() - t0;
      if (ok) {
        await reply(`✅ IA respondendo — *${usedBefore[usedIndex]}* (${ms}ms)${usedIndex > 0 ? `\n_Provedor(es) anterior(es) falhou/falharam, fallback funcionou._` : ''}`);
      } else {
        await reply(`🔴 Todos os provedores falharam agora (${usedBefore.join(', ')}).\nÚltimo erro: ${lastErr.slice(0, 200)}`);
      }
    } catch (err: any) {
      await reply(`🔴 Erro ao testar: ${err.message}`);
    }
    return true;
  }

  if (/^desfazer$/.test(lower)) {
    const since = new Date(Date.now() - UNDO_WINDOW_MS);
    const suggestion = await prisma.copilotoSuggestion.findFirst({
      where: {
        status: { in: ['sent', 'edited'] },
        sentAt: { gte: since },
        briefing: { numberId },
      },
      orderBy: { sentAt: 'desc' },
      include: { briefing: { include: { conversation: { select: { contactName: true, contactPhone: true } } } } },
    });
    if (!suggestion) {
      await reply('Não achei nada enviado nos últimos 2 minutos pra desfazer.');
      return true;
    }

    const who = suggestion.briefing.conversation.contactName || suggestion.briefing.conversation.contactPhone;

    if (suggestion.sentMessageId) {
      try {
        await deleteMessageForEveryone(instanceName, suggestion.sentMessageId, suggestion.briefing.conversation.contactPhone);
      } catch (err: any) {
        // Best-effort — WhatsApp pode já ter passado da janela própria de apagar
        // "para todos", ou a instância pode não suportar. Continua mesmo assim:
        // desfaz o registro no Copiloto (permite escolher outra opção), só avisa
        // que a mensagem em si pode não ter sumido do celular do cliente.
        await reply(
          `⚠️ Não consegui apagar a mensagem no WhatsApp (${err.message.slice(0, 120)}) — ela pode continuar visível pra *${who}*.\n` +
          `Desfiz o registro aqui; se quiser, escolha outra opção.`,
        );
        await prisma.copilotoSuggestion.update({ where: { id: suggestion.id }, data: { status: 'offered', sentText: null } });
        await prisma.copilotoBriefing.update({ where: { id: suggestion.briefingId }, data: { status: 'pending', actedAt: null } });
        return true;
      }
    }

    await prisma.copilotoSuggestion.update({ where: { id: suggestion.id }, data: { status: 'offered', sentText: null } });
    await prisma.copilotoBriefing.update({ where: { id: suggestion.briefingId }, data: { status: 'pending', actedAt: null } });
    await reply(`✅ Desfeito — a mensagem pra *${who}* foi apagada. Responda de novo se quiser escolher outra opção.`);
    return true;
  }

  await reply(`Não entendi "${body}".\n\n${HELP_TEXT}`);
  return true;
}

// v3.0 — removido handleCopilotoChoice (resposta "1"/"2"/"3"/"1e"/"0" no
// self-chat): o Copiloto virou painel sob demanda (ver ESCOPO_COPILOTO.md
// §15). Enviar ao cliente e descartar um briefing agora vivem em
// copiloto-actions.ts (sendCopilotoSuggestion / dismissCopilotoBriefing),
// chamados por POST /copiloto/suggestions/:id/send e /copiloto/briefings/:id
// (routes/copiloto.ts) — não mais por uma resposta de texto no WhatsApp.

/**
 * Enfileira o que chegou pelo WhatsApp. Fica aqui (e não inline no webhook)
 * para o webhook continuar legível: ele só decide "é do Copiloto?" e delega.
 *
 * v3.0 — só o job 'ingest' (persiste, sem IA). NÃO enfileira mais 'brief':
 * o Copiloto virou sob demanda (ver ESCOPO_COPILOTO.md §15) — quem decide
 * processar uma conversa é o dono, no painel /dashboard/copiloto (POST
 * /copiloto/inbox/refresh), não uma janela de debounce depois da mensagem.
 */
export async function enqueueCopilotoMessage(params: {
  userId: string;
  numberId: string;
  contactPhone: string;
  contactName?: string | null;
  direction: 'in' | 'out';
  content: string;
  messageId: string;
}): Promise<void> {
  await copilotoQueue.add(
    'ingest',
    {
      userId: params.userId,
      numberId: params.numberId,
      contactPhone: params.contactPhone,
      contactName: params.contactName ?? null,
      direction: params.direction,
      content: params.content,
      // Idempotência real (dados), não só a do jobId (fila — removeOnComplete
      // apaga o registro depois de 24h/500 jobs, ver services/queue.ts): sem
      // isso, o sweep de não lidas (copiloto-backfill.ts) duplicaria mensagem
      // toda vez que reprocessasse um chat que continua não lido.
      externalId: params.messageId,
    },
    { jobId: `copiloto-in-${params.messageId}` },
  );
}
