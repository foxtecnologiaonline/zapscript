'use client';
import { useState } from 'react';
import Link from 'next/link';
import AtendeToggle from '../AtendeToggle';
import StatusIndicator from '../StatusIndicator';
import QuickStartChecklist from '../QuickStartChecklist';
import InlineFAQBuilder from '../InlineFAQBuilder';

export default function AtendeDashboardV2() {
  const [showFAQBuilder, setShowFAQBuilder] = useState(false);

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 px-5 py-10">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-4xl font-bold mb-2">🤖 Atende Dashboard</h1>
          <p className="text-neutral-400">Controle seu atendente automático por IA</p>
        </div>

        {/* TIER 1 Components */}

        {/* 1. Toggle + Status */}
        <div className="grid md:grid-cols-2 gap-6">
          <AtendeToggle />
          <StatusIndicator />
        </div>

        {/* 2. Quick Start Checklist */}
        <QuickStartChecklist />

        {/* 3. Inline FAQ Builder */}
        {showFAQBuilder ? (
          <InlineFAQBuilder
            onSuccess={() => {
              setShowFAQBuilder(false);
              // Trigger refresh do checklist aqui
            }}
            onCancel={() => setShowFAQBuilder(false)}
          />
        ) : (
          <button
            onClick={() => setShowFAQBuilder(true)}
            className="w-full rounded-xl border border-emerald-800/60 bg-emerald-950/20 p-6 text-left hover:bg-emerald-950/30 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-neutral-100 flex items-center gap-2">
                  ⬇️ Criar Pergunta Rápida
                </h3>
                <p className="text-sm text-neutral-500 mt-1">Adicione perguntas frequentes sem sair do dashboard</p>
              </div>
              <span className="text-3xl">→</span>
            </div>
          </button>
        )}

        {/* Quick Links */}
        <div className="grid md:grid-cols-3 gap-4 pt-4 border-t border-neutral-800">
          <Link
            href="/app/atende/config"
            className="rounded-lg border border-neutral-700 bg-neutral-900/50 p-4 hover:bg-neutral-800/50 transition-colors text-center"
          >
            <div className="text-2xl mb-2">⚙️</div>
            <div className="font-medium text-neutral-300">Configurações</div>
            <div className="text-xs text-neutral-500 mt-1">Contexto, tom, confiança</div>
          </Link>

          <Link
            href="/app/atende/kb"
            className="rounded-lg border border-neutral-700 bg-neutral-900/50 p-4 hover:bg-neutral-800/50 transition-colors text-center"
          >
            <div className="text-2xl mb-2">📚</div>
            <div className="font-medium text-neutral-300">Base de Conhecimento</div>
            <div className="text-xs text-neutral-500 mt-1">Gerenciar FAQs</div>
          </Link>

          <Link
            href="/app/atende"
            className="rounded-lg border border-neutral-700 bg-neutral-900/50 p-4 hover:bg-neutral-800/50 transition-colors text-center"
          >
            <div className="text-2xl mb-2">💬</div>
            <div className="font-medium text-neutral-300">Conversas</div>
            <div className="text-xs text-neutral-500 mt-1">Ver histórico</div>
          </Link>
        </div>

        {/* Footer Info */}
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-4 text-center text-sm text-neutral-500">
          <p>Dashboard atualizado em tempo real • Métricas dos últimos 24 horas</p>
        </div>
      </div>
    </main>
  );
}
