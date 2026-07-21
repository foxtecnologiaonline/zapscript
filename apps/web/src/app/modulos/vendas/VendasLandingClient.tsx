'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import {
  ModuleCatalogItem, STATUS_LABEL, isContractable, formatBrl,
} from '@/lib/modules';

const FALLBACK: ModuleCatalogItem = {
  key: 'vendas', name: 'ZapScript Vendas', status: 'planned',
  priceMonthly: 44.90, priceYearly: 431.04, dependsOn: [],
};

const FAQS = [
  { q: 'Como funciona na prática?', a: 'Depois da visita ou ligação, você grava o áudio (ou usa uma gravação já feita) e envia pelo painel. Em segundos, recebe a transcrição completa e um resumo em tópicos com valores, objeções levantadas, o que ficou combinado e o próximo passo.' },
  { q: 'Preciso instalar algo no celular?', a: 'Não. Basta ter o áudio da visita ou ligação (gravador do celular, ligação gravada, etc.) e enviar pelo painel web do ZapScript Vendas — sem app adicional.' },
  { q: 'O áudio fica guardado?', a: 'Não. O áudio é usado apenas para gerar a transcrição e é apagado logo depois do processamento — fica salvo só o texto e o resumo, criptografados (AES-256-GCM).' },
  { q: 'O resumo já sai pronto para lançar no CRM?', a: 'Sim — o resumo prioriza automaticamente o que importa para uma visita comercial: valores discutidos, objeções, combinados e próximo passo/follow-up, pronto para colar como nota de atividade.' },
  { q: 'Preciso ter o módulo CRM para usar o Vendas?', a: 'Não é obrigatório. O Vendas funciona sozinho (gera transcrição + resumo da visita); ele apenas se complementa bem com o módulo CRM, sem depender dele.' },
];

function FaqAccordion() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="space-y-3">
      {FAQS.map((faq, i) => (
        <div key={i} className="border border-white/10 rounded-xl overflow-hidden bg-white/3">
          <button
            className="w-full flex items-center justify-between px-6 py-4 text-left font-semibold text-white hover:bg-white/5 transition-colors"
            onClick={() => setOpen(open === i ? null : i)}
            aria-expanded={open === i}
          >
            <span>{faq.q}</span>
            <span className={`text-brand-primary text-xl ml-4 shrink-0 transition-transform duration-200 ${open === i ? 'rotate-45' : ''}`}>+</span>
          </button>
          {open === i && (
            <div className="px-6 pb-5 text-brand-muted leading-relaxed border-t border-white/5 pt-4">
              {faq.a}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function VendasLandingClient() {
  const [mod, setMod] = useState<ModuleCatalogItem>(FALLBACK);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<{ modules: ModuleCatalogItem[] }>('/modules');
        const found = res?.modules?.find((m) => m.key === 'vendas');
        if (found) setMod(found);
      } catch { /* mantém fallback */ }
    })();
  }, []);

  const contractable = isContractable(mod.status);
  const ctaHref  = contractable
    ? '/cadastro?utm_source=lp_modulo&utm_campaign=vendas'
    : '/cadastro?utm_source=lp_modulo&utm_campaign=vendas_em_breve';
  const ctaLabel = contractable ? 'Contratar Vendas' : 'Começar grátis no ZapScript';

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQS.map((f) => ({
      '@type': 'Question', name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };

  return (
    <div className="min-h-screen bg-brand-bg text-brand-text" style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />

      {/* ── Header ──────────────────────────────────────────────── */}
      <header className="border-b border-white/5 bg-brand-bg/95 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-bold text-lg">
            <span className="text-2xl">⚡</span>
            <span className="text-white">ZapScript</span>
          </Link>
          <Link href="/login" className="text-brand-muted hover:text-white text-sm transition-colors">
            Já tenho conta →
          </Link>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────────── */}
      <section className="pt-16 pb-12 px-4 text-center relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(16,185,129,0.12) 0%, transparent 70%)' }}
        />
        <div className="relative max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-brand-primary/10 border border-brand-primary/20 rounded-full px-4 py-1.5 text-sm font-medium text-brand-primary mb-6">
            🗣️ Módulo ZapScript Vendas
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-tight mb-5">
            A visita de vendas não pode virar história perdida.
          </h1>

          <p className="text-lg sm:text-xl text-brand-muted leading-relaxed max-w-2xl mx-auto mb-8">
            Grave a visita ou ligação comercial e receba, em segundos, a transcrição completa e um resumo pronto
            para o CRM: valores discutidos, objeções, o que ficou combinado e o próximo passo.
          </p>

          <Link
            href={ctaHref}
            data-cta="lp_modulo_vendas_hero_cta"
            className="inline-flex items-center gap-2 bg-brand-primary text-black font-bold text-lg px-10 py-4 rounded-2xl hover:opacity-90 active:scale-95 transition-all shadow-lg"
            style={{ boxShadow: '0 0 30px rgba(16,185,129,0.3)' }}
          >
            {ctaLabel}
            <span>→</span>
          </Link>

          <p className="mt-4 text-sm text-brand-muted">
            {contractable
              ? `✓ ${formatBrl(mod.priceMonthly)}/mês · ✓ Cancele quando quiser`
              : `🚧 ${STATUS_LABEL[mod.status]} · ✓ Comece grátis no Core enquanto isso`}
          </p>
        </div>
      </section>

      {/* ── Antes / Depois ──────────────────────────────────────── */}
      <section className="py-10 px-4">
        <div className="max-w-3xl mx-auto">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <p className="text-xs font-bold text-red-400 uppercase tracking-widest mb-4">❌ Sem Vendas</p>
              <div className="space-y-3">
                <div className="bg-white/5 rounded-xl px-4 py-3">
                  <div className="text-xs text-brand-muted mb-1">Visita com o cliente ACME</div>
                  <div className="text-sm text-white">Anotação solta no caderno, ou nada.</div>
                </div>
                <div className="bg-white/5 rounded-xl px-4 py-3">
                  <div className="text-xs text-brand-muted mb-1">Uma semana depois</div>
                  <div className="text-sm text-white">"Combinei que prazo mesmo? Quanto ficou o desconto?"</div>
                </div>
              </div>
              <p className="text-center text-brand-muted text-sm mt-4">Detalhe perdido, follow-up atrasado 😩</p>
            </div>

            <div className="bg-brand-primary/5 border border-brand-primary/20 rounded-2xl p-6">
              <p className="text-xs font-bold text-brand-primary uppercase tracking-widest mb-4">✅ Com Vendas</p>
              <div className="space-y-3">
                <div className="bg-white/5 border border-white/8 rounded-xl px-4 py-3">
                  <div className="text-xs text-brand-muted mb-1.5">Visita • cliente ACME • resumo automático</div>
                  <p className="text-sm text-white leading-relaxed">
                    • Proposta de R$12.400, pediu 10% de desconto<br/>
                    • Objeção: prazo de entrega de 30 dias<br/>
                    • Combinado: enviar nova proposta até quinta<br/>
                    • Próximo passo: retornar com condição de pagamento
                  </p>
                </div>
              </div>
              <p className="text-center text-brand-primary text-sm font-semibold mt-4">~30 segundos para ler tudo ⚡</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Como funciona ───────────────────────────────────────── */}
      <section className="py-14 px-4 border-y border-white/5 bg-white/2">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-10">Como funciona</h2>
          <div className="grid sm:grid-cols-3 gap-6 text-left">
            {[
              { n: '1', title: 'Grave a visita ou ligação', desc: 'Use o gravador do celular ou uma ligação já gravada. Nenhum app novo para instalar.' },
              { n: '2', title: 'Envie pelo painel', desc: 'Suba o áudio no ZapScript Vendas, associe ao nome do cliente e pronto.' },
              { n: '3', title: 'Receba o resumo comercial', desc: 'Transcrição completa + bullets com valores, objeções, combinados e próximo passo.' },
            ].map(({ n, title, desc }) => (
              <div key={n} className="bg-white/5 border border-white/10 rounded-2xl p-6">
                <div className="w-8 h-8 rounded-full bg-brand-primary/15 text-brand-primary font-bold flex items-center justify-center mb-3">{n}</div>
                <h3 className="font-semibold text-white mb-1.5 text-sm">{title}</h3>
                <p className="text-brand-muted text-xs leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Preço ───────────────────────────────────────────────── */}
      <section className="py-16 px-4">
        <div className="max-w-sm mx-auto">
          <div className="bg-white/5 border border-brand-primary/30 rounded-2xl p-8 text-center">
            <div className="text-sm font-semibold text-brand-primary uppercase tracking-widest mb-2">
              {STATUS_LABEL[mod.status]}
            </div>
            <div className="text-4xl font-bold text-white mb-1">
              {contractable ? formatBrl(mod.priceMonthly) : '—'}
            </div>
            {contractable && <div className="text-brand-muted text-sm mb-6">/mês</div>}
            <ul className="text-left text-sm text-brand-muted space-y-2 mb-8">
              <li>✓ Visitas/ligações ilimitadas</li>
              <li>✓ Transcrição + resumo comercial automático</li>
              <li>✓ Sem retenção de áudio (LGPD)</li>
              <li>✓ Mesmo login da suíte ZapScript</li>
            </ul>
            <Link
              href={ctaHref}
              data-cta="lp_modulo_vendas_pricing_cta"
              className="block w-full bg-brand-primary text-black font-bold text-base px-6 py-3.5 rounded-2xl hover:opacity-90 active:scale-95 transition-all"
            >
              {ctaLabel}
            </Link>
          </div>
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────── */}
      <section className="py-16 px-4">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-white text-center mb-10">Perguntas frequentes</h2>
          <FaqAccordion />
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <footer className="border-t border-white/5 py-6 px-4">
        <div className="max-w-3xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-brand-muted">
          <span>© 2026 ZapScript · FOX TecnologIA</span>
          <div className="flex items-center gap-4">
            <Link href="/privacidade" className="hover:text-white transition-colors">Privacidade</Link>
            <Link href="/termos" className="hover:text-white transition-colors">Termos</Link>
            <Link href="/blog" className="hover:text-white transition-colors">Blog</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
