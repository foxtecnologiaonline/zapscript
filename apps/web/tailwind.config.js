/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx,js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        // next/font self-hosted — variáveis injetadas em apps/web/src/app/layout.tsx
        display: ['var(--font-space-grotesk)', 'system-ui', 'sans-serif'],
        sans:    ['var(--font-dm-sans)', 'system-ui', '-apple-system', 'sans-serif'],
      },
      maxWidth: {
        mobile: '430px',
      },
      colors: {
        // Balcão Virtual (console do atendimento) — tokens em app/balcao/balcao.css
        bv: {
          bg:       'rgb(var(--bv-bg) / <alpha-value>)',
          surface:  'rgb(var(--bv-surface) / <alpha-value>)',
          subtle:   'rgb(var(--bv-subtle) / <alpha-value>)',
          border:   'rgb(var(--bv-border) / <alpha-value>)',
          text:     'rgb(var(--bv-text) / <alpha-value>)',
          muted:    'rgb(var(--bv-muted) / <alpha-value>)',
          primary:  'rgb(var(--bv-primary) / <alpha-value>)',
          'primary-fg': 'rgb(var(--bv-primary-fg) / <alpha-value>)',
          'primary-soft': 'rgb(var(--bv-primary-soft) / <alpha-value>)',
          success:  'rgb(var(--bv-success) / <alpha-value>)',
          'success-soft': 'rgb(var(--bv-success-soft) / <alpha-value>)',
          warning:  'rgb(var(--bv-warning) / <alpha-value>)',
          'warning-soft': 'rgb(var(--bv-warning-soft) / <alpha-value>)',
          danger:   'rgb(var(--bv-danger) / <alpha-value>)',
          'danger-soft': 'rgb(var(--bv-danger-soft) / <alpha-value>)',
          focus:    'rgb(var(--bv-focus) / <alpha-value>)',
        },
        brand: {
          bg:       'rgb(var(--color-bg) / <alpha-value>)',
          surface:  'rgb(var(--color-surface) / <alpha-value>)',
          elevated: 'rgb(var(--color-surface-elevated) / <alpha-value>)',
          primary:  'rgb(var(--color-primary) / <alpha-value>)',
          accent:   'rgb(var(--color-accent) / <alpha-value>)',
          text:     'rgb(var(--color-text) / <alpha-value>)',
          muted:    'rgb(var(--color-text-muted) / <alpha-value>)',
          border:   'rgb(var(--color-border) / <alpha-value>)',
        },
      },
      boxShadow: {
        'glow-green': 'var(--shadow-glow)',
        'small':      'var(--shadow-sm)',
        'medium':     'var(--shadow-md)',
        'large':      'var(--shadow-lg)',
      },
      animation: {
        'fadeInUp':   'fadeInUp .6s ease both',
        'rotateIn':   'rotateWordIn .45s cubic-bezier(.4,0,.2,1) both',
      },
      keyframes: {
        fadeInUp: {
          from: { opacity: 0, transform: 'translateY(20px)' },
          to:   { opacity: 1, transform: 'translateY(0)' },
        },
        rotateWordIn: {
          from: { opacity: 0, transform: 'translateY(100%)', filter: 'blur(4px)' },
          to:   { opacity: 1, transform: 'translateY(0)',    filter: 'blur(0)' },
        },
      },
    },
  },
  plugins: [],
};
