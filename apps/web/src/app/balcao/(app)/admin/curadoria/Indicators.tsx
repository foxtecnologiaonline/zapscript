'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { bv, errMsg } from '@/lib/balcao/api';
import { fmtNumber, fmtPercent } from '@/lib/balcao/format';
import { Badge, Banner, Button, Card, Checkbox, DataTable, Select, Spinner, StatCard, TextField, useToast } from '../../../_ui/ui';
import { STATUS_LABEL, type ArticleStatus } from '../../conhecimento/_kb';

interface CurationStats {
  windowDays: number; botConversations: number; coverage: number | null; containment: number | null;
  suggestions: { open: number; accepted: number; dismissed: number };
  topGaps: Array<{ id: string; type: string; question: string; count: number }>;
  curationHoursEstimated: number; contractedHoursPerMonth: number;
  assumptions: { minutesPerSuggestionReviewed: number; minutesPerCuratedArticle: number };
}
interface AiStats {
  windowDays: number;
  conversations: { botHandled: number; resolvedByBot: number; escalated: number };
  containmentRate: number | null; escalationsByReason: Record<string, number>;
  accuracy: { helpful: number; unhelpful: number; rate: number | null; botResolvedCsatAvg: number | null; botResolvedCsatCount: number };
  iqa07: { value: number | null; numerator: number; denominator: number; perBotAttendance: number | null; targets: number[]; definition: string };
  usage: { aiCalls: number; aiTokens: number };
}
interface KbMetrics {
  byStatus: Record<string, number>; total: number; reviewDue: number; totalUses: number; totalHelpful: number; helpfulRate: number | null;
  topUsed: Array<{ id: string; title: string; useCount: number; helpfulCount: number }>;
  feedback30d: { helpful: number; unhelpful: number; helpfulRate: number | null };
}
interface RunResult { analyzed: number; clusters: number; created: number; updated: number; ambiguities: number; proposals: number }

const REASON_LABEL: Record<string, string> = {
  HUMAN_REQUEST: 'Cidadão pediu atendente', KEYWORD: 'Palavra de escalonamento', NEGATIVE_SENTIMENT: 'Sentimento negativo', NOT_RESOLVED: 'Cidadão disse que não resolveu',
  MAX_TURNS: 'Limite de turnos do assistente', LOW_CONFIDENCE: 'Baixa confiança', NO_ARTICLE: 'Sem artigo na base', LLM_NEEDS_HUMAN: 'IA indicou atendimento humano',
  LLM_INVALID: 'Resposta da IA inválida', LLM_ERROR: 'Erro no serviço de IA', QUOTA: 'Cota esgotada', NON_TEXT: 'Mensagem não textual', TOOL_ERROR: 'Erro em ferramenta',
  TOOL_UNKNOWN: 'Ferramenta desconhecida', ASSISTED_TRIAGE: 'Triagem assistida (modo assistido)', BOT_STALLED: 'Assistente sem resposta', UNKNOWN: 'Motivo não informado',
};
const GAP_TYPE: Record<string, string> = { GAP: 'Lacuna', NEW_ARTICLE: 'Novo artigo', AMBIGUITY: 'Ambiguidade', IMPROVE: 'Melhoria' };

/** Barra de proporção: o valor numérico sempre aparece em texto ao lado. */
function Meter({ value, label, target }: { value: number | null; label: string; target?: number }) {
  const pct = value == null ? 0 : Math.max(0, Math.min(1, value));
  return (
    <div className="mt-2" role="img" aria-label={`${label}: ${value == null ? 'sem dados' : fmtPercent(value * 100)}${target != null ? `, meta ${Math.round(target * 100)}%` : ''}`}>
      <div className="relative h-2 w-full rounded-full bg-bv-subtle border border-bv-border">
        <div className="h-full rounded-full bg-bv-primary" style={{ width: `${pct * 100}%` }} />
        {target != null && <div className="absolute top-[-3px] h-3.5 w-0.5 bg-bv-text" style={{ left: `${target * 100}%` }} />}
      </div>
    </div>
  );
}

export function Indicators() {
  const toast = useToast();
  const [days, setDays] = useState('30');
  const [cs, setCs] = useState<CurationStats | null>(null); const [ai, setAi] = useState<AiStats | null>(null); const [kb, setKb] = useState<KbMetrics | null>(null);
  const [errs, setErrs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [a, b, c] = await Promise.allSettled([
      bv.get<CurationStats>('/kb/curation/stats', { days }), bv.get<AiStats>('/ai/stats', { days }), bv.get<KbMetrics>('/kb/metrics'),
    ]);
    const e: string[] = [];
    if (a.status === 'fulfilled') setCs(a.value); else { setCs(null); e.push(`Indicadores da curadoria: ${errMsg(a.reason)}`); }
    if (b.status === 'fulfilled') setAi(b.value); else { setAi(null); e.push(`Indicadores do assistente (exigem permissão de relatórios): ${errMsg(b.reason)}`); }
    if (c.status === 'fulfilled') setKb(c.value); else { setKb(null); e.push(`Métricas da base: ${errMsg(c.reason)}`); }
    setErrs(e); setLoading(false);
  }, [days]);
  useEffect(() => { void load(); }, [load]);

  const iqa = ai?.iqa07.value ?? null;
  const targets = ai?.iqa07.targets ?? [0.4, 0.6, 0.8];
  const reached = iqa == null ? null : [...targets].reverse().find((t) => iqa >= t) ?? null;
  const containment = ai?.containmentRate ?? cs?.containment ?? null;
  const accuracy = ai?.accuracy.rate ?? kb?.feedback30d.helpfulRate ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-48"><Select label="Período analisado" value={days} onChange={(e) => setDays(e.target.value)}>
          <option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option><option value="365">Últimos 12 meses</option>
        </Select></div>
        <Button variant="secondary" onClick={() => void load()} loading={loading}>Atualizar</Button>
      </div>

      {errs.map((m) => <Banner key={m} tone="warning" title="Indicador indisponível">{m}</Banner>)}
      {loading && !cs && !ai && !kb ? <div className="p-6 text-center"><Spinner /></div> : (
        <>
          <section aria-label="Resumo dos indicadores" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <StatCard label="Cobertura da base" value={fmtPercent(cs?.coverage != null ? cs.coverage * 100 : null)} hint="Conversas do assistente cobertas por artigo ou fluxo" />
              <Meter value={cs?.coverage ?? null} label="Cobertura da base" />
            </div>
            <div>
              <StatCard label="Taxa de contenção do assistente" value={fmtPercent(containment != null ? containment * 100 : null)} hint="Resolvidas sem atendente humano" />
              <Meter value={containment} label="Taxa de contenção" />
            </div>
            <div>
              <StatCard label="IQA 07 (parcial)" value={fmtPercent(iqa != null ? iqa * 100 : null)}
                hint={ai ? `${ai.iqa07.numerator} de ${ai.iqa07.denominator} automatizáveis resolvidas no 1º contato` : undefined}
                tone={iqa == null ? 'neutral' : reached ? 'success' : 'warning'} />
              <Meter value={iqa} label="IQA 07" target={targets[0]} />
              <p className="mt-1 text-xs">{iqa == null ? 'Sem dados no período.' : reached ? `Meta de ${Math.round(reached * 100)}% atingida.` : `Abaixo da meta inicial de ${Math.round(targets[0] * 100)}%.`} <span className="text-bv-muted">Metas: {targets.map((t) => `${Math.round(t * 100)}%`).join(' → ')}.</span></p>
            </div>
            <div>
              <StatCard label="Assertividade (feedback útil)" value={fmtPercent(accuracy != null ? accuracy * 100 : null)}
                hint={ai ? `${ai.accuracy.helpful} úteis · ${ai.accuracy.unhelpful} não úteis` : kb ? `${kb.feedback30d.helpful} úteis · ${kb.feedback30d.unhelpful} não úteis (30 dias)` : undefined} />
              <Meter value={accuracy} label="Assertividade" />
            </div>
          </section>

          <section aria-label="Horas e sugestões" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Horas de curadoria (estimadas)" value={cs ? `${fmtNumber(cs.curationHoursEstimated, 1)} h` : '—'}
              hint={cs ? `Contratadas: ${cs.contractedHoursPerMonth} h/mês · base: ${cs.assumptions.minutesPerSuggestionReviewed} min por sugestão e ${cs.assumptions.minutesPerCuratedArticle} min por artigo` : undefined} />
            <StatCard label="Sugestões abertas" value={cs ? cs.suggestions.open : '—'} hint={cs ? `${cs.suggestions.accepted} aceitas · ${cs.suggestions.dismissed} dispensadas no período` : undefined} />
            <StatCard label="Conversas do assistente" value={ai ? ai.conversations.botHandled : cs ? cs.botConversations : '—'} hint={ai ? `${ai.conversations.resolvedByBot} resolvidas · ${ai.conversations.escalated} escaladas` : undefined} />
            <StatCard label="CSAT das resolvidas pelo assistente" value={ai?.accuracy.botResolvedCsatAvg != null ? fmtNumber(ai.accuracy.botResolvedCsatAvg, 1) : '—'} hint={ai ? `${ai.accuracy.botResolvedCsatCount} avaliações` : undefined} />
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Principais lacunas da base">
              <DataTable caption="Sugestões abertas com mais ocorrências" rows={cs?.topGaps ?? []} rowKey={(g) => g.id} empty="Nenhuma lacuna aberta."
                columns={[
                  { key: 'q', header: 'Pergunta', render: (g) => g.question },
                  { key: 't', header: 'Tipo', render: (g) => <Badge>{GAP_TYPE[g.type] ?? g.type}</Badge> },
                  { key: 'c', header: 'Ocorrências', render: (g) => g.count, className: 'text-right' },
                ]} />
            </Card>
            <Card title="Motivos de escalonamento para atendente">
              <DataTable caption="Escalonamentos por motivo" rows={Object.entries(ai?.escalationsByReason ?? {}).sort((a, b) => b[1] - a[1])} rowKey={(r) => r[0]} empty="Nenhum escalonamento no período."
                columns={[
                  { key: 'm', header: 'Motivo', render: (r) => REASON_LABEL[r[0]] ?? r[0] },
                  { key: 'n', header: 'Quantidade', render: (r) => r[1], className: 'text-right' },
                ]} />
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Situação da base de conhecimento">
              {kb ? (
                <>
                  <DataTable caption="Artigos por situação" rows={(Object.keys(STATUS_LABEL) as ArticleStatus[]).map((s) => ({ s, n: kb.byStatus[s] ?? 0 }))} rowKey={(r) => r.s}
                    columns={[{ key: 's', header: 'Situação', render: (r) => STATUS_LABEL[r.s] }, { key: 'n', header: 'Artigos', render: (r) => r.n, className: 'text-right' }]} />
                  <p className="mt-2 text-sm">Total: <strong>{kb.total}</strong> · Revisão periódica vencida: <strong className={kb.reviewDue ? 'text-bv-danger' : ''}>{kb.reviewDue}</strong>{kb.reviewDue > 0 && ' (atenção)'}</p>
                </>
              ) : <p className="text-sm text-bv-muted">Indisponível.</p>}
            </Card>
            <Card title="Artigos mais usados">
              <DataTable caption="Artigos aprovados mais usados" rows={kb?.topUsed ?? []} rowKey={(a) => a.id} empty="Sem uso registrado."
                columns={[
                  { key: 't', header: 'Artigo', render: (a) => a.title },
                  { key: 'u', header: 'Usos', render: (a) => a.useCount, className: 'text-right' },
                  { key: 'h', header: 'Úteis', render: (a) => a.helpfulCount, className: 'text-right' },
                ]} />
            </Card>
          </div>

          {ai && <p className="text-xs text-bv-muted">IQA 07: {ai.iqa07.definition}. Uso de IA no período: {fmtNumber(ai.usage.aiCalls)} chamadas, {fmtNumber(ai.usage.aiTokens)} tokens.</p>}
        </>
      )}

      <RunCuration onDone={(r) => { toast.success(`Curadoria concluída: ${r.created} novas sugestões.`); void load(); }} />
    </div>
  );
}

function RunCuration({ onDone }: { onDone: (r: RunResult) => void }) {
  const [days, setDays] = useState('30'); const [minCluster, setMin] = useState('2'); const [propose, setPropose] = useState(true);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [res, setRes] = useState<RunResult | null>(null);
  const run = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setRes(null);
    const d = Number(days), m = Number(minCluster);
    if (!Number.isInteger(d) || d < 1 || d > 365) { setErr('Período deve estar entre 1 e 365 dias.'); return; }
    if (!Number.isInteger(m) || m < 2 || m > 50) { setErr('Tamanho mínimo do grupo deve estar entre 2 e 50.'); return; }
    setBusy(true);
    try { const r = await bv.post<RunResult>('/kb/curation/run', { days: d, minCluster: m, propose }); setRes(r); onDone(r); }
    catch (er) { setErr(errMsg(er)); } finally { setBusy(false); }
  };
  return (
    <Card title="Executar curadoria agora">
      <p className="mb-3 text-sm text-bv-muted">A curadoria roda automaticamente todos os dias. Use este botão para gerar sugestões sob demanda: ela agrupa perguntas parecidas sem cobertura, detecta ambiguidades e, se marcado, pede à IA uma proposta de artigo. Pode levar alguns minutos.</p>
      <form onSubmit={run} className="grid gap-3 sm:grid-cols-4 sm:items-end" noValidate>
        <TextField label="Analisar últimos (dias)" type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} />
        <TextField label="Mínimo de ocorrências por grupo" type="number" min={2} max={50} value={minCluster} onChange={(e) => setMin(e.target.value)} />
        <Checkbox label="Gerar proposta de resposta com IA" checked={propose} onChange={(e) => setPropose(e.target.checked)} />
        <Button type="submit" loading={busy}>Executar curadoria agora</Button>
      </form>
      {busy && <p role="status" className="mt-2 text-sm">Executando a curadoria… aguarde, não feche esta página.</p>}
      {err && <div className="mt-3"><Banner tone="danger">{err}</Banner></div>}
      {res && (
        <div className="mt-3"><Banner tone="success" title="Curadoria executada">
          {res.analyzed} conversas analisadas · {res.clusters} grupos · {res.created} sugestões novas · {res.updated} atualizadas · {res.ambiguities} ambiguidades · {res.proposals} propostas da IA.
          Veja a aba “Sugestões da curadoria”.
        </Banner></div>
      )}
    </Card>
  );
}
