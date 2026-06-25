import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../lib/prisma';

/**
 * Agente de Suporte Inteligente — núcleo (MÓDULO 1 + 2 do briefing).
 *
 * Fluxo: classifica a mensagem, busca contexto na base de conhecimento (RAG por
 * palavra-chave no MVP) e gera um rascunho de resposta. NADA é enviado aqui — o
 * rascunho fica num SupportAtendimento aguardando aprovação humana.
 */

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Modelo configurável; default no Sonnet 4 mais recente. Cadeia de fallback cobre
// indisponibilidade pontual de um id específico.
const AGENT_MODELS = [
  process.env.SUPPORT_AGENT_MODEL || 'claude-sonnet-4-6',
  'claude-sonnet-4-20250514',
  'claude-haiku-4-5',
].filter((v, i, a) => a.indexOf(v) === i);

export type Canal = 'whatsapp' | 'email' | 'chat';

export interface ClassificacaoAtendimento {
  categoria:
    | 'duvida_produto' | 'problema_tecnico' | 'reclamacao' | 'cancelamento'
    | 'upgrade_plano' | 'cobranca' | 'elogio' | 'spam' | 'outro';
  prioridade: 'baixa' | 'media' | 'alta' | 'urgente';
  sentimento: 'positivo' | 'neutro' | 'negativo' | 'frustrado';
  requer_escalacao: boolean;
  confianca_resposta: number; // 0–100
  topicos_identificados: string[];
  sugestao_faq: string | null;
}

export interface AgentResult {
  classificacao: ClassificacaoAtendimento;
  rascunho: string;
  contextoUsado: string;
}

const SYSTEM_PROMPT = `Você é o assistente de suporte do ZapScript.me — SaaS de conversão automática de áudios do WhatsApp com IA.

Diretrizes:
- Tom: profissional, cordial, direto e humano (nunca robótico).
- Idioma: português brasileiro.
- Nunca inventar informações — se a base de conhecimento não cobrir, defina requer_escalacao=true e gere um rascunho que peça mais detalhes sem prometer nada.
- Nunca prometer funcionalidades não confirmadas na base nem discutir preços não confirmados.
- Sempre oferecer um próximo passo concreto ao cliente.
- Máximo 3 parágrafos por resposta (exceto tutoriais técnicos).
- Personalizar com o nome do cliente quando disponível.

Você recebe a mensagem do cliente, a base de conhecimento relevante e o histórico (quando houver).
Responda SOMENTE com um objeto JSON válido, sem markdown, no formato:
{
  "categoria": "duvida_produto|problema_tecnico|reclamacao|cancelamento|upgrade_plano|cobranca|elogio|spam|outro",
  "prioridade": "baixa|media|alta|urgente",
  "sentimento": "positivo|neutro|negativo|frustrado",
  "requer_escalacao": boolean,
  "confianca_resposta": number (0-100, sua confiança de que o rascunho resolve),
  "topicos_identificados": ["..."],
  "sugestao_faq": "título de novo tópico FAQ se a pergunta não estiver bem coberta, senão null",
  "rascunho": "texto da resposta pronta para enviar ao cliente"
}`;

// ── Base de conhecimento (RAG por palavra-chave no MVP) ─────────────────────
function tokenize(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 4); // ignora palavras curtas/stopwords
}

export async function retrieveKnowledge(message: string, limit = 3) {
  const all = await prisma.knowledgeBase.findMany({
    where: { aprovadoPorAdmin: true },
    select: { id: true, titulo: true, conteudo: true, categoria: true, tags: true },
  }).catch(() => [] as any[]);

  if (!all.length) return [] as any[];

  const terms = new Set(tokenize(message));
  if (!terms.size) return [] as any[];

  const scored = all.map((kb: any) => {
    const hay = tokenize(`${kb.titulo} ${kb.conteudo} ${(kb.tags || []).join(' ')}`);
    let score = 0;
    for (const t of hay) if (terms.has(t)) score++;
    // título pesa mais
    for (const t of tokenize(kb.titulo)) if (terms.has(t)) score += 2;
    return { kb, score };
  }).filter((s: { score: number }) => s.score > 0);

  scored.sort((a: { score: number }, b: { score: number }) => b.score - a.score);
  return scored.slice(0, limit).map((s: { kb: any }) => s.kb);
}

// ── Regras de escalação automática (MÓDULO 1) ───────────────────────────────
const ESCALATION_KEYWORDS = ['reembolso', 'processo', 'procon', 'cancelar', 'cancelamento', 'advogado', 'reclame aqui'];

function applyEscalationRules(c: ClassificacaoAtendimento, message: string): boolean {
  if (c.requer_escalacao) return true;
  if (c.confianca_resposta < 70) return true;
  if (['cancelamento', 'cobranca'].includes(c.categoria)) return true;
  if (c.categoria === 'reclamacao' && (c.sentimento === 'frustrado' || c.prioridade === 'urgente')) return true;
  if (c.sentimento === 'frustrado' && c.prioridade === 'alta') return true;
  const lower = message.toLowerCase();
  if (ESCALATION_KEYWORDS.some(k => lower.includes(k))) return true;
  return false;
}

function extractJson(text: string): any {
  // Modelo às vezes embrulha em ```json — extrai o primeiro objeto {...}
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Resposta do agente sem JSON');
  return JSON.parse(match[0]);
}

export interface RunAgentInput {
  message: string;
  clienteNome?: string | null;
  instrucaoRevisao?: string | null; // quando o admin pede nova versão
  historico?: string | null;        // mensagens anteriores da mesma thread
}

export async function runSupportAgent(input: RunAgentInput): Promise<AgentResult> {
  const kb = await retrieveKnowledge(input.message);
  const contextoUsado = kb.map((k: any) => k.titulo).join(' | ') || 'Nenhum (base sem cobertura)';

  const kbBlock = kb.length
    ? kb.map((k: any, i: number) => `[${i + 1}] ${k.titulo}\n${k.conteudo}`).join('\n\n')
    : '(nenhum tópico relevante encontrado na base de conhecimento)';

  const userBlock = [
    input.clienteNome ? `Nome do cliente: ${input.clienteNome}` : null,
    input.historico ? `Histórico recente:\n${input.historico}` : null,
    `Base de conhecimento relevante:\n${kbBlock}`,
    input.instrucaoRevisao
      ? `INSTRUÇÃO DO ADMIN para refazer o rascunho: ${input.instrucaoRevisao}`
      : null,
    `Mensagem do cliente:\n"""${input.message}"""`,
  ].filter(Boolean).join('\n\n');

  let lastErr: any;
  for (const model of AGENT_MODELS) {
    try {
      const res = await claude.messages.create({
        model,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userBlock }],
      });
      const text = res.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('');
      const parsed = extractJson(text);

      const classificacao: ClassificacaoAtendimento = {
        categoria: parsed.categoria ?? 'outro',
        prioridade: parsed.prioridade ?? 'media',
        sentimento: parsed.sentimento ?? 'neutro',
        requer_escalacao: !!parsed.requer_escalacao,
        confianca_resposta: typeof parsed.confianca_resposta === 'number' ? parsed.confianca_resposta : 0,
        topicos_identificados: Array.isArray(parsed.topicos_identificados) ? parsed.topicos_identificados : [],
        sugestao_faq: parsed.sugestao_faq || null,
      };
      classificacao.requer_escalacao = applyEscalationRules(classificacao, input.message);

      // marca contexto como usado (incrementa uso) — aprendizado leve
      if (kb.length) {
        prisma.knowledgeBase.updateMany({
          where: { id: { in: kb.map((k: any) => k.id) } },
          data: { vezesUtilizado: { increment: 1 } },
        }).catch(() => null);
      }

      return {
        classificacao,
        rascunho: parsed.rascunho || 'Olá! Recebemos sua mensagem e um de nossos atendentes vai te responder em breve.',
        contextoUsado,
      };
    } catch (err: any) {
      lastErr = err;
      // tenta o próximo modelo da cadeia
    }
  }

  throw new Error(`Agente de suporte falhou em todos os modelos: ${lastErr?.message ?? 'erro desconhecido'}`);
}
