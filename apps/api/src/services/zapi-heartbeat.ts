/**
 * zapi-heartbeat.ts
 *
 * Verifica a cada 1 hora o status real de todos os números "connected" via Z-API.
 * Se um número estiver desconectado (WhatsApp saiu, bateria, etc.), atualiza o DB
 * para "disconnected" — evitando que o painel do usuário mostre verde quando
 * a conexão está morta.
 */

import { prisma } from '../lib/prisma';

const HEARTBEAT_INTERVAL_MS = 60 * 60 * 1000; // 1 hora

function zapiUrl(instanceId: string, token: string, path: string): string {
  return `https://api.z-api.io/instances/${instanceId}/token/${token}${path}`;
}

function zapiHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.ZAPI_CLIENT_TOKEN) headers['Client-Token'] = process.env.ZAPI_CLIENT_TOKEN;
  return headers;
}

async function checkNumber(
  number: { id: string; zapiInstanceId: string; zapiToken: string },
  log: any,
): Promise<'ok' | 'disconnected' | 'error'> {
  try {
    const res = await fetch(
      zapiUrl(number.zapiInstanceId, number.zapiToken, '/status'),
      { headers: zapiHeaders(), signal: AbortSignal.timeout(10_000) }, // 10s timeout por número
    );

    if (!res.ok) {
      log.warn(`[Heartbeat] Número ${number.id} — Z-API retornou ${res.status}`);
      return 'error';
    }

    const data = await res.json() as any;
    const connected = data?.connected === true;

    if (!connected) {
      await prisma.whatsappNumber.update({
        where: { id: number.id },
        data:  { status: 'disconnected' },
      });
      log.warn(`[Heartbeat] ⚠️  Número ${number.id} estava marcado "connected" mas Z-API reportou desconectado — status atualizado`);
      return 'disconnected';
    }

    return 'ok';
  } catch (err: any) {
    log.error(`[Heartbeat] Erro ao verificar número ${number.id}: ${err.message}`);
    return 'error';
  }
}

export async function runHeartbeat(log: any): Promise<void> {
  log.info('[Heartbeat] 🔍 Verificando status de conexão Z-API de todos os números...');

  // Cast para any: Prisma types não incluem zapiInstanceId/zapiToken
  // pois essas colunas foram adicionadas via auto-migration (não no schema.prisma gerado)
  const numbers = await (prisma as any).whatsappNumber.findMany({
    where: {
      status:         'connected',
      zapiInstanceId: { not: null },
      zapiToken:      { not: null },
    },
    select: { id: true, zapiInstanceId: true, zapiToken: true },
  }).catch((err: any) => {
    log.error(`[Heartbeat] Erro ao buscar números: ${err.message}`);
    return [] as { id: string; zapiInstanceId: string; zapiToken: string }[];
  });

  if (numbers.length === 0) {
    log.info('[Heartbeat] Nenhum número conectado para verificar.');
    return;
  }

  let ok = 0, disconnected = 0, errors = 0;

  for (const n of numbers) {
    // zapiInstanceId/zapiToken são garantidamente não-nulos pelo filtro acima
    const result = await checkNumber(
      { id: n.id, zapiInstanceId: n.zapiInstanceId as string, zapiToken: n.zapiToken as string },
      log,
    );
    if (result === 'ok')           ok++;
    else if (result === 'disconnected') disconnected++;
    else                           errors++;

    // Pequena pausa entre chamadas para não sobrecarregar Z-API
    await new Promise(r => setTimeout(r, 500));
  }

  log.info(
    `[Heartbeat] ✅ Concluído — ${ok} OK` +
    (disconnected ? `, ${disconnected} desconectados (DB atualizado)` : '') +
    (errors       ? `, ${errors} erro(s) de verificação`             : ''),
  );
}

/**
 * Inicia o heartbeat periódico.
 * Chama runHeartbeat imediatamente após 5min do startup (deixa o servidor estabilizar)
 * e depois repete a cada 1 hora.
 */
export function startHeartbeat(log: any): void {
  // Primeira execução 5 minutos após o startup (não travar o boot)
  const firstRun = setTimeout(() => {
    runHeartbeat(log).catch(err =>
      log.error({ err: err.message }, '[Heartbeat] Erro na primeira execução'),
    );
  }, 5 * 60 * 1000);

  // Execuções periódicas a cada 1 hora
  const interval = setInterval(() => {
    runHeartbeat(log).catch(err =>
      log.error({ err: err.message }, '[Heartbeat] Erro na execução periódica'),
    );
  }, HEARTBEAT_INTERVAL_MS);

  // Marcar como não-bloqueante para o Node não manter o processo vivo por causa deles
  firstRun.unref();
  interval.unref();

  log.info('[Heartbeat] ⏱️  Agendado — primeira verificação em 5min, depois a cada 1h');
}
