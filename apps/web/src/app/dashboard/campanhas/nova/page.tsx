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

interface EvolutionNumero {
  id: string;
  phoneNumber: string | null;
  displayName: string | null;
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
  const [channel, setChannel] = useState<'meta' | 'evolution'>('meta');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── canal Meta ──────────────────────────────────────────────────────────
  const [meta, setMeta] = useState<MetaConnection | null | undefined>(undefined);
  const [templates, setTemplates] = useState<MetaTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState('');

  useEffect(() => {
    if (channel !== 'meta' || meta === undefined || !meta) return;
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
  }, [channel, meta]);

  const selected = templates.find((t) => t.name === templateName);
  const varCount = selected ? countVars(bodyOf(selected)?.text) : 0;
  const complexHeader = selected ? hasComplexHeader(selected) : false;

  // ── canal Evolution ─────────────────────────────────────────────────────
  const [evoNumeros, setEvoNumeros] = useState<EvolutionNumero[]>([]);
  const [loadingEvoNumeros, setLoadingEvoNumeros] = useState(false);
  const [evoNumeroId, setEvoNumeroId] = useState('');
  const [messageBody, setMessageBody] = useState('');

  // ── A/B test (§15.3) — variante B opcional, só reporta métricas por variante ──
  const [abTestEnabled, setAbTestEnabled] = useState(false);
  const [variantBTemplateName, setVariantBTemplateName] = useState('');
  const [variantBMessageBody, setVariantBMessageBody] = useState('');
  const variantBSelected = templates.find((t) => t.name === variantBTemplateName);

  useEffect(() => {
    if (channel !== 'evolution') return;
    (async () => {
      setLoadingEvoNumeros(true);
      try {
        const res = await api.get<{ numeros: EvolutionNumero[] }>('/modules/campanhas/numeros-evolution');
        setEvoNumeros(res.numeros || []);
      } catch {
        setEvoNumeros([]);
      } finally {
        setLoadingEvoNumeros(false);
      }
    })();
  }, [channel]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = channel === 'meta'
        ? {
          name, whatsappNumberId: meta?.id, channel, templateName: selected?.name,
          templateLanguage: selected?.language, templateVarCount: varCount,
          ...(abTestEnabled ? {
            abTestEnabled: true,
            variantBTemplateName: variantBSelected?.name,
            variantBTemplateLanguage: variantBSelected?.language,
            variantBTemplateVarCount: variantBSelected ? countVars(bodyOf(variantBSelected)?.text) : undefined,
          } : {}),
        }
        : {
          name, whatsappNumberId: evoNumeroId, channel, messageBody,
          ...(abTestEnabled ? { abTestEnabled: true, variantBMessageBody } : {}),
        };
      const res = await api.post<{ campanha: { id: string } }>('/modules/campanhas/', payload);
      router.push(`/dashboard/campanhas/${res.campanha.id}`);
    } catch (err: any) {
      setError(err?.message || 'Não foi possível criar a campanha.');
      setSaving(false);
    }
  }

  const variantBReady = !abTestEnabled || (channel === 'meta' ? !!variantBSelected : variantBMessageBody.trim().length > 0);
  const canSubmit = (channel === 'meta'
    ? !!meta && !!selected && !!name
    : !!evoNumeroId && messageBody.trim().length > 0 && !!name) && variantBReady;

  return (
    <div className="min-h-screen px-5 py-10">
      <div className="max-w-2xl mx-auto">
        <Link href="/dashboard/campanhas" className="text-sm text-brand-muted hover:text-brand-text">← Campanhas</Link>
        <h1 className="text-2xl font-bold mt-2 mb-6 text-brand-text">Nova campanha</h1>

        <div className="mb-6 flex rounded-lg border border-brand-border overflow-hidden text-sm">
          <button
            type="button"
            onClick={() => setChannel('meta')}
            className={`flex-1 px-4 py-2 font-medium ${channel === 'meta' ? 'bg-brand-primary text-white' : 'bg-brand-elevated text-brand-text-secondary hover:text-brand-text'}`}
          >
            WhatsApp oficial (Meta)
          </button>
          <button
            type="button"
            onClick={() => setChannel('evolution')}
            className={`flex-1 px-4 py-2 font-medium ${channel === 'evolution' ? 'bg-brand-primary text-white' : 'bg-brand-elevated text-brand-text-secondary hover:text-brand-text'}`}
          >
            Meu número atual (Evolution)
          </button>
        </div>

        {channel === 'meta' ? (
          <>
            <div className="mb-6">
              <ConnectionCard onReady={setMeta} />
            </div>

            {meta && (
              <>
                <div className="mb-6 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-brand-text-secondary">
                  ⚠️ <strong className="text-brand-text">Números novos na API oficial começam com um limite diário de envio</strong>{' '}
                  definido pela própria Meta, que sobe conforme o número acumula histórico de boas
                  entregas. Se sua campanha tiver muitos contatos, o disparo pode ficar limitado nos
                  primeiros dias — isso é normal e não depende do ZapScript.
                </div>

                <form onSubmit={handleSubmit} className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-brand-text-secondary mb-1">Nome da campanha</label>
                    <input
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Ex: Promoção de julho"
                      className="input"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-brand-text-secondary mb-1">Template aprovado</label>
                    {loadingTemplates ? (
                      <p className="text-sm text-brand-muted">Buscando templates aprovados na Meta…</p>
                    ) : templatesError ? (
                      <p className="text-sm text-red-500">{templatesError}</p>
                    ) : templates.length === 0 ? (
                      <p className="text-sm text-brand-muted">
                        Nenhum template aprovado encontrado. Crie e aguarde aprovação no Gerenciador de Negócios da Meta.
                      </p>
                    ) : (
                      <select
                        required
                        value={templateName}
                        onChange={(e) => setTemplateName(e.target.value)}
                        className="input"
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
                    <div className="inner-block text-sm">
                      <div className="text-brand-muted mb-1">Prévia do corpo da mensagem:</div>
                      <div className="whitespace-pre-wrap text-brand-text">{bodyOf(selected)?.text}</div>
                      {varCount > 0 && (
                        <p className="mt-3 text-emerald-600">
                          {varCount === 1
                            ? 'Este template usa 1 variável — inclua na coluna 3 do seu CSV de contatos.'
                            : `Este template usa ${varCount} variáveis — inclua nas colunas 3 a ${2 + varCount} do seu CSV de contatos, nessa ordem.`}
                        </p>
                      )}
                      {complexHeader && (
                        <p className="mt-3 text-amber-600">
                          ⚠️ Este template tem cabeçalho com mídia ou variável — não suportado neste fluxo simples. O
                          envio usará apenas o corpo do template.
                        </p>
                      )}
                    </div>
                  )}

                  <div className="inner-block">
                    <label className="flex items-center gap-2 text-sm text-brand-text">
                      <input type="checkbox" checked={abTestEnabled} onChange={(e) => setAbTestEnabled(e.target.checked)} />
                      <span>Testar 2 versões (A/B) — divide a audiência 50/50, só reporta as métricas por variante</span>
                    </label>
                    {abTestEnabled && (
                      <div className="mt-3">
                        <label className="block text-sm font-medium text-brand-text-secondary mb-1">Template da variante B</label>
                        <select
                          required={abTestEnabled}
                          value={variantBTemplateName}
                          onChange={(e) => setVariantBTemplateName(e.target.value)}
                          className="input"
                        >
                          <option value="">Selecione…</option>
                          {templates.map((t) => (
                            <option key={t.id} value={t.name}>{t.name} ({t.language})</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  {error && (
                    <div className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-red-600 text-sm">
                      {error}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={saving || !canSubmit}
                    className="btn-primary px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving ? 'Criando…' : 'Criar campanha (rascunho) →'}
                  </button>
                </form>
              </>
            )}
          </>
        ) : (
          <>
            <div className="mb-6 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-brand-text-secondary">
              ⚠️ <strong className="text-brand-text">Isto não é a API oficial do WhatsApp.</strong> Usa o mesmo número que você já
              conectou pra transcrição/Atende — e o WhatsApp pode banir números usados pra envio em
              massa automatizado. Por isso: só contatos que já falaram com você (sem CSV livre) e um
              ritmo de envio bem mais lento e espaçado. Você vai precisar confirmar que entende o
              risco antes de iniciar o disparo.
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-brand-text-secondary mb-1">Nome da campanha</label>
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Aviso pros clientes de julho"
                  className="input"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-brand-text-secondary mb-1">Número Evolution</label>
                {loadingEvoNumeros ? (
                  <p className="text-sm text-brand-muted">Buscando seus números conectados…</p>
                ) : evoNumeros.length === 0 ? (
                  <p className="text-sm text-brand-muted">
                    Nenhum número Evolution conectado. Conecte um em{' '}
                    <Link href="/dashboard/numeros" className="text-emerald-600 hover:text-emerald-500">/dashboard/numeros</Link>.
                  </p>
                ) : (
                  <select
                    required
                    value={evoNumeroId}
                    onChange={(e) => setEvoNumeroId(e.target.value)}
                    className="input"
                  >
                    <option value="">Selecione…</option>
                    {evoNumeros.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.displayName || n.phoneNumber || n.id}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-brand-text-secondary mb-1">Mensagem</label>
                <textarea
                  required
                  value={messageBody}
                  onChange={(e) => setMessageBody(e.target.value)}
                  rows={4}
                  maxLength={4096}
                  placeholder="Oi {{nome}}, tudo bem? ..."
                  className="input"
                />
                <p className="mt-1 text-xs text-brand-muted">
                  Use <code className="text-brand-text-secondary">{'{{nome}}'}</code> pra personalizar com o nome de cada contato
                  (quando conhecido — senão usamos o telefone).
                </p>
              </div>

              <div className="inner-block">
                <label className="flex items-center gap-2 text-sm text-brand-text">
                  <input type="checkbox" checked={abTestEnabled} onChange={(e) => setAbTestEnabled(e.target.checked)} />
                  <span>Testar 2 versões (A/B) — divide a audiência 50/50, só reporta as métricas por variante</span>
                </label>
                {abTestEnabled && (
                  <div className="mt-3">
                    <label className="block text-sm font-medium text-brand-text-secondary mb-1">Mensagem da variante B</label>
                    <textarea
                      required={abTestEnabled}
                      value={variantBMessageBody}
                      onChange={(e) => setVariantBMessageBody(e.target.value)}
                      rows={4}
                      maxLength={4096}
                      placeholder="Oi {{nome}}, tudo bem? ..."
                      className="input"
                    />
                  </div>
                )}
              </div>

              {error && (
                <div className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-red-600 text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={saving || !canSubmit}
                className="btn-primary px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? 'Criando…' : 'Criar campanha (rascunho) →'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
