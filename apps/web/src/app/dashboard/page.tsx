'use client';
import { useEffect, useState } from 'react';
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

  useEffect(() => {
    Promise.all([
      api.get<Stats>('/dashboard/stats'),
      api.get<{ items: Transcription[] }>('/transcriptions?limit=6'),
    ]).then(([s, t]) => {
      setStats(s);
      setRecent(t.items);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-[#3d6647]">
      <div className="text-center">
        <div className="text-3xl mb-2 animate-spin">⟳</div>
        <div className="text-sm">Carregando...</div>
      </div>
    </div>
  );

  const kpis = stats ? [
    { label: 'Transcrições hoje',  value: stats.transcriptionsToday, icon: '📝', color: 'text-green-400' },
    { label: 'Minutos usados',     value: `${stats.minutesUsed}`,    icon: '⏱', color: 'text-green-400',
      sub: `de ${stats.minutesTotal} min` },
    { label: 'Precisão média',     value: `${stats.avgConfidence}%`, icon: '🎯', color: 'text-green-400' },
    { label: 'Números ativos',     value: stats.activeNumbers,       icon: '📱', color: 'text-green-400' },
  ] : [];

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-7">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-[#7aaa85] font-light mt-1">Visão geral da sua operação</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-7">
        {kpis.map(k => (
          <div key={k.label} className="card p-4 hover:border-[rgba(34,197,94,.22)] transition-colors">
            <div className="flex items-center gap-1.5 text-xs text-[#3d6647] font-medium mb-2">
              <span>{k.icon}</span>{k.label}
            </div>
            <div className={`text-3xl font-black leading-none ${k.color}`}>{k.value}</div>
            {k.sub && <div className="text-xs text-[#3d6647] mt-1">{k.sub}</div>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Recent transcriptions */}
        <div className="lg:col-span-2 card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-[rgba(34,197,94,.10)]">
            <span className="font-bold text-sm">Transcrições Recentes</span>
            <Link href="/dashboard/transcricoes" className="text-xs text-green-400 hover:underline">Ver todas →</Link>
          </div>
          {recent.length === 0 ? (
            <div className="p-10 text-center text-[#3d6647] text-sm">
              <div className="text-3xl mb-3">🎙</div>
              Nenhuma transcrição ainda.<br />Conecte um número para começar.
            </div>
          ) : (
            recent.map(t => (
              <div key={t.id} onClick={() => setSelected(t)}
                className="flex items-start gap-3 px-5 py-3.5 border-b border-[rgba(34,197,94,.06)] cursor-pointer hover:bg-[#101a0d] transition-colors last:border-0">
                <div className="w-9 h-9 rounded-full bg-green-800 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                  {(t.contactName || t.contactPhone)[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-semibold">{t.contactName || t.contactPhone}</span>
                    <span className="text-xs text-[#3d6647] ml-auto">{new Date(t.createdAt).toLocaleDateString('pt-BR')}</span>
                  </div>
                  <p className="text-xs text-[#7aaa85] line-clamp-2 font-light">{t.originalText}</p>
                  <div className="flex gap-2 mt-1.5">
                    <span className="text-[10px] font-bold bg-[#162012] border border-[rgba(34,197,94,.15)] text-green-400 px-2 py-0.5 rounded">
                      🎙 {t.durationSec}s
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Plan card */}
        <div className="flex flex-col gap-4">
          {stats && (
            <div className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <span className="font-bold text-sm">Plano {stats.planName}</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[rgba(34,197,94,.12)] text-green-400 border border-[rgba(34,197,94,.2)]">
                  {stats.planStatus === 'active' ? 'Ativo' : stats.planStatus}
                </span>
              </div>
              <div className="text-2xl font-black text-green-400 leading-none">{stats.minutesUsed}</div>
              <div className="text-xs text-[#3d6647] mb-3">de {stats.minutesTotal} minutos usados</div>
              <div className="h-1.5 bg-[#1c2a17] rounded-full overflow-hidden mb-1">
                <div className="h-full bg-gradient-to-r from-green-700 to-green-400 rounded-full transition-all"
                  style={{ width: `${stats.minutesPct}%` }} />
              </div>
              <div className="flex justify-between text-[10px] text-[#3d6647] mb-4">
                <span>{stats.minutesPct}% usado</span>
                <span>{stats.minutesAvailable.toFixed(1)} min restantes</span>
              </div>
              <Link href="/dashboard/plano" className="btn-primary w-full justify-center text-sm py-2">
                {stats.planName === 'Free' ? 'Fazer Upgrade' : 'Gerenciar Plano'}
              </Link>
            </div>
          )}

          <div className="card p-5">
            <div className="font-bold text-sm mb-3">Início Rápido</div>
            {[
              { done: true,  label: 'Conta criada' },
              { done: stats?.activeNumbers ? true : false, label: 'Número conectado' },
              { done: (stats?.transcriptionsMonth || 0) > 0, label: 'Primeira transcrição' },
            ].map((s, i) => (
              <div key={i} className="flex items-center gap-2.5 mb-2.5">
                <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] flex-shrink-0 ${s.done ? 'bg-green-500 text-[#030d06]' : 'border border-[#3d6647]'}`}>
                  {s.done ? '✓' : ''}
                </span>
                <span className={`text-xs ${s.done ? 'text-[#7aaa85] line-through' : 'text-[#e4f0e8]'}`}>{s.label}</span>
              </div>
            ))}
            {!stats?.activeNumbers && (
              <Link href="/dashboard/numeros" className="btn-ghost w-full justify-center text-xs mt-2 py-2">
                Conectar número →
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Detail modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="bg-[#0b1209] border border-[rgba(34,197,94,.22)] rounded-2xl p-6 max-w-lg w-full shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div>
                <div className="font-bold text-base">{selected.contactName || selected.contactPhone}</div>
                <div className="text-xs text-[#3d6647]">{new Date(selected.createdAt).toLocaleString('pt-BR')}</div>
              </div>
              <button onClick={() => setSelected(null)} className="text-[#3d6647] hover:text-white text-lg">✕</button>
            </div>
            <div className="bg-[#101a0d] border border-[rgba(34,197,94,.10)] rounded-xl p-4 mb-4">
              <div className="text-xs font-bold text-green-400 mb-2">✨ Resumo</div>
              {(selected.summaryBullets as string[]).map((b, i) => (
                <div key={i} className="text-sm text-[#e4f0e8] mb-1">• {b}</div>
              ))}
            </div>
            <div className="bg-[#101a0d] border border-[rgba(34,197,94,.10)] rounded-xl p-4">
              <div className="text-xs font-bold text-[#7aaa85] mb-2">Original</div>
              <p className="text-sm text-[#7aaa85] font-light leading-relaxed italic">"{selected.originalText}"</p>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => navigator.clipboard.writeText(selected.originalText)}
                className="btn-ghost text-xs py-2 flex-1 justify-center">📋 Copiar</button>
              <button onClick={() => setSelected(null)} className="btn-primary text-xs py-2 flex-1 justify-center">Fechar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
