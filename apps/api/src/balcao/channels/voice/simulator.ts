import { prisma } from '../../../lib/prisma';
import { assignConversation, closeConversation, escalateToHuman, openConversation } from '../../core/conversations';
import { getHolidays, getOrgSettings } from '../../core/settings';
import { newKey, putObject } from '../../core/storage';
import { flowDefinition, resolveFlowForDid, FlowError } from './ivrFlows';
import { entryOptionOf, loadUra0800 } from './ura0800';
import { simulateIvr, type IvrResult } from './ivr';
import { makeToneWav } from './wav';


/**
 * Simulador de desenvolvimento (BV_DEV_SIMULATORS=1): percorre a URA sem telefonia e cria BvCall + conversa +
 * gravação fictícia (WAV gerado), para demonstrar a PoC sem Asterisk. NÃO registra consumo (VOICE_MINUTES).
 */
export interface SimulateCallInput { from: string; did: string; inputs: string[]; agentUserId?: string; durationSec?: number; closeConversation?: boolean; headers?: Record<string, string> }

export async function simulateCall(orgId: string, i: SimulateCallInput) {
  const flow = await resolveFlowForDid(orgId, i.did);
  if (!flow) throw new FlowError('ivr.no_flow', `Nenhum fluxo ACTIVE atende o DID ${i.did}`, 404);
  const settings = await getOrgSettings(orgId);
  const def = flowDefinition(flow);
  const sim = await simulateIvr(def, i.inputs, { now: () => new Date(), settings, holidays: await getHolidays(orgId) }, { lang: def.defaultLang ?? settings.language, headers: i.headers });
  const out = sim.outcome;
  const startedAt = new Date();
  const duration = i.durationSec ?? 60;

  const call = await prisma.bvCall.create({ data: { orgId, direction: 'IN', fromNumber: i.from, toNumber: i.did, status: 'IVR', ivrFlowId: flow.id, startedAt, recordingNotified: true } });
  const { conversation } = await openConversation({
    orgId, channel: 'VOICE', channelRef: call.id, externalId: i.from, status: 'BOT',
    metadata: { voice: { callId: call.id, did: i.did, simulated: true, headers: i.headers ?? {} }, ivr: { entryOption: entryOptionOf(await loadUra0800(orgId), i.headers ?? {}), flowId: flow.id, lang: sim.lang, category: (out as any).category ?? null, queue: (out as any).queue ?? null, vars: sim.vars, outcome: out.action } },
  });
  let agentUserId: string | null = null;
  let closeReason: 'RESOLVED' | 'ABANDONED' | 'TRANSFERRED_OUT' | null = null;
  if (out.action === 'queue') {
    await escalateToHuman(orgId, conversation.id, { reason: 'ivr-sim', category: out.category ?? null });
    if (i.agentUserId) { await assignConversation({ orgId, conversationId: conversation.id, userId: i.agentUserId, via: 'MANUAL' }); agentUserId = i.agentUserId; closeReason = 'RESOLVED'; }
  } else if (out.action === 'hangup') closeReason = 'RESOLVED';
  else if (out.action === 'transfer') closeReason = 'TRANSFERRED_OUT';
  else closeReason = 'ABANDONED';

  const wav = makeToneWav(Math.min(3, Math.max(1, duration)));
  const stored = await putObject(newKey(orgId, 'recordings', 'wav'), wav);
  const endedAt = new Date(startedAt.getTime() + duration * 1000);
  await prisma.bvCall.update({
    where: { id: call.id },
    data: {
      conversationId: conversation.id, status: agentUserId || out.action !== 'queue' ? (out.action === 'aborted' ? 'ABANDONED' : 'ENDED') : 'ABANDONED', endedAt, durationSec: duration,
      endReason: 'SIMULATED', ivrPath: sim.trail as any, agentUserId, answeredAt: agentUserId ? startedAt : null,
      recordingKey: stored.key, recordingSha256: stored.sha256, recordingSizeBytes: BigInt(stored.size),
    },
  });
  const shouldClose = i.closeConversation ?? (out.action !== 'queue' || !!agentUserId);
  if (shouldClose && closeReason) await closeConversation({ orgId, conversationId: conversation.id, reason: closeReason, requestCsat: false, resolvedByBot: out.action === 'hangup' || undefined });
  return { callId: call.id, conversationId: conversation.id, protocol: conversation.protocol, outcome: out, trail: sim.trail as IvrResult['trail'], lang: sim.lang, recording: { sha256: stored.sha256, sizeBytes: stored.size }, unusedInputs: sim.unusedInputs };
}
