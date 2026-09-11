'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface TemplateStats {
  templateName: string;
  campanhas: number;
  audienceCount: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  optout: number;
  successRate: number | null;
  failureRate: number | null;
  optoutRate: number | null;
}

function pct(v: number | null): string {
  if (v === null) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

export default function CampanhasPerformancePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TemplateStats[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<{ templates: TemplateStats[] }>('/modules/campanhas/performance');
        setTemplates(res.templates || []);
      } catch (e: any) {
        if (e?.statusCode !== 401) setError(e?.message || 'Não foi possível carregar a performance.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="min-h-screen px-5 py-10">
      <div className="max-w-4xl mx-auto">
        <Link href="/dashboard/campanhas" className="text-sm text-brand-muted hover:text-brand-text">← Campanhas</Link>

        <header className="mt-2 mb-6">
          <h1 className="text-2xl font-bold text-brand-text">📈 Performance por template</h1>
          <p className="text-brand-text-secondary mt-1 text-sm">
            Agregado entre todas as suas campanhas via API oficial da Meta — ajuda a ver qual
            template converte melhor e qual está gerando mais falha/opt-out.
          </p>
        </header>

        {error && (
          <div className="mb-6 rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-red-600">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-brand-text-secondary">Carregando…</p>
        ) : templates.length === 0 ? (
          <div className="rounded-xl border border-brand-border bg-brand-elevated p-8 text-center text-brand-muted">
            Ainda não há campanhas via Meta com template suficientes pra comparar.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-brand-border">
            <table className="w-full text-sm">
              <thead className="bg-brand-elevated text-brand-text-secondary text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Template</th>
                  <th className="px-3 py-2 font-medium text-right">Campanhas</th>
                  <th className="px-3 py-2 font-medium text-right">Audiência</th>
                  <th className="px-3 py-2 font-medium text-right">Sucesso</th>
                  <th className="px-3 py-2 font-medium text-right">Falha</th>
                  <th className="px-3 py-2 font-medium text-right">Opt-out</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-border">
                {templates.map((t) => (
                  <tr key={t.templateName}>
                    <td className="px-3 py-2 text-brand-text">{t.templateName}</td>
                    <td className="px-3 py-2 text-right text-brand-muted">{t.campanhas}</td>
                    <td className="px-3 py-2 text-right text-brand-muted">{t.audienceCount}</td>
                    <td className="px-3 py-2 text-right text-emerald-600">{pct(t.successRate)}</td>
                    <td className="px-3 py-2 text-right text-red-500">{pct(t.failureRate)}</td>
                    <td className="px-3 py-2 text-right text-amber-600">{pct(t.optoutRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
