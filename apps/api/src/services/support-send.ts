import { sendText } from './evolution';
import { sendEmail } from '../lib/mailer';
import { io } from '../index';

/**
 * Envio de mensagens do Agente de Suporte pelos canais (WhatsApp/Email/Chat).
 * Centralizado aqui para ser usado tanto pelo fluxo automático (support-intake)
 * quanto pela fila de aprovação (suporte-admin).
 */

// Envia um texto pelo canal de origem do atendimento.
export async function sendOnChannel(at: any, texto: string): Promise<void> {
  if (at.canal === 'whatsapp') {
    if (!at.clienteWhatsapp) throw new Error('Atendimento sem número de WhatsApp');
    const instance = process.env.SUPPORT_EVOLUTION_INSTANCE;
    if (!instance) throw new Error('SUPPORT_EVOLUTION_INSTANCE não configurado');
    await sendText(instance, at.clienteWhatsapp, texto);
    return;
  }
  if (at.canal === 'email') {
    if (!at.clienteEmail) throw new Error('Atendimento sem e-mail');
    await sendEmail(at.clienteEmail, 'Re: seu contato com o ZapScript', texto.replace(/\n/g, '<br>'));
    return;
  }
  if (at.canal === 'chat') {
    io.to(`chat:${at.threadId}`).emit('suporte:resposta', { atendimentoId: at.id, texto });
    return;
  }
  throw new Error(`Canal não suportado para envio: ${at.canal}`);
}

/**
 * Mensagem inicial (saudação) enviada quando uma nova conversa começa.
 * Só faz sentido em canais "push" imediatos (WhatsApp/Chat) — em e-mail evita-se
 * auto-resposta para não criar ruído/loop.
 */
export async function sendWelcome(at: any): Promise<void> {
  if (at.canal !== 'whatsapp' && at.canal !== 'chat') return;
  const nome = (at.clienteNome && !/^\d+$/.test(at.clienteNome)) ? at.clienteNome.split(' ')[0] : '';
  const texto = process.env.SUPPORT_WELCOME_MSG
    || `Olá${nome ? ' ' + nome : ''}! 👋 Sou o assistente virtual do ZapScript. `
       + `Já estou analisando sua mensagem e respondo em instantes. `
       + `Se for algo mais delicado, encaminho para um atendente humano.`;
  await sendOnChannel(at, texto).catch(() => { /* saudação é best-effort */ });
}

/**
 * Alerta o admin no WhatsApp quando um atendimento precisa de intervenção humana
 * (escalação ou baixa confiança). Usa a própria instância de suporte para mandar
 * a mensagem ao número pessoal definido em ADMIN_NOTIFY_PHONE.
 */
export async function notifyAdminEscalation(at: any, motivo: string, log?: any): Promise<void> {
  const adminPhone = process.env.ADMIN_NOTIFY_PHONE;
  const instance   = process.env.SUPPORT_EVOLUTION_INSTANCE;
  if (!adminPhone || !instance) return; // sem destino/instância → painel continua sendo o canal

  const canalLabel: Record<string, string> = { whatsapp: 'WhatsApp', email: 'E-mail', chat: 'Chat do site' };
  const cliente = at.clienteNome || at.clienteWhatsapp || at.clienteEmail || 'cliente';
  const contato = at.clienteWhatsapp || at.clienteEmail || '';
  const msg = (at.mensagemOriginal || '').slice(0, 300);

  const linhas = [
    '🆘 *Atendimento precisa de você*',
    `Canal: ${canalLabel[at.canal] || at.canal}`,
    `Cliente: ${cliente}${contato ? ` (${contato})` : ''}`,
    `Categoria: ${at.categoria || '—'} | Prioridade: ${at.prioridade || '—'}`,
    typeof at.confiancaResposta === 'number' ? `Confiança: ${at.confiancaResposta}%` : '',
    '',
    `"${msg}"`,
    '',
    `Motivo: ${motivo}`,
    'Responda na aba *Atendimento* do painel.',
  ].filter(Boolean);

  try {
    await sendText(instance, adminPhone, linhas.join('\n'));
    log?.info?.(`[Suporte] 📲 Admin notificado sobre atendimento ${at.id}`);
  } catch (e: any) {
    log?.warn?.(`[Suporte] Falha ao notificar admin: ${e.message}`);
  }
}
