import { TESTIMONIALS, type Testimonial } from '@/lib/testimonials';

function initials(name: string): string {
  return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');
}

function Card({ t }: { t: Testimonial }) {
  return (
    <div
      className="rounded-2xl p-5 flex flex-col gap-3"
      style={{ background: 'rgb(var(--color-surface))', border: '1px solid rgb(var(--color-border))' }}
    >
      <div className="text-base leading-none" style={{ color: 'rgb(var(--color-primary))' }}>★★★★★</div>
      <p className="text-sm leading-relaxed" style={{ color: 'rgb(var(--color-text-secondary))' }}>
        “{t.quote}”
      </p>
      <div className="flex items-center gap-3 mt-1">
        {t.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={t.avatar} alt={t.name} className="w-9 h-9 rounded-full object-cover" />
        ) : (
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold"
            style={{ background: 'rgba(16,185,129,.15)', color: 'rgb(var(--color-primary))' }}
          >
            {initials(t.name)}
          </div>
        )}
        <div>
          <p className="text-sm font-semibold" style={{ color: 'rgb(var(--color-text))' }}>{t.name}</p>
          {t.role && <p className="text-xs" style={{ color: 'rgb(var(--color-text-muted))' }}>{t.role}</p>}
        </div>
      </div>
    </div>
  );
}

/** Seção de depoimentos. Renderiza nada se não houver depoimentos cadastrados. */
export function Testimonials({ title = 'Quem usa, recomenda' }: { title?: string }) {
  if (!TESTIMONIALS.length) return null;

  return (
    <section className="px-5 pb-16">
      <h2 className="font-display font-bold text-xl text-center mb-5" style={{ color: 'rgb(var(--color-text))' }}>
        {title}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TESTIMONIALS.map((t, i) => <Card key={i} t={t} />)}
      </div>
    </section>
  );
}
