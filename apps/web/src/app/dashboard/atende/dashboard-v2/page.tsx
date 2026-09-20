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
    <div className="p-4 sm:p-8 max-w-5xl">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-4xl font-bold mb-2">🤖 Atende Dashboard</h1>
          <p className="text-brand-text-secondary">Controle seu atendente automático por IA</p>
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
            className="w-full rounded-xl border border-brand-primary/60 bg-brand-primary/10 p-6 text-left hover:bg-brand-primary/20 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-brand-text flex items-center gap-2">
                  ⬇️ Criar Pergunta Rápida
                </h3>
                <p className="text-sm text-brand-muted mt-1">Adicione perguntas frequentes sem sair do dashboard</p>
              </div>
              <span className="text-3xl">→</span>
            </div>
          </button>
        )}

        {/* Quick Links */}
        <div className="grid md:grid-cols-3 gap-4 pt-4 border-t border-brand-border">
          <Link
            href="/dashboard/atende/config"
            className="rounded-lg border border-brand-border bg-brand-surface/50 p-4 hover:bg-brand-elevated/50 transition-colors text-center"
          >
            <div className="text-2xl mb-2">⚙️</div>
            <div className="font-medium text-brand-text-secondary">Configurações</div>
            <div className="text-xs text-brand-muted mt-1">Contexto, tom, confiança</div>
          </Link>

          <Link
            href="/dashboard/atende/kb"
            className="rounded-lg border border-brand-border bg-brand-surface/50 p-4 hover:bg-brand-elevated/50 transition-colors text-center"
          >
            <div className="text-2xl mb-2">📚</div>
            <div className="font-medium text-brand-text-secondary">Base de Conhecimento</div>
            <div className="text-xs text-brand-muted mt-1">Gerenciar FAQs</div>
          </Link>

          <Link
            href="/dashboard/atende"
            className="rounded-lg border border-brand-border bg-brand-surface/50 p-4 hover:bg-brand-elevated/50 transition-colors text-center"
          >
            <div className="text-2xl mb-2">💬</div>
            <div className="font-medium text-brand-text-secondary">Conversas</div>
            <div className="text-xs text-brand-muted mt-1">Ver histórico</div>
          </Link>
        </div>

        {/* Footer Info */}
        <div className="rounded-lg border border-brand-border bg-brand-surface/50 p-4 text-center text-sm text-brand-muted">
          <p>Dashboard atualizado em tempo real • Métricas dos últimos 24 horas</p>
        </div>
      </div>
    </div>
  );
}
