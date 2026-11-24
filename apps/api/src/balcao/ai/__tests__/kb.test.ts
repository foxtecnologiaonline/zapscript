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

describe('balcao/ai — redação de PII: heurísticas de texto livre', () => {
  const R = (t: string, o?: Parameters<typeof redactPII>[1]) => redactPII(t, o);
  it('nome após "meu nome é / me chamo / sou o|a" (só o nome; a frase e o pedido ficam)', () => {
    expect(R('Olá, meu nome é Maria da Silva Santos e preciso da certidão')).toBe('Olá, meu nome é [NOME_1] e preciso da certidão');
    expect(R('me chamo joao pedro preciso de ajuda')).toBe('me chamo [NOME_1] preciso de ajuda');
    expect(R('Sou o João Pereira, advogado da parte')).toBe('Sou o [NOME_1], advogado da parte');
    expect(R('Boa tarde, sou a Ana Beatriz.')).toBe('Boa tarde, sou a [NOME_1].');
    expect(R('Meu nome é Carlos. Quero saber do prazo')).toBe('Meu nome é [NOME_1]. Quero saber do prazo');
  });
  it('nome: falsos positivos — papéis, frases comuns e "me chamo" sem nome não são redigidos', () => {
    for (const t of ['Sou o advogado da parte autora', 'Sou a Parte requerente no processo', 'sou a favor da mudança', 'Sou o Autor do processo', 'me chamo de volta?', 'meu nome é e preciso de ajuda', 'o nome do cartório é Cartório Central']) {
      expect(R(t)).toBe(t);
    }
  });
  it('RG (com âncora ou formato), CEP e data de nascimento', () => {
    expect(R('meu RG é 1.234.567 SSP/TO e CPF 529.982.247-25')).toBe('meu RG é [RG_1] e CPF [CPF_1]');
    expect(R('identidade nº 12.345.678-9')).toBe('identidade nº [RG_1]');
    expect(R('CEP 77001-000 e cep: 77006123')).toBe('CEP [CEP_1] e cep: [CEP_2]');
    expect(R('nasci em 12/05/1985')).toBe('nasci em [NASCIMENTO_1]');
    expect(R('data de nascimento: 05/03/2015')).toBe('data de nascimento: [NASCIMENTO_1]');
    expect(R('a data de nascimento do meu filho é 5 de março de 2015')).toBe('a data de nascimento do meu filho é [NASCIMENTO_1]');
    expect(R('nasci em 1985, em Palmas')).toBe('nasci em [NASCIMENTO_1], em Palmas');
  });
  it('datas e números comuns permanecem (audiência, emissão, protocolo, lei, valor, prazo)', () => {
    for (const t of ['A audiência é dia 10/12/2026 às 14h', 'certidão de nascimento emitida em 10/05/2020', 'nasci em Palmas', 'protocolo BV-2026-000123, prazo de 15 dias, taxa R$ 1.500,00',
      'conforme a lei 8.069/90 e a portaria 123/2024, artigo 5', 'o RG está vencido', 'preciso do CEP do fórum', 'a conta de luz vence dia 10', 'paguei a conta 150 reais', 'a quadra de esportes está fechada']) {
      expect(R(t)).toBe(t);
    }
  });
  it('endereços: rua/avenida/travessa, quadra e siglas de Palmas (ARNO, ACSU, ASR) com número', () => {
    expect(R('moro na Rua das Flores, 123, apto 4 - CEP 77001-000')).toBe('moro na [ENDERECO_1] - CEP [CEP_1]');
    expect(R('Av. Teotônio Segurado 1500')).toBe('[ENDERECO_1]');
    expect(R('travessa dos Ipês nº 45')).toBe('[ENDERECO_1]');
    expect(R('ARNO 33 Alameda 5 lote 10')).toBe('[ENDERECO_1]');
    expect(R('ACSU-SO 40 conjunto 2')).toBe('[ENDERECO_1]');
    expect(R('ASR-SE 105')).toBe('[ENDERECO_1]');
    expect(R('quadra 104 Norte, lote 5')).toBe('[ENDERECO_1]');
    expect(R('rua 7, casa 12')).toBe('[ENDERECO_1]');
    // frases comuns com a palavra "rua"/"quadra" sem endereço
    expect(R('na rua principal eu paguei 150 reais')).toBe('na rua principal eu paguei 150 reais');
    expect(R('a rua está alagada')).toBe('a rua está alagada');
    expect(R('o arno 33 é um nome')).toBe('o arno 33 é um nome'); // sigla só em MAIÚSCULAS
  });
  it('dados bancários: agência e conta (mantém a palavra, troca o número)', () => {
    expect(R('agência 1234-5 conta corrente 56789-0')).toBe('agência [DADOS_BANCARIOS_1] conta corrente [DADOS_BANCARIOS_2]');
    expect(R('Ag. 0001 c/c 12345678')).toBe('Ag. [DADOS_BANCARIOS_1] c/c [DADOS_BANCARIOS_2]');
  });
  it('marcadores estáveis, mesmo valor → mesmo marcador, valores diferentes → marcadores diferentes (e-mail com dígitos inclusive)', () => {
    const r = new PiiRedactor();
    expect(r.redact('meu nome é Maria Souza. Maria Souza mora na Rua A, 5')).toBe('meu nome é [NOME_1]. Maria Souza mora na [ENDERECO_1]');
    expect(r.redact('Rua B, 5')).toBe('[ENDERECO_2]'); // mesmo número, rua diferente
    const e = new PiiRedactor();
    expect(e.redact('ana2@x.com e bob2@x.com e ana2@x.com')).toBe('[EMAIL_1] e [EMAIL_2] e [EMAIL_1]');
    expect(r.rehydrate('Olá [NOME_1], confirmo [ENDERECO_1]')).toBe('Olá Maria Souza, confirmo Rua A, 5');
  });
  it('nº de processo CNJ em claro quando a ferramenta precisa (keep) — nenhuma outra regra o corta', () => {
    const t = R('processo 0001234-56.2024.8.27.2729, meu nome é Pedro Alves, tel (63) 99999-1234', { keep: ['PROCESSO'] });
    expect(t).toBe('processo 0001234-56.2024.8.27.2729, meu nome é [NOME_1], tel [TELEFONE_1]');
    expect(R('0001234-56.2024.8.27.2729')).toBe('[PROCESSO_1]');
    expect(R('meu nome é Pedro Alves', { keep: ['NOME'] })).toBe('meu nome é Pedro Alves');
  });
  it('limite documentado: nomes sem âncora NÃO são redigidos (não substitui NER)', () => {
    expect(R('O João Silva ligou ontem')).toBe('O João Silva ligou ontem');
    expect(R('moro no bairro Plano Diretor Sul')).toBe('moro no bairro Plano Diretor Sul');
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
