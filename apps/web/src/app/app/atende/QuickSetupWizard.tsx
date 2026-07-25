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
    <div className="rounded-xl border border-emerald-800/60 bg-emerald-950/20 p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-emerald-300">Pergunta {step + 1} de {STEPS.length}</span>
        <button onClick={onCancel} className="text-xs text-neutral-400 hover:text-neutral-200">
          Cancelar
        </button>
      </div>

      <h3 className="font-medium text-neutral-100 mb-2">
        {current.question}
        {current.optional && <span className="text-neutral-500 font-normal"> (opcional)</span>}
      </h3>

      <textarea
        key={current.key}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={current.placeholder}
        rows={3}
        autoFocus
        maxLength={500}
        className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-emerald-500 resize-y"
      />

      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={next}
          disabled={!canAdvance}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {isLast ? 'Concluir' : 'Próxima'}
        </button>
        <button
          onClick={back}
          className="rounded-lg border border-neutral-700 px-4 py-2 text-sm font-medium text-neutral-300 hover:border-neutral-600"
        >
          {step === 0 ? 'Cancelar' : 'Voltar'}
        </button>
      </div>
    </div>
  );
}
