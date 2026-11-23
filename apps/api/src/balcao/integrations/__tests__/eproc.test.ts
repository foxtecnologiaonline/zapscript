import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../lib/prisma';
import { clearBotTools, getBotTool, identitySatisfies } from '../../core/tools';
import { setContactDocument } from '../../core/contacts';
import { ingestInbound } from '../../core/conversations';
import { saveIntegration } from '../../core/integrations';
import { authHeader, makeOrg, makeUser } from '../../core/testing';
import { cnjCheckDigits, consultarProcesso, maskCnj, maskName, normalizeCnj, parseMniResponse, registerEprocTool, buildConsultarProcessoEnvelope } from '../eproc';
import { buildApp, listen, type FakeServer } from './fakes';

const DD = cnjCheckDigits('0001234', '2024', '8', '27', '0001');
const NUM = `0001234-${DD}.2024.8.27.0001`;

const ok = (inner: string, sucesso = true, msg = '') => `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><ns2:consultarProcessoResposta xmlns:ns2="http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/"><sucesso>${sucesso}</sucesso><mensagem>${msg}</mensagem>${inner}</ns2:consultarProcessoResposta></soap:Body></soap:Envelope>`;
const processoXml = (sigilo = 0, extra = '') => `<processo><dadosBasicos numero="${NUM.replace(/\D/g, '')}" classeProcessual="7" nivelSigilo="${sigilo}" dataAjuizamento="20240110103000" codigoLocalidade="2705">
<polo polo="AT"><parte><pessoa nome="Maria da Silva Souza" numeroDocumentoPrincipal="52998224725"/><advogado nome="Dr. João" numeroDocumentoPrincipal="11144477735"/></parte></polo>
<polo polo="PA"><parte><pessoa nome="Estado do Tocantins" numeroDocumentoPrincipal="00000000000191"/></parte></polo>
<assunto><codigoNacional>899</codigoNacional></assunto><orgaoJulgador codigoOrgao="123" nomeOrgao="1ª Vara Cível de Palmas"/>
<outroParametro nome="situacaoProcesso" valor="Em andamento"/></dadosBasicos>
<movimento dataHora="20240201090000" nivelSigilo="0"><movimentoNacional codigoNacional="193"/><complemento>Intimado CPF 529.982.247-25 para manifestar</complemento></movimento>
<movimento dataHora="20240301090000" nivelSigilo="0"><movimentoLocal codigoMovimento="1" descricao="Juntada de petição"/></movimento>
<movimento dataHora="20240305090000" nivelSigilo="5"><movimentoLocal codigoMovimento="2" descricao="Despacho sigiloso"/></movimento>${extra}</processo>`;
const FAULT = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><soap:Fault><faultcode>soap:Server</faultcode><faultstring>NullPointer at br.jus.tjto.Secret(Foo.java:10) senha=abc</faultstring></soap:Fault></soap:Body></soap:Envelope>`;

describe('integrations/eproc — MNI SOAP', () => {
  let srv: FakeServer; let orgId: string; let respond: (body: string) => [number, string];
  let app: FastifyInstance;
  const cfg = (over: Record<string, unknown> = {}) => ({ mode: 'soap', endpoint: `${srv.url}/mni`, idConsultante: 'balcao', senhaConsultante: 'S3nha!', allowPrivateHosts: true, timeoutMs: 800, retries: 1, retryDelayMs: 5, tpu: { classes: { '7': 'Procedimento Comum Cível' }, assuntos: { '899': 'Indenização por Dano Moral' }, movimentos: { '193': 'Intimação' } }, ...over });

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => {
    respond = () => [200, ok(processoXml())];
    srv = await listen((r) => (r.path.startsWith('/mni') ? respond(r.body) : [404, '']));
    orgId = (await makeOrg()).id;
    await saveIntegration(orgId, 'EPROC', cfg());
  });
  afterEach(async () => { await srv.close(); });

  it('valida número CNJ com dígito verificador', () => {
    expect(normalizeCnj(NUM)).toBe(NUM);
    expect(normalizeCnj(NUM.replace(/\D/g, ''))).toBe(NUM);
    expect(normalizeCnj(NUM.replace('-' + DD, '-' + String((Number(DD) + 1) % 100).padStart(2, '0')))).toBeNull();
    expect(normalizeCnj('1234')).toBeNull();
    expect(normalizeCnj("0001234-00.2024.8.27.0001'; DROP")).toBeNull();
    expect(maskCnj(NUM)).toBe(`****234-${DD}.2024.8.27.0001`);
    expect(maskName('Maria da Silva Souza')).toBe('M**** da S**** S****');
  });

  it('monta o envelope com escape XML e envia credenciais', () => {
    const env = buildConsultarProcessoEnvelope({ wsdlNamespace: 'urn:a', tiposNamespace: 'urn:b', idConsultante: 'a<b', senhaConsultante: 'x&y' }, NUM, true);
    expect(env).toContain('a&lt;b'); expect(env).toContain('x&amp;y'); expect(env).toContain(`<tip:numeroProcesso>${NUM.replace(/\D/g, '')}</tip:numeroProcesso>`); expect(env).toContain('consultarProcesso');
  });

  it('consulta e normaliza: TPU, partes mascaradas, movimentos ordenados, CPF saneado, sigilosos omitidos', async () => {
    const { processo, consultanteEhParte } = await consultarProcesso(orgId, NUM, { movimentos: true });
    expect(processo).toMatchObject({ numero: NUM, classe: 'Procedimento Comum Cível', assunto: 'Indenização por Dano Moral', orgaoJulgador: '1ª Vara Cível de Palmas', situacao: 'Em andamento' });
    expect(processo.dataAutuacao).toBe('2024-01-10T10:30:00-03:00');
    expect(processo.partes).toEqual([{ polo: 'ATIVO', nome: 'M**** da S**** S****' }, { polo: 'PASSIVO', nome: 'E***** do T******' }]);
    expect(processo.ultimosMovimentos.map((m) => m.descricao)).toEqual(['Juntada de petição', expect.stringContaining('Intimação')]);
    expect(JSON.stringify(processo)).not.toContain('52998224725');
    expect(JSON.stringify(processo)).not.toContain('529.982.247-25');
    expect(JSON.stringify(processo)).not.toContain('sigiloso');
    expect(consultanteEhParte).toBe(false);
    expect((await consultarProcesso(orgId, NUM, { viewerDocument: '529.982.247-25' })).consultanteEhParte).toBe(true);
    expect((await consultarProcesso(orgId, NUM, { viewerDocument: '111.444.777-35' })).consultanteEhParte).toBe(true); // advogado
    const hit = srv.hits[0];
    expect(hit.method).toBe('POST'); expect(hit.body).toContain('S3nha!'); expect(hit.headers['content-type']).toContain('text/xml');
  });

  it('sem movimentos pedidos não devolve movimentos; maskPartyNames=false mostra nomes', async () => {
    await saveIntegration(orgId, 'EPROC', cfg({ maskPartyNames: false }));
    const { processo } = await consultarProcesso(orgId, NUM, { movimentos: false });
    expect(processo.ultimosMovimentos).toEqual([]);
    expect(processo.partes[0].nome).toBe('Maria da Silva Souza');
  });

  it('número inválido não chama o servidor', async () => {
    await expect(consultarProcesso(orgId, '123', {})).rejects.toMatchObject({ code: 'eproc.invalid_number' });
    expect(srv.hits).toHaveLength(0);
  });

  it('SOAP Fault (HTTP 500) → eproc.soap_fault sem vazar a mensagem do servidor', async () => {
    respond = () => [500, FAULT];
    const e: any = await consultarProcesso(orgId, NUM, {}).catch((x) => x);
    expect(e.code).toBe('eproc.soap_fault');
    expect(e.message).not.toContain('NullPointer'); expect(e.message).not.toContain('senha');
    expect(srv.hits).toHaveLength(1); // Fault não faz retry
  });

  it('processo em segredo de justiça (nivelSigilo>0 ou mensagem) não vaza dados', async () => {
    respond = () => [200, ok(processoXml(1))];
    await expect(consultarProcesso(orgId, NUM, {})).rejects.toMatchObject({ code: 'eproc.sigiloso' });
    respond = () => [200, ok('', false, 'Processo em segredo de justiça: acesso negado')];
    await expect(consultarProcesso(orgId, NUM, {})).rejects.toMatchObject({ code: 'eproc.sigiloso' });
    respond = () => [200, ok('', false, 'Processo não encontrado')];
    await expect(consultarProcesso(orgId, NUM, {})).rejects.toMatchObject({ code: 'eproc.not_found' });
    respond = () => [200, ok('', false, 'Senha do consultante inválida')];
    await expect(consultarProcesso(orgId, NUM, {})).rejects.toMatchObject({ code: 'eproc.auth' });
  });

  it('5xx sem Fault: tenta de novo e se recupera; esgotado → eproc.unavailable', async () => {
    let n = 0;
    respond = () => (++n === 1 ? [503, 'indisponível'] : [200, ok(processoXml())]);
    expect((await consultarProcesso(orgId, NUM, {})).processo.numero).toBe(NUM);
    expect(n).toBe(2);
    respond = () => [502, 'bad gateway'];
    await expect(consultarProcesso(orgId, NUM, {})).rejects.toMatchObject({ code: 'eproc.unavailable' });
  });

  it('timeout → eproc.timeout (após retry)', async () => {
    await srv.close();
    srv = await listen(async () => { await new Promise((r) => setTimeout(r, 500)); return [200, ok(processoXml())]; });
    await saveIntegration(orgId, 'EPROC', cfg({ endpoint: `${srv.url}/mni`, timeoutMs: 500, retries: 1 }));
    // timeoutMs mínimo 500 pelo schema; servidor responde em 500+ → pode estourar; força com tempo menor via http injetado
    const slow = { request: async () => { throw Object.assign(new (require('../http-client').IntegrationError)('http.timeout', 't', undefined, true)); } };
    await expect(consultarProcesso(orgId, NUM, {}, { http: slow as any })).rejects.toMatchObject({ code: 'eproc.timeout' });
  });

  it('resposta vazia, lixo ou com DOCTYPE/ENTITY → eproc.bad_response', async () => {
    for (const body of ['', 'não é xml', '<a/>', '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body/></soap:Envelope>']) {
      respond = () => [200, body];
      await expect(consultarProcesso(orgId, NUM, {})).rejects.toMatchObject({ code: 'eproc.bad_response' });
    }
    respond = () => [200, ok('')];
    await expect(consultarProcesso(orgId, NUM, {})).rejects.toMatchObject({ code: 'eproc.not_found' });
    expect(() => parseMniResponse('<x/>', { maxMovimentos: 5, maskPartyNames: true, tpu: { classes: {}, assuntos: {}, movimentos: {} } }, true)).toThrow();
  });

  it('limita o tamanho da resposta', async () => {
    await saveIntegration(orgId, 'EPROC', cfg({ maxResponseBytes: 2048 }));
    respond = () => [200, ok(processoXml()) + ' '.repeat(5000)];
    await expect(consultarProcesso(orgId, NUM, {})).rejects.toMatchObject({ code: 'eproc.unavailable' });
  });

  it('SSRF: endpoint privado sem allowPrivateHosts é bloqueado', async () => {
    await saveIntegration(orgId, 'EPROC', cfg({ allowPrivateHosts: false }));
    await expect(consultarProcesso(orgId, NUM, {})).rejects.toBeDefined();
    expect(srv.hits).toHaveLength(0);
  });

  it('não configurado → eproc.not_configured', async () => {
    const other = await makeOrg();
    await expect(consultarProcesso(other.id, NUM, {})).rejects.toMatchObject({ code: 'eproc.not_configured' });
  });

  it('registra logIntegration sem número do processo nem CPF', async () => {
    await consultarProcesso(orgId, NUM, { viewerDocument: '52998224725' });
    respond = () => [200, ok('', false, 'Processo não encontrado')];
    await consultarProcesso(orgId, NUM, {}).catch(() => undefined);
    const logs = await prisma.bvIntegrationLog.findMany({ where: { orgId, type: 'EPROC' } });
    expect(logs.length).toBe(2);
    expect(logs.some((l) => l.ok && l.durationMs != null)).toBe(true);
    expect(logs.find((l) => !l.ok)?.error).toBe('eproc.not_found');
    expect(JSON.stringify(logs)).not.toContain('0001234'); expect(JSON.stringify(logs)).not.toContain('52998224725');
  });

  it('modo REST', async () => {
    await srv.close();
    srv = await listen((r) => {
      if (r.headers.authorization !== 'Bearer tok-rest') return [401, {}];
      if (r.path.includes(encodeURIComponent(NUM))) return [200, { processo: { numero: NUM, classe: 'Execução Fiscal', assuntos: ['IPTU', 'Dívida Ativa'], orgaoJulgador: 'Vara Fiscal', situacao: 'Suspenso', dataAutuacao: '2023-05-01', partes: [{ polo: 'AT', nome: 'Município de Palmas', documento: '00000000000191' }], movimentos: [{ data: '2023-06-01T10:00:00Z', descricao: 'Citação' }, { data: '2023-07-01T10:00:00Z', descricao: 'Penhora' }] } }];
      return [404, {}];
    });
    await saveIntegration(orgId, 'EPROC', { mode: 'rest', endpoint: `${srv.url}/api`, token: 'tok-rest', allowPrivateHosts: true, retries: 0 });
    const { processo } = await consultarProcesso(orgId, NUM, { movimentos: true });
    expect(processo).toMatchObject({ classe: 'Execução Fiscal', assunto: 'IPTU; Dívida Ativa', situacao: 'Suspenso' });
    expect(processo.ultimosMovimentos[0].descricao).toBe('Penhora');
    const other = '0000001-' + cnjCheckDigits('0000001', '2024', '8', '27', '0001') + '.2024.8.27.0001';
    await expect(consultarProcesso(orgId, other, {})).rejects.toMatchObject({ code: 'eproc.not_found' });
  });

  it('rota REST: permissão, auditoria com número mascarado, erros mapeados e isolamento entre órgãos', async () => {
    const user = await makeUser(orgId, 'ATENDENTE');
    const fiscal = await makeUser(orgId, 'FISCAL');
    const noAuth = await app.inject({ method: 'GET', url: `/balcao/integrations/eproc/processo/${NUM}` });
    expect(noAuth.statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: `/balcao/integrations/eproc/processo/${NUM}`, headers: authHeader(fiscal) })).statusCode).toBe(403);
    const r = await app.inject({ method: 'GET', url: `/balcao/integrations/eproc/processo/${NUM}`, headers: authHeader(user) });
    expect(r.statusCode).toBe(200);
    expect(r.json().processo.numero).toBe(NUM);
    expect(r.json().processo.partes[0].nome).toContain('*');
    const audits = await prisma.bvAuditLog.findMany({ where: { orgId, action: 'eproc.consulta' } });
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits)).not.toContain('0001234'); expect(JSON.stringify(audits)).toContain('****234');
    expect((await app.inject({ method: 'GET', url: '/balcao/integrations/eproc/processo/123', headers: authHeader(user) })).statusCode).toBe(400);
    respond = () => [200, ok(processoXml(2))];
    const sig = await app.inject({ method: 'GET', url: `/balcao/integrations/eproc/processo/${NUM}`, headers: authHeader(user) });
    expect(sig.statusCode).toBe(403); expect(sig.body).not.toContain('Maria');
    const org2 = await makeOrg(); const u2 = await makeUser(org2.id, 'ATENDENTE');
    expect((await app.inject({ method: 'GET', url: `/balcao/integrations/eproc/processo/${NUM}`, headers: authHeader(u2) })).statusCode).toBe(409);
  });

  it('ferramenta do bot: exige ouro, resume sem partes se não for parte, com partes (mascaradas) se for', async () => {
    clearBotTools();
    registerEprocTool();
    const tool = getBotTool('eproc.consultar_processo')!;
    expect(tool.minIdentityLevel).toBe('ouro');
    expect(identitySatisfies('prata', tool.minIdentityLevel)).toBe(false);
    expect(identitySatisfies('ouro', tool.minIdentityLevel)).toBe(true);
    const ing = await ingestInbound({ orgId, channel: 'WEBCHAT', channelRef: 'v-eproc', externalId: 'v-eproc', message: { body: 'oi' } });
    const ctx = { orgId, conversationId: ing.conversation.id, contactId: ing.contactId, channel: 'WEBCHAT' as const, identityLevel: 'ouro' as const };
    const a: any = await tool.handler(ctx, { numero: NUM });
    expect(a.ok).toBe(true); expect(a.data.partes).toBeUndefined(); expect(a.data.consultanteEhParte).toBe(false);
    expect(a.data.classe).toBe('Procedimento Comum Cível');
    await setContactDocument(ing.contactId, '52998224725');
    const b: any = await tool.handler(ctx, { numero: NUM });
    expect(b.data.partes).toHaveLength(2); expect(b.data.partes[0].nome).toContain('*');
    respond = () => [200, ok(processoXml(1))];
    const c: any = await tool.handler(ctx, { numero: NUM });
    expect(c.ok).toBe(false); expect(c.message).not.toContain('Maria'); expect(c.data).toBeUndefined();
    expect((await tool.handler(ctx, { numero: 'abc' })).ok).toBe(false);
  });
});
