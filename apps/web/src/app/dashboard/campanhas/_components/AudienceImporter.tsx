'use client';

import { useEffect, useRef, useState, ChangeEvent } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface ListaItem {
  id: string;
  name: string;
  contatosCount: number;
}

interface ImportResult {
  imported: number;
  skippedOptOut?: number;
  skippedDuplicate?: number;
  skippedInvalid?: number;
  skippedVarMismatch?: number;
  skippedCold?: number;
  elegiveis?: number;
}

const PHONE_LIKE = /^\+?\d[\d\s()-]{7,}$/;

function detectDelimiter(sample: string): string {
  const firstLine = sample.split(/\r?\n/, 1)[0] || '';
  const commas = (firstLine.match(/,/g) || []).length;
  const semis = (firstLine.match(/;/g) || []).length;
  return semis > commas ? ';' : ',';
}

/** Prévia leve (não trata aspas com vírgula interna) — parsing de verdade é no backend. */
function previewCsv(text: string, maxRows = 5): string[][] {
  const delimiter = detectDelimiter(text);
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .slice(0, maxRows)
    .map((line) => line.split(delimiter).map((c) => c.trim().replace(/^"|"$/g, '')));
}

function fmtImportResult(res: ImportResult): string {
  const base = res.elegiveis != null
    ? `${res.imported} de ${res.elegiveis} contato${res.elegiveis === 1 ? '' : 's'} elegíve${res.elegiveis === 1 ? 'l' : 'is'} importado${res.imported === 1 ? '' : 's'}.`
    : `${res.imported} contato${res.imported === 1 ? '' : 's'} importado${res.imported === 1 ? '' : 's'}.`;
  const extras = [
    res.skippedOptOut ? `${res.skippedOptOut} já em opt-out.` : '',
    res.skippedDuplicate ? `${res.skippedDuplicate} já estava(m) na campanha.` : '',
    res.skippedInvalid ? `${res.skippedInvalid} inválido(s).` : '',
    res.skippedVarMismatch ? `${res.skippedVarMismatch} com nº de variáveis diferente do template.` : '',
    res.skippedCold ? `${res.skippedCold} sem conversa recente (não elegível pro Evolution).` : '',
  ].filter(Boolean).join(' ');
  return extras ? `${base} ${extras}` : base;
}

export default function AudienceImporter({
  campanhaId, channel, templateVarCount, onImported,
}: {
  campanhaId: string;
  channel: string;
  templateVarCount: number | null;
  onImported: () => void;
}) {
  const [listas, setListas] = useState<ListaItem[]>([]);
  const [selectedListaId, setSelectedListaId] = useState('');
  const [applyingLista, setApplyingLista] = useState(false);

  const [crmTags, setCrmTags] = useState<string[]>([]);
  const [selectedCrmTag, setSelectedCrmTag] = useState('');
  const [importingCrm, setImportingCrm] = useState(false);

  const [importingConversas, setImportingConversas] = useState(false);

  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvPreview, setCsvPreview] = useState<string[][] | null>(null);
  const [csvWarning, setCsvWarning] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<{ listas: ListaItem[] }>('/modules/campanhas/listas');
        setListas(res.listas || []);
      } catch { /* seleção de lista salva é opcional */ }
      try {
        const res = await api.get<{ tags: string[] }>('/modules/campanhas/crm-tags');
        setCrmTags(res.tags || []);
      } catch { /* segmentação por tag é opcional */ }
    })();
  }, []);

  const listaBlocked = channel === 'meta' && !!templateVarCount;

  async function handleApplyLista() {
    if (!selectedListaId) return;
    setApplyingLista(true);
    setError(null);
    setMsg(null);
    try {
      const res = await api.post<ImportResult>(`/modules/campanhas/${campanhaId}/contatos/from-lista`, { listaId: selectedListaId });
      setMsg(fmtImportResult(res));
      onImported();
    } catch (err: any) {
      setError(err?.message || 'Não foi possível aplicar a lista.');
    } finally {
      setApplyingLista(false);
    }
  }

  async function handleImportCrm() {
    if (!selectedCrmTag) return;
    setImportingCrm(true);
    setError(null);
    setMsg(null);
    try {
      const res = await api.post<ImportResult>(`/modules/campanhas/${campanhaId}/contatos/from-crm`, { tag: selectedCrmTag });
      setMsg(fmtImportResult(res));
      onImported();
    } catch (err: any) {
      setError(err?.message || 'Falha ao importar contatos por tag.');
    } finally {
      setImportingCrm(false);
    }
  }

  async function handleImportConversas() {
    setImportingConversas(true);
    setError(null);
    setMsg(null);
    try {
      const res = await api.post<ImportResult>(`/modules/campanhas/${campanhaId}/contatos/from-conversas`, {});
      setMsg(fmtImportResult(res));
      onImported();
    } catch (err: any) {
      setError(err?.message || 'Falha ao importar contatos.');
    } finally {
      setImportingConversas(false);
    }
  }

  function handlePickCsv(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setMsg(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const rows = previewCsv(text);
      const firstDataRow = PHONE_LIKE.test(rows[0]?.[0] || '') ? rows[0] : rows[1];
      setCsvWarning(
        firstDataRow && !PHONE_LIKE.test(firstDataRow[0] || '')
          ? 'A 1ª coluna não parece telefone — confira se o CSV está na ordem certa (telefone, nome, variáveis…) antes de confirmar.'
          : null,
      );
      setCsvPreview(rows);
      setCsvFile(file);
    };
    reader.readAsText(file);
  }

  function cancelCsvPreview() {
    setCsvFile(null);
    setCsvPreview(null);
    setCsvWarning(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function confirmCsvUpload() {
    if (!csvFile) return;
    setUploading(true);
    setError(null);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append('file', csvFile);
      const res = await api.postFormData<ImportResult>(`/modules/campanhas/${campanhaId}/contatos`, fd);
      setMsg(fmtImportResult(res));
      onImported();
      cancelCsvPreview();
    } catch (err: any) {
      setError(err?.message || 'Falha ao importar CSV.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-red-600 text-sm">{error}</div>
      )}
      {msg && <div className="card rounded-lg p-3 text-sm text-brand-text-secondary">{msg}</div>}

      {listas.length > 0 && (
        <div className="card rounded-xl p-4">
          <h2 className="text-sm font-semibold text-brand-text">Usar uma lista salva</h2>
          <p className="mt-1 text-xs text-brand-muted">
            {listaBlocked
              ? 'Este template usa variáveis — listas salvas não preenchem variáveis automaticamente. Use o upload de CSV abaixo.'
              : 'Aplica os números de uma lista que você já montou antes.'}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              value={selectedListaId}
              onChange={(e) => setSelectedListaId(e.target.value)}
              disabled={listaBlocked}
              className="input w-auto"
            >
              <option value="">Selecione uma lista…</option>
              {listas.map((l) => (
                <option key={l.id} value={l.id}>{l.name} ({l.contatosCount})</option>
              ))}
            </select>
            <button
              onClick={handleApplyLista}
              disabled={!selectedListaId || applyingLista || listaBlocked}
              className="btn-ghost text-xs disabled:opacity-50"
            >
              {applyingLista ? 'Aplicando…' : '📋 Usar esta lista'}
            </button>
          </div>
        </div>
      )}

      {channel === 'evolution' ? (
        <div className="card rounded-xl p-4">
          <h2 className="text-sm font-semibold text-brand-text">Importar contatos que já falaram com você</h2>
          <p className="mt-1 text-xs text-brand-muted">
            Guardrail do canal Evolution: só contatos com conversa recente entram na campanha.
          </p>
          <button
            onClick={handleImportConversas}
            disabled={importingConversas}
            className="btn-ghost text-xs mt-3 disabled:opacity-50"
          >
            {importingConversas ? 'Importando…' : '💬 Importar contatos'}
          </button>
        </div>
      ) : (
        <div className="card rounded-xl p-4">
          <h2 className="text-sm font-semibold text-brand-text">Importar CSV</h2>
          <p className="mt-1 text-xs text-brand-muted">
            Coluna 1 = telefone (obrigatório) · coluna 2 = nome (opcional) · colunas 3+ = variáveis do
            template, na ordem.
          </p>

          {!csvPreview ? (
            <label className="btn-ghost text-xs mt-3 cursor-pointer inline-block">
              📄 Escolher arquivo
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handlePickCsv}
                className="hidden"
              />
            </label>
          ) : (
            <div className="mt-3 space-y-3">
              {csvWarning && (
                <p className="text-xs text-amber-600">⚠️ {csvWarning}</p>
              )}
              <div className="overflow-x-auto rounded-lg border border-brand-border">
                <table className="w-full text-xs">
                  <tbody className="divide-y divide-brand-border">
                    {csvPreview.map((row, i) => (
                      <tr key={i}>
                        {row.map((cell, j) => (
                          <td key={j} className="px-2 py-1 text-brand-text-secondary whitespace-nowrap">{cell || '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-brand-muted">Prévia das primeiras linhas — {csvFile?.name}</p>
              <div className="flex items-center gap-3">
                <button
                  onClick={confirmCsvUpload}
                  disabled={uploading}
                  className="btn-primary px-3 py-1.5 text-xs disabled:opacity-50"
                >
                  {uploading ? 'Importando…' : 'Confirmar importação'}
                </button>
                <button onClick={cancelCsvPreview} disabled={uploading} className="text-xs text-brand-muted hover:text-brand-text">
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {crmTags.length > 0 && (
        <div className="card rounded-xl p-4">
          <h2 className="text-sm font-semibold text-brand-text">Segmentar por tag do CRM</h2>
          <p className="mt-1 text-xs text-brand-muted">
            Importa só os contatos do seu CRM com a tag escolhida
            {channel === 'evolution' ? ' (ainda restrito a quem já falou com você).' : '.'}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              value={selectedCrmTag}
              onChange={(e) => setSelectedCrmTag(e.target.value)}
              className="input w-auto"
            >
              <option value="">Selecione uma tag…</option>
              {crmTags.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <button
              onClick={handleImportCrm}
              disabled={!selectedCrmTag || importingCrm}
              className="btn-ghost text-xs disabled:opacity-50"
            >
              {importingCrm ? 'Importando…' : '🏷️ Importar por tag'}
            </button>
          </div>
        </div>
      )}

      <p className="text-xs text-brand-muted">
        Precisa de uma lista nova? <Link href="/dashboard/campanhas/listas" className="text-emerald-600 hover:text-emerald-500">Crie uma em Listas de números →</Link>
      </p>
    </div>
  );
}
