import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { requireModule } from '../lib/moduleGate';
import { fetchGroups, setGroupsIgnore } from '../services/evolution';

/**
 * Módulo Copiloto — Função 2 (resumo diário de grupos).
 *
 * A Função 1 (briefing por conversa individual) não passa por API nenhuma —
 * vive inteira no self-chat via comandos ("copiloto status/ligar/...", ver
 * copiloto-commands.ts) e no worker (copiloto.ts). Grupo é diferente: exige
 * opt-in explícito por grupo, e não dá pra escolher "qual grupo" por comando de
 * texto sem expor uma lista — por isso só essa parte tem rota própria.
 *
 * Sem teamScope de propósito: o Copiloto é pessoal do dono, não compartilhado
 * com o time (diferente de Atende/Tarefas). Ver ESCOPO_COPILOTO.md.
 */
export default async function copilotoRoutes(app: FastifyInstance) {
  app.addHook('preHandler', (app as any).authenticate);
  app.addHook('preHandler', requireModule('copiloto'));

  async function ownedNumber(userId: string, numberId: string) {
    return prisma.whatsappNumber.findFirst({ where: { id: numberId, userId } });
  }

  // ── GET /copiloto/numbers/:numberId/groups ──────────────────────────────
  app.get<{ Params: { numberId: string } }>('/numbers/:numberId/groups', async (req: any, reply) => {
    const userId = req.user.sub;
    const number = await ownedNumber(userId, req.params.numberId);
    if (!number) return reply.code(404).send({ error: 'Número não encontrado' });
    if (!number.zapiInstanceId || number.status !== 'connected') {
      return reply.code(409).send({ error: 'Número precisa estar conectado para listar grupos.' });
    }

    const [live, saved] = await Promise.all([
      fetchGroups(number.zapiInstanceId).catch(() => []),
      prisma.copilotoGroup.findMany({ where: { numberId: number.id } }),
    ]);

    const savedByJid = new Map(saved.map((g) => [g.groupJid, g]));
    const groups = live.map((g) => ({
      groupJid: g.jid,
      name:     savedByJid.get(g.jid)?.name || g.name,
      active:   savedByJid.get(g.jid)?.active ?? false,
    }));
    for (const s of saved) {
      if (!groups.some((g) => g.groupJid === s.groupJid)) {
        groups.push({ groupJid: s.groupJid, name: `${s.name} (indisponível)`, active: s.active });
      }
    }

    return { groups };
  });

  // ── POST /copiloto/numbers/:numberId/groups ─────────────────────────────
  app.post<{ Params: { numberId: string }; Body: { groupJid: string; name: string; active: boolean } }>(
    '/numbers/:numberId/groups',
    async (req: any, reply) => {
      const userId = req.user.sub;
      const number = await ownedNumber(userId, req.params.numberId);
      if (!number) return reply.code(404).send({ error: 'Número não encontrado' });

      const { groupJid, name, active } = req.body || {};
      if (!groupJid || typeof groupJid !== 'string' || !groupJid.endsWith('@g.us')) {
        return reply.code(400).send({ error: 'groupJid inválido' });
      }

      await prisma.copilotoGroup.upsert({
        where:  { numberId_groupJid: { numberId: number.id, groupJid } },
        update: { name: name || groupJid, active: !!active },
        create: { userId, numberId: number.id, groupJid, name: name || groupJid, active: !!active },
      });

      if (number.zapiInstanceId) {
        const anyActive = await prisma.copilotoGroup.count({ where: { numberId: number.id, active: true } });
        setGroupsIgnore(number.zapiInstanceId, anyActive === 0).catch((err: any) =>
          app.log.warn({ err: err?.message }, '[Copiloto] Falha ao ajustar groupsIgnore'));
      }

      return reply.code(200).send({ ok: true });
    },
  );

  // ── GET /copiloto/numbers/:numberId/digests ─────────────────────────────
  app.get<{ Params: { numberId: string } }>('/numbers/:numberId/digests', async (req: any, reply) => {
    const userId = req.user.sub;
    const number = await ownedNumber(userId, req.params.numberId);
    if (!number) return reply.code(404).send({ error: 'Número não encontrado' });

    const digests = await prisma.copilotoGroupDigest.findMany({
      where:   { numberId: number.id },
      orderBy: { date: 'desc' },
      take:    30,
    });
    return { digests };
  });
}
