'use client';
import { useState } from 'react';

interface ConfidenceSliderPreviewProps {
  currentConfidence?: number;
  totalFAQs?: number;
  onConfidenceChange?: (newLevel: 'conservador' | 'equilibrado' | 'autonomo') => void;
}

export default function ConfidenceSliderPreview({
  currentConfidence = 60,
  totalFAQs = 12,
  onConfidenceChange,
}: ConfidenceSliderPreviewProps) {
  const [threshold, setThreshold] = useState(60);

  // Simular distribuição de respostas baseado no threshold
  const autoRespond = Math.min(100, Math.round(75 + (threshold / 100) * 15));
  const manual = Math.max(0, 100 - autoRespond);

  const getLabel = (value: number): 'conservador' | 'equilibrado' | 'autonomo' => {
    if (value >= 75) return 'conservador';
    if (value >= 40) return 'equilibrado';
    return 'autonomo';
  };

  const getRecommendation = (value: number) => {
    if (value >= 75) return '⭐ Mais seguro, escalas mais (recomendado para clientes VIP)';
    if (value >= 40) return '⭐ Balanço ideal (recomendado para maioria)';
    return '⭐ Mais rápido, pode errar mais (recomendado para FAQ >50 items)';
  };

  function handleSliderChange(e: React.ChangeEvent<HTMLInputElement>) {
    const newValue = parseInt(e.target.value, 10);
    setThreshold(newValue);
    onConfidenceChange?.(getLabel(newValue));
  }

  return (
    <div className="rounded-xl border border-blue-800/60 bg-blue-950/20 p-6">
      <h3 className="text-lg font-semibold text-neutral-100 mb-4">
        🎚️ Nível de Confiança
      </h3>

      <p className="text-sm text-neutral-400 mb-6">
        Escolha como o bot deve responder. Com {totalFAQs} FAQs na base:
      </p>

      {/* Slider */}
      <div className="mb-6">
        <input
          type="range"
          min="20"
          max="85"
          value={threshold}
          onChange={handleSliderChange}
          className="w-full h-2 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
        />

        <div className="flex items-center justify-between mt-3">
          <span className="text-xs text-neutral-500">Autônomo (responde mais)</span>
          <span className="text-sm font-bold text-blue-400">{threshold}%</span>
          <span className="text-xs text-neutral-500">Conservador (escala mais)</span>
        </div>
      </div>

      {/* Presets */}
      <div className="grid grid-cols-3 gap-2 mb-6">
        {[
          { label: 'Autônomo', value: 40, emoji: '⚡' },
          { label: 'Equilibrado', value: 60, emoji: '⚖️' },
          { label: 'Conservador', value: 75, emoji: '🛡️' },
        ].map((preset) => (
          <button
            key={preset.value}
            onClick={() => {
              setThreshold(preset.value);
              onConfidenceChange?.(getLabel(preset.value));
            }}
            className={`rounded-lg p-2 text-sm font-medium transition-colors ${
              Math.abs(threshold - preset.value) < 5
                ? 'bg-blue-600 text-white'
                : 'border border-neutral-700 bg-neutral-900/50 text-neutral-300 hover:border-neutral-600'
            }`}
          >
            {preset.emoji} {preset.label}
          </button>
        ))}
      </div>

      {/* Recomendação */}
      <div className="rounded-lg border border-emerald-800/40 bg-emerald-950/30 p-3 mb-6">
        <p className="text-sm text-emerald-300">{getRecommendation(threshold)}</p>
      </div>

      {/* Previsão de comportamento */}
      <div className="rounded-lg border border-neutral-700 bg-neutral-900/50 p-4">
        <div className="text-sm font-medium text-neutral-300 mb-3">Com essa configuração:</div>

        <div className="space-y-3">
          {/* Responder automático */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-emerald-400">🟢 Responderá automático</span>
              <span className="text-xs font-bold text-emerald-400">{autoRespond}%</span>
            </div>
            <div className="w-full h-2 bg-neutral-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-600 transition-all"
                style={{ width: `${autoRespond}%` }}
              />
            </div>
          </div>

          {/* Precisará manual */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-amber-400">🟡 Precisará revisão humana</span>
              <span className="text-xs font-bold text-amber-400">{manual}%</span>
            </div>
            <div className="w-full h-2 bg-neutral-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-600 transition-all"
                style={{ width: `${manual}%` }}
              />
            </div>
          </div>
        </div>

        <p className="text-xs text-neutral-500 mt-3">
          Baseado no histórico de {totalFAQs} perguntas frequentes cadastradas
        </p>
      </div>
    </div>
  );
}
