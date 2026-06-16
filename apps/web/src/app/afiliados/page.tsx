'use client';
import Image from 'next/image';
import Link from 'next/link';

/* ─────────────────────────────────────────────────────────
   Landing pública do Programa de Afiliados.
   O cadastro em si exige conta (self-service em /dashboard/afiliado).
   ───────────────────────────────────────────────────────── */

export default function AfiliadosLanding() {
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
          Indique o ZapScript e <span className="text-brand-primary">ganhe comissão recorrente</span>
        </h1>
        <p className="text-base sm:text-lg text-brand-text-secondary mt-4 max-w-xl mx-auto">
          Ganhe a cada cliente que assinar pelo seu link. Você escolhe o modelo: comissão única maior ou renda recorrente todo mês.
        </p>
        <div className="flex gap-3 justify-center mt-7 flex-wrap">
          <Link href="/dashboard/afiliado" className="btn-primary px-6 py-3 text-sm">Quero ser afiliado →</Link>
          <Link href="/cadastro" className="px-6 py-3 text-sm rounded-xl border border-white/15 text-brand-text hover:border-white/30 transition-colors">
            Ainda não tenho conta
          </Link>
        </div>
      </section>

      {/* Modelos de comissão */}
      <section className="px-5 sm:px-8 pb-12 max-w-3xl mx-auto">
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="rounded-2xl p-6" style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgba(var(--color-primary)/.15)' }}>
            <div className="text-xs font-mono uppercase tracking-widest text-brand-muted mb-1">Modelo A</div>
            <div className="text-4xl font-black text-brand-primary">30%</div>
            <p className="text-sm text-brand-text-secondary mt-2">de comissão <strong>única</strong> sobre o primeiro pagamento de cada indicado. Ideal para ganho imediato.</p>
          </div>
          <div className="rounded-2xl p-6" style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgba(var(--color-primary)/.15)' }}>
            <div className="text-xs font-mono uppercase tracking-widest text-brand-muted mb-1">Modelo B</div>
            <div className="text-4xl font-black text-brand-primary">5%<span className="text-xl">/mês</span></div>
            <p className="text-sm text-brand-text-secondary mt-2">de comissão <strong>recorrente</strong> nos primeiros 12 meses de cada assinatura ativa. Renda passiva.</p>
          </div>
        </div>
      </section>

      {/* Como funciona */}
      <section className="px-5 sm:px-8 pb-16 max-w-3xl mx-auto">
        <h2 className="text-xl font-bold text-brand-text text-center mb-7">Como funciona</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            { n: '1', t: 'Cadastre-se', d: 'Solicite sua afiliação e escolha o modelo de comissão. A aprovação é rápida.' },
            { n: '2', t: 'Compartilhe', d: 'Divulgue seu link exclusivo nas redes, grupos e para sua audiência.' },
            { n: '3', t: 'Receba via Pix', d: 'A cada assinatura paga pelo seu link, a comissão entra no seu extrato. Pagamentos via Pix até o dia 15 do mês seguinte (mínimo R$50,00).' },
          ].map(s => (
            <div key={s.n} className="rounded-2xl p-5 text-center" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="w-9 h-9 rounded-full bg-brand-primary/15 text-brand-primary font-black flex items-center justify-center mx-auto mb-3">{s.n}</div>
              <div className="text-sm font-bold text-brand-text">{s.t}</div>
              <p className="text-xs text-brand-muted mt-1 leading-relaxed">{s.d}</p>
            </div>
          ))}
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
