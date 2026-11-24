'use client';
import React, { useState } from 'react';
import { Button, Checkbox, Select, TextField } from '../../../_ui/ui';
import PromptEditor from './PromptEditor';
import { DIGITS, typeLabel, type IvrNode, type Prompt } from './ivrTypes';

interface Props { id: string; node: IvrNode; nodeIds: string[]; nodes: Record<string, IvrNode>; disabled: boolean; onChange: (n: IvrNode) => void }

const DAYS: Array<[string, string]> = [['sun', 'Domingo'], ['mon', 'Segunda-feira'], ['tue', 'Terça-feira'], ['wed', 'Quarta-feira'], ['thu', 'Quinta-feira'], ['fri', 'Sexta-feira'], ['sat', 'Sábado']];
const hoursToText = (v?: Array<[string, string]>) => (v ?? []).map(([a, b]) => `${a}-${b}`).join(', ');
const textToHours = (t: string): Array<[string, string]> => t.split(/[,;]/).map((s) => s.trim()).filter(Boolean).map((s) => { const [a, b] = s.split('-').map((x) => x.trim()); return [a ?? '', b ?? ''] as [string, string]; });

function NumField({ label, value, onChange, min, max, hint, disabled }: { label: string; value?: number; onChange: (n: number | undefined) => void; min: number; max: number; hint?: string; disabled?: boolean }) {
  return <TextField label={label} type="number" min={min} max={max} hint={hint} disabled={disabled} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />;
}

export default function NodeForm({ id, node, nodeIds, nodes, disabled, onChange }: Props) {
  const set = (patch: Record<string, unknown>) => {
    const next: IvrNode = { ...node, ...patch };
    Object.keys(next).forEach((k) => { if (next[k] === undefined) delete next[k]; });
    onChange(next);
  };
  const target = (label: string, key: string, optional = false, hint?: string) => (
    <Select label={label} hint={hint} value={node[key] ?? ''} onChange={(e) => set({ [key]: e.target.value || undefined })} disabled={disabled}>
      <option value="">{optional ? '(nenhum)' : 'Escolha um nó…'}</option>
      {nodeIds.filter((n) => n !== id || key === 'timeoutNode' || key === 'invalidNode').map((n) => <option key={n} value={n}>{n} — {typeLabel(nodes[n]?.type)}</option>)}
    </Select>
  );
  const prompt = (label: string, key = 'prompt', hint?: string) => <PromptEditor label={label} hint={hint} value={node[key] as Prompt | undefined} onChange={(p) => set({ [key]: p })} disabled={disabled} />;

  const retry = (
    <fieldset className="flex flex-col gap-3 rounded-md border border-bv-border p-3" disabled={disabled}>
      <legend className="px-1 text-sm font-semibold">Tentativas, tempo esgotado e opção inválida</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <NumField label="Tempo de espera (segundos)" min={1} max={60} value={node.timeoutSec} onChange={(n) => set({ timeoutSec: n })} hint="Entre 1 e 60." disabled={disabled} />
        <NumField label="Máximo de tentativas" min={0} max={10} value={node.maxRetries} onChange={(n) => set({ maxRetries: n })} hint="Ao esgotar, a URA encerra a ligação." disabled={disabled} />
        {target('Se o tempo esgotar, ir para', 'timeoutNode', true, 'Em branco: repete o aviso e conta tentativa.')}
        {target('Se a opção for inválida, ir para', 'invalidNode', true, 'Em branco: repete o aviso e conta tentativa.')}
      </div>
      {prompt('Aviso de tempo esgotado (opcional)', 'timeoutPrompt', 'Em branco: usa a frase padrão do sistema.')}
      {prompt('Aviso de opção inválida (opcional)', 'invalidPrompt', 'Em branco: usa a frase padrão do sistema.')}
    </fieldset>
  );

  /** Linhas dígito → valor (opções do menu, idiomas). */
  const mapRows = (key: 'options' | 'languages', legend: string, valueLabel: string, valueEl: (k: string, v: string, setV: (v: string) => void) => React.ReactNode, defaultValue: string) => {
    const map = (node[key] ?? {}) as Record<string, string>;
    const used = Object.keys(map);
    const free = DIGITS.filter((d) => !used.includes(d));
    const setMap = (m: Record<string, string>) => set({ [key]: m });
    return (
      <fieldset className="flex flex-col gap-2 rounded-md border border-bv-border p-3" disabled={disabled}>
        <legend className="px-1 text-sm font-semibold">{legend}</legend>
        {used.length === 0 && <p className="text-sm text-bv-muted">Nenhuma ainda. Adicione ao menos uma.</p>}
        {used.sort().map((k) => (
          <div key={k} className="flex flex-wrap items-end gap-2">
            <Select label="Tecla" value={k} onChange={(e) => { const m: Record<string, string> = {}; used.forEach((u) => { m[u === k ? e.target.value : u] = map[u]; }); setMap(m); }} className="w-24">
              {[k, ...free].map((d) => <option key={d} value={d}>{d}</option>)}
            </Select>
            <div className="min-w-[10rem] flex-1">{valueEl(k, map[k], (v) => setMap({ ...map, [k]: v }))}</div>
            <Button variant="secondary" onClick={() => { const m = { ...map }; delete m[k]; setMap(m); }} aria-label={`Remover ${valueLabel} da tecla ${k}`}>Remover</Button>
          </div>
        ))}
        <div><Button variant="secondary" disabled={!free.length} onClick={() => setMap({ ...map, [free[0]]: defaultValue })}>Adicionar tecla</Button></div>
      </fieldset>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-bv-muted">Nó <strong>{id}</strong> · {typeLabel(node.type)}</p>
      {node.type === 'menu' && (<>
        {prompt('Aviso do menu', 'prompt', 'Ex.: "Para consultar um processo, digite 1. Para falar com um atendente, digite 2."')}
        {mapRows('options', 'Teclas e destinos', 'opção', (k, v, setV) => (
          <Select label={`Destino da tecla ${k}`} value={v} onChange={(e) => setV(e.target.value)}>
            <option value="">Escolha um nó…</option>
            {nodeIds.map((n) => <option key={n} value={n}>{n} — {typeLabel(nodes[n]?.type)}</option>)}
          </Select>
        ), nodeIds.find((n) => n !== id) ?? id)}
        <div className="grid gap-3 sm:grid-cols-2">
          <Checkbox label="Permitir digitar durante o aviso (cut-thru)" hint="O chamador não precisa esperar o áudio terminar." checked={node.bargeIn !== false} disabled={disabled} onChange={(e) => set({ bargeIn: e.target.checked })} />
          <Checkbox label="Aviso obrigatório (force-play)" hint="Ignora teclas até o áudio terminar. Anula o cut-thru." checked={!!node.forcePlay} disabled={disabled} onChange={(e) => set({ forcePlay: e.target.checked || undefined })} />
          <Select label="Tecla para repetir o menu" value={node.repeatKey ?? ''} disabled={disabled} onChange={(e) => set({ repeatKey: e.target.value || undefined })}>
            <option value="">Padrão (*)</option>{DIGITS.map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
        </div>
        {retry}
      </>)}

      {node.type === 'play' && (<>
        {prompt('Mensagem')}
        {target('Próximo nó', 'next')}
        <div className="grid gap-3 sm:grid-cols-2">
          <Checkbox label="Permitir interromper digitando (cut-thru)" checked={node.bargeIn !== false} disabled={disabled} onChange={(e) => set({ bargeIn: e.target.checked })} />
          <Checkbox label="Mensagem obrigatória (force-play)" checked={!!node.forcePlay} disabled={disabled} onChange={(e) => set({ forcePlay: e.target.checked || undefined })} />
        </div>
      </>)}

      {node.type === 'collect' && (<>
        {prompt('Aviso pedindo os dígitos', 'prompt', 'Ex.: "Digite o número do processo e finalize com a tecla jogo da velha."')}
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Nome da variável" required value={node.var ?? ''} disabled={disabled} pattern="[A-Za-z][A-Za-z0-9_]{0,30}" hint="Letras, números e _; começa com letra." onChange={(e) => set({ var: e.target.value })} />
          {target('Próximo nó', 'next')}
          <NumField label="Mínimo de dígitos" min={1} max={30} value={node.minDigits} onChange={(n) => set({ minDigits: n })} disabled={disabled} />
          <NumField label="Máximo de dígitos" min={1} max={30} value={node.maxDigits} onChange={(n) => set({ maxDigits: n })} disabled={disabled} />
          <Select label="Tecla de término" value={node.terminator === null ? 'none' : node.terminator ?? ''} disabled={disabled} onChange={(e) => set({ terminator: e.target.value === '' ? undefined : e.target.value === 'none' ? null : e.target.value })}>
            <option value="">Padrão</option><option value="none">Nenhuma (só pelo máximo/tempo)</option>{DIGITS.map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
          <Select label="Validação" value={node.validate ?? 'none'} disabled={disabled} onChange={(e) => set({ validate: e.target.value === 'none' ? undefined : e.target.value })}>
            <option value="none">Nenhuma</option><option value="cpf">CPF</option><option value="cnpj">CNPJ</option>
          </Select>
          <Select label="Dado sensível" value={node.sensitive === undefined ? '' : node.sensitive ? 'yes' : 'no'} disabled={disabled} onChange={(e) => set({ sensitive: e.target.value === '' ? undefined : e.target.value === 'yes' })}
            hint="Dado sensível nunca é gravado na trilha, logs ou banco.">
            <option value="">Padrão (sim para CPF/CNPJ)</option><option value="yes">Sim</option><option value="no">Não</option>
          </Select>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Checkbox label="Repetir os dígitos ao chamador (echo)" checked={!!node.echo} disabled={disabled} onChange={(e) => set({ echo: e.target.checked || undefined })} />
          <Checkbox label="Pedir confirmação após o echo" hint="1 confirma, 2 digita de novo." checked={!!node.confirm} disabled={disabled} onChange={(e) => set({ confirm: e.target.checked || undefined })} />
        </div>
        {retry}
      </>)}

      {node.type === 'schedule' && <ScheduleFields node={node} target={target} set={set} disabled={disabled} />}

      {node.type === 'language' && (<>
        {prompt('Aviso de escolha de idioma', 'prompt', 'Ex.: "Para português, digite 1. For English, press 2."')}
        {mapRows('languages', 'Teclas e idiomas', 'idioma', (k, v, setV) => (
          <TextField label={`Código do idioma da tecla ${k}`} value={v} maxLength={10} placeholder="pt-BR, en, es" onChange={(e) => setV(e.target.value)} />
        ), 'en')}
        {target('Próximo nó (após escolher)', 'next')}
        {retry}
      </>)}

      {node.type === 'queue' && (<>
        {prompt('Aviso antes de entrar na fila (opcional)', 'prompt')}
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Categoria / assunto" value={node.category ?? ''} maxLength={80} disabled={disabled} hint="Usada pelo roteamento para escolher a fila." onChange={(e) => set({ category: e.target.value || undefined })} />
          <TextField label="Fila (opcional)" value={node.queue ?? ''} maxLength={120} disabled={disabled} hint="Nome/slug da fila. Em branco: o roteamento decide." onChange={(e) => set({ queue: e.target.value || undefined })} />
          <NumField label="Prioridade (0 a 10)" min={0} max={10} value={node.priority} onChange={(n) => set({ priority: n })} disabled={disabled} />
          <TextField label="Música de espera (classe)" value={node.mohClass ?? ''} maxLength={40} disabled={disabled} onChange={(e) => set({ mohClass: e.target.value || undefined })} />
        </div>
      </>)}

      {node.type === 'transfer' && (<>
        {prompt('Aviso antes de transferir (opcional)', 'prompt')}
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Tipo de destino" value={node.destination?.type ?? 'external'} disabled={disabled} onChange={(e) => set({ destination: { ...node.destination, type: e.target.value } })}>
            <option value="external">Número externo</option><option value="extension">Ramal interno</option><option value="ura0800">URA 0800</option>
          </Select>
          <TextField label="Número" required inputMode="tel" value={node.destination?.number ?? ''} disabled={disabled} hint="Dígitos, podendo iniciar com +, * ou #." onChange={(e) => set({ destination: { ...node.destination, number: e.target.value } })} />
        </div>
      </>)}

      {node.type === 'hangup' && prompt('Mensagem de despedida (opcional)')}
    </div>
  );
}

function ScheduleFields({ node, target, set, disabled }: { node: IvrNode; target: (l: string, k: string, o?: boolean, h?: string) => React.ReactNode; set: (p: Record<string, unknown>) => void; disabled: boolean }) {
  const custom = !!node.hours;
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(DAYS.map(([k]) => [k, hoursToText(node.hours?.[k])])));
  const commit = (d: Record<string, string>) => set({ hours: Object.fromEntries(DAYS.map(([k]) => [k, textToHours(d[k] ?? '')])) });
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {target('Dentro do horário, ir para', 'open')}
        {target('Fora do horário, ir para', 'closed')}
        {target('Em feriado, ir para (opcional)', 'holiday', true, 'Em branco: feriado segue como fora do horário.')}
      </div>
      <Checkbox label="Usar horário próprio neste nó" hint="Desmarcado: usa o horário de atendimento e os feriados do órgão." checked={custom} disabled={disabled}
        onChange={(e) => { if (e.target.checked) commit(draft); else set({ hours: undefined }); }} />
      {custom && (
        <fieldset className="grid gap-3 rounded-md border border-bv-border p-3 sm:grid-cols-2" disabled={disabled}>
          <legend className="px-1 text-sm font-semibold">Horário por dia da semana</legend>
          {DAYS.map(([k, label]) => (
            <TextField key={k} label={label} placeholder="08:00-12:00, 14:00-18:00" hint="Faixas HH:mm-HH:mm separadas por vírgula; vazio = fechado." value={draft[k] ?? ''}
              onChange={(e) => { const d = { ...draft, [k]: e.target.value }; setDraft(d); commit(d); }} />
          ))}
        </fieldset>
      )}
    </>
  );
}
