'use client';
/**
 * Motor de formulário declarativo para as integrações gerenciadas por /balcao/integrations/:type
 * (e-Proc, GOV.BR, IdP do TJTO, Google Workspace, Jira). Valida no cliente com as mesmas regras do zod da API
 * e mapeia os erros do servidor (details[].path) de volta aos campos. Segredo em branco = manter o atual.
 */
import React, { useState } from 'react';
import { bv, errMsg } from '@/lib/balcao/api';
import { Banner, Button, Checkbox, Select, TextArea, TextField, useToast } from '../../../_ui/ui';
import { fieldErrors, isHttpUrl, SECRET_MASK, SecretField } from './_shared';

export interface FieldDef {
  key: string; label: string;
  kind: 'text' | 'url' | 'number' | 'secret' | 'secretarea' | 'select' | 'checkbox' | 'list' | 'map' | 'multicheck';
  hint?: string; required?: boolean; options?: Array<{ value: string; label: string }>; min?: number; max?: number; def?: unknown; placeholder?: string;
  showIf?: (v: Record<string, any>) => boolean; mapValues?: string[]; pattern?: RegExp; patternMsg?: string; email?: boolean; rows?: number; minLen?: number; fileJson?: boolean;
}
export interface Section { title: string; description?: string; fields: FieldDef[]; advanced?: boolean }
export interface FormApi { values: Record<string, any>; set: (key: string, v: unknown) => void }

const getPath = (o: any, path: string) => path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
const setPath = (o: Record<string, any>, path: string, v: unknown) => {
  const ks = path.split('.'); let cur = o;
  ks.slice(0, -1).forEach((k) => { cur[k] = cur[k] && typeof cur[k] === 'object' ? { ...cur[k] } : {}; cur = cur[k]; });
  cur[ks[ks.length - 1]] = v;
};
const delPath = (o: Record<string, any>, path: string) => { const ks = path.split('.'); let cur = o; for (const k of ks.slice(0, -1)) { if (!cur?.[k]) return; cur[k] = { ...cur[k] }; cur = cur[k]; } delete cur[ks[ks.length - 1]]; };

const mapToText = (m: Record<string, string> | undefined) => Object.entries(m ?? {}).map(([k, v]) => `${k} = ${v}`).join('\n');
function parseMap(text: string): { map: Record<string, string>; bad: number | null } {
  const map: Record<string, string> = {}; let bad: number | null = null;
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim(); if (!line) return;
    const ix = line.indexOf('=');
    if (ix <= 0 || !line.slice(ix + 1).trim()) { if (bad == null) bad = i + 1; return; }
    map[line.slice(0, ix).trim()] = line.slice(ix + 1).trim();
  });
  return { map, bad };
}
const parseList = (text: string) => Array.from(new Set(text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)));

export function initialValues(sections: Section[], config: Record<string, any>): Record<string, any> {
  const v: Record<string, any> = {};
  for (const f of sections.flatMap((s) => s.fields)) {
    const raw = getPath(config, f.key);
    const base = raw === undefined || raw === SECRET_MASK ? f.def : raw;
    if (f.kind === 'secret' || f.kind === 'secretarea') v[f.key] = '';
    else if (f.kind === 'checkbox') v[f.key] = base === undefined ? false : !!base;
    else if (f.kind === 'list') v[f.key] = Array.isArray(base) ? base.join('\n') : '';
    else if (f.kind === 'map') v[f.key] = mapToText(base as Record<string, string> | undefined);
    else if (f.kind === 'multicheck') v[f.key] = Array.isArray(base) ? base : [];
    else v[f.key] = base == null ? '' : String(base);
  }
  return v;
}

export function ConfigForm({ type, sections, config, configured, enabled, preface, onSaved, saveLabel = 'Salvar configuração' }: {
  type: string; sections: Section[]; config: Record<string, any>; configured: boolean; enabled: boolean;
  preface?: (api: FormApi) => React.ReactNode; onSaved: () => void | Promise<void>; saveLabel?: string;
}) {
  const toast = useToast();
  const [values, setValues] = useState<Record<string, any>>(() => initialValues(sections, config));
  const [on, setOn] = useState(configured ? enabled : true);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const set = (key: string, v: unknown) => setValues((c) => ({ ...c, [key]: v }));
  const isSet = (key: string) => getPath(config, key) === SECRET_MASK;
  const visible = (f: FieldDef) => !f.showIf || f.showIf(values);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setSummary([]);
    const er: Record<string, string> = {};
    // parte do que já existe (preserva chaves sem campo, como allowPrivateHosts) sem os segredos mascarados
    const body: Record<string, any> = JSON.parse(JSON.stringify(config));
    const strip = (o: any) => { if (o && typeof o === 'object') for (const k of Object.keys(o)) { if (o[k] === SECRET_MASK) delete o[k]; else strip(o[k]); } };
    strip(body);

    for (const f of sections.flatMap((s) => s.fields)) {
      if (!visible(f)) { if (f.kind !== 'secret' && f.kind !== 'secretarea') delPath(body, f.key); continue; }
      const v = values[f.key];
      switch (f.kind) {
        case 'secret': case 'secretarea': {
          const s = String(v ?? '').trim();
          if (!s) { if (f.required && !isSet(f.key)) er[f.key] = 'Campo obrigatório.'; break; }
          if (f.minLen && s.length < f.minLen) { er[f.key] = `Mínimo de ${f.minLen} caracteres.`; break; }
          setPath(body, f.key, f.kind === 'secretarea' ? String(v) : s); break;
        }
        case 'checkbox': setPath(body, f.key, !!v); break;
        case 'multicheck': setPath(body, f.key, v as string[]); break;
        case 'list': {
          const items = parseList(String(v ?? ''));
          if (f.required && !items.length) er[f.key] = 'Informe ao menos um item.';
          else if (f.pattern && items.some((i) => !f.pattern!.test(i))) er[f.key] = f.patternMsg ?? 'Há item em formato inválido.';
          if (items.length) setPath(body, f.key, items); else if (f.required) setPath(body, f.key, []); else delPath(body, f.key);
          break;
        }
        case 'map': {
          const { map, bad } = parseMap(String(v ?? ''));
          if (bad) er[f.key] = `Linha ${bad}: use o formato chave = valor.`;
          else if (f.mapValues && Object.values(map).some((x) => !f.mapValues!.includes(x))) er[f.key] = `Valores aceitos: ${f.mapValues.join(', ')}.`;
          setPath(body, f.key, map); break;
        }
        case 'number': {
          const s = String(v ?? '').trim();
          if (!s) { if (f.required) er[f.key] = 'Campo obrigatório.'; else delPath(body, f.key); break; }
          const n = Number(s);
          if (!Number.isInteger(n) || (f.min != null && n < f.min) || (f.max != null && n > f.max)) { er[f.key] = `Informe um número inteiro${f.min != null && f.max != null ? ` entre ${f.min} e ${f.max}` : ''}.`; break; }
          setPath(body, f.key, n); break;
        }
        default: {
          const s = String(v ?? '').trim();
          if (!s) { if (f.required) er[f.key] = 'Campo obrigatório.'; else delPath(body, f.key); break; }
          if (f.kind === 'url' && !isHttpUrl(s)) { er[f.key] = 'Informe uma URL completa, começando com https://.'; break; }
          if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) { er[f.key] = 'Informe um e-mail válido.'; break; }
          if (f.pattern && !f.pattern.test(s)) { er[f.key] = f.patternMsg ?? 'Formato inválido.'; break; }
          setPath(body, f.key, s);
        }
      }
    }
    setErrs(er);
    if (Object.keys(er).length) { setSummary(['Corrija os campos indicados e tente novamente.']); return; }
    setBusy(true);
    try {
      await bv.put(`/integrations/${type}`, { enabled: on, config: body });
      toast.success('Configuração salva. Execute o teste de conexão para validar.');
      await onSaved();
    } catch (err) {
      const fe = fieldErrors(err);
      setErrs(fe.map);
      setSummary([errMsg(err), ...fe.list, ...Object.entries(fe.map).map(([k, m]) => `${sections.flatMap((s) => s.fields).find((f) => f.key === k)?.label ?? k}: ${m}`)]);
    } finally { setBusy(false); }
  };

  const renderField = (f: FieldDef) => {
    if (!visible(f)) return null;
    const err = errs[f.key]; const v = values[f.key];
    switch (f.kind) {
      case 'secret': return <SecretField key={f.key} label={f.label} value={v} onChange={(x) => set(f.key, x)} isSet={isSet(f.key)} error={err} hint={f.hint} required={f.required} />;
      case 'secretarea': return (
        <div key={f.key} className="flex flex-col gap-2">
          <SecretField area label={f.label} value={v} onChange={(x) => set(f.key, x)} isSet={isSet(f.key)} error={err} hint={f.hint} required={f.required} />
          {f.fileJson && <FileLoader label="Carregar de arquivo .json" onText={(t) => set(f.key, t)} />}
        </div>
      );
      case 'checkbox': return <Checkbox key={f.key} label={f.label} hint={f.hint} checked={!!v} onChange={(e) => set(f.key, e.target.checked)} />;
      case 'select': return <Select key={f.key} label={f.label} hint={f.hint} error={err} required={f.required} value={v} onChange={(e) => set(f.key, e.target.value)}>
        {!f.required && <option value="">(não definido)</option>}{f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>;
      case 'list': case 'map': return <TextArea key={f.key} label={f.label} hint={f.hint} error={err} required={f.required} rows={f.rows ?? 4} value={v} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder} className="font-mono text-sm" spellCheck={false} />;
      case 'multicheck': return (
        <fieldset key={f.key} className="rounded-md border border-bv-border p-3">
          <legend className="px-1 text-sm font-medium">{f.label}</legend>
          {f.hint && <p className="mb-1 text-xs text-bv-muted">{f.hint}</p>}
          {f.options!.map((o) => <Checkbox key={o.value} label={o.label} checked={(v as string[]).includes(o.value)} onChange={(e) => set(f.key, e.target.checked ? [...v, o.value] : (v as string[]).filter((x) => x !== o.value))} />)}
        </fieldset>
      );
      default: return <TextField key={f.key} label={f.label} hint={f.hint} error={err} required={f.required} placeholder={f.placeholder}
        type={f.kind === 'number' ? 'number' : f.kind === 'url' ? 'url' : f.email ? 'email' : 'text'} min={f.min} max={f.max} value={v} onChange={(e) => set(f.key, e.target.value)} autoComplete="off" />;
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate aria-label={`Configuração de ${type}`}>
      {preface?.({ values, set })}
      <Checkbox label="Integração ativada" hint="Desativada, o sistema não usa esta integração mesmo configurada." checked={on} onChange={(e) => setOn(e.target.checked)} />
      {sections.map((s) => {
        const fields = s.fields.map(renderField).filter(Boolean);
        if (!fields.length) return null;
        const inner = <div className="grid gap-3 md:grid-cols-2">{fields}</div>;
        return s.advanced ? (
          <details key={s.title} className="rounded-md border border-bv-border p-3"><summary className="cursor-pointer text-sm font-semibold">{s.title}</summary>
            {s.description && <p className="mt-1 text-xs text-bv-muted">{s.description}</p>}<div className="mt-3">{inner}</div></details>
        ) : (
          <fieldset key={s.title} className="rounded-md border border-bv-border p-3"><legend className="px-1 text-sm font-semibold">{s.title}</legend>
            {s.description && <p className="mb-2 text-xs text-bv-muted">{s.description}</p>}{inner}</fieldset>
        );
      })}
      {summary.length > 0 && <Banner tone="danger" title="Não foi possível salvar">{summary.length === 1 ? summary[0] : <ul className="list-disc pl-5">{summary.map((m, i) => <li key={i}>{m}</li>)}</ul>}</Banner>}
      <div><Button type="submit" loading={busy}>{saveLabel}</Button></div>
    </form>
  );
}

function FileLoader({ label, onText }: { label: string; onText: (t: string) => void }) {
  const id = React.useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm">{label}</label>
      <input id={id} type="file" accept=".json,application/json" className="text-sm"
        onChange={async (e) => { const f = e.target.files?.[0]; if (f) onText(await f.text()); e.target.value = ''; }} />
    </div>
  );
}
