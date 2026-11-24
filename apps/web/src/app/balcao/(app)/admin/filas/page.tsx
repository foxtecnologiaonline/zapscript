'use client';
import React from 'react';
import Link from 'next/link';
import { useBvSession } from '@/lib/balcao/session';
import { Banner, PageHeader, Tabs } from '../../../_ui/ui';
import { NoPerm } from '../usuarios/_shared';
import CannedTab from './CannedTab';
import QueuesTab from './QueuesTab';
import RulesTab from './RulesTab';

export default function FilasPage() {
  const { can } = useBvSession();
  if (!can('queue:manage') && !can('routing:manage')) return <><PageHeader title="Filas e roteamento" /><NoPerm perm="queue:manage ou routing:manage" /></>;
  const tabs = [
    ...(can('queue:manage') ? [{ id: 'filas', title: 'Filas', content: <QueuesTab /> }] : []),
    ...(can('routing:manage') ? [{ id: 'regras', title: 'Regras de roteamento', content: <RulesTab /> }] : []),
    ...(can('queue:manage') ? [{ id: 'respostas', title: 'Respostas prontas', content: <CannedTab /> }] : []),
  ];
  return (
    <div>
      <PageHeader title="Filas e roteamento" subtitle="Distribuição de conversas entre filas e atendentes, regras de roteamento e respostas prontas." />
      <Tabs label="Seções de filas e roteamento" tabs={tabs} />
      <div className="mt-6">
        <Banner tone="primary" title="Histórico de alterações">
          A API ainda não oferece consulta ao histórico de versões de filas e regras. Cada alteração fica registrada na <Link className="underline" href="/balcao/admin/auditoria">Auditoria</Link> (ações <code>queue.*</code> e <code>routing-rule.*</code>).
        </Banner>
      </div>
    </div>
  );
}
