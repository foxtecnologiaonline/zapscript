'use client';

import { useState, useCallback } from 'react';

/**
 * NewsletterSignup — CTA de captura de e-mail no blog.
 *
 * Exibido ao final de cada post e no rodapé do índice do blog.
 * O e-mail é enviado para /api/newsletter/subscribe (first-party).
 *
 * UX: botão desabilita ao submeter, mostra feedback inline.
 * LGPD: texto de consentimento claro, sem checkbox implícito.
 */
export default function NewsletterSignup({ source = 'blog' }: { source?: string }) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || status === 'sending') return;

    setStatus('sending');
    setErrorMsg('');

    try {
      const res = await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), source }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Erro ao se inscrever. Tente novamente.');
      }

      setStatus('ok');
      setEmail('');
    } catch (err: any) {
      setStatus('error');
      setErrorMsg(err.message || 'Erro ao se inscrever.');
    }
  }, [email, status, source]);

  if (status === 'ok') {
    return (
      <div className="bg-brand-primary/10 border border-brand-primary/20 rounded-2xl p-8 text-center">
        <div className="text-4xl mb-3">📬</div>
        <h3 className="text-xl font-bold text-white mb-2">Inscrição confirmada!</h3>
        <p className="text-brand-muted text-sm">
          Você receberá nossos guias e dicas diretamente no e-mail. Bem-vindo(a)!
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-8">
      <div className="text-center mb-5">
        <div className="text-4xl mb-3">📬</div>
        <h3 className="text-xl font-bold text-white mb-2">
          Receba os próximos guias por e-mail
        </h3>
        <p className="text-brand-muted text-sm max-w-md mx-auto">
          Um e-mail por semana com as melhores dicas sobre produtividade, WhatsApp e IA. Sem spam — cancele quando quiser.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
        <input
          type="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="seu@email.com"
          disabled={status === 'sending'}
          className="flex-1 bg-white/10 border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder:text-brand-muted focus:outline-none focus:border-brand-primary/50 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={status === 'sending'}
          className="bg-brand-primary text-black font-semibold px-6 py-2.5 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 shrink-0"
        >
          {status === 'sending' ? 'Enviando...' : 'Inscrever'}
        </button>
      </form>
      {status === 'error' && (
        <p className="text-red-400 text-sm text-center mt-3">{errorMsg}</p>
      )}
      <p className="text-xs text-brand-muted/60 text-center mt-4">
        Ao se inscrever, você concorda em receber e-mails do ZapScript. Respeitamos sua privacidade — LGPD.
      </p>
    </div>
  );
}
