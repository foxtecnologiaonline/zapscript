'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { API_ORIGIN, bv, errMsg } from '@/lib/balcao/api';
import { useBvSession } from '@/lib/balcao/session';
import { Badge, Banner, Card, Checkbox, Select, Spinner } from '../../../_ui/ui';
import { CopyField } from './_shared';

interface OrgView { slug: string; settings: { webchat?: { allowedOrigins?: string[]; title?: string; primaryColor?: string } } }

/** Widget de chat do site: snippet de instalação com o slug do órgão e origens permitidas (editadas em Configurações do órgão). */
export function WidgetPanel({ onStatus }: { onStatus?: (origins: number | null) => void }) {
  const { me, can } = useBvSession();
  const [org, setOrg] = useState<OrgView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState('right');
  const [vlibras, setVlibras] = useState(false);
  const slug = org?.slug ?? me?.user.orgSlug ?? 'slug-do-orgao';

  useEffect(() => {
    if (!can('org:manage')) return;
    bv.get<OrgView>('/admin/org').then((o) => { setOrg(o); onStatus?.(o.settings.webchat?.allowedOrigins?.length ?? 0); }).catch((e) => setError(errMsg(e, 'Não foi possível ler as origens permitidas.')));
  }, [can, onStatus]);

  const snippet = `<script src="${API_ORIGIN}/balcao/webchat/widget.js" data-org="${slug}"${position === 'left' ? ' data-position="left"' : ''}${vlibras ? ' data-vlibras="true"' : ''} async></script>`;
  const origins = org?.settings.webchat?.allowedOrigins ?? [];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-bv-muted">O widget é o chat do assistente virtual no site do tribunal. Cole o código abaixo antes de <code>&lt;/body&gt;</code> das páginas em que o chat deve aparecer.</p>
      <Card title="Código de instalação">
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Posição do botão" value={position} onChange={(e) => setPosition(e.target.value)}><option value="right">Canto direito</option><option value="left">Canto esquerdo</option></Select>
            <div className="sm:mt-6"><Checkbox label="Incluir tradução em Libras (VLibras)" checked={vlibras} onChange={(e) => setVlibras(e.target.checked)} /></div>
          </div>
          <CopyField label="Código para colar no site" value={snippet} hint={`Identificador do órgão (slug): ${slug}`} />
          <CopyField label="Página de demonstração" value={`${API_ORIGIN}/balcao/webchat/demo?org=${slug}`} hint="Abra para ver o chat funcionando antes de instalar no site." />
        </div>
      </Card>
      <Card title="Sites autorizados (origens permitidas)">
        {!can('org:manage') ? <p className="text-sm text-bv-muted">Você não tem permissão para ver as origens permitidas.</p>
          : error ? <Banner tone="warning" title="Indisponível">{error}</Banner>
          : !org ? <div className="p-4 text-center"><Spinner /></div> : (
            <>
              {origins.length === 0
                ? <Banner tone="warning" title="Nenhuma origem cadastrada">Em produção, o chat só funciona em sites autorizados. Cadastre o endereço do site do tribunal.</Banner>
                : <ul className="mb-2 flex flex-wrap gap-2">{origins.map((o) => <li key={o}><Badge tone="success">{o}</Badge></li>)}</ul>}
            </>
          )}
        <p className="mt-3 text-sm">Para incluir ou remover sites, título e cor do chat, use <Link className="underline" href="/balcao/admin/orgao">Configurações do órgão</Link>.</p>
      </Card>
    </div>
  );
}
