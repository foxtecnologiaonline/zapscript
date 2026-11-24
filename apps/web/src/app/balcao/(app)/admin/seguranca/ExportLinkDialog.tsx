'use client';
/**
 * Download da exportação final por LINK DE USO ÚNICO (POST /security/exports/:id/link → { url, expiresAt }, token de 60 s).
 * O navegador baixa em streaming a partir do link nativo — nada passa por fetch/Blob (o pacote pode ter gigabytes).
 * O token é consumido na 1ª requisição: para retomar/repetir é preciso gerar outro link.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { bv } from '@/lib/balcao/api';
import { fmtBytes, fmtDateTime } from '@/lib/balcao/format';
import { Banner, Button, Dialog, Spinner } from '../../../_ui/ui';
import { errFull, hasCode } from '../usuarios/_shared';

interface LinkRes { url: string; expiresAt: string }
type Phase = 'loading' | 'ready' | 'used' | 'expired' | 'error';

/** Abaixo deste tamanho o caminho antigo (fetch + Blob) é aceitável como alternativa quando o link não puder ser emitido. */
export const FALLBACK_MAX_BYTES = 50 * 1024 * 1024;

export default function ExportLinkDialog({ job, onClose }: { job: { id: string; createdAt: string; sizeBytes: number | null }; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [link, setLink] = useState<LinkRes | null>(null);
  const [left, setLeft] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [fallbackBusy, setFallbackBusy] = useState(false);
  const [announce, setAnnounce] = useState('');
  const seq = useRef(0);
  const small = job.sizeBytes != null && job.sizeBytes <= FALLBACK_MAX_BYTES;
  const filename = `balcao-export-${job.id}.tar.gz`;

  const generate = useCallback(async () => {
    const id = ++seq.current;
    setPhase('loading'); setErr(null); setLink(null);
    try {
      const r = await bv.post<LinkRes>(`/security/exports/${job.id}/link`);
      if (id !== seq.current) return;
      setLink(r); setLeft(Math.max(0, Math.ceil((Date.parse(r.expiresAt) - Date.now()) / 1000))); setPhase('ready');
      setAnnounce('Link de download pronto. Ele vale por poucos segundos e só pode ser usado uma vez.');
    } catch (e) {
      if (id !== seq.current) return;
      setErr(hasCode(e, 'export.link_invalid') ? 'O link expirou ou já foi usado. Gere um novo link.'
        : hasCode(e, 'export.not_ready') ? 'A exportação não está pronta para download (ainda em andamento ou já expirada).'
        : hasCode(e, 'export.link_unavailable') ? 'O serviço que emite os links de download está indisponível no momento. Tente novamente em instantes.'
        : errFull(e));
      setPhase('error');
    }
  }, [job.id]);
  useEffect(() => { void generate(); return () => { seq.current++; }; }, [generate]);

  // contagem regressiva (1 s); anúncio para leitores de tela só na expiração
  useEffect(() => {
    if (phase !== 'ready' || !link) return;
    const t = setInterval(() => {
      const s = Math.max(0, Math.ceil((Date.parse(link.expiresAt) - Date.now()) / 1000));
      setLeft(s);
      if (s <= 0) { setPhase('expired'); setAnnounce('O link de download expirou. Gere um novo link.'); }
    }, 1000);
    return () => clearInterval(t);
  }, [phase, link]);

  const fallback = async () => {
    setFallbackBusy(true); setErr(null);
    try { await bv.download(`/security/exports/${job.id}/download`, filename); setAnnounce('Download iniciado.'); }
    catch (e) { setErr(errFull(e)); } finally { setFallbackBusy(false); }
  };

  return (
    <Dialog open onClose={onClose} title="Baixar exportação final" footer={<Button variant="secondary" onClick={onClose}>Fechar</Button>}>
      <div className="flex flex-col gap-3 text-sm">
        <p>Exportação solicitada em {fmtDateTime(job.createdAt)}{job.sizeBytes != null ? ` · ${fmtBytes(job.sizeBytes)}` : ''}.</p>
        <div className="bv-sr-only" role="status" aria-live="polite">{announce}</div>

        {phase === 'loading' && <div className="flex items-center gap-2"><Spinner label="Gerando link de download" /><span aria-hidden="true">Gerando link de download…</span></div>}

        {phase === 'ready' && link && (
          <>
            <Banner tone="primary" title="Link pronto">
              <span role="timer" aria-live="off" aria-atomic="true">Válido por mais <strong>{left} s</strong></span> (até {fmtDateTime(link.expiresAt)}). O link só pode ser usado <strong>uma vez</strong>.
            </Banner>
            {/* link nativo: o navegador baixa em streaming; nova aba para que um eventual erro do servidor não tire o usuário desta tela */}
            <a href={link.url} download={filename} target="_blank" rel="noopener noreferrer" onClick={() => { setTimeout(() => { setPhase('used'); setAnnounce('Download iniciado pelo navegador.'); }, 400); }}
              className="inline-flex min-h-[40px] items-center justify-center self-start rounded-md bg-bv-primary px-4 text-base font-medium text-bv-primary-fg hover:opacity-90">
              Baixar arquivo (.tar.gz)<span className="bv-sr-only"> — link de uso único</span>
            </a>
            <p className="text-xs text-bv-muted">O arquivo é transferido diretamente pelo navegador, sem ser carregado na memória da página. Não compartilhe este link.</p>
          </>
        )}

        {phase === 'used' && (
          <>
            <Banner tone="success" title="Download iniciado">Acompanhe o progresso no gerenciador de downloads do navegador. Se for interrompido, gere um novo link para retomar (cada link vale para um único uso).</Banner>
            <div><Button onClick={() => void generate()}>Gerar novo link</Button></div>
          </>
        )}

        {phase === 'expired' && (
          <>
            <Banner tone="warning" title="O link expirou">O link vale por apenas 60 segundos. Gere um novo para baixar.</Banner>
            <div><Button onClick={() => void generate()}>Gerar novo link</Button></div>
          </>
        )}

        {phase === 'error' && (
          <>
            <Banner tone="danger" title="Não foi possível gerar o link">{err}</Banner>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void generate()}>Gerar novo link</Button>
              {small && <Button variant="secondary" loading={fallbackBusy} onClick={() => void fallback()}>Baixar pelo método alternativo</Button>}
            </div>
            {small && <p className="text-xs text-bv-muted">O método alternativo carrega o arquivo inteiro na memória do navegador; por isso só é oferecido para arquivos de até {fmtBytes(FALLBACK_MAX_BYTES)}.</p>}
          </>
        )}
        {phase !== 'error' && err && <Banner tone="danger">{err}</Banner>}
        <p className="text-xs text-bv-muted">Se o navegador mostrar “export.link_invalid” (erro 401), o link expirou ou já foi usado: gere um novo link. Cada geração e cada download ficam registrados em auditoria.</p>
      </div>
    </Dialog>
  );
}
