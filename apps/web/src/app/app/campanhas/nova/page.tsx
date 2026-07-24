'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import ConnectionCard, { MetaConnection } from '../_components/ConnectionCard';

interface MetaTemplateComponent {
  type: string;
  format?: string;
  text?: string;
}

interface MetaTemplate {
  id: string;
  name: string;
  status: string;
  category: string;
  language: string;
  components: MetaTemplateComponent[];
}

function bodyOf(t: MetaTemplate) {
  return t.components?.find((c) => c.type === 'BODY');
}
function headerOf(t: MetaTemplate) {
  return t.components?.find((c) => c.type === 'HEADER');
}
function countVars(text?: string): number {
  if (!text) return 0;
  const nums = [...text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => parseInt(m[1], 10));
  return nums.length ? Math.max(...nums) : 0;
}
function hasComplexHeader(t: MetaTemplate): boolean {
  const h = headerOf(t);
  if (!h) return false;
  if (h.format && h.format !== 'TEXT') return true;
  if (h.format === 'TEXT' && countVars(h.text) > 0) return true;
  return false;
}

export default function NovaCampanhaPage() {
  const router = useRouter();
  const [meta, setMeta] = useState<MetaConnection | null | undefined>(undefined);
  const [templates, setTemplates] = useState<MetaTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (meta === undefined || !meta) return;
    (async () => {
      setLoadingTemplates(true);
      setTemplatesError(null);
      try {
        const res = await api.get<{ templates: MetaTemplate[] }>(
          `/modules/campanhas/templates?whatsappNumberId=${encodeURIComponent(meta.id)}`,
        );
        setTemplates(res.templates || []);
      } catch (e: any) {
        setTemplatesError(e?.message || 'Não foi possível buscar os templates aprovados.');
      } finally {
        setLoadingTemplates(false);
      }
    })();
  }, [meta]);

  const selected = templates.find((t) => t.name === templateName);
  const varCount = selected ? countVars(bodyOf(selected)?.text) : 0;
  const complexHeader = selected ? hasComplexHeader(selected) : false;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!meta || !selected) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.post<{ campanha: { id: string } }>('/modules/campanhas/', {
        name,
        whatsappNumberId: meta.id,
        templateName: selected.name,
        templateLanguage: selected.language,
      });
      router.push(`/app/campanhas/${res.campanha.id}`);
    } catch (err: any) {
      setError(err?.message || 'Não foi possível criar a campanha.');
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 px-5 py-10">
      <div className="max-w-2xl mx-auto">
        <Link href="/app/campanhas" className="text-sm text-neutral-500 hover:text-neutral-300">← Campanhas</Link>
        <h1 className="text-2xl font-bold mt-2 mb-6">Nova campanha</h1>

        <div className="mb-6">
          <ConnectionCard onReady={setMeta} />
        </div>

        {meta && (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-1">Nome da campanha</label>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Promoção de julho"
                className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-emerald-600"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-1">Template aprovado</label>
              {loadingTemplates ? (
                <p className="text-sm text-neutral-500">Buscando templates aprovados na Meta…</p>
              ) : templatesError ? (
                <p className="text-sm text-red-400">{templatesError}</p>
              ) : templates.length === 0 ? (
                <p className="text-sm text-neutral-500">
                  Nenhum template aprovado encontrado. Crie e aguarde aprovação no Gerenciador de Negócios da Meta.
                </p>
              ) : (
                <select
                  required
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-emerald-600"
                >
                  <option value="">Selecione…</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.name}>
                      {t.name} ({t.language})
                    </option>
                  ))}
                </select>
              )}
            </div>

            {selected && (
              <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-4 text-sm">
                <div className="text-neutral-400 mb-1">Prévia do corpo da mensagem:</div>
                <div className="whitespace-pre-wrap text-neutral-200">{bodyOf(selected)?.text}</div>
                {varCount > 0 && (
                  <p className="mt-3 text-emerald-400">
                    {varCount === 1
                      ? 'Este template usa 1 variável — inclua na coluna 3 do seu CSV de contatos.'
                      : `Este template usa ${varCount} variáveis — inclua nas colunas 3 a ${2 + varCount} do seu CSV de contatos, nessa ordem.`}
                  </p>
                )}
                {complexHeader && (
                  <p className="mt-3 text-amber-400">
                    ⚠️ Este template tem cabeçalho com mídia ou variável — não suportado neste fluxo simples. O
                    envio usará apenas o corpo do template.
                  </p>
                )}
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-red-200 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={saving || !selected || !name}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Criando…' : 'Criar campanha (rascunho) →'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
