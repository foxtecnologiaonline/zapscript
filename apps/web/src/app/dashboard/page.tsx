'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
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
  planName: string;
  planStatus: string;
}

export default function DashboardPage() {
  const [stats, setStats]     = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    api.get<Stats>('/dashboard/stats')
      .then(s => setStats(s))
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
      label: 'Transcrições',
      value: stats.transcriptionsTotal,
      icon: '📝',
      sub: `${stats.transcriptionsToday} hoje`,
    },
    {
      label: 'Minutos usados',
      value: `${stats.minutesUsed}`,
      icon: '⏱',
      sub: `de ${stats.minutesTotal} min`,
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

      {/* ── Onboarding Banner (até conectar 1º número) ── */}
      <OnboardingBanner
        hasNumber={(stats?.activeNumbers ?? 0) > 0}
        hasTranscription={(stats?.transcriptionsTotal ?? 0) > 0}
      />

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
          {' '}Áudio nunca armazenado · Transcrições criptografadas · Processamento via Whisper (OpenAI) e Claude (Anthropic).
        </p>
      </div>

      {/* ── Cards secundários ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Plano */}
        {stats && (
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <span className="font-bold text-sm text-brand-text">Plano {stats.planName}</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand-primary/10 text-brand-primary border border-brand-primary/20">
                {stats.planStatus === 'active' ? 'Ativo' : stats.planStatus}
              </span>
            </div>
            <div className="text-2xl font-black text-brand-primary leading-none">{stats.minutesUsed}</div>
            <div className="text-xs text-brand-muted mb-3">de {stats.minutesTotal} minutos usados</div>
            <div className="h-1.5 bg-brand-elevated rounded-full overflow-hidden mb-1">
              <div className="h-full rounded-full transition-all"
                style={{
                  width: `${stats.minutesPct}%`,
                  background: 'linear-gradient(90deg, rgba(var(--color-primary-light),1), rgb(var(--color-primary)))',
                }} />
            </div>
            <div className="flex justify-between text-[10px] text-brand-muted mb-4">
              <span>{stats.minutesPct}% usado</span>
              <span>{stats.minutesAvailable.toFixed(1)} min restantes</span>
            </div>
            <Link href="/dashboard/plano" className="btn-primary block w-full text-center text-sm py-2">
              {stats.planName === 'Free' ? 'Fazer Upgrade' : 'Gerenciar Plano'}
            </Link>
          </div>
        )}

        {/* Início Rápido — visível somente após ter número conectado */}
        {(stats?.activeNumbers ?? 0) > 0 && (
          <div className="card p-5">
            <div className="font-bold text-sm mb-3 text-brand-text">Início Rápido</div>
            {[
              { done: true,                                   label: 'Conta criada' },
              { done: (stats?.activeNumbers ?? 0) > 0,       label: 'Número conectado' },
              { done: (stats?.transcriptionsTotal ?? 0) > 0, label: 'Primeira transcrição' },
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

        {/* Compartilhar */}
        <div className="card p-5">
          <div className="font-bold text-sm mb-2 text-brand-text">Indique o ZapScript</div>
          <p className="text-xs text-brand-text-secondary mb-4 leading-relaxed">
            Conhece alguém que recebe muitos áudios no WhatsApp? Compartilhe o ZapScript!
          </p>
          <button
            onClick={() => {
              const msg = `Eu uso o ZapScript para transcrever áudios do WhatsApp automaticamente com IA — economizo muito tempo! Você pode criar uma conta gratuita em zapscript.me`;
              if (navigator.share) {
                navigator.share({ text: msg, url: 'https://zapscript.me' }).catch(() => {});
              } else {
                navigator.clipboard.writeText(msg + ' — https://zapscript.me');
              }
            }}
            className="btn-primary w-full text-center text-xs py-2.5">
            📤 Compartilhar com amigos
          </button>
        </div>

      </div>
    </div>
  );
}
