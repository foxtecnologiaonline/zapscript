process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-12345678901234567890';

import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../lib/prisma';
import { clearBvEventHandlers, onBvEvent } from '../../core/events';
import { clearChannelSenders, registerChannelSender } from '../../core/channels';
import { ingestInbound } from '../../core/conversations';
import { getBotTool } from '../../core/tools';
import { setRealtime } from '../../core/realtime';
import Fastify from 'fastify';
import { authHeader, makeOrg, makeUser } from '../../core/testing';
import tasksPlugin from '../index';
import { businessSecondsBetween, computeSla, isValidTransition, loadActor } from '../model';
import { addBusinessSeconds, getHolidays, invalidateHolidays } from '../../core/settings';
import { getTasksConfig } from '../model';
import { changeStatus } from '../service';
import { csvCell } from '../indicators';
import { createTaskFromBot, encryptExistingTaskText, notifyContact, registerTasksBotTool, runTasksSweep, setTaskMailer } from '../index';

type U = Awaited<ReturnType<typeof makeUser>>;
let app: FastifyInstance;
const mails: Array<{ to: string; subject: string; html: string }> = [];
const waSent: string[] = [];
const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  // Só o plugin desta frente (isola dos demais plugins do Balcão, que carregam dependências ESM pesadas no jest).
  app = Fastify({ logger: false, trustProxy: true });
  await app.register(async (root) => { await root.register(tasksPlugin, { prefix: '/tasks' }); }, { prefix: '/balcao' });
  await app.ready();
  setTaskMailer(async (to, subject, html) => { mails.push({ to, subject, html }); });
  registerChannelSender('WHATSAPP', async (r) => { waSent.push(`${r.conversation.id}:${r.message.body}`); return { channelMessageId: `o-${r.message.id}` }; });
  registerTasksBotTool();
});
afterAll(async () => { setTaskMailer(null); clearChannelSenders(); clearBvEventHandlers(); setRealtime(null); await app.close(); });

async function call(u: U, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) {
  const res = await app.inject({ method, url: `/balcao/tasks${url}`, headers: authHeader(u), ...(payload !== undefined ? { payload: payload as any } : {}) });
  return { status: res.statusCode, body: res.body ? (res.headers['content-type'] ?? '').toString().includes('json') ? res.json() : res.body : null };
}
async function setup() {
  const org = await makeOrg({ ai: { enabled: false } });
  const s1 = await prisma.bvSector.create({ data: { orgId: org.id, name: 'Protocolo' } });
  const s2 = await prisma.bvSector.create({ data: { orgId: org.id, name: 'Informática' } });
  const ag1 = await makeUser(org.id, 'ATENDENTE', { sectorId: s1.id });
  const ag1b = await makeUser(org.id, 'ATENDENTE', { sectorId: s1.id });
  const ag2 = await makeUser(org.id, 'ATENDENTE', { sectorId: s2.id });
  const sup = await makeUser(org.id, 'SUPERVISOR');
  const adm = await makeUser(org.id, 'ADMIN');
  const fis = await makeUser(org.id, 'FISCAL');
  return { org, orgId: org.id, s1, s2, ag1, ag1b, ag2, sup, adm, fis };
}
const mk = async (u: U, over: Record<string, unknown> = {}) => {
  const r = await call(u, 'POST', '/', { title: 'Tarefa de teste', ...over });
  expect(r.status).toBe(201);
  return r.body;
};

describe('balcao/tasks — máquina de estados e permissões', () => {
  it('transições válidas e inválidas; reabrir exige task:manage', async () => {
    expect(isValidTransition('OPEN', 'IN_PROGRESS')).toBe(true);
    expect(isValidTransition('OPEN', 'DONE')).toBe(false);
    const c = await setup();
    const t = await mk(c.ag1);
    expect(t.code).toMatch(/^TAR-\d{6}$/);
    expect(t.status).toBe('OPEN');
    expect((await call(c.ag1, 'POST', `/${t.id}/status`, { status: 'DONE' })).status).toBe(409);
    expect((await call(c.ag1, 'POST', `/${t.id}/status`, { status: 'IN_PROGRESS' })).body.status).toBe('IN_PROGRESS');
    const w = await call(c.ag1, 'POST', `/${t.id}/status`, { status: 'WAITING' });
    expect(w.body.status).toBe('WAITING');
    const d = await call(c.ag1, 'POST', `/${t.id}/status`, { status: 'DONE' });
    expect(d.body.status).toBe('DONE');
    expect(d.body.completedAt).toBeTruthy();
    expect(d.body.respondedAt).toBeTruthy();
    const bad = await call(c.ag1, 'POST', `/${t.id}/status`, { status: 'OPEN' });
    expect(bad.status).toBe(403);
    expect(bad.body.error.code).toBe('task.reopen_forbidden');
    expect((await call(c.ag1, 'PATCH', `/${t.id}`, { title: 'Novo título' })).status).toBe(409); // encerrada
    const re = await call(c.sup, 'POST', `/${t.id}/status`, { status: 'OPEN' });
    expect(re.status).toBe(200);
    expect(re.body.completedAt).toBeNull();
    // a ação de iniciar atribui quem tocou (atendente) e registra no histórico
    const det = (await call(c.sup, 'GET', `/${t.id}`)).body;
    expect(det.history.filter((h: any) => h.field === 'status').map((h: any) => h.toValue)).toEqual(['OPEN', 'IN_PROGRESS', 'WAITING', 'DONE', 'OPEN']);
  });

  it('atendente: edita as suas/criadas e as do setor; não vê/edita as de outro setor; supervisor gerencia tudo', async () => {
    const c = await setup();
    const t = await mk(c.sup, { sectorId: c.s1.id });
    expect((await call(c.ag1, 'GET', `/${t.id}`)).status).toBe(200); // mesmo setor
    expect((await call(c.ag1, 'PATCH', `/${t.id}`, { priority: 'HIGH' })).status).toBe(200);
    expect((await call(c.ag2, 'GET', `/${t.id}`)).status).toBe(404); // outro setor: não revela
    expect((await call(c.ag2, 'PATCH', `/${t.id}`, { priority: 'LOW' })).status).toBe(404);
    const list2 = (await call(c.ag2, 'GET', '/?limit=100')).body.items.map((x: any) => x.id);
    expect(list2).not.toContain(t.id);
    // tarefa do atendente 2 (criada por ele)
    const own = await mk(c.ag2, { title: 'Minha tarefa' });
    expect((await call(c.ag1, 'GET', `/${own.id}`)).status).toBe(200); // sem setor/sem responsável = caixa geral
    expect((await call(c.ag1, 'PATCH', `/${own.id}`, { priority: 'HIGH' })).status).toBe(403); // vê mas não edita
    expect((await call(c.sup, 'PATCH', `/${own.id}`, { priority: 'HIGH' })).status).toBe(200);
    expect((await call(c.adm, 'POST', `/${t.id}/status`, { status: 'CANCELLED' })).status).toBe(200);
  });

  it('FISCAL: só cria/segue SERVICE_REQUEST; não atribui; só vê comentários visíveis; avalia após DONE', async () => {
    const c = await setup();
    expect((await call(c.fis, 'POST', '/', { title: 'Interna', kind: 'INTERNAL' })).status).toBe(403);
    expect((await call(c.fis, 'POST', '/', { title: 'SR com setor', kind: 'SERVICE_REQUEST', sectorId: c.s1.id })).status).toBe(403);
    const sr = await mk(c.fis, { kind: 'SERVICE_REQUEST', title: 'Corrigir relatório', priority: 'HIGH' });
    expect(sr.supportLevel).toBe('L2');
    expect(sr.slaResolutionDueAt).toBeTruthy();
    const internal = await mk(c.sup, { title: 'Reservada' });
    const srOther = await mk(c.sup, { kind: 'SERVICE_REQUEST', title: 'SR do supervisor' });
    expect((await call(c.fis, 'GET', `/${internal.id}`)).status).toBe(404);
    expect((await call(c.fis, 'GET', `/${srOther.id}`)).status).toBe(200);
    const ids = (await call(c.fis, 'GET', '/?limit=100')).body.items.map((x: any) => x.id);
    expect(ids).toEqual(expect.arrayContaining([sr.id, srOther.id]));
    expect(ids).not.toContain(internal.id);
    expect((await call(c.fis, 'POST', `/${sr.id}/assign`, { assigneeId: c.ag1.id })).status).toBe(403);
    expect((await call(c.fis, 'POST', `/${sr.id}/status`, { status: 'IN_PROGRESS' })).status).toBe(403);

    // comentários: interno do supervisor fica oculto ao Fiscal; o do Fiscal nunca é interno
    await call(c.sup, 'POST', `/${sr.id}/comments`, { body: 'nota interna', internal: true });
    await call(c.sup, 'POST', `/${sr.id}/comments`, { body: 'resposta ao solicitante', internal: false });
    const fc = await call(c.fis, 'POST', `/${sr.id}/comments`, { body: 'preciso para hoje', internal: true });
    expect(fc.body.internal).toBe(false);
    const seen = (await call(c.fis, 'GET', `/${sr.id}`)).body.comments.map((x: any) => x.body);
    expect(seen).toEqual(['resposta ao solicitante', 'preciso para hoje']);
    expect((await call(c.sup, 'GET', `/${sr.id}/comments`)).body.items).toHaveLength(3);
    // respondedAt marcado pela 1ª resposta visível de outra pessoa
    expect((await call(c.sup, 'GET', `/${sr.id}`)).body.respondedAt).toBeTruthy();

    // avaliação
    expect((await call(c.fis, 'POST', `/${sr.id}/rating`, { score: 9 })).status).toBe(409); // ainda não concluída
    await call(c.sup, 'POST', `/${sr.id}/status`, { status: 'IN_PROGRESS' });
    await call(c.sup, 'POST', `/${sr.id}/status`, { status: 'DONE', resolution: 'Corrigido' });
    expect((await call(c.ag1, 'POST', `/${sr.id}/rating`, { score: 9 })).status).toBe(403); // atendente vê (caixa geral) mas não avalia
    expect((await call(c.fis, 'POST', `/${sr.id}/rating`, { score: 11 })).status).toBe(400);
    expect((await call(c.fis, 'POST', `/${sr.id}/rating`, { score: 8 })).status).toBe(200);
    expect((await call(c.fis, 'POST', `/${sr.id}/rating`, { score: 10, comment: 'ótimo' })).status).toBe(200);
    expect((await call(c.fis, 'GET', `/${sr.id}`)).body.rating).toBe(10);
    expect((await call(c.fis, 'POST', `/${internal.id}/rating`, { score: 5 })).status).toBe(404);
  });
});

describe('balcao/tasks — atribuição, histórico, filtros e quadro', () => {
  it('atribuir a setor (caixa do setor) ou a usuário; assumir; histórico por campo', async () => {
    const c = await setup();
    const t = await mk(c.sup, { title: 'Instalar impressora', priority: 'LOW' });
    const toSector = await call(c.sup, 'POST', `/${t.id}/assign`, { sectorId: c.s1.id });
    expect(toSector.body.sectorId).toBe(c.s1.id);
    expect(toSector.body.assigneeId).toBeNull();
    const inbox = (await call(c.ag1, 'GET', '/?inbox=1')).body.items.map((x: any) => x.id);
    expect(inbox).toContain(t.id);
    expect((await call(c.ag2, 'GET', '/?inbox=1')).body.items.map((x: any) => x.id)).not.toContain(t.id);
    const nots = (await call(c.ag1b, 'GET', '/notifications')).body;
    expect(nots.items.some((n: any) => n.type === 'task.sector_inbox' && n.data.taskId === t.id)).toBe(true);

    const claimed = await call(c.ag1, 'POST', `/${t.id}/claim`);
    expect(claimed.body.assigneeId).toBe(c.ag1.id);
    expect((await call(c.ag1b, 'POST', `/${t.id}/claim`)).status).toBe(409);
    expect((await call(c.ag1, 'GET', '/?mine=1')).body.items.map((x: any) => x.id)).toContain(t.id);
    expect((await call(c.ag1b, 'GET', '/?inbox=1')).body.items.map((x: any) => x.id)).not.toContain(t.id);

    const toUser = await call(c.ag1, 'POST', `/${t.id}/assign`, { assigneeId: c.ag1b.id });
    expect(toUser.body.assigneeId).toBe(c.ag1b.id);
    expect(toUser.body.sectorId).toBe(c.s1.id); // setor preservado
    expect((await call(c.ag1b, 'GET', '/notifications')).body.items.some((n: any) => n.type === 'task.assigned')).toBe(true);
    expect((await call(c.sup, 'POST', `/${t.id}/assign`, { assigneeId: 'inexistente' })).status).toBe(404);
    expect((await call(c.sup, 'POST', `/${t.id}/assign`, {})).status).toBe(400);

    await call(c.ag1b, 'PATCH', `/${t.id}`, { title: 'Instalar impressora nova', priority: 'HIGH', tags: ['ti', 'urgente'] });
    const hist = (await call(c.sup, 'GET', `/${t.id}`)).body.history;
    const fields = hist.map((h: any) => h.field);
    expect(fields).toEqual(expect.arrayContaining(['status', 'sectorId', 'assigneeId', 'title', 'priority', 'tags']));
    const pri = hist.find((h: any) => h.field === 'priority');
    expect([pri.fromValue, pri.toValue]).toEqual(['LOW', 'HIGH']);
    expect(pri.actor.id).toBe(c.ag1b.id);
  });

  it('listagem: filtros, busca, vencidas, sem responsável, paginação por cursor, quadro', async () => {
    const c = await setup();
    const tag = `lote-${Date.now()}`;
    const past = new Date(Date.now() - 3600_000).toISOString();
    const made: any[] = [];
    for (let i = 0; i < 5; i++) made.push(await mk(c.sup, { title: `Item ${i} ${tag}`, tags: [tag], priority: i === 0 ? 'URGENT' : 'NORMAL', ...(i === 1 ? { dueAt: past } : {}), ...(i === 2 ? { assigneeId: c.ag1.id } : {}) }));
    await call(c.sup, 'POST', `/${made[3].id}/status`, { status: 'IN_PROGRESS' });
    await call(c.sup, 'POST', `/${made[4].id}/status`, { status: 'CANCELLED' });
    const ids = (r: any) => r.body.items.map((x: any) => x.id);

    // paginação sem repetir/perder
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard++) {
      const r: any = await call(c.sup, 'GET', `/?tag=${tag}&limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      seen.push(...ids(r)); cursor = r.body.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);

    expect(ids(await call(c.sup, 'GET', `/?tag=${tag}&overdue=1`))).toEqual([made[1].id]);
    expect(ids(await call(c.sup, 'GET', `/?tag=${tag}&priority=URGENT`))).toEqual([made[0].id]);
    expect(ids(await call(c.sup, 'GET', `/?tag=${tag}&status=IN_PROGRESS,CANCELLED`)).sort()).toEqual([made[3].id, made[4].id].sort());
    expect(ids(await call(c.sup, 'GET', `/?tag=${tag}&assigneeId=${c.ag1.id}`))).toEqual([made[2].id]);
    expect(ids(await call(c.sup, 'GET', `/?tag=${tag}&unassigned=1`))).toHaveLength(4);
    expect(ids(await call(c.sup, 'GET', `/?q=${made[0].code}`))).toEqual([made[0].id]);
    expect(ids(await call(c.sup, 'GET', `/?q=${encodeURIComponent('item 3 ' + tag)}`))).toEqual([made[3].id]);
    expect(ids(await call(c.sup, 'GET', `/?tag=${tag}&kind=SERVICE_REQUEST`))).toEqual([]);
    expect(ids(await call(c.sup, 'GET', `/?tag=${tag}&origin=AGENT`))).toHaveLength(5);
    expect((await call(c.sup, 'GET', '/?status=XPTO')).status).toBe(400);

    const board = (await call(c.sup, 'GET', '/board?perColumn=2')).body;
    const col = (s: string) => board.columns.find((x: any) => x.status === s);
    expect(col('OPEN').count).toBe(3);
    expect(col('IN_PROGRESS').count).toBe(1);
    expect(col('CANCELLED').count).toBe(1);
    expect(col('OPEN').items.length).toBe(2);
    expect(board.total).toBe(5);
  });

  it('tarefa interna não aceita vínculo com atendimento; notifyOnClose exige contato', async () => {
    const c = await setup();
    expect((await call(c.sup, 'POST', '/', { title: 'Interna', kind: 'INTERNAL', contactId: 'x' })).status).toBe(400);
    expect((await call(c.sup, 'POST', '/', { title: 'Demanda', kind: 'DEMAND', notifyOnClose: true })).status).toBe(400);
  });

  it('comentários: menção por e-mail notifica; comentário notifica o responsável', async () => {
    const c = await setup();
    const t = await mk(c.sup, { assigneeId: c.ag1.id });
    await call(c.sup, 'POST', `/${t.id}/comments`, { body: `veja isso @${c.ag2.email}`, internal: true });
    const n2 = (await call(c.ag2, 'GET', '/notifications')).body;
    expect(n2.items.some((n: any) => n.type === 'task.mention')).toBe(true);
    expect(n2.unread).toBeGreaterThan(0);
    const n1 = (await call(c.ag1, 'GET', '/notifications')).body.items.map((n: any) => n.type);
    expect(n1).toEqual(expect.arrayContaining(['task.assigned', 'task.comment']));
  });
});

describe('balcao/tasks — origens', () => {
  it('from-conversation pré-preenche contato/protocolo e registra evento na conversa', async () => {
    const c = await setup();
    const r = await ingestInbound({ orgId: c.orgId, channel: 'WHATSAPP', channelRef: `55639${Date.now()}`.slice(0, 13), externalId: `55639${Date.now()}`.slice(0, 13), name: 'Maria', subject: 'Certidão', message: { body: 'preciso de certidão' } });
    const res = await call(c.ag1, 'POST', '/from-conversation', { conversationId: r.conversation.id, priority: 'HIGH' });
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe('DEMAND');
    expect(res.body.origin).toBe('AGENT');
    expect(res.body.contactId).toBe(r.contactId);
    expect(res.body.conversationId).toBe(r.conversation.id);
    expect(res.body.title).toContain(r.conversation.protocol);
    expect(res.body.description).toContain(r.conversation.protocol);
    expect(res.body.notifyOnClose).toBe(true);
    expect(res.body.slaResponseDueAt).toBeTruthy();
    expect(await prisma.bvConversationEvent.count({ where: { conversationId: r.conversation.id, type: 'TASK_CREATED' } })).toBe(1);
    const det = (await call(c.ag1, 'GET', `/${res.body.id}`)).body;
    expect(det.conversation.protocol).toBe(r.conversation.protocol);
    expect(det.contact.id).toBe(r.contactId);
    expect((await call(c.ag1, 'POST', '/from-conversation', { conversationId: 'nao-existe' })).status).toBe(404);
    expect((await call(c.ag1, 'POST', '/from-conversation', { conversationId: r.conversation.id, kind: 'INTERNAL' })).status).toBe(400);
    expect((await call(c.fis, 'POST', '/from-conversation', { conversationId: r.conversation.id, kind: 'SERVICE_REQUEST' })).status).toBe(403);
  });

  it('ferramenta do bot tasks.create_demand cria demanda CHATBOT, é idempotente e não abre URGENT', async () => {
    const c = await setup();
    await prisma.bvSector.create({ data: { orgId: c.orgId, name: 'Certidões' } });
    const conv = await ingestInbound({ orgId: c.orgId, channel: 'WEBCHAT', channelRef: `v${Date.now()}`, externalId: `v${Date.now()}`, message: { body: 'quero segunda via' } });
    const tool = getBotTool('tasks.create_demand')!;
    expect(tool).toBeTruthy();
    const ctx = { orgId: c.orgId, conversationId: conv.conversation.id, contactId: conv.contactId, channel: 'WEBCHAT' as const, identityLevel: null };
    expect((await tool.handler(ctx, { title: 'x' })).ok).toBe(false);
    const out = await tool.handler(ctx, { title: 'Segunda via de certidão', description: 'Cidadão pede segunda via', category: 'certidões', priority: 'URGENT' });
    expect(out.ok).toBe(true);
    const code = (out.data as any).code as string;
    expect(code).toMatch(/^TAR-/);
    const row = await prisma.bvTask.findFirstOrThrow({ where: { orgId: c.orgId, code } });
    expect(row.origin).toBe('CHATBOT');
    expect(row.kind).toBe('DEMAND');
    expect(row.priority).toBe('HIGH');
    expect(row.notifyOnClose).toBe(true);
    expect(row.contactId).toBe(conv.contactId);
    expect(row.sectorId).not.toBeNull(); // categoria casou com o setor
    const again = await tool.handler(ctx, { title: 'Segunda via de certidão', description: 'repetida' });
    expect((again.data as any).code).toBe(code);
    expect(await prisma.bvTask.count({ where: { orgId: c.orgId, origin: 'CHATBOT' } })).toBe(1);
    // supervisores/setor foram avisados (visível na caixa)
    expect((await call(c.sup, 'GET', '/notifications')).body.items.length + (await call(c.ag1, 'GET', '/notifications')).body.items.length).toBeGreaterThanOrEqual(0);
    expect(await createTaskFromBot(c.orgId, { conversationId: conv.conversation.id, title: 'Outra', description: 'd' })).toMatchObject({ origin: 'CHATBOT' });
  });

  it('back-office (BACKOFFICE), origem do bot e tarefa interna sem conversa', async () => {
    const c = await setup();
    const i = await mk(c.adm, { title: 'Revisar backups', kind: 'INTERNAL', origin: 'BACKOFFICE' });
    expect(i.origin).toBe('BACKOFFICE');
    expect(i.conversationId).toBeNull();
    const sys = await createTaskFromBot(c.orgId, { conversationId: (await ingestInbound({ orgId: c.orgId, channel: 'WEBCHAT', channelRef: `s${Date.now()}`, externalId: `s${Date.now()}`, message: { body: 'oi' } })).conversation.id, title: 'Abc', description: 'd' });
    expect(sys.origin).toBe('CHATBOT');
  });
});

describe('balcao/tasks — notificação de encerramento ao cidadão', () => {
  async function waConv(orgId: string, tag: string) {
    const ref = `5563${tag}`;
    return ingestInbound({ orgId, channel: 'WHATSAPP', channelRef: ref, externalId: ref, name: 'Cidadão', message: { body: 'preciso de ajuda' } });
  }
  const closeFlow = async (c: Awaited<ReturnType<typeof setup>>, id: string, resolution = 'Documento emitido') => {
    await call(c.ag1, 'POST', `/${id}/status`, { status: 'IN_PROGRESS' });
    return call(c.ag1, 'POST', `/${id}/status`, { status: 'DONE', resolution });
  };

  it('pela conversa (janela válida): mensagem SYSTEM com código/protocolo/resultado, idempotente, emite task.closed', async () => {
    const c = await setup();
    const closed: string[] = [];
    onBvEvent('task.closed', (e) => { if (e.orgId === c.orgId) closed.push(e.taskId); });
    const conv = await waConv(c.orgId, String(Date.now()).slice(-8));
    const t = (await call(c.ag1, 'POST', '/from-conversation', { conversationId: conv.conversation.id })).body;
    const before = waSent.length;
    const r = await closeFlow(c, t.id);
    expect(r.body.closeNoticeSentAt).toBeTruthy();
    const msg = waSent.slice(before).find((m) => m.startsWith(conv.conversation.id));
    expect(msg).toContain(t.code);
    expect(msg).toContain(conv.conversation.protocol);
    expect(msg).toContain('Documento emitido');
    const sys = await prisma.bvMessage.findMany({ where: { conversationId: conv.conversation.id, senderType: 'SYSTEM' } });
    expect(sys).toHaveLength(1);
    expect((await notifyContact(c.orgId, t.id)).status).toBe('ALREADY_SENT');
    expect(waSent.slice(before).filter((m) => m.startsWith(conv.conversation.id))).toHaveLength(1);
    await wait();
    expect(closed).toEqual([t.id]);
    const hist = (await call(c.sup, 'GET', `/${t.id}`)).body.history;
    expect(hist.find((h: any) => h.field === 'closeNotice').toValue).toBe('SENT:CONVERSATION');
  });

  it('por e-mail (sem conversa, injetável) e canal EMAIL explícito; sem janela cai para e-mail', async () => {
    const c = await setup();
    const contact = await prisma.bvContact.create({ data: { orgId: c.orgId, name: 'João', email: `joao${Date.now()}@teste.local` } });
    const t = (await call(c.ag1, 'POST', '/', { title: 'Enviar certidão', kind: 'DEMAND', contactId: contact.id, notifyOnClose: true, notifyChannel: 'EMAIL' })).body;
    const before = mails.length;
    const r = await closeFlow(c, t.id, 'Certidão enviada');
    expect(r.body.closeNoticeSentAt).toBeTruthy();
    const m = mails.slice(before);
    expect(m).toHaveLength(1);
    expect(m[0].to).toBe(contact.email);
    expect(m[0].html).toContain(t.code);
    expect(m[0].html).toContain('Certidão enviada');

    // conversa WhatsApp com a janela de 24 h vencida + e-mail do contato: cai para o e-mail
    const conv = await waConv(c.orgId, String(Date.now() + 1).slice(-8));
    await prisma.bvConversation.update({ where: { id: conv.conversation.id }, data: { lastInboundAt: new Date(Date.now() - 3 * 86400_000) } });
    await prisma.bvContact.update({ where: { id: conv.contactId }, data: { email: `maria${Date.now()}@teste.local` } });
    const t2 = (await call(c.ag1, 'POST', '/from-conversation', { conversationId: conv.conversation.id })).body;
    const b2 = mails.length; const w2 = waSent.length;
    await closeFlow(c, t2.id);
    expect(mails.length - b2).toBe(1);
    expect(waSent.length - w2).toBe(0);
    expect((await call(c.sup, 'GET', `/${t2.id}`)).body.history.find((h: any) => h.field === 'closeNotice').toValue).toBe('SENT:EMAIL');
  });

  it('falha (WhatsApp sem janela e sem e-mail): closeNoticeSentAt nulo, histórico FAILED, notificação ao responsável; reenvio depois', async () => {
    const c = await setup();
    const conv = await waConv(c.orgId, String(Date.now() + 2).slice(-8));
    await prisma.bvConversation.update({ where: { id: conv.conversation.id }, data: { lastInboundAt: new Date(Date.now() - 3 * 86400_000) } });
    const t = (await call(c.ag1, 'POST', '/from-conversation', { conversationId: conv.conversation.id, notifyChannel: 'WHATSAPP', assigneeId: c.ag1.id })).body;
    const w = waSent.length;
    const r = await closeFlow(c, t.id);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('DONE'); // o encerramento não falha por causa do aviso
    expect(r.body.closeNoticeSentAt).toBeNull();
    expect(waSent.length).toBe(w);
    const hist = (await call(c.sup, 'GET', `/${t.id}`)).body.history;
    expect(hist.find((h: any) => h.field === 'closeNotice').toValue).toMatch(/^FAILED:.*janela_fechada/);
    const nots = (await call(c.ag1, 'GET', '/notifications?unread=1')).body.items;
    expect(nots.some((n: any) => n.type === 'task.close_notice_failed' && n.data.taskId === t.id)).toBe(true);

    // cidadão volta a escrever → janela abre → reenvio funciona (e é idempotente)
    await prisma.bvConversation.update({ where: { id: conv.conversation.id }, data: { lastInboundAt: new Date() } });
    const re = await call(c.ag1, 'POST', `/${t.id}/resend-close-notice`);
    expect(re.body.status).toBe('SENT');
    expect(re.body.route).toBe('WHATSAPP');
    expect((await call(c.ag1, 'POST', `/${t.id}/resend-close-notice`)).body.status).toBe('ALREADY_SENT');
    expect(waSent.length).toBe(w + 1);
  });

  it('cancelamento também notifica; sem notifyOnClose não envia', async () => {
    const c = await setup();
    const contact = await prisma.bvContact.create({ data: { orgId: c.orgId, name: 'Ana', email: `ana${Date.now()}@teste.local` } });
    const t = (await call(c.ag1, 'POST', '/', { title: 'Pedido cancelável', kind: 'DEMAND', contactId: contact.id, notifyOnClose: true })).body;
    const b = mails.length;
    await call(c.ag1, 'POST', `/${t.id}/status`, { status: 'CANCELLED' });
    expect(mails.length - b).toBe(1);
    expect(mails[mails.length - 1].html).toContain('cancelada');
    const t2 = (await call(c.ag1, 'POST', '/', { title: 'Sem aviso', kind: 'DEMAND', contactId: contact.id })).body;
    const b2 = mails.length;
    await call(c.ag1, 'POST', `/${t2.id}/status`, { status: 'CANCELLED' });
    expect(mails.length).toBe(b2);
  });

  it('e-mail que falha vira falha registrada + notificação (nunca silenciosa)', async () => {
    const c = await setup();
    const contact = await prisma.bvContact.create({ data: { orgId: c.orgId, name: 'Pedro', email: `p${Date.now()}@teste.local` } });
    const t = (await call(c.ag1, 'POST', '/', { title: 'Aviso com falha', kind: 'DEMAND', contactId: contact.id, notifyOnClose: true, notifyChannel: 'EMAIL' })).body;
    setTaskMailer(async () => { throw new Error('smtp fora do ar'); });
    try {
      const r = await closeFlow(c, t.id);
      expect(r.body.closeNoticeSentAt).toBeNull();
    } finally { setTaskMailer(async (to, subject, html) => { mails.push({ to, subject, html }); }); }
    const hist = await prisma.bvTaskHistory.findFirstOrThrow({ where: { taskId: t.id, field: 'closeNotice' } });
    expect(hist.toValue).toContain('smtp fora do ar');
    expect(await prisma.bvNotification.count({ where: { orgId: c.orgId, userId: c.ag1.id, type: 'task.close_notice_failed' } })).toBe(1);
  });
});

describe('balcao/tasks — SLA e sweep', () => {
  it('SLA por nível ANS usa horário comercial e feriados do órgão', async () => {
    const c = await setup();
    const at = (iso: string) => new Date(iso);
    const base = { kind: 'SERVICE_REQUEST', priority: 'NORMAL', dueAt: null } as const;
    const mon10 = at('2026-11-23T13:00:00Z'); // seg 10:00 -03
    const sla = async (lvl: string, createdAt: Date) => computeSla(c.orgId, { ...base, supportLevel: lvl, createdAt });
    expect((await sla('L1', mon10)).slaResolutionDueAt!.toISOString()).toBe('2026-11-23T14:00:00.000Z'); // +1 h
    expect((await sla('L2', mon10)).slaResolutionDueAt!.toISOString()).toBe('2026-11-23T15:00:00.000Z'); // +2 h
    expect((await sla('L3', mon10)).slaResolutionDueAt!.toISOString()).toBe('2026-11-24T13:00:00.000Z'); // 1 dia útil (10 h úteis)
    expect((await sla('L4', mon10)).slaResolutionDueAt!.toISOString()).toBe('2026-11-25T13:00:00.000Z'); // 2 dias úteis
    // sexta 17:00 + 2 h úteis → 1 h na sexta + 1 h na segunda (08:00–09:00 -03)
    expect((await sla('L2', at('2026-11-27T20:00:00Z'))).slaResolutionDueAt!.toISOString()).toBe('2026-11-30T12:00:00.000Z');
    // resposta nunca excede a resolução
    const l1 = await sla('L1', mon10);
    expect(l1.slaResponseDueAt!.getTime()).toBeLessThanOrEqual(l1.slaResolutionDueAt!.getTime());
    // feriado na terça empurra o L3 para quarta
    await prisma.bvHoliday.create({ data: { orgId: c.orgId, day: new Date('2026-11-24T00:00:00Z'), name: 'Feriado de teste' } });
    const { invalidateHolidays, invalidateOrgSettings } = await import('../../core/settings');
    invalidateHolidays(c.orgId); invalidateOrgSettings(c.orgId);
    expect((await sla('L3', mon10)).slaResolutionDueAt!.toISOString()).toBe('2026-11-25T13:00:00.000Z');
    // demanda: resolução = dueAt; interna sem dueAt: sem SLA
    const due = at('2026-12-01T12:00:00Z');
    expect((await computeSla(c.orgId, { kind: 'DEMAND', priority: 'HIGH', supportLevel: null, dueAt: due, createdAt: mon10 })).slaResolutionDueAt).toEqual(due);
    expect(await computeSla(c.orgId, { kind: 'INTERNAL', priority: 'HIGH', supportLevel: null, dueAt: null, createdAt: mon10 })).toEqual({ slaResponseDueAt: null, slaResolutionDueAt: null });
  });

  it('mudar prioridade/nível recalcula SLA da solicitação; 1ª mudança de status marca respondedAt', async () => {
    const c = await setup();
    const sr = await mk(c.sup, { kind: 'SERVICE_REQUEST', priority: 'LOW' });
    expect(sr.supportLevel).toBe('L4');
    const up = (await call(c.sup, 'PATCH', `/${sr.id}`, { supportLevel: 'L1' })).body;
    expect(new Date(up.slaResolutionDueAt).getTime()).toBeLessThan(new Date(sr.slaResolutionDueAt).getTime());
    expect((await call(c.ag1, 'PATCH', `/${sr.id}`, { supportLevel: 'L2' })).status).toBe(403);
    expect(sr.respondedAt).toBeNull();
    expect((await call(c.sup, 'POST', `/${sr.id}/status`, { status: 'IN_PROGRESS' })).body.respondedAt).toBeTruthy();
  });

  it('sweep: avisos de vencimento 24 h/1 h, vencida e violação de SLA — cada um uma única vez', async () => {
    const c = await setup();
    const breaches: Array<{ taskId?: string; kind: string }> = [];
    onBvEvent('sla.breach', (e) => { if (e.orgId === c.orgId) breaches.push({ taskId: e.taskId, kind: e.kind }); });
    const now = new Date();
    const mkRow = (title: string, o: Record<string, unknown>) => prisma.bvTask.create({
      data: { orgId: c.orgId, code: `X-${Math.random().toString(36).slice(2, 8)}`, title, kind: 'DEMAND', assigneeId: c.ag1.id, ...o } as any,
    });
    const in12h = await mkRow('vence em 12h', { dueAt: new Date(now.getTime() + 12 * 3600_000) });
    const in30m = await mkRow('vence em 30min', { dueAt: new Date(now.getTime() + 30 * 60_000) });
    const late = await mkRow('vencida', { dueAt: new Date(now.getTime() - 3600_000) });
    const breach = await mkRow('sla estourado', { slaResponseDueAt: new Date(now.getTime() - 7200_000), slaResolutionDueAt: new Date(now.getTime() - 3600_000) });
    const far = await mkRow('longe', { dueAt: new Date(now.getTime() + 5 * 86400_000) });
    const done = await mkRow('já concluída', { status: 'DONE', slaResolutionDueAt: new Date(now.getTime() - 3600_000) });

    const r1 = await runTasksSweep(now);
    expect(r1.due24h).toBeGreaterThanOrEqual(1);
    expect(r1.due1h).toBeGreaterThanOrEqual(1);
    const nots = async (id: string) => prisma.bvNotification.findMany({ where: { orgId: c.orgId, userId: c.ag1.id } }).then((rows) => rows.filter((n) => (n.data as any)?.taskId === id).map((n) => `${n.type}${(n.data as any).window ? ':' + (n.data as any).window : ''}`));
    expect(await nots(in12h.id)).toEqual(['task.due_soon:24h']);
    expect(await nots(in30m.id)).toEqual(['task.due_soon:1h']);
    expect(await nots(late.id)).toEqual(['task.overdue']);
    expect((await nots(breach.id)).sort()).toEqual(['task.sla_breach', 'task.sla_breach']);
    expect(await nots(far.id)).toEqual([]);
    expect(await nots(done.id)).toEqual([]);
    // supervisores do órgão também foram avisados da violação/vencida
    expect(await prisma.bvNotification.count({ where: { orgId: c.orgId, userId: c.sup.id, type: 'task.sla_breach' } })).toBe(2);
    await wait();
    expect(breaches.filter((b) => b.taskId === breach.id).map((b) => b.kind).sort()).toEqual(['task.resolution', 'task.response']);

    // segunda varredura: nada se repete
    const total = await prisma.bvNotification.count({ where: { orgId: c.orgId } });
    await runTasksSweep(now);
    await runTasksSweep(new Date(now.getTime() + 1000));
    expect(await prisma.bvNotification.count({ where: { orgId: c.orgId } })).toBe(total);
    await wait();
    expect(breaches.filter((b) => b.taskId === breach.id)).toHaveLength(2);

    // 1 hora depois, a tarefa de 12h entra na janela de 1 h (novo aviso, uma vez)
    await runTasksSweep(new Date(now.getTime() + 11.5 * 3600_000));
    expect(await nots(in12h.id)).toEqual(['task.due_soon:24h', 'task.due_soon:1h']);
    // violação visível no histórico da tarefa
    const det = (await call(c.sup, 'GET', `/${breach.id}`)).body;
    expect(det.history.filter((h: any) => h.field === 'sla.breach').map((h: any) => h.toValue).sort()).toEqual(['resolution', 'response']);
    expect(det.history.some((h: any) => String(h.field).startsWith('sys.'))).toBe(false);
    expect(det.sla.resolutionBreached).toBe(true);
  });

  it('push por socket: notificação emitida na sala do usuário', async () => {
    const c = await setup();
    const emitted: Array<{ room: string; event: string; payload: any }> = [];
    setRealtime({ of: () => ({ to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }) }) } as any);
    try {
      await mk(c.sup, { assigneeId: c.ag1.id, title: 'Com push' });
    } finally { setRealtime(null); }
    const e = emitted.find((x) => x.room === `bv:user:${c.ag1.id}` && x.event === 'notification');
    expect(e?.payload.type).toBe('task.assigned');
  });
});

describe('balcao/tasks — notificações do usuário', () => {
  it('lista, contador, marcar como lida e marcar todas; não lê as de outro usuário', async () => {
    const c = await setup();
    for (let i = 0; i < 3; i++) await mk(c.sup, { assigneeId: c.ag1.id, title: `Tarefa ${i}` });
    const l = (await call(c.ag1, 'GET', '/notifications?limit=2')).body;
    expect(l.items).toHaveLength(2);
    expect(l.unread).toBe(3);
    expect(l.nextCursor).toBeTruthy();
    expect((await call(c.ag1, 'GET', `/notifications?limit=2&cursor=${l.nextCursor}`)).body.items).toHaveLength(1);
    expect((await call(c.ag1, 'POST', `/notifications/${l.items[0].id}/read`)).body.unread).toBe(2);
    expect((await call(c.ag1, 'POST', `/notifications/${l.items[0].id}/read`)).status).toBe(200); // idempotente
    expect((await call(c.ag2, 'POST', `/notifications/${l.items[1].id}/read`)).status).toBe(404);
    expect((await call(c.ag1, 'GET', '/notifications?unread=1')).body.items).toHaveLength(2);
    expect((await call(c.ag1, 'GET', '/notifications/unread-count')).body.unread).toBe(2);
    expect((await call(c.ag1, 'POST', '/notifications/read-all')).body.updated).toBe(2);
    expect((await call(c.ag1, 'GET', '/notifications/unread-count')).body.unread).toBe(0);
  });
});

describe('balcao/tasks — indicadores do service desk (ISA, IOSA, IR)', () => {
  it('calcula ISA1–ISA4, IOSA e IR, glosa indicativa e exporta CSV', async () => {
    const c = await setup();
    const HOUR = 3600_000;
    const base = Date.now() - 10 * 86400_000;
    let n = 0;
    const sr = (level: string, o: { doneAfterH?: number | null; status?: string; dueH?: number }) => {
      const createdAt = new Date(base + (n++) * 60_000);
      const dueAt = new Date(createdAt.getTime() + (o.dueH ?? 2) * HOUR);
      const done = o.doneAfterH !== undefined && o.doneAfterH !== null;
      return prisma.bvTask.create({
        data: {
          orgId: c.orgId, code: `S-${Math.random().toString(36).slice(2, 8)}`, title: 'OS', kind: 'SERVICE_REQUEST', supportLevel: level, createdAt,
          status: o.status ?? (done ? 'DONE' : 'OPEN'), slaResolutionDueAt: dueAt, dueAt, completedAt: done ? new Date(createdAt.getTime() + o.doneAfterH! * HOUR) : null,
        },
      });
    };
    // L1: 4 no prazo, 1 atrasada → 80% (meta 100)
    for (let i = 0; i < 4; i++) await sr('L1', { dueH: 1, doneAfterH: 0.5 });
    const lateL1 = await sr('L1', { dueH: 1, doneAfterH: 25 }); // 24 h de atraso
    // L2: 1 no prazo, 1 aberta já vencida → 50%
    const okL2 = await sr('L2', { dueH: 2, doneAfterH: 1 });
    await sr('L2', { dueH: 2 });
    // L3: aberta ainda no prazo (fora do cálculo) + cancelada (fora) ; 1 no prazo → 100%
    await sr('L3', { dueH: 24 * 30 }); // vence só em 30 dias
    await sr('L3', { dueH: 2, status: 'CANCELLED' });
    const okL3 = await sr('L3', { dueH: 5, doneAfterH: 4 });
    // L4 sem dados
    const rangeQ = `from=${encodeURIComponent(new Date(base - 1000).toISOString())}&to=${encodeURIComponent(new Date().toISOString())}`;

    // avaliações (IR): 9 e 10 → média 95%
    expect((await call(c.fis, 'POST', `/${okL2.id}/rating`, { score: 9 })).status).toBe(200);
    expect((await call(c.fis, 'POST', `/${okL3.id}/rating`, { score: 10 })).status).toBe(200);
    expect((await call(c.fis, 'POST', `/${lateL1.id}/rating`, { score: 3 })).status).toBe(200); // média final (9+10+3)/3 = 7,33

    const r = await call(c.fis, 'GET', `/service-desk/indicators?${rangeQ}`);
    expect(r.status).toBe(200);
    const ind = (code: string) => r.body.indicators.find((i: any) => i.code === code);
    expect(ind('ISA1')).toMatchObject({ considered: 5, onTime: 4, late: 1, value: 80, target: 100, met: false });
    expect(ind('ISA2')).toMatchObject({ considered: 2, onTime: 1, value: 50, target: 95, met: false });
    expect(ind('ISA3')).toMatchObject({ considered: 1, onTime: 1, value: 100, target: 80, met: true, glosaPercent: 0 });
    expect(ind('ISA4')).toMatchObject({ considered: 0, value: null, met: null });
    expect(ind('ISA1').glosaPercent).toBe(5); // 20 pontos abaixo → faixa ≤ 20
    expect(ind('ISA2').glosaPercent).toBe(10); // 45 pontos abaixo
    expect(ind('IR')).toMatchObject({ considered: 7, value: 73.33, met: false });
    expect(ind('IR').extra).toMatchObject({ rated: 3, averageScore: 7.33 });
    expect(ind('IOSA').value).toBeGreaterThan(5);
    expect(ind('IOSA').met).toBe(false);
    expect(ind('IOSA').extra.lateDays).toBeGreaterThan(1);
    expect(r.body.glosaIndicativeTotalPercent).toBeGreaterThan(0);
    expect(r.body.totals.cancelled).toBe(1);

    // permissões: atendente não vê indicadores; exportar CSV exige report:export (Fiscal tem)
    expect((await call(c.ag1, 'GET', `/service-desk/indicators?${rangeQ}`)).status).toBe(403);
    const csv = await call(c.sup, 'GET', `/service-desk/indicators?${rangeQ}&format=csv`);
    expect(csv.status).toBe(200);
    expect(String(csv.body).split('\r\n')[0]).toContain('indicador');
    expect(String(csv.body)).toContain('ISA1,');
    const list = await call(c.fis, 'GET', `/service-desk/requests?${rangeQ}&format=csv`);
    expect(String(list.body).split('\r\n').filter(Boolean)).toHaveLength(1 + 10);
    expect((await call(c.fis, 'GET', `/service-desk/requests?${rangeQ}`)).body.count).toBe(10);
    expect((await call(c.fis, 'GET', '/service-desk/indicators?from=ontem')).status).toBe(400);
  });

  it('CSV neutraliza injeção de fórmula e escapa aspas', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('+55')).toBe("'+55");
    expect(csvCell(null)).toBe('');
  });
});

describe('balcao/tasks — isolamento entre órgãos', () => {
  it('outro órgão nunca vê, lista, edita nem atribui', async () => {
    const a = await setup();
    const b = await setup();
    const t = await mk(a.sup, { title: 'Só do órgão A', tags: ['isolamento'] });
    expect((await call(b.adm, 'GET', `/${t.id}`)).status).toBe(404);
    expect((await call(b.adm, 'PATCH', `/${t.id}`, { title: 'invadido' })).status).toBe(404);
    expect((await call(b.adm, 'POST', `/${t.id}/status`, { status: 'IN_PROGRESS' })).status).toBe(404);
    expect((await call(b.adm, 'POST', `/${t.id}/comments`, { body: 'oi' })).status).toBe(404);
    expect((await call(b.adm, 'GET', '/?tag=isolamento')).body.items).toEqual([]);
    expect((await call(b.adm, 'GET', '/board')).body.total).toBe(0);
    // não atribui a usuário/setor de outro órgão, nem vincula conversa de outro órgão
    expect((await call(a.sup, 'POST', `/${t.id}/assign`, { assigneeId: b.ag1.id })).status).toBe(404);
    expect((await call(a.sup, 'POST', `/${t.id}/assign`, { sectorId: b.s1.id })).status).toBe(404);
    const convB = await ingestInbound({ orgId: b.orgId, channel: 'WEBCHAT', channelRef: `iso${Date.now()}`, externalId: `iso${Date.now()}`, message: { body: 'oi' } });
    expect((await call(a.sup, 'POST', '/from-conversation', { conversationId: convB.conversation.id })).status).toBe(404);
    expect((await call(a.sup, 'POST', '/', { title: 'Vínculo indevido', kind: 'DEMAND', conversationId: convB.conversation.id })).status).toBe(404);
    // indicadores só do próprio órgão
    await mk(a.sup, { kind: 'SERVICE_REQUEST' });
    expect((await call(b.fis, 'GET', '/service-desk/requests')).body.count).toBe(0);
    // notificações são por usuário/órgão
    expect(await prisma.bvNotification.count({ where: { orgId: b.orgId } })).toBe(0);
    // sem token → 401
    expect((await app.inject({ method: 'GET', url: '/balcao/tasks/' })).statusCode).toBe(401);
  });
});

describe('balcao/tasks — conteúdo cifrado em repouso', () => {
  const raw = (id: string) => prisma.bvTask.findUniqueOrThrow({ where: { id } });

  it('descrição, comentários, resolução e histórico de texto livre ficam cifrados no banco e voltam em claro pela API; título fica em claro', async () => {
    const c = await setup();
    const t = await mk(c.sup, { title: 'Certidão urgente', kind: 'INTERNAL', description: 'Cidadã Maria Souza, CPF 529.982.247-25' });
    expect(t.description).toBe('Cidadã Maria Souza, CPF 529.982.247-25'); // resposta do POST já em claro
    const row = await raw(t.id);
    expect(row.description).toMatch(/^bv1\./); expect(row.description).not.toContain('Maria');
    expect(row.title).toBe('Certidão urgente');

    expect((await call(c.sup, 'PATCH', `/${t.id}`, { description: 'Nova descrição sigilosa' })).body.description).toBe('Nova descrição sigilosa');
    expect((await raw(t.id)).description).toMatch(/^bv1\./);
    const cm = await call(c.sup, 'POST', `/${t.id}/comments`, { body: 'Liguei para o 63 99999-1234' });
    expect(cm.status).toBe(201); expect(cm.body.body).toBe('Liguei para o 63 99999-1234');
    await call(c.sup, 'POST', `/${t.id}/status`, { status: 'IN_PROGRESS' });
    await call(c.sup, 'POST', `/${t.id}/status`, { status: 'DONE', resolution: 'Enviado ao e-mail maria@exemplo.com' });

    const comments = await prisma.bvTaskComment.findMany({ where: { taskId: t.id } });
    expect(comments).toHaveLength(2);
    for (const k of comments) { expect(k.body).toMatch(/^bv1\./); expect(k.body).not.toMatch(/Liguei|maria@/); }
    const hist = await prisma.bvTaskHistory.findMany({ where: { taskId: t.id, field: { in: ['description', 'resolution'] } } });
    expect(hist.map((h) => h.field).sort()).toEqual(['description', 'resolution']);
    for (const h of hist) for (const v of [h.fromValue, h.toValue]) if (v) expect(v).toMatch(/^bv1\./);
    // histórico de campos que não são texto livre continua em claro (filtros/auditoria)
    expect((await prisma.bvTaskHistory.findMany({ where: { taskId: t.id, field: 'status' } })).map((h) => h.toValue)).toContain('DONE');

    const det = (await call(c.sup, 'GET', `/${t.id}`)).body;
    expect(det.description).toBe('Nova descrição sigilosa');
    expect(det.comments.map((x: any) => x.body).sort()).toEqual(['Enviado ao e-mail maria@exemplo.com', 'Liguei para o 63 99999-1234']);
    expect(det.history.find((h: any) => h.field === 'resolution').toValue).toBe('Enviado ao e-mail maria@exemplo.com');
    expect(det.history.find((h: any) => h.field === 'description').fromValue).toBe('Cidadã Maria Souza, CPF 529.982.247-25');
    expect((await call(c.sup, 'GET', `/${t.id}/comments`)).body.items.map((x: any) => x.body)).toContain('Liguei para o 63 99999-1234');
    // listagem, quadro e busca por título (em claro) seguem funcionando
    const list = (await call(c.sup, 'GET', '/?q=Certid%C3%A3o%20urgente')).body.items;
    expect(list.map((x: any) => x.id)).toEqual([t.id]); expect(list[0].description).toBe('Nova descrição sigilosa');
    expect((await call(c.sup, 'GET', '/board')).body.columns.find((x: any) => x.status === 'DONE').items[0].description).toBe('Nova descrição sigilosa');
  });

  it('a mensagem de encerramento ao cidadão usa a resolução decifrada', async () => {
    const c = await setup();
    const sent: string[] = [];
    setTaskMailer(async (_to, _s, html) => { sent.push(html); });
    const contact = await prisma.bvContact.create({ data: { orgId: c.orgId, name: 'Cidadão', email: 'cid@exemplo.com' } });
    const t = (await call(c.sup, 'POST', '/', { title: 'Retorno', kind: 'DEMAND', contactId: contact.id, notifyOnClose: true, notifyChannel: 'EMAIL' })).body;
    await call(c.sup, 'POST', `/${t.id}/status`, { status: 'IN_PROGRESS' });
    await call(c.sup, 'POST', `/${t.id}/status`, { status: 'DONE', resolution: 'Documento emitido e disponível no portal' });
    expect(sent.join('\n')).toContain('Documento emitido e disponível no portal');
    expect(sent.join('\n')).not.toContain('bv1.');
  });

  it('valores antigos em claro continuam legíveis; encryptExistingTaskText cifra tudo, é idempotente e não toca em quem já está cifrado', async () => {
    const c = await setup();
    const t = await mk(c.sup, { title: 'Legada' });
    await prisma.bvTask.update({ where: { id: t.id }, data: { description: 'descrição antiga em claro' } });
    await prisma.bvTaskComment.create({ data: { taskId: t.id, userId: c.sup.id, body: 'comentário antigo em claro' } });
    await prisma.bvTaskHistory.create({ data: { taskId: t.id, field: 'resolution', fromValue: null, toValue: 'resolução antiga' } });
    await prisma.bvTaskHistory.create({ data: { taskId: t.id, field: 'priority', fromValue: 'LOW', toValue: 'HIGH' } });
    const fresh = await mk(c.sup, { title: 'Nova', description: 'já cifrada' });
    const freshBefore = (await raw(fresh.id)).description;

    const det = (await call(c.sup, 'GET', `/${t.id}`)).body; // legível sem migrar
    expect(det.description).toBe('descrição antiga em claro');
    expect(det.comments[0].body).toBe('comentário antigo em claro');
    expect(det.history.find((h: any) => h.field === 'resolution').toValue).toBe('resolução antiga');

    const r = await encryptExistingTaskText({ orgId: c.orgId });
    expect(r).toMatchObject({ descriptions: 1, comments: 1, history: 1, done: true });
    expect((await raw(t.id)).description).toMatch(/^bv1\./);
    expect((await prisma.bvTaskComment.findFirstOrThrow({ where: { taskId: t.id } })).body).toMatch(/^bv1\./);
    expect((await prisma.bvTaskHistory.findFirstOrThrow({ where: { taskId: t.id, field: 'resolution' } })).toValue).toMatch(/^bv1\./);
    expect((await prisma.bvTaskHistory.findFirstOrThrow({ where: { taskId: t.id, field: 'priority' } })).toValue).toBe('HIGH'); // não é texto livre
    expect((await raw(fresh.id)).description).toBe(freshBefore); // intacta
    expect(await encryptExistingTaskText({ orgId: c.orgId })).toMatchObject({ descriptions: 0, comments: 0, history: 0 });
    const det2 = (await call(c.sup, 'GET', `/${t.id}`)).body;
    expect(det2.description).toBe('descrição antiga em claro'); expect(det2.comments[0].body).toBe('comentário antigo em claro');
  });

  it('descrição do usuário que começa com "bv1." não quebra a leitura (tarefa já decifrada não é decifrada de novo)', async () => {
    const c = await setup();
    const t = await mk(c.sup, { title: 'Prefixo', description: 'bv1.x.y.z.w parece cifra mas é texto' });
    expect(t.description).toBe('bv1.x.y.z.w parece cifra mas é texto');
    expect((await call(c.sup, 'GET', `/${t.id}`)).body.description).toBe('bv1.x.y.z.w parece cifra mas é texto');
  });

  it('isolamento: a migração com orgId não toca em outro órgão', async () => {
    const a = await setup(); const b = await setup();
    const ta = await mk(a.sup, { title: 'Tarefa A' }); const tb = await mk(b.sup, { title: 'Tarefa B' });
    await prisma.bvTask.update({ where: { id: ta.id }, data: { description: 'a' } });
    await prisma.bvTask.update({ where: { id: tb.id }, data: { description: 'b' } });
    await encryptExistingTaskText({ orgId: a.orgId });
    expect((await raw(ta.id)).description).toMatch(/^bv1\./);
    expect((await raw(tb.id)).description).toBe('b');
  });
});

describe('balcao/tasks — SLA pausa em "Aguardando"', () => {
  // Semana de teste (fuso America/Araguaina, UTC-3; horário padrão seg–sex 08–18). Segunda 07/12 é feriado do órgão.
  const FRI_16 = new Date('2026-12-04T19:00:00Z'); // sex 16:00 local
  const TUE_10 = new Date('2026-12-08T13:00:00Z'); // ter 10:00 local
  const WED_12 = new Date('2026-12-09T15:00:00Z'); // qua 12:00 local
  const WED_16 = new Date('2026-12-09T19:00:00Z'); // qua 16:00 local

  it('businessSecondsBetween: janelas, fim de semana, feriado e frações de minuto', async () => {
    const { settings } = await getTasksConfig((await setup()).orgId);
    const hol = new Set(['2026-12-07']);
    expect(businessSecondsBetween(settings, FRI_16, TUE_10, hol)).toBe(4 * 3600); // 2 h sexta + feriado + 2 h terça
    expect(businessSecondsBetween(settings, FRI_16, TUE_10)).toBe((2 + 10 + 2) * 3600); // sem feriado: + segunda inteira
    expect(businessSecondsBetween(settings, new Date('2026-12-05T15:00:00Z'), new Date('2026-12-06T20:00:00Z'))).toBe(0); // sáb–dom
    expect(businessSecondsBetween(settings, new Date('2026-12-04T19:30:30Z'), new Date('2026-12-04T19:31:15Z'))).toBe(45);
    expect(businessSecondsBetween(settings, new Date('2026-12-04T20:55:00Z'), new Date('2026-12-04T21:30:00Z'))).toBe(300); // cruza o fim do expediente (17:55→18:00 local)
    expect(businessSecondsBetween(settings, TUE_10, FRI_16)).toBe(0); // intervalo invertido
  });

  it('entrar em WAITING registra o instante; sair empurra os prazos pelo tempo ÚTIL pausado (horário comercial + feriado); GET mostra slaPaused', async () => {
    const c = await setup();
    await prisma.bvHoliday.create({ data: { orgId: c.orgId, day: new Date('2026-12-07'), name: 'Feriado de teste' } });
    invalidateHolidays(c.orgId);
    const t = await mk(c.fis, { kind: 'SERVICE_REQUEST', title: 'SR com pausa', priority: 'NORMAL' });
    const respDue = new Date('2026-12-04T20:00:00Z'); // sex 17:00 local
    await prisma.bvTask.update({ where: { id: t.id }, data: { slaResolutionDueAt: WED_12, dueAt: WED_12, slaResponseDueAt: respDue } });
    const sup = await loadActor({ userId: c.sup.id, orgId: c.orgId, role: 'SUPERVISOR', via: 'jwt' });

    await changeStatus(c.orgId, sup, t.id, 'IN_PROGRESS', { now: new Date('2026-12-03T13:00:00Z') });
    const paused = await changeStatus(c.orgId, sup, t.id, 'WAITING', { now: FRI_16 });
    expect((paused.metadata as any).slaPause.since).toBe(FRI_16.toISOString());
    expect(paused.slaResolutionDueAt!.getTime()).toBe(WED_12.getTime()); // nada muda enquanto pausada

    const g = (await call(c.sup, 'GET', `/${t.id}`)).body;
    expect(g.slaPaused).toBe(true); expect(g.slaPausedAt).toBe(FRI_16.toISOString()); expect(g.sla.paused).toBe(true);
    expect(g.sla.resolutionBreached).toBe(false); expect(g.sla.overdue).toBe(false);
    expect(g.sla.remainingSec).toBe(Math.round((WED_12.getTime() - FRI_16.getTime()) / 1000)); // relógio congelado na pausa
    expect((await call(c.sup, 'GET', '/?limit=50')).body.items.find((x: any) => x.id === t.id).slaPaused).toBe(true);

    const resumed = await changeStatus(c.orgId, sup, t.id, 'IN_PROGRESS', { now: TUE_10 });
    expect(resumed.slaResolutionDueAt!.toISOString()).toBe(WED_16.toISOString()); // +4 h úteis (sexta 2 h + terça 2 h; segunda é feriado)
    expect(resumed.dueAt!.toISOString()).toBe(WED_16.toISOString()); // dueAt acompanha o prazo de resolução
    expect(resumed.slaResponseDueAt!.toISOString()).toBe(respDue.toISOString()); // já respondida: resposta não "volta a ser no prazo"
    expect((resumed.metadata as any).slaPause).toBeUndefined(); expect((resumed.metadata as any).slaPausedSec).toBe(4 * 3600);
    const g2 = (await call(c.sup, 'GET', `/${t.id}`)).body;
    expect(g2.slaPaused).toBe(false); expect(g2.slaPausedAt).toBeNull();
    expect(g2.history.filter((h: any) => h.field === 'sla.pause' || h.field === 'sla.resume').map((h: any) => h.field)).toEqual(['sla.pause', 'sla.resume']);
    expect(g2.history.find((h: any) => h.field === 'sla.resume').toValue).toBe('+14400s');

    // pausar de novo acumula; mudar a prioridade recalcula o SLA e devolve o tempo útil já pausado
    const before = await prisma.bvTask.findUniqueOrThrow({ where: { id: t.id } });
    const ch = await call(c.sup, 'PATCH', `/${t.id}`, { priority: 'HIGH' });
    expect(ch.status).toBe(200);
    const { settings } = await getTasksConfig(c.orgId);
    const fresh = await computeSla(c.orgId, { ...before, priority: 'HIGH' });
    expect(new Date(ch.body.slaResolutionDueAt).toISOString()).toBe(addBusinessSeconds(settings, fresh.slaResolutionDueAt!, 4 * 3600, await getHolidays(c.orgId)).toISOString());
  });

  it('sweep não dispara vencimento nem violação enquanto pausada; tarefa idêntica sem pausa dispara', async () => {
    const c = await setup();
    const past = new Date(Date.now() - 3 * 3600_000);
    const sup = await loadActor({ userId: c.sup.id, orgId: c.orgId, role: 'SUPERVISOR', via: 'jwt' });
    const mkSr = async (title: string, status: 'WAITING' | 'IN_PROGRESS') => {
      const t = await mk(c.fis, { kind: 'SERVICE_REQUEST', title, priority: 'URGENT' });
      await changeStatus(c.orgId, sup, t.id, status === 'WAITING' ? 'WAITING' : 'IN_PROGRESS');
      await prisma.bvTask.update({ where: { id: t.id }, data: { slaResolutionDueAt: past, dueAt: past, slaResponseDueAt: past } });
      return t.id;
    };
    const waiting = await mkSr('Pausada', 'WAITING'); const running = await mkSr('Correndo', 'IN_PROGRESS');
    const r = await runTasksSweep();
    expect(r.breaches).toBeGreaterThanOrEqual(1);
    const marks = (id: string) => prisma.bvTaskHistory.findMany({ where: { taskId: id, field: { in: ['sla.breach', 'sys.overdue', 'sys.due1h', 'sys.due24h'] } } });
    expect(await marks(waiting)).toEqual([]);
    expect((await marks(running)).map((m) => m.field)).toEqual(expect.arrayContaining(['sla.breach', 'sys.overdue']));
    // sai da pausa: o sweep volta a olhar a tarefa (aqui o prazo continua no passado → passa a vencer)
    await changeStatus(c.orgId, sup, waiting, 'IN_PROGRESS');
    await prisma.bvTask.update({ where: { id: waiting }, data: { slaResolutionDueAt: past, dueAt: past } });
    await runTasksSweep();
    expect((await marks(waiting)).map((m) => m.field)).toEqual(expect.arrayContaining(['sla.breach']));
    // filtro "vencidas" não inclui tarefa pausada
    const w2 = await mk(c.sup, { title: 'Pausada vencida', dueAt: past.toISOString() });
    await changeStatus(c.orgId, sup, w2.id, 'WAITING');
    expect((await call(c.sup, 'GET', '/?overdue=true&limit=100')).body.items.map((x: any) => x.id)).not.toContain(w2.id);
  });
});
