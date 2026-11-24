'use client';
/** Tipos e peças compartilhadas da tela de canais e integrações (contratos: apps/api/src/balcao/integrations/admin.ts e rotas dos canais). */
import React, { useCallback, useEffect, useState } from 'react';
import { API_ORIGIN, bv, BvApiError, errMsg, getAccessToken, refreshSession } from '@/lib/balcao/api';
import { fmtDateTime } from '@/lib/balcao/format';
import { Badge, Banner, Button, DataTable, Spinner, TextArea, TextField, useToast } from '../../../_ui/ui';
import { copyText } from '../../conhecimento/_kb';

export const SECRET_MASK = '••••••';

export interface IntegrationSummary {
  type: string; managedHere: boolean; configured: boolean; enabled: boolean; status: 'UNCONFIGURED' | 'OK' | 'ERROR' | string; lastCheckAt: string | null; lastError: string | null;
}

/** Rótulo e tom do estado de uma integração (sempre com texto — nunca só cor). */
export function statusInfo(s: Pick<IntegrationSummary, 'configured' | 'enabled' | 'status'> | null | undefined): { label: string; tone: 'neutral' | 'success' | 'danger' | 'warning' } {
  if (!s || !s.configured) return { label: 'Não configurado', tone: 'neutral' };
  if (!s.enabled) return { label: 'Desativado', tone: 'neutral' };
  if (s.status === 'OK') return { label: 'OK', tone: 'success' };
  if (s.status === 'ERROR') return { label: 'Erro', tone: 'danger' };
  return { label: 'Configurado, aguardando teste', tone: 'warning' };
}
export const StatusBadge = ({ s }: { s: Pick<IntegrationSummary, 'configured' | 'enabled' | 'status'> | null | undefined }) => {
  const i = statusInfo(s);
  return <Badge tone={i.tone}>{i.label}</Badge>;
};

/** Converte `details` de erro de validação da API ({path,message}[] ou string[]) em mapa campo → mensagem. */
export function fieldErrors(e: unknown): { map: Record<string, string>; list: string[] } {
  const map: Record<string, string> = {}; const list: string[] = [];
  if (e instanceof BvApiError && Array.isArray(e.details)) {
    for (const d of e.details as unknown[]) {
      if (typeof d === 'string') list.push(d);
      else if (d && typeof d === 'object') {
        const o = d as { path?: string; message?: string };
        if (o.path) map[o.path] = o.message ?? 'Valor inválido'; else if (o.message) list.push(o.message);
      }
    }
  }
  return { map, list };
}

/** Carrega GET /integrations/:type (config com segredos mascarados). */
export function useIntegration(type: string) {
  const [data, setData] = useState<{ type: string; configured: boolean; enabled: boolean; status: string; config: Record<string, any> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await bv.get(`/integrations/${type}`)); } catch (e) { setError(errMsg(e, 'Não foi possível carregar a configuração.')); }
    finally { setLoading(false); }
  }, [type]);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, loading, reload };
}

/** Campo somente leitura com botão "Copiar" (URLs de webhook, callback, tokens de verificação). */
export function CopyField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const toast = useToast();
  const id = React.useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <div className="flex gap-2">
        <input id={id} readOnly value={value} onFocus={(e) => e.currentTarget.select()} aria-describedby={hint ? `${id}-h` : undefined}
          className="min-h-[40px] w-full min-w-0 rounded-md border border-bv-border bg-bv-subtle px-3 py-2 font-mono text-sm" />
        <Button variant="secondary" aria-label={`Copiar ${label}`} onClick={async () => { (await copyText(value)) ? toast.success(`${label} copiado.`) : toast.error('Não foi possível copiar. Selecione o texto e use Ctrl+C.'); }}>Copiar</Button>
      </div>
      {hint && <p id={`${id}-h`} className="text-xs text-bv-muted">{hint}</p>}
    </div>
  );
}

/** Campo de segredo: em branco = manter o valor já salvo (a API nunca devolve o segredo). */
export function SecretField({ label, value, onChange, isSet, error, hint, area, required, id }: {
  label: string; value: string; onChange: (v: string) => void; isSet: boolean; error?: string | null; hint?: string; area?: boolean; required?: boolean; id?: string;
}) {
  const h = [isSet ? 'Já configurado — deixe em branco para manter o valor atual.' : 'Ainda não configurado.', hint].filter(Boolean).join(' ');
  return area
    ? <TextArea id={id} label={label} value={value} onChange={(e) => onChange(e.target.value)} placeholder={isSet ? SECRET_MASK : ''} hint={h} error={error} required={required && !isSet} autoComplete="off" spellCheck={false} className="font-mono text-xs" />
    : <TextField id={id} label={label} type="password" value={value} onChange={(e) => onChange(e.target.value)} placeholder={isSet ? SECRET_MASK : ''} hint={h} error={error} required={required && !isSet} autoComplete="new-password" />;
}

export interface TestOutcome { ok: boolean; message: string; details?: Array<{ label: string; ok: boolean; text: string }> }

/** Botão "Testar conexão" + resultado claro (texto + ícone, anunciado a leitores de tela). */
export function TestButton({ run, label = 'Testar conexão', disabled, onDone }: { run: () => Promise<TestOutcome>; label?: string; disabled?: boolean; onDone?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<TestOutcome | null>(null);
  const go = async () => {
    setBusy(true); setOut(null);
    try { setOut(await run()); } catch (e) { setOut({ ok: false, message: errMsg(e, 'Falha ao testar a conexão.') }); }
    finally { setBusy(false); onDone?.(); }
  };
  return (
    <div className="flex flex-col gap-2">
      <div><Button variant="secondary" onClick={() => void go()} loading={busy} disabled={disabled}>{label}</Button></div>
      <div aria-live="polite">
        {out && (
          <div className={`rounded-md border p-3 text-sm ${out.ok ? 'border-bv-success bg-bv-success-soft text-bv-success' : 'border-bv-danger bg-bv-danger-soft text-bv-danger'}`} role={out.ok ? 'status' : 'alert'}>
            <strong>{out.ok ? '✔ Conexão bem-sucedida.' : '✖ A conexão falhou.'}</strong> {out.message}
            {out.details && <ul className="mt-1 list-disc pl-5">{out.details.map((d) => <li key={d.label}>{d.label}: {d.ok ? 'OK' : 'Falha'}{d.text ? ` — ${d.text}` : ''}</li>)}</ul>}
          </div>
        )}
      </div>
    </div>
  );
}

/** POST que devolve o corpo mesmo em respostas de erro sem o envelope padrão (ex.: 502 do teste do tronco SIP). */
export async function postLoose<T = any>(path: string): Promise<{ status: number; body: T | null }> {
  const call = () => fetch(`${API_ORIGIN}/balcao${path}`, { method: 'POST', headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` } });
  let res = await call();
  if (res.status === 401 && (await refreshSession())) res = await call();
  let body: T | null = null;
  try { body = await res.json(); } catch { /* sem corpo */ }
  return { status: res.status, body };
}

interface LogRow { id: string; operation: string; ok: boolean; durationMs: number | null; error: string | null; createdAt: string }

/** Registro das últimas chamadas da integração (operação, duração e código do erro — sem dados pessoais). */
export function LogsPanel({ type }: { type: string }) {
  const [rows, setRows] = useState<LogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(50);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRows((await bv.get<{ logs: LogRow[] }>(`/integrations/${type}/logs`, { limit })).logs); }
    catch (e) { setError(e instanceof BvApiError && e.status === 404 ? 'Registro de chamadas indisponível para este tipo.' : errMsg(e, 'Não foi possível carregar os registros.')); }
    finally { setLoading(false); }
  }, [type, limit]);
  useEffect(() => { void load(); }, [load]);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-bv-muted">Últimas chamadas a esta integração. Os registros guardam apenas a operação, a duração e o <em>código</em> do erro — nunca CPF, número de processo, mensagens ou segredos.</p>
        <Button variant="secondary" size="sm" onClick={() => void load()} loading={loading}>Atualizar</Button>
      </div>
      {error && <Banner tone="warning" title="Indisponível">{error}</Banner>}
      {loading && !rows ? <div className="p-6 text-center"><Spinner /></div> : rows && (
        <>
          <DataTable caption={`Registros de chamadas — ${type}`} rows={rows} rowKey={(r) => r.id} empty="Nenhuma chamada registrada ainda."
            columns={[
              { key: 'd', header: 'Data e hora', render: (r) => fmtDateTime(r.createdAt) },
              { key: 'o', header: 'Operação', render: (r) => r.operation },
              { key: 'r', header: 'Resultado', render: (r) => <Badge tone={r.ok ? 'success' : 'danger'}>{r.ok ? 'Sucesso' : 'Falha'}</Badge> },
              { key: 'ms', header: 'Duração', render: (r) => r.durationMs == null ? '—' : `${r.durationMs} ms`, className: 'text-right' },
              { key: 'e', header: 'Erro (código)', render: (r) => r.error ?? '—' },
            ]} />
          {rows.length >= limit && limit < 200 && <div className="text-center"><Button variant="secondary" size="sm" onClick={() => setLimit(200)}>Mostrar até 200 registros</Button></div>}
        </>
      )}
    </div>
  );
}

/** Gera um token hexadecimal aleatório (verify token do WhatsApp etc.). */
export function randomHex(bytes = 16): string {
  const a = new Uint8Array(bytes); crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const isHttpUrl = (s: string) => { try { const u = new URL(s); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; } };
