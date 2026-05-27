'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function ConfiguracoesPage() {
  const [user, setUser]         = useState<any>(null);
  const [form, setForm]         = useState({ name: '', document: '' });
  const [planName, setPlanName] = useState('free');

  // Webhook state
  const [webhookUrl, setWebhookUrl]       = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [webhookActive, setWebhookActive] = useState(false);
  const [showSecret, setShowSecret]       = useState(false);
  const [webhookSaving, setWebhookSaving] = useState(false);
  const [webhookTesting, setWebhookTesting] = useState(false);
  const [webhookMsg, setWebhookMsg]       = useState('');
  const [webhookMsgType, setWebhookMsgType] = useState<'ok'|'err'>('ok');
  const [copiedSecret, setCopiedSecret]   = useState(false);

  const canWebhook = planName === 'executive';

  useEffect(() => {
    api.get<any>('/auth/me').then(u => {
      setUser(u);
      setForm({ name: u.name || '', document: u.document || '' });
      setPlanName(u.subscription?.plan?.name || 'free');
    });
  }, []);

  useEffect(() => {
    if (!canWebhook) return;
    api.get<any>('/webhook-config').then(cfg => {
      if (cfg?.url) {
        setWebhookUrl(cfg.url);
        setWebhookSecret(cfg.secret || '');
        setWebhookActive(cfg.active ?? true);
      }
    }).catch(() => null);
  }, [canWebhook]);

  async function saveWebhook() {
    if (!webhookUrl) { setWebhookMsg('Informe a URL.'); setWebhookMsgType('err'); return; }
    setWebhookSaving(true); setWebhookMsg('');
    try {
      const res = await api.post<any>('/webhook-config', { url: webhookUrl });
      setWebhookSecret(res.secret || webhookSecret);
      setWebhookActive(true);
      setWebhookMsg('Webhook salvo com sucesso!');
      setWebhookMsgType('ok');
    } catch (err: any) {
      setWebhookMsg(err.message || 'Erro ao salvar.');
      setWebhookMsgType('err');
    } finally {
      setWebhookSaving(false);
    }
  }

  async function testWebhook() {
    setWebhookTesting(true); setWebhookMsg('');
    try {
      const res = await api.post<any>('/webhook-config/test', {});
      setWebhookMsg(res.message || 'Teste enviado!');
      setWebhookMsgType(res.ok ? 'ok' : 'err');
    } catch (err: any) {
      setWebhookMsg(err.message || 'Erro ao testar.');
      setWebhookMsgType('err');
    } finally {
      setWebhookTesting(false);
    }
  }

  async function disableWebhook() {
    if (!confirm('Desativar webhook?')) return;
    try {
      await api.delete('/webhook-config');
      setWebhookActive(false);
      setWebhookMsg('Webhook desativado.');
      setWebhookMsgType('ok');
    } catch (err: any) {
      setWebhookMsg(err.message || 'Erro ao desativar.');
      setWebhookMsgType('err');
    }
  }

  function copySecret() {
    navigator.clipboard.writeText(webhookSecret);
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 1800);
  }

  return (
    <div className="p-4 sm:p-8 max-w-2xl">
      <h1 className="text-2xl font-bold mb-2 text-brand-text">Configurações</h1>
      <p className="text-brand-text-secondary text-sm font-light mb-8">Gerencie seus dados e preferências</p>

      {/* Dados da conta */}
      <div className="card rounded-2xl p-6 mb-5">
        <h2 className="font-bold text-sm mb-4 text-brand-text">Dados da Conta</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-brand-text-secondary mb-1.5">Nome</label>
            <input className="field-input" disabled readOnly value={form.name} placeholder="Seu nome"/>
            <p className="text-xs text-brand-muted mt-1">Nome não pode ser alterado após o cadastro.</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-brand-text-secondary mb-1.5">E-mail</label>
            <input className="field-input" disabled readOnly value={user?.email || ''}/>
            <p className="text-xs text-brand-muted mt-1">E-mail não pode ser alterado após o cadastro.</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-brand-text-secondary mb-1.5">CPF / CNPJ</label>
            <input className="field-input" disabled readOnly value={form.document} placeholder="000.000.000-00"/>
            <p className="text-xs text-brand-muted mt-1">CPF / CNPJ não pode ser alterado após o cadastro.</p>
          </div>
        </div>
      </div>

      {/* Integração com outros Apps (Executive) */}
      <div className={`card rounded-2xl p-6 mb-5 ${!canWebhook ? 'opacity-70' : ''}`}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-bold text-sm text-brand-text flex items-center gap-2">
            🔗 Integração com outros Apps
            {webhookActive && canWebhook && (
              <span className="text-[9px] bg-emerald-400/10 text-emerald-400 border border-emerald-400/20 px-1.5 py-0.5 rounded font-bold">Ativo</span>
            )}
          </h2>
          <span className="text-[9px] bg-amber-400/10 text-amber-400 border border-amber-400/20 px-1.5 py-0.5 rounded font-bold">Executive</span>
        </div>
        <p className="text-xs text-brand-muted mb-4">Receba um POST a cada transcrição concluída, assinado com HMAC-SHA256.</p>

        {!canWebhook ? (
          <div className="inner-block text-center py-4">
            <p className="text-sm text-brand-muted mb-3">Disponível no plano <span className="text-amber-400 font-semibold">Executive</span>.</p>
            <a href="/dashboard/plano" className="btn-primary text-xs px-4 py-2">Ver planos</a>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-brand-text-secondary mb-1.5">URL do Endpoint</label>
              <input
                className="input w-full"
                type="url"
                placeholder="https://meusite.com/webhook/zapscript"
                value={webhookUrl}
                onChange={e => setWebhookUrl(e.target.value)}
              />
            </div>

            {webhookSecret && (
              <div>
                <label className="block text-xs font-semibold text-brand-text-secondary mb-1.5">Secret (HMAC-SHA256)</label>
                <div className="flex items-center gap-2">
                  <input
                    className="field-input flex-1 font-mono text-xs"
                    readOnly
                    value={showSecret ? webhookSecret : '•'.repeat(32)}
                  />
                  <button onClick={() => setShowSecret(s => !s)}
                    className="btn-ghost text-xs px-2.5 py-1.5 flex-shrink-0">
                    {showSecret ? '🙈' : '👁'}
                  </button>
                  <button onClick={copySecret}
                    className="btn-ghost text-xs px-2.5 py-1.5 flex-shrink-0">
                    {copiedSecret ? '✓' : '📋'}
                  </button>
                </div>
                <p className="text-xs text-brand-muted mt-1">Use o cabeçalho <code className="font-mono bg-brand-elevated px-1 rounded">X-ZapScript-Signature</code> para validar.</p>
              </div>
            )}

            {webhookMsg && (
              <div className={`text-xs px-3 py-2 rounded-lg border ${webhookMsgType === 'ok' ? 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20' : 'bg-red-400/10 text-red-400 border-red-400/20'}`}>
                {webhookMsg}
              </div>
            )}

            <div className="flex gap-2 flex-wrap">
              <button onClick={saveWebhook} disabled={webhookSaving}
                className="btn-primary text-xs px-4 py-2">
                {webhookSaving ? 'Salvando...' : 'Salvar URL'}
              </button>
              {webhookSecret && (
                <button onClick={testWebhook} disabled={webhookTesting}
                  className="btn-ghost text-xs px-4 py-2">
                  {webhookTesting ? 'Testando...' : '⚡ Testar'}
                </button>
              )}
              {webhookActive && (
                <button onClick={disableWebhook}
                  className="text-xs px-4 py-2 rounded-lg border border-red-400/20 text-red-400 hover:bg-red-400/5 transition-colors">
                  Desativar
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Zona de perigo */}
      <div className="card rounded-2xl p-6" style={{ borderColor: 'rgba(248,113,113,.15)' }}>
        <h2 className="font-bold text-sm mb-2 text-brand-text">Zona de Perigo</h2>
        <p className="text-xs text-brand-muted mb-4">A exclusão da conta é permanente e remove todos os seus dados.</p>
        <button
          className="border border-red-400/20 text-red-400 hover:bg-red-400/5 transition-colors text-xs font-semibold px-4 py-2 rounded-lg"
          onClick={() => confirm('Tem certeza? Esta ação é irreversível.') && alert('Entre em contato: contato@zapscript.me')}>
          Solicitar exclusão da conta
        </button>
      </div>
    </div>
  );
}
