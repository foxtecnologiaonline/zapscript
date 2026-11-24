'use client';
import React, { useId, useRef, useState } from 'react';
import { errMsg } from '@/lib/balcao/api';
import { fmtBytes } from '@/lib/balcao/format';
import { Button, TextArea, TextField, useToast } from '../../../_ui/ui';
import { uploadPrompt, type Prompt } from './ivrTypes';

const clean = (p: Prompt): Prompt | undefined => {
  const i18n = p.i18n && Object.keys(p.i18n).length ? p.i18n : undefined;
  const out: Prompt = { ...(p.text ? { text: p.text } : {}), ...(p.audioKey ? { audioKey: p.audioKey } : {}), ...(p.lang ? { lang: p.lang } : {}), ...(i18n ? { i18n } : {}) };
  return out.text || out.audioKey || out.i18n ? out : undefined;
};

/** Upload de áudio: <input type=file> rotulado; mostra a chave enviada (a API não oferece pré-escuta). */
function AudioField({ label, audioKey, onKey, disabled }: { label: string; audioKey?: string; onKey: (k: string | undefined) => void; disabled?: boolean }) {
  const toast = useToast();
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const pick = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true); setErr(null);
    try { const r = await uploadPrompt(f); onKey(r.audioKey); setInfo(`${f.name} (${fmtBytes(r.sizeBytes)})`); toast.success('Áudio enviado. Salve o rascunho para manter.'); }
    catch (e) { setErr(errMsg(e)); }
    finally { setBusy(false); if (ref.current) ref.current.value = ''; }
  };
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <input id={id} ref={ref} type="file" accept=".wav,.sln,.sln16,.sln24,.ulaw,.alaw,.gsm,audio/wav" disabled={disabled || busy} aria-describedby={`${id}-h`}
        onChange={(e) => void pick(e.target.files?.[0])} className="text-sm" />
      <p id={`${id}-h`} className="text-xs text-bv-muted">WAV PCM 16-bit mono (8 ou 16 kHz) ou sln/ulaw/alaw/gsm, até 12 MB. O áudio enviado tem prioridade sobre o texto.</p>
      {busy && <p role="status" className="text-sm">Enviando…</p>}
      {err && <p role="alert" className="text-sm text-bv-danger">{err}</p>}
      {audioKey && (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span>Áudio em uso: <code className="break-all text-xs">{audioKey}</code>{info ? ` — ${info}` : ''}</span>
          <Button size="sm" variant="secondary" disabled={disabled} onClick={() => { onKey(undefined); setInfo(null); }}>Remover áudio</Button>
        </p>
      )}
    </div>
  );
}

/** Editor de prompt: texto (voz sintetizada) + áudio enviado + variações por idioma. `onChange(undefined)` quando fica vazio. */
export default function PromptEditor({ label, value, onChange, disabled, hint }: { label: string; value?: Prompt; onChange: (p: Prompt | undefined) => void; disabled?: boolean; hint?: string }) {
  const p = value ?? {};
  const [newLang, setNewLang] = useState('');
  const set = (patch: Partial<Prompt>) => onChange(clean({ ...p, ...patch }));
  const setLang = (lang: string, patch: { text?: string; audioKey?: string } | null) => {
    const i18n = { ...(p.i18n ?? {}) };
    if (patch === null) delete i18n[lang]; else { const v = { ...i18n[lang], ...patch }; if (!v.text) delete v.text; if (!v.audioKey) delete v.audioKey; i18n[lang] = v; }
    onChange(clean({ ...p, i18n }));
  };
  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-bv-border p-3" disabled={disabled}>
      <legend className="px-1 text-sm font-semibold">{label}</legend>
      <TextArea label="Texto falado (voz sintetizada)" hint={hint ?? 'Escreva como será falado, em frases curtas.'} maxLength={1500} value={p.text ?? ''} onChange={(e) => set({ text: e.target.value })} />
      <AudioField label="Áudio gravado (opcional)" audioKey={p.audioKey} onKey={(k) => set({ audioKey: k })} disabled={disabled} />
      <details>
        <summary className="cursor-pointer text-sm font-medium">Outros idiomas ({Object.keys(p.i18n ?? {}).length})</summary>
        <div className="mt-2 flex flex-col gap-3">
          {Object.entries(p.i18n ?? {}).map(([lang, v]) => (
            <div key={lang} className="rounded-md bg-bv-subtle p-2">
              <p className="mb-1 flex items-center justify-between text-sm font-medium">Idioma {lang}<Button size="sm" variant="secondary" onClick={() => setLang(lang, null)} aria-label={`Remover idioma ${lang}`}>Remover</Button></p>
              <TextArea label={`Texto em ${lang}`} value={v.text ?? ''} maxLength={1500} onChange={(e) => setLang(lang, { text: e.target.value })} />
              <AudioField label={`Áudio em ${lang} (opcional)`} audioKey={v.audioKey} onKey={(k) => setLang(lang, { audioKey: k })} disabled={disabled} />
            </div>
          ))}
          <div className="flex items-end gap-2">
            <TextField label="Adicionar idioma (código)" placeholder="en, es, pt-BR" value={newLang} maxLength={10} onChange={(e) => setNewLang(e.target.value)} />
            <Button variant="secondary" disabled={!newLang.trim() || !!p.i18n?.[newLang.trim()]} onClick={() => { setLang(newLang.trim(), { text: ' ' }); setNewLang(''); }}>Adicionar</Button>
          </div>
        </div>
      </details>
    </fieldset>
  );
}
