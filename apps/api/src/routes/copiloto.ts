import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { requireModuleShared } from '../lib/teamScope';
import { fetchGroups, setGroupsIgnore } from '../services/evolution';

/**
 * Módulo Copiloto (tiers Profissional + Empresas) — rotas de gestão.
 *
 * A entrega em si (cards de contato, resumo diário de grupo, resolução da
 * escolha do usuário) não passa por API — vive inteira no webhook/worker
 * (ver evolution-webhook.ts, copiloto-intake.ts, copiloto-commands.ts e
 * apps/worker/src/copiloto.ts). Este arquivo cobre só o que precisa de tela:
 * listar/ligar grupos acompanhados. Histórico (V1) fica pro painel web.
 */
export default async function copilotoRoutes(app: FastifyInstance) {
  app.addHook('preHandler', (app as any).authenticate);
  app.addHook('preHandler', requireModuleShared('copiloto'));

  async function ownedNumber(ownerId: string, numberId: string) {
    return prisma.whatsappNumber.findFirst({ where: { id: numberId, userId: ownerId } });
  }

  // ── GET /copiloto/numbers/:numberId/groups ──────────────────────────────
  // Junta a lista viva de grupos da Evolution com o opt-in já salvo — grupo
  // que a Evolution não retorna mais (saiu do grupo) mas segue com active=true
  // no banco continua listado (o usuário desliga por aqui mesmo).
  app.get<{ Params: { numberId: string } }>('/numbers/:numberId/groups', async (req: any, reply) => {
    const { ownerId } = req.teamScope;
    const number = await ownedNumber(ownerId, req.params.numberId);
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
    // Grupos salvos que a Evolution não devolveu mais (saiu do grupo) — mantém
    // visível pra dar pra desligar, marcado como indisponível.
    for (const s of saved) {
      if (!groups.some((g) => g.groupJid === s.groupJid)) {
        groups.push({ groupJid: s.groupJid, name: `${s.name} (indisponível)`, active: s.active });
      }
    }

    return { groups };
  });

  // ── POST /copiloto/numbers/:numberId/groups ─────────────────────────────
  // Liga/desliga o acompanhamento de um grupo (opt-in explícito — Body:
  // { groupJid, name, active }). Ajusta groupsIgnore da instância conforme
  // sobra ou não algum grupo ativo — nunca deixa a instância lendo grupo
  // nenhum quando o usuário não tem nenhum opt-in ligado.
  app.post<{ Params: { numberId: string }; Body: { groupJid: string; name: string; active: boolean } }>(
    '/numbers/:numberId/groups',
    async (req: any, reply) => {
      const { ownerId } = req.teamScope;
      const number = await ownedNumber(ownerId, req.params.numberId);
      if (!number) return reply.code(404).send({ error: 'Número não encontrado' });

      const { groupJid, name, active } = req.body || {};
      if (!groupJid || typeof groupJid !== 'string' || !groupJid.endsWith('@g.us')) {
        return reply.code(400).send({ error: 'groupJid inválido' });
      }

      await prisma.copilotoGroup.upsert({
        where:  { numberId_groupJid: { numberId: number.id, groupJid } },
        update: { name: name || groupJid, active: !!active },
        create: { userId: ownerId, numberId: number.id, groupJid, name: name || groupJid, active: !!active },
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
  // Últimos resumos diários de grupo já enviados — histórico mínimo (o
  // painel web completo, com busca, é V1; isso aqui já serve pra conferência).
  app.get<{ Params: { numberId: string } }>('/numbers/:numberId/digests', async (req: any, reply) => {
    const { ownerId } = req.teamScope;
    const number = await ownedNumber(ownerId, req.params.numberId);
    if (!number) return reply.code(404).send({ error: 'Número não encontrado' });

    const digests = await prisma.copilotoGroupDigest.findMany({
      where:   { numberId: number.id },
      orderBy: { date: 'desc' },
      take:    30,
    });
    return { digests };
  });
}
