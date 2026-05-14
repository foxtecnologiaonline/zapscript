'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface Stats {
  transcriptionsToday: number;
  transcriptionsMonth: number;
  minutesUsed: number;
  minutesAvailable: number;
  minutesTotal: number;
  minutesPct: number;
  activeNumbers: number;
  avgConfidence: number;
  planName: string;
  planStatus: string;
}

interface Transcription {
  id: string;
  contactPhone: string;
  contactName: string | null;
  durationSec: number;
  originalText: string;
  summaryBullets: string[];
  createdAt: string;
  number: { displayName: string | null; phoneNumber: string };
}

export default function DashboardPage() {
  const [stats, setStats]   = useState<Stats | null>(null);
  const [recent, setRecent] = useState<Transcription[]>([]);
  const [selected, setSelected] = useState<Transcription | null>(null);
  const [loading, setLoading]   = useState(true);
  const [loadError, setLoadError] = useState(false);

  const closeModal = useCallback(() => setSelected(null), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeModal(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [closeModal]);

  useEffect(() => {
    Promise.all([
      api.get<Stats>('/dashboard/stats'),
      api.get<{ items: Transcription[] }>('/transcriptions?limit=6'),
    ]).then(([s, t]) => {
      setStats(s);
      setRecent(t.items);
    }).catch(() => setLoadError(true))
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
    { label: 'Transcrições hoje',  value: stats.transcriptionsToday, icon: '📝' },
    { label: 'Minutos usados',     value: `${stats.minutesUsed}`,    icon: '⏱',
      sub: `de ${stats.minutesTotal} min` },
    { label: 'Precisão',           value: '99%',                     icon: '🎯' },
    { label: 'Números ativos',     value: stats.activeNumbers,       icon: '📱' },
  ] : [];

  return (
    <div className="p-4 sm:p-8 max-w-5xl">
      <div className="mb-7">
        <h1 className="text-2xl font-bold text-brand-text">Dashboard</h1>
        <p className="text-sm text-brand-text-secondary font-light mt-1">Visão geral da sua operação</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-7">
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Recent transcriptions */}
        <div className="lg:col-span-2 card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5"
            style={{ borderBottom: '1px solid rgb(var(--color-border))' }}>
            <span className="font-bold text-sm text-brand-text">Transcrições Recentes</span>
            <Link href="/dashboard/transcricoes" className="text-xs text-brand-primary hover:underline">Ver todas →</Link>
          </div>
          {recent.length === 0 ? (
            <div className="p-10 text-center text-brand-muted text-sm">
              <div className="text-3xl mb-3">🎙</div>
              Nenhuma transcrição ainda.<br />Conecte um número para começar.
            </div>
          ) : (
            recent.map(t => (
              <div key={t.id} onClick={() => setSelected(t)}
                className="hover-row flex items-start gap-3 px-5 py-3.5 cursor-pointer last:border-0"
                style={{ borderBottom: '1px solid rgb(var(--color-border) / .5)' }}>
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 mt-0.5"
                  style={{ background: 'rgba(var(--color-primary), .35)' }}>
                  {(t.contactName || t.contactPhone)[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-semibold text-brand-text">{t.contactName || t.contactPhone}</span>
                    <span className="text-xs text-brand-muted ml-auto">{new Date(t.createdAt).toLocaleDateString('pt-BR')}</span>
                  </div>
                  <p className="text-xs text-brand-text-secondary line-clamp-2 font-light">{t.originalText}</p>
                  <div className="flex gap-2 mt-1.5">
                    <span className="text-[10px] font-bold bg-brand-primary/10 border border-brand-primary/15 text-brand-primary px-2 py-0.5 rounded">
                      🎙 {t.durationSec}s
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Plan card + quickstart */}
        <div className="flex flex-col gap-4">
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

          <div className="card p-5">
            <div className="font-bold text-sm mb-3 text-brand-text">Início Rápido</div>
            {[
              { done: true,  label: 'Conta criada' },
              { done: stats?.activeNumbers ? true : false, label: 'Número conectado' },
              { done: (stats?.transcriptionsMonth || 0) > 0, label: 'Primeira transcrição' },
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
            {!stats?.activeNumbers && (
              <Link href="/dashboard/numeros" className="btn-ghost w-full justify-center text-xs mt-2 py-2">
                Conectar número →
              </Link>
            )}
          </div>

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

      {/* Detail modal */}
      {selected && (
        <div role="dialog" aria-modal="true"
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={closeModal}>
          <div className="modal-panel max-w-lg w-full" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div>
                <div className="font-bold text-base text-brand-text">{selected.contactName || selected.contactPhone}</div>
                <div className="text-xs text-brand-muted">{new Date(selected.createdAt).toLocaleString('pt-BR')}</div>
              </div>
              <button onClick={closeModal} className="text-brand-muted hover:text-brand-text text-lg transition-colors" aria-label="Fechar">✕</button>
            </div>
            <div className="inner-block mb-4">
              <div className="text-xs font-bold text-brand-primary mb-2">✨ Resumo</div>
              {(selected.summaryBullets as string[]).map((b, i) => (
                <div key={i} className="text-sm text-brand-text mb-1">• {b}</div>
              ))}
            </div>
            <div className="inner-block">
              <div className="text-xs font-bold text-brand-text-secondary mb-2">Original</div>
              <p className="text-sm text-brand-text-secondary font-light leading-relaxed italic">"{selected.originalText}"</p>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => navigator.clipboard.writeText(selected.originalText)}
                className="btn-ghost text-xs py-2 flex-1 justify-center">📋 Copiar</button>
              <button onClick={closeModal}
                className="btn-primary text-xs py-2 flex-1 justify-center">Fechar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
