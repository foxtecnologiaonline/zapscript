'use client';
import { useState } from 'react';
import Link from 'next/link';
import { CORE_AUDIO_QUOTA, PROFISSIONAL_PRICE_MONTHLY, PROFISSIONAL_PRICE_YEARLY, EMPRESAS_PRICE_MONTHLY, EMPRESAS_PRICE_YEARLY } from '@/lib/promo';

type CmpVal = string | boolean;

interface PlanCommon {
  name: string; label: string; desc: string; feats: string[]; excl: string[];
  popular: boolean; accent: string | null;
}
/** Core (grátis): preço único exibido direto. */
interface FreePlanCard extends PlanCommon { kind: 'free'; price: string; per: string; cta: string; href: string }
/** Planos pagos: "Comprar por X" (anual) em destaque, "ou alugar por Y" (mensal) discreto. */
interface PaidPlanCard extends PlanCommon { kind: 'paid'; buyPrice: string; rentPrice: string }
type PlanCard = FreePlanCard | PaidPlanCard;

const PLANS: PlanCard[] = [
  {
    kind: 'free',
    name: 'core', label: 'Core', price: 'R$0', per: '/mês',
    desc: 'Grátis e completo: converte, resume e protege',
    feats: [
      `Até ${CORE_AUDIO_QUOTA} áudios/mês`,
      '1 número WhatsApp',
      '🎙️ Converte áudio em texto',
      '✨ Resumo com IA',
      '🔒 Modo Privado (opcional)',
      '📋 Histórico, filtros e busca',
    ],
    excl: ['🤖 Atendimento automático'],
    cta: 'Começar grátis', href: '/cadastro', popular: false, accent: null,
  },
  {
    kind: 'paid',
    name: 'profissional', label: 'Profissional',
    buyPrice: PROFISSIONAL_PRICE_YEARLY, rentPrice: PROFISSIONAL_PRICE_MONTHLY,
    desc: 'Sem fidelidade, cancele quando quiser',
    feats: [
      'Tudo do Core, sem limite de áudios',
      '🤖 Atendimento automático 24/7 por IA',
      '📥 Fila de conversas + métricas',
      '📨 Avisos ao cliente (cobrança, agendamento...)',
      '📚 Base de conhecimento própria',
    ],
    excl: [],
    popular: true, accent: '#3b82f6',
  },
  {
    kind: 'paid',
    name: 'empresas', label: 'Empresas',
    buyPrice: EMPRESAS_PRICE_YEARLY, rentPrice: EMPRESAS_PRICE_MONTHLY,
    desc: 'Até 5 usuários incluídos',
    feats: [
      'Tudo do Profissional',
      '📊 CRM — funil de vendas no WhatsApp',
      '✅ Tarefas — designação e controle na equipe',
      '👥 Até 5 usuários com papéis',
    ],
    excl: [],
    popular: false, accent: null,
  },
];

const TABLE_ROWS: { feature: string; vals: CmpVal[] }[] = [
  { feature: 'Áudios/mês',                        vals: [`${CORE_AUDIO_QUOTA}`, 'Ilimitado', 'Ilimitado'] },
  { feature: '🎙️ Transcrição + resumo IA',        vals: [true, true, true] },
  { feature: '🔒 Modo Privado',                    vals: [true, true, true] },
  { feature: '🤖 Atendimento automático 24/7',     vals: [false, true, true] },
  { feature: '📊 CRM (funil de vendas)',           vals: [false, false, true] },
  { feature: '✅ Tarefas (equipe)',                vals: [false, false, true] },
  { feature: '👥 Usuários incluídos',              vals: ['1', '1', 'Até 5'] },
];

export function PricingInteractive() {
  const [showTable, setShowTable] = useState(false);

  return (
    <>
      {/* Plan cards */}
      <div className="flex flex-col gap-4">
        {PLANS.map((plan, i) => {
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
                  ⭐ Mais popular
                </div>
              )}
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="font-display font-bold text-lg">{plan.label}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>{plan.desc}</p>
                </div>
                {plan.kind === 'free' && (
                  <div className="text-right">
                    <span className="font-display font-bold text-2xl" style={{ color: priceCol }}>{plan.price}</span>
                    <span className="text-xs ml-0.5" style={{ color: 'rgb(var(--color-text-muted))' }}>{plan.per}</span>
                  </div>
                )}
              </div>
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
              {plan.kind === 'free' ? (
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
              ) : (
                <>
                  <Link href="/cadastro?cycle=yearly"
                    className="block w-full py-3 rounded-2xl text-sm font-semibold text-center transition-all"
                    style={{
                      background:  plan.popular ? 'rgb(var(--color-primary))' : 'transparent',
                      border:      plan.popular ? 'none' : `1.5px solid ${plan.accent || 'rgb(var(--color-border))'}`,
                      color:       plan.popular ? '#fff' : plan.accent || 'rgb(var(--color-text))',
                      boxShadow:   plan.popular ? 'rgba(16,185,129,.25) 0 4px 14px' : 'none',
                    }}>
                    Comprar por {plan.buyPrice}
                  </Link>
                  <Link href="/cadastro?cycle=monthly"
                    className="block text-center text-xs mt-2 transition-colors"
                    style={{ color: 'rgb(var(--color-text-muted))' }}>
                    ou alugar por {plan.rentPrice}
                  </Link>
                </>
              )}
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
            { icon: '🤖', key: 'atende', name: 'ZapScript Atende', tagline: 'Incluso no plano Profissional', href: '/atende', status: 'bundled' },
            { icon: '📊', key: 'crm', name: 'ZapScript CRM', tagline: 'Incluso no plano Empresas', href: '/crm', status: 'bundled' },
            { icon: '✅', key: 'tarefas', name: 'ZapScript Tarefas', tagline: 'Incluso no plano Empresas', href: '/dashboard/plano', status: 'bundled' },
            { icon: '📣', key: 'campanhas', name: 'ZapScript Campanhas', tagline: 'Disparo em massa compliant via API oficial', href: '/campanhas', status: 'beta' },
            { icon: '💰', key: 'cobranca', name: 'ZapScript Cobrança', tagline: 'Lembrete e cobrança automática via WhatsApp', href: '/cobranca', status: 'planned' },
            { icon: '🗣️', key: 'vendas', name: 'ZapScript Vendas', tagline: 'Grave a visita → vira nota no CRM', href: '/modulos/vendas', status: 'planned' },
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
                  {m.status === 'bundled' && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                      style={{ background: 'rgba(16,185,129,.12)', color: 'rgb(var(--color-primary))' }}>INCLUSO NO PLANO</span>
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
