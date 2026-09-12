/**
 * copiloto-commands.ts
 *
 * O lado do DONO no ZapScript Copiloto: tudo que ele responde no self-chat
 * (mensagem que ele manda para o próprio número) cai aqui.
 *
 * É também o ÚNICO lugar do Copiloto que envia mensagem para o cliente — e só
 * depois de o dono responder 1, 2 ou 3. O worker (apps/worker/src/copiloto.ts)
 * nunca fala com o cliente. Essa separação é o que sustenta a premissa do
 * produto: o Copiloto sugere, o humano decide. Ver ESCOPO_COPILOTO.md §1.
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

/** Briefing mais velho que isto não é mais acionável por "1/2/3". */
const CHOICE_WINDOW_MS = 12 * 60 * 60 * 1000; // 12h

/**
 * Janela do "1e" (editar antes de enviar). Curta de propósito: enquanto ela está
 * aberta, TUDO que o dono escreve no self-chat vira mensagem para o cliente.
 */
const EDIT_WINDOW_MS = 15 * 60 * 1000; // 15 min

/** Janela do "copiloto desfazer" — depois disso o WhatsApp normalmente já não deixa apagar "para todos". */
const UNDO_WINDOW_MS = 2 * 60 * 1000; // 2 min

const AGGRESSIVENESS_LEVELS = ['consultivo', 'equilibrado', 'direto'] as const;

export function isCopilotoOwnerCommand(text: string): boolean {
  return COMMAND_PREFIX.test(text ?? '');
}

const HELP_TEXT = [
  '*Comandos do Copiloto* (mande aqui, pra você mesmo):',
  '• copiloto status — o que está pendente',
  '• copiloto ligar / desligar — liga ou pausa os briefings',
  '• copiloto limite 5 — quantos briefings por dia no máximo',
  '• copiloto silencio 21:00 07:00 — janela em que ele não te incomoda',
  '• copiloto negocio <texto> — o que seu negócio faz (melhora as sugestões)',
  '• copiloto agressividade consultivo|equilibrado|direto — o tom das sugestões',
  '• copiloto desfazer — apaga a última mensagem enviada, até 2min depois',
  '• copiloto testar — checa se a IA está respondendo agora',
  '',
  'Quando chegar um briefing: responda *1*, *2* ou *3* pra enviar, *1e* pra editar antes, *0* pra ignorar.',
].join('\n');

/** Aceita "21:00" ou "21h" e devolve "HH:mm"; null se não for hora válida. */
function parseHhMm(raw: string): string | null {
  const m = raw.match(/^(\d{1,2})(?::?(\d{2}))?h?$/i);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Config do número, criada na primeira interação (MVP: ligada por padrão). */
async function ensureConfig(userId: string, numberId: string) {
  return prisma.copilotoConfig.upsert({
    where: { numberId },
    update: {},
    create: { userId, numberId },
  });
}

async function buildStatus(numberId: string): Promise<string> {
  const config = await prisma.copilotoConfig.findUnique({ where: { numberId } });
  const since = new Date(Date.now() - CHOICE_WINDOW_MS);

  const [pending, todayCount, sentToday] = await Promise.all([
    prisma.copilotoBriefing.findMany({
      where: { numberId, status: { in: ['pending', 'awaiting_edit'] }, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { conversation: { select: { contactName: true, contactPhone: true } } },
    }),
    prisma.copilotoBriefing.count({
      where: { numberId, createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
    }),
    prisma.copilotoSuggestion.count({
      where: {
        status: 'sent',
        briefing: { numberId },
        createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
    }),
  ]);

  const lines = [
    '*Copiloto — status*',
    `Estado: ${config?.enabled === false ? 'pausado ⏸️' : 'ligado ✅'}`,
    `Briefings hoje: ${todayCount}/${config?.maxBriefsPerDay ?? 8}`,
    `Ações enviadas hoje: ${sentToday}`,
    `Silêncio: ${config?.quietStart ?? '21:00'} → ${config?.quietEnd ?? '07:00'}`,
  ];

  if (pending.length === 0) {
    lines.push('', 'Nada esperando você agora.');
  } else {
    lines.push('', `*Esperando você (${pending.length}):*`);
    for (const b of pending) {
      const who = b.conversation.contactName || b.conversation.contactPhone;
      lines.push(`• ${who} — ${b.temperature}${b.status === 'awaiting_edit' ? ' (aguardando seu texto)' : ''}`);
    }
    lines.push('', '_Só o briefing mais recente responde a 1/2/3._');
  }

  return lines.join('\n');
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

  if (/^(ligar|ativar|on)$/.test(lower)) {
    await ensureConfig(userId, numberId);
    await prisma.copilotoConfig.update({ where: { numberId }, data: { enabled: true } });
    await reply('✅ Copiloto ligado. Vou te avisar quando uma conversa merecer sua atenção.');
    // Backfill: conversas já com mensagem não lida agora também entram na
    // fila de briefing, não só o que chegar dali pra frente. Fire-and-forget.
    backfillUnreadConversations({
      userId, numberId, instanceId: instanceName, ownPhoneDigits: selfPhone.replace(/\D/g, ''),
    }).catch(() => null);
    return true;
  }

  if (/^(desligar|pausar|off)$/.test(lower)) {
    await ensureConfig(userId, numberId);
    await prisma.copilotoConfig.update({ where: { numberId }, data: { enabled: false } });
    await reply('⏸️ Copiloto pausado. Mande "copiloto ligar" quando quiser de volta.');
    return true;
  }

  const limite = lower.match(/^limite\s+(\d{1,2})$/);
  if (limite) {
    const n = parseInt(limite[1], 10);
    if (n < 1 || n > 20) {
      await reply('O limite precisa ficar entre 1 e 20 briefings por dia.');
      return true;
    }
    await ensureConfig(userId, numberId);
    await prisma.copilotoConfig.update({ where: { numberId }, data: { maxBriefsPerDay: n } });
    await reply(`✅ Limite ajustado: no máximo ${n} briefing(s) por dia.`);
    return true;
  }

  const silencio = lower.match(/^sil[êe]ncio\s+(\S+)\s+(\S+)$/);
  if (silencio) {
    const start = parseHhMm(silencio[1]);
    const end = parseHhMm(silencio[2]);
    if (!start || !end) {
      await reply('Formato: copiloto silencio 21:00 07:00');
      return true;
    }
    await ensureConfig(userId, numberId);
    await prisma.copilotoConfig.update({ where: { numberId }, data: { quietStart: start, quietEnd: end } });
    await reply(`✅ Silêncio das ${start} às ${end}. Nesse intervalo não te mando nada.`);
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

/**
 * Resposta do dono a um briefing: "1", "2", "3", "1e", "0" ou o texto editado.
 * Devolve true se a mensagem era para o Copiloto (o webhook deve parar aqui).
 *
 * Guarda importante: só interpreta um "2" solto como escolha se existir briefing
 * pendente recente para este número. Sem isso, qualquer anotação pessoal que o
 * dono mandasse pra si mesmo viraria envio ao cliente — o pior bug possível
 * neste produto.
 */
export async function handleCopilotoChoice(params: {
  userId: string;
  numberId: string;
  instanceName: string;
  selfPhone: string;
  text: string;
}): Promise<boolean> {
  const { numberId, instanceName, selfPhone } = params;
  const raw = (params.text ?? '').trim();
  if (!raw) return false;

  const reply = async (msg: string) => { await sendText(instanceName, selfPhone, msg); };
  const since = new Date(Date.now() - CHOICE_WINDOW_MS);

  const briefing = await prisma.copilotoBriefing.findFirst({
    where: { numberId, status: { in: ['pending', 'awaiting_edit'] }, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    include: {
      suggestions: true,
      conversation: { select: { id: true, contactPhone: true, contactName: true } },
    },
  });
  if (!briefing) return false;

  const who = briefing.conversation.contactName || briefing.conversation.contactPhone;

  // Envia ao cliente e registra. `finalText` pode ser o rascunho ou a versão que
  // o dono editou — guardar os dois é o que ensina o estilo dele (o diff entre
  // draft e sentText é o sinal de aprendizado mais forte que temos).
  const dispatch = async (suggestion: (typeof briefing.suggestions)[number], finalText: string, edited: boolean) => {
    const sent = await sendText(instanceName, briefing.conversation.contactPhone, finalText);

    // Compromisso embutido na opção (ex.: "te confirmo até as 17h") vira Task
    // automaticamente — reaproveita o módulo Tarefas já existente em vez de
    // inventar uma agenda própria. Best-effort: falha aqui não pode travar o
    // envio, que já aconteceu.
    let taskId: string | null = null;
    if (suggestion.commitmentTitle) {
      try {
        const task = await prisma.task.create({
          data: {
            userId: params.userId,
            title:  suggestion.commitmentTitle,
            dueAt:  suggestion.commitmentDueAt,
          },
        });
        taskId = task.id;
      } catch (err: any) {
        // não interrompe o fluxo — o envio já aconteceu, a Task é conveniência
      }
    }

    await prisma.copilotoSuggestion.update({
      where: { id: suggestion.id },
      data: { status: edited ? 'edited' : 'sent', sentText: finalText, sentMessageId: sent.id, sentAt: new Date(), taskId },
    });
    await prisma.copilotoBriefing.update({
      where: { id: briefing.id },
      data: { status: 'acted', actedAt: new Date(), awaitingRank: null, awaitingSince: null },
    });
    await prisma.copilotoMessage.create({
      data: { conversationId: briefing.conversation.id, direction: 'out', content: finalText, fromCopiloto: true },
    });

    await reply(
      taskId
        ? `✅ Enviado para *${who}*.\n📌 Compromisso criado: ${suggestion.commitmentTitle}${suggestion.commitmentDueAt ? ` — ${suggestion.commitmentDueAt.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}.`
        : `✅ Enviado para *${who}*.`,
    );
  };

  // Estado "aguardando seu texto": qualquer coisa que não seja 0 vira a mensagem
  // enviada ao cliente — por isso a janela é CURTA. Passou de EDIT_WINDOW_MS, o
  // briefing volta a 'pending' e a mensagem segue sendo uma anotação pessoal.
  // Sem esse limite, um "1e" esquecido de manhã transformaria qualquer recado
  // que o dono mandasse pra si mesmo à tarde em mensagem para o cliente.
  const editExpired = briefing.status === 'awaiting_edit'
    && (!briefing.awaitingSince || Date.now() - briefing.awaitingSince.getTime() > EDIT_WINDOW_MS);

  if (editExpired) {
    await prisma.copilotoBriefing.update({
      where: { id: briefing.id },
      data: { status: 'pending', awaitingRank: null, awaitingSince: null },
    });
    await reply('⌛ Passou do tempo de editar aquela mensagem, então não enviei nada. Responda 1, 2 ou 3 de novo se ainda fizer sentido.');
    return true;
  }

  if (briefing.status === 'awaiting_edit' && briefing.awaitingRank) {
    if (raw === '0') {
      await prisma.copilotoBriefing.update({
        where: { id: briefing.id },
        data: { status: 'dismissed', awaitingRank: null, awaitingSince: null },
      });
      await reply('Beleza, cancelei. Nada foi enviado.');
      return true;
    }
    const chosen = briefing.suggestions.find((s) => s.rank === briefing.awaitingRank);
    if (!chosen) {
      await prisma.copilotoBriefing.update({ where: { id: briefing.id }, data: { status: 'dismissed', awaitingRank: null, awaitingSince: null } });
      await reply('Perdi a referência dessa opção. Nada foi enviado.');
      return true;
    }
    await dispatch(chosen, raw, true);
    return true;
  }

  // "0" — ignorar. Também é sinal de aprendizado: as 3 opções não serviram.
  if (/^0$/.test(raw)) {
    await prisma.copilotoBriefing.update({
      where: { id: briefing.id },
      data: { status: 'dismissed' },
    });
    await reply('Ok, ignorado.');
    return true;
  }

  const choice = raw.match(/^([123])\s*(e|editar)?$/i);
  if (!choice) return false;

  const rank = parseInt(choice[1], 10);
  const wantsEdit = !!choice[2];
  const suggestion = briefing.suggestions.find((s) => s.rank === rank && s.status === 'offered');

  if (!suggestion) {
    await reply(`A opção ${rank} não está disponível nesse briefing.`);
    return true;
  }

  if (wantsEdit) {
    await prisma.copilotoBriefing.update({
      where: { id: briefing.id },
      data: { status: 'awaiting_edit', awaitingRank: rank, awaitingSince: new Date() },
    });
    await reply(
      `✏️ Manda o texto final que eu envio pra *${who}*.\n\n` +
      `Base da opção ${rank}:\n"${suggestion.draft}"\n\n` +
      `_Você tem 15 minutos. Ou responda 0 pra cancelar._`,
    );
    return true;
  }

  await dispatch(suggestion, suggestion.draft, false);
  return true;
}

/**
 * Enfileira o que chegou pelo WhatsApp. Fica aqui (e não inline no webhook)
 * para o webhook continuar legível: ele só decide "é do Copiloto?" e delega.
 *
 * Dois jobs: 'ingest' imediato (persiste, sem IA) e 'brief' atrasado. O jobId do
 * 'brief' carrega um bucket de tempo, então toda a rajada do mesmo contato dentro
 * da janela colapsa em UM briefing em vez de um por mensagem.
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
  const debounceMs = parseInt(process.env.COPILOTO_DEBOUNCE_MS || '180000');

  await copilotoQueue.add(
    'ingest',
    {
      userId: params.userId,
      numberId: params.numberId,
      contactPhone: params.contactPhone,
      contactName: params.contactName ?? null,
      direction: params.direction,
      content: params.content,
    },
    { jobId: `copiloto-in-${params.messageId}` },
  );

  // Só mensagem do cliente abre janela de briefing. O dono respondendo sozinho
  // não precisa de sugestão — ele já agiu.
  if (params.direction !== 'in') return;

  const bucket = Math.floor(Date.now() / debounceMs);
  await copilotoQueue.add(
    'brief',
    { userId: params.userId, numberId: params.numberId, contactPhone: params.contactPhone },
    { jobId: `copiloto-brief-${params.numberId}-${params.contactPhone}-${bucket}`, delay: debounceMs },
  );
}
