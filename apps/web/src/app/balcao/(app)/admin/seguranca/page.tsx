'use client';
import React from 'react';
import { useBvSession } from '@/lib/balcao/session';
import { PageHeader, Tabs } from '../../../_ui/ui';
import { NoPerm } from '../usuarios/_shared';
import DsrTab from './DsrTab';
import ExportTab from './ExportTab';
import IncidentsTab from './IncidentsTab';
import KeysTab from './KeysTab';
import PostureTab from './PostureTab';
import RetentionTab from './RetentionTab';

export default function SegurancaPage() {
  const { can } = useBvSession();
  if (!can('security:manage')) return <><PageHeader title="Segurança e LGPD" /><NoPerm perm="security:manage" /></>;
  return (
    <div>
      <PageHeader title="Segurança e LGPD" subtitle="Postura de segurança, direitos do titular, retenção de dados, chaves, exportação final do contrato e incidentes." />
      <Tabs label="Seções de segurança e LGPD" tabs={[
        { id: 'postura', title: 'Postura', content: <PostureTab /> },
        { id: 'titular', title: 'Direitos do titular', content: <DsrTab /> },
        { id: 'retencao', title: 'Retenção', content: <RetentionTab /> },
        { id: 'chaves', title: 'Chaves de criptografia', content: <KeysTab /> },
        { id: 'exportacao', title: 'Exportação final', content: <ExportTab /> },
        { id: 'incidentes', title: 'Incidentes', content: <IncidentsTab /> },
      ]} />
    </div>
  );
}
