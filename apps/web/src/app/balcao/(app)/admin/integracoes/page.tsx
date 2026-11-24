'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { bv, errMsg } from '@/lib/balcao/api';
import { useBvSession } from '@/lib/balcao/session';
import { fmtAgo, fmtDateTime } from '@/lib/balcao/format';
import { Badge, Banner, Button, Card, PageHeader, Spinner, Tabs } from '../../../_ui/ui';
import { EmailPanel } from './Email';
import { genericDesc, genericName, GenericPanel } from './GenericPanel';
import { SipPanel } from './Sip';
import { WhatsAppPanel } from './WhatsApp';
import { WidgetPanel } from './Widget';
import { LogsPanel, StatusBadge, type IntegrationSummary } from './_shared';

interface Entry { id: string; type: string | null; title: string; desc: string; group: 'Canais de atendimento' | 'Integrações institucionais' | 'Outros' }

const ENTRIES: Entry[] = [
  { id: 'whatsapp', type: 'WHATSAPP', title: 'WhatsApp (API oficial da Meta)', desc: 'Conexão, webhook e templates de mensagem.', group: 'Canais de atendimento' },
  { id: 'email', type: 'EMAIL_IMAP', title: 'E-mail (IMAP/SMTP)', desc: 'Caixa de entrada, envio, resposta automática e coleta.', group: 'Canais de atendimento' },
  { id: 'sip', type: 'SIP_TRUNK', title: 'Telefonia SIP', desc: 'Tronco SIP, DIDs e estado da conexão com o Asterisk.', group: 'Canais de atendimento' },
  { id: 'ura', type: 'URA_0800', title: 'URA 0800', desc: 'Números 0800 e fluxos da URA por voz.', group: 'Canais de atendimento' },
  { id: 'widget', type: null, title: 'Chat do site (widget)', desc: 'Código de instalação e sites autorizados.', group: 'Canais de atendimento' },
  { id: 'eproc', type: 'EPROC', title: genericName('EPROC'), desc: genericDesc('EPROC'), group: 'Integrações institucionais' },
  { id: 'govbr', type: 'GOVBR', title: genericName('GOVBR'), desc: genericDesc('GOVBR'), group: 'Integrações institucionais' },
  { id: 'oidc', type: 'OIDC_TJTO', title: genericName('OIDC_TJTO'), desc: genericDesc('OIDC_TJTO'), group: 'Integrações institucionais' },
  { id: 'google', type: 'GOOGLE_WORKSPACE', title: genericName('GOOGLE_WORKSPACE'), desc: genericDesc('GOOGLE_WORKSPACE'), group: 'Integrações institucionais' },
  { id: 'jira', type: 'JIRA', title: genericName('JIRA'), desc: genericDesc('JIRA'), group: 'Integrações institucionais' },
  { id: 'llm', type: null, title: 'Modelo de linguagem (IA)', desc: 'Configurado no servidor por variáveis de ambiente.', group: 'Outros' },
];

export default function IntegracoesPage() {
  const { can } = useBvSession();
  const [list, setList] = useState<IntegrationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [origins, setOrigins] = useState<number | null>(null);
  const headRef = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async () => {
    setError(null);
    try { setList((await bv.get<{ integrations: IntegrationSummary[] }>('/integrations')).integrations); }
    catch (e) { setError(errMsg(e, 'Não foi possível carregar o estado das integrações.')); setList([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // link direto (#whatsapp, #email…)
  useEffect(() => {
    const sync = () => { const h = window.location.hash.replace('#', ''); if (ENTRIES.some((x) => x.id === h)) setSelected(h); };
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  useEffect(() => { if (selected) headRef.current?.focus(); }, [selected]);

  const open = (id: string | null) => { setSelected(id); try { history.replaceState(null, '', id ? `#${id}` : window.location.pathname); } catch { /* ignora */ } };
  const onOrigins = useCallback((n: number | null) => setOrigins(n), []);

  if (!can('integration:manage')) {
    return <div><PageHeader title="Canais e integrações" /><Banner tone="warning" title="Acesso restrito">Esta área é exclusiva de administradores.</Banner></div>;
  }

  const sel = ENTRIES.find((x) => x.id === selected) ?? null;
  const summaryOf = (type: string | null) => (type ? list?.find((i) => i.type === type) : undefined);

  if (sel) {
    const sum = summaryOf(sel.type);
    return (
      <div>
        <div className="mb-3"><Button variant="secondary" size="sm" onClick={() => open(null)}>← Voltar à visão geral</Button></div>
        <header className="mb-4">
          <h1 ref={headRef} tabIndex={-1} data-bv-page-title className="text-2xl font-semibold outline-none">{sel.title}</h1>
          <p className="text-sm text-bv-muted">{sel.desc}</p>
        </header>
        {sel.id === 'whatsapp' && <WhatsAppPanel onChanged={() => void load()} />}
        {sel.id === 'email' && <EmailPanel onChanged={() => void load()} />}
        {sel.id === 'sip' && <SipPanel onChanged={() => void load()} />}
        {sel.id === 'ura' && <UraPanel summary={sum} />}
        {sel.id === 'widget' && <WidgetPanel onStatus={onOrigins} />}
        {sel.id === 'llm' && <LlmPanel />}
        {sel.type && ['eproc', 'govbr', 'oidc', 'google', 'jira'].includes(sel.id) && <GenericPanel type={sel.type} summary={sum} onChanged={() => void load()} />}
      </div>
    );
  }

  const groups = Array.from(new Set(ENTRIES.map((e) => e.group)));
  return (
    <div>
      <PageHeader title="Canais e integrações" subtitle="Configure os canais de atendimento e as integrações com sistemas do tribunal. Segredos nunca são exibidos: campo em branco mantém o valor atual."
        actions={<Button variant="secondary" onClick={() => void load()}>Atualizar estado</Button>} />
      {error && <div className="mb-3"><Banner tone="warning" title="Estado indisponível">{error} Você ainda pode abrir cada item para configurar.</Banner></div>}
      {!list ? <div className="p-6 text-center"><Spinner /></div> : groups.map((g) => (
        <section key={g} aria-labelledby={`g-${g}`} className="mb-6">
          <h2 id={`g-${g}`} className="mb-2 text-lg font-semibold">{g}</h2>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {ENTRIES.filter((e) => e.group === g).map((e) => {
              const s = summaryOf(e.type);
              return (
                <li key={e.id}>
                  <article aria-labelledby={`c-${e.id}`} className="flex h-full flex-col gap-2 rounded-lg border border-bv-border bg-bv-surface p-4">
                    <h3 id={`c-${e.id}`} className="font-semibold">{e.title}</h3>
                    <p className="text-sm text-bv-muted">{e.desc}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      {e.type ? (s ? <StatusBadge s={s} /> : <Badge>Estado indisponível</Badge>)
                        : e.id === 'widget' ? <Badge tone={origins == null ? 'neutral' : origins > 0 ? 'success' : 'warning'}>{origins == null ? 'Ver instruções' : origins > 0 ? `${origins} site(s) autorizado(s)` : 'Sem sites autorizados'}</Badge>
                        : <Badge>Gerenciado no servidor</Badge>}
                    </div>
                    {s?.lastCheckAt && <p className="text-xs text-bv-muted">Última verificação: {fmtDateTime(s.lastCheckAt)} ({fmtAgo(s.lastCheckAt)})</p>}
                    {s?.lastError && <p className="text-xs text-bv-danger">Erro: {s.lastError}</p>}
                    <div className="mt-auto pt-1"><Button size="sm" variant="secondary" onClick={() => open(e.id)}>{e.id === 'widget' ? 'Ver instalação' : e.id === 'llm' ? 'Ver detalhes' : 'Configurar'}<span className="bv-sr-only">: {e.title}</span></Button></div>
                  </article>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function UraPanel({ summary }: { summary?: IntegrationSummary }) {
  return (
    <Tabs label="URA 0800" tabs={[
      {
        id: 'ura-info', title: 'Visão geral', content: (
          <div className="flex flex-col gap-3">
            {summary && <div className="flex items-center gap-2"><StatusBadge s={summary} /></div>}
            <Card title="Como a URA 0800 é configurada">
              <ul className="list-disc pl-5 text-sm">
                <li>Os <strong>números 0800/DIDs</strong> e o tronco são cadastrados em <Link className="underline" href="/balcao/admin/integracoes#sip">Telefonia SIP</Link>.</li>
                <li>Os <strong>fluxos da URA</strong> (menus, horários, transferências) são editados em <Link className="underline" href="/balcao/admin/ura">URA (atendimento por voz)</Link>.</li>
                <li>Esta integração não tem credenciais próprias: não há formulário de edição para o tipo “URA 0800” na API.</li>
              </ul>
            </Card>
          </div>
        ),
      },
      { id: 'ura-logs', title: 'Registros de chamadas', content: <LogsPanel type="URA_0800" /> },
    ]} />
  );
}

function LlmPanel() {
  return (
    <div className="flex flex-col gap-3">
      <Card title="Modelo de linguagem (IA)">
        <p className="text-sm">Os modelos usados pelo assistente virtual e pela curadoria são definidos no servidor (variáveis de ambiente) e não podem ser alterados por esta tela. Para validar o funcionamento, use o teste do assistente em <Link className="underline" href="/balcao/admin/curadoria">Curadoria e IA</Link> (aba “Assistente virtual”).</p>
      </Card>
      <LogsPanel type="LLM" />
    </div>
  );
}
