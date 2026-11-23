import type { FastifyInstance } from 'fastify';
import { registerBotTool } from '../core/tools';
import { registerJob } from '../core/scheduler';
import { TaskError, type Priority } from './model';
import routes from './routes';
import { createTaskFromBot } from './service';
import { runTasksSweep } from './sweep';

export { createTaskFromBot, createTask, createTaskFromConversation, changeStatus, assignTask, notifyContact, setTaskMailer } from './service';
export { runTasksSweep } from './sweep';
export { notifyUsers } from './notifications';

/** Ferramenta do chatbot: abre uma demanda (origin CHATBOT) a partir da conversa e devolve o código. */
export function registerTasksBotTool(): void {
  registerBotTool({
    name: 'tasks.create_demand',
    description: 'Registra uma demanda interna (ticket) para o órgão tratar quando o assunto não puder ser resolvido na conversa. Devolve o código (TAR-000123) para informar ao cidadão. O cidadão é avisado automaticamente quando a demanda for encerrada.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Resumo curto da demanda (até 200 caracteres)' },
        description: { type: 'string', description: 'Descrição com os detalhes relevantes do pedido' },
        category: { type: 'string', description: 'Categoria/assunto (ex.: setor responsável), opcional' },
        priority: { type: 'string', enum: ['LOW', 'NORMAL', 'HIGH'], description: 'Prioridade (padrão NORMAL)' },
      },
      required: ['title', 'description'],
    },
    handler: async (ctx, input) => {
      const title = typeof input?.title === 'string' ? input.title.trim() : '';
      const description = typeof input?.description === 'string' ? input.description.trim() : '';
      if (title.length < 3 || !description) return { ok: false, message: 'Informe título e descrição da demanda.' };
      const priority = ['LOW', 'NORMAL', 'HIGH'].includes(input?.priority) ? (input.priority as Priority) : 'NORMAL';
      try {
        const t = await createTaskFromBot(ctx.orgId, {
          conversationId: ctx.conversationId, title, description,
          category: typeof input?.category === 'string' ? input.category.slice(0, 80) : null, priority,
        });
        return { ok: true, data: { code: t.code, taskId: t.id, duplicate: !!t.duplicate }, message: `Demanda ${t.code} registrada.` };
      } catch (err: any) {
        if (err instanceof TaskError) return { ok: false, message: err.message };
        throw err;
      }
    },
  });
}

/** Registros de runtime (idempotentes): ferramenta do bot + job de varredura. */
export function registerTasksRuntime(): void {
  registerTasksBotTool();
  registerJob('balcao.tasks.sweep', { intervalMs: 60_000, lockTtlSec: 55 }, async () => { await runTasksSweep(); });
}

/** Plugin da frente — registrado em balcao/index.ts (prefixo /balcao/tasks). */
export default async function plugin(app: FastifyInstance): Promise<void> {
  registerTasksRuntime();
  await app.register(routes);
}
