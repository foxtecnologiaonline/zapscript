'use client';
import { useState } from 'react';
import Link from 'next/link';
import { isJunePromoActive, PRO_FULL_PRICE, PRO_PROMO_PRICE } from '@/lib/promo';

type CmpVal = string | boolean;

const PRO_FULL_PRICE_NUM = 37;
const PRO_YEARLY_PRICE_NUM = 355;
const PRO_YEARLY_MONTHLY_EQ = 'R$29';
const PRO_YEARLY_SAVINGS = 'R$88';

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
    name: 'pro', label: 'Pro', price: 'R$18', per: '/1º mês',
    desc: 'Depois R$37/mês',
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

  const [showTable, setShowTable] = useState(false);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('yearly');

  const isYearly = billingCycle === 'yearly';

  function getPlanPrice(plan: typeof plans[number]) {
    if (plan.name !== 'pro') return plan;
    if (isYearly) {
      return {
        ...plan,
        price: PRO_YEARLY_MONTHLY_EQ,
        per: '/mês (anual)',
        desc: `${PRO_YEARLY_PRICE_NUM.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/ano`,
        cta: 'Assinar Pro Anual',
        href: `/cadastro?cycle=yearly`,
      };
    }
    return plan;
  }

  return (
    <>
      {/* Billing cycle toggle */}
      <div className="flex justify-center mb-5">
        <div className="inline-flex rounded-full p-0.5 gap-0.5"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}>
          {(['yearly', 'monthly'] as const).map(cycle => {
            const active = billingCycle === cycle;
            return (
              <button
                key={cycle}
                onClick={() => setBillingCycle(cycle)}
                className="relative px-4 py-2 rounded-full text-xs font-bold transition-all"
                style={{
                  background: active ? 'rgb(var(--color-primary))' : 'transparent',
                  color: active ? '#04130c' : 'rgb(var(--color-text-muted))',
                  boxShadow: active ? '0 2px 8px rgba(16,185,129,.3)' : 'none',
                }}
              >
                {cycle === 'monthly' ? 'Aluguel (mensal)' : 'Compra (anual)'}
                {cycle === 'yearly' && (
                  <span className="ml-1.5 text-[10px] font-black px-1.5 py-0.5 rounded"
                    style={{
                      background: active ? 'rgba(4,19,12,.25)' : 'rgba(16,185,129,.15)',
                      color: active ? '#04130c' : 'rgb(var(--color-primary))',
                    }}>
                    📆 2 meses grátis
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Plan cards */}
      <div className="flex flex-col gap-4">
        {plans.map((basePlan, i) => {
          const plan = getPlanPrice(basePlan);
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
                  {isYearly ? <>📆 2 meses grátis</> : promo ? <>🔥 50% OFF no 1º mês</> : <>⭐ Mais popular</>}
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
              {plan.name === 'pro' && !isYearly && (
                <div className="text-xs font-semibold mb-4" style={{ color: 'rgb(var(--color-primary))' }}>
                  24h trabalhando por você, por apenas R$1,23 ao dia
                </div>
              )}
              {plan.name === 'pro' && isYearly && (
                <div className="flex items-center gap-2 mb-4 rounded-xl px-3 py-2 text-xs"
                  style={{ background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.18)' }}>
                  <span>🤑</span>
                  <span style={{ color: 'rgb(var(--color-primary))' }}>
                    Economize <strong>{PRO_YEARLY_SAVINGS}</strong> em 1 ano — <strong>2 meses grátis</strong> vs mensal
                  </span>
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

      {/* Módulos da Suíte */}
      <div className="mt-10 rounded-2xl p-6" style={{ background: 'rgb(var(--color-surface-elevated))', border: '1px solid rgba(16,185,129,.18)' }}>
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold mb-4"
          style={{ background: 'rgba(16,185,129,.08)', color: 'rgb(var(--color-primary))', border: '1px solid rgba(16,185,129,.2)' }}>
          🧩 MÓDULOS
        </div>
        <h3 className="font-display font-bold text-xl leading-snug mb-2">
          Suíte completa para o seu negócio
        </h3>
        <p className="text-sm font-light mb-5" style={{ color: 'rgb(var(--color-text-secondary))' }}>
          Além da transcrição, o ZapScript tem módulos para cada etapa da sua operação no WhatsApp.
        </p>
        <div className="grid grid-cols-1 gap-2.5">
          {[
            { icon: '🤖', key: 'atende', name: 'ZapScript Atende', tagline: 'Atendimento automático 24/7 no WhatsApp', href: '/atende', status: 'ga' },
            { icon: '💰', key: 'cobranca', name: 'ZapScript Cobrança', tagline: 'Lembrete e cobrança automática via WhatsApp', href: '/cobranca', status: 'beta' },
            { icon: '📣', key: 'campanhas', name: 'ZapScript Campanhas', tagline: 'Disparo em massa compliant via API oficial', href: '/campanhas', status: 'beta' },
            { icon: '📊', key: 'crm', name: 'ZapScript CRM', tagline: 'Funil de vendas dentro do WhatsApp', href: '/crm', status: 'beta' },
            { icon: '🗣️', key: 'vendas', name: 'ZapScript Vendas', tagline: 'Grave a visita → vira nota no CRM', href: '/vendas', status: 'beta' },
            { icon: '🎬', key: 'legenda', name: 'ZapScript Legendas', tagline: 'Legenda automática para Reels e Stories', href: '/legendas', status: 'planned' },
          ].map((m) => (
            <Link key={m.key} href={m.href}
              className="flex items-center gap-3 rounded-xl px-4 py-3 transition-all hover:scale-[1.01]"
              style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgb(var(--color-border))' }}>
              <span className="text-xl flex-shrink-0">{m.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold" style={{ color: 'rgb(var(--color-text))' }}>{m.name}</span>
                  {m.status === 'beta' && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                      style={{ background: 'rgba(245,158,11,.15)', color: 'rgb(245,158,11)' }}>BETA</span>
                  )}
                  {m.status === 'planned' && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                      style={{ background: 'rgba(148,163,184,.12)', color: 'rgb(148,163,184)' }}>EM BREVE</span>
                  )}
                </div>
                <p className="text-xs mt-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>{m.tagline}</p>
              </div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                style={{ color: 'rgb(var(--color-text-muted))', flexShrink: 0 }}>
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
