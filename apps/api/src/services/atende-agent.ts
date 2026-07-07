import Anthropic from '@anthropic-ai/sdk';

/**
 * ZapScript Atende — núcleo do agente MULTI-TENANT.
 *
 * Versão generalizada do support-agent.ts: em vez de um SYSTEM_PROMPT hardcoded
 * para "o suporte do ZapScript", recebe a configuração do TENANT (o assinante) —
 * descrição do negócio, tom de voz e categorias sensíveis próprias — e classifica
 * a mensagem de um CLIENTE DO ASSINANTE, gerando um rascunho de resposta.
 *
 * NADA é enviado aqui. A decisão de auto-envio (verde) × fila (amarelo/vermelho) ×
 * spam fica no atende-intake, que aplica os guardrails do tenant + o piso jurídico.
 */

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const AGENT_MODELS = [
  process.env.ATENDE_AGENT_MODEL || process.env.SUPPORT_AGENT_MODEL || 'claude-sonnet-4-6',
  'claude-sonnet-4-20250514',
  'claude-haiku-4-5',
].filter((v, i, a) => a.indexOf(v) === i);

export type AtendeCategoria =
  | 'duvida' | 'agendamento' | 'orcamento_preco' | 'reclamacao'
  | 'juridico' | 'financeiro' | 'elogio' | 'spam' | 'outro';

export interface AtendeClassificacao {
  categoria: AtendeCategoria;
  urgencia: 'baixa' | 'media' | 'alta';
  sentimento: 'positivo' | 'neutro' | 'negativo' | 'frustrado';
  confianca_resposta: number;      // 0–100
  topicos_identificados: string[]; // temas/assuntos detectados (usados no match de sensíveis)
  pendencias: { descricao: string; urgencia: 'baixa' | 'media' | 'alta' }[];
}

export interface AtendeTenantConfig {
  negocioDescricao?: string | null;   // "Sou dentista, atendo clínica geral em SP"
  toneOverride?: string | null;       // tom de voz customizado
  categoriasSensiveis?: string[];     // cadastro livre por tenant
}

export interface AtendeAgentResult {
  classificacao: AtendeClassificacao;
  rascunho: string;
}

/**
 * Piso jurídico/financeiro NÃO-DESLIGÁVEL — mesmo espírito do guardrail do
 * support-agent. Independentemente da config do tenant, casos que batem aqui
 * NUNCA são auto-enviados (o assinante pode ADICIONAR categorias sensíveis,
 * nunca remover este piso).
 */
export const JURIDICO_FINANCEIRO_FLOOR = [
  'reembolso', 'estorno', 'chargeback', 'processo', 'procon', 'advogado',
  'reclame aqui', 'consumidor.gov', 'senacon', 'tribunal', 'delegacia',
  'judicial', 'notificacao', 'notificação', 'notificar', 'fraude', 'golpe',
  'propaganda enganosa', 'cobranca indevida', 'cobrança indevida',
  'nao autorizei', 'não autorizei', 'quero meu dinheiro', 'devolver o valor',
  'vou processar', 'meus direitos', 'codigo de defesa', 'código de defesa',
];

// ── util: normaliza para match tolerante a acento/caixa ──────────────────────
export function normalize(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function buildSystemPrompt(cfg: AtendeTenantConfig): string {
  const negocio = cfg.negocioDescricao?.trim()
    || 'um profissional/negócio que atende clientes pelo WhatsApp';
  const tom = cfg.toneOverride?.trim()
    || 'cordial, direto e humano (nunca robótico)';

  return `Você é o assistente de atendimento ao cliente de ${negocio}.
Você responde, pelo WhatsApp, mensagens dos CLIENTES desse negócio — em nome do negócio, não do ZapScript.

Diretrizes:
- Tom: ${tom}.
- Idioma: português brasileiro.
- RESPOSTAS CURTAS E OBJETIVAS, no estilo de quem digita no WhatsApp: 2 a 4 frases curtas, direto ao ponto. Sem saudação longa nem despedida formal.
- Uma resposta = uma ideia principal + um próximo passo concreto.
- NUNCA invente informações, preços, prazos, disponibilidade ou políticas que você não tenha certeza. Se faltar informação, baixe a confiança e gere um rascunho curto que peça o dado que falta, sem prometer nada.
- NUNCA feche negócio, confirme agendamento, prometa valores/descontos ou assuma compromisso jurídico/financeiro em nome do negócio — isso é sempre para um humano revisar.
- Extraia PENDÊNCIAS: o que o cliente precisa/pediu que exija ação do negócio (retorno, orçamento, agendamento, documento).

Você recebe a mensagem do cliente e (quando houver) um resumo da conversa até aqui.
Responda SOMENTE com um objeto JSON válido, sem markdown, no formato:
{
  "categoria": "duvida|agendamento|orcamento_preco|reclamacao|juridico|financeiro|elogio|spam|outro",
  "urgencia": "baixa|media|alta",
  "sentimento": "positivo|neutro|negativo|frustrado",
  "confianca_resposta": number (0-100, sua confiança de que o rascunho resolve sozinho, sem humano),
  "topicos_identificados": ["temas/assuntos curtos detectados na mensagem"],
  "pendencias": [{"descricao": "ação pendente do negócio, curta", "urgencia": "baixa|media|alta"}],
  "rascunho": "texto da resposta pronta para enviar ao cliente"
}`;
}

function extractJson(text: string): any {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Resposta do agente sem JSON');
  return JSON.parse(match[0]);
}

export interface RunAtendeInput {
  message: string;
  config: AtendeTenantConfig;
  clienteNome?: string | null;
  resumoConversa?: string | null;    // resumo acumulado da conversa (não histórico bruto)
  instrucaoRevisao?: string | null;  // quando o assinante pede nova versão do rascunho
}

export async function runAtendeAgent(input: RunAtendeInput): Promise<AtendeAgentResult> {
  const system = buildSystemPrompt(input.config);

  const userBlock = [
    input.clienteNome ? `Nome do cliente: ${input.clienteNome}` : null,
    input.resumoConversa ? `Resumo da conversa até aqui:\n${input.resumoConversa}` : null,
    input.instrucaoRevisao ? `INSTRUÇÃO do assinante para refazer o rascunho: ${input.instrucaoRevisao}` : null,
    `Mensagem do cliente:\n"""${input.message}"""`,
  ].filter(Boolean).join('\n\n');

  let lastErr: any;
  for (const model of AGENT_MODELS) {
    try {
      const res = await claude.messages.create({
        model,
        max_tokens: 1024,
        system,
        messages: [{ role: 'user', content: userBlock }],
      });
      const text = res.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('');
      const parsed = extractJson(text);

      const classificacao: AtendeClassificacao = {
        categoria: parsed.categoria ?? 'outro',
        urgencia: ['baixa', 'media', 'alta'].includes(parsed.urgencia) ? parsed.urgencia : 'baixa',
        sentimento: parsed.sentimento ?? 'neutro',
        confianca_resposta: typeof parsed.confianca_resposta === 'number' ? parsed.confianca_resposta : 0,
        topicos_identificados: Array.isArray(parsed.topicos_identificados) ? parsed.topicos_identificados.map(String) : [],
        pendencias: Array.isArray(parsed.pendencias)
          ? parsed.pendencias
              .filter((p: any) => p && p.descricao)
              .map((p: any) => ({
                descricao: String(p.descricao),
                urgencia: ['baixa', 'media', 'alta'].includes(p.urgencia) ? p.urgencia : 'baixa',
              }))
          : [],
      };

      return {
        classificacao,
        rascunho: parsed.rascunho || 'Oi! Recebi sua mensagem e já te retorno.',
      };
    } catch (err: any) {
      lastErr = err;
    }
  }

  throw new Error(`Atende agent falhou em todos os modelos: ${lastErr?.message ?? 'erro desconhecido'}`);
}

/**
 * Reescreve um rascunho existente segundo a instrução do assinante.
 *
 * Minimização de dados: o Atende NÃO guarda a mensagem bruta do cliente, então a
 * regeração parte do próprio rascunho (não reclassifica o original) — o assinante
 * ajusta tom/conteúdo do rascunho já gerado.
 */
export async function rewriteDraft(
  rascunho: string,
  instrucao: string,
  cfg: AtendeTenantConfig,
): Promise<string> {
  const tom = cfg.toneOverride?.trim() || 'cordial, direto e humano';
  const system = `Você reescreve respostas de atendimento ao cliente por WhatsApp em PT-BR.
Tom: ${tom}. Mantenha curto e objetivo (2 a 4 frases). NÃO invente informações novas.
Responda SOMENTE com o texto final da mensagem, sem aspas nem comentários.`;
  const user = `Rascunho atual:\n"""${rascunho}"""\n\nInstrução do assinante: ${instrucao}`;

  for (const model of AGENT_MODELS) {
    try {
      const res = await claude.messages.create({
        model, max_tokens: 512, system,
        messages: [{ role: 'user', content: user }],
      });
      const text = res.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim();
      if (text) return text;
    } catch { /* tenta próximo modelo */ }
  }
  return rascunho; // falha → mantém o rascunho atual
}

/**
 * Decide se uma mensagem toca em CATEGORIA SENSÍVEL:
 *   - piso jurídico/financeiro (não-desligável), OU
 *   - alguma categoria sensível cadastrada pelo tenant (match por categoria,
 *     tópico identificado ou palavra na própria mensagem).
 * Casos sensíveis NUNCA são auto-enviados, mesmo com autoEnvioAtivo=true.
 */
export function isSensitive(
  classificacao: AtendeClassificacao,
  message: string,
  categoriasSensiveis: string[] = [],
): boolean {
  const hayParts = [
    classificacao.categoria,
    ...classificacao.topicos_identificados,
    message,
  ];
  const hay = normalize(hayParts.join(' '));

  // Piso não-desligável
  if (JURIDICO_FINANCEIRO_FLOOR.some(k => hay.includes(normalize(k)))) return true;

  // Categorias jurídico/financeiro são sempre sensíveis por natureza
  if (classificacao.categoria === 'juridico' || classificacao.categoria === 'financeiro') return true;

  // Cadastro livre do tenant
  for (const raw of categoriasSensiveis) {
    const term = normalize(raw).trim();
    if (term && hay.includes(term)) return true;
  }
  return false;
}

/**
 * Regra de autonomia (verde/amarelo/vermelho/spam), generalizada do
 * applyEscalationRules do support-agent:
 *   - spam            → status 'spam' (não responde)
 *   - sensível        → sempre escala (vermelho)
 *   - confiança < 70  → escala (amarelo)
 *   - sentimento frustrado + urgência alta → escala
 *   - caso contrário  → verde (elegível a auto-envio SE autoEnvioAtivo=true)
 */
export function decideAutonomia(
  classificacao: AtendeClassificacao,
  message: string,
  categoriasSensiveis: string[] = [],
): { spam: boolean; sensivel: boolean; requerEscalacao: boolean } {
  const spam = classificacao.categoria === 'spam';
  const sensivel = isSensitive(classificacao, message, categoriasSensiveis);

  let requerEscalacao = sensivel;
  if (classificacao.confianca_resposta < 70) requerEscalacao = true;
  if (classificacao.sentimento === 'frustrado' && classificacao.urgencia === 'alta') requerEscalacao = true;
  if (classificacao.categoria === 'reclamacao' && classificacao.sentimento === 'frustrado') requerEscalacao = true;

  return { spam, sensivel, requerEscalacao };
}
