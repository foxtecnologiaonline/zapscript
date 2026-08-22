/**
 * onboarding-whatsapp.ts
 *
 * Motor único de onboarding conversacional via WhatsApp, com dois pontos de
 * entrada que convergem no mesmo estado (WhatsappOnboardingLead):
 *
 *   1. startFromSiteSignup — o usuário já se cadastrou no site (com telefone).
 *      Dispara EM PARALELO com o pairing code exibido no painel (não é
 *      fallback: os dois canais correm ao mesmo tempo, mesmo código).
 *   2. startFromOfficialNumber — um estranho manda mensagem de texto direto
 *      pro número oficial do ZapScript sem nunca ter passado pelo site;
 *      conduz cadastro (consentimento → e-mail → conta) + conexão do zero.
 *
 * Estágios (WhatsappOnboardingLead.stage):
 *   started → awaiting_consent → awaiting_email → confirm_number
 *   → code_sent → completed
 *   (qualquer estágio) → escalated — 2 respostas não reconhecidas em sequência
 *
 * Toda mensagem sai pela instância do NÚMERO OFICIAL (isPublic=true) — nunca
 * pela instância SUPPORT_EVOLUTION_INSTANCE (exclusiva do Agente de Suporte).
 */
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { sendText, instanceName as evoInstanceName } from './evolution';
import { provisionInstance, requestPairingCode } from './number-provisioning';
import { createPasswordlessAccount } from './account-provisioning';
import { intakeMessage } from './support-intake';

const APP_URL = process.env.APP_URL || 'https://zapscript.me';
const MAX_ATTEMPTS_BEFORE_ESCALATE = 2;

function cleanPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('55') ? digits : `55${digits}`;
}

function isAffirmative(text: string): boolean {
  const t = text.trim().toLowerCase();
  return ['sim', 's', 'ok', 'okay', '1', 'claro', 'isso', 'confirmo', 'pode', 'quero'].includes(t);
}

function isNegative(text: string): boolean {
  const t = text.trim().toLowerCase();
  return ['não', 'nao', 'n', '2'].includes(t);
}

function extractEmail(text: string): string | null {
  const m = text.trim().match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
  return m ? m[0].toLowerCase() : null;
}

/** Um número de telefone plausível na resposta (8-13 dígitos), diferente de SIM/NÃO/etc. */
function extractPhone(text: string): string | null {
  const digits = text.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 13 ? digits : null;
}

/** Instância do número oficial (isPublic=true) — usada para toda mensagem do onboarding. */
async function getOfficialInstanceName(): Promise<string | null> {
  const official = await prisma.whatsappNumber.findFirst({
    where:  { isPublic: true },
    select: { id: true, zapiInstanceId: true },
  });
  if (!official) return null;
  return official.zapiInstanceId ?? evoInstanceName(official.id);
}

async function sendOfficial(phone: string, text: string, knownInstanceName?: string | null): Promise<void> {
  const instanceNameStr = knownInstanceName ?? await getOfficialInstanceName();
  if (!instanceNameStr) {
    logger.warn('[OnboardingWA] Número oficial (isPublic) não encontrado — mensagem não enviada');
    return;
  }
  await sendText(instanceNameStr, phone, text).catch((err: any) =>
    logger.warn(`[OnboardingWA] Falha ao enviar para ${phone}: ${err.message}`)
  );
}

function firstNameOf(name: string | null | undefined): string {
  return name?.trim().split(' ')[0] || '';
}

/**
 * Entrada 1: cadastro pelo site. Chamada logo após POST /auth/register já ter
 * provisionado a instância e obtido o pairing code (evita pedir um SEGUNDO
 * código à Evolution — site e WhatsApp precisam mostrar o MESMO código).
 * Dispara em paralelo com a tela de pairing code do painel, não como fallback.
 */
export async function startFromSiteSignup(
  userId: string,
  numberId: string,
  phone: string,
  pairingCode: string | null,
): Promise<void> {
  const phoneClean = cleanPhone(phone);

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  const nome = firstNameOf(user?.name);

  await prisma.whatsappOnboardingLead.upsert({
    where:  { phone: phoneClean },
    create: {
      phone: phoneClean, stage: pairingCode ? 'code_sent' : 'started',
      name: user?.name ?? null, userId, numberId, source: 'site',
    },
    update: {
      stage: pairingCode ? 'code_sent' : 'started',
      userId, numberId, source: 'site', attempts: 0,
    },
  });

  if (!pairingCode) {
    logger.warn(`[OnboardingWA] Sem pairing code p/ site signup (número ${numberId}) — runOnboardingNudge cobre depois`);
    return;
  }

  const msg = [
    `👋 ${nome ? `${nome}, oi` : 'Oi'}! Aqui é o ZapScript.`,
    '',
    'Pra conectar seu WhatsApp (mesmo código que apareceu no site):',
    '1️⃣ Abra o WhatsApp no seu celular',
    '2️⃣ Toque em ⋮ (ou Configurações) → *Aparelhos conectados*',
    '3️⃣ *Conectar um aparelho* → digite o código abaixo',
    '',
    `*${pairingCode}*`,
    '',
    'Assim que conectar, eu confirmo por aqui. 🎉',
  ].join('\n');

  await sendOfficial(phoneClean, msg);
}

// ── Entrada 2: estranho manda texto pro número oficial (sem conta ainda) ──
export async function startFromOfficialNumber(phone: string, pushName: string | null, instanceNameStr: string): Promise<void> {
  const phoneClean = cleanPhone(phone);

  await prisma.whatsappOnboardingLead.upsert({
    where:  { phone: phoneClean },
    create: { phone: phoneClean, stage: 'awaiting_consent', pushName, source: 'oficial' },
    update: { stage: 'awaiting_consent', pushName, source: 'oficial', attempts: 0 },
  });

  const nome = firstNameOf(pushName);
  const msg = [
    `👋 ${nome ? `Oi, ${nome}!` : 'Oi!'} Aqui é o ZapScript — eu converto e resumo áudios do WhatsApp automaticamente.`,
    '',
    'Posso criar sua conta grátis e já deixar seu WhatsApp conectado, tudo por aqui mesmo. Antes, preciso do seu aceite:',
    `📄 Termos de Uso e Política de Privacidade: ${APP_URL}/termos`,
    '',
    'Responda *SIM* para continuar.',
  ].join('\n');

  await sendOfficial(phoneClean, msg, instanceNameStr);
}

/**
 * Ponto de entrada único chamado pelo webhook (evolution-webhook.ts) para
 * toda mensagem de TEXTO que chega na instância do número oficial.
 * Retorna true se tratou a mensagem (o webhook não deve seguir o fluxo padrão).
 */
export async function handleOfficialNumberText(
  instanceNameStr: string,
  senderPhone: string,
  senderName: string | null,
  text: string,
  messageId?: string,
): Promise<boolean> {
  const phoneClean = cleanPhone(senderPhone);

  const lead = await prisma.whatsappOnboardingLead.findUnique({ where: { phone: phoneClean } });

  if (lead && lead.stage !== 'completed' && lead.stage !== 'escalated') {
    await handleReply(lead, text, instanceNameStr, messageId);
    return true;
  }
  if (lead) return false; // já completo ou escalado — não reprocessa, deixa cair no fluxo padrão

  // Sem lead: já é cliente cadastrado conversando por outro motivo? Não é onboarding.
  const digits = phoneClean.slice(-8);
  const existingUser = await prisma.user.findFirst({
    where:  { phone: { contains: digits } },
    select: { id: true },
  }).catch(() => null);
  if (existingUser) return false;

  // Estranho de verdade → inicia cadastro conversacional
  await startFromOfficialNumber(senderPhone, senderName, instanceNameStr);
  return true;
}

async function escalate(lead: { phone: string; name: string | null; pushName: string | null }, motivo: string, ultimaMensagem: string, messageId?: string): Promise<void> {
  await prisma.whatsappOnboardingLead.update({
    where: { phone: lead.phone },
    data:  { stage: 'escalated' },
  }).catch(() => null);

  await intakeMessage({
    canal:           'whatsapp',
    mensagem:        `[Onboarding não concluído — ${motivo}] ${ultimaMensagem}`,
    clienteNome:     lead.name || lead.pushName || null,
    clienteWhatsapp: lead.phone,
    canalExternoId:  messageId ?? null,
    threadId:        `onboarding:${lead.phone}`,
  }, logger).catch((err: any) => logger.error(`[OnboardingWA] Falha ao escalar ${lead.phone}: ${err.message}`));
}

/** Parser de texto livre por estágio + avanço da state machine. */
export async function handleReply(
  lead: { phone: string; stage: string; name: string | null; pushName: string | null; email: string | null; attempts: number; userId: string | null; numberId: string | null },
  text: string,
  instanceNameStr: string,
  messageId?: string,
): Promise<void> {
  const { phone } = lead;

  async function unrecognized(repeatPrompt: string) {
    const attempts = lead.attempts + 1;
    if (attempts >= MAX_ATTEMPTS_BEFORE_ESCALATE) {
      await sendOfficial(phone, 'Vou chamar alguém da nossa equipe pra te ajudar por aqui — só um instante. 🙋', instanceNameStr);
      await escalate(lead, `não reconhecida no estágio ${lead.stage}`, text, messageId);
      return;
    }
    await prisma.whatsappOnboardingLead.update({ where: { phone }, data: { attempts } });
    await sendOfficial(phone, repeatPrompt, instanceNameStr);
  }

  switch (lead.stage) {
    case 'awaiting_consent': {
      if (isAffirmative(text)) {
        await prisma.whatsappOnboardingLead.update({ where: { phone }, data: { stage: 'awaiting_email', attempts: 0 } });
        await sendOfficial(phone, 'Show! Qual é o seu e-mail? (é só pra você conseguir acessar o painel também, se quiser)', instanceNameStr);
        return;
      }
      await unrecognized('Pra continuar, preciso do seu aceite dos Termos e da Política de Privacidade. Responda *SIM* para continuar.');
      return;
    }

    case 'awaiting_email': {
      const email = extractEmail(text);
      if (!email) {
        await unrecognized('Não entendi — pode mandar só o seu e-mail? (ex: nome@email.com)');
        return;
      }
      const result = await createPasswordlessAccount({
        email,
        name: lead.pushName || undefined,
        phone,
      });
      if (!result.ok) {
        await sendOfficial(phone, 'Deu um erro criando sua conta agora — vou chamar alguém pra te ajudar. 🙏', instanceNameStr);
        await escalate(lead, 'falha ao criar conta', text, messageId);
        return;
      }
      if (result.alreadyExisted) {
        await sendOfficial(phone, 'Esse e-mail já tem conta no ZapScript! Mandei um link de acesso pra ele — e já vamos conectar seu WhatsApp aqui mesmo.', instanceNameStr);
        // Sem userId novo (conta já existia) — segue mesmo assim para conectar o número.
        await prisma.whatsappOnboardingLead.update({
          where: { phone }, data: { email, stage: 'confirm_number', attempts: 0 },
        });
        await sendOfficial(phone, 'Vamos conectar ESTE número que você está usando agora? Responda *SIM* (ou mande outro número de WhatsApp).', instanceNameStr);
        return;
      }
      await prisma.whatsappOnboardingLead.update({
        where: { phone }, data: { email, userId: result.userId, stage: 'confirm_number', attempts: 0 },
      });
      await sendOfficial(phone, 'Conta criada! 🎉 Vamos conectar ESTE número que você está usando agora? Responda *SIM* (ou mande outro número de WhatsApp).', instanceNameStr);
      return;
    }

    case 'confirm_number': {
      let targetPhone: string | null = null;
      if (isAffirmative(text)) targetPhone = phone;
      else if (isNegative(text)) {
        await unrecognized('Sem problema — me manda o número de WhatsApp (com DDD) que você quer conectar.');
        return;
      } else {
        targetPhone = extractPhone(text);
      }
      if (!targetPhone) {
        await unrecognized('Não entendi — responda *SIM* para conectar este número, ou mande outro número (com DDD).');
        return;
      }
      if (!lead.userId) {
        // Conta já existia (fluxo alcançou aqui via "e-mail já cadastrado") mas sem userId
        // resolvido no lead ainda — resolve agora pelo e-mail antes de criar o número.
        const u = lead.email ? await prisma.user.findUnique({ where: { email: lead.email }, select: { id: true } }) : null;
        if (!u) {
          await sendOfficial(phone, 'Não consegui localizar sua conta agora — vou chamar alguém pra te ajudar. 🙏', instanceNameStr);
          await escalate(lead, 'userId não resolvido em confirm_number', text, messageId);
          return;
        }
        lead.userId = u.id;
      }

      const number = await prisma.whatsappNumber.create({
        data: { userId: lead.userId, displayName: firstNameOf(lead.name || lead.pushName) || 'Meu WhatsApp', phoneNumber: cleanPhone(targetPhone) },
      });

      const provision = await provisionInstance(number.id, logger);
      if (!provision.ok) {
        await sendOfficial(phone, 'Deu um erro configurando a conexão agora — vou chamar alguém pra te ajudar. 🙏', instanceNameStr);
        await escalate(lead, 'provisionInstance falhou em confirm_number', text, messageId);
        return;
      }
      const pairing = await requestPairingCode(number.id, targetPhone, logger);
      if (!pairing.ok) {
        await sendOfficial(phone, 'Deu um erro gerando o código agora — vou chamar alguém pra te ajudar. 🙏', instanceNameStr);
        await escalate(lead, 'pairing code falhou em confirm_number', text, messageId);
        return;
      }

      await prisma.whatsappOnboardingLead.update({
        where: { phone }, data: { numberId: number.id, stage: 'code_sent', attempts: 0 },
      });

      const msg = [
        'Perfeito! Pra conectar:',
        '1️⃣ Abra o WhatsApp no celular que você quer conectar',
        '2️⃣ Toque em ⋮ (ou Configurações) → *Aparelhos conectados*',
        '3️⃣ *Conectar um aparelho* → digite o código abaixo',
        '',
        `*${pairing.code}*`,
        '',
        'Assim que conectar, eu confirmo por aqui. 🎉',
      ].join('\n');
      await sendOfficial(phone, msg, instanceNameStr);
      return;
    }

    case 'code_sent': {
      await sendOfficial(phone, 'Ainda estou aguardando você digitar o código no WhatsApp (Aparelhos conectados → Conectar um aparelho). Assim que conectar, eu aviso por aqui. 🙂', instanceNameStr);
      return;
    }

    default:
      return;
  }
}

/** Chamado pelo webhook (connection.update, state='open') para fechar o lead correspondente. */
export async function closeLeadOnConnected(numberId: string): Promise<void> {
  const lead = await prisma.whatsappOnboardingLead.findFirst({ where: { numberId, stage: { not: 'completed' } } });
  if (!lead) return;

  await prisma.whatsappOnboardingLead.update({ where: { phone: lead.phone }, data: { stage: 'completed' } });

  const nome = firstNameOf(lead.name || lead.pushName);
  const msg = `✅ ${nome ? `${nome}, prontinho` : 'Prontinho'}! Seu WhatsApp já está conectado ao ZapScript. A partir de agora, cada áudio que chegar por aqui já sai convertido e resumido automaticamente. 🎉`;
  await sendOfficial(lead.phone, msg).catch(() => null);
}

type LeadRow = {
  phone: string; stage: string; name: string | null; pushName: string | null;
  email: string | null; attempts: number; userId: string | null; numberId: string | null;
};

/**
 * Reenvia o passo pendente para um lead parado — chamado pelo job periódico
 * (onboarding-nudge.ts) quando não há atualização há 30-60min. Pairing code
 * expira rápido no WhatsApp, então 'code_sent' pede um código novo em vez de
 * reenviar o antigo.
 */
export async function nudgeStuckLead(lead: LeadRow): Promise<void> {
  const instanceNameStr = await getOfficialInstanceName();
  if (!instanceNameStr) return;

  let sent = false;

  switch (lead.stage) {
    case 'started':
    case 'awaiting_consent':
      await sendOfficial(lead.phone, 'Oi, ainda estou por aqui! Só preciso do seu aceite dos Termos pra criar sua conta — responda *SIM* quando puder. 🙂', instanceNameStr);
      sent = true;
      break;
    case 'awaiting_email':
      await sendOfficial(lead.phone, 'Só falta o seu e-mail pra eu criar sua conta grátis — pode mandar quando puder. 😉', instanceNameStr);
      sent = true;
      break;
    case 'confirm_number':
      await sendOfficial(lead.phone, 'Ainda dá tempo de conectar seu WhatsApp! Responda *SIM* pra conectar este número, ou me manda outro (com DDD).', instanceNameStr);
      sent = true;
      break;
    case 'code_sent': {
      if (!lead.numberId) break;
      const pairing = await requestPairingCode(lead.numberId, lead.phone, logger);
      if (pairing.ok) {
        await sendOfficial(lead.phone, `O código anterior deve ter expirado — aqui vai um novo:\n\n*${pairing.code}*\n\nNo WhatsApp: Aparelhos conectados → Conectar um aparelho.`, instanceNameStr);
        sent = true;
      }
      // pairing falhou (Evolution indisponível etc.): não manda nada e NÃO bumpa
      // updatedAt abaixo — o lead deve seguir envelhecendo normalmente para que
      // o próximo ciclo do onboarding-nudge o escale a um humano em vez de ficar
      // preso num loop silencioso de tentativas que nunca alcança os >60min.
      break;
    }
    default:
      return;
  }

  if (!sent) return;

  // Bump em updatedAt (via write de um campo existente) — evita renotificar no
  // próximo ciclo antes da janela de 30-60min passar de novo.
  await prisma.whatsappOnboardingLead.update({ where: { phone: lead.phone }, data: { stage: lead.stage } }).catch(() => null);
}

/** Abandono confirmado (sem resposta ao lembrete) — escala pro Agente de Suporte. */
export async function escalateAbandonedLead(lead: LeadRow): Promise<void> {
  await escalate(lead, 'abandonado — sem resposta após lembrete', '(sem resposta)');
}
