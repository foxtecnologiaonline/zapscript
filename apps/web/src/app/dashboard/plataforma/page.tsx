'use client';
import { useState } from 'react';
import MensagensPanel from './_components/MensagensPanel';
import WebhooksPanel from './_components/WebhooksPanel';
import TemplatesPanel from './_components/TemplatesPanel';

/**
 * Plataforma — a superfície de integração do ZapScript no painel.
 *
 * Reúne o que o escopo ZapScript × Twilio abriu:
 *   • Mensagens  — log unificado de tudo que entrou e saiu + métricas (itens 5 e 7)
 *   • Webhooks   — endpoints por evento, com histórico e reentrega (item 2)
 *   • Templates  — criar e acompanhar templates, com header de mídia (itens 4 e 8)
 *
 * A API pública (/public/v1) expõe os mesmos dados por X-Api-Key; as chaves
 * ficam em Equipe → API pública. Ver PLATAFORMA_API_PUBLICA.md.
 */

type Aba = 'mensagens' | 'webhooks' | 'templates';

const ABAS: Array<{ id: Aba; label: string; icon: string; hint: string }> = [
  { id: 'mensagens', label: 'Mensagens', icon: '📨', hint: 'Tudo que entrou e saiu, com status e motivo de falha' },
  { id: 'webhooks',  label: 'Webhooks',  icon: '🔔', hint: 'Receba eventos no seu sistema, com reentrega automática' },
  { id: 'templates', label: 'Templates', icon: '📋', hint: 'Crie e acompanhe templates da API oficial' },
];

export default function PlataformaPage() {
  const [aba, setAba] = useState<Aba>('mensagens');
  const atual = ABAS.find(a => a.id === aba)!;

  return (
    <div className="p-4 sm:p-8 max-w-4xl">
      <div className="mb-5">
        <h1 className="font-display text-2xl font-bold">Plataforma</h1>
        <p className="text-sm font-light mt-0.5" style={{ color: 'rgb(var(--color-text-secondary))' }}>
          Mensagens, eventos e templates — o mesmo que a API pública expõe.
        </p>
      </div>

      {/* Abas */}
      <div className="flex gap-1.5 mb-4 overflow-x-auto">
        {ABAS.map(a => (
          <button
            key={a.id}
            onClick={() => setAba(a.id)}
            className="text-xs font-bold px-3.5 py-2 rounded-xl whitespace-nowrap transition-colors"
            style={aba === a.id
              ? { background: 'rgba(var(--color-primary)/.15)', color: 'rgb(var(--color-primary))', border: '1px solid rgba(var(--color-primary)/.3)' }
              : { background: 'rgb(var(--color-surface))', color: 'rgb(var(--color-text-muted))', border: '1px solid rgb(var(--color-border))' }}
          >
            <span className="mr-1.5">{a.icon}</span>{a.label}
          </button>
        ))}
      </div>

      <p className="text-xs mb-4" style={{ color: 'rgb(var(--color-text-muted))' }}>{atual.hint}</p>

      {aba === 'mensagens' && <MensagensPanel />}
      {aba === 'webhooks'  && <WebhooksPanel />}
      {aba === 'templates' && <TemplatesPanel />}
    </div>
  );
}
