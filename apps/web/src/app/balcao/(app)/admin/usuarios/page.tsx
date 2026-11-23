'use client';
import React from 'react';
import { useBvSession } from '@/lib/balcao/session';
import { PageHeader, Tabs } from '../../../_ui/ui';
import { NoPerm } from './_shared';
import HolidaysTab from './HolidaysTab';
import SectorsTab from './SectorsTab';
import TokensTab from './TokensTab';
import UsersTab from './UsersTab';

export default function UsuariosPage() {
  const { can } = useBvSession();
  if (!can('user:manage')) return <><PageHeader title="Usuários e setores" /><NoPerm perm="user:manage" /></>;
  const tabs = [
    { id: 'usuarios', title: 'Usuários', content: <UsersTab /> },
    { id: 'setores', title: 'Setores', content: <SectorsTab /> },
    ...(can('org:manage') ? [{ id: 'feriados', title: 'Feriados', content: <HolidaysTab /> }] : []),
    ...(can('security:manage') ? [{ id: 'tokens', title: 'Tokens de API', content: <TokensTab /> }] : []),
  ];
  return (
    <div>
      <PageHeader title="Usuários e setores" subtitle="Cadastro de atendentes, supervisores, administradores e fiscais; setores, feriados e tokens de API." />
      <Tabs label="Seções de usuários e setores" tabs={tabs} />
    </div>
  );
}
