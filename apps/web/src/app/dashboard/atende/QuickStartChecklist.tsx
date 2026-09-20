'use client';
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';

interface ChecklistItem {
  id: string;
  label: string;
  completed: boolean;
  icon: string;
  action?: { label: string; href: string };
}

interface ChecklistData {
  items: ChecklistItem[];
  progress: number;
  allComplete: boolean;
}

export default function QuickStartChecklist() {
  const [checklist, setChecklist] = useState<ChecklistData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchChecklist();
  }, []);

  async function fetchChecklist() {
    try {
      const data = await api.get<ChecklistData>('/atende/setup-status');
      setChecklist(data);
    } catch (e) {
      console.error('Failed to fetch checklist:', e);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-brand-border bg-brand-surface p-6 animate-pulse">
        <div className="h-6 bg-brand-border rounded w-1/3 mb-4" />
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-4 bg-brand-border rounded w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (!checklist) return null;

  const progressPercent = Math.round(checklist.progress * 100);

  return (
    <div className={`rounded-xl border ${checklist.allComplete ? 'border-brand-primary/60 bg-brand-primary/10' : 'border-amber-400/30 bg-amber-400/10'} p-6`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-brand-text flex items-center gap-2">
          🚀 Quick Start — {progressPercent}%
        </h3>
        {checklist.allComplete && <span className="text-sm text-brand-primary font-medium">✅ Completo!</span>}
      </div>

      {/* Progress Bar */}
      <div className="mb-6">
        <div className="w-full h-2 bg-brand-elevated rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              checklist.allComplete ? 'bg-brand-primary' : 'bg-amber-500'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="text-xs text-brand-muted mt-2">
          {checklist.items.filter((i) => i.completed).length}/{checklist.items.length} etapas completas
        </div>
      </div>

      {/* Checklist Items */}
      <div className="space-y-2 mb-6">
        {checklist.items.map((item) => (
          <div
            key={item.id}
            className={`rounded-lg border p-3 flex items-center justify-between transition-colors ${
              item.completed
                ? 'border-brand-primary/40 bg-brand-primary/10'
                : 'border-brand-border bg-brand-surface/50 hover:bg-brand-elevated/50'
            }`}
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <span className="text-lg flex-shrink-0">{item.icon}</span>
              <span className={`text-sm font-medium ${item.completed ? 'text-brand-primary' : 'text-brand-text-secondary'}`}>
                {item.label}
              </span>
              {item.completed && <span className="text-xs text-brand-primary ml-auto flex-shrink-0">✓</span>}
            </div>

            {!item.completed && item.action && (
              <Link
                href={item.action.href}
                className="ml-2 flex-shrink-0 text-xs text-brand-primary underline font-medium"
              >
                {item.action.label}
              </Link>
            )}
          </div>
        ))}
      </div>

      {/* Next Step */}
      {!checklist.allComplete && (
        <div className="rounded-lg bg-brand-elevated/50 p-3 text-sm text-brand-text-secondary">
          <span className="font-medium">Próximo passo: </span>
          {checklist.items.find((i) => !i.completed)?.label || 'Continue configurando!'}
        </div>
      )}

      {checklist.allComplete && (
        <div className="rounded-lg border border-brand-primary bg-brand-primary/10 p-3 text-sm text-brand-primary text-center font-medium">
          ✨ Parabéns! Seu Atende está pronto. Clientes agora recebem respostas automáticas.
        </div>
      )}
    </div>
  );
}
