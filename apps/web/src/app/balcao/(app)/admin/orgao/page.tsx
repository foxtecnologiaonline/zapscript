'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { bv, errMsg } from '@/lib/balcao/api';
import { useBvSession } from '@/lib/balcao/session';
import { fmtDuration, ROLE_LABEL } from '@/lib/balcao/format';
import { Badge, Banner, Button, Card, Checkbox, PageHeader, Select, TextArea, TextField, useToast } from '../../../_ui/ui';
import { ErrorBox, Loading, NoPerm, fieldErrors, useLoad } from '../usuarios/_shared';
import BusinessHoursEditor, { DAY_ORDER, validateHours, type Hours } from './BusinessHoursEditor';

interface OrgResponse {
  id: string; name: string; slug: string; overrides?: Record<string, any>; security?: { requireMfaRoles: string[] };
  settings: {
    timezone: string; businessHours: Hours; protocolPrefix: string; contactCategories: string[]; recordingNotice: string; outsideHoursMessage: string;
    retention: { messagesDays: number; recordingsDays: number; auditDays: number; logsDays: number };
    sla: { firstResponseSec: number; resolutionSec: number };
    ai: { enabled: boolean; mode: string; confidenceThreshold: number };
    csat: { enabled: boolean; prompt: string };
    webchat: { allowedOrigins: string[]; title: string; primaryColor: string; offlineMessage: string };
    whatsapp: { windowHours: number }; reopenWindowSec: number;
    /** Política de discagem: só existe aqui quando o órgão a personalizou (sem padrão mesclado pela API). */
    voice?: { dialAllowPrefixes?: string[]; dialMaxPerAgentPerDay?: number; dialRequirePermission?: boolean };
  };
}

interface Form {
  name: string; timezone: string; protocolPrefix: string; contactCategories: string; recordingNotice: string; outsideHoursMessage: string;
  businessHours: Hours;
  messagesDays: string; recordingsDays: string; auditDays: string; logsDays: string;
  firstResponseSec: string; resolutionSec: string; reopenWindowSec: string;
  csatEnabled: boolean; csatPrompt: string;
  allowedOrigins: string; wcTitle: string; wcColor: string; wcOffline: string;
  waWindow: string; mfaRoles: string[];
  dialPrefixes: string; dialMax: string; dialRequirePerm: boolean;
}

const TZS = ['America/Araguaina', 'America/Sao_Paulo', 'America/Manaus', 'America/Belem', 'America/Fortaleza', 'America/Bahia', 'America/Cuiaba', 'America/Campo_Grande', 'America/Recife', 'America/Porto_Velho', 'America/Rio_Branco', 'America/Noronha'];
const ROLES = ['ATENDENTE', 'SUPERVISOR', 'ADMIN', 'FISCAL'] as const;
const list = (s: string) => [...new Set(s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean))];
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

const toForm = (o: OrgResponse): Form => {
  const s = o.settings;
  const bh: Hours = {}; for (const d of DAY_ORDER) bh[d] = clone(s.businessHours?.[d] ?? []);
  return {
    name: o.name, timezone: s.timezone, protocolPrefix: s.protocolPrefix, contactCategories: s.contactCategories.join(', '), recordingNotice: s.recordingNotice, outsideHoursMessage: s.outsideHoursMessage,
    businessHours: bh,
    messagesDays: String(s.retention.messagesDays), recordingsDays: String(s.retention.recordingsDays), auditDays: String(s.retention.auditDays), logsDays: String(s.retention.logsDays),
    firstResponseSec: String(s.sla.firstResponseSec), resolutionSec: String(s.sla.resolutionSec), reopenWindowSec: String(s.reopenWindowSec),
    csatEnabled: s.csat.enabled, csatPrompt: s.csat.prompt,
    allowedOrigins: s.webchat.allowedOrigins.join('\n'), wcTitle: s.webchat.title, wcColor: s.webchat.primaryColor, wcOffline: s.webchat.offlineMessage,
    waWindow: String(s.whatsapp.windowHours), mfaRoles: [...(o.security?.requireMfaRoles ?? [])],
    dialPrefixes: (s.voice?.dialAllowPrefixes ?? o.overrides?.voice?.dialAllowPrefixes ?? DIAL_DEFAULTS.dialAllowPrefixes).join('\n'),
    dialMax: String(s.voice?.dialMaxPerAgentPerDay ?? o.overrides?.voice?.dialMaxPerAgentPerDay ?? DIAL_DEFAULTS.dialMaxPerAgentPerDay),
    dialRequirePerm: s.voice?.dialRequirePermission ?? o.overrides?.voice?.dialRequirePermission ?? DIAL_DEFAULTS.dialRequirePermission,
  };
};

/** Padrões efetivos da política de discagem (iguais aos do servidor quando o órgão não personalizou). */
const DIAL_DEFAULTS = { dialAllowPrefixes: [] as string[], dialMaxPerAgentPerDay: 50, dialRequirePermission: true };
const stripSep = (x: string) => x.replace(/[\s().-]/g, '');
const PREFIX_RE = /^\+?[0-9]{1,20}$/;
const prefixList = (s: string) => [...new Set(s.split(/[\n,;]/).map(stripSep).filter(Boolean))];

const num = (s: string) => (s.trim() === '' ? NaN : Number(s));

/** Monta o PATCH só com o que mudou (evita transformar valores padrão em "sobrescritos"). */
function buildPatch(a: Form, b: Form): { patch: Record<string, any>; errors: Record<string, string> } {
  const patch: Record<string, any> = {}; const errors: Record<string, string> = {};
  const nested = (grp: string, key: string, v: unknown) => { patch[grp] = { ...(patch[grp] ?? {}), [key]: v }; };
  const intField = (grp: string | null, key: string, path: string, av: string, bv_: string, label: string) => {
    if (av === bv_) return;
    const n = num(bv_);
    if (!Number.isInteger(n)) { errors[path] = `${label}: informe um número inteiro.`; return; }
    if (grp) nested(grp, key, n); else patch[key] = n;
  };
  if (a.name !== b.name) patch.name = b.name.trim();
  if (a.timezone !== b.timezone) patch.timezone = b.timezone.trim();
  if (a.protocolPrefix !== b.protocolPrefix) patch.protocolPrefix = b.protocolPrefix.trim().toUpperCase();
  if (JSON.stringify(list(a.contactCategories)) !== JSON.stringify(list(b.contactCategories))) patch.contactCategories = list(b.contactCategories);
  if (a.recordingNotice !== b.recordingNotice) patch.recordingNotice = b.recordingNotice;
  if (a.outsideHoursMessage !== b.outsideHoursMessage) patch.outsideHoursMessage = b.outsideHoursMessage;
  for (const d of DAY_ORDER) if (JSON.stringify(a.businessHours[d] ?? []) !== JSON.stringify(b.businessHours[d] ?? [])) patch.businessHours = { ...(patch.businessHours ?? {}), [d]: b.businessHours[d] ?? [] };
  intField('retention', 'messagesDays', 'retention.messagesDays', a.messagesDays, b.messagesDays, 'Mensagens');
  intField('retention', 'recordingsDays', 'retention.recordingsDays', a.recordingsDays, b.recordingsDays, 'Gravações');
  intField('retention', 'auditDays', 'retention.auditDays', a.auditDays, b.auditDays, 'Auditoria');
  intField('retention', 'logsDays', 'retention.logsDays', a.logsDays, b.logsDays, 'Logs');
  intField('sla', 'firstResponseSec', 'sla.firstResponseSec', a.firstResponseSec, b.firstResponseSec, '1ª resposta');
  intField('sla', 'resolutionSec', 'sla.resolutionSec', a.resolutionSec, b.resolutionSec, 'Resolução');
  intField(null, 'reopenWindowSec', 'reopenWindowSec', a.reopenWindowSec, b.reopenWindowSec, 'Janela de reabertura');
  intField('whatsapp', 'windowHours', 'whatsapp.windowHours', a.waWindow, b.waWindow, 'Janela do WhatsApp');
  if (a.csatEnabled !== b.csatEnabled) nested('csat', 'enabled', b.csatEnabled);
  if (a.csatPrompt !== b.csatPrompt) nested('csat', 'prompt', b.csatPrompt);
  if (JSON.stringify(list(a.allowedOrigins)) !== JSON.stringify(list(b.allowedOrigins))) nested('webchat', 'allowedOrigins', list(b.allowedOrigins).map((o) => o.replace(/\/$/, '')));
  if (a.wcTitle !== b.wcTitle) nested('webchat', 'title', b.wcTitle);
  if (a.wcColor !== b.wcColor) nested('webchat', 'primaryColor', b.wcColor.trim());
  if (a.wcOffline !== b.wcOffline) nested('webchat', 'offlineMessage', b.wcOffline);
  if (JSON.stringify(prefixList(a.dialPrefixes)) !== JSON.stringify(prefixList(b.dialPrefixes))) {
    const l = prefixList(b.dialPrefixes);
    const bad = l.find((x) => !PREFIX_RE.test(x));
    if (bad) errors['voice.dialAllowPrefixes'] = `Prefixo inválido: “${bad}”. Use só dígitos, com + opcional no início (ex.: +5563).`;
    else if (l.length > 200) errors['voice.dialAllowPrefixes'] = 'No máximo 200 prefixos.';
    else nested('voice', 'dialAllowPrefixes', l);
  }
  if (a.dialMax !== b.dialMax) {
    const n = num(b.dialMax);
    if (!Number.isInteger(n) || n < 0 || n > 100000) errors['voice.dialMaxPerAgentPerDay'] = 'Limite diário: informe um inteiro de 0 a 100.000.';
    else nested('voice', 'dialMaxPerAgentPerDay', n);
  }
  if (a.dialRequirePerm !== b.dialRequirePerm) nested('voice', 'dialRequirePermission', b.dialRequirePerm);
  if ([...a.mfaRoles].sort().join() !== [...b.mfaRoles].sort().join()) patch.security = { requireMfaRoles: ROLES.filter((r) => b.mfaRoles.includes(r)) };
  return { patch, errors };
}

const PATH_LABEL: Record<string, string> = {
  name: 'Nome', timezone: 'Fuso horário', protocolPrefix: 'Prefixo do protocolo', contactCategories: 'Categorias de contato', recordingNotice: 'Aviso de gravação', outsideHoursMessage: 'Aviso fora do expediente',
  'retention.messagesDays': 'Retenção de mensagens', 'retention.recordingsDays': 'Retenção de gravações', 'retention.auditDays': 'Retenção da auditoria', 'retention.logsDays': 'Retenção de logs',
  'sla.firstResponseSec': 'SLA de 1ª resposta', 'sla.resolutionSec': 'SLA de resolução', reopenWindowSec: 'Janela de reabertura', 'csat.prompt': 'Pergunta do CSAT',
  'webchat.allowedOrigins': 'Origens permitidas', 'webchat.title': 'Título do webchat', 'webchat.primaryColor': 'Cor do webchat', 'webchat.offlineMessage': 'Mensagem fora do horário do webchat',
  'whatsapp.windowHours': 'Janela do WhatsApp', 'security.requireMfaRoles': 'MFA obrigatório',
  'voice.dialAllowPrefixes': 'Prefixos de discagem permitidos', 'voice.dialMaxPerAgentPerDay': 'Limite diário de ligações por atendente', 'voice.dialRequirePermission': 'Exigir permissão para discar',
};

export default function OrgaoPage() {
  const { can } = useBvSession();
  const toast = useToast();
  const allowed = can('org:manage');
  const org = useLoad(() => bv.get<OrgResponse>('/admin/org'), [], allowed);
  const [initial, setInitial] = useState<Form | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formErr, setFormErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (org.data) { const f = toForm(org.data); setInitial(f); setForm(clone(f)); } }, [org.data]);
  useEffect(() => { if (formErr || Object.keys(errors).length) summaryRef.current?.focus(); }, [formErr, errors]);

  const overrides = org.data?.overrides ?? {};
  const isOver = (path: string) => path.split('.').reduce<any>((o, k) => (o && typeof o === 'object' ? o[k] : undefined), overrides) !== undefined;
  const src = (path: string) => (isOver(path) ? 'Personalizado pelo órgão' : 'Padrão do sistema');
  const dirty = useMemo(() => !!initial && !!form && JSON.stringify(initial) !== JSON.stringify(form), [initial, form]);

  if (!allowed) return <><PageHeader title="Configurações do órgão" /><NoPerm perm="org:manage" /></>;
  if (org.error) return <><PageHeader title="Configurações do órgão" /><ErrorBox message={org.error} onRetry={org.reload} /></>;
  if (!form || !initial || !org.data) return <><PageHeader title="Configurações do órgão" /><Loading label="Carregando configurações" /></>;

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const hoursErr: Record<string, string> = { ...validateHours(form.businessHours) };
  for (const [k, v] of Object.entries(errors)) if (k.startsWith('businessHours.')) hoursErr[k.split('.')[1]] = v;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setFormErr(null);
    const hv = validateHours(form.businessHours);
    const { patch, errors: ce } = buildPatch(initial, form);
    const merged = { ...ce, ...Object.fromEntries(Object.entries(hv).map(([d, m]) => [`businessHours.${d}`, m])) };
    setErrors(merged);
    if (Object.keys(merged).length) { setFormErr('Corrija os campos destacados antes de salvar.'); return; }
    if (!Object.keys(patch).length) { toast.info('Nenhuma alteração para salvar.'); return; }
    setBusy(true);
    try {
      await bv.patch('/admin/org', patch);
      toast.success('Configurações salvas.'); org.reload();
    } catch (err) {
      const fe = fieldErrors(err);
      setErrors(fe);
      setFormErr(errMsg(err) + (Object.keys(fe).length ? ' Corrija os campos destacados.' : ''));
    } finally { setBusy(false); }
  };

  const e = errors;
  const prefixErr = e['voice.dialAllowPrefixes'] ?? Object.entries(e).find(([k]) => k.startsWith('voice.dialAllowPrefixes.'))?.[1];
  const dialMaxNum = num(form.dialMax);
  const secs = (s: string) => { const n = num(s); return Number.isFinite(n) ? fmtDuration(n) : ''; };
  const summary = [...(formErr ? [formErr] : []), ...Object.entries(errors).map(([k, v]) => `${PATH_LABEL[k] ?? k}: ${v}`)];

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Configurações do órgão" subtitle={`${org.data.name} · identificador ${org.data.slug}`}
        actions={<Badge tone="neutral">{Object.keys(overrides).length} grupo(s) personalizado(s)</Badge>} />
      <p className="mb-3 text-sm text-bv-muted">Cada campo indica se o valor é <strong>personalizado pelo órgão</strong> ou o <strong>padrão do sistema</strong>. Só o que você alterar é gravado.</p>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {summary.length > 0 && (
          <div ref={summaryRef} tabIndex={-1} role="alert" className="rounded-md border border-bv-danger bg-bv-danger-soft px-3 py-2 text-sm text-bv-danger outline-none">
            <strong className="block">Não foi possível salvar</strong>
            <ul className="list-disc pl-5">{summary.map((m, i) => <li key={i}>{m}</li>)}</ul>
          </div>
        )}

        <Card title="Identificação e protocolo">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Nome do órgão" required value={form.name} onChange={(x) => set('name', x.target.value)} error={e.name} hint="Nome exibido nos canais e relatórios." />
            <Select label="Fuso horário" required value={form.timezone} onChange={(x) => set('timezone', x.target.value)} error={e.timezone} hint={src('timezone')}>
              {(TZS.includes(form.timezone) ? TZS : [form.timezone, ...TZS]).map((z) => <option key={z} value={z}>{z}</option>)}
            </Select>
            <TextField label="Prefixo do protocolo" required value={form.protocolPrefix} onChange={(x) => set('protocolPrefix', x.target.value.toUpperCase())} error={e.protocolPrefix} hint={`${src('protocolPrefix')} · 2 a 10 letras maiúsculas ou números.`} maxLength={10} />
            <TextField label="Categorias de contato" value={form.contactCategories} onChange={(x) => set('contactCategories', x.target.value)} error={e.contactCategories} hint={`${src('contactCategories')} · separe por vírgula.`} />
          </div>
        </Card>

        <Card title="Horário comercial">
          <p className="mb-3 text-sm text-bv-muted">{src('businessHours')}. Fora destas janelas (e em feriados) o atendimento humano é considerado fechado. Os feriados são cadastrados em Usuários e setores, aba Feriados.</p>
          <BusinessHoursEditor value={form.businessHours} onChange={(v) => set('businessHours', v)} errors={hoursErr} />
        </Card>

        <Card title="Avisos aos cidadãos">
          <div className="flex flex-col gap-3">
            <TextArea label="Aviso de gravação de chamadas" value={form.recordingNotice} onChange={(x) => set('recordingNotice', x.target.value)} error={e.recordingNotice} maxLength={1000} hint={`${src('recordingNotice')} · falado no início das ligações.`} />
            <TextArea label="Aviso fora do expediente" value={form.outsideHoursMessage} onChange={(x) => set('outsideHoursMessage', x.target.value)} error={e.outsideHoursMessage} maxLength={1000} hint={src('outsideHoursMessage')} />
          </div>
        </Card>

        <Card title="Prazos de SLA e reabertura">
          <div className="grid gap-3 sm:grid-cols-3">
            <TextField label="1ª resposta (segundos)" type="number" min={10} value={form.firstResponseSec} onChange={(x) => set('firstResponseSec', x.target.value)} error={e['sla.firstResponseSec']} hint={`${src('sla.firstResponseSec')} · ${secs(form.firstResponseSec)}`} />
            <TextField label="Resolução (segundos)" type="number" min={60} value={form.resolutionSec} onChange={(x) => set('resolutionSec', x.target.value)} error={e['sla.resolutionSec']} hint={`${src('sla.resolutionSec')} · ${secs(form.resolutionSec)}`} />
            <TextField label="Janela de reabertura (segundos)" type="number" min={0} value={form.reopenWindowSec} onChange={(x) => set('reopenWindowSec', x.target.value)} error={e.reopenWindowSec} hint={`${src('reopenWindowSec')} · ${secs(form.reopenWindowSec)}`} />
          </div>
          <p className="mt-2 text-xs text-bv-muted">Cada fila pode ter prazos próprios (Filas e roteamento); estes são os padrões do órgão.</p>
        </Card>

        <Card title="Retenção de dados (LGPD)">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <TextField label="Mensagens (dias)" type="number" min={1} value={form.messagesDays} onChange={(x) => set('messagesDays', x.target.value)} error={e['retention.messagesDays']} hint={src('retention.messagesDays')} />
            <TextField label="Gravações (dias)" type="number" min={1} value={form.recordingsDays} onChange={(x) => set('recordingsDays', x.target.value)} error={e['retention.recordingsDays']} hint={src('retention.recordingsDays')} />
            <TextField label="Auditoria (dias)" type="number" min={1} value={form.auditDays} onChange={(x) => set('auditDays', x.target.value)} error={e['retention.auditDays']} hint={`${src('retention.auditDays')} · o mínimo do servidor prevalece.`} />
            <TextField label="Logs de integração (dias)" type="number" min={1} value={form.logsDays} onChange={(x) => set('logsDays', x.target.value)} error={e['retention.logsDays']} hint={src('retention.logsDays')} />
          </div>
          <p className="mt-2 text-xs text-bv-muted">Simule e execute a limpeza em Segurança e LGPD, aba Retenção.</p>
        </Card>

        <Card title="Inteligência artificial" actions={<Link href="/balcao/admin/curadoria" className="text-sm text-bv-primary underline">Abrir Curadoria e IA</Link>}>
          <dl className="grid gap-2 text-sm sm:grid-cols-3">
            <div><dt className="text-bv-muted">Atendimento por IA</dt><dd>{org.data.settings.ai.enabled ? 'Ativado' : 'Desativado'} <span className="text-xs text-bv-muted">({src('ai.enabled')})</span></dd></div>
            <div><dt className="text-bv-muted">Modo</dt><dd>{org.data.settings.ai.mode === 'PROGRESSIVE' ? 'Progressivo (responde sozinha)' : 'Assistido (sugere ao atendente)'}</dd></div>
            <div><dt className="text-bv-muted">Limiar de confiança</dt><dd>{org.data.settings.ai.confidenceThreshold}</dd></div>
          </dl>
          <p className="mt-2 text-xs text-bv-muted">Somente leitura aqui. O modo e o limiar são ajustados na página de curadoria.</p>
        </Card>

        <Card title="Pesquisa de satisfação (CSAT)">
          <div className="flex flex-col gap-3">
            <Checkbox label="Enviar pesquisa ao encerrar o atendimento" hint={src('csat.enabled')} checked={form.csatEnabled} onChange={(x) => set('csatEnabled', x.target.checked)} />
            <TextField label="Pergunta" value={form.csatPrompt} onChange={(x) => set('csatPrompt', x.target.value)} error={e['csat.prompt']} maxLength={500} hint={src('csat.prompt')} />
          </div>
        </Card>

        <Card title="Chat do site (webchat)">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextArea label="Origens permitidas" rows={4} value={form.allowedOrigins} onChange={(x) => set('allowedOrigins', x.target.value)} error={e['webchat.allowedOrigins']} className="sm:col-span-2"
              hint={`${src('webchat.allowedOrigins')} · uma por linha, no formato https://dominio (sem barra final). Vazio bloqueia o widget em qualquer site.`} placeholder="https://www.tjto.jus.br" />
            <TextField label="Título da janela" value={form.wcTitle} onChange={(x) => set('wcTitle', x.target.value)} error={e['webchat.title']} maxLength={100} hint={src('webchat.title')} />
            <div className="flex items-end gap-2">
              <TextField label="Cor principal (#RRGGBB)" value={form.wcColor} onChange={(x) => set('wcColor', x.target.value)} error={e['webchat.primaryColor']} maxLength={7} hint={src('webchat.primaryColor')} className="flex-1" />
              <span aria-hidden="true" className="mb-6 inline-block h-10 w-10 rounded-md border border-bv-border" style={{ background: /^#[0-9a-fA-F]{6}$/.test(form.wcColor) ? form.wcColor : 'transparent' }} />
            </div>
            <TextArea label="Mensagem fora do horário" value={form.wcOffline} onChange={(x) => set('wcOffline', x.target.value)} error={e['webchat.offlineMessage']} maxLength={500} className="sm:col-span-2" hint={src('webchat.offlineMessage')} />
          </div>
        </Card>

        <Card title="WhatsApp">
          <div className="max-w-xs">
            <TextField label="Janela de atendimento (horas)" type="number" min={1} max={24} value={form.waWindow} onChange={(x) => set('waWindow', x.target.value)} error={e['whatsapp.windowHours']} hint={`${src('whatsapp.windowHours')} · 1 a 24 h após a última mensagem do cidadão.`} />
          </div>
        </Card>

        <Card title="Telefonia — discagem e transbordo">
          <div className="flex flex-col gap-3">
            <TextArea label="Prefixos permitidos para discagem" rows={4} value={form.dialPrefixes} onChange={(x) => set('dialPrefixes', x.target.value)} error={prefixErr} spellCheck={false} placeholder={'+5563\n0800'}
              hint={`${isOver('voice.dialAllowPrefixes') ? 'Personalizado pelo órgão' : 'Padrão do sistema'} · um por linha (ou separados por vírgula), só dígitos e + no início. Vazio = somente números nacionais fixos e celulares do Brasil (DDD + número, com ou sem +55). Preenchido: a lista substitui esse padrão — o número é comparado por prefixo, na forma digitada, em E.164 (+55…) e nacional (DDD + número).`} />
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="Limite diário de ligações por atendente" type="number" min={0} max={100000} value={form.dialMax} onChange={(x) => set('dialMax', x.target.value)} error={e['voice.dialMaxPerAgentPerDay']}
                hint={`${isOver('voice.dialMaxPerAgentPerDay') ? 'Personalizado pelo órgão' : 'Padrão do sistema (50)'} · conta todas as tentativas do dia no fuso do órgão, inclusive as que falharam.${dialMaxNum === 0 ? ' Com 0, ninguém consegue discar.' : ''}`} />
              <div className="self-end">
                <Checkbox label="Exigir permissão e presença para discar" checked={form.dialRequirePerm} onChange={(x) => set('dialRequirePerm', x.target.checked)}
                  hint={`${isOver('voice.dialRequirePermission') ? 'Personalizado pelo órgão' : 'Padrão do sistema (ativado)'} · ativado: exige a permissão de responder conversas e presença “Online” ou “Em atendimento”. Desativado: dispensa as duas exigências (número e limite diário continuam valendo, e o usuário precisa de ramal SIP).`} />
              </div>
            </div>
            {e['voice.dialRequirePermission'] && <p role="alert" className="text-sm text-bv-danger">{e['voice.dialRequirePermission']}</p>}
            {!form.dialRequirePerm && <Banner tone="warning">Sem exigir permissão e presença, qualquer usuário com ramal pode originar ligações pelo tronco, dentro do limite diário.</Banner>}
            <div className="rounded-md border border-bv-border bg-bv-subtle p-3 text-sm">
              <p className="font-medium">Sempre bloqueado, mesmo com prefixos liberados</p>
              <ul className="mt-1 list-disc pl-5">
                <li>Números 0900 e 0300 (serviços premium e de custo compartilhado).</li>
                <li>Códigos de serviço com <code>*</code> ou <code>#</code>.</li>
              </ul>
              <p className="mt-2 font-medium">Bloqueado por padrão (só passa se o prefixo estiver na lista)</p>
              <ul className="mt-1 list-disc pl-5">
                <li>Números internacionais (<code>+</code> diferente de +55, ou iniciados por <code>00</code>), 0800, números curtos (como 190) e formatos inválidos.</li>
              </ul>
              <p className="mt-2"><strong>A mesma política de números vale para a transferência de chamadas</strong> (inclusive a da URA): destinos fora da política são recusados com a mensagem “destino não permitido pela política do órgão”. Ramais internos de 2 a 6 dígitos são sempre aceitos na transferência; o limite diário e a exigência de permissão se aplicam só à discagem. Alterações valem em até 30 segundos.</p>
            </div>
          </div>
        </Card>

        <Card title="Segurança de acesso">
          <fieldset>
            <legend className="mb-1 text-sm font-medium">Exigir verificação em duas etapas (MFA) para os perfis</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {ROLES.map((r) => (
                <Checkbox key={r} label={ROLE_LABEL[r]} checked={form.mfaRoles.includes(r)}
                  onChange={(x) => set('mfaRoles', x.target.checked ? [...form.mfaRoles, r] : form.mfaRoles.filter((y) => y !== r))} />
              ))}
            </div>
            <p className="mt-2 text-xs text-bv-muted">{isOver('security') ? 'Personalizado pelo órgão' : 'Padrão do sistema (nenhum perfil exige MFA)'} · Recomendado: administradores e supervisores. Usuários sem MFA são levados a configurá-lo no próximo acesso.</p>
            {e['security.requireMfaRoles'] && <p role="alert" className="mt-1 text-sm text-bv-danger">{e['security.requireMfaRoles']}</p>}
            {!form.mfaRoles.includes('ADMIN') && <div className="mt-2"><Banner tone="warning">Administradores sem MFA obrigatório reduzem a nota da postura de segurança.</Banner></div>}
          </fieldset>
        </Card>

        <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-bv-border bg-bv-bg py-3">
          <Button type="submit" loading={busy} disabled={!dirty}>Salvar configurações</Button>
          <Button variant="secondary" disabled={!dirty || busy} onClick={() => { setForm(clone(initial)); setErrors({}); setFormErr(null); }}>Descartar alterações</Button>
          <span role="status" className="text-sm text-bv-muted">{dirty ? 'Há alterações não salvas.' : 'Sem alterações.'}</span>
        </div>
      </form>
    </div>
  );
}
