import { prisma } from '../../../lib/prisma';
import { addConversationEvent } from '../../core/conversations';
import { createMessage } from '../../core/messages';
import { authHeader, makeOrg, makeUser } from '../../core/testing';
import { clearChannelSenders, registerChannelSender } from '../../core/channels';
import { setLlmClient } from '../llm';
import { clusterQuestions, clusterTokens, runCuration } from '../curation';
import { buildAiApp, CERTIDAO, FakeLlm, ref, say, seedApproved } from './helpers';

const llm = new FakeLlm();
beforeAll(() => { setLlmClient(llm); registerChannelSender('WEBCHAT', async (r) => ({ channelMessageId: `o-${r.message.id}` })); });
afterAll(() => { clearChannelSenders(); });
beforeEach(() => llm.reset());

/** Conversa já encerrada que o bot não conseguiu cobrir e um atendente respondeu. */
async function gapConv(orgId: string, agentId: string, q: string, a: string, intent = 'certidao_obito') {
  const m = await say(orgId, ref(), q);
  await prisma.bvConversation.update({ where: { id: m.conversationId }, data: { status: 'CLOSED', closedAt: new Date(), closeReason: 'RESOLVED', botHandled: true, automatable: false, intent, assignedUserId: agentId } });
  await createMessage({ orgId, conversationId: m.conversationId, direction: 'OUT', senderType: 'AGENT', senderUserId: agentId, body: a });
  return m.conversationId;
}

const OBITO_Q = [
  'Como faço para pedir a certidão de óbito do meu pai? Meu CPF é 529.982.247-25',
  'Preciso solicitar a certidão de óbito, como funciona?',
  'qual o procedimento para emitir certidão de óbito',
];
const OBITO_A = 'A certidão de óbito é emitida pelo cartório de registro civil do local do falecimento, com documento do falecido. Prazo de 5 dias úteis.';
const PAUTA_Q = ['Como consigo a pauta de audiências desta semana?', 'onde eu vejo a pauta das audiências da semana'];
const PAUTA_A = 'A pauta de audiências é publicada toda segunda-feira no portal do órgão, na aba Pautas.';

describe('balcao/ai — curadoria', () => {
  it('agrupa perguntas parecidas (TF-IDF/Jaccard) e separa assuntos distintos', () => {
    const items = [...OBITO_Q, ...PAUTA_Q, 'meu cachorro fugiu ontem'].map((question, i) => ({ convId: `c${i}`, question, answers: [], intent: null, tokens: clusterTokens(question), fromBot: true }));
    const cl = clusterQuestions(items);
    const sizes = cl.map((c) => c.items.length).sort();
    expect(sizes).toEqual([1, 2, 3]);
  });

  it('gera sugestões NEW_ARTICLE com evidência, exemplos sem PII e proposta do LLM FORTE marcada para revisão; reexecução não duplica', async () => {
    const org = (await makeOrg()).id; const agent = await makeUser(org, 'ATENDENTE');
    for (const q of OBITO_Q) await gapConv(org, agent.id, q, OBITO_A);
    for (const q of PAUTA_Q) await gapConv(org, agent.id, q, PAUTA_A, 'pauta_audiencias');
    await gapConv(org, agent.id, 'meu cachorro fugiu ontem à noite', 'Esse assunto não é do órgão, procure a prefeitura.', 'fora_de_escopo');
    const r = await runCuration(org, { llm });
    expect(r).toMatchObject({ clusters: 2, created: 2, proposals: 2 });
    const sug = await prisma.bvKbSuggestion.findMany({ where: { orgId: org } });
    expect(sug).toHaveLength(2);
    expect(sug.every((s) => s.type === 'NEW_ARTICLE' && s.status === 'OPEN' && !!s.proposedAnswer)).toBe(true);
    const obito = sug.find((s) => (s.evidence as any).count === 3)!;
    const ev = obito.evidence as any;
    expect(ev.conversationIds).toHaveLength(3);
    expect(ev.proposal).toMatchObject({ by: 'LLM', requiresHumanReview: true, model: 'fake-strong' });
    expect(JSON.stringify(obito)).not.toContain('529.982');
    expect(llm.calls.every((c) => c.tier === 'strong' && c.label === 'bv.curation')).toBe(true);
    expect(llm.calls.map((c) => c.user).join('')).not.toContain('529.982');
    const again = await runCuration(org, { llm });
    expect(again).toMatchObject({ created: 0, updated: 2 });
    expect(await prisma.bvKbSuggestion.count({ where: { orgId: org } })).toBe(2);
  });

  it('LLM indisponível → GAP sem proposta; curadoria nunca cria artigo sozinha', async () => {
    const org = (await makeOrg()).id; const agent = await makeUser(org, 'ATENDENTE');
    for (const q of PAUTA_Q) await gapConv(org, agent.id, q, PAUTA_A);
    llm.fallback = () => { throw new Error('fora do ar'); };
    const r = await runCuration(org, { llm });
    expect(r.created).toBe(1);
    const s = await prisma.bvKbSuggestion.findFirstOrThrow({ where: { orgId: org } });
    expect(s).toMatchObject({ type: 'GAP', proposedAnswer: null });
    expect(await prisma.bvKbArticle.count({ where: { orgId: org } })).toBe(0);
  });

  it('artigo parecido já existe → IMPROVE apontando o artigo', async () => {
    const org = (await makeOrg()).id; const agent = await makeUser(org, 'ATENDENTE');
    const art = await seedApproved(org, CERTIDAO);
    for (const q of ['Como solicitar a segunda via da certidão de nascimento?', 'preciso solicitar segunda via certidão nascimento']) await gapConv(org, agent.id, q, 'Pelo portal.', 'certidao_nascimento');
    await runCuration(org, { llm });
    const s = await prisma.bvKbSuggestion.findFirstOrThrow({ where: { orgId: org } });
    expect(s).toMatchObject({ type: 'IMPROVE', articleId: art.id });
  });

  it('detecta ambiguidades: artigos concorrentes, respostas divergentes e baixa confiança recorrente', async () => {
    const org = (await makeOrg()).id; const agent = await makeUser(org, 'ATENDENTE');
    await seedApproved(org, { title: 'Horário de funcionamento do fórum', question: 'Qual o horário de funcionamento do fórum?', answer: 'Das 8h às 18h.' });
    await seedApproved(org, { title: 'Horário de funcionamento do fórum', question: 'Qual o horário de funcionamento do fórum de Palmas?', answer: 'Das 9h às 17h.' });
    const answers = ['O protocolo pode ser feito apenas presencialmente no balcão do cartório.', 'Basta enviar um e-mail com os documentos digitalizados anexados ao processo.', 'Utilize o aplicativo móvel oficial e conclua a validação biométrica facial.'];
    for (const [i, a] of answers.entries()) await gapConv(org, agent.id, `pergunta variada número ${i} sobre protocolo`, a, 'protocolo_documentos');
    for (let i = 0; i < 3; i++) {
      const m = await say(org, ref(), `dúvida sobre custas ${i}`);
      await prisma.bvConversation.update({ where: { id: m.conversationId }, data: { intent: 'custas_processuais' } });
      await addConversationEvent(org, m.conversationId, 'ESCALATED', null, { reason: 'LOW_CONFIDENCE' });
    }
    const r = await runCuration(org, { llm, propose: false });
    expect(r.ambiguities).toBe(3);
    const kinds = (await prisma.bvKbSuggestion.findMany({ where: { orgId: org, type: 'AMBIGUITY' } })).map((s) => (s.evidence as any).kind).sort();
    expect(kinds).toEqual(['COMPETING_ARTICLES', 'DIVERGENT_ANSWERS', 'RECURRING_LOW_CONFIDENCE']);
    expect((await runCuration(org, { llm, propose: false })).ambiguities).toBe(0); // não duplica
  });
});

describe('balcao/ai — rotas de sugestões e curadoria', () => {
  let app: Awaited<ReturnType<typeof buildAiApp>>;
  beforeAll(async () => { app = await buildAiApp(); });
  afterAll(async () => { await app?.close(); });

  it('executa manualmente, lista, aceita (cria artigo CURATORSHIP em DRAFT, nunca publicado) e descarta; isolamento entre órgãos', async () => {
    const org = (await makeOrg()).id; const other = (await makeOrg()).id;
    const agent = await makeUser(org, 'ATENDENTE'); const sup = await makeUser(org, 'SUPERVISOR'); const fiscal = await makeUser(org, 'FISCAL'); const stranger = await makeUser(other, 'SUPERVISOR');
    for (const q of OBITO_Q) await gapConv(org, agent.id, q, OBITO_A);
    for (const q of PAUTA_Q) await gapConv(org, agent.id, q, PAUTA_A, 'pauta_audiencias');

    expect((await app.inject({ method: 'POST', url: '/balcao/kb/curation/run', headers: authHeader(agent), payload: {} })).statusCode).toBe(403);
    const run = await app.inject({ method: 'POST', url: '/balcao/kb/curation/run', headers: authHeader(sup), payload: {} });
    expect(run.statusCode).toBe(200); expect(run.json().created).toBe(2);

    const list = (await app.inject({ method: 'GET', url: '/balcao/kb/suggestions', headers: authHeader(agent) })).json().items;
    expect(list).toHaveLength(2);
    expect((await app.inject({ method: 'GET', url: '/balcao/kb/suggestions', headers: authHeader(stranger) })).json().items).toHaveLength(0);
    const obito = list.find((s: any) => s.evidenceCount === 3); const pauta = list.find((s: any) => s.evidenceCount === 2);

    expect((await app.inject({ method: 'POST', url: `/balcao/kb/suggestions/${obito.id}/accept`, headers: authHeader(stranger), payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/balcao/kb/suggestions/${obito.id}/accept`, headers: authHeader(fiscal), payload: {} })).statusCode).toBe(403);
    const acc = await app.inject({ method: 'POST', url: `/balcao/kb/suggestions/${obito.id}/accept`, headers: authHeader(agent), payload: { submitForReview: true, tags: ['obito'] } });
    expect(acc.statusCode).toBe(200);
    const art = await prisma.bvKbArticle.findUniqueOrThrow({ where: { id: acc.json().articleId } });
    expect(art).toMatchObject({ status: 'PENDING_REVIEW', source: 'CURATORSHIP', authorId: agent.id, tags: ['obito'] });
    expect(art.sourceConversationIds).toHaveLength(3);
    expect(art.answer).toBe(obito.proposedAnswer);
    expect((await app.inject({ method: 'POST', url: `/balcao/kb/suggestions/${obito.id}/accept`, headers: authHeader(agent), payload: {} })).statusCode).toBe(409);
    const d = await app.inject({ method: 'POST', url: `/balcao/kb/suggestions/${pauta.id}/dismiss`, headers: authHeader(agent), payload: { reason: 'fora do escopo' } });
    expect(d.json().status).toBe('DISMISSED');
    // publicar exige aprovação humana: o bot ainda não enxerga o artigo
    const { searchKb } = await import('../search');
    expect(await searchKb(org, 'certidão de óbito')).toEqual([]);
    expect((await app.inject({ method: 'POST', url: `/balcao/kb/articles/${art.id}/approve`, headers: authHeader(agent) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/balcao/kb/articles/${art.id}/approve`, headers: authHeader(sup), payload: {} })).statusCode).toBe(200);
    expect((await searchKb(org, 'certidão de óbito')).length).toBe(1);

    // descartada recentemente → não é recriada
    const again = (await app.inject({ method: 'POST', url: '/balcao/kb/curation/run', headers: authHeader(sup), payload: {} })).json();
    expect(again.created).toBe(0);

    const st = (await app.inject({ method: 'GET', url: '/balcao/kb/curation/stats', headers: authHeader(fiscal) })).json();
    expect(st).toMatchObject({ botConversations: 5, coverage: 0, suggestions: { open: 0, accepted: 1, dismissed: 1 }, contractedHoursPerMonth: 40 });
    expect(st.curationHoursEstimated).toBeCloseTo((2 * 12 + 1 * 20) / 60, 1);
  });

  it('aceitar sugestão sem proposta exige a resposta; AMBIGUITY apenas é marcada como tratada', async () => {
    const org = (await makeOrg()).id; const agent = await makeUser(org, 'ATENDENTE');
    const gap = await prisma.bvKbSuggestion.create({ data: { orgId: org, type: 'GAP', question: 'Como pedir isenção de custas?', evidence: { conversationIds: ['x'], count: 1 } } });
    expect((await app.inject({ method: 'POST', url: `/balcao/kb/suggestions/${gap.id}/accept`, headers: authHeader(agent), payload: {} })).statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: `/balcao/kb/suggestions/${gap.id}/accept`, headers: authHeader(agent), payload: { answer: 'Peça a gratuidade de justiça com declaração de hipossuficiência.' } });
    expect(ok.statusCode).toBe(200);
    const amb = await prisma.bvKbSuggestion.create({ data: { orgId: org, type: 'AMBIGUITY', question: 'x', evidence: { count: 2 } } });
    const r = await app.inject({ method: 'POST', url: `/balcao/kb/suggestions/${amb.id}/accept`, headers: authHeader(agent), payload: {} });
    expect(r.json().articleId).toBeNull();
  });
});
