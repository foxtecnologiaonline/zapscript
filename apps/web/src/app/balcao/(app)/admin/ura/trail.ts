/** Trilha da URA (TrailEntry de apps/api/src/balcao/channels/voice/ivr.ts) descrita em português, para telas de chamadas e simulador. */
export interface TrailEntry {
  node: string; type: string; event: string; input?: string; next?: string; bargedIn?: boolean; length?: number; sensitive?: boolean; value?: string; result?: string; attempt?: number;
}

export const NODE_TYPE_LABEL: Record<string, string> = {
  menu: 'Menu', play: 'Mensagem', collect: 'Coleta de dígitos', schedule: 'Horário de atendimento', language: 'Idioma', queue: 'Fila (atendente)', transfer: 'Transferência', hangup: 'Encerrar',
};

export function describeTrail(e: TrailEntry): string {
  const at = `"${e.node}" (${NODE_TYPE_LABEL[e.type] ?? e.type})`;
  switch (e.event) {
    case 'enter': return `Executou ${at}.`;
    case 'entry': return `Entrada alternativa por cabeçalho SIP (${e.input ?? ''}) em ${at}.`;
    case 'choice': return `${at}: o chamador digitou ${e.input}${e.bargedIn ? ' (interrompendo o áudio)' : ''} e foi para "${e.next}".`;
    case 'timeout': return `${at}: tempo esgotado sem resposta${e.attempt ? ` (tentativa ${e.attempt})` : ''}.`;
    case 'invalid': return `${at}: opção inválida${e.input ? ` (${e.input})` : ''}${e.attempt ? `, tentativa ${e.attempt}` : ''}.`;
    case 'repeat': return `${at}: ${e.result === 'not_confirmed' ? 'o chamador não confirmou os dígitos; pediu de novo' : 'o chamador pediu para repetir'}.`;
    case 'collected': return e.sensitive ? `${at}: coletou ${e.length ?? '?'} dígitos (dado sensível; o valor não é guardado).` : `${at}: coletou "${e.value ?? ''}".`;
    case 'schedule': return `${at}: ${e.result === 'open' ? 'dentro do horário de atendimento' : e.result === 'holiday' ? 'feriado' : 'fora do horário de atendimento'}.`;
    case 'language': return `${at}: idioma escolhido ${e.result ?? ''} (tecla ${e.input ?? '?'}).`;
    case 'queue': return `${at}: encaminhada ao atendimento humano${e.result ? ` (fila/categoria: ${e.result})` : ''}.`;
    case 'transfer': return `${at}: transferida${e.result ? ` para ${e.result}` : ''}.`;
    case 'hangup': return `${at}: ligação encerrada pela URA${e.result ? ` (${e.result === 'max_retries' ? 'limite de tentativas' : e.result})` : ''}.`;
    case 'aborted': return `${at}: o chamador desligou durante a URA.`;
    default: return `${at}: ${e.event}.`;
  }
}

export const OUTCOME_LABEL: Record<string, string> = { queue: 'Entregue ao atendimento humano', transfer: 'Transferida', hangup: 'Encerrada pela URA', aborted: 'Chamador desligou' };
