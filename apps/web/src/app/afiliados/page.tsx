'use client';
import { useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';

/* ─────────────────────────────────────────────────────────
   Landing pública do Programa de Afiliados.
   O cadastro em si exige conta (self-service em /dashboard/afiliado).
   ───────────────────────────────────────────────────────── */

export default function AfiliadosLanding() {
  // Persist affiliate code in case someone shares a referral link to this page
  useEffect(() => {
    const aff = new URLSearchParams(window.location.search).get('aff');
    if (aff) {
      try {
        localStorage.setItem('zs_aff', aff);
        localStorage.setItem('zs_aff_exp', String(Date.now() + 30 * 24 * 60 * 60 * 1000));
      } catch {}
    }
  }, []);

  return (
    <div className="min-h-screen bg-brand-bg">
      {/* Header */}
      <header className="flex items-center justify-between px-5 sm:px-8 py-4 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <Link href="/"><Image src="/logo.png" alt="ZapScript" width={132} height={28} className="object-contain" /></Link>
        <Link href="/dashboard/afiliado" className="btn-primary px-4 py-2 text-sm">Área do afiliado</Link>
      </header>

      {/* Hero */}
      <section className="px-5 sm:px-8 py-14 sm:py-20 max-w-3xl mx-auto text-center">
        <span className="inline-block text-xs font-mono uppercase tracking-widest text-brand-primary bg-brand-primary/10 rounded-full px-3 py-1 mb-4">
          Programa de Afiliados
        </span>
        <h1 className="text-3xl sm:text-5xl font-black text-brand-text leading-tight">
          Indique o ZapScript e <span className="text-brand-primary">ganhe comissão em dinheiro</span>
        </h1>
        <p className="text-base sm:text-lg text-brand-text-secondary mt-4 max-w-xl mx-auto">
          Compartilhe seu link exclusivo. A cada assinatura paga pelo seu link, você recebe comissão automaticamente — sem burocracia.
        </p>
        <div className="flex gap-3 justify-center mt-7 flex-wrap">
          <Link href="/dashboard/afiliado" className="btn-primary px-6 py-3 text-sm">Quero ser afiliado →</Link>
          <Link href="/cadastro" className="px-6 py-3 text-sm rounded-xl border border-white/15 text-brand-text hover:border-white/30 transition-colors">
            Ainda não tenho conta
          </Link>
        </div>
      </section>

      {/* Comissão — novo modelo único */}
      <section className="px-5 sm:px-8 pb-12 max-w-3xl mx-auto">
        <h2 className="text-xl font-bold text-brand-text text-center mb-6">Quanto você ganha</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="rounded-2xl p-6" style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgba(var(--color-primary)/.20)' }}>
            <div className="text-xs font-mono uppercase tracking-widest text-brand-muted mb-2">Plano Mensal</div>
            <div className="text-5xl font-black text-brand-primary">50%</div>
            <p className="text-sm text-brand-text-secondary mt-3 leading-relaxed">
              do 1º pagamento mensal do indicado.<br />
              <span className="text-brand-muted text-xs">Ex: indicado assina Pro (R$39,90) → você recebe <strong className="text-brand-primary">R$19,95</strong></span>
            </p>
          </div>
          <div className="rounded-2xl p-6" style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgba(var(--color-primary)/.15)' }}>
            <div className="text-xs font-mono uppercase tracking-widest text-brand-muted mb-2">Plano Anual</div>
            <div className="text-5xl font-black text-brand-primary">20%</div>
            <p className="text-sm text-brand-text-secondary mt-3 leading-relaxed">
              do 1º pagamento anual do indicado.<br />
              <span className="text-brand-muted text-xs">Ex: plano anual R$399 → você recebe <strong className="text-brand-primary">R$79,80</strong></span>
            </p>
          </div>
        </div>
        <div className="mt-4 rounded-xl px-5 py-3 text-center text-sm text-brand-muted" style={{ background: 'rgba(16,185,129,.06)', border: '1px solid rgba(16,185,129,.12)' }}>
          💳 Pagamentos via Pix nos dias <strong className="text-brand-primary">10 e 25</strong> de cada mês · mínimo R$50,00 acumulado
        </div>
      </section>

      {/* Como funciona */}
      <section className="px-5 sm:px-8 pb-16 max-w-3xl mx-auto">
        <h2 className="text-xl font-bold text-brand-text text-center mb-7">Como funciona</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            {
              n: '1',
              t: 'Crie sua conta',
              d: 'Cadastre-se no ZapScript e solicite sua afiliação pelo painel. Aprovação em até 48h.',
            },
            {
              n: '2',
              t: 'Compartilhe seu link',
              d: 'Divulgue seu link exclusivo em grupos, redes sociais, stories e para sua audiência.',
            },
            {
              n: '3',
              t: 'Receba via Pix',
              d: 'A comissão cai no seu extrato automaticamente. Saque via Pix nos dias 10 e 25 (mínimo R$50,00).',
            },
          ].map(s => (
            <div key={s.n} className="rounded-2xl p-5 text-center" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="w-9 h-9 rounded-full bg-brand-primary/15 text-brand-primary font-black flex items-center justify-center mx-auto mb-3">{s.n}</div>
              <div className="text-sm font-bold text-brand-text">{s.t}</div>
              <p className="text-xs text-brand-muted mt-1 leading-relaxed">{s.d}</p>
            </div>
          ))}
        </div>

        {/* Regras e condições resumidas */}
        <div className="mt-8 rounded-2xl p-5 space-y-2 text-xs text-brand-muted" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <p className="font-semibold text-brand-text-secondary text-sm mb-3">Regras e condições</p>
          <p>• Comissão única por indicado (baseada no 1º pagamento do plano escolhido pelo indicado)</p>
          <p>• O indicado deve se cadastrar pelo seu link e realizar o 1º pagamento para gerar comissão</p>
          <p>• Pagamento exclusivamente via Pix para conta de titularidade do CPF/CNPJ cadastrado</p>
          <p>• Saldo mínimo de R$50,00 para solicitar saque</p>
          <p>• Pagamentos processados nos dias 10 e 25 de cada mês</p>
          <p>• A aprovação da afiliação exige e-mail verificado e CPF/CNPJ cadastrado</p>
          <p>• A ZapScript pode recusar ou cancelar afiliações que violem os termos de uso</p>
        </div>

        <div className="text-center mt-10">
          <Link href="/dashboard/afiliado" className="btn-primary px-7 py-3 text-sm">Começar agora →</Link>
        </div>
      </section>

      <footer className="px-5 sm:px-8 py-8 border-t text-center" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <p className="text-xs text-brand-muted">© {new Date().getFullYear()} ZapScript · <Link href="/" className="hover:text-brand-primary">Voltar ao site</Link></p>
      </footer>
    </div>
  );
}
