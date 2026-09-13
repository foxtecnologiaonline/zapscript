'use client';
import { useState } from 'react';

interface ReplayCoachProps {
  clientMessage: string;
  botResponse: string;
  botConfidence: number;
  matchedFAQs: Array<{ id: string; question: string; score: number }>;
  onClose?: () => void;
}

export default function ConversationReplayCoach({
  clientMessage,
  botResponse,
  botConfidence,
  matchedFAQs,
  onClose,
}: ReplayCoachProps) {
  const [expandedFAQ, setExpandedFAQ] = useState<string | null>(null);

  return (
    <div className="rounded-xl border border-blue-800/60 bg-blue-950/20 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-neutral-100 flex items-center gap-2">
          🎬 Replay: Por quê o bot respondeu assim?
        </h3>
        {onClose && (
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-200 text-xl"
          >
            ✕
          </button>
        )}
      </div>

      {/* Cliente mensagem */}
      <div className="mb-4 p-3 rounded-lg bg-neutral-900 border border-neutral-800">
        <div className="text-xs text-neutral-500 mb-1">Cliente perguntou:</div>
        <p className="text-neutral-100">"{clientMessage}"</p>
      </div>

      {/* Bot pensou */}
      <div className="mb-4">
        <div className="text-sm font-medium text-blue-300 mb-2">🤔 Bot pensou:</div>

        {matchedFAQs.length > 0 ? (
          <div className="space-y-2">
            {matchedFAQs.map((faq) => (
              <div
                key={faq.id}
                className={`rounded-lg border cursor-pointer transition-colors ${
                  expandedFAQ === faq.id
                    ? 'border-blue-700 bg-blue-950/40'
                    : 'border-neutral-700 bg-neutral-900/50 hover:bg-neutral-800/50'
                }`}
              >
                <button
                  onClick={() => setExpandedFAQ(expandedFAQ === faq.id ? null : faq.id)}
                  className="w-full text-left p-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-neutral-300 truncate">FAQ #{faq.id}</p>
                      <p className="text-xs text-neutral-500 mt-1 truncate">
                        "{faq.question}"
                      </p>
                    </div>
                    <div className="flex-shrink-0 ml-2 text-blue-400 font-medium text-sm">
                      {Math.round(faq.score * 100)}%
                    </div>
                  </div>
                </button>

                {expandedFAQ === faq.id && (
                  <div className="border-t border-neutral-700 p-3 bg-neutral-950/50">
                    <p className="text-xs text-neutral-400">
                      Similaridade: {Math.round(faq.score * 100)}% das palavras coincidem
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg bg-neutral-900 border border-neutral-800 p-3">
            <p className="text-sm text-neutral-400">
              ❌ Nenhuma pergunta na FAQ coincidia com a pergunta do cliente
            </p>
          </div>
        )}
      </div>

      {/* Confiança */}
      <div className="mb-4 p-3 rounded-lg bg-neutral-900 border border-neutral-800">
        <div className="flex items-center justify-between">
          <span className="text-sm text-neutral-400">Confiança da resposta:</span>
          <span className={`font-bold ${
            botConfidence >= 70 ? 'text-emerald-400' :
            botConfidence >= 40 ? 'text-amber-400' :
            'text-red-400'
          }`}>
            {Math.round(botConfidence)}%
          </span>
        </div>
      </div>

      {/* Resposta */}
      <div className="mb-4 p-3 rounded-lg bg-neutral-900 border border-neutral-800">
        <div className="text-xs text-neutral-500 mb-2">Bot respondeu:</div>
        <p className="text-neutral-100 text-sm">"{botResponse}"</p>
      </div>

      {/* Dica */}
      <div className="rounded-lg border border-emerald-800/40 bg-emerald-950/30 p-3">
        <div className="text-sm font-medium text-emerald-300 mb-2">💡 Como melhorar:</div>
        <p className="text-xs text-emerald-200">
          {matchedFAQs.length === 0
            ? 'Adicione uma FAQ com a pergunta do cliente para que o bot saiba como responder no futuro.'
            : botConfidence < 70
              ? 'Melhore a resposta na FAQ correspondente para aumentar a clareza e detalhe.'
              : 'Ótimo! Continue adicionando FAQs baseadas em perguntas reais dos clientes.'}
        </p>
      </div>
    </div>
  );
}
