'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { bv, errMsg } from '@/lib/balcao/api';
import { fmtNumber } from '@/lib/balcao/format';
import { Badge, Banner, Button, Card, Checkbox, Select, Spinner, TextArea, TextField, useToast } from '../../../_ui/ui';

interface AiConfig {
  enabled: boolean; mode: 'ASSISTED' | 'PROGRESSIVE'; confidenceThreshold: number; welcomeMessage: string; escalationKeywords: string[];
  maxBotTurns: number; agentAssist: boolean; idleCloseMinutes: number; handoffMessage: string;
}
interface TestResult {
  dryRun: true; mode: 'ASSISTED' | 'PROGRESSIVE'; action: 'REPLY' | 'ESCALATE' | 'RESOLVE' | 'WELCOME' | 'TOOL' | 'AUTH_REQUIRED'; reason: string | null; answer: string | null;
  confidence: number | null; intent: string | null; category: string | null; automatable: boolean | null;
  articles: Array<{ id: string; title: string; rank: number }>; usedArticleIds: string[]; tool: { name: string; minIdentityLevel: string | null } | null;
  model: string | null; tokens: { in: number; out?: number } | null; piiRedacted: number; retrieved: number;
}

const ACTION_LABEL: Record<TestResult['action'], string> = {
  REPLY: 'O assistente responderia ao cidadão', ESCALATE: 'O assistente encaminharia para um atendente humano', RESOLVE: 'O assistente encerraria como resolvido',
  WELCOME: 'O assistente enviaria só a mensagem de boas-vindas', TOOL: 'O assistente executaria uma ferramenta', AUTH_REQUIRED: 'O assistente pediria login GOV.BR antes de continuar',
};
const REASON_LABEL: Record<string, string> = {
  HUMAN_REQUEST: 'o cidadão pediu atendente', KEYWORD: 'palavra de escalonamento', NEGATIVE_SENTIMENT: 'sentimento negativo', NOT_RESOLVED: 'o cidadão disse que não resolveu', MAX_TURNS: 'limite de turnos',
  LOW_CONFIDENCE: 'confiança abaixo do limiar', NO_ARTICLE: 'nenhum artigo aprovado cobre a pergunta', LLM_NEEDS_HUMAN: 'a IA indicou atendimento humano', LLM_INVALID: 'resposta inválida da IA',
  LLM_ERROR: 'erro no serviço de IA', QUOTA: 'cota esgotada', NON_TEXT: 'mensagem não textual', TOOL_ERROR: 'erro em ferramenta', TOOL_UNKNOWN: 'ferramenta desconhecida',
  ASSISTED_TRIAGE: 'modo assistido: o atendente conduz', BOT_STALLED: 'assistente sem resposta',
};

export function Assistant() {
  const toast = useToast();
  const [cfg, setCfg] = useState<AiConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try { setCfg(await bv.get<AiConfig>('/ai/config')); } catch (e) { setError(errMsg(e, 'Não foi possível carregar a configuração do assistente.')); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (error) return <Banner tone="danger" title="Erro">{error} <Button size="sm" variant="secondary" onClick={() => void load()}>Tentar de novo</Button></Banner>;
  if (!cfg) return <div className="p-6 text-center"><Spinner /></div>;
  return (
    <div className="flex flex-col gap-4">
      <Phases />
      <ConfigForm cfg={cfg} onSaved={(c) => { setCfg(c); toast.success('Configuração do assistente salva.'); }} />
      <BotTester cfg={cfg} />
    </div>
  );
}

function Phases() {
  return (
    <Card title="Metodologia de implantação em 3 fases">
      <ol className="flex flex-col gap-3 text-sm">
        <li><strong>Fase 1 — Assistida.</strong> O assistente <em>sugere</em> a resposta ao atendente, que revisa e envia. Nenhuma resposta automática chega ao cidadão. É a fase para validar a base e medir acertos (modo <strong>Assistido</strong>).</li>
        <li><strong>Fase 2 — Progressiva.</strong> O assistente responde sozinho quando a confiança é igual ou maior que o limiar e há artigo aprovado; nos demais casos, escala para um atendente (modo <strong>Progressivo</strong>).</li>
        <li><strong>Fase 3 — Melhoria contínua.</strong> A curadoria transforma lacunas e ambiguidades em artigos aprovados, aumentando a contenção e o indicador IQA 07 (metas 40% → 60% → 80%). Ajuste limiar, turnos e palavras de escalonamento conforme os indicadores.</li>
      </ol>
    </Card>
  );
}

function ConfigForm({ cfg, onSaved }: { cfg: AiConfig; onSaved: (c: AiConfig) => void }) {
  const [enabled, setEnabled] = useState(cfg.enabled);
  const [mode, setMode] = useState(cfg.mode);
  const [threshold, setThreshold] = useState(String(Math.round(cfg.confidenceThreshold * 100)));
  const [welcome, setWelcome] = useState(cfg.welcomeMessage);
  const [keywords, setKeywords] = useState(cfg.escalationKeywords.join('\n'));
  const [turns, setTurns] = useState(String(cfg.maxBotTurns));
  const [assist, setAssist] = useState(cfg.agentAssist);
  const [idle, setIdle] = useState(String(cfg.idleCloseMinutes));
  const [handoff, setHandoff] = useState(cfg.handoffMessage);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [formErr, setFormErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setFormErr(null);
    const er: Record<string, string> = {};
    const th = Number(threshold), mt = Number(turns), im = Number(idle);
    if (threshold.trim() === '' || !isFinite(th) || th < 0 || th > 100) er.threshold = 'Informe um valor entre 0 e 100.';
    if (!Number.isInteger(mt) || mt < 1 || mt > 30) er.turns = 'Informe um número inteiro entre 1 e 30.';
    if (!Number.isInteger(im) || im < 1 || im > 1440) er.idle = 'Informe um número inteiro de minutos entre 1 e 1440.';
    const kws = Array.from(new Set(keywords.split(/[\n,;]/).map((k) => k.trim()).filter(Boolean)));
    if (kws.length > 50) er.keywords = 'No máximo 50 palavras.';
    if (kws.some((k) => k.length > 60)) er.keywords = 'Cada palavra pode ter no máximo 60 caracteres.';
    setErrs(er);
    if (Object.keys(er).length) return;
    setBusy(true);
    try {
      const r = await bv.put<AiConfig>('/ai/config', {
        enabled, mode, confidenceThreshold: Math.round(th) / 100, welcomeMessage: welcome, escalationKeywords: kws, maxBotTurns: mt, agentAssist: assist, idleCloseMinutes: im, handoffMessage: handoff,
      });
      onSaved(r);
    } catch (er2) { setFormErr(errMsg(er2)); } finally { setBusy(false); }
  };

  return (
    <Card title="Configuração do assistente virtual">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Checkbox label="Assistente virtual ativado" hint="Desativado, toda conversa nova vai direto para a fila de atendentes." checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />

        <fieldset className="rounded-md border border-bv-border p-3">
          <legend className="px-1 text-sm font-medium">Modo de operação</legend>
          {([
            ['ASSISTED', 'Assistido (fase 1)', 'A IA apenas sugere resposta ao atendente. O cidadão nunca recebe resposta automática.'],
            ['PROGRESSIVE', 'Progressivo (fase 2)', 'A IA responde sozinha quando a confiança atinge o limiar; se não, escala para atendente.'],
          ] as const).map(([v, t, d]) => (
            <div key={v} className="flex items-start gap-2 py-1">
              <input id={`mode-${v}`} type="radio" name="ai-mode" className="mt-1 h-5 w-5 accent-[rgb(var(--bv-primary))]" checked={mode === v} onChange={() => setMode(v)} aria-describedby={`mode-${v}-d`} />
              <label htmlFor={`mode-${v}`} className="text-sm"><span className="font-medium">{t}</span><span id={`mode-${v}-d`} className="block text-xs text-bv-muted">{d}</span></label>
            </div>
          ))}
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-3">
          <TextField label="Limiar de confiança (%)" type="number" min={0} max={100} step={1} value={threshold} onChange={(e) => setThreshold(e.target.value)} error={errs.threshold}
            hint="No modo progressivo, abaixo disso o assistente escala para humano." />
          <TextField label="Máximo de turnos do assistente" type="number" min={1} max={30} value={turns} onChange={(e) => setTurns(e.target.value)} error={errs.turns} hint="Após esse número de respostas, escala para humano." />
          <TextField label="Encerrar por inatividade (min)" type="number" min={1} max={1440} value={idle} onChange={(e) => setIdle(e.target.value)} error={errs.idle} />
        </div>

        <TextArea label="Mensagem de boas-vindas" maxLength={1000} value={welcome} onChange={(e) => setWelcome(e.target.value)} hint="Enviada no início da conversa. Informe que é um assistente virtual." />
        <TextArea label="Mensagem ao transferir para atendente" maxLength={500} value={handoff} onChange={(e) => setHandoff(e.target.value)} />
        <TextArea label="Palavras de escalonamento" value={keywords} onChange={(e) => setKeywords(e.target.value)} error={errs.keywords}
          hint="Uma por linha (ou separadas por vírgula). Se o cidadão escrever alguma delas, a conversa vai para um atendente. Máximo 50." />
        <Checkbox label="Assistência ao atendente (sugerir resposta e resumo na conversa)" checked={assist} onChange={(e) => setAssist(e.target.checked)} />

        {formErr && <Banner tone="danger">{formErr}</Banner>}
        <div><Button type="submit" loading={busy}>Salvar configuração</Button></div>
      </form>
    </Card>
  );
}

interface Turn { role: 'user' | 'assistant'; text: string }

function BotTester({ cfg }: { cfg: AiConfig }) {
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState('');
  const [level, setLevel] = useState('');
  const [history, setHistory] = useState<Turn[]>([]);
  const [res, setRes] = useState<TestResult | null>(null);
  const [asked, setAsked] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);

  const run = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!message.trim()) { setErr('Digite a mensagem do cidadão para testar.'); return; }
    setBusy(true);
    try {
      const r = await bv.post<TestResult>('/ai/test', { message: message.trim(), ...(mode ? { mode } : {}), ...(level ? { identityLevel: level } : {}), ...(history.length ? { history: history.slice(-10) } : {}) });
      setRes(r); setAsked(message.trim());
      setHistory((h) => [...h, { role: 'user' as const, text: message.trim() }, ...(r.answer ? [{ role: 'assistant' as const, text: r.answer.slice(0, 2000) }] : [])].slice(-10));
      setMessage('');
    } catch (er) { setErr(errMsg(er)); } finally { setBusy(false); }
  };

  const threshold = cfg.confidenceThreshold;
  return (
    <Card title="Testar o assistente (modo seco)">
      <p className="mb-3 text-sm text-bv-muted">Simula uma pergunta de cidadão usando a base aprovada. <strong>Nada é enviado, escalado ou gravado em conversas.</strong> Use mensagens fictícias, sem dados pessoais reais.</p>
      <form onSubmit={run} className="flex flex-col gap-3" noValidate>
        <TextArea label="Mensagem do cidadão" required value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} placeholder="Ex.: Como faço para pedir uma certidão de objeto e pé?" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Modo do teste" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="">Usar o modo configurado ({cfg.mode === 'ASSISTED' ? 'Assistido' : 'Progressivo'})</option>
            <option value="ASSISTED">Assistido</option><option value="PROGRESSIVE">Progressivo</option>
          </Select>
          <Select label="Identidade verificada do cidadão" value={level} onChange={(e) => setLevel(e.target.value)} hint="Algumas ferramentas (ex.: consulta processual) exigem nível ouro no GOV.BR.">
            <option value="">Não verificada</option><option value="bronze">GOV.BR bronze</option><option value="prata">GOV.BR prata</option><option value="ouro">GOV.BR ouro</option>
          </Select>
        </div>
        {history.length > 0 && <p className="text-xs text-bv-muted">A conversa de teste tem {history.length} mensagens de contexto. <button type="button" className="underline" onClick={() => { setHistory([]); setRes(null); }}>Limpar conversa de teste</button></p>}
        {err && <Banner tone="danger">{err}</Banner>}
        <div><Button type="submit" loading={busy}>Testar</Button></div>
      </form>

      <div aria-live="polite" className="mt-4">
        {res && (
          <section aria-label="Resultado do teste" className="flex flex-col gap-3 rounded-md border border-bv-border p-3">
            <p className="text-sm"><span className="text-bv-muted">Pergunta testada:</span> “{asked}”</p>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={res.action === 'REPLY' || res.action === 'RESOLVE' ? 'success' : res.action === 'ESCALATE' ? 'warning' : 'primary'}>{res.action === 'ESCALATE' ? 'Escalaria' : res.action === 'REPLY' ? 'Responderia' : res.action}</Badge>
              <span className="font-medium">{ACTION_LABEL[res.action]}</span>
              {res.reason && <span className="text-sm text-bv-muted">— motivo: {REASON_LABEL[res.reason] ?? res.reason}</span>}
            </div>
            {res.answer ? (
              <div>
                <h4 className="text-sm font-semibold">{res.mode === 'ASSISTED' ? 'Sugestão ao atendente (não enviada ao cidadão)' : 'Resposta do assistente'}</h4>
                <div className="mt-1 whitespace-pre-wrap rounded-md border border-bv-border bg-bv-subtle p-3 text-sm">{res.answer}</div>
              </div>
            ) : <p className="text-sm text-bv-muted">Sem texto de resposta nesta decisão.</p>}
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <div className="flex gap-1"><dt className="text-bv-muted">Confiança:</dt><dd>{res.confidence == null ? '—' : `${Math.round(res.confidence * 100)}%`}{res.confidence != null && ` (${res.confidence >= threshold ? 'acima' : 'abaixo'} do limiar de ${Math.round(threshold * 100)}%)`}</dd></div>
              <div className="flex gap-1"><dt className="text-bv-muted">Modo:</dt><dd>{res.mode === 'ASSISTED' ? 'Assistido' : 'Progressivo'}</dd></div>
              <div className="flex gap-1"><dt className="text-bv-muted">Intenção:</dt><dd>{res.intent ?? '—'}</dd></div>
              <div className="flex gap-1"><dt className="text-bv-muted">Categoria:</dt><dd>{res.category ?? '—'}</dd></div>
              <div className="flex gap-1"><dt className="text-bv-muted">Automatizável:</dt><dd>{res.automatable == null ? '—' : res.automatable ? 'Sim' : 'Não'}</dd></div>
              <div className="flex gap-1"><dt className="text-bv-muted">Artigos recuperados:</dt><dd>{res.retrieved}</dd></div>
              {res.tool && <div className="flex gap-1"><dt className="text-bv-muted">Ferramenta:</dt><dd>{res.tool.name}{res.tool.minIdentityLevel ? ` (exige nível ${res.tool.minIdentityLevel})` : ''}</dd></div>}
              {res.model && <div className="flex gap-1"><dt className="text-bv-muted">Modelo:</dt><dd>{res.model}</dd></div>}
              {res.tokens && <div className="flex gap-1"><dt className="text-bv-muted">Tokens:</dt><dd>{fmtNumber(res.tokens.in)} entrada · {fmtNumber(res.tokens.out ?? 0)} saída</dd></div>}
              <div className="flex gap-1"><dt className="text-bv-muted">Dados pessoais ocultados:</dt><dd>{res.piiRedacted}</dd></div>
            </dl>
            <div>
              <h4 className="text-sm font-semibold">Artigos considerados</h4>
              {res.articles.length === 0 ? <p className="text-sm text-bv-muted">Nenhum artigo aprovado encontrado para esta pergunta (lacuna da base).</p> : (
                <ul className="mt-1 flex flex-col gap-1 text-sm">
                  {res.articles.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center gap-2">
                      <span>{a.title}</span>
                      {res.usedArticleIds.includes(a.id) ? <Badge tone="success">Usado na resposta</Badge> : <Badge>Consultado</Badge>}
                      <span className="text-xs text-bv-muted">relevância {fmtNumber(a.rank, 2)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}
      </div>
    </Card>
  );
}
