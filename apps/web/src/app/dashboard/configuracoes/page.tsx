'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function ConfiguracoesPage() {
  const [user, setUser]       = useState<any>(null);
  const [form, setForm]       = useState({ name: '', document: '' });
  const [planName, setPlanName] = useState('free');

  // ── Webhook state ──────────────────────────────────────
  const [whUrl, setWhUrl]         = useState('');
  const [whSecret, setWhSecret]   = useState('');
  const [whActive, setWhActive]   = useState(false);
  const [whShowSecret, setWhShowSecret] = useState(false);
  const [whSaving, setWhSaving]   = useState(false);
  const [whTesting, setWhTesting] = useState(false);
  const [whMsg, setWhMsg]         = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api.get<any>('/auth/me').then(u => {
      setUser(u);
      setForm({ name: u.name || '', document: u.document || '' });
      setPlanName(u.subscription?.plan?.name || 'free');
    });
  }, []);

  useEffect(() => {
    if (planName !== 'executive') return;
    api.get<any>('/webhook-config')
      .then(cfg => {
        if (cfg?.url) {
          setWhUrl(cfg.url);
          setWhSecret(cfg.secret || '');
          setWhActive(cfg.active ?? true);
        }
      })
      .catch(() => null); // 404 = não configurado ainda
  }, [planName]);

  async function saveWebhook() {
    if (!whUrl.trim()) return;
    setWhSaving(true); setWhMsg(null);
    try {
      const cfg = await api.post<any>('/webhook-config', { url: whUrl.trim() });
      if (cfg?.secret) setWhSecret(cfg.secret);
      setWhActive(true);
      setWhMsg({ ok: true, text: 'Webhook salvo com sucesso!' });
    } catch (err: any) {
      setWhMsg({ ok: false, text: err.message || 'Erro ao salvar webhook.' });
    } finally {
      setWhSaving(false);
    }
  }

  async function testWebhook() {
    setWhTesting(true); setWhMsg(null);
    try {
      const res = await api.post<any>('/webhook-config/test', {});
      setWhMsg({ ok: res.ok, text: res.message || (res.ok ? 'Teste enviado!' : 'Falha no teste.') });
    } catch (err: any) {
      setWhMsg({ ok: false, text: err.message || 'Erro ao testar webhook.' });
    } finally {
      setWhTesting(false);
    }
  }

  async function deactivateWebhook() {
    if (!confirm('Desativar o webhook? Você poderá reativá-lo a qualquer momento.')) return;
    try {
      await api.delete('/webhook-config');
      setWhActive(false);
      setWhMsg({ ok: true, text: 'Webhook desativado.' });
    } catch (err: any) {
      setWhMsg({ ok: false, text: err.message || 'Erro ao desativar.' });
    }
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

      {/* Indicar amigos */}
      {user?.refCode && (
        <div className="card rounded-2xl p-6 mb-5">
          <h2 className="font-bold text-sm mb-1 text-brand-text">Indicar Amigos</h2>
          <p className="text-xs text-brand-muted mb-3">
            Compartilhe seu link. Quando alguém se cadastrar, vocês dois ganham <strong className="text-brand-primary">+10 minutos</strong> de bônus.
          </p>
          <div className="flex gap-2">
            <input
              className="field-input flex-1 font-mono text-xs"
              readOnly
              value={`https://zapscript.me/cadastro?ref=${user.refCode}`}
            />
            <button
              className="btn-primary text-xs px-4 py-2 flex-shrink-0"
              onClick={() => {
                navigator.clipboard.writeText(`https://zapscript.me/cadastro?ref=${user.refCode}`);
              }}>
              Copiar
            </button>
          </div>
        </div>
      )}

      {/* Webhook Personalizado — Executive */}
      <div className={`card rounded-2xl p-6 mb-5 ${planName !== 'executive' ? 'opacity-60' : ''}`}>
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <span className="text-base">🔗</span>
            <h2 className="font-bold text-sm text-brand-text">Webhook Personalizado</h2>
          </div>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-400/10 text-amber-400 border border-amber-400/20">
            Executive
          </span>
        </div>

        {planName !== 'executive' ? (
          <p className="text-xs text-brand-muted mt-2">
            Disponível no plano Executive. Receba cada transcrição em tempo real no seu sistema via HTTP POST com assinatura HMAC-SHA256.
          </p>
        ) : (
          <>
            <p className="text-xs text-brand-muted mb-4">
              Cada transcrição concluída dispara um POST para a URL configurada, assinado com HMAC-SHA256.
            </p>

            <div className="space-y-3">
              {/* URL */}
              <div>
                <label className="block text-xs font-semibold text-brand-text-secondary mb-1.5">
                  URL do Webhook
                </label>
                <input
                  className="field-input font-mono text-xs"
                  placeholder="https://meu-sistema.com/webhook"
                  value={whUrl}
                  onChange={e => setWhUrl(e.target.value)}
                />
              </div>

              {/* Secret */}
              {whSecret && (
                <div>
                  <label className="block text-xs font-semibold text-brand-text-secondary mb-1.5">
                    Secret (HMAC-SHA256)
                  </label>
                  <div className="flex gap-2">
                    <input
                      className="field-input font-mono text-xs flex-1"
                      type={whShowSecret ? 'text' : 'password'}
                      readOnly
                      value={whSecret}
                    />
                    <button
                      className="btn-ghost text-xs px-3"
                      onClick={() => setWhShowSecret(s => !s)}>
                      {whShowSecret ? '🙈' : '👁️'}
                    </button>
                    <button
                      className="btn-ghost text-xs px-3"
                      onClick={() => navigator.clipboard.writeText(whSecret)}>
                      Copiar
                    </button>
                  </div>
                  <p className="text-[10px] text-brand-muted mt-1">
                    Use este secret para validar o header <code>X-ZapScript-Signature</code> nos seus recebimentos.
                  </p>
                </div>
              )}

              {/* Status */}
              {whSecret && (
                <div className="flex items-center gap-2 text-xs text-brand-muted">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${whActive ? 'bg-green-400' : 'bg-brand-border'}`}/>
                  {whActive ? 'Webhook ativo' : 'Webhook inativo'}
                </div>
              )}

              {/* Feedback */}
              {whMsg && (
                <p className={`text-xs font-medium ${whMsg.ok ? 'text-brand-primary' : 'text-red-400'}`}>
                  {whMsg.ok ? '✓' : '✗'} {whMsg.text}
                </p>
              )}

              {/* Ações */}
              <div className="flex gap-2 flex-wrap pt-1">
                <button
                  className="btn-primary text-xs px-4 py-2"
                  disabled={whSaving || !whUrl.trim()}
                  onClick={saveWebhook}>
                  {whSaving ? 'Salvando...' : 'Salvar URL'}
                </button>
                {whSecret && whActive && (
                  <button
                    className="btn-ghost text-xs px-4 py-2"
                    disabled={whTesting}
                    onClick={testWebhook}>
                    {whTesting ? 'Testando...' : '🧪 Testar'}
                  </button>
                )}
                {whSecret && whActive && (
                  <button
                    className="btn-ghost text-xs px-4 py-2 text-red-400 hover:text-red-300"
                    onClick={deactivateWebhook}>
                    Desativar
                  </button>
                )}
              </div>
            </div>
          </>
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
