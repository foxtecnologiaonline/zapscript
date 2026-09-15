/**
 * harvey-commands.ts
 *
 * Trigger + orquestração da persona Harvey dentro do Copiloto. Roda no mesmo
 * self-chat do dono, gated pelo módulo 'copiloto' (ver evolution-webhook.ts).
 *
 * Diferença para o resto do Copiloto: Harvey não reage a mensagem do
 * CLIENTE — reage a um PEDIDO do dono sobre qualquer negociação da vida dele
 * (pessoal, carreira, banco, venda FOX). Nunca fala com terceiros: só devolve
 * texto pronto pro dono copiar, exatamente como o restante do Copiloto nunca
 * envia nada sem confirmação humana.
 *
 * Fluxo: "harvey <situação>" → Harvey classifica contexto, monta o roteiro,
 * entrega no template padrão e pergunta se registra em memória. "sim" salva
 * o rascunho mais recente em HarveyConsult; qualquer outra coisa não salva.
 */

import { prisma } from '../lib/prisma';
import { sendText } from './evolution';
import { buildModelChain, callAiWithFallback } from './ai-fallback';
import { HARVEY_SYSTEM_PROMPT, formatHarveyMemory, HARVEY_CONTEXTOS, type HarveyContexto } from './harvey-playbook';

const TRIGGER_PREFIX = /^\s*harvey\b/i;

/** Janela em que "sim"/"registrar" ainda se refere ao último rascunho entregue. */
const MEMORY_CONFIRM_WINDOW_MS = 30 * 60 * 1000; // 30 min

const HARVEY_MODELS = buildModelChain({
  anthropic: [process.env.HARVEY_MODEL || 'claude-sonnet-5', 'claude-sonnet-4-6'],
  openaiModel: process.env.HARVEY_MODEL_OPENAI || 'gpt-4o',
  groqModel: process.env.HARVEY_MODEL_GROQ || 'llama-3.3-70b-versatile',
  geminiModel: process.env.HARVEY_MODEL_GEMINI || 'gemini-2.5-pro',
});

// Auto-detecção sem o prefixo "harvey": só dispara quando o texto tem sinal
// forte de negociação real (2+ keywords de eixos diferentes) e é longo o
// bastante pra não ser uma resposta curta de outro fluxo (evita sequestrar
// "1"/"2"/"3" do briefing normal ou uma nota pessoal qualquer).
const AUTO_TRIGGER_KEYWORDS = [
  // pessoal
  'negociar', 'convencer', 'conflito', 'desconto', 'cônjuge', 'conjuge', 'síndico', 'sindico',
  // profissional
  'carreira', 'promoção', 'promocao', 'posicionamento', 'superintendente', 'como me posiciono',
  // gerente-banco
  'crédito', 'credito', 'inadimplência', 'inadimplencia', 'juro', 'retenção', 'retencao', 'pj',
  // FOX/SaaS
  'proposta comercial', 'fechar contrato', 'fornecedor', 'investidor', 'objeção', 'objecao', 'zapscript',
];

function countAutoTriggerHits(text: string): number {
  const lower = text.toLowerCase();
  let hits = 0;
  for (const kw of AUTO_TRIGGER_KEYWORDS) {
    if (lower.includes(kw)) hits++;
  }
  return hits;
}

export function isHarveyTrigger(text: string): boolean {
  const t = (text ?? '').trim();
  if (!t) return false;
  if (TRIGGER_PREFIX.test(t)) return true;
  // Auto-detecção conservadora: exige texto substancial (não é comando curto)
  // e pelo menos 2 keywords de negociação pra reduzir falso positivo.
  return t.length >= 25 && countAutoTriggerHits(t) >= 2;
}

function isMemoryConfirm(text: string): boolean {
  return /^(sim|s|pode registrar|registrar|registra|salvar|salva)$/i.test(text.trim());
}

function isMemoryDecline(text: string): boolean {
  return /^(n[aã]o|nao|n|deixa|pula|não precisa|nao precisa)$/i.test(text.trim());
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

async function findPendingDraft(userId: string) {
  const since = new Date(Date.now() - MEMORY_CONFIRM_WINDOW_MS);
  return prisma.harveyConsult.findFirst({
    where: { userId, status: 'draft', createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Trata uma mensagem do dono no self-chat que pode ser Harvey — gatilho
 * explícito/implícito, ou confirmação de memória de uma consulta anterior.
 * Devolve true se tratou (o webhook deve parar aqui).
 */
export async function handleHarveyMessage(params: {
  userId: string;
  numberId: string;
  instanceName: string;
  selfPhone: string;
  text: string;
}): Promise<boolean> {
  const { userId, numberId, instanceName, selfPhone, text } = params;
  const reply = async (msg: string) => { await sendText(instanceName, selfPhone, msg); };

  // Confirmação de memória tem prioridade — só se existir rascunho recente E
  // não houver edição de briefing normal em aberto pro mesmo número (nesse
  // caso "sim"/"não" é o texto que o dono está mandando pro CLIENTE — ver
  // copiloto-commands.ts EDIT_WINDOW_MS).
  if (isMemoryConfirm(text) || isMemoryDecline(text)) {
    const awaitingEdit = await prisma.copilotoBriefing.findFirst({
      where: { numberId, status: 'awaiting_edit' },
      select: { id: true },
    });
    if (awaitingEdit) return false;
    const pending = await findPendingDraft(userId);
    if (!pending) return false;
    if (isMemoryConfirm(text)) {
      await prisma.harveyConsult.update({ where: { id: pending.id }, data: { status: 'saved' } });
      await reply('✅ Registrado. Da próxima vez que aparecer algo parecido, eu lembro.');
    } else {
      await prisma.harveyConsult.update({ where: { id: pending.id }, data: { status: 'discarded' } });
      await reply('Ok, não registrei.');
    }
    return true;
  }

  if (!isHarveyTrigger(text)) return false;

  const situacao = TRIGGER_PREFIX.test(text) ? text.replace(TRIGGER_PREFIX, '').trim() : text.trim();
  if (!situacao) {
    await reply(
      '*Harvey* — seu closer de negociação, dentro do Copiloto.\n\n' +
      'Me conta a situação: "harvey <o que está rolando>". Pode ser pessoal, carreira, cliente de banco ou venda da FOX — eu identifico o contexto e devolvo o roteiro.',
    );
    return true;
  }

  // Memória: casos já confirmados, do contexto mais provável — se ainda não
  // sabemos o contexto (é o próprio Harvey quem classifica), passa os mais
  // recentes de qualquer contexto; é material de apoio, não regra.
  const recentSaved = await prisma.harveyConsult.findMany({
    where: { userId, status: 'saved' },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { topico: true, resposta: true, createdAt: true, contexto: true },
  });
  const memoryBlock = formatHarveyMemory(
    recentSaved.map((c) => ({ topico: c.topico, resumo: c.resposta, createdAt: c.createdAt })),
  );

  const user = [
    memoryBlock ? `Casos anteriores que você já registrou pra este dono (use só se for realmente parecido):\n${memoryBlock}` : null,
    `Situação trazida pelo dono agora:\n${situacao}`,
  ].filter(Boolean).join('\n\n');

  let parsed: any;
  try {
    parsed = await callAiWithFallback({
      models: HARVEY_MODELS,
      system: HARVEY_SYSTEM_PROMPT,
      user,
      maxTokens: 1500,
      label: '[Harvey]',
    });
  } catch (err: any) {
    await reply(`🔴 Harvey não conseguiu responder agora (${err.message.slice(0, 150)}). Tenta de novo em instantes.`);
    return true;
  }

  if (parsed?.precisa_clarificar) {
    const pergunta = typeof parsed?.pergunta_clarificacao === 'string' && parsed.pergunta_clarificacao.trim()
      ? parsed.pergunta_clarificacao.trim()
      : 'Isso é pessoal, profissional, bancário ou da FOX?';
    await reply(pergunta);
    return true;
  }

  const respostaWhatsapp = typeof parsed?.resposta_whatsapp === 'string' ? parsed.resposta_whatsapp.trim() : '';
  if (!respostaWhatsapp) {
    await reply('🔴 Harvey não conseguiu montar um roteiro a partir disso. Descreve a situação com mais detalhe?');
    return true;
  }

  const contexto: HarveyContexto | null = HARVEY_CONTEXTOS.includes(parsed?.contexto) ? parsed.contexto : null;
  const topico = typeof parsed?.topico === 'string' && parsed.topico.trim() ? parsed.topico.trim() : 'Negociação';
  const resumoMemoria = typeof parsed?.resumo_memoria === 'string' && parsed.resumo_memoria.trim()
    ? parsed.resumo_memoria.trim()
    : respostaWhatsapp.slice(0, 300);
  const tags = Array.isArray(parsed?.tags) && parsed.tags.length === 5
    ? parsed.tags.filter((t: any) => typeof t === 'string')
    : [];

  await prisma.harveyConsult.create({
    data: {
      userId,
      numberId,
      contexto: contexto ?? 'pessoal',
      topico,
      pergunta: truncate(situacao, 2000),
      resposta: resumoMemoria,
      tags,
      status: 'draft',
    },
  });

  await reply(`${respostaWhatsapp}\n\n_Quer que eu registre isso pra memória? Responda *sim* pra registrar._`);
  return true;
}
