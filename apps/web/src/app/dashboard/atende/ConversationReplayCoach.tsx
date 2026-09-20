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
        <h3 className="text-lg font-semibold text-brand-text flex items-center gap-2">
          🎬 Replay: Por quê o bot respondeu assim?
        </h3>
        {onClose && (
          <button
            onClick={onClose}
            className="text-brand-text-secondary hover:text-brand-text text-xl"
          >
            ✕
          </button>
        )}
      </div>

      {/* Cliente mensagem */}
      <div className="mb-4 p-3 rounded-lg bg-brand-surface border border-brand-border">
        <div className="text-xs text-brand-muted mb-1">Cliente perguntou:</div>
        <p className="text-brand-text">"{clientMessage}"</p>
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
                    : 'border-brand-border bg-brand-surface/50 hover:bg-brand-elevated/50'
                }`}
              >
                <button
                  onClick={() => setExpandedFAQ(expandedFAQ === faq.id ? null : faq.id)}
                  className="w-full text-left p-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-brand-text-secondary truncate">FAQ #{faq.id}</p>
                      <p className="text-xs text-brand-muted mt-1 truncate">
                        "{faq.question}"
                      </p>
                    </div>
                    <div className="flex-shrink-0 ml-2 text-blue-400 font-medium text-sm">
                      {Math.round(faq.score * 100)}%
                    </div>
                  </div>
                </button>

                {expandedFAQ === faq.id && (
                  <div className="border-t border-brand-border p-3 bg-brand-elevated/50">
                    <p className="text-xs text-brand-text-secondary">
                      Similaridade: {Math.round(faq.score * 100)}% das palavras coincidem
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg bg-brand-surface border border-brand-border p-3">
            <p className="text-sm text-brand-text-secondary">
              ❌ Nenhuma pergunta na FAQ coincidia com a pergunta do cliente
            </p>
          </div>
        )}
      </div>

      {/* Confiança */}
      <div className="mb-4 p-3 rounded-lg bg-brand-surface border border-brand-border">
        <div className="flex items-center justify-between">
          <span className="text-sm text-brand-text-secondary">Confiança da resposta:</span>
          <span className={`font-bold ${
            botConfidence >= 70 ? 'text-brand-primary' :
            botConfidence >= 40 ? 'text-amber-400' :
            'text-red-400'
          }`}>
            {Math.round(botConfidence)}%
          </span>
        </div>
      </div>

      {/* Resposta */}
      <div className="mb-4 p-3 rounded-lg bg-brand-surface border border-brand-border">
        <div className="text-xs text-brand-muted mb-2">Bot respondeu:</div>
        <p className="text-brand-text text-sm">"{botResponse}"</p>
      </div>

      {/* Dica */}
      <div className="rounded-lg border border-brand-primary/40 bg-brand-primary/10 p-3">
        <div className="text-sm font-medium text-brand-primary mb-2">💡 Como melhorar:</div>
        <p className="text-xs text-brand-primary">
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
