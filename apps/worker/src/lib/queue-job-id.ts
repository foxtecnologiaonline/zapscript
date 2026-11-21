/**
 * IDs de job do BullMQ.
 *
 * O BullMQ rejeita `jobId` customizado que contenha ":" (a menos que tenha
 * exatamente 3 segmentos, formato reservado a jobs repetíveis) com
 * "Custom Id cannot contain :" — e rejeita também IDs só numéricos. O padrão
 * antigo `${campanhaId}:${contatoId}` caía nessa regra e o enfileiramento lançava
 * exceção. Todo ID composto da fila passa por aqui, com "-" como separador.
 *
 * ⚠ Duplicado em apps/worker/src/lib/queue-job-id.ts (api e worker não
 * compartilham código neste monorepo): as duas pontas PRECISAM gerar o mesmo ID,
 * porque a API enfileira e o agendador do worker enfileira os mesmos jobs.
 */
function joinJobId(prefix: string, ...parts: string[]): string {
  for (const p of parts) {
    if (!p || p.includes(':')) throw new Error(`jobId inválido: parte "${p}" vazia ou com ":"`);
  }
  return [prefix, ...parts].join('-');
}

/** Disparo de 1 contato de campanha (fila `campanhas`). */
export const campanhaSendJobId = (campanhaId: string, contatoId: string): string =>
  joinJobId('camp', campanhaId, contatoId);

/** Envio de 1 execução de missão (fila `mktfast`). */
export const mktfastSendJobId = (missionId: string, executionId: string): string =>
  joinJobId('mkt', missionId, executionId);
