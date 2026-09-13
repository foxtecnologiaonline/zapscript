'use client';
import { useState } from 'react';
import { api } from '@/lib/api';

interface InlineFAQBuilderProps {
  onSuccess?: () => void;
  onCancel?: () => void;
}

interface FAQQuality {
  score: 'excellent' | 'good' | 'fair' | 'poor';
  issues: string[];
  suggestions: string[];
}

export default function InlineFAQBuilder({ onSuccess, onCancel }: InlineFAQBuilderProps) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [quality, setQuality] = useState<FAQQuality | null>(null);

  async function testQuality() {
    if (!question.trim() || !answer.trim()) return;

    setTesting(true);
    try {
      const result = await api.post<FAQQuality>('/atende/kb-quality', { question, answer });
      setQuality(result);
    } catch (e: any) {
      alert(e?.message || 'Erro ao validar qualidade');
    } finally {
      setTesting(false);
    }
  }

  async function handleSubmit() {
    if (!question.trim() || !answer.trim()) {
      alert('Preencha pergunta e resposta');
      return;
    }

    setSubmitting(true);
    try {
      await api.post('/atende/kb', { question: question.trim(), answer: answer.trim() });
      setQuestion('');
      setAnswer('');
      setQuality(null);
      onSuccess?.();
    } catch (e: any) {
      alert(e?.message || 'Erro ao salvar FAQ');
    } finally {
      setSubmitting(false);
    }
  }

  const qualityColors = {
    excellent: { bg: 'bg-emerald-950/50', border: 'border-emerald-800', text: 'text-emerald-400', badge: '🟢' },
    good: { bg: 'bg-emerald-950/30', border: 'border-emerald-800/60', text: 'text-emerald-300', badge: '🟡' },
    fair: { bg: 'bg-amber-950/30', border: 'border-amber-800/60', text: 'text-amber-300', badge: '🟠' },
    poor: { bg: 'bg-red-950/30', border: 'border-red-800/60', text: 'text-red-300', badge: '🔴' },
  };

  const colors = quality ? qualityColors[quality.score] : qualityColors.excellent;

  return (
    <div className="rounded-xl border border-emerald-800/60 bg-emerald-950/20 p-6">
      <h3 className="text-lg font-semibold text-neutral-100 mb-4 flex items-center gap-2">
        ⬇️ Criar Pergunta Rápida
      </h3>

      {/* Pergunta */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-neutral-300 mb-2">Pergunta do cliente</label>
        <input
          type="text"
          value={question}
          onChange={(e) => {
            setQuestion(e.target.value);
            setQuality(null);
          }}
          placeholder="Ex: Qual é o horário de funcionamento?"
          maxLength={150}
          className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-emerald-500"
        />
        <div className="text-xs text-neutral-500 mt-1">{question.length}/150</div>
      </div>

      {/* Resposta */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-neutral-300 mb-2">Sua resposta</label>
        <textarea
          value={answer}
          onChange={(e) => {
            setAnswer(e.target.value);
            setQuality(null);
          }}
          placeholder="Ex: Abrimos seg–sex 9h–22h, sábado 10h–21h e domingo fechado."
          maxLength={500}
          rows={3}
          className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-emerald-500 resize-y"
        />
        <div className="text-xs text-neutral-500 mt-1">{answer.length}/500</div>
      </div>

      {/* Quality Indicator */}
      {quality && (
        <div className={`rounded-lg border ${colors.border} ${colors.bg} p-4 mb-4`}>
          <div className="flex items-center justify-between mb-3">
            <div className={`font-semibold ${colors.text} flex items-center gap-2`}>
              <span>{colors.badge}</span>
              Qualidade: {quality.score === 'excellent' ? 'Excelente' : quality.score === 'good' ? 'Boa' : quality.score === 'fair' ? 'Razoável' : 'Pobre'}
            </div>
            <button
              type="button"
              onClick={testQuality}
              disabled={testing}
              className="text-xs text-neutral-400 hover:text-neutral-300"
            >
              🔄 Testar novamente
            </button>
          </div>

          {quality.suggestions.length > 0 && (
            <div className="mb-3">
              <div className="text-xs font-medium text-neutral-300 mb-2">💡 Sugestões:</div>
              <ul className="space-y-1">
                {quality.suggestions.map((s, i) => (
                  <li key={i} className="text-xs text-neutral-300">
                    • {s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {quality.issues.length > 0 && (
            <div>
              <div className="text-xs font-medium text-neutral-300 mb-2">⚠️ Pontos a melhorar:</div>
              <ul className="space-y-1">
                {quality.issues.map((issue, i) => (
                  <li key={i} className="text-xs text-neutral-300">
                    • {issue}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Botões */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={testQuality}
          disabled={testing || !question.trim() || !answer.trim()}
          className="flex-1 rounded-lg border border-neutral-700 px-4 py-2 text-sm font-medium text-neutral-300 hover:border-neutral-600 hover:text-neutral-200 disabled:opacity-50 transition-colors"
        >
          {testing ? '🔄 Testando...' : '✓ Testar Qualidade'}
        </button>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || !question.trim() || !answer.trim()}
          className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
        >
          {submitting ? '💾 Salvando...' : '💾 Salvar & Testar'}
        </button>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-neutral-700 px-3 py-2 text-sm font-medium text-neutral-300 hover:border-neutral-600 transition-colors"
          >
            ✕
          </button>
        )}
      </div>

      <div className="text-xs text-neutral-500 mt-3 text-center">
        O bot usará isso para responder perguntas parecidas automaticamente
      </div>
    </div>
  );
}
