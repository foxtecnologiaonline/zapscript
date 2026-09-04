import type { MetadataRoute } from 'next';

// Ícone fonte é /icon.svg (32x32, quadrado) — o mesmo usado pelo favicon
// automático do Next.js. Evita depender de um PNG quadrado dedicado que
// ainda não existe (icon.png hoje é 336x270, não quadrado).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name:             'ZapScript — Conversão Inteligente de Áudios do WhatsApp',
    short_name:       'ZapScript',
    description:      'Converta áudios do WhatsApp em texto e resumo com IA, automaticamente.',
    start_url:        '/',
    display:          'standalone',
    background_color: '#0c0c12',
    theme_color:      '#0c0c12',
    lang:             'pt-BR',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  };
}
