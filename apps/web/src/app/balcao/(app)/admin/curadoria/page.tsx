'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { bv } from '@/lib/balcao/api';
import { useBvSession } from '@/lib/balcao/session';
import { Banner, PageHeader, Tabs } from '../../../_ui/ui';
import type { KbListResponse } from '../../conhecimento/_kb';
import { Articles } from './Articles';
import { Assistant } from './Assistant';
import { Indicators } from './Indicators';
import { ReviewQueue } from './ReviewQueue';
import { Suggestions } from './Suggestions';

export default function CuradoriaPage() {
  const { can } = useBvSession();
  const [categories, setCategories] = useState<string[]>([]);
  const [pending, setPending] = useState<number | null>(null);

  const loadCategories = useCallback(async () => {
    try {
      const r = await bv.get<KbListResponse>('/kb/articles', { limit: 200 });
      setCategories(Array.from(new Set(r.items.map((a) => a.category).filter((c): c is string => !!c))).sort((a, b) => a.localeCompare(b, 'pt-BR')));
    } catch { /* categorias são só uma conveniência */ }
  }, []);
  useEffect(() => { void loadCategories(); }, [loadCategories]);

  if (!can('kb:approve')) {
    return (
      <div>
        <PageHeader title="Curadoria e IA" />
        <Banner tone="warning" title="Acesso restrito">Esta área é exclusiva de quem aprova a base de conhecimento (supervisores e administradores).</Banner>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Curadoria e IA" subtitle={pending != null ? `${pending} ${pending === 1 ? 'artigo aguardando revisão' : 'artigos aguardando revisão'}` : 'Base de conhecimento, sugestões da curadoria, indicadores e assistente virtual'} />
      <Tabs label="Curadoria e IA" tabs={[
        { id: 'fila', title: 'Fila de revisão', content: <ReviewQueue categories={categories} onCount={setPending} /> },
        { id: 'artigos', title: 'Artigos', content: <Articles categories={categories} onChanged={() => void loadCategories()} /> },
        { id: 'sugestoes', title: 'Sugestões da curadoria', content: <Suggestions categories={categories} onChanged={() => void loadCategories()} /> },
        { id: 'indicadores', title: 'Indicadores', content: <Indicators /> },
        { id: 'assistente', title: 'Assistente virtual', content: <Assistant /> },
      ]} />
    </div>
  );
}
