import crypto from 'crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { audit, auditReq } from '../core/audit';
import { emitBvEvent, onBvEvent } from '../core/events';
import { getIntegration } from '../core/integrations';
import { guard, parse, sendError } from '../core/http';
import { basicAuth, httpClientFor, IntegrationError, parseJsonSafe, type HttpClient } from './http-client';
import { logged, type Deps } from './common';

/** Jira (Cloud v3 / Server v2) — cria issue a partir de tarefa (task.created) e sincroniza o status por webhook. */

const TASK_STATUS = ['OPEN', 'IN_PROGRESS', 'WAITING', 'DONE', 'CANCELLED'] as const;
export const jiraConfigSchema = z.object({
  baseUrl: z.string().url().max(300),
  email: z.string().min(1).max(200),
  apiToken: z.string().min(1).max(2000),
  projectKey: z.string().regex(/^[A-Z][A-Z0-9_]{1,19}$/),
  apiVersion: z.enum(['3', '2']).default('3'),
  issueTypeMap: z.record(z.string(), z.string().max(100)).default({ SERVICE_REQUEST: 'Task', DEMAND: 'Task', INTERNAL: 'Task' }),
  priorityMap: z.record(z.string(), z.string().max(100)).default({ LOW: 'Low', NORMAL: 'Medium', HIGH: 'High', URGENT: 'Highest' }),
  /** Status do Jira (nome, sem diferenciar maiúsculas) → status da tarefa. */
  statusMap: z.record(z.string(), z.enum(TASK_STATUS)).default({ 'to do': 'OPEN', 'in progress': 'IN_PROGRESS', waiting: 'WAITING', blocked: 'WAITING', done: 'DONE', cancelled: 'CANCELLED' }),
  /** Tipos de tarefa enviados ao Jira automaticamente. */
  syncKinds: z.array(z.enum(['INTERNAL', 'DEMAND', 'SERVICE_REQUEST'])).default(['SERVICE_REQUEST']),
  webhookSecret: z.string().min(8).max(200).optional(),
  timeoutMs: z.number().int().min(500).max(60_000).default(10_000),
  allowPrivateHosts: z.boolean().optional(),
});
export type JiraConfig = z.infer<typeof jiraConfigSchema>;
export const JIRA_SECRETS = ['apiToken', 'webhookSecret'];

async function loadConfig(orgId: string): Promise<JiraConfig> {
  const row = await getIntegration<Record<string, any>>(orgId, 'JIRA');
  if (!row?.enabled) throw new IntegrationError('jira.not_configured', 'Jira não configurado');
  const p = jiraConfigSchema.safeParse(row.config);
  if (!p.success) throw new IntegrationError('jira.not_configured', 'Configuração do Jira inválida');
  return { ...p.data, allowPrivateHosts: row.config.allowPrivateHosts === true };
}

const api = (cfg: JiraConfig, path: string) => `${cfg.baseUrl.replace(/\/+$/, '')}/rest/api/${cfg.apiVersion}${path}`;
const authHeaders = (cfg: JiraConfig) => ({ authorization: basicAuth(cfg.email, cfg.apiToken), accept: 'application/json', 'content-type': 'application/json' });
const adf = (text: string) => ({ type: 'doc', version: 1, content: text.split(/\n{1,}/).filter(Boolean).map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p.slice(0, 2000) }] })) });

const PENDING = 'JIRA-PENDING';

/** Cria a issue da tarefa e grava a chave em BvTask.externalRef. Idempotente (reserva a tarefa antes de chamar o Jira). */
export async function createIssueForTask(orgId: string, taskId: string, opts: { force?: boolean } = {}, deps: Deps = {}): Promise<{ key: string } | null> {
  const cfg = await loadConfig(orgId);
  const task = await prisma.bvTask.findFirst({ where: { id: taskId, orgId } });
  if (!task) throw new IntegrationError('jira.task_not_found', 'Tarefa não encontrada');
  if (!opts.force && !cfg.syncKinds.includes(task.kind as any)) return null;
  if (task.externalRef) return task.externalRef === PENDING ? null : { key: task.externalRef };
  const claim = await prisma.bvTask.updateMany({ where: { id: task.id, orgId, externalRef: null }, data: { externalRef: PENDING } });
  if (claim.count === 0) return null; // outra execução já cuida disso
  const http: HttpClient = deps.http ?? httpClientFor(cfg);
  try {
    const key = await logged(orgId, 'JIRA', 'issue.create', async () => {
      const summary = `[${task.code}] ${task.title}`.slice(0, 250);
      const desc = `${task.description ?? ''}\n\nOrigem: Balcão Virtual (${task.code}).`.trim();
      const res = await http.request({
        method: 'POST', url: api(cfg, '/issue'), headers: authHeaders(cfg), timeoutMs: cfg.timeoutMs,
        body: JSON.stringify({ fields: {
          project: { key: cfg.projectKey }, summary, description: cfg.apiVersion === '3' ? adf(desc) : desc,
          issuetype: { name: cfg.issueTypeMap[task.kind] ?? cfg.issueTypeMap.SERVICE_REQUEST ?? 'Task' },
          priority: { name: cfg.priorityMap[task.priority] ?? 'Medium' }, labels: ['balcao-virtual'],
        } }),
      });
      const j = parseJsonSafe<{ key?: string }>(res.text);
      if (res.status < 200 || res.status >= 300 || !j?.key) throw new IntegrationError('jira.create_failed', `Jira recusou (HTTP ${res.status})`, res.status);
      return j.key;
    });
    await prisma.bvTask.update({ where: { id: task.id }, data: { externalRef: key } });
    await prisma.bvTaskHistory.create({ data: { taskId: task.id, field: 'externalRef', fromValue: null, toValue: key } }).catch(() => undefined);
    return { key };
  } catch (err) {
    await prisma.bvTask.updateMany({ where: { id: task.id, orgId, externalRef: PENDING }, data: { externalRef: null } });
    throw err;
  }
}

let unsubscribe: (() => void) | null = null;
/** Assina `task.created` (idempotente entre re-registros do plugin). */
export function subscribeJiraEvents(deps: Deps = {}): void {
  unsubscribe?.();
  unsubscribe = onBvEvent('task.created', async ({ orgId, taskId }) => {
    try { await createIssueForTask(orgId, taskId, {}, deps); }
    catch (err: any) { if (err?.code !== 'jira.not_configured') logger.warn({ code: err?.code ?? 'unexpected' }, '[balcao] jira: falha ao criar issue'); }
  });
}

export async function testJira(cfg: JiraConfig, deps: Deps = {}): Promise<{ ok: boolean; message: string }> {
  const http = deps.http ?? httpClientFor(cfg);
  try {
    const me = await http.request({ url: api(cfg, '/myself'), headers: authHeaders(cfg), timeoutMs: cfg.timeoutMs });
    if (me.status === 401 || me.status === 403) return { ok: false, message: 'Credenciais recusadas' };
    if (me.status !== 200) return { ok: false, message: `Jira com erro (HTTP ${me.status})` };
    const pr = await http.request({ url: api(cfg, `/project/${encodeURIComponent(cfg.projectKey)}`), headers: authHeaders(cfg), timeoutMs: cfg.timeoutMs });
    if (pr.status !== 200) return { ok: false, message: 'Projeto não encontrado ou sem acesso' };
    return { ok: true, message: 'Credenciais e projeto válidos' };
  } catch (err: any) {
    return { ok: false, message: err instanceof IntegrationError ? err.code : 'Falha de rede' };
  }
}

function safeEq(a: string, b: string) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); }

function mapStatus(cfg: JiraConfig, issue: any): (typeof TASK_STATUS)[number] | null {
  const name = String(issue?.fields?.status?.name ?? '').toLowerCase();
  if (name && cfg.statusMap[name]) return cfg.statusMap[name];
  const cat = issue?.fields?.status?.statusCategory?.key;
  return cat === 'done' ? 'DONE' : cat === 'new' ? 'OPEN' : cat === 'indeterminate' ? 'IN_PROGRESS' : null;
}

const webhookQuery = z.object({ org: z.string().min(1).max(100), secret: z.string().max(300).optional() });
const issueBody = z.object({ taskId: z.string().min(1).max(64) });

export function registerJiraRoutes(app: FastifyInstance, deps: Deps = {}): void {
  app.post('/jira/webhook', async (req, reply) => {
    const q = parse(webhookQuery, req.query, reply);
    if (!q) return;
    const org = await prisma.bvOrg.findUnique({ where: { slug: q.org }, select: { id: true } });
    let cfg: JiraConfig | null = null;
    if (org) { try { cfg = await loadConfig(org.id); } catch { cfg = null; } }
    if (!org || !cfg?.webhookSecret) return sendError(reply, 401, 'jira.unauthorized', 'Não autorizado');
    const raw: Buffer | undefined = (req as any).rawBody;
    const sigHeader = String(req.headers['x-hub-signature-256'] ?? req.headers['x-hub-signature'] ?? '').replace(/^sha256=/, '');
    const given = String(req.headers['x-jira-secret'] ?? q.secret ?? '');
    const sigOk = !!sigHeader && !!raw && safeEq(sigHeader, crypto.createHmac('sha256', cfg.webhookSecret).update(raw).digest('hex'));
    if (!sigOk && !(given && safeEq(given, cfg.webhookSecret))) return sendError(reply, 401, 'jira.unauthorized', 'Não autorizado');

    const body = (req.body ?? {}) as any;
    const key = typeof body?.issue?.key === 'string' ? body.issue.key : null;
    if (!key) return { ok: true, ignored: true };
    const task = await prisma.bvTask.findFirst({ where: { orgId: org.id, externalRef: key } });
    if (!task) return { ok: true, ignored: true };
    const next = mapStatus(cfg, body.issue);
    if (!next || next === task.status) return { ok: true, ignored: true };
    const done = next === 'DONE' || next === 'CANCELLED';
    await prisma.bvTask.update({ where: { id: task.id }, data: { status: next, completedAt: done ? new Date() : null } });
    await prisma.bvTaskHistory.create({ data: { taskId: task.id, field: 'status', fromValue: task.status, toValue: next } });
    await audit({ orgId: org.id, actorType: 'INTEGRATION', action: 'jira.status_sync', entityType: 'task', entityId: task.id, meta: { to: next } });
    await logged(org.id, 'JIRA', 'webhook', async () => undefined);
    if (done) emitBvEvent('task.closed', { orgId: org.id, taskId: task.id });
    return { ok: true, status: next };
  });

  app.post('/jira/issues', { preHandler: guard('task:manage') }, async (req, reply) => {
    const b = parse(issueBody, req.body, reply);
    if (!b) return;
    try {
      const r = await createIssueForTask(req.bv!.orgId, b.taskId, { force: true }, deps);
      if (!r) return sendError(reply, 409, 'jira.in_progress', 'Criação já em andamento');
      await auditReq(req, 'jira.issue_create', { entityType: 'task', entityId: b.taskId, meta: { key: r.key } });
      return reply.code(201).send({ key: r.key });
    } catch (err) {
      const code = err instanceof IntegrationError ? err.code : 'jira.error';
      return sendError(reply, code === 'jira.not_configured' ? 409 : code === 'jira.task_not_found' ? 404 : 502, code, 'Não foi possível criar a issue');
    }
  });
}
