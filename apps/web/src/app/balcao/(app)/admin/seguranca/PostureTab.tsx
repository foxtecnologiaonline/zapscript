'use client';
import React, { useState } from 'react';
import { bv } from '@/lib/balcao/api';
import { fmtDateTime } from '@/lib/balcao/format';
import { Badge, Button, Card, Select, StatCard } from '../../../_ui/ui';
import { ErrorBox, Loading, Unavailable, useLoad } from '../usuarios/_shared';

type CheckStatus = 'OK' | 'WARN' | 'FAIL' | 'INFO';
type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
interface Check { id: string; title: string; status: CheckStatus; severity: Severity; detail: string; remediation?: string }
interface Posture { generatedAt: string; summary: Record<CheckStatus, number>; score: number; checks: Check[] }

const STATUS: Record<CheckStatus, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral'; order: number }> = {
  FAIL: { label: 'Falha', tone: 'danger', order: 0 }, WARN: { label: 'Atenção', tone: 'warning', order: 1 }, INFO: { label: 'Informativo', tone: 'neutral', order: 2 }, OK: { label: 'Conforme', tone: 'success', order: 3 },
};
const SEV: Record<Severity, { label: string; order: number }> = { CRITICAL: { label: 'Severidade crítica', order: 0 }, HIGH: { label: 'Severidade alta', order: 1 }, MEDIUM: { label: 'Severidade média', order: 2 }, LOW: { label: 'Severidade baixa', order: 3 } };

export default function PostureTab() {
  const { data, error, loading, unavailable, reload } = useLoad(() => bv.get<Posture>('/security/posture'), []);
  const [filter, setFilter] = useState('');
  if (unavailable) return <Unavailable what="A verificação de postura de segurança" />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <Loading label="Calculando a postura de segurança" />;
  const checks = [...data.checks].filter((c) => !filter || c.status === filter)
    .sort((a, b) => STATUS[a.status].order - STATUS[b.status].order || SEV[a.severity].order - SEV[b.severity].order);
  const scoreTone = data.score >= 85 ? 'success' : data.score >= 60 ? 'warning' : 'danger';
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-bv-muted">Calculada em {fmtDateTime(data.generatedAt)}. Verificações automáticas de chaves, MFA, retenção, backup, TLS, auditoria e LGPD.</p>
        <Button variant="secondary" loading={loading} onClick={reload}>Recalcular</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Nota de postura" value={`${data.score} / 100`} tone={scoreTone} hint={scoreTone === 'success' ? 'Boa' : scoreTone === 'warning' ? 'Requer atenção' : 'Crítica'} />
        <StatCard label="Falhas" value={data.summary.FAIL} tone={data.summary.FAIL ? 'danger' : 'neutral'} />
        <StatCard label="Atenções" value={data.summary.WARN} tone={data.summary.WARN ? 'warning' : 'neutral'} />
        <StatCard label="Conformes" value={data.summary.OK} tone="success" />
        <StatCard label="Informativos" value={data.summary.INFO} />
      </div>
      <div className="max-w-xs">
        <Select label="Filtrar por situação" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">Todas</option>
          {(Object.keys(STATUS) as CheckStatus[]).map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
        </Select>
      </div>
      <p role="status" aria-live="polite" className="text-sm text-bv-muted">{checks.length} verificação(ões) exibida(s).</p>
      <ul className="flex flex-col gap-3">
        {checks.map((c) => (
          <li key={c.id}>
            <Card as="article" title={c.title} actions={<div className="flex flex-wrap gap-1"><Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>{c.status !== 'OK' && c.status !== 'INFO' && <Badge>{SEV[c.severity].label}</Badge>}</div>}>
              <p className="text-sm">{c.detail}</p>
              {c.remediation && <p className="mt-2 text-sm"><strong>Como corrigir:</strong> {c.remediation}</p>}
              <p className="mt-2 text-xs text-bv-muted">Identificador: {c.id}</p>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
