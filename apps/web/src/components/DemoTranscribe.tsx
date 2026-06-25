'use client';
import { useState, useRef } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

const DEMO_ACCEPT = '.ogg,.opus,.mp3,.mp4,.m4a,.wav,.webm,.aac,.flac,audio/*';
const DEMO_MAX_BYTES = 4 * 1024 * 1024;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type DemoResult = { text: string; bullets: string[]; durationSec: number };

// Exemplo pronto — resultado instantâneo, sem upload nem e-mail (para quem só quer ver funcionando)
const EXAMPLE_RESULT: DemoResult = {
  durationSec: 47,
  text: 'Oi, tudo bem? Então, sobre o apartamento da Rua das Acácias: o proprietário aceitou a proposta de R$ 420 mil, mas pediu pra fechar até sexta. Ele topa parcelar a entrada em duas vezes. Preciso que você confirme com o cliente hoje ainda e já me mande os documentos pra adiantar o contrato. Ah, e a vistoria ficou marcada pra quinta de manhã, 9 horas.',
  bullets: [
    'Proposta de R$ 420 mil aceita pelo proprietário',
    'Prazo para fechar: até sexta-feira',
    'Entrada pode ser parcelada em 2x',
    'Vistoria marcada para quinta, às 9h',
  ],
};

export function DemoTranscribe() {
  const [file, setFile]       = useState<File | null>(null);
  const [email, setEmail]     = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [result, setResult]   = useState<DemoResult | null>(null);
  const [isExample, setIsExample] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Link de cadastro carregando o e-mail já digitado (handoff demo → cadastro)
  const signupHref = email.trim() && EMAIL_RE.test(email.trim())
    ? `/cadastro?plan=pro&email=${encodeURIComponent(email.trim().toLowerCase())}`
    : '/cadastro?plan=pro';

  function pickFile(f: File | null) {
    setError(null);
    if (!f) { setFile(null); return; }
    if (f.size > DEMO_MAX_BYTES) {
      setError('Áudio muito grande para a demo (máx. 4MB / ~5 min). Crie sua conta para áudios maiores.');
      setFile(null);
      return;
    }
    setFile(f);
  }

  async function submit() {
    setError(null);
    if (!file) { setError('Escolha um arquivo de áudio.'); return; }
    if (!EMAIL_RE.test(email.trim())) { setError('Informe um e-mail válido para ver o resultado.'); return; }

    setLoading(true);
    try {
      const fd = new FormData();
      // E-mail ANTES do arquivo: com multipart em streaming, o backend só
      // enxerga campos que vêm antes do file ao chamar req.file().
      fd.append('email', email.trim().toLowerCase());
      fd.append('file', file);
      const res = await api.postFormData<{ ok: boolean } & DemoResult>('/demo/transcribe', fd);
      setResult({ text: res.text, bullets: res.bullets || [], durationSec: res.durationSec });
    } catch (e: any) {
      setError(e?.error || e?.message || 'Não foi possível converter agora. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setFile(null); setResult(null); setError(null); setEmail(''); setIsExample(false);
    if (inputRef.current) inputRef.current.value = '';
  }

  function showExample() {
    setError(null);
    setResult(EXAMPLE_RESULT);
    setIsExample(true);
  }

  return (
    <div className="rounded-3xl p-6 border"
      style={{
        background: 'rgb(var(--color-surface-elevated))',
        borderColor: 'rgba(16,185,129,.25)',
        boxShadow: 'var(--shadow-glow), var(--shadow-md)',
      }}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(16,185,129,.15)', color: 'rgb(var(--color-primary))' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a3 3 0 013 3v7a3 3 0 11-6 0V5a3 3 0 013-3z"/>
            <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v3M8 22h8"/>
          </svg>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgb(var(--color-primary))' }}>
            Experimente agora · grátis
          </p>
          <h2 className="font-display font-bold text-xl tracking-tight leading-tight">
            Converta 1 áudio em segundos
          </h2>
        </div>
      </div>

      {!result ? (
        <>
          <p className="text-sm font-light mb-4" style={{ color: 'rgb(var(--color-text-secondary))' }}>
            Envie um áudio do seu WhatsApp e veja o texto + resumo na hora. Sem instalar nada, sem cadastro.
          </p>

          {/* Dropzone / file picker */}
          <button type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files?.[0] || null); }}
            className="w-full rounded-2xl px-4 py-6 mb-3 flex flex-col items-center gap-2 transition-all"
            style={{
              border: `1.5px dashed ${dragOver ? 'rgb(var(--color-primary))' : 'rgb(var(--color-border))'}`,
              background: dragOver ? 'rgba(16,185,129,.06)' : 'rgb(var(--color-surface))',
              cursor: 'pointer',
            }}>
            <span className="text-2xl">{file ? '🎧' : '📤'}</span>
            <span className="text-sm font-semibold" style={{ color: 'rgb(var(--color-text))' }}>
              {file ? file.name : 'Toque para escolher um áudio'}
            </span>
            <span className="text-[11px]" style={{ color: 'rgb(var(--color-text-muted))' }}>
              {file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : 'OGG, MP3, M4A, WAV… até 4MB'}
            </span>
          </button>
          <input ref={inputRef} type="file" accept={DEMO_ACCEPT} className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0] || null)} />

          {/* E-mail */}
          <input type="email" inputMode="email" autoComplete="email"
            value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="Seu melhor e-mail"
            className="w-full rounded-2xl px-4 py-3 mb-3 text-sm outline-none"
            style={{
              border: '1.5px solid rgb(var(--color-border))',
              background: 'rgb(var(--color-surface))',
              color: 'rgb(var(--color-text))',
            }} />

          {error && (
            <p className="text-xs mb-3 px-1" style={{ color: '#f87171' }}>{error}</p>
          )}

          <button type="button" onClick={submit} disabled={loading}
            className="btn-primary w-full py-[14px] text-[15px] font-semibold flex items-center justify-center gap-2"
            style={{ opacity: loading ? 0.7 : 1, cursor: loading ? 'wait' : 'pointer' }}>
            {loading ? (
              <>
                <span className="inline-block w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                Convertendo…
              </>
            ) : (
              <>
                Converter grátis
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </>
            )}
          </button>
          <p className="text-[10px] text-center mt-2" style={{ color: 'rgb(var(--color-text-muted))' }}>
            🔒 Seu áudio nunca é armazenado. Processado e descartado na hora.
          </p>

          {/* Não tem áudio à mão? Vê funcionando na hora */}
          <div className="flex items-center gap-3 my-3">
            <div className="flex-1 h-px" style={{ background: 'rgb(var(--color-border))' }} />
            <span className="text-[11px] font-medium" style={{ color: 'rgb(var(--color-text-muted))' }}>sem áudio agora?</span>
            <div className="flex-1 h-px" style={{ background: 'rgb(var(--color-border))' }} />
          </div>
          <button type="button" onClick={showExample}
            className="w-full py-3 rounded-2xl text-sm font-semibold transition-all hover:opacity-80 active:scale-[.98] flex items-center justify-center gap-2"
            style={{ border: '1.5px solid rgb(var(--color-border))', color: 'rgb(var(--color-text-secondary))', background: 'rgb(var(--color-surface))' }}>
            👀 Ver um exemplo pronto
          </button>
        </>
      ) : (
        <div style={{ animation: 'fadeInUp .4s ease both' }}>
          {isExample && (
            <div className="inline-flex items-center gap-1.5 mb-3 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider"
              style={{ background: 'rgba(245,158,11,.12)', color: 'rgb(245,158,11)', border: '1px solid rgba(245,158,11,.25)' }}>
              ✨ Exemplo · áudio de 47s
            </div>
          )}
          {/* Conversão */}
          <p className="text-[11px] font-semibold mb-1.5" style={{ color: 'rgb(var(--color-primary))' }}>📝 Conversão:</p>
          <p className="text-sm leading-relaxed mb-4" style={{ color: 'rgb(var(--color-text))' }}>
            {result.text}
          </p>

          {/* Pontos-chave */}
          {result.bullets.length > 0 && (
            <div className="pt-3 mb-4 space-y-2" style={{ borderTop: '1px solid rgb(var(--color-border-light))' }}>
              <p className="text-[11px] font-semibold mb-2" style={{ color: 'rgb(var(--color-primary))' }}>🎯 Pontos-chave:</p>
              {result.bullets.map((b, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="flex-shrink-0 text-sm leading-none mt-0.5" style={{ color: 'rgb(var(--color-primary))' }}>✅</span>
                  <span className="text-sm leading-relaxed" style={{ color: 'rgb(var(--color-text-secondary))' }}>{b}</span>
                </div>
              ))}
            </div>
          )}

          {/* Upsell */}
          <div className="rounded-2xl p-4 mb-3" style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgba(16,185,129,.2)' }}>
            <p className="text-sm font-semibold mb-1" style={{ color: 'rgb(var(--color-text))' }}>
              Gostou? Faça isso automático no seu WhatsApp.
            </p>
            <p className="text-xs font-light mb-3" style={{ color: 'rgb(var(--color-text-secondary))' }}>
              Conecte seu número e todo áudio vira texto e resumo sozinho. Comece grátis — 1º mês do Pro por R$ 19,90.
            </p>
            <Link href={signupHref} className="btn-primary w-full py-3 text-sm font-semibold flex items-center justify-center gap-2">
              Criar minha conta grátis
            </Link>
          </div>

          <button type="button" onClick={reset}
            className="w-full py-2.5 rounded-2xl text-sm font-semibold transition-all"
            style={{ border: '1.5px solid rgb(var(--color-border))', color: 'rgb(var(--color-text-secondary))', background: 'transparent' }}>
            {isExample ? 'Converter meu próprio áudio' : 'Converter outro áudio'}
          </button>
        </div>
      )}
    </div>
  );
}
