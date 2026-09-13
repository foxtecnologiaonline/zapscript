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
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-6 animate-pulse">
        <div className="h-6 bg-neutral-700 rounded w-1/3 mb-4" />
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-4 bg-neutral-700 rounded w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (!checklist) return null;

  const progressPercent = Math.round(checklist.progress * 100);

  return (
    <div className={`rounded-xl border ${checklist.allComplete ? 'border-emerald-800/60 bg-emerald-950/20' : 'border-amber-800/60 bg-amber-950/20'} p-6`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-neutral-100 flex items-center gap-2">
          🚀 Quick Start — {progressPercent}%
        </h3>
        {checklist.allComplete && <span className="text-sm text-emerald-400 font-medium">✅ Completo!</span>}
      </div>

      {/* Progress Bar */}
      <div className="mb-6">
        <div className="w-full h-2 bg-neutral-800 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              checklist.allComplete ? 'bg-emerald-500' : 'bg-amber-500'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="text-xs text-neutral-500 mt-2">
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
                ? 'border-emerald-800/40 bg-emerald-950/20'
                : 'border-neutral-700 bg-neutral-900/50 hover:bg-neutral-800/50'
            }`}
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <span className="text-lg flex-shrink-0">{item.icon}</span>
              <span className={`text-sm font-medium ${item.completed ? 'text-emerald-400' : 'text-neutral-300'}`}>
                {item.label}
              </span>
              {item.completed && <span className="text-xs text-emerald-400 ml-auto flex-shrink-0">✓</span>}
            </div>

            {!item.completed && item.action && (
              <Link
                href={item.action.href}
                className="ml-2 flex-shrink-0 text-xs text-emerald-400 hover:text-emerald-300 underline font-medium"
              >
                {item.action.label}
              </Link>
            )}
          </div>
        ))}
      </div>

      {/* Next Step */}
      {!checklist.allComplete && (
        <div className="rounded-lg bg-neutral-800/50 p-3 text-sm text-neutral-300">
          <span className="font-medium">Próximo passo: </span>
          {checklist.items.find((i) => !i.completed)?.label || 'Continue configurando!'}
        </div>
      )}

      {checklist.allComplete && (
        <div className="rounded-lg border border-emerald-800 bg-emerald-950/30 p-3 text-sm text-emerald-300 text-center font-medium">
          ✨ Parabéns! Seu Atende está pronto. Clientes agora recebem respostas automáticas.
        </div>
      )}
    </div>
  );
}
