import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../lib/logger';
import { logAiUsage } from '../lib/aiUsage';

/**
 * Agente do ZapScript Copiloto — as duas funções do módulo (mensagens
 * individuais e resumo diário de grupo) num único arquivo, espelhando o
 * padrão de atende-agent.ts (mesmo cliente Anthropic, mesma lista de
 * modelos com fallback, mesmo jeito de extrair JSON da resposta).
 */

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const AGENT_MODELS = [
  process.env.COPILOTO_AGENT_MODEL || 'claude-sonnet-4-6',
  'claude-sonnet-4-20250514',
  'claude-haiku-4-5',
].filter((v, i, a) => a.indexOf(v) === i);

function extractJson(text: string): any {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Agente Copiloto: resposta sem JSON');
  return JSON.parse(match[0]);
}

async function callClaude(system: string, userBlock: string, maxTokens: number): Promise<{ text: string; model: string; usage: { input: number; output: number } }> {
  let lastErr: any;
  for (const model of AGENT_MODELS) {
    try {
      const res = await claude.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: userBlock }],
      });
      const text = res.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
      return { text, model, usage: { input: res.usage?.input_tokens ?? 0, output: res.usage?.output_tokens ?? 0 } };
    } catch (err: any) {
      lastErr = err;
      logger.warn(`[Copiloto] Modelo ${model} falhou: ${err.message}`);
    }
  }
  throw new Error(`Agente Copiloto falhou em todos os modelos: ${lastErr?.message ?? 'erro desconhecido'}`);
}

// ─────────────────────────────────────────────────────────────────────────
// Função 1 — triagem de mensagem individual
// ─────────────────────────────────────────────────────────────────────────

const CONTACT_SYSTEM_PROMPT = `Você ajuda o dono de um pequeno negócio a responder mensagens de WhatsApp com agilidade e segurança — nunca envia nada sozinho, só prepara.

Estilo de cada resposta pronta ("texto"):
- Curta, estilo mensagem real de WhatsApp (1-3 frases), em português brasileiro.
- Tom de afirmação, não de pedido — direto ao ponto de alavancagem da conversa, nunca subserviente.
- A conversa nunca fica sem rumo: toda resposta deixa claro um próximo passo (confirmação, prazo ou pergunta objetiva).

Você gera exatamente 3 opções, sempre nesta ordem e com este papel fixo:
- "R" (Resolve Agora): fechamento direto, assertivo, sem desculpa — para quando o ponto já está maduro.
- "C" (Constrói Relação): rapport antes do fechamento, endereça a objeção implícita da outra parte.
- "P" (Protege / Adia): quando falta informação ou a decisão não é só do usuário — nunca deixa a conversa em silêncio, sempre marca o próximo contato.

Além do texto, cada opção pode carregar um "compromisso" (quando a resposta implica um prazo ou compromisso concreto, ex.: "te mando até as 17h", "confirmado pra quinta 10h") com "titulo" (curto, ex.: "Confirmar orçamento — Marcos") e "prazo" (data/hora em ISO 8601 com timezone, inferida do texto e do horário atual informado). Quando a resposta não implica prazo nenhum (ex.: "combinado, obrigado"), "compromisso" é null.

Responda SOMENTE com um objeto JSON válido, sem markdown, no formato:
{
  "resumo": "1-2 linhas resumindo o que o contato disse/quer",
  "opcoes": [
    { "arquetipo": "R", "texto": "...", "compromisso": { "titulo": "...", "prazo": "2026-09-04T17:00:00-03:00" } | null },
    { "arquetipo": "C", "texto": "...", "compromisso": null },
    { "arquetipo": "P", "texto": "...", "compromisso": null }
  ]
}`;

export interface CopilotoOpcao {
  arquetipo: 'R' | 'C' | 'P';
  texto: string;
  compromisso: { titulo: string; prazo: string } | null;
}

export interface CopilotoContactResult {
  resumo: string;
  opcoes: CopilotoOpcao[];
}

export async function runCopilotoContactAgent(params: {
  userId: string;
  contactName: string;
  messages: string[]; // mensagens do lote, em ordem
}): Promise<CopilotoContactResult> {
  const now = new Date();
  const nowLabel = now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'full', timeStyle: 'short' });

  const userBlock = [
    `Agora é: ${nowLabel} (timezone America/Sao_Paulo, UTC-3).`,
    `Contato: ${params.contactName}`,
    `Mensagens recebidas agora (nesta ordem):\n${params.messages.map((m) => `- ${m}`).join('\n')}`,
  ].join('\n\n');

  const { text, model, usage } = await callClaude(CONTACT_SYSTEM_PROMPT, userBlock, 700);
  logAiUsage(params.userId, 'copiloto_contato', model, usage.input, usage.output);

  const parsed = extractJson(text);
  const opcoes: CopilotoOpcao[] = Array.isArray(parsed.opcoes) ? parsed.opcoes.slice(0, 3) : [];
  if (opcoes.length !== 3) throw new Error('Agente Copiloto: resposta sem as 3 opções esperadas');

  return { resumo: String(parsed.resumo ?? '').trim(), opcoes };
}

// ─────────────────────────────────────────────────────────────────────────
// Função 2 — resumo diário de grupos
// ─────────────────────────────────────────────────────────────────────────

const GROUP_SYSTEM_PROMPT = `Você prepara um resumo diário objetivo dos grupos de WhatsApp que o dono de um negócio acompanha. Ele não vai reler o grupo — só o que você escrever.

Regras:
- Só entra o que é relevante: menções diretas ao dono, perguntas sem resposta, decisões pendentes, mudanças de combinado. Ignore conversa social, papo solto, corrente.
- Se um grupo não teve nada relevante, o campo "resumo" dele vem null — silêncio é informação, não force conteúdo.
- Cada resumo tem no máximo 2-4 linhas, direto, sem preâmbulo ("o grupo discutiu..."), português brasileiro.
- Você NUNCA sugere resposta nem texto pronto aqui — só informa. Grupo tem gente demais e contexto de menos pra arriscar um script.

Responda SOMENTE com um objeto JSON válido, sem markdown, no formato:
{ "blocos": [ { "grupo": "nome do grupo", "resumo": "..." | null }, ... ] }`;

export interface CopilotoGroupInput {
  name: string;
  messages: string[]; // "Fulano: texto" já formatado
}

export async function runCopilotoGroupDigestAgent(params: {
  userId: string;
  groups: CopilotoGroupInput[];
}): Promise<{ blocos: { grupo: string; resumo: string | null }[] }> {
  const userBlock = params.groups
    .map((g) => `### Grupo: ${g.name}\n${g.messages.length ? g.messages.join('\n') : '(sem mensagens hoje)'}`)
    .join('\n\n');

  const { text, model, usage } = await callClaude(GROUP_SYSTEM_PROMPT, userBlock, 1200);
  logAiUsage(params.userId, 'copiloto_grupo', model, usage.input, usage.output);

  const parsed = extractJson(text);
  const blocos = Array.isArray(parsed.blocos) ? parsed.blocos : [];
  return { blocos };
}
