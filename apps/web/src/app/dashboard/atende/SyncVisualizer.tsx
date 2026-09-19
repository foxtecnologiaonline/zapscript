'use client';
import { useState, useEffect } from 'react';

interface SyncStep {
  label: string;
  status: 'pending' | 'in-progress' | 'completed' | 'error';
  icon: string;
}

interface SyncVisualizerProps {
  isActive?: boolean;
  onComplete?: () => void;
}

export default function SyncVisualizer({ isActive = false, onComplete }: SyncVisualizerProps) {
  const [steps, setSteps] = useState<SyncStep[]>([
    { label: 'Enviando para IA', status: 'pending', icon: '🔄' },
    { label: 'Indexando para busca', status: 'pending', icon: '📇' },
    { label: 'Ativando em produção', status: 'pending', icon: '⚙️' },
  ]);

  useEffect(() => {
    if (!isActive) return;

    // Simular progresso dos steps
    const timings = [800, 1600, 2400];
    const timers = timings.map((time, idx) =>
      setTimeout(() => {
        setSteps((s) => {
          const updated = [...s];
          updated[idx].status = idx < timings.length - 1 ? 'completed' : 'completed';
          if (idx > 0) updated[idx - 1].status = 'completed';
          return updated;
        });

        if (idx < timings.length - 1) {
          setSteps((s) => {
            const updated = [...s];
            updated[idx + 1].status = 'in-progress';
            return updated;
          });
        } else {
          onComplete?.();
        }
      }, time)
    );

    // Ativar o primeiro step
    setSteps((s) => {
      const updated = [...s];
      updated[0].status = 'in-progress';
      return updated;
    });

    return () => timers.forEach((t) => clearTimeout(t));
  }, [isActive, onComplete]);

  if (!isActive) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="rounded-xl border border-brand-primary bg-brand-elevated p-8 max-w-md w-full">
        <h3 className="text-lg font-semibold text-brand-text mb-6 text-center">
          🔄 Sincronizando...
        </h3>

        <div className="space-y-3">
          {steps.map((step, idx) => (
            <div key={idx} className="flex items-center gap-3">
              <div className="flex-shrink-0">
                {step.status === 'in-progress' && (
                  <span className="inline-block animate-spin">{step.icon}</span>
                )}
                {step.status === 'completed' && (
                  <span className="text-brand-primary">✅</span>
                )}
                {step.status === 'pending' && (
                  <span className="text-brand-muted">○</span>
                )}
                {step.status === 'error' && (
                  <span className="text-red-400">❌</span>
                )}
              </div>

              <div className="flex-1">
                <p className={`text-sm font-medium ${
                  step.status === 'in-progress' ? 'text-brand-primary' :
                  step.status === 'completed' ? 'text-brand-primary' :
                  step.status === 'error' ? 'text-red-400' :
                  'text-brand-muted'
                }`}>
                  {step.label}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 pt-6 border-t border-brand-border">
          <p className="text-xs text-brand-muted text-center">
            Não feche esta janela...
          </p>
        </div>
      </div>
    </div>
  );
}
