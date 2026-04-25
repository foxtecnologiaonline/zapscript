/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx,js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Space Grotesk', 'system-ui', 'sans-serif'],
        sans:    ['DM Sans', 'system-ui', '-apple-system', 'sans-serif'],
      },
      maxWidth: {
        mobile: '430px',
      },
      colors: {
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
