import {
  applyUpdate, attachmentRejectedMessage, buildListQuery, buildTemplateParams, buildTimeline, deliveryInfo, failedOutsideWindow, filterCanned, findSlashToken, formatCnj,
  looksLikeProtocol, matchesSearch, mergeDetailMessages, neighborId, normalizeShortcut, prependMessages, replaceRange, resendErrorMessage, shortcutError, slaInfo, statusAnnouncement, sortConversations, templateInfo, upsertMessage, validCnj, waitSeconds, windowExpired,
} from '../lib';
import type { ChatMessage, ConvListItem } from '../types';

const NOW = Date.parse('2026-03-10T12:00:00Z');
const iso = (secAgo: number) => new Date(NOW - secAgo * 1000).toISOString();
const conv = (o: Partial<ConvListItem> & { id: string }): ConvListItem => ({
  protocol: `BV-2026-${o.id}`, channel: 'WHATSAPP', status: 'WAITING', priority: 0, category: null, intent: null, subject: null, contactId: 'c1', queueId: null, assignedUserId: null,
  startedAt: iso(1000), queuedAt: iso(500), assignedAt: null, firstResponseAt: null, closedAt: null, closeReason: null, slaFirstResponseDueAt: null, slaResolutionDueAt: null,
  slaBreached: false, transferCount: 0, lastMessageAt: iso(100), lastInboundAt: iso(100), unreadForAgent: 0, botHandled: false, csatScore: null, waitSec: null,
  contact: { id: 'c1', name: 'Maria da Conceição', category: 'CIDADAO' }, queue: null, assignee: null, ...o,
});
const msg = (o: Partial<ChatMessage> & { id: string }): ChatMessage => ({
  direction: 'OUT', senderType: 'AGENT', senderUserId: 'u1', kind: 'TEXT', body: 'oi', attachments: null, status: 'SENT', errorCode: null, createdAt: iso(10), ...o,
});

describe('ordenação', () => {
  const a = conv({ id: 'a', priority: 0, queuedAt: iso(900), lastMessageAt: iso(50) });
  const b = conv({ id: 'b', priority: 3, queuedAt: iso(100), lastMessageAt: iso(10) });
  const c = conv({ id: 'c', priority: 3, queuedAt: iso(400), lastMessageAt: iso(300) });
  const d = conv({ id: 'd', status: 'ACTIVE', priority: 9, queuedAt: null, lastMessageAt: iso(5) });
  it('prioridade: maior prioridade primeiro, depois quem espera há mais tempo', () => {
    expect(sortConversations([a, b, c], 'priority').map((x) => x.id)).toEqual(['c', 'b', 'a']);
  });
  it('espera: fila primeiro, maior espera no topo', () => {
    expect(sortConversations([b, d, a, c], 'wait').map((x) => x.id)).toEqual(['a', 'c', 'b', 'd']);
  });
  it('recentes: última atividade', () => {
    expect(sortConversations([a, c, d, b], 'recent').map((x) => x.id)).toEqual(['d', 'b', 'a', 'c']);
  });
  it('não altera o array original', () => {
    const arr = [a, b]; sortConversations(arr, 'priority'); expect(arr[0].id).toBe('a');
  });
});

describe('espera e SLA', () => {
  it('waitSeconds só na fila', () => {
    expect(waitSeconds(conv({ id: 'x' }), NOW)).toBe(500);
    expect(waitSeconds(conv({ id: 'x', status: 'ACTIVE' }), NOW)).toBeNull();
  });
  it('slaInfo: no prazo, a vencer, vencido, não se aplica', () => {
    const base = conv({ id: 'x', status: 'ACTIVE' });
    expect(slaInfo({ ...base, slaFirstResponseDueAt: new Date(NOW + 3600_000).toISOString() }, NOW)).toMatchObject({ tone: 'success', kind: 'Primeira resposta' });
    expect(slaInfo({ ...base, slaFirstResponseDueAt: new Date(NOW + 120_000).toISOString() }, NOW)).toMatchObject({ tone: 'warning' });
    expect(slaInfo({ ...base, slaFirstResponseDueAt: new Date(NOW - 60_000).toISOString() }, NOW)).toMatchObject({ tone: 'danger', label: 'SLA vencido' });
    expect(slaInfo({ ...base, firstResponseAt: iso(10), slaResolutionDueAt: new Date(NOW + 7200_000).toISOString() }, NOW)).toMatchObject({ kind: 'Resolução' });
    expect(slaInfo({ ...base, slaBreached: true }, NOW)).toMatchObject({ tone: 'danger', label: 'SLA violado' });
    expect(slaInfo({ ...base }, NOW)).toBeNull();
    expect(slaInfo({ ...base, status: 'CLOSED', slaBreached: true }, NOW)).toBeNull();
  });
});

describe('busca e consulta', () => {
  it('matchesSearch ignora acentos e exige todas as palavras', () => {
    const c = conv({ id: 'x', subject: 'Certidão negativa' });
    expect(matchesSearch(c, 'conceicao maria')).toBe(true);
    expect(matchesSearch(c, 'certidao')).toBe(true);
    expect(matchesSearch(c, 'maria joao')).toBe(false);
    expect(matchesSearch(c, '  ')).toBe(true);
  });
  it('looksLikeProtocol', () => {
    expect(looksLikeProtocol('BV-2026-12')).toBe(true);
    expect(looksLikeProtocol('2026')).toBe(true);
    expect(looksLikeProtocol('maria')).toBe(false);
  });
  it('buildListQuery por aba', () => {
    const f = { text: '', channel: '', status: '', sort: 'recent' as const };
    expect(buildListQuery('mine', f)).toMatchObject({ mine: true, status: 'ACTIVE', sort: 'recent' });
    expect(buildListQuery('queue', { ...f, sort: 'wait' })).toMatchObject({ unassigned: true, status: 'WAITING', sort: 'priority' });
    expect(buildListQuery('all', { ...f, channel: 'EMAIL', text: 'BV-2026' }, 'cur')).toMatchObject({ status: 'BOT,WAITING,ACTIVE', channel: 'EMAIL', protocol: 'BV-2026', cursor: 'cur' });
    expect(buildListQuery('all', { ...f, text: 'maria' }).protocol).toBeUndefined();
  });
  it('applyUpdate zera o atendente quando a atribuição muda', () => {
    const c = conv({ id: 'x', assignedUserId: 'u1', assignee: { id: 'u1', name: 'Ana' } });
    expect(applyUpdate(c, { assignedUserId: 'u2', status: 'ACTIVE' })).toMatchObject({ assignedUserId: 'u2', assignee: null, status: 'ACTIVE' });
    expect(applyUpdate(c, { unreadForAgent: 0 }).assignee).toEqual({ id: 'u1', name: 'Ana' });
  });
  it('neighborId', () => {
    expect(neighborId(['a', 'b', 'c'], 'b', 1)).toBe('c');
    expect(neighborId(['a', 'b', 'c'], 'c', 1)).toBe('c');
    expect(neighborId(['a', 'b', 'c'], null, 1)).toBe('a');
    expect(neighborId(['a', 'b', 'c'], null, -1)).toBe('c');
    expect(neighborId([], 'a', 1)).toBeNull();
  });
});

describe('mensagens', () => {
  it('upsertMessage substitui por id e mantém a ordem', () => {
    const l = [msg({ id: '1', createdAt: iso(30) }), msg({ id: '2', createdAt: iso(20) })];
    expect(upsertMessage(l, msg({ id: '2', status: 'DELIVERED', createdAt: iso(20) }))[1].status).toBe('DELIVERED');
    expect(upsertMessage(l, msg({ id: '0', createdAt: iso(40) })).map((m) => m.id)).toEqual(['0', '1', '2']);
    expect(upsertMessage(l, msg({ id: '3', createdAt: iso(5) })).map((m) => m.id)).toEqual(['1', '2', '3']);
  });
  it('deliveryInfo', () => {
    expect(deliveryInfo('READ', null).label).toMatch(/Lida/);
    expect(deliveryInfo('FAILED', 'whatsapp.outside_window')).toMatchObject({ failed: true, tone: 'danger' });
    expect(deliveryInfo('FAILED', 'xyz').label).toContain('xyz');
  });
  it('janela do WhatsApp', () => {
    expect(windowExpired(iso(3600), NOW)).toBe(false);
    expect(windowExpired(iso(25 * 3600), NOW)).toBe(true);
    expect(windowExpired(null, NOW)).toBe(true);
    const failed = msg({ id: 'f', status: 'FAILED', errorCode: 'whatsapp.outside_window', createdAt: iso(60) });
    expect(failedOutsideWindow([failed], iso(3600))).toBe(true);
    expect(failedOutsideWindow([failed], iso(10))).toBe(false); // cidadão escreveu depois
  });
  it('linha do tempo com separador de dia e eventos', () => {
    const items = buildTimeline(
      [msg({ id: '1', createdAt: '2026-03-09T10:00:00Z' }), msg({ id: '2', createdAt: '2026-03-10T10:00:00Z' })],
      [{ id: 'e1', type: 'CLOSED', actorUserId: null, data: { reason: 'RESOLVED' }, createdAt: '2026-03-10T11:00:00Z' }, { id: 'e2', type: 'BOT_REPLY', actorUserId: null, data: null, createdAt: '2026-03-10T11:01:00Z' }],
      'u1', (iso) => iso.slice(0, 10),
    );
    expect(items.map((i) => i.type)).toEqual(['day', 'message', 'day', 'message', 'event']);
    expect((items[4] as any).text).toContain('Resolvido');
  });
});

describe('respostas prontas', () => {
  it('findSlashToken', () => {
    expect(findSlashToken('/ola', 4)).toEqual({ start: 0, end: 4, query: 'ola' });
    expect(findSlashToken('Bom dia /pro', 12)).toEqual({ start: 8, end: 12, query: 'pro' });
    expect(findSlashToken('http://x', 8)).toBeNull();
    expect(findSlashToken('abc/def', 7)).toBeNull();
    expect(findSlashToken('/', 1)).toEqual({ start: 0, end: 1, query: '' });
  });
  it('filterCanned prioriza prefixo do atalho', () => {
    const items = [
      { id: '1', shortcut: 'protocolo', title: 'Informar protocolo', body: 'x' },
      { id: '2', shortcut: 'ola', title: 'Saudação protocolo', body: 'y' },
      { id: '3', shortcut: 'prazo', title: 'Prazos', body: 'z' },
    ];
    expect(filterCanned(items, 'pro').map((c) => c.id)).toEqual(['1', '2']);
    expect(filterCanned(items, '').length).toBe(3);
    expect(filterCanned(items, 'zzz')).toEqual([]);
  });
  it('filterCanned lista pessoais primeiro e oculta a do órgão sobrescrita', () => {
    const items = [
      { id: 'o1', shortcut: 'ola', title: 'Saudação', body: 'org', scope: 'ORG' as const },
      { id: 'p1', shortcut: 'ola', title: 'Minha saudação', body: 'pessoal', scope: 'PERSONAL' as const, shadowsOrg: true },
      { id: 'o2', shortcut: 'olhar', title: 'Olhar', body: 'org', scope: 'ORG' as const },
      { id: 'o3', shortcut: 'ola', title: 'Saudação (sobrescrita)', body: 'org', scope: 'ORG' as const, shadowed: true },
    ];
    expect(filterCanned(items, '').map((c) => c.id)).toEqual(['p1', 'o1', 'o2']);
    expect(filterCanned(items, 'ol').map((c) => c.id)).toEqual(['p1', 'o1', 'o2']);
  });
  it('atalho: normaliza e valida', () => {
    expect(normalizeShortcut(' /Prazo ')).toBe('prazo');
    expect(shortcutError('prazo-1')).toBeNull();
    expect(shortcutError('')).not.toBeNull();
    expect(shortcutError('com espaço')).not.toBeNull();
    expect(shortcutError('ação')).not.toBeNull();
    expect(shortcutError('a'.repeat(33))).not.toBeNull();
  });
  it('replaceRange', () => {
    expect(replaceRange('Olá /ola agora', 4, 8, 'Bom dia')).toEqual({ text: 'Olá Bom dia agora', caret: 11 });
  });
});

describe('CNJ', () => {
  // 0000001-65.2020.8.27.0000 → DV calculado pela fórmula da Res. CNJ 65
  const dv = (n: string, aaaa: string, jtr: string, oooo: string) => { let r = 0; for (const ch of n + aaaa + jtr + oooo + '00') r = (r * 10 + Number(ch)) % 97; return String(98 - r).padStart(2, '0'); };
  it('formata progressivamente', () => {
    expect(formatCnj('0000001')).toBe('0000001');
    expect(formatCnj('000000165')).toBe('0000001-65');
    expect(formatCnj('00000016520208270000')).toBe('0000001-65.2020.8.27.0000');
    expect(formatCnj('0000001-65.2020.8.27.0000999')).toBe('0000001-65.2020.8.27.0000');
  });
  it('valida o dígito verificador', () => {
    const d = dv('0000001', '2020', '827', '0000');
    expect(validCnj(`0000001${d}20208270000`)).toBe(true);
    expect(validCnj(`0000001${d === '00' ? '01' : '00'}20208270000`)).toBe(false);
    expect(validCnj('123')).toBe(false);
  });
});

describe('modelos do WhatsApp', () => {
  const comps = [{ type: 'HEADER', format: 'TEXT', text: 'Olá {{1}}' }, { type: 'BODY', text: 'Seu protocolo {{1}} foi atualizado: {{2}}.' }, { type: 'FOOTER', text: 'TJTO' }];
  it('templateInfo conta variáveis', () => {
    expect(templateInfo(comps)).toMatchObject({ headerVars: 1, bodyVars: 2, mediaHeader: false, footerText: 'TJTO' });
    expect(templateInfo([{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'x' }]).mediaHeader).toBe(true);
  });
  it('buildTemplateParams', () => {
    expect(buildTemplateParams(templateInfo([{ type: 'BODY', text: 'a {{1}} b {{2}} c' }]), [], [' x ', 'y'])).toEqual(['x', 'y']);
    expect(buildTemplateParams(templateInfo(comps), ['Ana'], ['1', '2'])).toEqual({ header: ['Ana'], body: ['1', '2'] });
    expect(buildTemplateParams(templateInfo([{ type: 'BODY', text: 'sem variáveis' }]), [], [])).toBeUndefined();
  });
});

describe('reenvio, anexos recusados e histórico', () => {
  it('mensagens de erro do reenvio', () => {
    expect(resendErrorMessage(409, 'message.not_resendable', 'x')).toMatch(/não pode mais ser reenviada/);
    expect(resendErrorMessage(409, 'conversation.closed', 'x')).toMatch(/encerrada/);
    expect(resendErrorMessage(403, 'message.not_owner', 'x')).toMatch(/autor/);
    expect(resendErrorMessage(500, 'http.500', 'falha')).toBe('falha');
  });
  it('anexo recusado', () => {
    expect(attachmentRejectedMessage({ reason: 'infected' })).toBe('O arquivo foi recusado pelo antivírus.');
    expect(attachmentRejectedMessage({ reason: 'scan_unavailable' })).toBe('Não foi possível verificar o arquivo agora; tente novamente.');
    expect(attachmentRejectedMessage(undefined)).toMatch(/recusado/);
  });
  it('mantém mensagens antigas já carregadas ao atualizar a página mais recente', () => {
    const old = { messages: [msg({ id: 'a', createdAt: iso(500) }), msg({ id: 'b', createdAt: iso(400) }), msg({ id: 'c', createdAt: iso(300) })], hasMore: false, nextBefore: null };
    const fresh = { messages: [msg({ id: 'c', createdAt: iso(300), status: 'DELIVERED' }), msg({ id: 'd', createdAt: iso(100) })], hasMore: true, nextBefore: 'c' };
    const r = mergeDetailMessages(old, fresh);
    expect(r.messages.map((m) => m.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(r.messages[2].status).toBe('DELIVERED');
    expect(r.hasMore).toBe(false); // o cursor continua o da mais antiga carregada
    expect(mergeDetailMessages(null, fresh)).toEqual({ messages: fresh.messages, hasMore: true, nextBefore: 'c' });
  });
  it('prependMessages não repete ids', () => {
    const list = [msg({ id: 'b', createdAt: iso(400) })];
    expect(prependMessages(list, [msg({ id: 'a', createdAt: iso(500) }), msg({ id: 'b', createdAt: iso(400) })]).map((m) => m.id)).toEqual(['a', 'b']);
  });
  it('anúncio de status', () => {
    expect(statusAnnouncement('SENT', 'SENT', null)).toBeNull();
    expect(statusAnnouncement('QUEUED', 'FAILED', 'whatsapp.outside_window')).toMatch(/Falha no envio/);
    expect(statusAnnouncement('FAILED', 'SENT', null)).toMatch(/reenviada/);
    expect(statusAnnouncement('QUEUED', 'SENT', null)).toBeNull();
  });
});
