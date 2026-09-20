'use client';
import { useState } from 'react';

/**
 * Alternativa a gravar áudio ou escrever um texto livre: perguntas curtas e objetivas
 * que qualquer dono de negócio sabe responder de cabeça. As respostas já vêm
 * estruturadas (uma por tópico), então viram o businessContext por template direto —
 * sem chamada de IA, sem espera, sem custo.
 */

interface WizardStep {
  key: string;
  question: string;
  placeholder: string;
  optional?: boolean;
}

const STEPS: WizardStep[] = [
  {
    key: 'negocio',
    question: 'Qual o nome do negócio e o que ele é?',
    placeholder: 'Ex: Clínica Sorriso, uma clínica odontológica em São Paulo',
  },
  {
    key: 'oferta',
    question: 'O que vocês vendem ou oferecem?',
    placeholder: 'Ex: Consultas, limpeza, clareamento e ortodontia',
  },
  {
    key: 'horario',
    question: 'Qual o horário de funcionamento?',
    placeholder: 'Ex: Segunda a sábado, das 8h às 18h',
  },
  {
    key: 'pagamento',
    question: 'Quais formas de pagamento vocês aceitam?',
    placeholder: 'Ex: PIX, cartão e convênios X e Y',
  },
  {
    key: 'politicas',
    question: 'Alguma política importante? (cancelamento, garantia, entrega...)',
    placeholder: 'Ex: Cancelamentos com 24h de antecedência',
    optional: true,
  },
];

interface QuickSetupWizardProps {
  onComplete: (businessContext: string) => void;
  onCancel: () => void;
}

export default function QuickSetupWizard({ onComplete, onCancel }: QuickSetupWizardProps) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const current = STEPS[step];
  const value = answers[current.key] || '';
  const isLast = step === STEPS.length - 1;
  const canAdvance = !!current.optional || value.trim().length > 0;

  function setValue(v: string) {
    setAnswers((a) => ({ ...a, [current.key]: v }));
  }

  function next() {
    if (!canAdvance) return;
    if (isLast) {
      const text = STEPS
        .filter((s) => (answers[s.key] || '').trim().length > 0)
        .map((s) => `${s.question}\n${answers[s.key].trim()}`)
        .join('\n\n');
      onComplete(text);
    } else {
      setStep((s) => s + 1);
    }
  }

  function back() {
    if (step === 0) onCancel();
    else setStep((s) => s - 1);
  }

  return (
    <div className="rounded-xl border border-brand-primary/60 bg-brand-primary/10 p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-brand-primary">Pergunta {step + 1} de {STEPS.length}</span>
        <button onClick={onCancel} className="text-xs text-brand-text-secondary hover:text-brand-text">
          Cancelar
        </button>
      </div>

      <h3 className="font-medium text-brand-text mb-2">
        {current.question}
        {current.optional && <span className="text-brand-muted font-normal"> (opcional)</span>}
      </h3>

      <textarea
        key={current.key}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={current.placeholder}
        rows={3}
        autoFocus
        maxLength={500}
        className="w-full rounded-lg border border-brand-border bg-brand-elevated px-3 py-2 text-sm text-brand-text focus:outline-none focus:border-brand-primary resize-y"
      />

      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={next}
          disabled={!canAdvance}
          className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:bg-brand-primary disabled:opacity-50"
        >
          {isLast ? 'Concluir' : 'Próxima'}
        </button>
        <button
          onClick={back}
          className="rounded-lg border border-brand-border px-4 py-2 text-sm font-medium text-brand-text-secondary hover:border-brand-primary/30"
        >
          {step === 0 ? 'Cancelar' : 'Voltar'}
        </button>
      </div>
    </div>
  );
}
