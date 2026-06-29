'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { trackOnce } from '@/lib/analytics';
import OnboardingBanner from './OnboardingBanner';

interface Stats {
  transcriptionsToday: number;
  transcriptionsMonth: number;
  transcriptionsTotal: number;
  minutesUsed: number;
  minutesAvailable: number;
  minutesTotal: number;
  minutesPct: number;
  activeNumbers: number;
  avgConfidence: number;
  planName: string;   // slug: 'free' | 'pro' | 'ultra' | 'executive'
  planLabel: string;  // exibível: 'Grátis' | 'Pro' | 'Ultra' | 'Executive'
  planStatus: string;
  refCode: string | null;
  renewAt: string | null;
  // ── Métrica primária: áudios ──
  audiosUsed: number;
  audiosQuota: number;
  audiosUnlimited: boolean;
  audiosPct: number;
  effectivePlan: 'pro' | 'free';
  // ── Trial freemium ──
  isTrial: boolean;
  trialEndsAt: string | null;
  trialDaysLeft: number | null;
  cardOnFile: boolean;   // cartão garantido p/ cobrança em D+7
  // ── Tempo economizado no mês (C3) ──
  savedSecondsMonth: number;
  savedLabelMonth: string;
}

export default function DashboardPage() {
  const [stats, setStats]     = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    api.get<Stats>('/dashboard/stats')
      .then(s => {
        setStats(s);
        // Ativação = usuário já realizou ao menos 1 conversão. Dispara 1x por navegador.
        if ((s?.transcriptionsTotal ?? 0) >= 1) trackOnce('activation', 'activation');
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-brand-muted">
      <div className="text-center">
        <svg className="w-8 h-8 mx-auto mb-2 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round"/>
        </svg>
        <div className="text-sm">Carregando...</div>
      </div>
    </div>
  );

  if (loadError) return (
    <div className="flex items-center justify-center h-64 text-brand-muted">
      <div className="text-center">
        <div className="text-3xl mb-3">⚠️</div>
        <div className="text-sm text-brand-text mb-3">Não foi possível carregar o dashboard.</div>
        <button onClick={() => { setLoadError(false); setLoading(true); window.location.reload(); }}
          className="btn-ghost text-xs px-4 py-2">Tentar novamente</button>
      </div>
    </div>
  );

  const kpis = stats ? [
    {
      label: 'Conversões',
      value: stats.transcriptionsTotal,
      icon: '📝',
      sub: `${stats.transcriptionsToday} hoje`,
    },
    {
      label: 'Áudios lidos',
      value: `${stats.audiosUsed}`,
      icon: '🎧',
      sub: stats.audiosUnlimited ? 'ilimitado' : `de ${stats.audiosQuota}/mês`,
    },
    { label: 'Precisão',        value: '99%',                  icon: '🎯' },
    { label: 'Números ativos',  value: stats.activeNumbers,    icon: '📱' },
  ] : [];

  return (
    <div className="p-4 sm:p-8 max-w-5xl">
      <div className="mb-7">
        <h1 className="text-2xl font-bold text-brand-text">Dashboard</h1>
        <p className="text-sm text-brand-text-secondary font-light mt-1">Visão geral da sua operação</p>
      </div>

      {/* ── Trial PRO (7 dias): contagem regressiva + CTA ── */}
      {stats?.isTrial && (
        <Link href={stats.cardOnFile ? '/dashboard/plano' : '/dashboard/plano?trialcard=1'}
          className="flex items-center gap-3 rounded-xl px-4 py-3 mb-6 hover:opacity-90 transition-opacity"
          style={{ background: 'linear-gradient(90deg, rgba(16,185,129,.14), rgba(16,185,129,.04))', border: '1px solid rgba(16,185,129,.3)' }}>
          <span className="text-lg flex-shrink-0">{stats.cardOnFile ? '🔒' : '✨'}</span>
          <p className="text-xs text-brand-text flex-1">
            <span className="font-bold text-brand-primary">
              {stats.trialDaysLeft === 0
                ? 'Seu Pro termina hoje.'
                : `Faltam ${stats.trialDaysLeft} dia${stats.trialDaysLeft !== 1 ? 's' : ''} do seu Pro.`}
            </span>{' '}
            {stats.cardOnFile ? (
              <>Pro garantido — a 1ª cobrança será só ao fim do teste. Cancele antes e não paga nada.</>
            ) : (stats.trialDaysLeft ?? 99) <= 1 && stats.savedSecondsMonth > 0 ? (
              /* D6 — no fim do trial, reforça o valor já entregue */
              <>Você já economizou <strong className="text-brand-primary">{stats.savedLabelMonth}</strong> este mês. <strong>Garanta seu Pro</strong> e não perca o acesso.</>
            ) : (
              <>Áudios ilimitados e Modo Privado ativos. <strong>Garanta seu Pro</strong> antes que o teste acabe.</>
            )}
          </p>
          <span className="text-brand-primary text-xs font-bold flex-shrink-0">
            {stats.cardOnFile ? 'Gerenciar →' : 'Garantir meu Pro →'}
          </span>
        </Link>
      )}

      {/* ── 50% off no 1º mês (Free → Pro), oferta permanente ── */}
      {stats?.planName === 'free' && !stats?.isTrial && (
        <Link href="/dashboard/plano"
          className="flex items-center gap-3 rounded-xl px-4 py-3 mb-6 hover:opacity-90 transition-opacity"
          style={{ background: 'linear-gradient(90deg, rgba(16,185,129,.12), rgba(245,158,11,.08))', border: '1px solid rgba(16,185,129,.25)' }}>
          <span className="text-lg flex-shrink-0">🔥</span>
          <p className="text-xs text-brand-text flex-1">
            <span className="font-bold text-brand-primary">50% OFF no 1º mês:</span>{' '}
            assine o Pro por <strong>R$19,90</strong> (depois R$39,90/mês).
          </p>
          <span className="text-brand-primary text-xs font-bold flex-shrink-0">Aproveitar →</span>
        </Link>
      )}

      {/* ── Onboarding Banner (até conectar 1º número) ── */}
      <OnboardingBanner
        hasNumber={(stats?.activeNumbers ?? 0) > 0}
        hasTranscription={(stats?.transcriptionsTotal ?? 0) > 0}
      />

      {/* ── KPI HERO: tempo economizado (valor entregue, acumulando) ── */}
      {stats && stats.savedSecondsMonth > 0 && (
        <div className="rounded-2xl px-5 py-5 mb-5 flex items-center gap-5"
          style={{ background: 'linear-gradient(110deg, rgba(16,185,129,.16), rgba(16,185,129,.04))', border: '1px solid rgba(16,185,129,.28)' }}>
          <span className="text-3xl sm:text-4xl flex-shrink-0">⏱️</span>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-brand-primary uppercase tracking-wide mb-0.5">Tempo economizado este mês</div>
            <div className="text-3xl sm:text-4xl font-black text-brand-text leading-none">{stats.savedLabelMonth}</div>
            <div className="text-xs text-brand-muted mt-1.5">
              Você leu <strong className="text-brand-text">{stats.transcriptionsMonth}</strong> áudio{stats.transcriptionsMonth !== 1 ? 's' : ''} em vez de ouvir tudo.
              {stats.planName === 'free' && !stats.isTrial && <> Imagine sem limite — <Link href="/dashboard/plano" className="text-brand-primary font-semibold hover:underline">menos de R$1,33/dia</Link>.</>}
            </div>
          </div>
        </div>
      )}

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {kpis.map(k => (
          <div key={k.label} className="card p-4 hover:border-brand-primary/20 transition-colors">
            <div className="flex items-center gap-1.5 text-xs text-brand-muted font-medium mb-2">
              <span>{k.icon}</span>{k.label}
            </div>
            <div className="text-3xl font-black leading-none text-brand-primary">{k.value}</div>
            {k.sub && <div className="text-xs text-brand-muted mt-1">{k.sub}</div>}
          </div>
        ))}
      </div>

      {/* ── Privacidade (abaixo dos KPIs) ── */}
      <div className="flex items-center gap-3 rounded-xl px-4 py-3 mb-7"
        style={{
          background: 'rgba(16,185,129,.05)',
          border: '1px solid rgba(16,185,129,.15)',
        }}>
        <span className="text-base flex-shrink-0">🔒</span>
        <p className="text-[11px] text-brand-muted leading-relaxed">
          <span className="font-semibold text-brand-primary">Seus dados estão protegidos.</span>
          {' '}Áudio nunca armazenado · Conversões criptografadas · Processamento via Whisper (OpenAI) e Claude (Anthropic).
        </p>
      </div>

      {/* ── Cards secundários ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Plano */}
        {stats && (
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <span className="font-bold text-sm text-brand-text">Plano {stats.planLabel ?? stats.planName}</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand-primary/10 text-brand-primary border border-brand-primary/20">
                {stats.planStatus === 'active' ? 'Ativo' : stats.planStatus}
              </span>
            </div>
            {stats.audiosUnlimited ? (
              <>
                <div className="text-2xl font-black text-brand-primary leading-none">{stats.audiosUsed}</div>
                <div className="text-xs text-brand-muted mb-3">áudios lidos · <strong className="text-brand-primary">ilimitado</strong></div>
              </>
            ) : (
              <>
                <div className="text-2xl font-black text-brand-primary leading-none">{stats.audiosUsed}</div>
                <div className="text-xs text-brand-muted mb-3">de {stats.audiosQuota} áudios/mês</div>
                <div className="h-2 bg-brand-elevated rounded-full overflow-hidden mb-1">
                  <div className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${stats.audiosPct}%`,
                      background: stats.audiosPct >= 90
                        ? 'linear-gradient(90deg, #f87171, #ef4444)'
                        : stats.audiosPct >= 70
                          ? 'linear-gradient(90deg, #fbbf24, #f59e0b)'
                          : 'linear-gradient(90deg, rgba(var(--color-primary)/.45), rgb(var(--color-primary)))',
                    }} />
                </div>
                <div className="flex justify-between text-[10px] text-brand-muted mb-3">
                  <span>{stats.audiosPct}% usado</span>
                  <span>{Math.max(0, stats.audiosQuota - stats.audiosUsed)} restantes</span>
                </div>
              </>
            )}
            {/* Alerta contextual — perto de esgotar a cota de áudios (FREE) */}
            {!stats.audiosUnlimited && stats.audiosPct >= 80 && (
              <div className={`flex items-start gap-2 text-[11px] mb-3 px-2.5 py-2 rounded-lg ${
                stats.audiosPct >= 100 ? 'bg-red-400/10 text-red-400 border border-red-400/20'
                                       : 'bg-amber-400/10 text-amber-500 border border-amber-400/20'}`}>
                <span className="mt-px">{stats.audiosPct >= 100 ? '🚨' : '⚠️'}</span>
                <span className="leading-snug">
                  {stats.audiosPct >= 100
                    ? <>Você usou seus <strong>{stats.audiosQuota} áudios</strong> do mês.</>
                    : <>Você já usou <strong>{stats.audiosPct}%</strong> dos seus áudios.</>}
                  {' '}Leia sem limite por <strong>menos de R$1,33/dia</strong> e não volte a ouvir áudio.
                </span>
              </div>
            )}
            {/* Renovação — só planos pagos (oculto durante o trial) */}
            {stats.renewAt && stats.planName !== 'free' && !stats.isTrial && (() => {
              const today    = new Date(); today.setHours(0,0,0,0);
              const renew    = new Date(stats.renewAt); renew.setHours(0,0,0,0);
              const daysLeft = Math.round((renew.getTime() - today.getTime()) / (1000*60*60*24));
              const urgent   = daysLeft <= 7;
              return (
                <div className={`flex items-center gap-1.5 text-[10px] mb-3 px-2 py-1.5 rounded-lg ${urgent ? 'bg-red-400/8 text-red-400' : 'bg-brand-elevated text-brand-muted'}`}>
                  <span>🔄</span>
                  <span>
                    Renova em{' '}
                    <strong className={urgent ? 'text-red-400' : 'text-brand-text-secondary'}>
                      {renew.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                    </strong>
                    {' · '}
                    <span className={urgent ? 'font-semibold' : ''}>
                      {daysLeft > 0 ? `${daysLeft} dia${daysLeft !== 1 ? 's' : ''}` : 'Vence hoje'}
                    </span>
                  </span>
                </div>
              );
            })()}
            <Link href="/dashboard/plano" className="btn-primary block w-full text-center text-sm py-2">
              {stats.isTrial ? 'Assinar Pro' : stats.planName === 'free' ? 'Fazer Upgrade' : 'Gerenciar Plano'}
            </Link>
          </div>
        )}

        {/* Início Rápido — visível até completar todos os passos */}
        {(stats?.activeNumbers ?? 0) > 0 && (stats?.transcriptionsTotal ?? 0) === 0 && (
          <div className="card p-5">
            <div className="font-bold text-sm mb-3 text-brand-text">Início Rápido</div>
            {[
              { done: true,                                   label: 'Conta criada' },
              { done: (stats?.activeNumbers ?? 0) > 0,       label: 'Número conectado' },
              { done: (stats?.transcriptionsTotal ?? 0) > 0, label: 'Primeira conversão' },
            ].map((s, i) => (
              <div key={i} className="flex items-center gap-2.5 mb-2.5">
                <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] flex-shrink-0 ${
                  s.done ? 'bg-brand-primary text-white' : 'border border-brand-border'
                }`}>
                  {s.done ? '✓' : ''}
                </span>
                <span className={`text-xs ${s.done ? 'text-brand-muted line-through' : 'text-brand-text'}`}>
                  {s.label}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Indicação com link pessoal */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">🎁</span>
            <div className="font-bold text-sm text-brand-text">Indique o ZapScript</div>
          </div>
          <p className="text-xs text-brand-text-secondary mb-3 leading-relaxed">
            Indique um amigo e <strong className="text-brand-primary">ganhe 5 áudios grátis para você e sua indicação</strong> quando ele se cadastrar.
          </p>
          {stats?.refCode && (
            <div className="flex gap-2 mb-3">
              <input
                readOnly
                className="field-input flex-1 font-mono text-xs"
                value={`zapscript.me/cadastro?ref=${stats.refCode}`}
              />
              <button
                className="btn-primary text-xs px-3 py-2 flex-shrink-0"
                onClick={() => {
                  navigator.clipboard.writeText(`https://www.zapscript.me/cadastro?ref=${stats.refCode}`);
                }}>
                Copiar
              </button>
            </div>
          )}
          <button
            onClick={() => {
              const link = `https://www.zapscript.me/cadastro?ref=${stats?.refCode ?? ''}`;
              const msg  = `Eu uso o ZapScript para converter áudios do WhatsApp automaticamente com IA — e você ganha 5 áudios grátis ao se cadastrar pelo meu link: ${link}`;
              if (navigator.share) {
                navigator.share({ text: msg, url: link }).catch(() => {});
              } else {
                navigator.clipboard.writeText(msg);
              }
            }}
            className="btn-ghost w-full text-center text-xs py-2">
            📤 Compartilhar link
          </button>
        </div>

      </div>
    </div>
  );
}
