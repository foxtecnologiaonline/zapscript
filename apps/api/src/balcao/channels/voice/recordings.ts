import fs from 'fs';
import path from 'path';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../../lib/prisma';
import { logger } from '../../../lib/logger';
import { getObjectStream, newKey, parseRange, putObject, statObject, type StoredObject } from '../../core/storage';

import { auditReq } from '../../core/audit';
import { sendError } from '../../core/http';
import { recordingDir } from './config';
import type { AriHttp } from './ari';

/** Move a gravação (arquivo do volume do Asterisk, ou baixada do ARI) para o storage do Balcão, com sha256 e tamanho. */
export async function storeRecording(orgId: string, name: string, http: AriHttp | null, opts: { dir?: string; keepSource?: boolean } = {}): Promise<StoredObject | null> {
  const dir = opts.dir ?? recordingDir();
  const file = path.join(dir, `${name}.wav`);
  const key = newKey(orgId, 'recordings', 'wav');
  try {
    if (fs.existsSync(file)) {
      const stored = await putObject(key, fs.createReadStream(file));
      if (!opts.keepSource && process.env.BV_ASTERISK_RECORDING_KEEP !== '1') await fs.promises.rm(file, { force: true });
      return stored;
    }
    if (http) { // sem volume compartilhado: baixa pela API do ARI
      const data = await http.request<Buffer>('GET', `/recordings/stored/${encodeURIComponent(name)}/file`, { binary: true });
      const stored = await putObject(key, data);
      await http.request('DELETE', `/recordings/stored/${encodeURIComponent(name)}`).catch(() => undefined);
      return stored;
    }
  } catch (err: any) {
    logger.error({ err: err?.message, name }, '[balcao/voice] falha ao armazenar gravação');
  }
  logger.warn({ name }, '[balcao/voice] arquivo de gravação não encontrado');
  return null;
}

/** GET /calls/:id/recording — stream com Range (206), auditado (`recording.listen`). `part=ura` serve a gravação da fase da URA. */
export async function streamRecording(req: FastifyRequest, reply: FastifyReply, callId: string, part: 'main' | 'ura', download: boolean) {
  const orgId = req.bv!.orgId;
  const call = await prisma.bvCall.findFirst({ where: { id: callId, orgId }, include: { conversation: { select: { protocol: true, metadata: true } } } });
  if (!call) return sendError(reply, 404, 'call.not_found', 'Chamada não encontrada');
  const ura = ((call.conversation?.metadata as any)?.voice?.uraRecording ?? null) as { key: string } | null;
  const key = part === 'ura' ? ura?.key : call.recordingKey;
  if (!key) return sendError(reply, 404, 'recording.not_found', 'Esta chamada não tem gravação');
  const st = await statObject(key);
  if (!st) return sendError(reply, 404, 'recording.missing', 'Arquivo de gravação indisponível');

  const header = req.headers.range as string | undefined;
  const range = parseRange(header, st.size);
  if (header && !range) return reply.code(416).header('Content-Range', `bytes */${st.size}`).send();
  await auditReq(req, 'recording.listen', { entityType: 'BvCall', entityId: call.id, meta: { part, range: header ?? null, download, protocol: call.conversation?.protocol } });

  const fname = `${call.conversation?.protocol ?? call.id}${part === 'ura' ? '-ura' : ''}.wav`;
  reply.header('Content-Type', 'audio/wav').header('Accept-Ranges', 'bytes').header('Cache-Control', 'private, no-store')
    .header('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${fname}"`);
  if (range) {
    reply.code(206).header('Content-Range', `bytes ${range.start}-${range.end}/${st.size}`).header('Content-Length', range.end - range.start + 1);
    return reply.send(getObjectStream(key, range));
  }
  reply.header('Content-Length', st.size);
  return reply.send(getObjectStream(key));
}

/** Recalcula o sha256 do arquivo armazenado e compara com o registrado (prova de integridade). */
export async function verifyRecordingIntegrity(key: string, expected: string | null): Promise<boolean> {
  const crypto = await import('crypto');
  const h = crypto.createHash('sha256');
  for await (const chunk of getObjectStream(key)) h.update(chunk as Buffer);
  return !!expected && h.digest('hex') === expected;
}
