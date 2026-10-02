'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

/**
 * Templates de mensagem dentro do app (item 4 do escopo ZapScript × Twilio),
 * com header de mídia (item 8).
 *
 * O que isto resolve: antes, criar um template exigia sair do ZapScript, achar o
 * Business Manager da Meta e voltar — e um template reprovado não dizia o motivo
 * em lugar nenhum nosso. Aqui dá para criar, acompanhar a análise e ler a
 * rejeição.
 */

interface Template {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  headerFormat: string;
  requiresHeaderMedia: boolean;
  bodyVariableCount: number;
  bodyText: string | null;
  footerText: string | null;
  rejectedReason: string | null;
}

const STATUS_COLOR: Record<string, string> = {
  APPROVED: '#34d399',
  PENDING:  '#fbbf24',
  REJECTED: '#f87171',
  PAUSED:   '#fb923c',
  DISABLED: '#f87171',
};

const STATUS_LABEL: Record<string, string> = {
  APPROVED: 'Aprovado',
  PENDING:  'Em análise',
  REJECTED: 'Reprovado',
  PAUSED:   'Pausado',
  DISABLED: 'Desabilitado',
};

/** Extensões que a Meta aceita como exemplo de header, por formato. */
const ACCEPT_POR_FORMATO: Record<string, string> = {
  IMAGE:    'image/jpeg,image/png',
  VIDEO:    'video/mp4,video/3gpp',
  DOCUMENT: 'application/pdf',
};

export default function TemplatesPanel() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [semMeta, setSemMeta] = useState(false);

  const [abrirForm, setAbrirForm] = useState(false);
  const [nome, setNome] = useState('');
  const [categoria, setCategoria] = useState<'MARKETING' | 'UTILITY' | 'AUTHENTICATION'>('UTILITY');
  const [corpo, setCorpo] = useState('');
  const [exemplos, setExemplos] = useState<string[]>([]);
  const [rodape, setRodape] = useState('');
  const [headerFormato, setHeaderFormato] = useState<'NONE' | 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT'>('NONE');
  const [headerTexto, setHeaderTexto] = useState('');
  const [headerHandle, setHeaderHandle] = useState<string | null>(null);
  const [subindo, setSubindo] = useState(false);
  const [criando, setCriando] = useState(false);
  const [aviso, setAviso] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // Nº de variáveis {{n}} DISTINTAS no corpo — a Meta exige um exemplo por
  // variável, senão reprova o template (e o motivo chega só por e-mail dela).
  const variaveis = Array.from(new Set((corpo.match(/\{\{\s*\d+\s*\}\}/g) || [])
    .map(v => v.replace(/\D/g, '')))).sort();

  useEffect(() => {
    setExemplos(prev => variaveis.map((_, i) => prev[i] ?? ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variaveis.length]);

  const carregar = useCallback(async () => {
    setErro('');
    try {
      const res = await api.get<{ templates: Template[] }>('/templates');
      setTemplates(res.templates || []);
      setSemMeta(false);
    } catch (err: any) {
      // Conta sem número oficial conectado: não é erro do usuário, é um passo
      // anterior que falta.
      if (/oficial|Meta/i.test(err?.message || '')) setSemMeta(true);
      else setErro(err?.message || 'Não foi possível carregar os templates.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  async function subirMidia(file: File) {
    setSubindo(true);
    setErro('');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await api.postFormData<{ handle: string }>('/templates/media-handle', form);
      setHeaderHandle(res.handle);
    } catch (err: any) {
      setErro(err?.message || 'Não foi possível subir a mídia de exemplo.');
    } finally {
      setSubindo(false);
    }
  }

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    setAviso('');
    setCriando(true);
    try {
      const payload: any = {
        name: nome, category: categoria, language: 'pt_BR',
        body: { text: corpo, ...(exemplos.length ? { example: exemplos } : {}) },
        ...(rodape.trim() ? { footer: { text: rodape.trim() } } : {}),
      };
      if (headerFormato === 'TEXT') {
        payload.header = { format: 'TEXT', text: headerTexto };
      } else if (headerFormato !== 'NONE') {
        payload.header = { format: headerFormato, handle: headerHandle };
      }

      const res = await api.post<{ message: string }>('/templates', payload);
      setAviso(res.message || 'Template enviado para análise.');
      setNome(''); setCorpo(''); setRodape(''); setHeaderTexto('');
      setHeaderFormato('NONE'); setHeaderHandle(null); setExemplos([]);
      setAbrirForm(false);
      carregar();
    } catch (err: any) {
      setErro(err?.message || 'Não foi possível criar o template.');
    } finally {
      setCriando(false);
    }
  }

  async function apagar(name: string) {
    try {
      await api.delete(`/templates/${encodeURIComponent(name)}`);
      carregar();
    } catch (err: any) {
      alert(err?.message || 'Não foi possível apagar o template.');
    }
  }

  const precisaHandle = ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerFormato);
  const podeCriar =
    /^[a-z0-9_]+$/.test(nome) &&
    corpo.trim().length > 0 &&
    exemplos.every(v => v.trim().length > 0) &&
    (headerFormato !== 'TEXT' || headerTexto.trim().length > 0) &&
    (!precisaHandle || !!headerHandle);

  if (loading) return <div className="text-sm" style={{ color: 'rgb(var(--color-text-muted))' }}>Carregando...</div>;

  if (semMeta) {
    return (
      <div className="rounded-xl p-8 text-center"
        style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgb(var(--color-border))' }}>
        <div className="text-3xl mb-2">📋</div>
        <p className="text-sm font-semibold">Nenhum número oficial (Meta) conectado</p>
        <p className="text-xs mt-1 max-w-md mx-auto" style={{ color: 'rgb(var(--color-text-muted))' }}>
          Templates são um recurso da API oficial do WhatsApp. Conecte um número oficial em
          Números para criar e acompanhar templates por aqui.
        </p>
        <a href="/dashboard/numeros" className="inline-block mt-4 btn-primary px-4 py-2 text-sm font-bold">
          Ir para Números
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs" style={{ color: 'rgb(var(--color-text-muted))' }}>
          Todo template passa por análise da Meta. Só <strong>Aprovado</strong> pode ser enviado.
        </p>
        <button onClick={() => setAbrirForm(v => !v)}
          className="btn-primary px-3 py-1.5 text-xs font-bold shrink-0">
          {abrirForm ? 'Cancelar' : '+ Novo template'}
        </button>
      </div>

      {aviso && (
        <div className="text-xs px-3 py-2 rounded-lg"
          style={{ background: 'rgba(52,211,153,.1)', color: '#34d399' }}>{aviso}</div>
      )}
      {erro && (
        <div className="text-xs px-3 py-2 rounded-lg"
          style={{ background: 'rgba(239,68,68,.1)', color: '#f87171' }}>{erro}</div>
      )}

      {abrirForm && (
        <form onSubmit={criar} className="rounded-2xl p-5 space-y-3"
          style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgb(var(--color-border))' }}>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">Nome</label>
              <input className="field-input" value={nome} placeholder="promo_verao"
                onChange={e => setNome(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))} required />
              <p className="text-[10px] mt-1" style={{ color: 'rgb(var(--color-text-muted))' }}>
                A Meta aceita só minúsculas, números e underscore.
              </p>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Categoria</label>
              <select className="field-input" value={categoria} onChange={e => setCategoria(e.target.value as any)}>
                <option value="UTILITY">Utilidade (pedido, entrega, lembrete)</option>
                <option value="MARKETING">Marketing (promoção, novidade)</option>
                <option value="AUTHENTICATION">Autenticação (código de acesso)</option>
              </select>
            </div>
          </div>

          {/* ── Header, incluindo mídia (item 8) ─────────────────────────── */}
          <div>
            <label className="block text-xs font-semibold mb-1">Cabeçalho</label>
            <select className="field-input" value={headerFormato}
              onChange={e => { setHeaderFormato(e.target.value as any); setHeaderHandle(null); }}>
              <option value="NONE">Sem cabeçalho</option>
              <option value="TEXT">Texto</option>
              <option value="IMAGE">Imagem</option>
              <option value="VIDEO">Vídeo</option>
              <option value="DOCUMENT">Documento (PDF)</option>
            </select>

            {headerFormato === 'TEXT' && (
              <input className="field-input mt-2" maxLength={60} placeholder="Ex.: Oferta de verão"
                value={headerTexto} onChange={e => setHeaderTexto(e.target.value)} />
            )}

            {precisaHandle && (
              <div className="mt-2 rounded-xl p-3"
                style={{ background: 'rgba(var(--color-primary)/.05)', border: '1px solid rgba(var(--color-primary)/.15)' }}>
                <p className="text-[11px] mb-2" style={{ color: 'rgb(var(--color-text-secondary))' }}>
                  A Meta exige um <strong>exemplo</strong> da mídia para aprovar o template. A mídia
                  definitiva você informa a cada envio (na campanha ou na API).
                </p>
                <input
                  ref={fileRef}
                  type="file"
                  accept={ACCEPT_POR_FORMATO[headerFormato]}
                  className="text-[11px]"
                  onChange={e => { const f = e.target.files?.[0]; if (f) subirMidia(f); }}
                />
                {subindo && <div className="text-[11px] mt-1" style={{ color: 'rgb(var(--color-text-muted))' }}>Subindo...</div>}
                {headerHandle && (
                  <div className="text-[11px] mt-1" style={{ color: '#34d399' }}>✓ Exemplo enviado à Meta</div>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1">Corpo</label>
            <textarea className="field-input min-h-[90px]" maxLength={1024} required
              placeholder="Olá {{1}}, seu pedido {{2}} está pronto para retirada."
              value={corpo} onChange={e => setCorpo(e.target.value)} />
            <p className="text-[10px] mt-1" style={{ color: 'rgb(var(--color-text-muted))' }}>
              Use <code className="font-mono">{'{{1}}'}</code>, <code className="font-mono">{'{{2}}'}</code>… para
              as partes que mudam a cada contato.
            </p>
          </div>

          {variaveis.length > 0 && (
            <div>
              <label className="block text-xs font-semibold mb-1">
                Exemplos das variáveis (obrigatório para a Meta aprovar)
              </label>
              <div className="grid sm:grid-cols-2 gap-2">
                {variaveis.map((n, i) => (
                  <input key={n} className="field-input text-xs" placeholder={`exemplo de {{${n}}}`}
                    value={exemplos[i] ?? ''}
                    onChange={e => setExemplos(prev => prev.map((v, j) => (j === i ? e.target.value : v)))} />
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold mb-1">Rodapé (opcional)</label>
            <input className="field-input" maxLength={60} placeholder="Responda PARAR para não receber mais"
              value={rodape} onChange={e => setRodape(e.target.value)} />
          </div>

          <button type="submit" disabled={criando || !podeCriar}
            className="btn-primary px-4 py-2 text-sm font-bold disabled:opacity-50">
            {criando ? 'Enviando...' : 'Enviar para análise'}
          </button>
        </form>
      )}

      {/* ── Lista ─────────────────────────────────────────────────────────── */}
      {templates.length === 0 ? (
        <div className="rounded-xl p-8 text-center"
          style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgb(var(--color-border))' }}>
          <div className="text-3xl mb-2">📋</div>
          <p className="text-sm font-semibold">Nenhum template ainda</p>
        </div>
      ) : (
        <div className="space-y-2">
          {templates.map(t => (
            <div key={`${t.id}-${t.language}`} className="rounded-xl p-4"
              style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgb(var(--color-border))' }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm font-bold">{t.name}</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{ background: `${STATUS_COLOR[t.status] ?? '#888'}22`, color: STATUS_COLOR[t.status] ?? '#888' }}>
                      {STATUS_LABEL[t.status] ?? t.status}
                    </span>
                    <span className="text-[10px]" style={{ color: 'rgb(var(--color-text-muted))' }}>
                      {t.language} · {t.category}
                    </span>
                    {t.requiresHeaderMedia && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full"
                        style={{ background: 'rgba(167,139,250,.12)', color: '#a78bfa' }}
                        title="Este template exige a mídia do cabeçalho em cada envio.">
                        header {t.headerFormat.toLowerCase()}
                      </span>
                    )}
                  </div>

                  {t.bodyText && (
                    <p className="text-xs mt-1.5 whitespace-pre-wrap"
                      style={{ color: 'rgb(var(--color-text-secondary))' }}>{t.bodyText}</p>
                  )}
                  {t.footerText && (
                    <p className="text-[11px] mt-1" style={{ color: 'rgb(var(--color-text-muted))' }}>{t.footerText}</p>
                  )}
                  <div className="text-[10px] mt-1" style={{ color: 'rgb(var(--color-text-muted))' }}>
                    {t.bodyVariableCount} variável(is) no corpo
                  </div>

                  {t.rejectedReason && (
                    <div className="text-[11px] mt-2 px-2 py-1 rounded-lg inline-block"
                      style={{ background: 'rgba(248,113,113,.1)', color: '#f87171' }}>
                      Motivo da reprovação: {t.rejectedReason}
                    </div>
                  )}
                </div>

                <button onClick={() => apagar(t.name)}
                  className="text-[11px] font-medium px-2.5 py-1 rounded-lg shrink-0 hover:bg-red-500/10"
                  style={{ color: 'rgb(var(--color-text-muted))' }}>
                  Apagar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
