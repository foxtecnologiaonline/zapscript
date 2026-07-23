'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import ModuleCheckout from '@/components/ModuleCheckout';

interface Cliente {
  id: string; nome: string; telefone: string;
  documento: string | null; email: string | null; notas: string | null;
  createdAt: string;
}
type CobrancaStatus = 'pendente' | 'paga' | 'cancelada';
type DisplayStatus = 'pendente' | 'vence_hoje' | 'vencida' | 'paga' | 'cancelada';
interface CobrancaItem {
  id: string; clienteId: string; descricao: string; valor: number;
  vencimento: string; status: CobrancaStatus; pagoEm: string | null;
  displayStatus: DisplayStatus; createdAt: string;
  cliente: { id: string; nome: string; telefone: string };
}
interface Me {
  id: string; name?: string; email: string; emailVerified: boolean;
  document: string | null; modules?: string[];
}
type CobrancaTom = 'cordial' | 'formal' | 'direto';
interface CobrancaConfig {
  userId: string; tom: CobrancaTom; escalarTom: boolean;
  diasAntes: number[]; diasDepois: number[];
  pixKey: string | null; pixKeyType: string | null;
  resumoDiario: boolean; resumoHora: number; onboardingDone: boolean;
}

// ── Spinner inline ────────────────────────────────────────────────────────────
function Spinner({ size = 4 }: { size?: number }) {
  return (
    <svg className={`animate-spin h-${size} w-${size}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
    </svg>
  );
}

function formatBRL(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function formatDateBR(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}
function formatPhoneDisplay(tel: string) {
  const d = tel.replace(/\D/g, '');
  const local = d.startsWith('55') && d.length > 11 ? d.slice(2) : d;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return tel;
}
function todayISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

const STATUS_META: Record<DisplayStatus, { label: string; cls: string }> = {
  pendente:   { label: 'A vencer',   cls: 'text-blue-400 bg-blue-400/10 border-blue-400/20' },
  vence_hoje: { label: 'Vence hoje', cls: 'text-amber-500 bg-amber-400/10 border-amber-400/20' },
  vencida:    { label: 'Vencida',    cls: 'text-red-400 bg-red-400/10 border-red-400/20' },
  paga:       { label: 'Paga',       cls: 'text-green-500 bg-green-400/10 border-green-400/20' },
  cancelada:  { label: 'Cancelada',  cls: 'text-brand-muted bg-brand-elevated border-brand-border' },
};

const FILTERS: { key: 'todas' | DisplayStatus; label: string }[] = [
  { key: 'todas',      label: 'Todas' },
  { key: 'vence_hoje', label: 'Vence hoje' },
  { key: 'vencida',    label: 'Vencidas' },
  { key: 'pendente',   label: 'A vencer' },
  { key: 'paga',       label: 'Pagas' },
];

const MODULE_FEATURES = [
  'Cadastre clientes e cobranças em segundos',
  'Lembrete automático no WhatsApp no dia do vencimento',
  'Aviso automático no 1º dia de atraso',
  'Reenvio manual com 1 clique quando quiser',
];

const TOM_META: Record<CobrancaTom, { label: string; desc: string }> = {
  cordial: { label: 'Cordial',  desc: 'Amigável, com emoji' },
  formal:  { label: 'Formal',   desc: '"Prezado(a)", sem emoji' },
  direto:  { label: 'Direto',   desc: 'Curto e objetivo' },
};
const ANTES_CANDIDATES  = [1, 2, 3, 5, 7];
const DEPOIS_CANDIDATES = [1, 3, 5, 7, 10, 15, 30];
const PIX_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'cpf',       label: 'CPF' },
  { value: 'cnpj',      label: 'CNPJ' },
  { value: 'email',     label: 'E-mail' },
  { value: 'telefone',  label: 'Telefone' },
  { value: 'aleatoria', label: 'Aleatória' },
];
const RESUMO_HORAS = Array.from({ length: 24 }, (_, h) => h);

function toggleInArray(arr: number[], val: number, max = 5): number[] {
  if (arr.includes(val)) return arr.filter(v => v !== val);
  if (arr.length >= max) return arr;
  return [...arr, val].sort((a, b) => a - b);
}

export default function CobrancaPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [loadingMe, setLoadingMe] = useState(true);
  const [showCheckout, setShowCheckout] = useState(false);

  const [clientes, setClientes]   = useState<Cliente[]>([]);
  const [cobrancas, setCobrancas] = useState<CobrancaItem[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [error, setError] = useState('');

  // form: cliente
  const [showClienteForm, setShowClienteForm] = useState(false);
  const [cNome, setCNome]           = useState('');
  const [cTelefone, setCTelefone]   = useState('');
  const [cDocumento, setCDocumento] = useState('');
  const [cEmail, setCEmail]         = useState('');
  const [addingCliente, setAddingCliente] = useState(false);
  const [clienteError, setClienteError]   = useState('');

  // form: cobrança
  const [showCobrancaForm, setShowCobrancaForm] = useState(false);
  const [bClienteId, setBClienteId]     = useState('');
  const [bDescricao, setBDescricao]     = useState('');
  const [bValor, setBValor]             = useState('');
  const [bVencimento, setBVencimento]   = useState(todayISO());
  const [bRecorrente, setBRecorrente]           = useState(false);
  const [bRecorrenciaMeses, setBRecorrenciaMeses] = useState('1');
  const [addingCobranca, setAddingCobranca] = useState(false);
  const [cobrancaError, setCobrancaError]   = useState('');

  const [filter, setFilter] = useState<'todas' | DisplayStatus>('todas');
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ type: 'cliente' | 'cobranca'; id: string; label: string } | null>(null);

  // config / onboarding / configurações persistentes
  const [config, setConfig] = useState<CobrancaConfig | null>(null);
  const [obStep, setObStep] = useState(1);
  const [showSettings, setShowSettings] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configError, setConfigError] = useState('');
  const [cfgTom, setCfgTom]               = useState<CobrancaTom>('cordial');
  const [cfgEscalarTom, setCfgEscalarTom] = useState(true);
  const [cfgDiasAntes, setCfgDiasAntes]   = useState<number[]>([1]);
  const [cfgDiasDepois, setCfgDiasDepois] = useState<number[]>([1, 3, 7]);
  const [cfgPixKey, setCfgPixKey]         = useState('');
  const [cfgPixKeyType, setCfgPixKeyType] = useState('');
  const [cfgResumoDiario, setCfgResumoDiario] = useState(false);
  const [cfgResumoHora, setCfgResumoHora]     = useState(8);

  const hasModule = !!me?.modules?.includes('cobranca');
  const showOnboarding = !!config && config.onboardingDone === false;

  const loadMe = useCallback(async () => {
    try {
      const u = await api.get<Me>('/auth/me');
      setMe(u);
    } catch { /* 401 já é tratado pelo api client */ }
    finally { setLoadingMe(false); }
  }, []);

  const loadData = useCallback(async () => {
    setDataLoading(true); setError('');
    try {
      const [cls, cbs] = await Promise.all([
        api.get<Cliente[]>('/cobranca/clientes'),
        api.get<CobrancaItem[]>('/cobranca/cobrancas'),
      ]);
      setClientes(cls ?? []);
      setCobrancas(cbs ?? []);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar seus dados.');
    } finally {
      setDataLoading(false);
    }
  }, []);

  const applyConfigToForm = useCallback((cfg: CobrancaConfig) => {
    setCfgTom(cfg.tom);
    setCfgEscalarTom(cfg.escalarTom);
    setCfgDiasAntes(cfg.diasAntes);
    setCfgDiasDepois(cfg.diasDepois);
    setCfgPixKey(cfg.pixKey || '');
    setCfgPixKeyType(cfg.pixKeyType || '');
    setCfgResumoDiario(cfg.resumoDiario);
    setCfgResumoHora(cfg.resumoHora);
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const cfg = await api.get<CobrancaConfig>('/cobranca/config');
      setConfig(cfg);
      applyConfigToForm(cfg);
    } catch { /* mantém defaults locais; onboarding some ao recarregar */ }
  }, [applyConfigToForm]);

  async function saveConfig(overrides: Partial<CobrancaConfig> = {}) {
    setSavingConfig(true); setConfigError('');
    try {
      const updated = await api.put<CobrancaConfig>('/cobranca/config', {
        tom: cfgTom,
        escalarTom: cfgEscalarTom,
        diasAntes: cfgDiasAntes,
        diasDepois: cfgDiasDepois,
        pixKey: cfgPixKey,
        pixKeyType: cfgPixKeyType,
        resumoDiario: cfgResumoDiario,
        resumoHora: cfgResumoHora,
        ...overrides,
      });
      setConfig(updated);
      return updated;
    } catch (err: any) {
      setConfigError(err.message || 'Erro ao salvar configurações.');
      throw err;
    } finally {
      setSavingConfig(false);
    }
  }

  function openSettings() {
    if (config) applyConfigToForm(config);
    setConfigError('');
    setShowSettings(true);
  }

  async function handleFinishOnboarding() {
    try { await saveConfig({ onboardingDone: true }); } catch { /* erro exibido no wizard */ }
  }

  async function handleSaveSettings() {
    try {
      await saveConfig();
      setShowSettings(false);
    } catch { /* erro exibido no painel */ }
  }

  useEffect(() => { loadMe(); }, [loadMe]);
  useEffect(() => { if (hasModule) { loadData(); loadConfig(); } }, [hasModule, loadData, loadConfig]);

  async function handleAddCliente(e: React.FormEvent) {
    e.preventDefault();
    setAddingCliente(true); setClienteError('');
    try {
      const cliente = await api.post<Cliente>('/cobranca/clientes', {
        nome: cNome.trim(),
        telefone: cTelefone.replace(/\D/g, ''),
        documento: cDocumento.trim() || undefined,
        email: cEmail.trim() || undefined,
      });
      setClientes(cs => [...cs, cliente].sort((a, b) => a.nome.localeCompare(b.nome)));
      setCNome(''); setCTelefone(''); setCDocumento(''); setCEmail('');
      setShowClienteForm(false);
    } catch (err: any) {
      setClienteError(err.message || 'Erro ao cadastrar cliente.');
    } finally {
      setAddingCliente(false);
    }
  }

  async function handleDeleteCliente(id: string) {
    try {
      await api.delete(`/cobranca/clientes/${id}`);
      setClientes(cs => cs.filter(c => c.id !== id));
      setCobrancas(bs => bs.filter(b => b.clienteId !== id));
    } catch (err: any) {
      setError(err.message || 'Erro ao remover cliente.');
    } finally {
      setConfirmDelete(null);
    }
  }

  async function handleAddCobranca(e: React.FormEvent) {
    e.preventDefault();
    setAddingCobranca(true); setCobrancaError('');
    try {
      const valorNum = Number(bValor.replace(/\./g, '').replace(',', '.'));
      await api.post('/cobranca/cobrancas', {
        clienteId: bClienteId,
        descricao: bDescricao.trim(),
        valor: valorNum,
        vencimento: bVencimento,
        recorrente: bRecorrente,
        recorrenciaMeses: bRecorrente ? Number(bRecorrenciaMeses) : undefined,
      });
      setBDescricao(''); setBValor(''); setBVencimento(todayISO());
      setBRecorrente(false); setBRecorrenciaMeses('1');
      setShowCobrancaForm(false);
      loadData();
    } catch (err: any) {
      setCobrancaError(err.message || 'Erro ao cadastrar cobrança.');
    } finally {
      setAddingCobranca(false);
    }
  }

  async function handleMarkPaid(id: string) {
    setActioningId(id); setError('');
    try {
      await api.patch(`/cobranca/cobrancas/${id}`, { status: 'paga' });
      loadData();
    } catch (err: any) {
      setError(err.message || 'Erro ao atualizar cobrança.');
    } finally {
      setActioningId(null);
    }
  }

  async function handleCancel(id: string) {
    setActioningId(id); setError('');
    try {
      await api.patch(`/cobranca/cobrancas/${id}`, { status: 'cancelada' });
      loadData();
    } catch (err: any) {
      setError(err.message || 'Erro ao cancelar cobrança.');
    } finally {
      setActioningId(null);
    }
  }

  async function handleResend(id: string) {
    setActioningId(id); setError('');
    try {
      await api.post(`/cobranca/cobrancas/${id}/reenviar`, {});
    } catch (err: any) {
      setError(err.message || 'Erro ao reenviar lembrete.');
    } finally {
      setActioningId(null);
    }
  }

  async function handleDeleteCobranca(id: string) {
    try {
      await api.delete(`/cobranca/cobrancas/${id}`);
      setCobrancas(bs => bs.filter(b => b.id !== id));
    } catch (err: any) {
      setError(err.message || 'Erro ao remover cobrança.');
    } finally {
      setConfirmDelete(null);
    }
  }

  // ── Loading inicial ──
  if (loadingMe) {
    return (
      <div className="p-4 sm:p-6 max-w-4xl flex items-center justify-center py-24 gap-2 text-brand-muted text-sm">
        <Spinner size={4} /> Carregando...
      </div>
    );
  }

  // ── Não assinante: upsell + checkout ──
  if (!hasModule) {
    return (
      <div className="p-4 sm:p-6 max-w-2xl">
        <Link href="/app" className="text-xs font-semibold text-brand-muted hover:text-brand-text transition-colors">
          ← Módulos
        </Link>
        <div className="card p-6 sm:p-8 text-center mt-3">
          <div className="text-4xl mb-3">💰</div>
          <h1 className="text-xl sm:text-2xl font-bold text-brand-text">ZapScript Cobrança</h1>
          <p className="text-sm text-brand-text-secondary mt-2 leading-relaxed">
            Sou MEI e não tenho tempo de cobrar quem venceu ou vence hoje — pare de perder receita por inadimplência.
          </p>
          <div className="mt-6 space-y-2.5 text-left max-w-sm mx-auto">
            {MODULE_FEATURES.map((f, i) => (
              <div key={i} className="flex items-start gap-2.5 text-sm text-brand-text-secondary">
                <span className="text-brand-primary mt-0.5 flex-shrink-0">✓</span>
                {f}
              </div>
            ))}
          </div>
          <div className="mt-7 flex flex-col items-center gap-1">
            <div className="text-2xl font-bold text-brand-text">R$29,90<span className="text-sm font-normal text-brand-muted">/mês</span></div>
            <button onClick={() => setShowCheckout(true)} className="btn-primary px-8 py-3 mt-3">
              Contratar agora
            </button>
            <p className="text-[11px] text-brand-muted mt-2">Cancele quando quiser, sem multa</p>
          </div>
        </div>

        {showCheckout && me && (
          <ModuleCheckout
            moduleKey="cobranca"
            moduleLabel="ZapScript Cobrança"
            moduleIcon="💰"
            priceLabel="R$29,90/mês"
            features={['Lembrete automático', 'Reenvio manual', 'Sem contrato']}
            user={{ email: me.email, emailVerified: me.emailVerified, document: me.document }}
            onDocumentSaved={doc => setMe(m => m ? { ...m, document: doc } : m)}
            onSuccess={() => { setShowCheckout(false); loadMe(); }}
            onClose={() => setShowCheckout(false)}
          />
        )}
      </div>
    );
  }

  const filteredCobrancas = cobrancas.filter(c => filter === 'todas' || c.displayStatus === filter);
  const aReceber   = cobrancas.filter(c => c.status === 'pendente').reduce((s, c) => s + c.valor, 0);
  const vencidas   = cobrancas.filter(c => c.displayStatus === 'vencida').length;
  const recebidoMes = cobrancas.filter(c => {
    if (c.status !== 'paga' || !c.pagoEm) return false;
    const p = new Date(c.pagoEm), now = new Date();
    return p.getUTCFullYear() === now.getFullYear() && p.getUTCMonth() === now.getMonth();
  }).reduce((s, c) => s + c.valor, 0);

  return (
    <div className="p-4 sm:p-6 max-w-4xl">
      <Link href="/app" className="text-xs font-semibold text-brand-muted hover:text-brand-text transition-colors">
        ← Módulos
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-5 mt-3 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-brand-text">💰 Cobrança</h1>
          <p className="text-sm text-brand-text-secondary font-light mt-0.5">
            Clientes e cobranças com lembrete automático via WhatsApp
          </p>
        </div>
        <button
          onClick={openSettings}
          className="text-xs font-semibold text-brand-muted hover:text-brand-text border border-brand-border rounded-lg px-3 py-1.5 flex items-center gap-1.5 flex-shrink-0"
        >
          ⚙️ Configurações
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="card p-3 sm:p-4">
          <div className="text-[11px] text-brand-muted font-semibold uppercase tracking-wide">A receber</div>
          <div className="text-base sm:text-lg font-bold text-brand-text mt-0.5">{formatBRL(aReceber)}</div>
        </div>
        <div className="card p-3 sm:p-4">
          <div className="text-[11px] text-brand-muted font-semibold uppercase tracking-wide">Vencidas</div>
          <div className={`text-base sm:text-lg font-bold mt-0.5 ${vencidas > 0 ? 'text-red-400' : 'text-brand-text'}`}>{vencidas}</div>
        </div>
        <div className="card p-3 sm:p-4">
          <div className="text-[11px] text-brand-muted font-semibold uppercase tracking-wide">Recebido no mês</div>
          <div className="text-base sm:text-lg font-bold text-green-500 mt-0.5">{formatBRL(recebidoMes)}</div>
        </div>
      </div>

      {error && (
        <p className="text-red-400 text-xs mb-4 bg-red-400/10 px-3 py-2 rounded-lg">{error}</p>
      )}

      {/* ── Clientes ── */}
      <div className="card p-4 sm:p-5 mb-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-bold text-brand-text">Clientes ({clientes.length})</p>
          <button onClick={() => setShowClienteForm(s => !s)} className="text-xs font-semibold text-brand-primary hover:underline">
            {showClienteForm ? 'Cancelar' : '+ Novo cliente'}
          </button>
        </div>

        {showClienteForm && (
          <form onSubmit={handleAddCliente} className="space-y-2 mb-4 bg-brand-elevated rounded-xl p-3">
            <div className="grid sm:grid-cols-2 gap-2">
              <input className="field-input" placeholder="Nome" value={cNome}
                onChange={e => setCNome(e.target.value)} maxLength={100} required />
              <div className="flex rounded-lg border border-brand-border bg-brand-surface overflow-hidden focus-within:border-brand-primary transition-colors">
                <span className="flex items-center px-2.5 text-xs font-mono text-brand-muted bg-brand-border/30 border-r border-brand-border select-none">+55</span>
                <input
                  className="flex-1 bg-transparent px-2.5 py-2 text-sm text-brand-text placeholder:text-brand-muted outline-none min-w-0"
                  placeholder="(DDD) 9 8765-4321"
                  value={cTelefone}
                  onChange={e => setCTelefone(e.target.value.replace(/\D/g, '').slice(0, 11))}
                  inputMode="numeric" required
                />
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              <input className="field-input" placeholder="CPF/CNPJ (opcional)" value={cDocumento}
                onChange={e => setCDocumento(e.target.value)} maxLength={20} />
              <input className="field-input" placeholder="E-mail (opcional)" type="email" value={cEmail}
                onChange={e => setCEmail(e.target.value)} maxLength={150} />
            </div>
            {clienteError && <p className="text-red-400 text-xs">{clienteError}</p>}
            <button type="submit" disabled={addingCliente} className="btn-primary text-sm px-4 py-2">
              {addingCliente ? <Spinner size={4} /> : 'Salvar cliente'}
            </button>
          </form>
        )}

        {dataLoading ? (
          <div className="flex items-center justify-center py-6 gap-2 text-brand-muted text-sm">
            <Spinner size={4} /> Carregando...
          </div>
        ) : clientes.length === 0 ? (
          <p className="text-sm text-brand-muted py-2">Nenhum cliente cadastrado ainda.</p>
        ) : (
          <div className="space-y-1.5">
            {clientes.map(c => (
              <div key={c.id} className="flex items-center justify-between gap-3 py-2 px-3 rounded-lg hover:bg-brand-elevated transition-colors">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-brand-text truncate">{c.nome}</div>
                  <div className="text-xs text-brand-muted">{formatPhoneDisplay(c.telefone)}{c.email ? ` · ${c.email}` : ''}</div>
                </div>
                <button
                  onClick={() => setConfirmDelete({ type: 'cliente', id: c.id, label: c.nome })}
                  className="text-xs text-red-400 hover:text-red-300 flex-shrink-0"
                >
                  Remover
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Cobranças ── */}
      <div className="card p-4 sm:p-5 mb-5">
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <p className="text-sm font-bold text-brand-text">Cobranças</p>
          <button
            onClick={() => setShowCobrancaForm(s => !s)}
            disabled={clientes.length === 0}
            className="text-xs font-semibold text-brand-primary hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {showCobrancaForm ? 'Cancelar' : '+ Nova cobrança'}
          </button>
        </div>

        {clientes.length === 0 && (
          <p className="text-xs text-brand-muted mb-3">Cadastre um cliente primeiro para lançar uma cobrança.</p>
        )}

        {showCobrancaForm && (
          <form onSubmit={handleAddCobranca} className="space-y-2 mb-4 bg-brand-elevated rounded-xl p-3">
            <select
              className="field-input" value={bClienteId}
              onChange={e => setBClienteId(e.target.value)} required
            >
              <option value="">Selecione o cliente...</option>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
            <input className="field-input" placeholder="Descrição (ex: Mensalidade de julho)" value={bDescricao}
              onChange={e => setBDescricao(e.target.value)} maxLength={200} required />
            <div className="grid grid-cols-2 gap-2">
              <input className="field-input" placeholder="Valor (R$)" inputMode="decimal" value={bValor}
                onChange={e => setBValor(e.target.value.replace(/[^\d,.]/g, ''))} required />
              <input className="field-input" type="date" value={bVencimento}
                onChange={e => setBVencimento(e.target.value)} required />
            </div>
            <label className="flex items-center gap-2 text-xs text-brand-text-secondary">
              <input type="checkbox" checked={bRecorrente} onChange={e => setBRecorrente(e.target.checked)} />
              Cobrança recorrente (gera a próxima automaticamente ao marcar como paga)
            </label>
            {bRecorrente && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-brand-muted">Repetir a cada</span>
                <input
                  className="field-input w-20" type="number" min={1} max={24}
                  value={bRecorrenciaMeses} onChange={e => setBRecorrenciaMeses(e.target.value)}
                />
                <span className="text-xs text-brand-muted">mês(es)</span>
              </div>
            )}
            {cobrancaError && <p className="text-red-400 text-xs">{cobrancaError}</p>}
            <button type="submit" disabled={addingCobranca} className="btn-primary text-sm px-4 py-2">
              {addingCobranca ? <Spinner size={4} /> : 'Salvar cobrança'}
            </button>
          </form>
        )}

        {/* Filtros */}
        <div className="flex gap-1.5 flex-wrap mb-3">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                filter === f.key
                  ? 'text-brand-primary bg-brand-primary/10 border-brand-primary/30'
                  : 'text-brand-muted bg-brand-elevated border-brand-border hover:text-brand-text'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {dataLoading ? (
          <div className="flex items-center justify-center py-6 gap-2 text-brand-muted text-sm">
            <Spinner size={4} /> Carregando...
          </div>
        ) : filteredCobrancas.length === 0 ? (
          <p className="text-sm text-brand-muted py-2">Nenhuma cobrança nesse filtro.</p>
        ) : (
          <div className="space-y-1.5">
            {filteredCobrancas.map(c => {
              const meta = STATUS_META[c.displayStatus];
              const busy = actioningId === c.id;
              return (
                <div key={c.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-2.5 px-3 rounded-lg hover:bg-brand-elevated transition-colors">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-brand-text truncate">{c.cliente.nome}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${meta.cls}`}>{meta.label}</span>
                    </div>
                    <div className="text-xs text-brand-muted">
                      {c.descricao} · {formatBRL(c.valor)} · vence {formatDateBR(c.vencimento)}
                      {c.pagoEm ? ` · paga em ${formatDateBR(c.pagoEm)}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                    {(c.displayStatus === 'pendente' || c.displayStatus === 'vence_hoje' || c.displayStatus === 'vencida') && (
                      <>
                        <button onClick={() => handleResend(c.id)} disabled={busy}
                          className="text-xs font-semibold text-brand-primary hover:underline disabled:opacity-40">
                          Reenviar lembrete
                        </button>
                        <button onClick={() => handleMarkPaid(c.id)} disabled={busy}
                          className="text-xs font-semibold text-green-500 hover:underline disabled:opacity-40">
                          Marcar paga
                        </button>
                        <button onClick={() => handleCancel(c.id)} disabled={busy}
                          className="text-xs text-brand-muted hover:text-brand-text disabled:opacity-40">
                          Cancelar
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => setConfirmDelete({ type: 'cobranca', id: c.id, label: c.descricao })}
                      disabled={busy}
                      className="text-xs text-red-400 hover:text-red-300 disabled:opacity-40"
                    >
                      Excluir
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Confirmação de exclusão ── */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setConfirmDelete(null)}>
          <div className="card p-5 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-bold text-brand-text mb-1">
              {confirmDelete.type === 'cliente' ? 'Remover cliente?' : 'Excluir cobrança?'}
            </p>
            <p className="text-xs text-brand-text-secondary mb-4">
              {confirmDelete.type === 'cliente'
                ? `"${confirmDelete.label}" e o histórico de cobranças associado deixarão de aparecer na lista.`
                : `"${confirmDelete.label}" deixará de aparecer na lista.`}
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDelete(null)} className="flex-1 py-2 rounded-xl text-sm font-semibold border border-brand-border text-brand-muted">
                Cancelar
              </button>
              <button
                onClick={() => confirmDelete.type === 'cliente' ? handleDeleteCliente(confirmDelete.id) : handleDeleteCobranca(confirmDelete.id)}
                className="flex-1 py-2 rounded-xl text-sm font-semibold bg-red-500 text-white hover:bg-red-600"
              >
                Remover
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Onboarding: 3 perguntas no 1º acesso ── */}
      {showOnboarding && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="card p-5 sm:p-6 max-w-md w-full">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-bold text-brand-text">Configuração rápida ({obStep}/3)</p>
              <button onClick={handleFinishOnboarding} className="text-[11px] text-brand-muted hover:text-brand-text">
                Pular tudo
              </button>
            </div>
            <div className="flex gap-1 mb-4">
              {[1, 2, 3].map(s => (
                <div key={s} className={`h-1 flex-1 rounded-full ${s <= obStep ? 'bg-brand-primary' : 'bg-brand-border'}`} />
              ))}
            </div>

            {obStep === 1 && (
              <div>
                <p className="text-sm font-semibold text-brand-text mb-1">Qual tom você prefere nas mensagens?</p>
                <p className="text-xs text-brand-muted mb-3">Pode mudar quando quiser em Configurações.</p>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(TOM_META) as CobrancaTom[]).map(t => (
                    <button key={t} onClick={() => setCfgTom(t)}
                      className={`text-center px-2 py-2.5 rounded-lg border text-xs font-semibold transition-colors ${
                        cfgTom === t ? 'text-brand-primary bg-brand-primary/10 border-brand-primary/30' : 'text-brand-muted bg-brand-elevated border-brand-border hover:text-brand-text'
                      }`}
                    >
                      <div>{TOM_META[t].label}</div>
                      <div className="text-[10px] font-normal mt-0.5 opacity-80">{TOM_META[t].desc}</div>
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-2 mt-4 text-xs text-brand-text-secondary">
                  <input type="checkbox" checked={cfgEscalarTom} onChange={e => setCfgEscalarTom(e.target.checked)} />
                  Ficar mais direto automaticamente conforme o atraso aumenta
                </label>
              </div>
            )}

            {obStep === 2 && (
              <div>
                <p className="text-sm font-semibold text-brand-text mb-1">Quando avisar o cliente?</p>
                <p className="text-xs text-brand-muted mb-3">Escolha os dias de lembrete (até 5 de cada).</p>
                <p className="text-[11px] font-semibold text-brand-muted uppercase tracking-wide mb-1.5">Antes do vencimento</p>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {ANTES_CANDIDATES.map(n => (
                    <button key={n} onClick={() => setCfgDiasAntes(a => toggleInArray(a, n))}
                      className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                        cfgDiasAntes.includes(n) ? 'text-brand-primary bg-brand-primary/10 border-brand-primary/30' : 'text-brand-muted bg-brand-elevated border-brand-border hover:text-brand-text'
                      }`}
                    >
                      {n}d antes
                    </button>
                  ))}
                </div>
                <p className="text-[11px] font-semibold text-brand-muted uppercase tracking-wide mb-1.5">Depois do vencimento (em atraso)</p>
                <div className="flex flex-wrap gap-1.5">
                  {DEPOIS_CANDIDATES.map(n => (
                    <button key={n} onClick={() => setCfgDiasDepois(a => toggleInArray(a, n))}
                      className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                        cfgDiasDepois.includes(n) ? 'text-brand-primary bg-brand-primary/10 border-brand-primary/30' : 'text-brand-muted bg-brand-elevated border-brand-border hover:text-brand-text'
                      }`}
                    >
                      {n}d depois
                    </button>
                  ))}
                </div>
              </div>
            )}

            {obStep === 3 && (
              <div>
                <p className="text-sm font-semibold text-brand-text mb-1">Chave Pix (opcional)</p>
                <p className="text-xs text-brand-muted mb-3">Incluída automaticamente nas mensagens para facilitar o pagamento.</p>
                <div className="grid grid-cols-2 gap-2">
                  <select className="field-input" value={cfgPixKeyType} onChange={e => setCfgPixKeyType(e.target.value)}>
                    <option value="">Tipo da chave...</option>
                    {PIX_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <input className="field-input" placeholder="Sua chave Pix" value={cfgPixKey}
                    onChange={e => setCfgPixKey(e.target.value)} maxLength={140} />
                </div>
              </div>
            )}

            {configError && <p className="text-red-400 text-xs mt-3">{configError}</p>}

            <div className="flex gap-2 mt-5">
              {obStep > 1 && (
                <button onClick={() => setObStep(s => s - 1)} className="flex-1 py-2 rounded-xl text-sm font-semibold border border-brand-border text-brand-muted">
                  Voltar
                </button>
              )}
              {obStep < 3 ? (
                <button onClick={() => setObStep(s => s + 1)} className="flex-1 btn-primary text-sm py-2">
                  Próximo
                </button>
              ) : (
                <button onClick={handleFinishOnboarding} disabled={savingConfig} className="flex-1 btn-primary text-sm py-2 flex items-center justify-center gap-2">
                  {savingConfig ? <Spinner size={4} /> : 'Concluir'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Painel de configurações persistente ── */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowSettings(false)}>
          <div className="card p-5 sm:p-6 max-w-md w-full max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-bold text-brand-text mb-4">⚙️ Configurações da Cobrança</p>

            <p className="text-xs font-semibold text-brand-text mb-1.5">Tom das mensagens</p>
            <div className="grid grid-cols-3 gap-2 mb-2">
              {(Object.keys(TOM_META) as CobrancaTom[]).map(t => (
                <button key={t} onClick={() => setCfgTom(t)}
                  className={`text-center px-2 py-2 rounded-lg border text-xs font-semibold transition-colors ${
                    cfgTom === t ? 'text-brand-primary bg-brand-primary/10 border-brand-primary/30' : 'text-brand-muted bg-brand-elevated border-brand-border hover:text-brand-text'
                  }`}
                >
                  {TOM_META[t].label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 mb-4 text-xs text-brand-text-secondary">
              <input type="checkbox" checked={cfgEscalarTom} onChange={e => setCfgEscalarTom(e.target.checked)} />
              Ficar mais direto automaticamente conforme o atraso aumenta
            </label>

            <p className="text-xs font-semibold text-brand-text mb-1.5">Antes do vencimento</p>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {ANTES_CANDIDATES.map(n => (
                <button key={n} onClick={() => setCfgDiasAntes(a => toggleInArray(a, n))}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                    cfgDiasAntes.includes(n) ? 'text-brand-primary bg-brand-primary/10 border-brand-primary/30' : 'text-brand-muted bg-brand-elevated border-brand-border hover:text-brand-text'
                  }`}
                >
                  {n}d antes
                </button>
              ))}
            </div>
            <p className="text-xs font-semibold text-brand-text mb-1.5">Depois do vencimento</p>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {DEPOIS_CANDIDATES.map(n => (
                <button key={n} onClick={() => setCfgDiasDepois(a => toggleInArray(a, n))}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                    cfgDiasDepois.includes(n) ? 'text-brand-primary bg-brand-primary/10 border-brand-primary/30' : 'text-brand-muted bg-brand-elevated border-brand-border hover:text-brand-text'
                  }`}
                >
                  {n}d depois
                </button>
              ))}
            </div>

            <p className="text-xs font-semibold text-brand-text mb-1.5">Chave Pix</p>
            <div className="grid grid-cols-2 gap-2 mb-4">
              <select className="field-input" value={cfgPixKeyType} onChange={e => setCfgPixKeyType(e.target.value)}>
                <option value="">Tipo da chave...</option>
                {PIX_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <input className="field-input" placeholder="Sua chave Pix" value={cfgPixKey}
                onChange={e => setCfgPixKey(e.target.value)} maxLength={140} />
            </div>

            <p className="text-xs font-semibold text-brand-text mb-1.5">Resumo diário</p>
            <label className="flex items-center gap-2 mb-2 text-xs text-brand-text-secondary">
              <input type="checkbox" checked={cfgResumoDiario} onChange={e => setCfgResumoDiario(e.target.checked)} />
              Receber um resumo diário no WhatsApp
            </label>
            {cfgResumoDiario && (
              <div className="flex items-center gap-2 mb-4">
                <span className="text-xs text-brand-muted">Horário</span>
                <select className="field-input w-auto" value={cfgResumoHora} onChange={e => setCfgResumoHora(Number(e.target.value))}>
                  {RESUMO_HORAS.map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                </select>
              </div>
            )}

            {configError && <p className="text-red-400 text-xs mb-3">{configError}</p>}

            <div className="flex gap-2">
              <button onClick={() => setShowSettings(false)} className="flex-1 py-2 rounded-xl text-sm font-semibold border border-brand-border text-brand-muted">
                Cancelar
              </button>
              <button onClick={handleSaveSettings} disabled={savingConfig} className="flex-1 btn-primary text-sm py-2 flex items-center justify-center gap-2">
                {savingConfig ? <Spinner size={4} /> : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
