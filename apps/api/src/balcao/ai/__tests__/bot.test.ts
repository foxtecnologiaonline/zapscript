import { prisma } from '../../../lib/prisma';
import { clearBvEventHandlers } from '../../core/events';
import { clearChannelSenders, registerChannelSender } from '../../core/channels';
import { assignConversation, closeConversation } from '../../core/conversations';
import { listMessages, createMessage } from '../../core/messages';
import { clearBotTools, registerBotTool } from '../../core/tools';
import { getUsage } from '../../core/usage';
import { authHeader, makeOrg, makeUser } from '../../core/testing';
import { setLlmClient } from '../llm';
import { processInbound, startAiEngine, stopAiEngine, sweepIdleBotConversations } from '../bot';
import { handleAgentAssist, lastSuggestion } from '../assist';
import { buildAiApp, CERTIDAO, FakeLlm, getConv, groundedBot, ref, say, seedApproved } from './helpers';

const llm = new FakeLlm();
const sent: Array<{ conversationId: string; body: string | null; sender: string }> = [];
const bodies = (conversationId: string) => sent.filter((s) => s.conversationId === conversationId).map((s) => s.body ?? '');

beforeAll(() => {
  setLlmClient(llm);
  registerChannelSender('WEBCHAT', async (r) => { sent.push({ conversationId: r.conversation.id, body: r.message.body, sender: r.message.senderType }); return { channelMessageId: `o-${r.message.id}` }; });
});
afterAll(() => { stopAiEngine(); clearChannelSenders(); clearBotTools(); clearBvEventHandlers(); });
beforeEach(() => { llm.reset(); clearBotTools(); });

const progressive = (over: Record<string, unknown> = {}) => makeOrg({ ai: { enabled: true, mode: 'PROGRESSIVE', confidenceThreshold: 0.7, welcomeMessage: 'Olá! Sou o assistente virtual.', escalationKeywords: ['atendente', 'reclamação'], maxBotTurns: 4, ...over } });

describe('balcao/ai — chatbot PROGRESSIVE', () => {
  it('resposta ancorada: envia boas-vindas + resposta, grava aiMeta, atualiza a conversa e contabiliza uso; PII não chega ao LLM', async () => {
    const org = (await progressive()).id;
    const art = await seedApproved(org, CERTIDAO);
    const m = await say(org, ref(), 'Olá, meu CPF é 529.982.247-25 e meu e-mail joao@exemplo.com. Como solicito a segunda via da certidão de nascimento?');
    const a = await processInbound(m.payload);
    expect(a?.action).toBe('REPLY');
    // o LLM só viu o texto redigido
    const prompt = llm.calls[0].user;
    expect(prompt).not.toMatch(/529\.982|joao@exemplo/);
    expect(prompt).toContain('[CPF_1]'); expect(prompt).toContain(`[ID: ${art.id}]`);
    expect(llm.calls[0].tier).toBe('fast');
    // mensagem enviada
    const out = bodies(m.conversationId);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/^Olá! Sou o assistente virtual\.\n\nPara a segunda via/);
    const msgs = await listMessages(m.conversationId);
    const bot = msgs.find((x) => x.senderType === 'BOT')!;
    expect(bot.aiMeta).toMatchObject({ kind: 'ANSWER', intent: 'segunda_via_certidao', confidence: 0.92, kbArticleIds: [art.id], model: 'fake-fast', tokens: { in: 120, out: 30 } });
    const conv = await getConv(m.conversationId);
    expect(conv).toMatchObject({ status: 'BOT', intent: 'segunda_via_certidao', category: 'certidoes', botHandled: true, automatable: true });
    expect((await prisma.bvKbArticle.findUniqueOrThrow({ where: { id: art.id } })).useCount).toBe(1);
    expect(await getUsage(org, 'AI_CALLS', new Date(Date.now() - 86400_000), new Date())).toBe(1);
    expect(await getUsage(org, 'AI_TOKENS', new Date(Date.now() - 86400_000), new Date())).toBe(150);
  });

  it('JSON inválido → 1 retry → sucesso; inválido duas vezes → escala', async () => {
    const org = (await progressive()).id;
    await seedApproved(org, CERTIDAO);
    llm.queue.push('isto não é json');
    const m1 = await say(org, ref(), 'Como solicito a segunda via da certidão de nascimento?');
    expect((await processInbound(m1.payload))?.action).toBe('REPLY');
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1].user).toMatch(/resposta anterior foi inválida/);

    llm.calls = []; llm.queue.push('{"answer": 1', '{"confidence": "alta"}');
    const m2 = await say(org, ref(), 'Como solicito a segunda via da certidão de nascimento?');
    const a2 = await processInbound(m2.payload);
    expect(a2).toMatchObject({ action: 'ESCALATE', reason: 'LLM_INVALID' });
    expect(llm.calls).toHaveLength(2);
    const c = await getConv(m2.conversationId);
    expect(c.status).toBe('WAITING');
    expect(await prisma.bvConversationEvent.count({ where: { conversationId: m2.conversationId, type: 'ESCALATED' } })).toBe(1);
  });

  it('erro de rede no LLM → retry → escala com LLM_ERROR', async () => {
    const org = (await progressive()).id;
    llm.queue.push(new Error('boom'), new Error('boom'));
    const m = await say(org, ref(), 'Qual o prazo para pedir a certidão?');
    expect(await processInbound(m.payload)).toMatchObject({ action: 'ESCALATE', reason: 'LLM_ERROR' });
    expect((await getConv(m.conversationId)).status).toBe('WAITING');
  });

  it('baixa confiança escala (com aviso ao cidadão) e mantém a intenção para o atendente', async () => {
    const org = (await progressive()).id;
    await seedApproved(org, CERTIDAO);
    llm.queue.push((req) => groundedBot(req, { confidence: 0.4 }));
    const m = await say(org, ref(), 'Como solicito a segunda via da certidão de nascimento?');
    expect(await processInbound(m.payload)).toMatchObject({ action: 'ESCALATE', reason: 'LOW_CONFIDENCE' });
    const c = await getConv(m.conversationId);
    expect(c).toMatchObject({ status: 'WAITING', intent: 'segunda_via_certidao', automatable: true });
    expect(bodies(m.conversationId).join('|')).toMatch(/transferir você para um atendente/);
    expect(bodies(m.conversationId).join('|')).not.toMatch(/Para a segunda via/);
  });

  it('sem artigo na base → needsHuman → escala; id de artigo inventado é descartado (anti-alucinação)', async () => {
    const org = (await progressive()).id;
    const m1 = await say(org, ref(), 'Como funciona o parcelamento de custas?');
    expect(await processInbound(m1.payload)).toMatchObject({ action: 'ESCALATE', reason: 'LLM_NEEDS_HUMAN' });
    expect((await getConv(m1.conversationId)).automatable).toBe(false);

    llm.queue.push(JSON.stringify({ answer: 'O parcelamento é em 12x sem juros.', confidence: 0.99, intent: 'parcelamento', category: null, needsHuman: false, usedArticleIds: ['artigo-inexistente'], toolCall: null }));
    const m2 = await say(org, ref(), 'Posso parcelar as custas em quantas vezes?');
    const a2 = await processInbound(m2.payload);
    expect(a2).toMatchObject({ action: 'ESCALATE', reason: 'NO_ARTICLE' });
    expect(bodies(m2.conversationId).join('|')).not.toMatch(/12x/);
  });

  it('pedido de humano, palavra de escalonamento e sentimento muito negativo escalam SEM chamar o LLM', async () => {
    const org = (await progressive()).id;
    for (const [text, reason] of [['Quero falar com um atendente', 'HUMAN_REQUEST'], ['Tenho uma reclamação sobre o fórum', 'KEYWORD'], ['ISSO É UM ABSURDO!!! PÉSSIMO SERVIÇO, vergonha', 'NEGATIVE_SENTIMENT']] as const) {
      const m = await say(org, ref(), text);
      expect(await processInbound(m.payload)).toMatchObject({ action: 'ESCALATE', reason });
      expect((await getConv(m.conversationId)).status).toBe('WAITING');
    }
    expect(llm.calls).toHaveLength(0);
  });

  it('limite de turnos (maxBotTurns) escala antes de chamar o LLM', async () => {
    const org = (await progressive({ maxBotTurns: 2 })).id;
    await seedApproved(org, CERTIDAO);
    const r = ref();
    for (let i = 0; i < 2; i++) { const m = await say(org, r, `Como solicito a segunda via da certidão de nascimento? (${i})`); expect((await processInbound(m.payload))?.action).toBe('REPLY'); }
    const calls = llm.calls.length;
    const m3 = await say(org, r, 'E qual o prazo da taxa da certidão de nascimento?');
    expect(await processInbound(m3.payload)).toMatchObject({ action: 'ESCALATE', reason: 'MAX_TURNS' });
    expect(llm.calls).toHaveLength(calls);
  });

  it('só saudação não gasta LLM: responde com a mensagem de boas-vindas', async () => {
    const org = (await progressive()).id;
    const m = await say(org, ref(), 'Bom dia!');
    expect((await processInbound(m.payload))?.action).toBe('WELCOME');
    expect(bodies(m.conversationId)).toEqual(['Olá! Sou o assistente virtual.']);
    expect(llm.calls).toHaveLength(0);
  });

  it('só age em conversas BOT e é idempotente para eventos obsoletos', async () => {
    const org = (await progressive()).id;
    await seedApproved(org, CERTIDAO);
    const m = await say(org, ref(), 'Como solicito a segunda via da certidão de nascimento?');
    expect(await processInbound(m.payload)).not.toBeNull();
    expect(await processInbound(m.payload)).toBeNull(); // já respondida
    await prisma.bvConversation.update({ where: { id: m.conversationId }, data: { status: 'WAITING' } });
    const m2 = await say(org, (await prisma.bvConversation.findUniqueOrThrow({ where: { id: m.conversationId } })).channelRef!, 'mais uma pergunta sobre certidão');
    expect(await processInbound(m2.payload)).toBeNull();
  });

  it('IA desabilitada no órgão → bot não age', async () => {
    const org = (await makeOrg({ ai: { enabled: false } })).id;
    const m = await say(org, ref(), 'Como solicito a certidão?');
    expect(await processInbound(m.payload)).toBeNull();
  });

  it('cota BLOCK de AI_CALLS atingida → escala sem chamar o LLM', async () => {
    const org = (await progressive()).id;
    await prisma.bvQuota.create({ data: { orgId: org, item: 'AI_CALLS', period: 'MONTH', limit: 0n, action: 'BLOCK' } as any });
    const m = await say(org, ref(), 'Como solicito a certidão de nascimento?');
    expect(await processInbound(m.payload)).toMatchObject({ action: 'ESCALATE', reason: 'QUOTA' });
    expect(llm.calls).toHaveLength(0);
  });
});

describe('balcao/ai — modo ASSISTED (triagem)', () => {
  it('não responde ao cidadão: escala já com intent/category e guarda a sugestão para o atendente', async () => {
    const org = (await makeOrg({ ai: { enabled: true, mode: 'ASSISTED' } })).id;
    await seedApproved(org, CERTIDAO);
    const m = await say(org, ref(), 'Como solicito a segunda via da certidão de nascimento?');
    const a = await processInbound(m.payload);
    expect(a).toMatchObject({ action: 'ESCALATE', reason: 'ASSISTED_TRIAGE', mode: 'ASSISTED' });
    expect(bodies(m.conversationId)).toHaveLength(0);
    expect(await prisma.bvMessage.count({ where: { conversationId: m.conversationId, senderType: 'BOT' } })).toBe(0);
    const c = await getConv(m.conversationId);
    expect(c).toMatchObject({ status: 'WAITING', intent: 'segunda_via_certidao', category: 'certidoes', automatable: true });
    const s = await lastSuggestion(org, m.conversationId);
    expect(s).toMatchObject({ kind: 'TRIAGE', intent: 'segunda_via_certidao' });
    expect(s!.suggestion).toMatch(/Para a segunda via/);
    // o texto da sugestão fica cifrado no evento
    const ev = await prisma.bvConversationEvent.findFirstOrThrow({ where: { conversationId: m.conversationId, type: 'AI_SUGGESTION' } });
    expect(JSON.stringify(ev.data)).not.toContain('Para a segunda via');
  });
});

describe('balcao/ai — ferramentas do bot e identidade', () => {
  const tool = (calls: any[]) => ({
    name: 'eproc.consultar_processo', description: 'Consulta o andamento de um processo', inputSchema: { type: 'object', properties: { numero: { type: 'string' } } },
    minIdentityLevel: 'ouro' as const,
    handler: async (ctx: any, input: any) => { calls.push({ ctx, input }); return { ok: true, message: `Processo ${input.numero}: concluso para despacho.` }; },
  });
  const toolLlm = (req: any) => JSON.stringify({ answer: '', confidence: 0.9, intent: 'consulta_processo', category: 'processos', needsHuman: false, usedArticleIds: [], toolCall: { name: 'eproc.consultar_processo', input: { numero: '[PROCESSO_1]' } } });

  it('identidade insuficiente: não executa a ferramenta e pede login GOV.BR (com link da ferramenta identity.request_login)', async () => {
    const org = (await progressive()).id;
    const calls: any[] = []; registerBotTool(tool(calls));
    registerBotTool({ name: 'identity.request_login', description: 'gera link', inputSchema: {}, handler: async () => ({ ok: true, data: { url: 'https://login.exemplo/gov?t=abc' } }) });
    llm.queue.push(toolLlm);
    const m = await say(org, ref(), 'Qual o andamento do processo 0001234-56.2024.8.27.2729?');
    expect(await processInbound(m.payload)).toMatchObject({ action: 'AUTH_REQUIRED' });
    expect(calls).toHaveLength(0);
    expect(llm.calls[0].user).not.toContain('0001234-56');
    expect(llm.calls[0].user).toContain('eproc.consultar_processo');
    expect(bodies(m.conversationId).join('')).toMatch(/GOV\.BR.*ouro.*https:\/\/login\.exemplo\/gov\?t=abc/s);
    expect((await getConv(m.conversationId)).status).toBe('BOT');
  });

  it('sem a ferramenta de login: texto padrão', async () => {
    const org = (await progressive()).id;
    registerBotTool(tool([])); llm.queue.push(toolLlm);
    const m = await say(org, ref(), 'Qual o andamento do processo 0001234-56.2024.8.27.2729?', { metadata: { identityLevel: 'prata' } });
    expect(await processInbound(m.payload)).toMatchObject({ action: 'AUTH_REQUIRED' });
    expect(bodies(m.conversationId).join('')).toMatch(/confirmar sua identidade pelo GOV\.BR/);
  });

  it('identidade ouro: executa com o número REAL reidratado (o LLM só viu o marcador) e responde com o retorno da ferramenta', async () => {
    const org = (await progressive()).id;
    const calls: any[] = []; registerBotTool(tool(calls)); llm.queue.push(toolLlm);
    const m = await say(org, ref(), 'Qual o andamento do processo 0001234-56.2024.8.27.2729?', { metadata: { identityLevel: 'ouro' } });
    expect(await processInbound(m.payload)).toMatchObject({ action: 'TOOL' });
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toEqual({ numero: '0001234-56.2024.8.27.2729' });
    expect(calls[0].ctx).toMatchObject({ orgId: org, identityLevel: 'ouro', channel: 'WEBCHAT' });
    expect(bodies(m.conversationId).join('')).toContain('Processo 0001234-56.2024.8.27.2729: concluso para despacho.');
    expect(llm.calls).toHaveLength(1); // retorno da ferramenta NÃO volta ao LLM
  });

  it('identidade do contato (govbrLevel) também vale; ferramenta que falha escala', async () => {
    const org = (await progressive()).id;
    registerBotTool({ ...tool([]), handler: async () => ({ ok: false, message: 'e-Proc indisponível' }) }); llm.queue.push(toolLlm);
    const m = await say(org, ref(), 'Andamento do processo 0001234-56.2024.8.27.2729');
    const conv = await getConv(m.conversationId);
    await prisma.bvContact.update({ where: { id: conv.contactId }, data: { govbrLevel: 'ouro' } });
    expect(await processInbound(m.payload)).toMatchObject({ action: 'TOOL' });
    expect((await getConv(m.conversationId)).status).toBe('WAITING');
    expect(await prisma.bvConversationEvent.findFirst({ where: { conversationId: m.conversationId, type: 'ESCALATED' } }).then((e) => (e!.data as any).reason)).toBe('TOOL_ERROR');
  });
});

describe('balcao/ai — resolvido pelo bot (IQA)', () => {
  it('agradecimento após resposta do bot fecha como RESOLVED/resolvedByBot, com primeiro contato resolvido e feedback implícito', async () => {
    const org = (await progressive()).id;
    const art = await seedApproved(org, CERTIDAO);
    const r = ref();
    const m1 = await say(org, r, 'Como solicito a segunda via da certidão de nascimento?');
    await processInbound(m1.payload);
    const m2 = await say(org, r, 'Obrigado, resolveu!');
    expect(await processInbound(m2.payload)).toMatchObject({ action: 'RESOLVE' });
    const c = await getConv(m1.conversationId);
    expect(c).toMatchObject({ status: 'CLOSED', closeReason: 'RESOLVED', resolvedByBot: true, firstContactResolved: true, automatable: true, botHandled: true });
    expect((await prisma.bvKbArticle.findUniqueOrThrow({ where: { id: art.id } })).helpfulCount).toBe(1);
    expect(llm.calls).toHaveLength(1); // o agradecimento não chamou o LLM
  });

  it('"não resolveu" escala e registra feedback negativo', async () => {
    const org = (await progressive()).id;
    const art = await seedApproved(org, CERTIDAO);
    const r = ref();
    await processInbound((await say(org, r, 'Como solicito a segunda via da certidão de nascimento?')).payload);
    const m2 = await say(org, r, 'não resolveu meu problema');
    expect(await processInbound(m2.payload)).toMatchObject({ action: 'ESCALATE', reason: 'NOT_RESOLVED' });
    expect(await prisma.bvAuditLog.count({ where: { orgId: org, action: 'kb.feedback.unhelpful', entityId: art.id } })).toBe(1);
  });

  it('varredura: conversa BOT inativa com a última mensagem do bot é fechada como resolvida; cidadão sem resposta do bot é escalado', async () => {
    const org = (await progressive()).id;
    await seedApproved(org, CERTIDAO);
    const a = await say(org, ref(), 'Como solicito a segunda via da certidão de nascimento?');
    await processInbound(a.payload);
    const recent = await sweepIdleBotConversations();
    expect((await getConv(a.conversationId)).status).toBe('BOT'); // ainda dentro dos 15 min
    void recent;
    const old = new Date(Date.now() - 20 * 60_000);
    await prisma.bvConversation.update({ where: { id: a.conversationId }, data: { lastMessageAt: old } });
    const r = await sweepIdleBotConversations();
    expect(r.closed).toBeGreaterThanOrEqual(1);
    expect(await getConv(a.conversationId)).toMatchObject({ status: 'CLOSED', closeReason: 'RESOLVED', resolvedByBot: true });

    const b = await say(org, ref(), 'mensagem que o bot nunca respondeu');
    await prisma.bvConversation.update({ where: { id: b.conversationId }, data: { lastMessageAt: old } });
    await sweepIdleBotConversations();
    expect((await getConv(b.conversationId)).status).toBe('WAITING');
  });
});

describe('balcao/ai — motor ligado ao barramento', () => {
  it('message.inbound em conversa BOT dispara a resposta automaticamente', async () => {
    startAiEngine({ llm });
    const org = (await progressive()).id;
    await seedApproved(org, CERTIDAO);
    const m = await say(org, ref(), 'Como solicito a segunda via da certidão de nascimento?');
    for (let i = 0; i < 50 && !bodies(m.conversationId).length; i++) await new Promise((r) => setTimeout(r, 100));
    expect(bodies(m.conversationId)[0]).toMatch(/segunda via/);
    stopAiEngine();
  });
});

describe('balcao/ai — assistência ao atendente', () => {
  it('sugere resposta em conversa ACTIVE sem enviar nada ao cidadão; respeita agentAssist=false', async () => {
    const org = (await progressive()).id;
    await seedApproved(org, CERTIDAO);
    const agent = await makeUser(org, 'ATENDENTE');
    const m = await say(org, ref(), 'Como solicito a segunda via da certidão de nascimento? Meu CPF 529.982.247-25');
    await assignConversation({ orgId: org, conversationId: m.conversationId, userId: agent.id });
    const before = bodies(m.conversationId).length;
    const s = await handleAgentAssist({ ...m.payload, status: 'ACTIVE' }, { llm });
    expect(s?.suggestion).toMatch(/orientação do artigo/);
    expect(s?.articles).toHaveLength(1);
    expect(llm.calls[0].user).not.toContain('529.982');
    expect(bodies(m.conversationId)).toHaveLength(before);
    expect((await lastSuggestion(org, m.conversationId))?.kind).toBe('AGENT_ASSIST');

    await prisma.bvOrg.update({ where: { id: org }, data: { settings: { ai: { enabled: true, agentAssist: false } } } });
    const { invalidateOrgSettings } = await import('../../core/settings'); invalidateOrgSettings(org);
    expect(await handleAgentAssist({ ...m.payload, status: 'ACTIVE' }, { llm })).toBeNull();
  });
});

describe('balcao/ai — rotas /ai (config, teste seco, sugestão, resumo, estatísticas)', () => {
  let app: Awaited<ReturnType<typeof buildAiApp>>;
  beforeAll(async () => { app = await buildAiApp(); });
  afterAll(async () => { await app?.close(); });

  it('GET/PUT /ai/config: valida, audita e versiona; atendente não altera', async () => {
    const org = (await makeOrg()).id; const sup = await makeUser(org, 'SUPERVISOR'); const at = await makeUser(org, 'ATENDENTE');
    const g = await app.inject({ method: 'GET', url: '/balcao/ai/config', headers: authHeader(at) });
    expect(g.json()).toMatchObject({ mode: 'ASSISTED', agentAssist: true, idleCloseMinutes: 15 });
    expect((await app.inject({ method: 'PUT', url: '/balcao/ai/config', headers: authHeader(at), payload: { mode: 'PROGRESSIVE' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: '/balcao/ai/config', headers: authHeader(sup), payload: { confidenceThreshold: 7 } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/balcao/ai/config', headers: authHeader(sup), payload: { campoInexistente: 1 } })).statusCode).toBe(400);
    const p = await app.inject({ method: 'PUT', url: '/balcao/ai/config', headers: authHeader(sup), payload: { mode: 'PROGRESSIVE', confidenceThreshold: 0.8, welcomeMessage: 'Oi!', escalationKeywords: ['humano'], maxBotTurns: 3 } });
    expect(p.statusCode).toBe(200);
    expect(p.json()).toMatchObject({ mode: 'PROGRESSIVE', confidenceThreshold: 0.8, escalationKeywords: ['humano'], maxBotTurns: 3 });
    expect(await prisma.bvAuditLog.count({ where: { orgId: org, action: 'config.update', entityType: 'ai.config' } })).toBe(1);
    expect(await prisma.bvConfigVersion.count({ where: { orgId: org, entityType: 'ai.config' } })).toBe(1);
  });

  it('POST /ai/test: modo seco com a KB do órgão (sem criar conversa nem enviar nada)', async () => {
    const org = (await makeOrg({ ai: { enabled: true, mode: 'PROGRESSIVE', confidenceThreshold: 0.7 } })).id;
    const fiscal = await makeUser(org, 'FISCAL');
    await seedApproved(org, CERTIDAO);
    const convs = await prisma.bvConversation.count({ where: { orgId: org } });
    const r = await app.inject({ method: 'POST', url: '/balcao/ai/test', headers: authHeader(fiscal), payload: { message: 'Como solicito a segunda via da certidão de nascimento? CPF 529.982.247-25' } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ dryRun: true, action: 'REPLY', intent: 'segunda_via_certidao', piiRedacted: 1, retrieved: 1 });
    expect(r.json().answer).toMatch(/segunda via/); expect(r.json().articles[0].title).toMatch(/certidão/);
    expect(await prisma.bvConversation.count({ where: { orgId: org } })).toBe(convs);
    const a = await app.inject({ method: 'POST', url: '/balcao/ai/test', headers: authHeader(fiscal), payload: { message: 'Como solicito a segunda via da certidão de nascimento?', mode: 'ASSISTED' } });
    expect(a.json()).toMatchObject({ action: 'ESCALATE', reason: 'ASSISTED_TRIAGE' });
    const other = await makeUser((await makeOrg()).id, 'SUPERVISOR'); // outro órgão não vê a KB
    const o = await app.inject({ method: 'POST', url: '/balcao/ai/test', headers: authHeader(other), payload: { message: 'Como solicito a segunda via da certidão de nascimento?', mode: 'PROGRESSIVE' } });
    expect(o.json().retrieved).toBe(0); expect(o.json().action).toBe('ESCALATE');
  });

  it('POST /ai/suggest e /ai/summarize: só quem acessa a conversa; sugestão não envia mensagem', async () => {
    const org = (await progressive()).id; const other = (await makeOrg()).id;
    await seedApproved(org, CERTIDAO);
    const agent = await makeUser(org, 'ATENDENTE'); const stranger = await makeUser(other, 'ATENDENTE');
    const m = await say(org, ref(), 'Como solicito a segunda via da certidão de nascimento?');
    await assignConversation({ orgId: org, conversationId: m.conversationId, userId: agent.id });
    const before = bodies(m.conversationId).length;
    const s = await app.inject({ method: 'POST', url: '/balcao/ai/suggest', headers: authHeader(agent), payload: { conversationId: m.conversationId } });
    expect(s.statusCode).toBe(200); expect(s.json().suggestion).toBeTruthy();
    const sm = await app.inject({ method: 'POST', url: '/balcao/ai/summarize', headers: authHeader(agent), payload: { conversationId: m.conversationId } });
    expect(sm.json()).toMatchObject({ intent: 'segunda_via_certidao' }); expect(sm.json().summary).toBeTruthy();
    expect(bodies(m.conversationId)).toHaveLength(before);
    expect((await app.inject({ method: 'POST', url: '/balcao/ai/suggest', headers: authHeader(stranger), payload: { conversationId: m.conversationId } })).statusCode).toBe(404);
    llm.queue.push(new Error('x'), new Error('x'));
    expect((await app.inject({ method: 'POST', url: '/balcao/ai/suggest', headers: authHeader(agent), payload: { conversationId: m.conversationId } })).statusCode).toBe(502);
    const g = await app.inject({ method: 'GET', url: `/balcao/ai/conversations/${m.conversationId}/suggestion`, headers: authHeader(agent) });
    expect(g.json().suggestion.kind).toBe('AGENT_ASSIST');
  });

  it('GET /ai/stats: contenção, escalonamentos por motivo e IQA 07 (resolvidas no 1º contato ÷ automatizáveis)', async () => {
    const org = (await progressive()).id; const fiscal = await makeUser(org, 'FISCAL');
    await seedApproved(org, CERTIDAO);
    // 2 automatizáveis resolvidas pelo bot + 1 automatizável que escalou por baixa confiança + 1 escalada por palavra-chave
    for (const t of ['a', 'b']) { const r = ref(); await processInbound((await say(org, r, `Como solicito a segunda via da certidão de nascimento? ${t}`)).payload); await processInbound((await say(org, r, 'obrigado')).payload); }
    llm.queue.push((req) => groundedBot(req, { confidence: 0.3 }));
    await processInbound((await say(org, ref(), 'Como solicito a segunda via da certidão de nascimento? c')).payload);
    await processInbound((await say(org, ref(), 'quero um atendente')).payload);
    const r = await app.inject({ method: 'GET', url: '/balcao/ai/stats', headers: authHeader(fiscal) });
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.conversations.botHandled).toBe(4); expect(j.conversations.resolvedByBot).toBe(2);
    expect(j.containmentRate).toBe(0.5);
    expect(j.escalationsByReason).toMatchObject({ LOW_CONFIDENCE: 1, HUMAN_REQUEST: 1 });
    // fechamos a automatizável escalada para entrar no denominador
    const low = await prisma.bvConversation.findFirstOrThrow({ where: { orgId: org, intent: 'segunda_via_certidao', status: 'WAITING' } });
    await closeConversation({ orgId: org, conversationId: low.id, reason: 'RESOLVED', requestCsat: false });
    const j2 = (await app.inject({ method: 'GET', url: '/balcao/ai/stats', headers: authHeader(fiscal) })).json();
    expect(j2.iqa07).toMatchObject({ numerator: 2, denominator: 3 });
    expect(j2.iqa07.value).toBeCloseTo(2 / 3);
    expect(j2.usage.aiCalls).toBeGreaterThanOrEqual(3);
    // agente fecha conversa mas createMessage direto não afeta nada aqui
    void createMessage;
  });
});
