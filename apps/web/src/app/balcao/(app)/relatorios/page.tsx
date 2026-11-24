'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { useBvSession } from '@/lib/balcao/session';
import { CHANNEL_LABEL } from '@/lib/balcao/format';
import { Banner, Button, Card, PageHeader, Select, Tabs, TextField } from '../../_ui/ui';
import { CustomTab } from './custom';
import { MonthlyTab } from './monthly';
import { AgentsTab, ChannelsTab, IqaTab, NpsTab, OverviewTab, QueuesTab, ServiceDeskTab, SeriesTab, SlaTab, VoiceTab } from './tabs';
import { PERIOD_LABEL, daysBetween, fmtYmd, periodRange, toQuery, useApi, type NameMaps, type PeriodKey, type ReportFilters } from './lib';

export default function RelatoriosPage() {
  const { can } = useBvSession();
  const initial = periodRange('30d');
  const [draft, setDraft] = useState<ReportFilters>({ ...initial, channel: '', queueId: '', agentId: '' });
  const [applied, setApplied] = useState<ReportFilters>(draft);
  const [period, setPeriod] = useState<PeriodKey>('30d');
  const [error, setError] = useState<string | null>(null);

  // Opções de fila/atendente: derivadas dos próprios relatórios (qualquer perfil com report:read consegue, ao contrário de /queues e /agents).
  const optQ = useApi<any>(can('report:read') ? '/reports/queues' : null, { ...periodRange('30d') });
  const optA = useApi<any>(can('report:read') ? '/reports/agents' : null, { ...periodRange('30d') });
  const [names, setNames] = useState<NameMaps>({ queues: {}, agents: {} });
  useEffect(() => {
    setNames((n) => ({
      queues: { ...n.queues, ...Object.fromEntries((optQ.data?.queues ?? []).filter((r: any) => r.queue).map((r: any) => [r.queue, r.queueName ?? 'Fila sem nome'])) },
      agents: { ...n.agents, ...Object.fromEntries((optA.data?.agents ?? []).filter((r: any) => r.agent).map((r: any) => [r.agent, r.agentName ?? 'Atendente sem nome'])) },
    }));
  }, [optQ.data, optA.data]);

  const q = useMemo(() => toQuery(applied), [applied]);

  if (!can('report:read')) return <Banner tone="danger" title="Acesso negado">Você não tem permissão para ver relatórios.</Banner>;

  const validate = (f: ReportFilters): string | null => {
    if (!f.from || !f.to) return 'Informe as datas inicial e final.';
    if (f.from > f.to) return 'A data inicial deve ser anterior ou igual à final.';
    if (daysBetween(f.from, f.to) > 799) return 'O período máximo é de 800 dias.';
    return null;
  };
  const apply = (f: ReportFilters, p: PeriodKey) => { const e = validate(f); setError(e); if (e) return; setApplied(f); setPeriod(p); };
  const shortcut = (k: Exclude<PeriodKey, 'custom'>) => { const f = { ...draft, ...periodRange(k) }; setDraft(f); apply(f, k); };

  const props = { q, filters: applied, names };
  const tabs = [
    { id: 'geral', title: 'Visão geral', content: <OverviewTab {...props} /> },
    { id: 'series', title: 'Séries temporais', content: <SeriesTab {...props} /> },
    { id: 'atendentes', title: 'Atendentes', content: <AgentsTab {...props} /> },
    { id: 'filas', title: 'Filas', content: <QueuesTab {...props} /> },
    { id: 'canais', title: 'Canais', content: <ChannelsTab {...props} /> },
    { id: 'nps', title: 'NPS / CSAT', content: <NpsTab {...props} /> },
    { id: 'sla', title: 'SLA', content: <SlaTab {...props} /> },
    { id: 'iqa', title: 'IQA', content: <IqaTab {...props} /> },
    { id: 'voz', title: 'Voz', content: <VoiceTab {...props} /> },
    { id: 'isa', title: 'Service desk (ISA)', content: <ServiceDeskTab {...props} /> },
    { id: 'custom', title: 'Personalizados', content: <CustomTab names={names} /> },
    { id: 'mensal', title: 'Relatório mensal', content: <MonthlyTab /> },
  ];

  return (
    <div>
      <PageHeader title="Relatórios e indicadores" subtitle={`Período aplicado: ${fmtYmd(applied.from)} a ${fmtYmd(applied.to)} · fuso de Tocantins`} />
      <Card title="Filtros" className="mb-4">
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); apply(draft, 'custom'); }}>
          <fieldset>
            <legend className="mb-1 text-sm font-medium">Atalhos de período</legend>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(PERIOD_LABEL) as Array<keyof typeof PERIOD_LABEL>).map((k) => (
                <Button key={k} size="sm" variant={period === k ? 'primary' : 'secondary'} aria-pressed={period === k} onClick={() => shortcut(k)}>{PERIOD_LABEL[k]}</Button>
              ))}
            </div>
          </fieldset>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <TextField label="De" type="date" required value={draft.from} max={draft.to || undefined} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
            <TextField label="Até (inclusive)" type="date" required value={draft.to} min={draft.from || undefined} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
            <Select label="Canal" value={draft.channel} onChange={(e) => setDraft({ ...draft, channel: e.target.value })}>
              <option value="">Todos os canais</option>{Object.entries(CHANNEL_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
            <Select label="Fila" value={draft.queueId} onChange={(e) => setDraft({ ...draft, queueId: e.target.value })}>
              <option value="">Todas as filas</option>{Object.entries(names.queues).map(([id, n]) => <option key={id} value={id}>{n}</option>)}
            </Select>
            <Select label="Atendente" value={draft.agentId} onChange={(e) => setDraft({ ...draft, agentId: e.target.value })}>
              <option value="">Todos os atendentes</option>{Object.entries(names.agents).map(([id, n]) => <option key={id} value={id}>{n}</option>)}
            </Select>
          </div>
          {error && <Banner tone="danger">{error}</Banner>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit">Aplicar filtros</Button>
            <Button variant="ghost" onClick={() => { const f = { ...periodRange('30d'), channel: '', queueId: '', agentId: '' }; setDraft(f); apply(f, '30d'); }}>Limpar filtros</Button>
          </div>
          <p className="text-xs text-bv-muted">Filas e atendentes listados são os que tiveram atendimentos nos últimos 30 dias. Os atendimentos são contados pela data de início.</p>
        </form>
      </Card>
      <Tabs label="Tipos de relatório" tabs={tabs} />
    </div>
  );
}
