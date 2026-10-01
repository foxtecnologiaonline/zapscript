import { logger } from '../lib/logger';
import { buildModelChain, callAiWithFallback, type ModelSpec } from './ai-fallback';

/**
 * ZapMonney — classifica a mensagem que a pessoa mandou para o número do
 * assistente financeiro e extrai os dados estruturados do lançamento.
 *
 * Risco assimétrico INVERTIDO em relação ao Comando de Voz (voice-command-agent.ts):
 * lá a pessoa falava com o próprio bloco de notas e silêncio era o default seguro.
 * Aqui ela está falando COM o assistente e espera resposta — silêncio é bug. Por
 * isso o limiar é mais baixo e 'none' cai em ajuda, nunca em nada.
 *
 * Nenhum lançamento é gravado direto por esta classificação: tudo passa por
 * confirmação explícita (ver zapmonney-executor.ts), então um valor extraído
 * errado é corrigido pela pessoa antes de virar saldo.
 */

// Cadeia multimodelo desde o início. ZAPMONNEY_AGENT_MODEL aceita LISTA separada
// por vírgula ("claude-haiku-4-5,claude-sonnet-5") — empilhar ou trocar modelo é
// editar o .env do servidor e restartar, sem deploy. Provedor sem API key cai
// fora da cadeia sozinho; AI_SKIP_PROVIDERS desliga um provedor inteiro.
const ANTHROPIC_MODELS = (process.env.ZAPMONNEY_AGENT_MODEL || 'claude-haiku-4-5')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);

const AGENT_MODELS: ModelSpec[] = buildModelChain({
  anthropic:   ANTHROPIC_MODELS,
  openaiModel: process.env.ZAPMONNEY_AGENT_MODEL_OPENAI || 'gpt-4o-mini',
  groqModel:   process.env.ZAPMONNEY_AGENT_MODEL_GROQ   || 'llama-3.3-70b-versatile',
  geminiModel: process.env.ZAPMONNEY_AGENT_MODEL_GEMINI || 'gemini-2.5-flash',
});

// Mais baixo que o Comando de Voz (70): aqui a mensagem é endereçada ao
// assistente, então "não entendi" já é a resposta certa para o resto.
const CONFIDENCE_THRESHOLD = 50;

/** Categorias fixas do MVP — sem customização, logo sem tabela. */
export const ZM_CATEGORIES = [
  'Alimentação',
  'Transporte',
  'Moradia',
  'Saúde',
  'Educação',
  'Lazer',
  'Compras',
  'Serviços',
  'Receita',
  'Outros',
] as const;

export type ZmCategory = (typeof ZM_CATEGORIES)[number];

export type ZmIntent =
  | 'add_expense'
  | 'add_income'
  | 'confirm'
  | 'cancel'
  | 'correct'
  | 'query_balance'
  | 'query_summary'
  | 'list_recent'
  | 'delete_last'
  | 'delete_account'
  | 'help'
  | 'none';

export interface ZmIntentResult {
  intent: ZmIntent;
  confidence: number;
  data: {
    valor?: number;
    categoria?: string;
    descricao?: string;
    /** 'YYYY-MM-DD' no fuso de São Paulo */
    data?: string;
    /** filtro de consulta: 'mes_atual' | 'mes_passado' | categoria livre */
    periodo?: string;
    filtroCategoria?: string;
  };
}

const ALL_INTENTS: ZmIntent[] = [
  'add_expense', 'add_income', 'confirm', 'cancel', 'correct', 'query_balance',
  'query_summary', 'list_recent', 'delete_last', 'delete_account', 'help', 'none',
];

/**
 * Atalho sem IA para as respostas mais frequentes do produto ("sim", "não").
 * Quando existe um lançamento aguardando confirmação, essas duas palavras são
 * a maior fatia do tráfego — resolver por regex corta a maior parte do custo
 * de LLM do ZapMonney. Só se aplica a mensagens curtas e exatas: qualquer coisa
 * além disso ("sim, mas era 80") vai para o modelo decidir.
 */
export function matchQuickReply(text: string): 'confirm' | 'cancel' | null {
  const t = text.trim().toLowerCase().replace(/[.!]+$/, '');
  if (/^(sim|s|isso|ok|confirma|confirmo|certo|correto|exato|pode|positivo|👍|✅)$/.test(t)) return 'confirm';
  if (/^(n[ãa]o|n|nao|cancela|cancelar|errado|esquece|negativo|👎|❌)$/.test(t)) return 'cancel';
  return null;
}

function buildSystemPrompt(todayBrt: string, hasPending: boolean): string {
  return `Você é o ZapMonney, assistente financeiro pessoal que conversa por WhatsApp. Sua função é classificar a mensagem da pessoa e extrair dados estruturados.

Hoje é ${todayBrt} (fuso de São Paulo). Use essa data para resolver referências relativas: "hoje" = ${todayBrt}, "ontem" = o dia anterior, "dia 5" = dia 5 do mês corrente (ou do mês passado, se o dia 5 ainda não chegou neste mês).

${hasPending
  ? 'ATENÇÃO: existe um lançamento aguardando confirmação desta pessoa. Se a mensagem confirmar ("sim", "isso", "pode"), use "confirm". Se recusar ("não", "cancela"), use "cancel". Se corrigir algum dado ("era 80", "foi no transporte", "foi ontem"), use "correct" e extraia SÓ os campos citados.'
  : 'Não há lançamento aguardando confirmação, então "confirm", "cancel" e "correct" são improváveis nesta mensagem.'}

Tipos possíveis:

1. "add_expense" — registrar uma saída de dinheiro. Ex.: "gastei 50 no mercado", "almoço 32,90", "paguei 120 de luz", "uber 18".
   → dados: valor (número, em reais), categoria (uma das categorias abaixo), descricao (curta, o que foi), data ("YYYY-MM-DD").

2. "add_income" — registrar uma entrada de dinheiro. Ex.: "recebi 3000 de salário", "entrou 500 do freela".
   → dados: valor, categoria ("Receita"), descricao, data.

3. "confirm" — confirma o lançamento pendente. → dados: {}.

4. "cancel" — descarta o lançamento pendente. → dados: {}.

5. "correct" — corrige o lançamento pendente. → dados: apenas os campos corrigidos (valor, categoria, descricao e/ou data).

6. "query_balance" — pergunta saldo/balanço de um período. Ex.: "qual meu saldo", "como tá o mês", "quanto sobrou".
   → dados: periodo ("mes_atual" ou "mes_passado").

7. "query_summary" — pergunta quanto gastou, no total ou numa categoria. Ex.: "quanto gastei esse mês", "quanto foi de comida", "gastos de transporte no mês passado".
   → dados: periodo ("mes_atual" ou "mes_passado"), filtroCategoria (uma das categorias, só se a pessoa citou uma).

8. "list_recent" — pede a lista dos últimos lançamentos. Ex.: "meus últimos gastos", "o que eu lancei hoje", "extrato".
   → dados: {}.

9. "delete_last" — apagar o último lançamento já confirmado. Ex.: "apaga o último", "exclui o último lançamento".
   → dados: {}.

10. "delete_account" — apagar TODOS os dados/conta (direito LGPD). Ex.: "apaga meus dados", "quero excluir minha conta", "me esquece".
    → dados: {}.

11. "help" — pede ajuda, instruções, ou pergunta o que você faz. Ex.: "como funciona", "o que você faz", "ajuda", "menu".
    → dados: {}.

12. "none" — nada acima se aplica, ou está ambíguo demais para agir.
    → dados: {}.

Categorias válidas (use EXATAMENTE uma destas em "categoria"): ${ZM_CATEGORIES.join(', ')}.
Escolha "Outros" quando nenhuma encaixar, e "Receita" sempre que o tipo for add_income.

Regras de valor: devolva número puro em reais, ponto como separador decimal, sem símbolo nem separador de milhar. "32,90" → 32.9. "1.200" → 1200. "2 mil" → 2000. "cinquenta reais" → 50.

Responda SOMENTE com um objeto JSON válido, sem markdown, no formato:
{
  "intent": "<um dos tipos acima>",
  "confianca": number (0-100),
  "dados": { ... campos do tipo escolhido ... }
}`;
}

/** Normaliza a categoria devolvida pelo modelo para um valor de ZM_CATEGORIES. */
export function normalizeCategory(raw: unknown, type: 'expense' | 'income'): ZmCategory {
  if (type === 'income') return 'Receita';
  if (typeof raw !== 'string') return 'Outros';
  const needle = raw.trim().toLowerCase();
  const hit = ZM_CATEGORIES.find((c) => c.toLowerCase() === needle);
  return hit ?? 'Outros';
}

/** Aceita número ou string ("32,90", "R$ 1.200,50") e devolve número em reais. */
export function parseAmount(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null;
  if (typeof raw !== 'string') return null;

  const cleaned = raw.replace(/[^\d.,-]/g, '');
  if (!cleaned) return null;

  // Convenção pt-BR: a vírgula é decimal, o ponto é milhar. Sem vírgula, um
  // ponto só é decimal quando sobram 1-2 casas depois dele ("18.50"); "1.200"
  // é mil e duzentos.
  let normalized: string;
  if (cleaned.includes(',')) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    const parts = cleaned.split('.');
    normalized = parts.length > 1 && parts[parts.length - 1].length <= 2
      ? cleaned
      : cleaned.replace(/\./g, '');
  }

  const n = parseFloat(normalized);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function classifyZapMonneyMessage(
  rawText: string,
  opts: { todayBrt: string; hasPending: boolean; userId?: string },
): Promise<ZmIntentResult> {
  const fallback: ZmIntentResult = { intent: 'none', confidence: 0, data: {} };
  if (!rawText || rawText.trim().length < 2) return fallback;

  try {
    const parsed = await callAiWithFallback({
      models:    AGENT_MODELS,
      system:    buildSystemPrompt(opts.todayBrt, opts.hasPending),
      user:      `Mensagem da pessoa:\n"""${rawText}"""`,
      maxTokens: 400,
      // Só loga AiUsageLog quando o ZmUser está vinculado a uma conta ZapScript —
      // AiUsageLog.userId tem FK dura para User, e a maioria dos usuários do
      // ZapMonney não é cliente. O custo agregado é contado no Redis (ver router).
      userId:    opts.userId,
      feature:   'zapmonney',
      label:     '[ZapMonney]',
    });

    const confidence = typeof parsed.confianca === 'number' ? parsed.confianca : 0;
    const intent: ZmIntent = ALL_INTENTS.includes(parsed.intent) ? parsed.intent : 'none';

    if (confidence < CONFIDENCE_THRESHOLD) return fallback;

    const dados = parsed.dados ?? {};
    const valor = parseAmount(dados.valor);

    return {
      intent,
      confidence,
      data: {
        ...dados,
        valor: valor ?? undefined,
      },
    };
  } catch (err: any) {
    logger.warn(`[ZapMonney] Classificação falhou em todos os modelos: ${err.message} — default 'none'`);
    return fallback;
  }
}
