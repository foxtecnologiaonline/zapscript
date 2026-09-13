'use client';
import { useState } from 'react';
import { api } from '@/lib/api';

interface PDFReportGeneratorProps {
  onReportGenerated?: (url: string) => void;
}

export default function PDFReportGenerator({ onReportGenerated }: PDFReportGeneratorProps) {
  const [days, setDays] = useState(30);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generateReport() {
    setGenerating(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/atende/report?format=pdf&days=${days}`,
        {
          method: 'GET',
          headers: { 'Accept': 'application/pdf' },
        }
      );

      if (!response.ok) throw new Error('Falha ao gerar relatório');

      // Criar blob e download
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `atende-report-${new Date().toISOString().split('T')[0]}.pdf`;
      a.click();
      URL.revokeObjectURL(url);

      onReportGenerated?.(url);
    } catch (e: any) {
      setError(e?.message || 'Erro ao gerar PDF');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="rounded-xl border border-purple-800/60 bg-purple-950/20 p-6">
      <h3 className="text-lg font-semibold text-neutral-100 mb-2 flex items-center gap-2">
        📄 Gerar Relatório
      </h3>

      <p className="text-sm text-neutral-400 mb-6">
        PDF com análise completa de performance do Atende (dados, gráficos, insights)
      </p>

      {/* Seletor de período */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-neutral-300 mb-2">Período</label>
        <div className="grid grid-cols-4 gap-2">
          {[7, 14, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                days === d
                  ? 'bg-purple-600 text-white'
                  : 'border border-neutral-700 bg-neutral-900/50 text-neutral-300 hover:border-neutral-600'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* O que está incluído */}
      <div className="rounded-lg border border-neutral-700 bg-neutral-900/50 p-4 mb-6">
        <div className="text-sm font-medium text-neutral-300 mb-3">Incluído no relatório:</div>
        <ul className="space-y-2 text-xs text-neutral-400">
          <li>✓ Taxa de respostas automáticas vs escaladas</li>
          <li>✓ Distribuição de confiança</li>
          <li>✓ Tempo médio de resposta</li>
          <li>✓ Perguntas mais frequentes</li>
          <li>✓ Recomendações de melhoria</li>
          <li>✓ Comparação com período anterior</li>
        </ul>
      </div>

      {/* Erro */}
      {error && (
        <div className="rounded-lg border border-red-800/40 bg-red-950/30 p-3 mb-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Botões */}
      <div className="flex gap-3">
        <button
          onClick={generateReport}
          disabled={generating}
          className="flex-1 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          {generating ? (
            <>
              <span className="inline-block animate-spin">⏳</span>
              Gerando...
            </>
          ) : (
            <>
              <span>📥</span>
              Baixar PDF
            </>
          )}
        </button>

        <button
          onClick={() => {
            // Compartilhar via email (placeholder)
            alert('Email de compartilhamento seria enviado em produção');
          }}
          className="rounded-lg border border-neutral-700 bg-neutral-900/50 px-4 py-2 text-sm font-medium text-neutral-300 hover:border-neutral-600 transition-colors"
        >
          📧 Compartilhar
        </button>
      </div>

      <p className="text-xs text-neutral-500 mt-4 text-center">
        Relatório gerado em tempo real, sempre atualizado
      </p>
    </div>
  );
}
