'use client';

interface ConfidenceBadgeProps {
  confidence: number;
  faqId?: string;
  faqQuestion?: string;
  onExplain?: () => void;
  size?: 'sm' | 'md' | 'lg';
}

export default function ConfidenceBadge({
  confidence,
  faqId,
  faqQuestion,
  onExplain,
  size = 'md',
}: ConfidenceBadgeProps) {
  const percent = Math.round(confidence);
  const isHigh = confidence >= 70;
  const isMedium = confidence >= 40 && confidence < 70;
  const isLow = confidence < 40;

  const colors = isHigh
    ? { bg: 'bg-brand-primary/50', border: 'border-brand-primary/60', text: 'text-brand-primary', badge: '🟢' }
    : isMedium
      ? { bg: 'bg-amber-950/50', border: 'border-amber-800/60', text: 'text-amber-400', badge: '🟡' }
      : { bg: 'bg-red-400/10', border: 'border-red-400/30', text: 'text-red-400', badge: '🔴' };

  const sizes = {
    sm: 'px-2 py-1 text-xs',
    md: 'px-3 py-2 text-sm',
    lg: 'px-4 py-3 text-base',
  };

  return (
    <div className={`rounded-lg border ${colors.border} ${colors.bg} ${sizes[size]}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span>{colors.badge}</span>
          <span className={`font-semibold ${colors.text}`}>{percent}%</span>
        </div>

        {onExplain && (
          <button
            onClick={onExplain}
            className={`${colors.text} hover:opacity-70 transition-opacity underline text-[11px]`}
          >
            Por quê?
          </button>
        )}
      </div>

      {faqQuestion && (
        <div className="mt-2 text-xs text-brand-text-secondary pt-2 border-t border-brand-border">
          <div className="font-medium text-brand-text-secondary mb-1">Baseado em:</div>
          <p className="italic">"{faqQuestion}"</p>
        </div>
      )}
    </div>
  );
}
