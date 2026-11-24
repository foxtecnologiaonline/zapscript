'use client';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { bv, errMsg } from '@/lib/balcao/api';
import { fmtAgo, fmtDateTime } from '@/lib/balcao/format';
import { Badge, Banner, Button, Card, Checkbox, ConfirmDialog, DataTable, Select, Spinner, StatCard, Tabs, TextArea, TextField, useToast } from '../../../_ui/ui';
import { Modal } from '../../conhecimento/_kb';
import { fieldErrors, CopyField, LogsPanel, randomHex, SECRET_MASK, SecretField, StatusBadge, TestButton } from './_shared';

interface WaConfigView {
  configured: boolean; enabled: boolean; status: string; lastCheckAt: string | null; lastError: string | null;
  config: { accessToken?: string; phoneNumberId?: string; wabaId?: string; appSecret?: string; graphVersion?: string; mock?: boolean; apiBase?: string } | null;
  webhook: { url: string; verifyToken: string | null; fields: string[] }; simulators: boolean;
}
interface WaHealth { configured: boolean; enabled: boolean; status: string; mock: boolean; windowHours: number; lastInboundAt: string | null; lastOutboundAt: string | null; failedOutbound24h: number; templates: Record<string, number> }
interface WaTemplate { id: string; name: string; language: string; category: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION'; components: any[]; status: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | string; metaTemplateId: string | null; rejectedReason: string | null; createdAt: string; updatedAt: string }

const TPL_STATUS: Record<string, { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' }> = {
  DRAFT: { label: 'Rascunho', tone: 'neutral' }, PENDING: { label: 'Em análise na Meta', tone: 'warning' }, APPROVED: { label: 'Aprovado', tone: 'success' }, REJECTED: { label: 'Rejeitado', tone: 'danger' },
  PAUSED: { label: 'Pausado', tone: 'warning' }, DISABLED: { label: 'Desativado', tone: 'danger' },
};
const CATEGORY_LABEL: Record<string, string> = { UTILITY: 'Utilidade', MARKETING: 'Marketing', AUTHENTICATION: 'Autenticação' };

export function WhatsAppPanel({ onChanged }: { onChanged: () => void }) {
  return (
    <Tabs label="WhatsApp" tabs={[
      { id: 'wa-conexao', title: 'Conexão', content: <Connection onChanged={onChanged} /> },
      { id: 'wa-templates', title: 'Templates', content: <Templates /> },
      { id: 'wa-logs', title: 'Registros de chamadas', content: <LogsPanel type="WHATSAPP" /> },
    ]} />
  );
}

// ── Conexão ──────────────────────────────────────────────────────────────────
function Connection({ onChanged }: { onChanged: () => void }) {
  const toast = useToast();
  const [v, setV] = useState<WaConfigView | null>(null);
  const [health, setHealth] = useState<WaHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rev, setRev] = useState(0);

  const load = useCallback(async () => {
    setError(null);
    try { setV(await bv.get<WaConfigView>('/whatsapp/config')); } catch (e) { setError(errMsg(e, 'Não foi possível carregar a configuração do WhatsApp.')); return; }
    try { setHealth(await bv.get<WaHealth>('/whatsapp/health')); } catch { setHealth(null); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (error) return <Banner tone="danger" title="Indisponível">{error}</Banner>;
  if (!v) return <div className="p-6 text-center"><Spinner /></div>;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2"><StatusBadge s={v} />{v.lastCheckAt && <span className="text-sm text-bv-muted">Última verificação: {fmtDateTime(v.lastCheckAt)}</span>}</div>
      {v.lastError && <Banner tone="danger" title="Último erro">{v.lastError}</Banner>}

      <Card title="1. Credenciais da Meta (WhatsApp Cloud API oficial)">
        <WaForm key={rev} v={v} onSaved={async () => { setRev((r) => r + 1); await load(); onChanged(); toast.success('Configuração do WhatsApp salva. Teste a conexão para validar.'); }} />
      </Card>

      <Card title="2. Webhook no painel da Meta">
        <ol className="mb-3 list-decimal pl-5 text-sm">
          <li>No painel da Meta: WhatsApp → Configuração → Webhook.</li>
          <li>Cole a URL de callback e o token de verificação abaixo.</li>
          <li>Assine os campos: <strong>{v.webhook.fields.join(', ')}</strong>.</li>
        </ol>
        <div className="grid gap-3 md:grid-cols-2">
          <CopyField label="URL de callback do webhook" value={v.webhook.url} />
          {v.webhook.verifyToken ? <CopyField label="Token de verificação" value={v.webhook.verifyToken} /> : <p className="text-sm text-bv-muted">O token de verificação é gerado ao salvar a configuração.</p>}
        </div>
        {v.webhook.verifyToken && <RotateToken onDone={async () => { await load(); }} />}
      </Card>

      <Card title="3. Testar conexão">
        <TestButton disabled={!v.configured} onDone={() => { void load(); onChanged(); }}
          run={async () => {
            const r = await bv.post<{ ok: boolean; mock?: boolean; phone?: { displayPhoneNumber?: string; verifiedName?: string; qualityRating?: string }; waba?: { id?: string; name?: string }; error?: { code: string; message: string } }>('/whatsapp/config/test');
            if (!r.ok) return { ok: false, message: r.error ? `${r.error.message} (${r.error.code})` : 'A Meta recusou a conexão.' };
            if (r.mock) return { ok: true, message: 'Modo de demonstração (mock): nenhuma chamada real foi feita à Meta.' };
            return { ok: true, message: `Número ${r.phone?.displayPhoneNumber ?? '—'} · nome verificado: ${r.phone?.verifiedName ?? '—'} · qualidade: ${r.phone?.qualityRating ?? '—'} · conta WABA: ${r.waba?.name ?? r.waba?.id ?? '—'}.` };
          }} />
      </Card>

      {health && (
        <Card title="Saúde do canal">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Última mensagem recebida" value={health.lastInboundAt ? fmtAgo(health.lastInboundAt) : '—'} hint={health.lastInboundAt ? fmtDateTime(health.lastInboundAt) : undefined} />
            <StatCard label="Última mensagem enviada" value={health.lastOutboundAt ? fmtAgo(health.lastOutboundAt) : '—'} hint={health.lastOutboundAt ? fmtDateTime(health.lastOutboundAt) : undefined} />
            <StatCard label="Falhas de envio (24 h)" value={health.failedOutbound24h} tone={health.failedOutbound24h > 0 ? 'danger' : 'neutral'} />
            <StatCard label="Janela de atendimento" value={`${health.windowHours} h`} hint="Texto livre só dentro da janela; fora dela use template." />
          </div>
          {health.mock && <div className="mt-3"><Banner tone="warning" title="Modo de demonstração">O canal está em modo mock: nada é enviado à Meta.</Banner></div>}
        </Card>
      )}
    </div>
  );
}

function RotateToken({ onDone }: { onDone: () => Promise<void> }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Gerar novo token de verificação</Button>
      <ConfirmDialog open={open} onClose={() => setOpen(false)} title="Gerar novo token de verificação" confirmLabel="Gerar novo token"
        message="O token atual deixa de valer. Depois de gerar, atualize o token de verificação no painel da Meta; mensagens já configuradas continuam chegando, mas a Meta só revalida o webhook com o token novo."
        onConfirm={async () => {
          try { await bv.put('/whatsapp/config', { verifyToken: randomHex(16) }); toast.success('Novo token gerado.'); await onDone(); }
          catch (e) { toast.error(errMsg(e)); }
        }} />
    </div>
  );
}

function WaForm({ v, onSaved }: { v: WaConfigView; onSaved: () => void | Promise<void> }) {
  const c = v.config ?? {};
  const [phoneNumberId, setPhone] = useState(c.phoneNumberId ?? ''); const [wabaId, setWaba] = useState(c.wabaId ?? '');
  const [accessToken, setToken] = useState(''); const [appSecret, setSecret] = useState('');
  const [graphVersion, setGraph] = useState(c.graphVersion ?? 'v23.0');
  const [enabled, setEnabled] = useState(v.configured ? v.enabled : true);
  const [mock, setMock] = useState(!!c.mock);
  const [errs, setErrs] = useState<Record<string, string>>({}); const [formErr, setFormErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setFormErr(null);
    const er: Record<string, string> = {};
    if (!mock) {
      if (!/^\d{5,32}$/.test(phoneNumberId.trim())) er.phoneNumberId = 'Informe o ID do número (somente dígitos, 5 a 32).';
      if (!/^\d{5,32}$/.test(wabaId.trim())) er.wabaId = 'Informe o ID da conta WhatsApp Business (somente dígitos).';
      if (!accessToken.trim() && c.accessToken !== SECRET_MASK) er.accessToken = 'Informe o token de acesso.';
      if (accessToken.trim() && accessToken.trim().length < 10) er.accessToken = 'Token muito curto (mínimo de 10 caracteres).';
      if (!appSecret.trim() && c.appSecret !== SECRET_MASK) er.appSecret = 'Informe o App Secret.';
      if (appSecret.trim() && appSecret.trim().length < 8) er.appSecret = 'App Secret muito curto (mínimo de 8 caracteres).';
    }
    if (!/^v\d{1,2}\.\d{1,2}$/.test(graphVersion.trim())) er.graphVersion = 'Use o formato v23.0.';
    setErrs(er); if (Object.keys(er).length) return;
    setBusy(true);
    try {
      await bv.put('/whatsapp/config', {
        ...(phoneNumberId.trim() ? { phoneNumberId: phoneNumberId.trim() } : {}), ...(wabaId.trim() ? { wabaId: wabaId.trim() } : {}),
        ...(accessToken.trim() ? { accessToken: accessToken.trim() } : {}), ...(appSecret.trim() ? { appSecret: appSecret.trim() } : {}),
        graphVersion: graphVersion.trim(), enabled, ...(v.simulators ? { mock } : {}),
      });
      await onSaved();
    } catch (err) {
      const fe = fieldErrors(err); setErrs(fe.map); setFormErr([errMsg(err), ...fe.list].join(' '));
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <p className="text-sm text-bv-muted">Obtenha estes dados em developers.facebook.com → seu app → WhatsApp. O token deve ser permanente (usuário do sistema) com as permissões <code>whatsapp_business_messaging</code> e <code>whatsapp_business_management</code>.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <TextField label="ID do número de telefone (Phone number ID)" required={!mock} inputMode="numeric" value={phoneNumberId} onChange={(e) => setPhone(e.target.value)} error={errs.phoneNumberId} />
        <TextField label="ID da conta WhatsApp Business (WABA)" required={!mock} inputMode="numeric" value={wabaId} onChange={(e) => setWaba(e.target.value)} error={errs.wabaId} />
        <SecretField label="Token de acesso permanente" value={accessToken} onChange={setToken} isSet={c.accessToken === SECRET_MASK} error={errs.accessToken} required={!mock} />
        <SecretField label="App Secret (Configurações do app → Básico)" value={appSecret} onChange={setSecret} isSet={c.appSecret === SECRET_MASK} error={errs.appSecret} required={!mock} hint="Usado para validar a assinatura dos webhooks." />
        <TextField label="Versão da Graph API" value={graphVersion} onChange={(e) => setGraph(e.target.value)} error={errs.graphVersion} hint="Padrão: v23.0." />
      </div>
      <Checkbox label="Canal ativado" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
      {v.simulators && <Checkbox label="Modo de demonstração (mock) — não chama a Meta" hint="Disponível só em ambiente de desenvolvimento." checked={mock} onChange={(e) => setMock(e.target.checked)} />}
      {formErr && <Banner tone="danger" title="Não foi possível salvar">{formErr}</Banner>}
      <div><Button type="submit" loading={busy}>Salvar credenciais</Button></div>
    </form>
  );
}

// ── Templates ────────────────────────────────────────────────────────────────
function Templates() {
  const toast = useToast();
  const [items, setItems] = useState<WaTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<WaTemplate | 'new' | null>(null);
  const [delT, setDelT] = useState<WaTemplate | null>(null);
  const [forceT, setForceT] = useState<WaTemplate | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try { setItems(await bv.get<WaTemplate[]>('/whatsapp/templates')); } catch (e) { setError(errMsg(e, 'Não foi possível carregar os templates.')); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const submitT = async (t: WaTemplate) => {
    setBusyId(t.id);
    try { const r = await bv.post<WaTemplate>(`/whatsapp/templates/${t.id}/submit`); toast.success(`Template enviado à Meta: ${TPL_STATUS[r.status]?.label ?? r.status}.`); await load(); }
    catch (e) { const fe = fieldErrors(e); toast.error([errMsg(e), ...fe.list].join(' ')); }
    finally { setBusyId(null); }
  };
  const sync = async () => {
    setSyncing(true);
    try { const r = await bv.post<{ created: number; updated: number; unchanged: number; total: number }>('/whatsapp/templates/sync'); toast.success(`Sincronizado: ${r.created} importados, ${r.updated} atualizados, ${r.unchanged} sem mudança (${r.total} na Meta).`); await load(); }
    catch (e) { toast.error(errMsg(e)); } finally { setSyncing(false); }
  };

  if (error) return <Banner tone="danger" title="Indisponível">{error}</Banner>;
  if (!items) return <div className="p-6 text-center"><Spinner /></div>;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-bv-muted">Templates são as mensagens pré-aprovadas pela Meta, necessárias para iniciar conversa ou responder fora da janela de 24 horas. Crie o rascunho, envie para análise e acompanhe o status (a Meta pode levar de minutos a horas).</p>
        <div className="flex gap-2">
          <Button variant="secondary" loading={syncing} onClick={() => void sync()}>Sincronizar status com a Meta</Button>
          <Button onClick={() => setEditing('new')}>Novo template</Button>
        </div>
      </div>
      <p role="status" className="text-sm font-medium">{items.length} {items.length === 1 ? 'template' : 'templates'}.</p>
      <DataTable caption="Templates do WhatsApp" rows={items} rowKey={(t) => t.id} empty="Nenhum template ainda. Crie um novo ou sincronize os que já existem na Meta."
        columns={[
          { key: 'n', header: 'Nome', render: (t) => <><span className="font-mono text-sm">{t.name}</span><span className="block text-xs text-bv-muted">{t.language}</span></> },
          { key: 'c', header: 'Categoria', render: (t) => CATEGORY_LABEL[t.category] ?? t.category },
          { key: 's', header: 'Status', render: (t) => { const s = TPL_STATUS[t.status] ?? { label: t.status, tone: 'neutral' as const }; return <><Badge tone={s.tone}>{s.label}</Badge>{t.rejectedReason && <span className="mt-1 block text-xs text-bv-danger">Motivo: {t.rejectedReason}</span>}</>; } },
          { key: 'b', header: 'Texto', render: (t) => <span className="line-clamp-2 max-w-xs text-xs">{String(t.components?.find((x: any) => String(x.type).toUpperCase() === 'BODY')?.text ?? '')}</span> },
          { key: 'u', header: 'Atualizado', render: (t) => fmtDateTime(t.updatedAt) },
          {
            key: 'a', header: 'Ações', render: (t) => (
              <div className="flex flex-wrap gap-1">
                {(t.status === 'DRAFT' || t.status === 'REJECTED') && <Button size="sm" variant="secondary" onClick={() => setEditing(t)}>Editar<span className="bv-sr-only"> {t.name}</span></Button>}
                {(t.status === 'DRAFT' || t.status === 'REJECTED') && <Button size="sm" loading={busyId === t.id} onClick={() => void submitT(t)}>Enviar para análise<span className="bv-sr-only"> {t.name}</span></Button>}
                {t.status !== 'DRAFT' && t.status !== 'REJECTED' && <Button size="sm" variant="secondary" onClick={() => setEditing(t)}>Ver<span className="bv-sr-only"> {t.name}</span></Button>}
                <Button size="sm" variant="ghost" onClick={() => setDelT(t)}>Excluir<span className="bv-sr-only"> {t.name}</span></Button>
              </div>
            ),
          },
        ]} />
      {editing && <TemplateEditor tpl={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} />}
      {delT && (
        <ConfirmDialog open onClose={() => setDelT(null)} danger confirmLabel="Excluir" title="Excluir template"
          message={`Excluir “${delT.name}” (${delT.language})? ${delT.status === 'DRAFT' ? 'Ele ainda não foi enviado à Meta.' : 'Ele também será removido na Meta; mensagens que o usam deixarão de ser enviadas.'}`}
          onConfirm={async () => {
            try { await bv.del(`/whatsapp/templates/${delT.id}`); toast.success('Template excluído.'); await load(); }
            catch (e) { toast.error(errMsg(e)); if (delT.status !== 'DRAFT') setForceT(delT); }
          }} />
      )}
      {forceT && (
        <ConfirmDialog open onClose={() => setForceT(null)} danger confirmLabel="Remover só aqui" title="Remover apenas do Balcão?"
          message="Não foi possível remover o template na Meta. Você pode remover apenas o registro local; o template continuará existindo na Meta até ser excluído por lá."
          onConfirm={async () => {
            try { await bv.del(`/whatsapp/templates/${forceT.id}?force=1`); toast.success('Template removido localmente.'); await load(); }
            catch (e) { toast.error(errMsg(e)); }
          }} />
      )}
    </div>
  );
}

const VAR_RE = /\{\{\s*(\d+)\s*\}\}/g;
const varsOf = (t: string) => Array.from(new Set([...t.matchAll(VAR_RE)].map((m) => Number(m[1])))).sort((a, b) => a - b);

interface BtnForm { type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER'; text: string; url: string; phone: string }
interface TplForm { name: string; language: string; category: string; header: string; headerEx: string; body: string; bodyEx: string[]; footer: string; buttons: BtnForm[] }

/** Tenta ler os componentes no formulário; devolve null se houver algo que o formulário não representa (mídia, OTP…). */
function fromComponents(components: any[]): Pick<TplForm, 'header' | 'headerEx' | 'body' | 'bodyEx' | 'footer' | 'buttons'> | null {
  const out = { header: '', headerEx: '', body: '', bodyEx: [] as string[], footer: '', buttons: [] as BtnForm[] };
  for (const c of components ?? []) {
    const t = String(c?.type ?? '').toUpperCase();
    if (t === 'HEADER') { if (String(c.format ?? 'TEXT').toUpperCase() !== 'TEXT') return null; out.header = String(c.text ?? ''); out.headerEx = String(c.example?.header_text?.[0] ?? ''); }
    else if (t === 'BODY') { out.body = String(c.text ?? ''); out.bodyEx = (c.example?.body_text?.[0] ?? []).map(String); }
    else if (t === 'FOOTER') out.footer = String(c.text ?? '');
    else if (t === 'BUTTONS') {
      for (const b of c.buttons ?? []) {
        const bt = String(b.type ?? '').toUpperCase();
        if (bt === 'QUICK_REPLY') out.buttons.push({ type: 'QUICK_REPLY', text: String(b.text ?? ''), url: '', phone: '' });
        else if (bt === 'URL' && !varsOf(String(b.url ?? '')).length) out.buttons.push({ type: 'URL', text: String(b.text ?? ''), url: String(b.url ?? ''), phone: '' });
        else if (bt === 'PHONE_NUMBER') out.buttons.push({ type: 'PHONE_NUMBER', text: String(b.text ?? ''), url: '', phone: String(b.phone_number ?? '') });
        else return null;
      }
    } else return null;
  }
  return out;
}

function toComponents(f: TplForm): any[] {
  const comps: any[] = [];
  if (f.header.trim()) { const hv = varsOf(f.header); comps.push({ type: 'HEADER', format: 'TEXT', text: f.header.trim(), ...(hv.length ? { example: { header_text: [f.headerEx.trim()] } } : {}) }); }
  const bv_ = varsOf(f.body);
  comps.push({ type: 'BODY', text: f.body.trim(), ...(bv_.length ? { example: { body_text: [bv_.map((_, i) => (f.bodyEx[i] ?? '').trim())] } } : {}) });
  if (f.footer.trim()) comps.push({ type: 'FOOTER', text: f.footer.trim() });
  if (f.buttons.length) comps.push({ type: 'BUTTONS', buttons: f.buttons.map((b) => b.type === 'URL' ? { type: 'URL', text: b.text.trim(), url: b.url.trim() } : b.type === 'PHONE_NUMBER' ? { type: 'PHONE_NUMBER', text: b.text.trim(), phone_number: b.phone.trim() } : { type: 'QUICK_REPLY', text: b.text.trim() }) });
  return comps;
}

function TemplateEditor({ tpl, onClose, onSaved }: { tpl: WaTemplate | null; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const toast = useToast();
  const readOnly = !!tpl && tpl.status !== 'DRAFT' && tpl.status !== 'REJECTED';
  const parsed = useMemo(() => (tpl ? fromComponents(tpl.components) : null), [tpl]);
  const [f, setF] = useState<TplForm>(() => ({ name: tpl?.name ?? '', language: tpl?.language ?? 'pt_BR', category: tpl?.category ?? 'UTILITY', header: parsed?.header ?? '', headerEx: parsed?.headerEx ?? '', body: parsed?.body ?? '', bodyEx: parsed?.bodyEx ?? [], footer: parsed?.footer ?? '', buttons: parsed?.buttons ?? [] }));
  const [jsonMode, setJsonMode] = useState(!!tpl && !parsed);
  const [json, setJson] = useState(() => (tpl && !parsed ? JSON.stringify(tpl.components, null, 2) : ''));
  const [errs, setErrs] = useState<Record<string, string>>({}); const [serverErrs, setServerErrs] = useState<string[]>([]); const [busy, setBusy] = useState(false);
  const set = <K extends keyof TplForm>(k: K, v: TplForm[K]) => setF((c) => ({ ...c, [k]: v }));
  const bodyVars = varsOf(f.body); const headerVars = varsOf(f.header);

  const preview = useMemo(() => {
    let t = f.body; bodyVars.forEach((n, i) => { t = t.replace(new RegExp(`\\{\\{\\s*${n}\\s*\\}\\}`, 'g'), f.bodyEx[i] || `{{${n}}}`); });
    return t;
  }, [f.body, f.bodyEx, bodyVars]);

  const toggleJson = (on: boolean) => { if (on) setJson(JSON.stringify(toComponents(f), null, 2)); setJsonMode(on); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setServerErrs([]);
    const er: Record<string, string> = {};
    if (!tpl && !/^[a-z0-9_]{1,512}$/.test(f.name)) er.name = 'Use apenas letras minúsculas sem acento, números e _ (ex.: lembrete_audiencia).';
    if (!tpl && !/^[a-z]{2,3}(_[A-Z]{2})?$/.test(f.language)) er.language = 'Use o formato pt_BR.';
    let components: unknown[] = [];
    if (jsonMode) {
      try { const p = JSON.parse(json); if (!Array.isArray(p) || !p.length) throw new Error(); components = p; } catch { er.json = 'JSON inválido: informe uma lista de componentes (HEADER, BODY, FOOTER, BUTTONS).'; }
    } else {
      if (!f.body.trim()) er.body = 'O corpo da mensagem é obrigatório.';
      else if (f.body.length > 1024) er.body = 'O corpo pode ter no máximo 1.024 caracteres.';
      else if (bodyVars.some((n, i) => n !== i + 1)) er.body = 'As variáveis devem ser sequenciais: {{1}}, {{2}}…';
      else if (/^\s*\{\{/.test(f.body) || /\}\}\s*$/.test(f.body)) er.body = 'O texto não pode começar nem terminar com variável.';
      else if (bodyVars.some((_, i) => !(f.bodyEx[i] ?? '').trim())) er.bodyEx = 'Informe um exemplo para cada variável (exigido pela Meta).';
      if (f.header.length > 60) er.header = 'No máximo 60 caracteres.';
      if (headerVars.length > 1) er.header = 'O cabeçalho aceita no máximo 1 variável.';
      else if (headerVars.length === 1 && !f.headerEx.trim()) er.headerEx = 'Informe um exemplo para a variável do cabeçalho.';
      if (f.footer.length > 60) er.footer = 'No máximo 60 caracteres.';
      if (varsOf(f.footer).length) er.footer = 'O rodapé não aceita variáveis.';
      f.buttons.forEach((b, i) => {
        if (!b.text.trim()) er[`btn${i}`] = 'Informe o texto do botão.';
        else if (b.text.length > 25) er[`btn${i}`] = 'Texto do botão: no máximo 25 caracteres.';
        else if (b.type === 'URL' && !/^https:\/\//i.test(b.url.trim())) er[`btn${i}`] = 'A URL deve começar com https://.';
        else if (b.type === 'PHONE_NUMBER' && !/^\+?\d{8,15}$/.test(b.phone.trim())) er[`btn${i}`] = 'Telefone inválido (8 a 15 dígitos, com DDI).';
      });
      components = toComponents(f);
    }
    setErrs(er); if (Object.keys(er).length) return;
    setBusy(true);
    try {
      if (tpl) await bv.put(`/whatsapp/templates/${tpl.id}`, { category: f.category, components });
      else await bv.post('/whatsapp/templates', { name: f.name, language: f.language, category: f.category, components });
      toast.success(tpl ? 'Template atualizado (rascunho).' : 'Rascunho de template criado.'); await onSaved();
    } catch (err) { const fe = fieldErrors(err); setServerErrs([errMsg(err), ...fe.list]); } finally { setBusy(false); }
  };

  if (readOnly) {
    return (
      <Modal open onClose={onClose} title={`Template ${tpl!.name}`} size="lg" footer={<Button onClick={onClose}>Fechar</Button>}>
        <p className="mb-2 text-sm text-bv-muted">Templates já enviados à Meta não podem ser editados. Para alterar, exclua e crie outro com novo nome.</p>
        <pre className="max-h-80 overflow-auto rounded-md bg-bv-subtle p-3 text-xs">{JSON.stringify(tpl!.components, null, 2)}</pre>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title={tpl ? `Editar template ${tpl.name}` : 'Novo template'} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button type="submit" form="wa-tpl-form" loading={busy}>Salvar rascunho</Button></>}>
      <form id="wa-tpl-form" onSubmit={submit} noValidate className="flex flex-col gap-3">
        {tpl?.status === 'REJECTED' && <Banner tone="warning" title="Rejeitado pela Meta">{tpl.rejectedReason ?? 'Ajuste o texto e envie novamente.'}</Banner>}
        <div className="grid gap-3 md:grid-cols-3">
          <TextField label="Nome do template" required disabled={!!tpl} value={f.name} onChange={(e) => set('name', e.target.value.toLowerCase())} error={errs.name} hint="Minúsculas, números e _." />
          <TextField label="Idioma" required disabled={!!tpl} value={f.language} onChange={(e) => set('language', e.target.value)} error={errs.language} hint="Ex.: pt_BR." />
          <Select label="Categoria" required value={f.category} onChange={(e) => set('category', e.target.value)} hint="Define a cobrança: utilidade ou marketing.">
            {Object.entries(CATEGORY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </div>
        <Checkbox label="Editar como JSON (avançado: cabeçalho de mídia, botões especiais)" checked={jsonMode} onChange={(e) => toggleJson(e.target.checked)} />
        {jsonMode ? (
          <TextArea label="Componentes (JSON da Meta)" value={json} onChange={(e) => setJson(e.target.value)} error={errs.json} className="min-h-[260px] font-mono text-xs" spellCheck={false} />
        ) : (
          <>
            <TextField label="Cabeçalho (opcional)" value={f.header} onChange={(e) => set('header', e.target.value)} error={errs.header} maxLength={60} hint="Texto curto, até 60 caracteres, no máximo 1 variável." />
            {headerVars.length === 1 && <TextField label="Exemplo da variável do cabeçalho" value={f.headerEx} onChange={(e) => set('headerEx', e.target.value)} error={errs.headerEx} />}
            <TextArea label="Corpo da mensagem" required value={f.body} onChange={(e) => set('body', e.target.value)} error={errs.body} maxLength={1024} className="min-h-[120px]"
              hint="Use {{1}}, {{2}}… para variáveis (ex.: nome, data). Não comece nem termine o texto com variável." />
            {bodyVars.length > 0 && (
              <fieldset className="rounded-md border border-bv-border p-3">
                <legend className="px-1 text-sm font-medium">Exemplos das variáveis (a Meta exige)</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {bodyVars.map((n, i) => <TextField key={n} label={`Exemplo de {{${n}}}`} value={f.bodyEx[i] ?? ''} onChange={(e) => setF((c) => { const b = [...c.bodyEx]; b[i] = e.target.value; return { ...c, bodyEx: b }; })} />)}
                </div>
                {errs.bodyEx && <p role="alert" className="mt-1 text-sm text-bv-danger">{errs.bodyEx}</p>}
              </fieldset>
            )}
            <TextField label="Rodapé (opcional)" value={f.footer} onChange={(e) => set('footer', e.target.value)} error={errs.footer} maxLength={60} hint="Até 60 caracteres, sem variáveis." />
            <fieldset className="rounded-md border border-bv-border p-3">
              <legend className="px-1 text-sm font-medium">Botões (opcional, até 3)</legend>
              {f.buttons.map((b, i) => (
                <div key={i} className="mb-3 grid gap-2 border-b border-bv-border pb-3 sm:grid-cols-[10rem_1fr_1fr_auto] sm:items-start">
                  <Select label={`Tipo do botão ${i + 1}`} value={b.type} onChange={(e) => setF((c) => ({ ...c, buttons: c.buttons.map((x, j) => j === i ? { ...x, type: e.target.value as BtnForm['type'] } : x) }))}>
                    <option value="QUICK_REPLY">Resposta rápida</option><option value="URL">Abrir link</option><option value="PHONE_NUMBER">Ligar</option>
                  </Select>
                  <TextField label={`Texto do botão ${i + 1}`} maxLength={25} value={b.text} error={errs[`btn${i}`]} onChange={(e) => setF((c) => ({ ...c, buttons: c.buttons.map((x, j) => j === i ? { ...x, text: e.target.value } : x) }))} />
                  {b.type === 'URL' && <TextField label={`Link do botão ${i + 1}`} type="url" placeholder="https://" value={b.url} onChange={(e) => setF((c) => ({ ...c, buttons: c.buttons.map((x, j) => j === i ? { ...x, url: e.target.value } : x) }))} />}
                  {b.type === 'PHONE_NUMBER' && <TextField label={`Telefone do botão ${i + 1}`} placeholder="+5563999999999" value={b.phone} onChange={(e) => setF((c) => ({ ...c, buttons: c.buttons.map((x, j) => j === i ? { ...x, phone: e.target.value } : x) }))} />}
                  {b.type === 'QUICK_REPLY' && <span />}
                  <Button variant="ghost" size="sm" className="sm:mt-6" onClick={() => setF((c) => ({ ...c, buttons: c.buttons.filter((_, j) => j !== i) }))}>Remover<span className="bv-sr-only"> botão {i + 1}</span></Button>
                </div>
              ))}
              {f.buttons.length < 3 && <Button variant="secondary" size="sm" onClick={() => setF((c) => ({ ...c, buttons: [...c.buttons, { type: 'QUICK_REPLY', text: '', url: '', phone: '' }] }))}>Adicionar botão</Button>}
            </fieldset>
            <div className="rounded-md border border-bv-border bg-bv-subtle p-3">
              <p className="text-xs font-semibold text-bv-muted">Pré-visualização</p>
              {f.header && <p className="font-semibold">{f.header}</p>}
              <p className="whitespace-pre-wrap text-sm">{preview || <span className="text-bv-muted">(corpo vazio)</span>}</p>
              {f.footer && <p className="text-xs text-bv-muted">{f.footer}</p>}
              {f.buttons.length > 0 && <p className="mt-1 flex flex-wrap gap-1">{f.buttons.map((b, i) => <Badge key={i}>{b.text || `Botão ${i + 1}`}</Badge>)}</p>}
            </div>
          </>
        )}
        {serverErrs.length > 0 && <Banner tone="danger" title="A API recusou o template"><ul className="list-disc pl-5">{serverErrs.map((m, i) => <li key={i}>{m}</li>)}</ul></Banner>}
      </form>
    </Modal>
  );
}
