'use client';
import { useState } from 'react';
import { api } from '@/lib/api';

interface SmartFAQAssistantProps {
  onSuggestionsReceived?: (suggestions: string[]) => void;
}

export default function SmartFAQAssistant({ onSuggestionsReceived }: SmartFAQAssistantProps) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  async function analyzeAndSuggest() {
    if (!question.trim() || !answer.trim()) return;

    setAnalyzing(true);
    try {
      const result = await api.post<{ suggestions: string[] }>('/atende/kb-suggestions', {
        question,
        answer,
      });
      setSuggestions(result.suggestions);
      onSuggestionsReceived?.(result.suggestions);
    } catch (e: any) {
      console.error('Failed to get suggestions:', e);
    } finally {
      setAnalyzing(false);
    }
  }

  function applySuggestion(suggestion: string) {
    const [qSugg, aSugg] = suggestion.split('\n---\n');
    setQuestion(qSugg || question);
    setAnswer(aSugg || answer);
    setSuggestions([]);
  }

  return (
    <div className="rounded-xl border border-blue-800/60 bg-blue-950/20 p-6">
      <h3 className="text-lg font-semibold text-neutral-100 mb-4 flex items-center gap-2">
        🧠 Smart FAQ Assistant
      </h3>

      <p className="text-sm text-neutral-400 mb-4">
        IA analisa sua pergunta e resposta, sugere melhorias de clareza e detalhe.
      </p>

      {/* Pergunta */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-neutral-300 mb-2">Pergunta</label>
        <input
          type="text"
          value={question}
          onChange={(e) => {
            setQuestion(e.target.value);
            setSuggestions([]);
          }}
          placeholder="Ex: Qual é o horário?"
          maxLength={150}
          className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Resposta */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-neutral-300 mb-2">Resposta</label>
        <textarea
          value={answer}
          onChange={(e) => {
            setAnswer(e.target.value);
            setSuggestions([]);
          }}
          placeholder="Ex: Abrimos seg–sex 9h–22h, sábado 10h–21h..."
          maxLength={500}
          rows={3}
          className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-blue-500 resize-y"
        />
      </div>

      {/* Botão */}
      <button
        onClick={analyzeAndSuggest}
        disabled={analyzing || !question.trim() || !answer.trim()}
        className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
      >
        {analyzing ? '🔄 Analisando...' : '💡 Obter Sugestões'}
      </button>

      {/* Sugestões */}
      {suggestions.length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="text-sm font-medium text-blue-300">Sugestões:</div>
          {suggestions.map((s, i) => (
            <div
              key={i}
              className="rounded-lg border border-blue-800/40 bg-blue-950/30 p-3 text-xs text-neutral-300 cursor-pointer hover:bg-blue-950/50 transition-colors"
              onClick={() => applySuggestion(s)}
            >
              <p className="whitespace-pre-wrap">{s}</p>
              <p className="text-blue-400 mt-2 text-[10px]">Clique para aplicar →</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
