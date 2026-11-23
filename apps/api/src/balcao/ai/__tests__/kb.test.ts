import { prisma } from '../../../lib/prisma';
import { authHeader, makeOrg, makeUser } from '../../core/testing';
import { PiiRedactor, redactPII } from '../pii';
import { negativeSentimentScore, resolutionSignal, wantsHuman, isGreetingOnly, matchesEscalationKeyword } from '../detect';
import * as kb from '../kb';
import { searchKb } from '../search';
import { buildAiApp, CERTIDAO, seedApproved } from './helpers';

describe('balcao/ai — redação de PII', () => {
  it('redige CPF, CNPJ, e-mail, telefone, cartão e nº de processo CNJ', () => {
    const t = redactPII('CPF 529.982.247-25, cnpj 11.222.333/0001-81, e-mail ana.silva@exemplo.com.br, tel (63) 99999-1234, processo 0001234-56.2024.8.27.2729 ok');
    expect(t).not.toMatch(/529\.982|11\.222|ana\.silva|99999-1234|0001234/);
    expect(t).toContain('[CPF_1]'); expect(t).toContain('[CNPJ_1]'); expect(t).toContain('[EMAIL_1]'); expect(t).toContain('[TELEFONE_1]'); expect(t).toContain('[PROCESSO_1]');
  });
  it('CPF sem pontuação só é redigido se o dígito verificador for válido; números comuns permanecem', () => {
    expect(redactPII('meu cpf 52998224725 por favor')).toContain('[CPF_1]');
    expect(redactPII('protocolo 12345678901 aqui')).toContain('12345678901');
    expect(redactPII('a taxa é R$ 150,00 e o prazo 5 dias')).toBe('a taxa é R$ 150,00 e o prazo 5 dias');
  });
  it('mesmo valor → mesmo marcador, e rehydrate devolve o original (parâmetros de ferramenta)', () => {
    const r = new PiiRedactor();
    const t = r.redact('processo 0001234-56.2024.8.27.2729 e de novo 0001234-56.2024.8.27.2729');
    expect(t).toBe('processo [PROCESSO_1] e de novo [PROCESSO_1]');
    expect(r.rehydrate({ numero: '[PROCESSO_1]', x: ['a [PROCESSO_1]'] })).toEqual({ numero: '0001234-56.2024.8.27.2729', x: ['a 0001234-56.2024.8.27.2729'] });
  });
  it('keep=PROCESSO mantém o número em claro', () => {
    expect(redactPII('proc 0001234-56.2024.8.27.2729', { keep: ['PROCESSO'] })).toContain('0001234-56.2024.8.27.2729');
  });
});

describe('balcao/ai — detecções determinísticas', () => {
  it('pedido de humano, palavras-chave, sentimento, saudação e resolução', () => {
    expect(wantsHuman('Quero falar com um atendente, por favor')).toBe(true);
    expect(wantsHuman('Como emito a certidão?')).toBe(false);
    expect(matchesEscalationKeyword('Tenho uma RECLAMAÇÃO a fazer', ['reclamação'])).toBe('reclamação');
    expect(matchesEscalationKeyword('quero a certidão', ['atendente'])).toBeNull();
    expect(negativeSentimentScore('ISSO É UM ABSURDO, PÉSSIMO ATENDIMENTO!!!')).toBeGreaterThanOrEqual(2);
    expect(negativeSentimentScore('Bom dia, tenho uma dúvida')).toBe(0);
    expect(isGreetingOnly('Bom dia, tudo bem?')).toBe(true);
    expect(isGreetingOnly('Bom dia, preciso da certidão')).toBe(false);
    expect(resolutionSignal('Obrigado, resolveu!')).toBe('RESOLVED');
    expect(resolutionSignal('ok, mas e o prazo?')).toBeNull();
    expect(resolutionSignal('não resolveu meu problema')).toBe('NOT_RESOLVED');
  });
});

describe('balcao/ai — base de conhecimento (serviço)', () => {
  let orgId: string;
  beforeEach(async () => { orgId = (await makeOrg()).id; });

  it('fluxo DRAFT → PENDING_REVIEW → APPROVED, com transições inválidas rejeitadas', async () => {
    const author = await makeUser(orgId, 'ATENDENTE');
    const sup = await makeUser(orgId, 'SUPERVISOR');
    const a = await kb.createArticle(orgId, author.id, { ...CERTIDAO, tags: ['certidao'] });
    expect(a.status).toBe('DRAFT'); expect(a.version).toBe(1);
    await expect(kb.approveArticle(orgId, a.id, sup.id)).rejects.toMatchObject({ code: 'kb.invalid_transition' });
    expect((await kb.submitForReview(orgId, a.id, author.id)).status).toBe('PENDING_REVIEW');
    const { article, warnings } = await kb.approveArticle(orgId, a.id, sup.id);
    expect(article.status).toBe('APPROVED'); expect(article.approvedById).toBe(sup.id);
    expect(article.nextReviewAt!.getTime()).toBeGreaterThan(Date.now() + 100 * 86400_000);
    expect(warnings).toEqual([]);
    expect((await kb.archiveArticle(orgId, a.id, sup.id)).status).toBe('ARCHIVED');
    await expect(kb.updateArticle(orgId, a.id, sup.id, { title: 'novo título' }, true)).rejects.toMatchObject({ code: 'kb.archived' });
    expect((await kb.restoreArticle(orgId, a.id, sup.id)).status).toBe('DRAFT');
  });

  it('rejeitar guarda o motivo; editar um rejeitado volta a rascunho', async () => {
    const author = await makeUser(orgId, 'ATENDENTE'); const sup = await makeUser(orgId, 'SUPERVISOR');
    const a = await kb.createArticle(orgId, author.id, CERTIDAO);
    await kb.submitForReview(orgId, a.id, author.id);
    const r = await kb.rejectArticle(orgId, a.id, sup.id, 'Prazo desatualizado');
    expect(r.status).toBe('REJECTED'); expect(r.rejectedReason).toBe('Prazo desatualizado');
    const e = await kb.updateArticle(orgId, a.id, author.id, { answer: 'Resposta corrigida com o novo prazo de 3 dias úteis.' }, false);
    expect(e.status).toBe('DRAFT'); expect(e.version).toBe(2);
  });

  it('autor aprovando o próprio artigo com outro supervisor disponível: aviso, não bloqueio', async () => {
    const sup1 = await makeUser(orgId, 'SUPERVISOR'); await makeUser(orgId, 'SUPERVISOR');
    const a = await kb.createArticle(orgId, sup1.id, CERTIDAO);
    await kb.submitForReview(orgId, a.id, sup1.id);
    const { article, warnings } = await kb.approveArticle(orgId, a.id, sup1.id);
    expect(article.status).toBe('APPROVED');
    expect(warnings[0]).toMatch(/SELF_APPROVAL/);
    expect(await prisma.bvAuditLog.count({ where: { orgId, action: 'kb.self_approval' } })).toBe(1);
    // sem outro supervisor: sem aviso
    const org2 = (await makeOrg()).id; const solo = await makeUser(org2, 'ADMIN');
    const b = await kb.createArticle(org2, solo.id, CERTIDAO); await kb.submitForReview(org2, b.id, solo.id);
    expect((await kb.approveArticle(org2, b.id, solo.id)).warnings).toEqual([]);
  });

  it('versionamento: cada edição relevante gera versão; edição de atendente em artigo aprovado volta p/ revisão; supervisor mantém', async () => {
    const author = await makeUser(orgId, 'ATENDENTE'); const sup = await makeUser(orgId, 'SUPERVISOR');
    const a = await kb.createArticle(orgId, author.id, CERTIDAO);
    await kb.submitForReview(orgId, a.id, author.id); await kb.approveArticle(orgId, a.id, sup.id);
    const same = await kb.updateArticle(orgId, a.id, author.id, { title: CERTIDAO.title }, false); // sem mudança
    expect(same.version).toBe(1);
    const e1 = await kb.updateArticle(orgId, a.id, author.id, { answer: 'Nova resposta com prazo de 3 dias úteis e taxa reduzida.' }, false);
    expect(e1.version).toBe(2); expect(e1.status).toBe('PENDING_REVIEW'); expect(e1.approvedById).toBeNull();
    await kb.approveArticle(orgId, a.id, sup.id);
    const e2 = await kb.updateArticle(orgId, a.id, sup.id, { tags: ['nascimento'] }, true);
    expect(e2.version).toBe(3); expect(e2.status).toBe('APPROVED');
    const versions = await kb.listVersions(orgId, a.id);
    expect(versions.map((v) => v.version)).toEqual([3, 2, 1]);
    expect((versions[2].snapshot as any).answer).toBe(CERTIDAO.answer);
    const rev = await kb.revertToVersion(orgId, a.id, 1, sup.id, true);
    expect(rev.version).toBe(4); expect(rev.answer).toBe(CERTIDAO.answer);
  });

  it('feedback útil/não útil, uso e métricas', async () => {
    const a = await seedApproved(orgId, CERTIDAO);
    await kb.markUsed(orgId, [a.id]); await kb.markUsed(orgId, [a.id]);
    await kb.recordArticleFeedback(orgId, a.id, true, null);
    await kb.recordArticleFeedback(orgId, a.id, false, null);
    const m = await kb.kbMetrics(orgId);
    expect(m.byStatus.APPROVED).toBe(1); expect(m.totalUses).toBe(2); expect(m.totalHelpful).toBe(1);
    expect(m.feedback30d).toMatchObject({ helpful: 1, unhelpful: 1, helpfulRate: 0.5 });
  });

  it('job de revisão periódica notifica supervisores uma vez por semana', async () => {
    const sup = await makeUser(orgId, 'SUPERVISOR'); const at = await makeUser(orgId, 'ATENDENTE');
    const a = await seedApproved(orgId, CERTIDAO);
    await prisma.bvKbArticle.update({ where: { id: a.id }, data: { nextReviewAt: new Date(Date.now() - 86400_000) } });
    await kb.runKbReviewJob();
    const n = await prisma.bvNotification.findMany({ where: { orgId, type: 'KB_REVIEW_DUE' } });
    expect(n).toHaveLength(1); expect(n[0].userId).toBe(sup.id); expect((n[0].data as any).articleId).toBe(a.id);
    expect(await prisma.bvNotification.count({ where: { userId: at.id } })).toBe(0);
    await kb.runKbReviewJob(); // sem duplicar
    expect(await prisma.bvNotification.count({ where: { orgId, type: 'KB_REVIEW_DUE' } })).toBe(1);
    await kb.markReviewed(orgId, a.id, sup.id);
    expect((await kb.getArticle(orgId, a.id)).nextReviewAt!.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('balcao/ai — busca FTS em português', () => {
  let orgId: string;
  beforeAll(async () => {
    orgId = (await makeOrg()).id;
    await seedApproved(orgId, CERTIDAO);
    await seedApproved(orgId, { title: 'Horário de funcionamento do fórum', question: 'Qual o horário de atendimento presencial?', answer: 'De segunda a sexta, das 8h às 18h.' });
    const draft = await kb.createArticle(orgId, null, { title: 'Rascunho de certidão de óbito', question: 'Como pedir certidão de óbito?', answer: 'Texto ainda não aprovado sobre óbito.' });
    void draft;
  });
  it('stemming: "solicitando certidões" encontra o artigo sobre "solicitar certidão"', async () => {
    const hits = await searchKb(orgId, 'solicitando');
    expect(hits[0]?.title).toMatch(/segunda via/);
    expect(hits[0].via).toBe('fts'); // "solicitando" ↔ "solicitar" pelo stemmer português do Postgres
    const hits2 = await searchKb(orgId, 'solicitando certidões de nascimento');
    expect(hits2[0]?.title).toMatch(/segunda via/);
  });
  it('acentos: "certidao" (sem acento) cai no fallback acento-insensível', async () => {
    const hits = await searchKb(orgId, 'certidao');
    expect(hits.map((h) => h.title).join()).toMatch(/certidão de nascimento/);
  });
  it('pergunta em linguagem natural (OR) e só artigos APPROVED', async () => {
    const hits = await searchKb(orgId, 'preciso saber o horario do forum e como emitir certidao de obito', { first: 'any' });
    const titles = hits.map((h) => h.title);
    expect(titles.some((t) => /Horário/.test(t))).toBe(true);
    expect(titles.some((t) => /Rascunho/.test(t))).toBe(false);
  });
  it('consulta sem relação → vazio; outro órgão não enxerga', async () => {
    expect(await searchKb(orgId, 'astronomia buracos negros')).toEqual([]);
    const other = (await makeOrg()).id;
    expect(await searchKb(other, 'certidão de nascimento')).toEqual([]);
  });
  it('entrada com caracteres especiais de tsquery não quebra', async () => {
    await expect(searchKb(orgId, `certidão & | ! ( ) : * '' "`)).resolves.toBeDefined();
  });
});

describe('balcao/ai — rotas /kb (HTTP, permissões e isolamento)', () => {
  let app: Awaited<ReturnType<typeof buildAiApp>>;
  beforeAll(async () => { app = await buildAiApp(); });
  afterAll(async () => { await app?.close(); });

  it('atendente cria e envia; só supervisor aprova; busca devolve só aprovados; outro órgão recebe 404', async () => {
    const org = (await makeOrg()).id; const other = (await makeOrg()).id;
    const at = await makeUser(org, 'ATENDENTE'); const sup = await makeUser(org, 'SUPERVISOR'); const fiscal = await makeUser(org, 'FISCAL'); const stranger = await makeUser(other, 'SUPERVISOR');
    const c = await app.inject({ method: 'POST', url: '/balcao/kb/articles', headers: authHeader(at), payload: { ...CERTIDAO, tags: ['certidao'] } });
    expect(c.statusCode).toBe(201); const id = c.json().id;
    expect((await app.inject({ method: 'POST', url: '/balcao/kb/articles', headers: authHeader(fiscal), payload: CERTIDAO })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/balcao/kb/articles/${id}/submit`, headers: authHeader(at) })).json().status).toBe('PENDING_REVIEW');
    expect((await app.inject({ method: 'POST', url: `/balcao/kb/articles/${id}/approve`, headers: authHeader(at) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/balcao/kb/articles/${id}/reject`, headers: authHeader(sup), payload: {} })).statusCode).toBe(400);
    const s0 = await app.inject({ method: 'GET', url: '/balcao/kb/search?q=certid%C3%A3o', headers: authHeader(at) });
    expect(s0.json().items).toHaveLength(0);
    const ap = await app.inject({ method: 'POST', url: `/balcao/kb/articles/${id}/approve`, headers: authHeader(sup), payload: {} });
    expect(ap.statusCode).toBe(200); expect(ap.json().status).toBe('APPROVED');
    const s1 = await app.inject({ method: 'GET', url: '/balcao/kb/search?q=segunda%20via%20certid%C3%A3o', headers: authHeader(fiscal) });
    expect(s1.json().items[0].id).toBe(id);
    expect((await app.inject({ method: 'GET', url: `/balcao/kb/articles/${id}`, headers: authHeader(stranger) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/balcao/kb/search?q=certid%C3%A3o', headers: authHeader(stranger) })).json().items).toHaveLength(0);
    expect((await app.inject({ method: 'POST', url: `/balcao/kb/articles/${id}/archive`, headers: authHeader(stranger) })).statusCode).toBe(404);
    const list = await app.inject({ method: 'GET', url: '/balcao/kb/articles?status=APPROVED&tag=certidao', headers: authHeader(at) });
    expect(list.json().items).toHaveLength(1);
    const fb = await app.inject({ method: 'POST', url: `/balcao/kb/articles/${id}/feedback`, headers: authHeader(at), payload: { helpful: true } });
    expect(fb.json().helpfulCount).toBe(1);
    const vs = await app.inject({ method: 'GET', url: `/balcao/kb/articles/${id}/versions`, headers: authHeader(at) });
    expect(vs.json().items).toHaveLength(1);
    const m = await app.inject({ method: 'GET', url: '/balcao/kb/metrics', headers: authHeader(sup) });
    expect(m.json().byStatus.APPROVED).toBe(1);
  });

  it('importação JSON e CSV entram como PENDING_REVIEW; duplicadas e inválidas são relatadas', async () => {
    const org = (await makeOrg()).id; const at = await makeUser(org, 'ATENDENTE');
    const j = await app.inject({ method: 'POST', url: '/balcao/kb/import', headers: authHeader(at), payload: { articles: [
      { title: 'Horário', question: 'Qual o horário de atendimento?', answer: 'Das 8h às 18h.', tags: ['horario'] },
      { title: 'Horário', question: 'Qual o horário de atendimento?', answer: 'Repetida.' },
      { title: 'x', question: 'curta', answer: '' },
    ] } });
    expect(j.statusCode).toBe(201);
    expect(j.json()).toMatchObject({ created: 1, skipped: 1 }); expect(j.json().errors).toHaveLength(2);
    const csv = 'titulo;pergunta;resposta;categoria;tags\r\n"Taxa";"Qual o valor da taxa?";"R$ 50,00; pagável por boleto.";custas;custas|valor\r\n';
    const c = await app.inject({ method: 'POST', url: '/balcao/kb/import', headers: authHeader(at), payload: { format: 'csv', csv } });
    expect(c.json().created).toBe(1);
    const rows = await prisma.bvKbArticle.findMany({ where: { orgId: org } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'PENDING_REVIEW' && r.source === 'IMPORT')).toBe(true);
    expect(rows.find((r) => r.title === 'Taxa')).toMatchObject({ answer: 'R$ 50,00; pagável por boleto.', category: 'custas', tags: ['custas', 'valor'] });
  });
});
