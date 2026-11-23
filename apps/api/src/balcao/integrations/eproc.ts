import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import { getIntegration } from '../core/integrations';
import { maskDocument, normalizeDocument } from '../core/contacts';
import { registerBotTool } from '../core/tools';
import { prisma } from '../../lib/prisma';
import { getContactDocument } from '../core/contacts';
import { logged, type Deps } from './common';
import { httpClientFor, IntegrationError, parseJsonSafe, type HttpClient, type HttpResponse } from './http-client';

/**
 * e-Proc (TJTO) — cliente do MNI (Modelo Nacional de Interoperabilidade do CNJ, SOAP/XML) com modo REST alternativo.
 * Só a operação `consultarProcesso` (consulta). Nada de petição/intimação no MVP.
 */

export const eprocConfigSchema = z.object({
  mode: z.enum(['soap', 'rest']).default('soap'),
  endpoint: z.string().url().max(500),
  wsdlUrl: z.string().url().max(500).optional(),
  wsdlNamespace: z.string().max(300).default('http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/'),
  tiposNamespace: z.string().max(300).default('http://www.cnj.jus.br/tipos-servico-intercomunicacao-2.2.2'),
  soapAction: z.string().max(200).default(''),
  idConsultante: z.string().max(200).optional(),
  senhaConsultante: z.string().max(500).optional(),
  token: z.string().max(4000).optional(),
  timeoutMs: z.number().int().min(500).max(60_000).default(10_000),
  retries: z.number().int().min(0).max(3).default(1),
  retryDelayMs: z.number().int().min(0).max(5000).default(300),
  maxResponseBytes: z.number().int().min(1024).max(20 * 1024 * 1024).default(2 * 1024 * 1024),
  maxMovimentos: z.number().int().min(1).max(50).default(10),
  maskPartyNames: z.boolean().default(true),
  /** Tabelas TPU opcionais: código nacional → descrição (classes, assuntos, movimentos). */
  tpu: z.object({
    classes: z.record(z.string(), z.string()).default({}), assuntos: z.record(z.string(), z.string()).default({}), movimentos: z.record(z.string(), z.string()).default({}),
  }).default({ classes: {}, assuntos: {}, movimentos: {} }),
  allowPrivateHosts: z.boolean().optional(),
}).superRefine((c, ctx) => {
  if (c.mode === 'soap' && !(c.idConsultante && c.senhaConsultante)) ctx.addIssue({ code: 'custom', path: ['idConsultante'], message: 'idConsultante e senhaConsultante são obrigatórios no modo SOAP' });
  if (c.mode === 'rest' && !c.token) ctx.addIssue({ code: 'custom', path: ['token'], message: 'token é obrigatório no modo REST' });
});
export type EprocConfig = z.infer<typeof eprocConfigSchema>;
export const EPROC_SECRETS = ['senhaConsultante', 'token'];

// ── Número CNJ ──────────────────────────────────────────────────────────────────────────────────
/** NNNNNNN-DD.AAAA.J.TR.OOOO com dígito verificador (mod 97, ISO 7064). Retorna o número formatado ou null. */
export function normalizeCnj(input: string): string | null {
  const s = String(input ?? '').trim();
  const m = /^(\d{7})-?(\d{2})\.?(\d{4})\.?(\d)\.?(\d{2})\.?(\d{4})$/.exec(s);
  if (!m) return null;
  const [, n, dd, aaaa, j, tr, oooo] = m;
  if (j === '0' || Number(aaaa) < 1900 || Number(aaaa) > 2200) return null;
  const rem = BigInt(`${n}${aaaa}${j}${tr}${oooo}${dd}`) % 97n;
  if (rem !== 1n) return null;
  return `${n}-${dd}.${aaaa}.${j}.${tr}.${oooo}`;
}
export const isValidCnj = (s: string) => normalizeCnj(s) !== null;
/** Calcula o DD correto (útil em testes/fixtures). */
export function cnjCheckDigits(n: string, aaaa: string, j: string, tr: string, oooo: string): string {
  const rem = BigInt(`${n}${aaaa}${j}${tr}${oooo}00`) % 97n;
  return String(98n - rem).padStart(2, '0');
}
/** Mascara o sequencial para auditoria/log: ****567-DD.AAAA.J.TR.OOOO. */
export const maskCnj = (cnj: string) => cnj.replace(/^\d{4}(\d{3})/, '****$1');

// ── Saneamento ──────────────────────────────────────────────────────────────────────────────────
const CPF_RE = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
export function sanitizeText(v: unknown, max = 200): string {
  const s = String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f<>]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.replace(CPF_RE, (d) => maskDocument(normalizeDocument(d))).slice(0, max);
}
const CONNECTORS = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);
/** "Maria da Silva" → "M**** da S****". */
export function maskName(name: string): string {
  return name.split(' ').filter(Boolean).map((t) => (CONNECTORS.has(t.toLowerCase()) || t.length <= 1 ? t : `${t[0]}${'*'.repeat(Math.min(t.length - 1, 6))}`)).join(' ');
}

// ── Tipos normalizados ──────────────────────────────────────────────────────────────────────────
export type PoloNome = 'ATIVO' | 'PASSIVO' | 'TERCEIRO' | 'FISCAL_DA_LEI' | 'OUTRO';
export interface ProcessoResumo {
  numero: string;
  classe: string;
  assunto: string;
  orgaoJulgador: string;
  situacao: string;
  dataAutuacao: string | null;
  partes: Array<{ polo: PoloNome; nome: string }>;
  ultimosMovimentos: Array<{ data: string | null; descricao: string }>;
}
export interface ConsultaResultado { processo: ProcessoResumo; /** CPF/CNPJ informado consta como parte ou advogado no processo. */ consultanteEhParte: boolean }
export interface ConsultaOpts { movimentos?: boolean; viewerDocument?: string | null }

const POLOS: Record<string, PoloNome> = { AT: 'ATIVO', PA: 'PASSIVO', TC: 'TERCEIRO', FL: 'FISCAL_DA_LEI' };
const arr = <T = any>(v: unknown): T[] => (v == null ? [] : Array.isArray(v) ? (v as T[]) : [v as T]);
const txt = (v: unknown): string => (v == null ? '' : typeof v === 'object' ? sanitizeText((v as any)['#text'] ?? '') : sanitizeText(v));

/** `yyyyMMddHHmmss` (MNI) ou ISO → ISO com fuso de Tocantins (-03:00). */
export function mniDate(v: unknown): string | null {
  const s = String(v ?? '').trim();
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}-03:00`;
  const d = new Date(s);
  return s && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
}

// ── SOAP ────────────────────────────────────────────────────────────────────────────────────────
const xmlEsc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));

export function buildConsultarProcessoEnvelope(cfg: Pick<EprocConfig, 'wsdlNamespace' | 'tiposNamespace' | 'idConsultante' | 'senhaConsultante'>, numero: string, movimentos: boolean): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="${xmlEsc(cfg.wsdlNamespace)}" xmlns:tip="${xmlEsc(cfg.tiposNamespace)}">
<soapenv:Header/>
<soapenv:Body>
<ser:consultarProcesso>
<tip:idConsultante>${xmlEsc(cfg.idConsultante ?? '')}</tip:idConsultante>
<tip:senhaConsultante>${xmlEsc(cfg.senhaConsultante ?? '')}</tip:senhaConsultante>
<tip:numeroProcesso>${xmlEsc(numero.replace(/\D/g, ''))}</tip:numeroProcesso>
<tip:movimentos>${movimentos ? 'true' : 'false'}</tip:movimentos>
<tip:incluirCabecalho>true</tip:incluirCabecalho>
<tip:incluirDocumentos>false</tip:incluirDocumentos>
</ser:consultarProcesso>
</soapenv:Body>
</soapenv:Envelope>`;
}

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true, parseTagValue: false, parseAttributeValue: false, trimValues: true });

interface Parsed { processo: ProcessoResumo; partyDocs: Set<string> }

/** Interpreta a resposta MNI. Lança IntegrationError com códigos `eproc.*` (fault, sigiloso, não encontrado, resposta inválida). */
export function parseMniResponse(body: string, cfg: Pick<EprocConfig, 'maxMovimentos' | 'maskPartyNames' | 'tpu'>, includeMovs: boolean): Parsed {
  if (/<!DOCTYPE|<!ENTITY/i.test(body)) throw new IntegrationError('eproc.bad_response', 'Resposta inválida');
  let doc: any;
  try { doc = xml.parse(body); } catch { throw new IntegrationError('eproc.bad_response', 'Resposta inválida'); }
  const b = doc?.Envelope?.Body;
  if (!b) throw new IntegrationError('eproc.bad_response', 'Resposta inválida');
  if (b.Fault) throw new IntegrationError('eproc.soap_fault', `SOAP Fault: ${sanitizeText(b.Fault.faultcode ?? b.Fault.Code?.Value ?? '', 60)}`, undefined, false);
  const r = b.consultarProcessoResposta ?? b.consultarProcessoResponse;
  if (!r) throw new IntegrationError('eproc.bad_response', 'Resposta inválida');

  const sucesso = String(r.sucesso ?? '').toLowerCase() === 'true';
  const msg = txt(r.mensagem);
  if (!sucesso) {
    if (/sigilo|segredo|restrit|sem permiss|acesso negado|n[aã]o autorizado/i.test(msg)) throw new IntegrationError('eproc.sigiloso', 'Processo sigiloso ou sem permissão');
    if (/n[aã]o encontrad|inexistente|n[aã]o existe/i.test(msg)) throw new IntegrationError('eproc.not_found', 'Processo não encontrado');
    if (/senha|consultante|credencia|autentica/i.test(msg)) throw new IntegrationError('eproc.auth', 'Credencial do consultante recusada');
    throw new IntegrationError('eproc.bad_response', 'Consulta recusada pelo e-Proc');
  }
  const p = r.processo;
  const db = p?.dadosBasicos;
  if (!p || !db) throw new IntegrationError('eproc.not_found', 'Processo não encontrado');
  if (Number(db['@_nivelSigilo'] ?? 0) > 0) throw new IntegrationError('eproc.sigiloso', 'Processo sigiloso ou sem permissão');

  const numero = normalizeCnj(String(db['@_numero'] ?? '')) ?? '';
  if (!numero) throw new IntegrationError('eproc.bad_response', 'Resposta inválida');

  const classeCod = String(db['@_classeProcessual'] ?? '');
  const classe = sanitizeText(db['@_classeProcessualNome'] ?? cfg.tpu.classes[classeCod] ?? (classeCod ? `Classe ${classeCod}` : ''), 120);

  const assuntos = arr(db.assunto).map((a: any) => {
    const cod = String(a?.codigoNacional ?? a?.['@_codigoNacional'] ?? '');
    return sanitizeText(a?.descricao ?? a?.assuntoLocal?.descricao ?? cfg.tpu.assuntos[cod] ?? (cod ? `Assunto ${cod}` : ''), 120);
  }).filter(Boolean).slice(0, 3);

  const oj = db.orgaoJulgador ?? {};
  const outro = arr(db.outroParametro).find((o: any) => /situa/i.test(String(o?.['@_nome'] ?? '')));
  const situacao = sanitizeText(db['@_situacao'] ?? outro?.['@_valor'] ?? 'Em andamento', 80);

  const partes: ProcessoResumo['partes'] = [];
  const partyDocs = new Set<string>();
  for (const polo of arr(db.polo)) {
    const poloNome = POLOS[String(polo?.['@_polo'] ?? '').toUpperCase()] ?? 'OUTRO';
    for (const parte of arr(polo?.parte)) {
      const pessoa = parte?.pessoa ?? {};
      const doc = normalizeDocument(String(pessoa['@_numeroDocumentoPrincipal'] ?? ''));
      if (doc) partyDocs.add(doc);
      for (const adv of arr(parte?.advogado)) { const d = normalizeDocument(String(adv?.['@_numeroDocumentoPrincipal'] ?? '')); if (d) partyDocs.add(d); }
      const nome = sanitizeText(pessoa['@_nome'], 120);
      if (nome && partes.length < 40) partes.push({ polo: poloNome, nome: cfg.maskPartyNames ? maskName(nome) : nome });
    }
  }

  let ultimosMovimentos: ProcessoResumo['ultimosMovimentos'] = [];
  if (includeMovs) {
    ultimosMovimentos = arr(p.movimento)
      .filter((m: any) => Number(m?.['@_nivelSigilo'] ?? 0) === 0)
      .map((m: any) => {
        const cod = String(m?.movimentoNacional?.['@_codigoNacional'] ?? '');
        const comp = arr(m?.complemento).map((c) => txt(c)).filter(Boolean).join('; ');
        const base = sanitizeText(m?.movimentoLocal?.['@_descricao'] ?? m?.['@_descricao'] ?? cfg.tpu.movimentos[cod] ?? (cod ? `Movimento ${cod}` : 'Movimento'), 140);
        return { data: mniDate(m?.['@_dataHora']), descricao: sanitizeText(comp ? `${base}: ${comp}` : base, 200) };
      })
      .sort((a, b) => String(b.data ?? '').localeCompare(String(a.data ?? '')))
      .slice(0, cfg.maxMovimentos);
  }

  return {
    partyDocs,
    processo: { numero, classe, assunto: assuntos.join('; '), orgaoJulgador: sanitizeText(oj['@_nomeOrgao'] ?? oj['@_codigoOrgao'] ?? '', 120), situacao, dataAutuacao: mniDate(db['@_dataAjuizamento']), partes, ultimosMovimentos },
  };
}

/** REST alternativo: espera JSON {numero, classe, assunto|assuntos, orgaoJulgador, situacao, dataAutuacao, nivelSigilo, partes:[{polo,nome,documento?}], movimentos:[{data,descricao}]}. */
export function parseRestResponse(json: any, cfg: Pick<EprocConfig, 'maxMovimentos' | 'maskPartyNames'>, includeMovs: boolean): Parsed {
  const d = json?.processo ?? json;
  if (!d || typeof d !== 'object') throw new IntegrationError('eproc.bad_response', 'Resposta inválida');
  if (Number(d.nivelSigilo ?? 0) > 0 || d.sigiloso === true || d.segredoJustica === true) throw new IntegrationError('eproc.sigiloso', 'Processo sigiloso ou sem permissão');
  const numero = normalizeCnj(String(d.numero ?? d.numeroProcesso ?? ''));
  if (!numero) throw new IntegrationError('eproc.bad_response', 'Resposta inválida');
  const partyDocs = new Set<string>();
  const partes: ProcessoResumo['partes'] = [];
  for (const p of arr(d.partes).slice(0, 40)) {
    const doc = normalizeDocument(String(p?.documento ?? ''));
    if (doc) partyDocs.add(doc);
    const nome = sanitizeText(p?.nome, 120);
    const polo = POLOS[String(p?.polo ?? '').toUpperCase()] ?? (['ATIVO', 'PASSIVO', 'TERCEIRO', 'FISCAL_DA_LEI'].includes(String(p?.polo).toUpperCase()) ? (String(p.polo).toUpperCase() as PoloNome) : 'OUTRO');
    if (nome) partes.push({ polo, nome: cfg.maskPartyNames ? maskName(nome) : nome });
  }
  const movs = includeMovs
    ? arr(d.movimentos ?? d.ultimosMovimentos).map((m: any) => ({ data: mniDate(m?.data ?? m?.dataHora), descricao: sanitizeText(m?.descricao, 200) }))
      .sort((a, b) => String(b.data ?? '').localeCompare(String(a.data ?? ''))).slice(0, cfg.maxMovimentos)
    : [];
  return {
    partyDocs,
    processo: {
      numero, classe: sanitizeText(d.classe, 120), assunto: (Array.isArray(d.assuntos) ? d.assuntos.map((a: unknown) => sanitizeText(a, 120)).slice(0, 3).join('; ') : sanitizeText(d.assunto, 240)),
      orgaoJulgador: sanitizeText(d.orgaoJulgador, 120), situacao: sanitizeText(d.situacao ?? 'Em andamento', 80), dataAutuacao: mniDate(d.dataAutuacao), partes, ultimosMovimentos: movs,
    },
  };
}

// ── Chamada ─────────────────────────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function callWithRetry(cfg: EprocConfig, http: HttpClient, mk: () => Parameters<HttpClient['request']>[0], accept: (r: HttpResponse) => boolean): Promise<HttpResponse> {
  let last: IntegrationError | null = null;
  for (let attempt = 0; attempt <= cfg.retries; attempt++) {
    if (attempt > 0) await sleep(cfg.retryDelayMs);
    try {
      const res = await http.request(mk());
      if (res.status >= 500 && !accept(res)) { last = new IntegrationError('eproc.unavailable', `e-Proc indisponível (HTTP ${res.status})`, res.status, true); continue; }
      return res;
    } catch (err: any) {
      if (err instanceof IntegrationError && err.retryable) { last = new IntegrationError(err.code === 'http.timeout' ? 'eproc.timeout' : 'eproc.unavailable', err.message, undefined, true); continue; }
      if (err instanceof IntegrationError && err.code.startsWith('http.')) throw new IntegrationError('eproc.unavailable', err.message); // SSRF, tamanho, URL
      throw err;
    }
  }
  throw last ?? new IntegrationError('eproc.unavailable', 'e-Proc indisponível');
}

export async function loadEprocConfig(orgId: string): Promise<EprocConfig> {
  const row = await getIntegration<Record<string, any>>(orgId, 'EPROC');
  if (!row || !row.enabled) throw new IntegrationError('eproc.not_configured', 'Integração com o e-Proc não configurada');
  const parsed = eprocConfigSchema.safeParse(row.config);
  if (!parsed.success) throw new IntegrationError('eproc.not_configured', 'Configuração do e-Proc inválida');
  return { ...parsed.data, allowPrivateHosts: row.config.allowPrivateHosts === true };
}

/** Consulta um processo no e-Proc (MNI SOAP ou REST) e devolve o resumo normalizado e saneado. */
export async function consultarProcesso(orgId: string, numeroCNJ: string, opts: ConsultaOpts = {}, deps: Deps = {}): Promise<ConsultaResultado> {
  const numero = normalizeCnj(numeroCNJ);
  if (!numero) throw new IntegrationError('eproc.invalid_number', 'Número de processo inválido');
  const cfg = await loadEprocConfig(orgId);
  const http = deps.http ?? httpClientFor(cfg);
  const movimentos = opts.movimentos ?? true;

  const parsed = await logged(orgId, 'EPROC', 'consultarProcesso', async () => {
    if (cfg.mode === 'rest') {
      const url = `${cfg.endpoint.replace(/\/+$/, '')}/processos/${encodeURIComponent(numero)}?movimentos=${movimentos}`;
      const res = await callWithRetry(cfg, http, () => ({ url, headers: { accept: 'application/json', authorization: `Bearer ${cfg.token}` }, timeoutMs: cfg.timeoutMs }), () => false);
      if (res.status === 404) throw new IntegrationError('eproc.not_found', 'Processo não encontrado', 404);
      if (res.status === 401) throw new IntegrationError('eproc.auth', 'Credencial recusada', 401);
      if (res.status === 403) throw new IntegrationError('eproc.sigiloso', 'Processo sigiloso ou sem permissão', 403);
      if (res.status < 200 || res.status >= 300) throw new IntegrationError('eproc.unavailable', `e-Proc indisponível (HTTP ${res.status})`, res.status);
      const json = parseJsonSafe(res.text);
      if (!json) throw new IntegrationError('eproc.bad_response', 'Resposta inválida');
      return parseRestResponse(json, cfg, movimentos);
    }
    const envelope = buildConsultarProcessoEnvelope(cfg, numero, movimentos);
    const res = await callWithRetry(cfg, http, () => ({
      method: 'POST', url: cfg.endpoint, timeoutMs: cfg.timeoutMs, body: envelope,
      headers: { 'content-type': 'text/xml; charset=utf-8', soapaction: `"${cfg.soapAction}"`, accept: 'text/xml, application/soap+xml' },
    }), (r) => /Fault/.test(r.text));
    if (res.status === 401 || res.status === 403) throw new IntegrationError('eproc.auth', 'Credencial recusada', res.status);
    if (res.status >= 400 && res.status !== 500) throw new IntegrationError('eproc.unavailable', `e-Proc indisponível (HTTP ${res.status})`, res.status);
    return parseMniResponse(res.text, cfg, movimentos);
  }, { mode: cfg.mode });

  const viewer = opts.viewerDocument ? normalizeDocument(opts.viewerDocument) : '';
  return { processo: parsed.processo, consultanteEhParte: !!viewer && parsed.partyDocs.has(viewer) };
}

/** Teste de conexão: SOAP → baixa o WSDL; REST → GET na raiz do endpoint com o token. */
export async function testEproc(cfg: EprocConfig, deps: Deps = {}): Promise<{ ok: boolean; message: string }> {
  const http = deps.http ?? httpClientFor(cfg);
  try {
    if (cfg.mode === 'soap') {
      const url = cfg.wsdlUrl ?? (cfg.endpoint.includes('?') ? cfg.endpoint : `${cfg.endpoint}?wsdl`);
      const res = await http.request({ url, timeoutMs: cfg.timeoutMs });
      if (res.status !== 200 || !/definitions/i.test(res.text)) return { ok: false, message: `WSDL indisponível (HTTP ${res.status})` };
      return { ok: true, message: 'WSDL do MNI acessível' };
    }
    const res = await http.request({ url: cfg.endpoint, headers: { authorization: `Bearer ${cfg.token}` }, timeoutMs: cfg.timeoutMs });
    if (res.status === 401 || res.status === 403) return { ok: false, message: 'Credencial recusada' };
    if (res.status >= 500) return { ok: false, message: `Servidor com erro (HTTP ${res.status})` };
    return { ok: true, message: 'Endpoint REST acessível' };
  } catch (err: any) {
    return { ok: false, message: err instanceof IntegrationError ? err.code : 'Falha de rede' };
  }
}

/** Mensagem amigável (sem detalhes técnicos) para o cidadão. */
export function eprocUserMessage(err: unknown): string {
  const code = err instanceof IntegrationError ? err.code : '';
  switch (code) {
    case 'eproc.invalid_number': return 'O número do processo parece inválido. Confira o formato NNNNNNN-DD.AAAA.J.TR.OOOO.';
    case 'eproc.not_found': return 'Não encontrei esse processo. Confira o número informado.';
    case 'eproc.sigiloso': return 'Não é possível exibir informações deste processo por este canal. Procure o atendimento presencial ou fale com um atendente.';
    default: return 'Não consegui consultar o processo agora. Tente novamente em instantes ou peça para falar com um atendente.';
  }
}

export function eprocHttpStatus(err: unknown): number {
  switch (err instanceof IntegrationError ? err.code : '') {
    case 'eproc.invalid_number': return 400;
    case 'eproc.not_found': return 404;
    case 'eproc.sigiloso': return 403;
    case 'eproc.not_configured': return 409;
    default: return 502;
  }
}

// ── Ferramenta do bot ───────────────────────────────────────────────────────────────────────────
const toolInput = z.object({ numero: z.string().min(10).max(40), movimentos: z.boolean().optional() });

export function registerEprocTool(deps: Deps = {}): void {
  registerBotTool({
    name: 'eproc.consultar_processo',
    description: 'Consulta a situação de um processo judicial pelo número CNJ (NNNNNNN-DD.AAAA.J.TR.OOOO) no e-Proc. Exige identidade GOV.BR nível ouro. Não retorna dados de processos em segredo de justiça.',
    inputSchema: { type: 'object', properties: { numero: { type: 'string', description: 'Número CNJ do processo' }, movimentos: { type: 'boolean', description: 'Incluir últimos andamentos (padrão: sim)' } }, required: ['numero'] },
    minIdentityLevel: 'ouro',
    handler: async (ctx, input) => {
      const p = toolInput.safeParse(input);
      if (!p.success) return { ok: false, message: eprocUserMessage(new IntegrationError('eproc.invalid_number', '')) };
      try {
        const contact = await prisma.bvContact.findFirst({ where: { id: ctx.contactId, orgId: ctx.orgId }, select: { documentEnc: true } });
        const viewerDocument = getContactDocument(contact?.documentEnc ?? null);
        const { processo, consultanteEhParte } = await consultarProcesso(ctx.orgId, p.data.numero, { movimentos: p.data.movimentos ?? true, viewerDocument }, deps);
        // Resumo para o cidadão: partes só aparecem se ele próprio consta no processo (e sempre mascaradas por política).
        return {
          ok: true,
          data: {
            numero: processo.numero, classe: processo.classe, assunto: processo.assunto, orgaoJulgador: processo.orgaoJulgador,
            situacao: processo.situacao, dataAutuacao: processo.dataAutuacao,
            ultimosMovimentos: processo.ultimosMovimentos.slice(0, 5),
            ...(consultanteEhParte ? { partes: processo.partes } : {}),
            consultanteEhParte,
          },
        };
      } catch (err) {
        return { ok: false, message: eprocUserMessage(err) };
      }
    },
  });
}
