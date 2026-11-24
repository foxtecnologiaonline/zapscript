import type { FastifyInstance } from 'fastify';
import { logger } from '../../../lib/logger';
import { prisma } from '../../../lib/prisma';
import { onBalcaoStart, registerJob } from '../../core/scheduler';
import { loadAriConnection, voiceEnabled } from './config';
import { AriController, getAriController, setAriController } from './controller';
import { getPromptProvider } from './prompts';
import registerRoutes from './routes';

export { AriController, protocolMedia } from './controller';
export { deriveSipPassword } from './sip';

/** Inicia o controlador ARI (se BV_VOICE_ENABLED=1 e houver URL do ARI). */
export async function startVoice(): Promise<AriController | null> {
  if (!voiceEnabled()) { logger.info('[balcao/voice] desligado (BV_VOICE_ENABLED != 1)'); return null; }
  if (getAriController()) return getAriController();
  const conn = await loadAriConnection();
  if (!conn) { logger.warn('[balcao/voice] BV_VOICE_ENABLED=1 mas ARI não configurado (BV_ARI_URL)'); return null; }
  const c = new AriController({ connection: conn, prompts: getPromptProvider() });
  setAriController(c);
  c.start();
  return c;
}

/** Plugin da frente — prefixo /balcao/voice (definido em balcao/index.ts). */
export default async function plugin(app: FastifyInstance): Promise<void> {
  await app.register(registerRoutes);
  onBalcaoStart(() => { void startVoice(); });
  // Shutdown gracioso (SIGTERM → app.close): libera o lock de liderança do ARI para outra instância assumir sem esperar o TTL.
  app.addHook('onClose', async () => { await getAriController()?.shutdown(); });

  // Higiene: chamadas "vivas" no banco sem controle (API reiniciada) são encerradas.
  registerJob('voice.stale-calls', { intervalMs: 5 * 60_000 }, async () => {
    const c = getAriController();
    if (!c) return;
    const cutoff = new Date(Date.now() - 6 * 3600_000);
    const stale = await prisma.bvCall.findMany({ where: { status: { in: ['RINGING', 'IVR', 'QUEUED', 'ACTIVE'] }, startedAt: { lt: cutoff } }, select: { id: true } });
    const live = new Set(c.activeCallIds());
    const ids = stale.filter((s) => !live.has(s.id)).map((s) => s.id);
    if (ids.length) await prisma.bvCall.updateMany({ where: { id: { in: ids } }, data: { status: 'ENDED', endedAt: new Date(), endReason: 'STALE' } });
  });
}
