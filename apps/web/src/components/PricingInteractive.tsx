'use client';
import { useState } from 'react';
import Link from 'next/link';
import { isJunePromoActive, PRO_FULL_PRICE, PRO_PROMO_PRICE } from '@/lib/promo';

type CmpVal = string | boolean;

const PLANS = [
  {
    name: 'free', label: 'Free', price: 'R$0', per: '/mês',
    desc: 'Para experimentar',
    feats: [
      '15 áudios/mês',
      '1 número WhatsApp',
      '🎙️ Conversão automática',
      '✨ Resumo com IA',
      '📋 Histórico de conversões',
      '📅 Filtros por data e contato',
      '🔍 Busca por conversão',
    ],
    excl: ['🖥️ Conversão de áudios no site'],
    cta: 'Começar grátis', href: '/cadastro', popular: false, accent: null as string | null,
  },
  {
    name: 'pro', label: 'Pro', price: 'R$19,90', per: '/1º mês',
    desc: 'Depois R$39,90/mês',
    feats: [
      'Áudios ilimitados',
      'Áudios de até 10 min',
      '2 números WhatsApp',
      '🎙️ Conversão automática',
      '🖥️ Conversão de áudios no site',
      '✨ Resumo com IA',
      '📋 Histórico de conversões',
      '📅 Filtros por data e contato',
      '🔍 Busca por conversão',
      '📤 Exportar áudios em PDF, Docx, Csv e Excel',
      '📄 Conversão Profissional (PDF com marcação temporal)',
      '🔒 Modo Privado de conversão',
    ],
    excl: [],
    cta: 'Assinar Pro', href: '/cadastro', popular: true, accent: '#3b82f6' as string | null,
  },
];

const TABLE_ROWS: { feature: string; vals: CmpVal[] }[] = [
  { feature: 'Áudios/mês',                         vals: ['15', 'Ilimitado'] },
  { feature: 'Números WhatsApp',                   vals: ['1', '2'] },
  { feature: '🎙️ Conversão automática',           vals: [true, true] },
  { feature: '✨ Resumo com IA',                    vals: [true, true] },
  { feature: '📋 Histórico de conversões',        vals: [true, true] },
  { feature: '📅 Filtros por data e contato',       vals: [true, true] },
  { feature: '🔍 Busca por conversão',             vals: [true, true] },
  { feature: '🖥️ Conversão no site (upload)',     vals: [false, true] },
  { feature: '📤 Exportar áudios (PDF/Docx/Csv/Excel)', vals: [false, true] },
  { feature: '📄 Conversão Profissional (PDF)',    vals: [false, true] },
  { feature: '🔒 Modo Privado de conversão',       vals: [false, true] },
];

export function PricingInteractive() {
  const promo = isJunePromoActive();
  const plans = PLANS.map(p => p.name !== 'pro' ? p : (
    promo
      ? { ...p, price: PRO_PROMO_PRICE, per: '/1º mês', desc: `Depois ${PRO_FULL_PRICE}/mês` }
      : { ...p, price: PRO_FULL_PRICE, per: '/mês', desc: 'Sem fidelidade, cancele quando quiser' }
  ));

  const [showTable, setShowTable] = useState(true);
  const [waitlistEmail, setWaitlistEmail]     = useState('');
  const [waitlistDone, setWaitlistDone]       = useState(false);
  const [waitlistLoading, setWaitlistLoading] = useState(false);

  function submitWaitlist() {
    if (!waitlistEmail.includes('@')) return;
    setWaitlistLoading(true);
    fetch(`${(process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '')}/demo/newsletter/interest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: waitlistEmail }),
    }).finally(() => { setWaitlistLoading(false); setWaitlistDone(true); });
  }

  return (
    <>
      {/* Plan cards */}
      <div className="flex flex-col gap-4">
        {plans.map((plan, i) => {
          const borderCol = plan.popular
            ? 'rgb(var(--color-primary))'
            : plan.accent ? plan.accent + '55' : 'rgb(var(--color-border))';
          const priceCol = plan.popular
            ? 'rgb(var(--color-primary))'
            : plan.accent || 'rgb(var(--color-text))';
          return (
            <div key={i} className="relative rounded-2xl p-6 border transition-all"
              style={{
                background:  plan.popular ? 'rgb(var(--color-surface-elevated))' : 'rgb(var(--color-surface))',
                borderColor: borderCol,
                boxShadow:   plan.popular ? 'var(--shadow-glow), var(--shadow-md)' : 'var(--shadow-sm)',
              }}>
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-black text-[11px] font-bold px-3.5 py-1 rounded-full uppercase tracking-wide whitespace-nowrap"
                  style={{ background: 'rgb(var(--color-primary))' }}>
                  {promo ? <>🔥 50% OFF no 1º mês</> : <>⭐ Mais popular</>}
                </div>
              )}
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="font-display font-bold text-lg">{plan.label}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>{plan.desc}</p>
                </div>
                <div className="text-right">
                  <span className="font-display font-bold text-2xl" style={{ color: priceCol }}>{plan.price}</span>
                  <span className="text-xs ml-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>{plan.per}</span>
                </div>
              </div>
              {plan.name === 'pro' && (
                <div className="text-xs font-semibold mb-4" style={{ color: 'rgb(var(--color-primary))' }}>
                  24h trabalhando por você, por apenas R$1,33 ao dia
                </div>
              )}
              <div className="flex flex-col gap-2 mb-5">
                {plan.feats.map((f, fi) => (
                  <div key={fi} className="flex items-center gap-2">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                      stroke={plan.popular ? 'rgb(var(--color-primary))' : plan.accent || 'rgb(var(--color-primary))'}>
                      <path d="M2 7.5l3 3 7-7"/>
                    </svg>
                    <span className="text-sm" style={{ color: 'rgb(var(--color-text-secondary))' }}>{f}</span>
                  </div>
                ))}
                {plan.excl.map((f, fi) => (
                  <div key={fi} className="flex items-center gap-2" style={{ opacity: 0.35 }}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="rgb(var(--color-text-muted))" strokeWidth="2" strokeLinecap="round">
                      <path d="M3 3l8 8M11 3l-8 8"/>
                    </svg>
                    <span className="text-sm" style={{ color: 'rgb(var(--color-text-muted))' }}>{f}</span>
                  </div>
                ))}
              </div>
              <Link href={plan.href}
                className="block w-full py-3 rounded-2xl text-sm font-semibold text-center transition-all"
                style={{
                  background:  plan.popular ? 'rgb(var(--color-primary))' : 'transparent',
                  border:      plan.popular ? 'none' : `1.5px solid ${plan.accent || 'rgb(var(--color-border))'}`,
                  color:       plan.popular ? '#fff' : plan.accent || 'rgb(var(--color-text))',
                  boxShadow:   plan.popular ? 'rgba(16,185,129,.25) 0 4px 14px' : 'none',
                }}>
                {plan.cta}
              </Link>
            </div>
          );
        })}
      </div>

      {/* Toggle tabela comparativa */}
      <button
        onClick={() => setShowTable(v => !v)}
        className="w-full mt-5 py-3 rounded-2xl text-sm font-semibold transition-all flex items-center justify-center gap-2"
        style={{ border: '1.5px solid rgb(var(--color-border))', color: 'rgb(var(--color-text-secondary))', background: 'transparent' }}>
        {showTable ? 'Ocultar comparativo ↑' : 'Comparar todos os recursos ↓'}
      </button>

      {showTable && (
        <div className="mt-3 rounded-2xl overflow-hidden" style={{ border: '1px solid rgb(var(--color-border))' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[340px]" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'rgb(var(--color-surface-elevated))' }}>
                  <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'rgb(var(--color-text-muted))' }}>Recurso</th>
                  {PLANS.map(p => (
                    <th key={p.name} className="px-3 py-3 text-[11px] font-bold text-center"
                      style={{ color: p.popular ? 'rgb(var(--color-primary))' : p.accent || 'rgb(var(--color-text-secondary))' }}>
                      {p.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TABLE_ROWS.map((row, ri) => (
                  <tr key={ri} style={{ borderTop: '1px solid rgb(var(--color-border-light))' }}>
                    <td className="px-4 py-3 text-xs font-medium" style={{ color: 'rgb(var(--color-text-secondary))' }}>{row.feature}</td>
                    {row.vals.map((v, vi) => (
                      <td key={vi} className="px-3 py-3 text-center text-xs">
                        {typeof v === 'boolean' ? (
                          v
                            ? <span style={{ color: 'rgb(var(--color-primary))' }}>✓</span>
                            : <span style={{ color: 'rgb(var(--color-text-muted))', opacity: .4 }}>✗</span>
                        ) : (
                          <span className="font-mono font-bold" style={{ color: 'rgb(var(--color-text))' }}>{v}</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Em breve */}
      <div className="mt-10 rounded-2xl p-6" style={{ background: 'rgb(var(--color-surface-elevated))', border: '1px solid rgba(16,185,129,.18)' }}>
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold mb-4"
          style={{ background: 'rgba(16,185,129,.08)', color: 'rgb(var(--color-primary))', border: '1px solid rgba(16,185,129,.2)' }}>
          🚀 EM BREVE
        </div>
        <h3 className="font-display font-bold text-xl leading-snug mb-2">
          Mais poder para seus áudios
        </h3>
        <p className="text-sm font-light mb-4" style={{ color: 'rgb(var(--color-text-secondary))' }}>
          Novas funcionalidades chegando em breve. Quer ser o primeiro a saber?
        </p>
        <div className="grid grid-cols-2 gap-2.5 mb-5">
          {[
            { icon: '👥', label: 'Resumo de Grupos' },
            { icon: '✅', label: 'Tarefas e Planner de áudios' },
            { icon: '🗓️', label: 'Organização e Calendário' },
            { icon: '🔗', label: 'Integração com Sistemas' },
          ].map((f, i) => (
            <div key={i} className="flex items-center gap-2 text-xs rounded-xl px-3 py-2.5"
              style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgb(var(--color-border))', color: 'rgb(var(--color-text-muted))' }}>
              <span>{f.icon}</span>
              <span>{f.label}</span>
            </div>
          ))}
        </div>
        {waitlistDone ? (
          <p className="text-sm font-semibold text-center" style={{ color: 'rgb(var(--color-primary))' }}>
            ✓ Anotado! Você será o primeiro a saber.
          </p>
        ) : (
          <div className="flex gap-2">
            <input
              type="email"
              value={waitlistEmail}
              onChange={e => setWaitlistEmail(e.target.value)}
              placeholder="Seu melhor e-mail"
              className="flex-1 rounded-xl px-4 py-2.5 text-sm outline-none"
              style={{ border: '1.5px solid rgb(var(--color-border))', background: 'rgb(var(--color-surface))', color: 'rgb(var(--color-text))' }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitWaitlist(); } }}
            />
            <button
              disabled={waitlistLoading || !waitlistEmail.includes('@')}
              onClick={submitWaitlist}
              className="btn-primary px-4 py-2.5 text-sm font-semibold whitespace-nowrap disabled:opacity-50">
              {waitlistLoading ? '...' : 'Me avise'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
